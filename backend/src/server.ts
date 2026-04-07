import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import csv from 'csv-parser';
import dotenv from 'dotenv';
import twilio from 'twilio';

import db from './database';
import { VoiceAgentConnection } from './voiceAgent';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // to parse twilio webhook form bodies

const upload = multer({ dest: 'uploads/' });

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';
const NGROK_URL = process.env.NGROK_URL || '';

let twilioClient: twilio.Twilio;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// REST Endpoints
app.get('/', (req, res) => {
  res.send('AI Call Agent API is running.');
});

app.post('/api/upload_csv', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const results: any[] = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => {
      // Robust header matching
      const normalizedData: any = {};
      Object.keys(data).forEach(key => {
        const lowerKey = key.toLowerCase().replace(/[^a-z]/g, '');
        if (lowerKey === 'name' || lowerKey === 'fullname' || lowerKey === 'contactname') {
           normalizedData.name = data[key];
        } else if (lowerKey === 'phonenumber' || lowerKey === 'phone' || lowerKey === 'number' || lowerKey === 'mobile' || lowerKey === 'cell') {
           let num = String(data[key]).trim();
           // Normalize local pakistani numbers starting with 0
           if (num.startsWith('03') && num.length === 11) {
             num = '+92' + num.substring(1);
           } else if (num.startsWith('3') && num.length === 10) {
             num = '+92' + num;
           } else if (!num.startsWith('+')) {
             // Default to +92 if no prefix is given (since user seems to be in PK)
             num = '+' + num;
           }
           normalizedData.phone_number = num;
        } else if (lowerKey === 'context' || lowerKey === 'details' || lowerKey === 'notes' || lowerKey === 'message' || lowerKey === 'directive') {
           normalizedData.context = data[key];
        }
      });
      results.push(normalizedData);
    })
    .on('end', () => {
      const stmt = db.prepare(`INSERT INTO contacts (name, phone_number, context) VALUES (?, ?, ?)`);
      const insertMany = db.transaction((contacts: any[]) => {
        for (const contact of contacts) {
          stmt.run(contact.name || 'Unknown', contact.phone_number || '', contact.context || 'General inquiry');
        }
      });
      insertMany(results);
      res.json({ message: 'CSV uploaded successfully' });
    });
});

app.get('/api/contacts', (req, res) => {
  const contacts = db.prepare(`SELECT * FROM contacts ORDER BY id DESC`).all();
  res.json(contacts);
});

app.put('/api/contacts/:id', (req, res) => {
  const { name, phone_number, context } = req.body;
  const { id } = req.params;
  try {
    db.prepare(`UPDATE contacts SET name = ?, phone_number = ?, context = ? WHERE id = ?`)
      .run(name, phone_number, context, id);
    res.json({ message: 'Contact updated successfully' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  res.json({ message: 'Contact deleted successfully' });
});

app.get('/api/settings', (req, res) => {
  const row: any = db.prepare(`SELECT value FROM settings WHERE key = 'global_pitch'`).get();
  res.json({ global_pitch: row ? row.value : '' });
});

app.post('/api/settings', (req, res) => {
  const { global_pitch } = req.body;
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('global_pitch', ?)`).run(global_pitch);
  res.json({ message: 'Global pitch updated' });
});

app.post('/api/start_calls', async (req, res) => {
  if (!twilioClient) return res.status(500).json({ error: 'Twilio client not initialized' });
  
  const pending = db.prepare(`SELECT * FROM contacts WHERE status = 'pending'`).all();
  let count = 0;
  for (const contact of pending as any[]) {
    try {
      const webhookUrl = `${NGROK_URL.replace('wss://', 'https://')}/twiml/${contact.id}`;
      const call = await twilioClient.calls.create({
        to: contact.phone_number,
        from: TWILIO_PHONE_NUMBER,
        url: webhookUrl
      });
      db.prepare(`UPDATE contacts SET status = 'calling', call_sid = ? WHERE id = ?`)
        .run(call.sid, contact.id);
      count++;
      
      // Wait for 10 seconds before starting next call to respect rate limits/trial accounts (One-by-one mode)
      if (count < pending.length) {
        console.log(`Waiting 10 seconds before next call...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } catch (e: any) {
      db.prepare(`UPDATE contacts SET status = 'failed', notes = ? WHERE id = ?`).run(e.message, contact.id);
    }
  }
  db.prepare(`UPDATE contacts SET status = 'pending' WHERE status = 'calling' AND call_sid IS NULL`).run();
  res.json({ message: `Initiated ${count} calls sequentially` });
});

app.post('/api/contacts/:id/hangup', async (req, res) => {
  const { id } = req.params;
  const contact: any = db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
  if (contact && contact.call_sid && twilioClient) {
    try {
      await twilioClient.calls(contact.call_sid).update({ status: 'completed' });
      db.prepare(`UPDATE contacts SET status = 'failed', notes = 'Terminated manually' WHERE id = ?`).run(id);
      res.json({ message: 'Call terminated' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  } else {
    res.status(404).json({ error: 'No active call found' });
  }
});

app.post('/twiml/:id', (req, res) => {
  const contactId = req.params.id;
  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  connect.stream({ url: `${NGROK_URL}/media-stream/${contactId}` });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Create Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: any) => {
  const urlParts = req.url?.split('/') || [];
  const contactId = urlParts[urlParts.length - 1];
  
  if (req.url && req.url.startsWith('/media-stream')) {
    console.log(`WebSocket connected for contact: ${contactId}`);
    const contact: any = db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId);
    if (!contact) {
      ws.close();
      return;
    }
    
    let agent: VoiceAgentConnection | null = null;
    let streamSid: string = '';

    ws.on('message', async (message: any) => {
      try {
         const msg = JSON.parse(message.toString());
         if (msg.event === 'start') {
           streamSid = msg.start.streamSid;
           console.log(`Media stream started for ${contactId}, Sid: ${streamSid}`);
           // Fetch current global pitch
           const row: any = db.prepare(`SELECT value FROM settings WHERE key = 'global_pitch'`).get();
           const pitch = row ? row.value : 'Hello!';
           agent = new VoiceAgentConnection(ws, streamSid, contact.context || 'General inquiry', pitch, Number(contactId), db);
           await agent.start();
         } else if (msg.event === 'media') {
           if (agent) {
             const audioB64 = msg.media.payload;
             const audioBytes = Buffer.from(audioB64, 'base64');
             agent.processAudioFromTwilio(audioBytes);
           }
         } else if (msg.event === 'stop') {
           console.log(`Media stream stopped for ${contactId}`);
           if (agent) {
             await agent.close();
           }
           db.prepare(`UPDATE contacts SET status = 'completed' WHERE id = ?`).run(contactId);
           ws.close();
         }
      } catch (e) {
        console.error('WebSocket Error:', e);
      }
    });

    ws.on('close', () => {
      if (agent) agent.close();
    });
  }
});

const PORT = 8000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
