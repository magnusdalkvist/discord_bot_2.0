const fs = require("fs");
const path = require("path");

const ENTRANCE_SOUNDS_FILE = path.join(__dirname, "..", "entranceSounds.json");

/**
 * Load entrance sounds from file
 * @returns {Object} Object with structure: { guildId: { userId: soundFileName } }
 */
function loadEntranceSounds() {
  try {
    if (fs.existsSync(ENTRANCE_SOUNDS_FILE)) {
      const data = fs.readFileSync(ENTRANCE_SOUNDS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading entrance sounds:", error);
  }
  return {};
}

/**
 * Save entrance sounds to file
 * @param {Object} entranceSounds - Object with structure: { guildId: { userId: soundFileName } }
 */
function saveEntranceSounds(entranceSounds) {
  try {
    fs.writeFileSync(ENTRANCE_SOUNDS_FILE, JSON.stringify(entranceSounds, null, 2));
  } catch (error) {
    console.error("Error saving entrance sounds:", error);
  }
}

/**
 * Get entrance sound for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {string|null} The sound file name or null if not set
 */
function getEntranceSound(guildId, userId) {
  const entranceSounds = loadEntranceSounds();
  return entranceSounds[guildId]?.[userId] || null;
}

/**
 * Set entrance sound for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @param {string} soundFileName - The sound file name
 */
function setEntranceSound(guildId, userId, soundFileName) {
  const entranceSounds = loadEntranceSounds();
  if (!entranceSounds[guildId]) {
    entranceSounds[guildId] = {};
  }
  entranceSounds[guildId][userId] = soundFileName;
  saveEntranceSounds(entranceSounds);
}

/**
 * Remove entrance sound for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 */
function removeEntranceSound(guildId, userId) {
  const entranceSounds = loadEntranceSounds();
  if (entranceSounds[guildId]) {
    delete entranceSounds[guildId][userId];
    if (Object.keys(entranceSounds[guildId]).length === 0) {
      delete entranceSounds[guildId];
    }
    saveEntranceSounds(entranceSounds);
  }
}

module.exports = {
  getEntranceSound,
  setEntranceSound,
  removeEntranceSound,
  loadEntranceSounds,
};

