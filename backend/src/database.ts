import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '..', 'call_agent.db');
const db = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone_number TEXT,
    context TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    call_sid TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Insert default starting message if not exists
  INSERT OR IGNORE INTO settings (key, value) VALUES ('starting_message', 'Hello, this is a call from Nexus Voice AI. I was calling regarding your recent inquiry. How are you today?');
`);

export default db;
