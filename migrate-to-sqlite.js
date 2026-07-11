const fs = require("node:fs");
const path = require("node:path");
const db = require("./utils/db");

function readJson(fileName) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function migrateEntranceSounds() {
  const data = readJson("entranceSounds.json");
  if (!data) {
    console.log("entranceSounds.json not found, skipping");
    return;
  }
  const insert = db.prepare(
    "INSERT INTO entrance_sounds (guild_id, user_id, sound_file) VALUES (?, ?, ?) " +
      "ON CONFLICT(guild_id, user_id) DO UPDATE SET sound_file = excluded.sound_file"
  );
  let count = 0;
  for (const [guildId, users] of Object.entries(data)) {
    for (const [userId, soundFile] of Object.entries(users)) {
      insert.run(guildId, userId, soundFile);
      count++;
    }
  }
  console.log(`Migrated ${count} entrance sound(s)`);
}

function migrateSubscriptions() {
  const data = readJson("subscriptions.json");
  if (!data) {
    console.log("subscriptions.json not found, skipping");
    return;
  }
  const insert = db.prepare(
    "INSERT OR IGNORE INTO subscriptions (guild_id, subscriber_id, target_id) VALUES (?, ?, ?)"
  );
  let count = 0;
  for (const [guildId, subscribers] of Object.entries(data)) {
    for (const [subscriberId, targets] of Object.entries(subscribers)) {
      for (const targetId of targets) {
        insert.run(guildId, subscriberId, targetId);
        count++;
      }
    }
  }
  console.log(`Migrated ${count} subscription(s)`);
}

function migrateMovieNight() {
  const data = readJson("movienight.json");
  if (!data) {
    console.log("movienight.json not found, skipping");
    return;
  }
  const insert = db.prepare(
    "INSERT INTO kv_store (key, value) VALUES ('movienight', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  insert.run(JSON.stringify(data));
  console.log(
    `Migrated movienight data (${data.movies?.length ?? 0} movies, ${data.nights?.length ?? 0} nights)`
  );
}

migrateEntranceSounds();
migrateSubscriptions();
migrateMovieNight();
console.log("Migration complete. Original JSON files were left untouched.");
