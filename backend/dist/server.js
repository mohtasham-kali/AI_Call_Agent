"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const twilio_1 = __importDefault(require("twilio"));
const database_1 = __importDefault(require("./database"));
const voiceAgent_1 = require("./voiceAgent");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true })); // to parse twilio webhook form bodies
const upload = (0, multer_1.default)({ dest: 'uploads/' });
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';
const NGROK_URL = process.env.NGROK_URL || '';
let twilioClient;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    twilioClient = (0, twilio_1.default)(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}
// REST Endpoints
app.get('/', (req, res) => {
    res.send('AI Call Agent API is running.');
});
app.post('/api/upload_csv', upload.single('file'), (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'No file uploaded' });
    const results = [];
    fs_1.default.createReadStream(req.file.path)
        .pipe((0, csv_parser_1.default)())
        .on('data', (data) => {
        // Robust header matching
        const normalizedData = {};
        Object.keys(data).forEach(key => {
            const lowerKey = key.toLowerCase().replace(/[^a-z]/g, '');
            if (lowerKey === 'name' || lowerKey === 'fullname' || lowerKey === 'contactname') {
                normalizedData.name = data[key];
            }
            else if (lowerKey === 'phonenumber' || lowerKey === 'phone' || lowerKey === 'number' || lowerKey === 'mobile' || lowerKey === 'cell') {
                let num = String(data[key]).trim();
                // Normalize local pakistani numbers starting with 0
                if (num.startsWith('03') && num.length === 11) {
                    num = '+92' + num.substring(1);
                }
                else if (num.startsWith('3') && num.length === 10) {
                    num = '+92' + num;
                }
                else if (!num.startsWith('+')) {
                    // Default to +92 if no prefix is given (since user seems to be in PK)
                    num = '+' + num;
                }
                normalizedData.phone_number = num;
            }
            else if (lowerKey === 'context' || lowerKey === 'details' || lowerKey === 'notes' || lowerKey === 'message' || lowerKey === 'directive') {
                normalizedData.context = data[key];
            }
        });
        results.push(normalizedData);
    })
        .on('end', () => {
        const stmt = database_1.default.prepare(`INSERT INTO contacts (name, phone_number, context) VALUES (?, ?, ?)`);
        const insertMany = database_1.default.transaction((contacts) => {
            for (const contact of contacts) {
                stmt.run(contact.name || 'Unknown', contact.phone_number || '', contact.context || 'General inquiry');
            }
        });
        insertMany(results);
        res.json({ message: 'CSV uploaded successfully' });
    });
});
app.get('/api/contacts', (req, res) => {
    const contacts = database_1.default.prepare(`SELECT * FROM contacts ORDER BY id DESC`).all();
    res.json(contacts);
});
app.put('/api/contacts/:id', (req, res) => {
    const { name, phone_number, context } = req.body;
    const { id } = req.params;
    try {
        database_1.default.prepare(`UPDATE contacts SET name = ?, phone_number = ?, context = ? WHERE id = ?`)
            .run(name, phone_number, context, id);
        res.json({ message: 'Contact updated successfully' });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.delete('/api/contacts/:id', (req, res) => {
    const { id } = req.params;
    database_1.default.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
    res.json({ message: 'Contact deleted successfully' });
});
app.get('/api/settings', (req, res) => {
    const row = database_1.default.prepare(`SELECT value FROM settings WHERE key = 'global_pitch'`).get();
    res.json({ global_pitch: row ? row.value : '' });
});
app.post('/api/settings', (req, res) => {
    const { global_pitch } = req.body;
    database_1.default.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('global_pitch', ?)`).run(global_pitch);
    res.json({ message: 'Global pitch updated' });
});
app.post('/api/start_calls', async (req, res) => {
    if (!twilioClient)
        return res.status(500).json({ error: 'Twilio client not initialized' });
    const pending = database_1.default.prepare(`SELECT * FROM contacts WHERE status = 'pending'`).all();
    let count = 0;
    for (const contact of pending) {
        try {
            const webhookUrl = `${NGROK_URL.replace('wss://', 'https://')}/twiml/${contact.id}`;
            const call = await twilioClient.calls.create({
                to: contact.phone_number,
                from: TWILIO_PHONE_NUMBER,
                url: webhookUrl
            });
            database_1.default.prepare(`UPDATE contacts SET status = 'calling', call_sid = ? WHERE id = ?`)
                .run(call.sid, contact.id);
            count++;
            // Wait for 10 seconds before starting next call to respect rate limits/trial accounts (One-by-one mode)
            if (count < pending.length) {
                console.log(`Waiting 10 seconds before next call...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
        catch (e) {
            database_1.default.prepare(`UPDATE contacts SET status = 'failed', notes = ? WHERE id = ?`).run(e.message, contact.id);
        }
    }
    database_1.default.prepare(`UPDATE contacts SET status = 'pending' WHERE status = 'calling' AND call_sid IS NULL`).run();
    res.json({ message: `Initiated ${count} calls sequentially` });
});
app.post('/api/contacts/:id/hangup', async (req, res) => {
    const { id } = req.params;
    const contact = database_1.default.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
    if (contact && contact.call_sid && twilioClient) {
        try {
            await twilioClient.calls(contact.call_sid).update({ status: 'completed' });
            database_1.default.prepare(`UPDATE contacts SET status = 'failed', notes = 'Terminated manually' WHERE id = ?`).run(id);
            res.json({ message: 'Call terminated' });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
    else {
        res.status(404).json({ error: 'No active call found' });
    }
});
app.post('/twiml/:id', (req, res) => {
    const contactId = req.params.id;
    const twiml = new twilio_1.default.twiml.VoiceResponse();
    const connect = twiml.connect();
    connect.stream({ url: `${NGROK_URL}/media-stream/${contactId}` });
    res.type('text/xml');
    res.send(twiml.toString());
});
// Create Server
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
wss.on('connection', (ws, req) => {
    const urlParts = req.url?.split('/') || [];
    const contactId = urlParts[urlParts.length - 1];
    if (req.url && req.url.startsWith('/media-stream')) {
        console.log(`WebSocket connected for contact: ${contactId}`);
        const contact = database_1.default.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId);
        if (!contact) {
            ws.close();
            return;
        }
        let agent = null;
        let streamSid = '';
        ws.on('message', async (message) => {
            try {
                const msg = JSON.parse(message.toString());
                if (msg.event === 'start') {
                    streamSid = msg.start.streamSid;
                    console.log(`Media stream started for ${contactId}, Sid: ${streamSid}`);
                    // Fetch current global pitch
                    const row = database_1.default.prepare(`SELECT value FROM settings WHERE key = 'global_pitch'`).get();
                    const pitch = row ? row.value : 'Hello!';
                    agent = new voiceAgent_1.VoiceAgentConnection(ws, streamSid, contact.context || 'General inquiry', pitch, Number(contactId), database_1.default);
                    await agent.start();
                }
                else if (msg.event === 'media') {
                    if (agent) {
                        const audioB64 = msg.media.payload;
                        const audioBytes = Buffer.from(audioB64, 'base64');
                        agent.processAudioFromTwilio(audioBytes);
                    }
                }
                else if (msg.event === 'stop') {
                    console.log(`Media stream stopped for ${contactId}`);
                    if (agent) {
                        await agent.close();
                    }
                    database_1.default.prepare(`UPDATE contacts SET status = 'completed' WHERE id = ?`).run(contactId);
                    ws.close();
                }
            }
            catch (e) {
                console.error('WebSocket Error:', e);
            }
        });
        ws.on('close', () => {
            if (agent)
                agent.close();
        });
    }
});
const PORT = 8000;
server.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
