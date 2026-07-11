const db = require("./db");

const getStmt = db.prepare(
  "SELECT sound_file FROM entrance_sounds WHERE guild_id = ? AND user_id = ?"
);
const setStmt = db.prepare(
  "INSERT INTO entrance_sounds (guild_id, user_id, sound_file) VALUES (?, ?, ?) " +
    "ON CONFLICT(guild_id, user_id) DO UPDATE SET sound_file = excluded.sound_file"
);
const removeStmt = db.prepare(
  "DELETE FROM entrance_sounds WHERE guild_id = ? AND user_id = ?"
);

/**
 * Get entrance sound for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {string|null} The sound file name or null if not set
 */
function getEntranceSound(guildId, userId) {
  const row = getStmt.get(guildId, userId);
  return row?.sound_file || null;
}

/**
 * Set entrance sound for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @param {string} soundFileName - The sound file name
 */
function setEntranceSound(guildId, userId, soundFileName) {
  setStmt.run(guildId, userId, soundFileName);
}

/**
 * Remove entrance sound for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 */
function removeEntranceSound(guildId, userId) {
  removeStmt.run(guildId, userId);
}

module.exports = {
  getEntranceSound,
  setEntranceSound,
  removeEntranceSound,
};
