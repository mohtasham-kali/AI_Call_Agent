import json
import os
import io
import asyncio
from typing import List

from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Depends, WebSocket, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import pandas as pd
from dotenv import load_dotenv

import models
from database import engine, get_db

from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse, Connect

from voice_agent import VoiceAgentConnection

load_dotenv()

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
NGROK_URL = os.getenv("NGROK_URL", "") # Must be wss://...

try:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
except Exception:
    twilio_client = None

@app.post("/api/upload_csv")
async def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
    
    for _, row in df.iterrows():
        # Allow either 'context' or 'pitch' column
        context_data = row.get("context", row.get("pitch", ""))
        db_contact = models.Contact(
            name=row.get("name", ""),
            phone_number=row.get("phone_number", ""),
            context=context_data,
            status="pending"
        )
        db.add(db_contact)
    db.commit()
    return {"message": "CSV uploaded successfully"}

@app.get("/api/contacts")
def get_contacts(db: Session = Depends(get_db)):
    return db.query(models.Contact).all()

@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(global_pitch="Hello, I am calling from Nexus Voice AI...")
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@app.post("/api/settings")
async def update_settings(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(global_pitch=data.get("global_pitch"))
        db.add(settings)
    else:
        settings.global_pitch = data.get("global_pitch")
    db.commit()
    return {"message": "Settings updated"}

@app.put("/api/contacts/{contact_id}")
async def update_contact(contact_id: int, request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if contact:
        contact.name = data.get("name", contact.name)
        contact.phone_number = data.get("phone_number", contact.phone_number)
        contact.context = data.get("context", contact.context)
        db.commit()
    return {"message": "Contact updated"}

@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if contact:
        db.delete(contact)
        db.commit()
    return {"message": "Contact deleted"}

@app.post("/api/start_calls")
def start_calls(db: Session = Depends(get_db)):
    pending_contacts = db.query(models.Contact).filter(models.Contact.status == "pending").all()
    count = 0
    if not twilio_client:
        return {"error": "Twilio client not initialized. Check Env variables."}
    for contact in pending_contacts:
        try:
            webhook_url = f"{NGROK_URL.replace('wss://', 'https://')}/twiml/{contact.id}"
            call = twilio_client.calls.create(
                to=contact.phone_number,
                from_=TWILIO_PHONE_NUMBER,
                url=webhook_url
            )
            contact.status = "calling"
            count += 1
        except Exception as e:
            contact.status = "failed"
            contact.notes = f"Error: {str(e)}"
    db.commit()
    return {"message": f"Started {count} calls"}

@app.api_route("/twiml/{contact_id}", methods=["GET", "POST"])
async def twilio_webhook(contact_id: int):
    response = VoiceResponse()
    connect = Connect()
    stream_url = f"{NGROK_URL}/media-stream/{contact_id}"
    connect.stream(url=stream_url)
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")

@app.websocket("/media-stream/{contact_id}")
async def media_stream(websocket: WebSocket, contact_id: int):
    await websocket.accept()
    print(f"WebSocket connected for contact: {contact_id}")
    
    db = next(get_db())
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    
    settings = db.query(models.Settings).first()
    global_pitch = settings.global_pitch if settings else "Hello, I am calling from Nexus Voice AI..."
    
    # Combined context for the AI
    contact_context = contact.context if contact else ""
    full_context = f"Global Pitch/Objective: {global_pitch}\n\nClient Specific Context: {contact_context}"
    
    agent = None
    stream_sid = None
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg['event'] == 'start':
                stream_sid = msg['start']['streamSid']
                print(f"Media stream started for {contact_id}, Sid: {stream_sid}")
                agent = VoiceAgentConnection(websocket, stream_sid, full_context)
                await agent.start()
            elif msg['event'] == 'media':
                if agent:
                    payload = msg['media']['payload']
                    # Twilio sends base64 mulaw, Deepgram expects raw bytes if not base64 encoding?
                    # Deepgram will parse raw base64 if we decode? Actually deepgram asyncwebsocket needs bytes.
                    import base64
                    audio_bytes = base64.b64decode(payload)
                    await agent.process_audio_from_twilio(audio_bytes)
            elif msg['event'] == 'stop':
                print(f"Media stream stopped for {contact_id}")
                break
    except Exception as e:
        print(f"WebSocket Error: {e}")
    finally:
        if agent:
            await agent.close()
        
        # After call ends, we could do a final note extraction, mocked here
        if contact:
            contact.status = "completed"
            contact.notes = "Call completed. Interaction finished."
            db.commit()
