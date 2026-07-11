const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "bot.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS entrance_sounds (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sound_file TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    guild_id TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, subscriber_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

module.exports = db;
