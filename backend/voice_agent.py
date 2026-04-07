import asyncio
import base64
import json
import os
import websockets
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
# from google import genai will be used. For streaming we can just use litellm or google-genai
import google.generativeai as genai

DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Default Rachel

# Configure Gemini
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

class VoiceAgentConnection:
    def __init__(self, twilio_ws, stream_sid, context=""):
        self.twilio_ws = twilio_ws
        self.stream_sid = stream_sid
        self.context = context
        
        self.deepgram = None
        self.elevenlabs_ws = None
        
        self.dg_connection = None
        
        self.transcript_buffer = ""
        self.llm_task = None
        self.tts_task = None
        
        self.is_interrupted = False
        
        # We need a queue to hold TTS chunks before sending them to Elevenlabs
        self.tts_queue = asyncio.Queue()

    async def start(self):
        # Initialize Deepgram
        try:
            deepgram = DeepgramClient(DEEPGRAM_API_KEY)
            self.dg_connection = deepgram.listen.asyncwebsocket.v("1")
            
            self.dg_connection.on(LiveTranscriptionEvents.Transcript, self.on_dg_transcript)
            self.dg_connection.on(LiveTranscriptionEvents.SpeechStarted, self.on_dg_speech_started)
            
            options = LiveOptions(
                model="nova-2",
                language="en-US",
                encoding="mulaw",
                channels=1,
                sample_rate=8000,
                interim_results=False,
                utterance_end_ms="1000",
                vad_events=True
            )
            await self.dg_connection.start(options)
        except Exception as e:
            print(f"Failed to start Deepgram: {e}")

        # Start ElevenLabs WS Connection
        elevenlabs_url = f"wss://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/stream-input?model_id=eleven_monolingual_v1&output_format=ulaw_8000"
        try:
            self.elevenlabs_ws = await websockets.connect(elevenlabs_url)
            # send initial config
            initial_msg = {
                "text": " ",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.8},
                "xi_api_key": ELEVENLABS_API_KEY
            }
            await self.elevenlabs_ws.send(json.dumps(initial_msg))
            asyncio.create_task(self.receive_elevenlabs_audio())
            asyncio.create_task(self.send_tts_queue_to_elevenlabs())
        except Exception as e:
            print(f"Failed to start ElevenLabs WS: {e}")
            
    async def process_audio_from_twilio(self, data):
        """Called when audio is received from Twilio"""
        if self.dg_connection:
            await self.dg_connection.send(data)

    async def on_dg_speech_started(self, *args, **kwargs):
        """User barged in"""
        self.is_interrupted = True
        print("Barge-in detected!")
        # Stop current LLM generation if any
        if self.llm_task and not self.llm_task.done():
            self.llm_task.cancel()
        
        # Clear Twilio audio buffer
        clear_msg = {
            "event": "clear",
            "streamSid": self.stream_sid
        }
        await self.twilio_ws.send_text(json.dumps(clear_msg))
        
        # Reset queue
        while not self.tts_queue.empty():
            try:
                self.tts_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def on_dg_transcript(self, *args, **kwargs):
        """Received transcript from Deepgram"""
        # simplified extraction. In deepgram-sdk it is in kwargs or passed as object
        # The accurate syntax for new SDK:
        result = args[0] if len(args) > 0 else kwargs.get('result')
        if not result: return
        
        sentence = result.channel.alternatives[0].transcript
        if sentence and result.is_final:
            print(f"User heard: {sentence}")
            self.transcript_buffer += " " + sentence
            self.is_interrupted = False
            
            # Start LLM response immediately if enough sentence is gathered.
            # Usually we wait until user completes to speak. We use utterance end or just send.
            if self.llm_task and not self.llm_task.done():
                self.llm_task.cancel()
            self.llm_task = asyncio.create_task(self.generate_response(self.transcript_buffer))
            self.transcript_buffer = ""

    async def generate_response(self, text):
        if not text.strip() or self.is_interrupted: return
        try:
            model = genai.GenerativeModel("gemini-1.5-flash")
            system_instruction = (
                "You are a professional AI phone call representative. "
                "Your objective is defined in the Global Pitch and Client Context below. "
                "Handle the client by following the logic and goals of the pitch. "
                "Do not merely repeat the pitch; use it as a guide for a natural, brief, and professional conversation. "
                "If the client asks something off-topic, politely bring them back to the objective if possible. "
                f"\n\n--- INSTRUCTIONS & CONTEXT ---\n{self.context}\n--- END ---"
            )
            prompt = f"{system_instruction}\n\nUser: {text}\nAI:"
            print(f"Sending to Gemini with prompt length: {len(prompt)}")
            response = await model.generate_content_async(prompt, stream=True)
            
            sentence_chunk = ""
            # chunk tokens on punctuation to send to ElevenLabs
            async for chunk in response:
                if self.is_interrupted: break
                token = chunk.text
                if token:
                    sentence_chunk += token
                    if any(p in sentence_chunk for p in [".", "?", "!", "\n"]):
                        await self.tts_queue.put(sentence_chunk)
                        sentence_chunk = ""
            if sentence_chunk:
                await self.tts_queue.put(sentence_chunk)
        except Exception as e:
            print(f"LLM Error: {e}")

    async def send_tts_queue_to_elevenlabs(self):
        while True:
            chunk = await self.tts_queue.get()
            if self.is_interrupted:
                continue
            if self.elevenlabs_ws:
                try:
                    payload = {"text": chunk, "try_trigger_generation": True}
                    await self.elevenlabs_ws.send(json.dumps(payload))
                except websockets.exceptions.ConnectionClosed:
                    break

    async def receive_elevenlabs_audio(self):
        if not self.elevenlabs_ws:
            return
        try:
            async for message in self.elevenlabs_ws:
                if self.is_interrupted:
                    continue
                data = json.loads(message)
                if data.get("audio"):
                    # audio is already base64 string
                    audio_b64 = data["audio"]
                    # Send to twilio
                    twilio_msg = {
                        "event": "media",
                        "streamSid": self.stream_sid,
                        "media": {
                            "payload": audio_b64
                        }
                    }
                    await self.twilio_ws.send_text(json.dumps(twilio_msg))
        except websockets.exceptions.ConnectionClosed:
            print("Elevenlabs socket closed")

    async def close(self):
        if self.dg_connection:
            await self.dg_connection.finish()
        if self.elevenlabs_ws:
            await self.elevenlabs_ws.send(json.dumps({"text": ""})) # Close signal
            await self.elevenlabs_ws.close()
