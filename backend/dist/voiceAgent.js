"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceAgentConnection = void 0;
const ws_1 = __importDefault(require("ws"));
const sdk_1 = require("@deepgram/sdk");
const genai_1 = require("@google/genai");
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
let ai = null;
if (GEMINI_API_KEY) {
    ai = new genai_1.GoogleGenAI({ apiKey: GEMINI_API_KEY });
}
class VoiceAgentConnection {
    contactId;
    db;
    twilioWs;
    streamSid;
    context;
    pitch;
    dgClient = null;
    elevenlabsWs = null;
    transcriptBuffer = '';
    isInterrupted = false;
    ttsQueue = [];
    ttsProcessing = false;
    currentLlmAbortController = null;
    fullTranscript = '';
    constructor(twilioWs, streamSid, context, pitch, contactId, db) {
        this.contactId = contactId;
        this.db = db;
        this.twilioWs = twilioWs;
        this.streamSid = streamSid;
        this.context = context;
        this.pitch = pitch;
    }
    async start() {
        this.startDeepgram();
        this.startElevenLabs();
        this.processTtsQueue();
    }
    startDeepgram() {
        const deepgram = (0, sdk_1.createClient)(DEEPGRAM_API_KEY);
        this.dgClient = deepgram.listen.live({
            model: 'nova-2',
            language: 'en-US',
            encoding: 'mulaw',
            channels: 1,
            sample_rate: 8000,
            smart_format: true,
            filler_words: false,
            interim_results: false,
            utterance_end_ms: 1000,
            vad_events: true
        });
        this.dgClient.on(sdk_1.LiveTranscriptionEvents.Open, () => {
            console.log('Deepgram connection opened');
        });
        this.dgClient.on(sdk_1.LiveTranscriptionEvents.Transcript, (data) => {
            const sentence = data.channel.alternatives[0].transcript;
            if (sentence && data.is_final) {
                console.log(`User heard: ${sentence}`);
                this.transcriptBuffer += ' ' + sentence;
                this.fullTranscript += `\nUser: ${sentence}`;
                this.isInterrupted = false;
                this.generateResponse(this.transcriptBuffer);
                this.transcriptBuffer = '';
            }
        });
        this.dgClient.on(sdk_1.LiveTranscriptionEvents.SpeechStarted, () => {
            console.log('Barge-in detected!');
            this.isInterrupted = true;
            if (this.currentLlmAbortController)
                this.currentLlmAbortController.abort();
            this.twilioWs.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
            this.ttsQueue = [];
        });
    }
    startElevenLabs() {
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream-input?model_id=eleven_monolingual_v1&output_format=ulaw_8000`;
        this.elevenlabsWs = new ws_1.default(url);
        this.elevenlabsWs.on('open', () => {
            this.elevenlabsWs?.send(JSON.stringify({ text: " ", xi_api_key: ELEVENLABS_API_KEY }));
        });
        this.elevenlabsWs.on('message', (message) => {
            if (this.isInterrupted)
                return;
            const data = JSON.parse(message.toString());
            if (data.audio) {
                this.twilioWs.send(JSON.stringify({ event: "media", streamSid: this.streamSid, media: { payload: data.audio } }));
            }
        });
    }
    processAudioFromTwilio(audioBytes) {
        if (this.dgClient?.getReadyState() === 1)
            this.dgClient.send(audioBytes);
    }
    async generateResponse(text) {
        if (!text.trim() || this.isInterrupted || !ai)
            return;
        if (this.currentLlmAbortController)
            this.currentLlmAbortController.abort();
        this.currentLlmAbortController = new AbortController();
        try {
            const prompt = `System: You are an AI sales agent. Objective: ${this.pitch}. Info: ${this.context}. Keep brief, natural, and stay on topic. User: ${text}`;
            const responseStream = await ai.models.generateContentStream({ model: 'gemini-1.5-flash', contents: prompt });
            let sentenceChunk = '';
            for await (const chunk of responseStream) {
                if (this.isInterrupted || this.currentLlmAbortController?.signal.aborted)
                    break;
                if (chunk.text) {
                    sentenceChunk += chunk.text;
                    if (/[.?!\\n]/.test(sentenceChunk)) {
                        this.ttsQueue.push(sentenceChunk);
                        this.fullTranscript += `\nAI: ${sentenceChunk}`;
                        sentenceChunk = '';
                    }
                }
            }
            if (sentenceChunk && !this.isInterrupted) {
                this.ttsQueue.push(sentenceChunk);
                this.fullTranscript += `\nAI: ${sentenceChunk}`;
            }
        }
        catch (e) {
            if (e.name !== 'AbortError')
                console.error('LLM Error:', e);
        }
    }
    async processTtsQueue() {
        setInterval(() => {
            if (this.isInterrupted) {
                this.ttsQueue = [];
                return;
            }
            if (this.ttsQueue.length > 0 && this.elevenlabsWs?.readyState === ws_1.default.OPEN) {
                const chunk = this.ttsQueue.shift();
                if (chunk)
                    this.elevenlabsWs.send(JSON.stringify({ text: chunk, try_trigger_generation: true }));
            }
        }, 50);
    }
    async close() {
        if (this.dgClient)
            this.dgClient.finish();
        if (this.elevenlabsWs) {
            this.elevenlabsWs.send(JSON.stringify({ text: "" }));
            this.elevenlabsWs.close();
        }
        if (this.currentLlmAbortController)
            this.currentLlmAbortController.abort();
        // Save summarization
        if (this.fullTranscript.trim() && ai) {
            try {
                const summary = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Summarize this call transcript into a few professional notes for a CRM. Indicate if the client was interested.\n\nTranscript:\n${this.fullTranscript}`
                });
                const note = summary.text || 'Call finished.';
                this.db.prepare(`UPDATE contacts SET notes = ? WHERE id = ?`).run(note, this.contactId);
            }
            catch (e) {
                console.error('Summary failed:', e);
            }
        }
    }
}
exports.VoiceAgentConnection = VoiceAgentConnection;
