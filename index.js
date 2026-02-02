const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ActivityType,
  PresenceUpdateStatus,
  TextDisplayBuilder,
} = require("discord.js");
const { token } = require("./config");
const { playSound, isConnected, leaveIfAlone } = require("./utils/voiceManager");
const { getEntranceSound, setEntranceSound } = require("./utils/entranceSounds");
const { movienightPath } = require("./utils/movieNightPolls");

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildScheduledEvents,
  ],
});

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  // Set bot presence/status to online
  readyClient.user.setPresence({
    activities: [{ name: "Soundboard", type: ActivityType.Playing }],
    status: PresenceUpdateStatus.Online,
  });

  // Check each guild for users in voice channels when bot starts
  for (const guild of readyClient.guilds.cache.values()) {
    // Wait a bit for voice states to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if bot is already connected
    if (isConnected(guild)) {
      continue;
    }

    // Find any voice channel with non-bot members
    const voiceChannels = guild.channels.cache.filter(
      (channel) => channel.isVoiceBased() && channel.members.size > 0,
    );

    for (const channel of voiceChannels.values()) {
      // Check if there are any non-bot members
      const nonBotMembers = channel.members.filter((member) => !member.user.bot);
      if (nonBotMembers.size > 0) {
        try {
          const { joinVoiceChannelForGuild } = require("./utils/voiceManager");
          joinVoiceChannelForGuild(channel, false);
          break; // Only join one channel per guild
        } catch (error) {
          console.error(`Error auto-joining ${channel.name}:`, error);
        }
      }
    }
  }
});

// Handle errors
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.on("warn", (warning) => {
  console.warn("Discord client warning:", warning);
});

// Global error handlers to prevent crashes
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit, just log the error
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit, just log the error
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const commandModule = require(filePath);
    const commands = Array.isArray(commandModule) ? commandModule : [commandModule];
    for (const command of commands) {
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
      } else {
        console.log(
          `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
        );
      }
    }
  }
}

client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
  const oldStatus = oldEvent?.status ?? "none";
  const newStatus = newEvent?.status ?? "none";

  if (!newEvent.name || !newEvent.name.startsWith("Movie Night:")) {
    return;
  }

  const data = JSON.parse(fs.readFileSync(movienightPath, "utf8"));
  if (!data.pendingEvents) data.pendingEvents = {};
  if (!data.nights) data.nights = [];

  // Use numeric status so we work even if gateway sends status as string (e.g. "2" vs 2)
  const newStatusNum = Number(newEvent.status);
  const oldStatusNum = oldEvent != null ? Number(oldEvent.status) : null;

  if (newStatusNum === 4) {
    delete data.pendingEvents[newEvent.id];
    data.nights = data.nights.filter((n) => n.eventId !== newEvent.id);
    fs.writeFileSync(movienightPath, JSON.stringify(data, null, 2));
    return;
  }

  if (newStatusNum === 2 && oldStatusNum !== 2) {
    const meta = data.pendingEvents[newEvent.id];
    if (meta) {
      const movieEntry = (data.movies || []).find((m) => m.movieId === meta.movieId);
      data.nights.push({
        eventId: newEvent.id,
        movieId: meta.movieId,
        movieName: meta.movieName,
        channelId: meta.channelId,
        guildId: meta.guildId,
        startTime: Date.now(),
        suggestedByUserId: movieEntry?.suggestedByUserId ?? null,
      });
      delete data.pendingEvents[newEvent.id];
      fs.writeFileSync(movienightPath, JSON.stringify(data, null, 2));
    }
    return;
  }

  // Event ended (Active → Completed). Only ensure night exists and mark movie as watched; rating poll is created via /movienight rate.
  if (newStatusNum === 3 && oldStatusNum !== 3) {
    let night = data.nights.find((n) => n.eventId === newEvent.id);
    if (!night) {
      const meta = data.pendingEvents[newEvent.id];
      if (!meta) {
        return;
      }
      const movieEntry = (data.movies || []).find((m) => m.movieId === meta.movieId);
      night = {
        eventId: newEvent.id,
        movieId: meta.movieId,
        movieName: meta.movieName,
        channelId: meta.channelId,
        guildId: meta.guildId,
        startTime: Date.now(),
        suggestedByUserId: movieEntry?.suggestedByUserId ?? null,
      };
      data.nights.push(night);
      delete data.pendingEvents[newEvent.id];
    }
    const movie = (data.movies || []).find((m) => m.movieId === night.movieId);
    if (movie) movie.watched = true;
    fs.writeFileSync(movienightPath, JSON.stringify(data, null, 2));
  }
});

client.on(Events.GuildScheduledEventDelete, async (event) => {
  if (!event.name || !event.name.startsWith("Movie Night:")) return;
  const data = JSON.parse(fs.readFileSync(movienightPath, "utf8"));
  if (!data.pendingEvents) data.pendingEvents = {};
  delete data.pendingEvents[event.id];
  data.nights = (data.nights || []).filter((n) => n.eventId !== event.id);
  fs.writeFileSync(movienightPath, JSON.stringify(data, null, 2));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isModalSubmit()) {
    // Handle modal submissions
    if (interaction.customId.startsWith("changeNicknameModal_")) {
      const targetUserId = interaction.customId.split("_").pop();
      const newNickname = interaction.fields.getTextInputValue("nickname");

      try {
        const targetMember = await interaction.guild.members.fetch(targetUserId);

        if (!interaction.member.permissions.has("ManageNicknames")) {
          await interaction.reply({
            content: "You don't have permission to change nicknames!",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (!interaction.guild.members.me.permissions.has("ManageNicknames")) {
          await interaction.reply({
            content: "I don't have permission to change nicknames!",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const previousNickname = targetMember.nickname;
        const nicknameToSet = newNickname.trim() || null;
        await targetMember.setNickname(nicknameToSet);

        await interaction.reply({
          content: `Changed nickname: ${previousNickname} -> ${nicknameToSet}`,
        });
      } catch (error) {
        console.error("Error changing nickname:", error);
        await interaction.reply({
          content: `There was an error while changing the nickname: ${error.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.customId === "uploadSoundModal") {
      const fs = require("fs");
      const soundUrl = [...interaction.fields.getUploadedFiles("sound_file").values()][0]?.url;
      const name = interaction.fields.getTextInputValue("sound_name");

      // Get the select menu value
      let setAsEntrance = "no";
      try {
        const selectField = interaction.fields.fields.get("set_as_entrance");
        if (selectField && selectField.values && selectField.values.length > 0) {
          setAsEntrance = selectField.values[0] || "no";
        }
      } catch (error) {
        setAsEntrance = "no";
      }

      try {
        const res = await fetch(soundUrl);
        if (!res.ok) {
          await interaction.reply({
            content: "Failed to download the audio file.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const arrayBuffer = await res.arrayBuffer();
        // Ensure ./sounds directory exists
        if (!fs.existsSync("./sounds")) {
          fs.mkdirSync("./sounds");
        }
        const filePath = `./sounds/${name}.mp3`;
        if (fs.existsSync(filePath)) {
          await interaction.reply({
            content: `A sound with the name "${name}" already exists. Please choose a different name.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

        // Set as entrance sound if "yes" was selected
        let replyMessage = `Uploaded sound: "${name}"`;
        if (setAsEntrance === "yes") {
          const guildId = interaction.guild.id;
          const userId = interaction.user.id;
          setEntranceSound(guildId, userId, `${name}.mp3`);
          replyMessage = `Uploaded sound: "${name}" and set as your entrance sound!`;
        }

        await interaction.reply({ content: replyMessage });
      } catch (error) {
        console.error(error);
        await interaction.reply({
          content: "There was an error while uploading the sound!",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
  }

  // Handle button interactions for pagination and sound playback
  if (interaction.isButton()) {
    const customId = interaction.customId;

    // Handle pagination buttons
    if (customId.startsWith("previous_page_") || customId.startsWith("next_page_")) {
      const soundboardCommand = interaction.client.commands.get("soundboard");
      if (!soundboardCommand || !soundboardCommand.renderSoundboard) {
        await interaction.reply({
          content: "Error: Soundboard command not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Extract current page from customId
      const currentPage = parseInt(customId.split("_").pop());
      let newPage = currentPage;

      if (customId.startsWith("previous_page_")) {
        newPage = Math.max(1, currentPage - 1);
      } else if (customId.startsWith("next_page_")) {
        newPage = currentPage + 1;
      }

      // Render the soundboard with the new page
      const response = await soundboardCommand.renderSoundboard(interaction, newPage);
      await interaction.update(response);
      return;
    }

    // Handle sound playback buttons
    if (customId.startsWith("play_sound_")) {
      const soundboardCommand = interaction.client.commands.get("soundboard");
      if (!soundboardCommand || !soundboardCommand.getSortedSounds) {
        await interaction.reply({
          content: "Error: Soundboard command not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get user's voice channel
      const member = interaction.member;
      if (!member || !member.voice || !member.voice.channel) {
        await interaction.reply({
          content: "You need to be in a voice channel to play sounds!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const voiceChannel = member.voice.channel;

      // Extract sound index from customId
      const soundIndex = parseInt(customId.split("_").pop());
      const allSounds = soundboardCommand.getSortedSounds();

      if (soundIndex < 0 || soundIndex >= allSounds.length) {
        await interaction.reply({
          content: "Error: Sound not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const soundFileName = allSounds[soundIndex];
      const soundFilePath = `./sounds/${soundFileName}`;

      try {
        // Switch to user's channel if needed and play sound
        try {
          playSound(voiceChannel, soundFilePath, true);
        } catch (playError) {
          console.error("Error in playSound:", playError);
          // Don't crash, just notify user
          throw playError;
        }

        // Update the soundboard to show the same page
        if (!soundboardCommand || !soundboardCommand.renderSoundboard) {
          await interaction.reply({
            content: "Error: Soundboard command not found.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // Extract global sound index from customId (format: play_sound_${globalIndex})
        const globalSoundIndex = parseInt(customId.split("_").pop());

        // Calculate the page number from the global sound index
        // Soundboard uses 3 rows x 3 columns = 9 sounds per page
        const rows = 3;
        const columns = 3;
        const soundsPerPage = rows * columns;
        const currentPage = Math.floor(globalSoundIndex / soundsPerPage) + 1;

        // Render the soundboard with the current page
        const response = await soundboardCommand.renderSoundboard(interaction, currentPage);
        await interaction.update(response);
      } catch (error) {
        console.error("Error playing sound:", error);
        await interaction.reply({
          content: "There was an error playing the sound!",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // Handle page_number button
    if (customId.startsWith("page_number_")) {
      const soundboardCommand = interaction.client.commands.get("soundboard");
      if (!soundboardCommand || !soundboardCommand.renderSoundboard) {
        await interaction.reply({
          content: "Error: Soundboard command not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Extract current page from customId
      const currentPage = parseInt(customId.split("_").pop());

      // Render the soundboard with the new page
      const response = await soundboardCommand.renderSoundboard(interaction, currentPage);
      await interaction.update(response);
      return;
    }

    // Handle entrance sound selection pagination buttons
    if (
      customId.startsWith("entrance_previous_page_") ||
      customId.startsWith("entrance_next_page_")
    ) {
      const soundboardCommand = interaction.client.commands.get("soundboard");
      if (!soundboardCommand || !soundboardCommand.renderEntranceSoundSelection) {
        await interaction.reply({
          content: "Error: Soundboard command not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Extract current page from customId
      const currentPage = parseInt(customId.split("_").pop());
      let newPage = currentPage;

      if (customId.startsWith("entrance_previous_page_")) {
        newPage = Math.max(1, currentPage - 1);
      } else if (customId.startsWith("entrance_next_page_")) {
        newPage = currentPage + 1;
      }

      // Render the entrance sound selection with the new page
      const response = await soundboardCommand.renderEntranceSoundSelection(interaction, newPage);
      await interaction.update(response);
      return;
    }

    // Handle entrance_page_number button
    if (customId.startsWith("entrance_page_number_")) {
      const soundboardCommand = interaction.client.commands.get("soundboard");
      if (!soundboardCommand || !soundboardCommand.renderEntranceSoundSelection) {
        await interaction.reply({
          content: "Error: Soundboard command not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Extract current page from customId
      const currentPage = parseInt(customId.split("_").pop());
      // Render the entrance sound selection with the new page
      const response = await soundboardCommand.renderEntranceSoundSelection(
        interaction,
        currentPage,
      );
      await interaction.update(response);
      return;
    }

    // Handle entrance sound selection buttons
    if (customId.startsWith("set_entrance_")) {
      const soundboardCommand = interaction.client.commands.get("soundboard");
      if (!soundboardCommand || !soundboardCommand.getSortedSounds) {
        await interaction.reply({
          content: "Error: Soundboard command not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Extract global sound index from customId (format: set_entrance_${globalIndex})
      const globalSoundIndex = parseInt(customId.split("_").pop());
      const allSounds = soundboardCommand.getSortedSounds();

      if (globalSoundIndex < 0 || globalSoundIndex >= allSounds.length) {
        await interaction.reply({
          content: "Error: Sound not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const soundFileName = allSounds[globalSoundIndex];
      const guildId = interaction.guild.id;
      const userId = interaction.user.id;

      // Set the entrance sound
      setEntranceSound(guildId, userId, soundFileName);

      // Instead of sending a followup, replace the soundboard select menu with a confirmation message
      await interaction.update({
        components: [
          new TextDisplayBuilder({
            content: `✅ Entrance sound set to: **${soundFileName.replace(/\.mp3$/, "")}**`,
          }),
        ],
      });

      return;
    }
  }

  // Handle context menu commands
  if (interaction.isContextMenuCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
});

// Helper function to play entrance sound
async function playEntranceSound(voiceChannel, guildId, userId, userTag) {
  const entranceSound = getEntranceSound(guildId, userId);
  if (!entranceSound) {
    return;
  }

  const fs = require("fs");
  const soundFilePath = `./sounds/${entranceSound}`;

  // Check if sound file exists
  if (!fs.existsSync(soundFilePath)) {
    return;
  }

  try {
    // Check if bot is already in the same channel
    const { getVoiceConnection } = require("@discordjs/voice");
    const existingConnection = getVoiceConnection(guildId);
    const isSameChannel =
      existingConnection && existingConnection.joinConfig.channelId === voiceChannel.id;

    // Make sure bot is in the channel
    // If bot is already in the same channel, don't switch
    // If bot is in a different channel or not connected, switch/join
    const { joinVoiceChannelForGuild } = require("./utils/voiceManager");
    joinVoiceChannelForGuild(voiceChannel, !isSameChannel);

    // Wait a bit longer to ensure connection is ready
    setTimeout(() => {
      try {
        playSound(voiceChannel, soundFilePath, false);
      } catch (error) {
        console.error(`Error playing entrance sound for ${userTag}:`, error);
        // Error is already logged, don't crash
      }
    }, 1000);
  } catch (error) {
    console.error(`Error setting up entrance sound for ${userTag}:`, error);
  }
}

// Handle voice state updates
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    // Ignore bot users
    if (newState.member && newState.member.user.bot) {
      return;
    }

    const guild = newState.guild;
    const member = newState.member;

    // User joined a voice channel (from no channel)
    if (!oldState.channel && newState.channel) {
      // Check if bot is already connected to a voice channel in this guild
      if (!isConnected(guild)) {
        // Auto-join the user's voice channel
        try {
          const { joinVoiceChannelForGuild } = require("./utils/voiceManager");
          joinVoiceChannelForGuild(newState.channel, false);
        } catch (error) {
          console.error("Error auto-joining voice channel:", error);
        }
      }

      // Play entrance sound if user has one set
      await playEntranceSound(newState.channel, guild.id, member.user.id, member.user.tag);
    }
    // User switched channels (was in one channel, now in another)
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
      // Check if bot should leave (if alone in old channel)
      leaveIfAlone(guild, 2000);

      // Play entrance sound if user has one set (bot should join/switch to new channel)
      await playEntranceSound(newState.channel, guild.id, member.user.id, member.user.tag);
    }
    // User left a voice channel
    else if (oldState.channel && !newState.channel) {
      // Check if bot should leave (if alone)
      leaveIfAlone(guild, 2000);
    }
  } catch (error) {
    console.error("Error in voice state update handler:", error);
  }
});

// Log in to Discord with your client's token
if (!token) {
  console.error(
    "ERROR: Bot token is missing! Please check your .env file and make sure TOKEN is set.",
  );
  process.exit(1);
}

client.login(token).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
