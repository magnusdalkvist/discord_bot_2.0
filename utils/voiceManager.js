const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const fs = require("fs");

// Store active players per guild
const guildPlayers = new Map();
// Store leave timers per guild
const leaveTimers = new Map();

/**
 * Join a voice channel (or switch if already connected)
 * @param {Object} voiceChannel - The voice channel to join
 * @param {boolean} forceSwitch - Whether to switch even if already connected
 * @returns {Object} The voice connection
 */
function joinVoiceChannelForGuild(voiceChannel, forceSwitch = false) {
  const guildId = voiceChannel.guild.id;
  const existingConnection = getVoiceConnection(guildId);

  // If already connected to the same channel, return existing connection
  if (existingConnection && existingConnection.joinConfig.channelId === voiceChannel.id) {
    return existingConnection;
  }

  // If already connected and not forcing switch, return existing connection
  if (existingConnection && !forceSwitch) {
    return existingConnection;
  }

  // If already connected and forcing switch (and it's a different channel), destroy old connection
  if (existingConnection && forceSwitch && existingConnection.joinConfig.channelId !== voiceChannel.id) {
    existingConnection.destroy();
    // Clean up old players
    if (guildPlayers.has(guildId)) {
      const players = guildPlayers.get(guildId);
      players.forEach((player) => {
        player.stop();
      });
      guildPlayers.delete(guildId);
    }
  }

  // Join the voice channel
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // Handle connection errors
  connection.on("error", (error) => {
    console.error(`Voice connection error for guild ${guildId}:`, error);
  });

  // Handle disconnection
  connection.on("disconnect", () => {
    // Clean up players when disconnected
    if (guildPlayers.has(guildId)) {
      const players = guildPlayers.get(guildId);
      players.forEach((player) => {
        player.stop();
      });
      guildPlayers.delete(guildId);
    }
    // Clear leave timer
    if (leaveTimers.has(guildId)) {
      clearTimeout(leaveTimers.get(guildId));
      leaveTimers.delete(guildId);
    }
  });

  return connection;
}

/**
 * Play a sound file in a voice channel
 * @param {Object} voiceChannel - The voice channel to play in
 * @param {string} soundFilePath - Path to the sound file
 * @param {boolean} forceSwitch - Whether to switch channels if already connected
 */
function playSound(voiceChannel, soundFilePath, forceSwitch = false) {
  const guildId = voiceChannel.guild.id;

  // Check if sound file exists
  if (!fs.existsSync(soundFilePath)) {
    throw new Error(`Sound file not found: ${soundFilePath}`);
  }

  // Check if already connected to the same channel
  const existingConnection = getVoiceConnection(guildId);
  const isSameChannel = existingConnection && existingConnection.joinConfig.channelId === voiceChannel.id;
  
  // Only switch if forceSwitch is true AND it's a different channel
  const shouldSwitch = forceSwitch && !isSameChannel;

  // Join or get connection
  const connection = joinVoiceChannelForGuild(voiceChannel, shouldSwitch);

  // Create audio resource - createAudioResource will use ffmpeg automatically for MP3 files
  const resource = createAudioResource(soundFilePath, {
    inputType: "unknown",
    inlineVolume: true,
  });

  // Create a new audio player for this sound (allows simultaneous playback)
  const player = createAudioPlayer();

  // Handle player errors
  player.on("error", (error) => {
    console.error(`Audio player error for guild ${guildId}:`, error);
  });

  // Clean up player when it finishes
  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    // Remove from guild players after a short delay
    setTimeout(() => {
      if (guildPlayers.has(guildId)) {
        const players = guildPlayers.get(guildId);
        const index = players.indexOf(player);
        if (index > -1) {
          players.splice(index, 1);
        }
        // If no more players, clean up
        if (players.length === 0) {
          guildPlayers.delete(guildId);
        }
      }
    }, 1000);
  });

  // Store player for cleanup
  if (!guildPlayers.has(guildId)) {
    guildPlayers.set(guildId, []);
  }
  guildPlayers.get(guildId).push(player);

  // Subscribe player to connection
  connection.subscribe(player);

  // Play the sound
  player.play(resource);
}

/**
 * Check if bot is alone in a voice channel
 * @param {Object} guild - The guild to check
 * @returns {boolean} True if bot is alone, false otherwise
 */
function isBotAlone(guild) {
  const connection = getVoiceConnection(guild.id);
  if (!connection) {
    return false;
  }

  const channelId = connection.joinConfig.channelId;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    return false;
  }

  // Count members (excluding bots)
  const members = channel.members.filter((member) => !member.user.bot);
  return members.size === 0;
}

/**
 * Leave voice channel if bot is alone
 * @param {Object} guild - The guild to check
 * @param {number} delay - Delay in milliseconds before leaving (default: 2000)
 */
function leaveIfAlone(guild, delay = 2000) {
  const guildId = guild.id;

  // Clear existing timer if any
  if (leaveTimers.has(guildId)) {
    clearTimeout(leaveTimers.get(guildId));
  }

  // Set new timer
  const timer = setTimeout(() => {
    if (isBotAlone(guild)) {
      const connection = getVoiceConnection(guildId);
      if (connection) {
        // Clean up players
        if (guildPlayers.has(guildId)) {
          const players = guildPlayers.get(guildId);
          players.forEach((player) => {
            player.stop();
          });
          guildPlayers.delete(guildId);
        }
        connection.destroy();
      }
    }
    leaveTimers.delete(guildId);
  }, delay);

  leaveTimers.set(guildId, timer);
}

/**
 * Check if bot is connected to a voice channel in a guild
 * @param {Object} guild - The guild to check
 * @returns {boolean} True if connected, false otherwise
 */
function isConnected(guild) {
  const connection = getVoiceConnection(guild.id);
  return connection !== undefined;
}

module.exports = {
  joinVoiceChannelForGuild,
  playSound,
  isBotAlone,
  leaveIfAlone,
  isConnected,
};

