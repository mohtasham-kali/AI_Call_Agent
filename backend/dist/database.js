"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const dbPath = path_1.default.join(__dirname, '..', 'call_agent.db');
const db = new better_sqlite3_1.default(dbPath);
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
exports.default = db;
