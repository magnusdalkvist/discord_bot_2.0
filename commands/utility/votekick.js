const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const VOTE_THRESHOLD_PERCENT = 60;
const VOTE_DURATION_MS = 3 * 60 * 1000;
const MIN_ELIGIBLE_VOTERS = 2;

const activeVotes = new Map();

const data = new SlashCommandBuilder()
  .setName("votekick")
  .setDescription("Start a vote to disconnect someone from your voice channel")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user you want to vote-kick from voice chat")
      .setRequired(true),
  );

function getRequiredYesVotes(eligibleVoterIds) {
  return Math.max(1, Math.ceil(eligibleVoterIds.size * (VOTE_THRESHOLD_PERCENT / 100)));
}

function buildVoteComponents(vote, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("votekick_yes")
        .setLabel(`Yes (${vote.yesVoterIds.size})`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("votekick_no")
        .setLabel(`No (${vote.noVoterIds.size})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

function buildVoteContent(vote) {
  const votesNeededLine = `Votes needed to pass: ${vote.requiredYesVotes}`;

  if (vote.status === "active") {
    return [
      `**Vote kick in progress**`,
      `Target: <@${vote.targetUserId}>`,
      `Voice channel: <#${vote.voiceChannelId}>`,
      votesNeededLine,
      `Voting ends: <t:${Math.floor(vote.expiresAt / 1000)}:R>`,
    ].join("\n");
  }

  if (vote.status === "passed") {
    return [
      `**Vote kick passed**`,
      `<@${vote.targetUserId}> was disconnected from <#${vote.voiceChannelId}>.`,
      votesNeededLine,
    ].join("\n");
  }

  if (vote.status === "cancelled") {
    return [
      `**Vote kick cancelled**`,
      vote.cancelReason,
    ].join("\n");
  }

  return [
    `**Vote kick failed**`,
    `<@${vote.targetUserId}> stayed in the voice channel.`,
    votesNeededLine,
  ].join("\n");
}

function getActiveVoteForTarget(guildId, targetUserId) {
  for (const vote of activeVotes.values()) {
    if (vote.guildId === guildId && vote.targetUserId === targetUserId && vote.status === "active") {
      return vote;
    }
  }

  return null;
}

function removeVote(messageId) {
  const vote = activeVotes.get(messageId);
  if (!vote) {
    return null;
  }

  clearTimeout(vote.timeoutId);
  activeVotes.delete(messageId);
  return vote;
}

async function finalizeVote(vote, status, cancelReason = null) {
  vote.status = status;
  vote.cancelReason = cancelReason;
  removeVote(vote.messageId);
  await vote.message.edit({
    content: buildVoteContent(vote),
    components: buildVoteComponents(vote, true),
  });
}

async function cancelVoteIfTargetLeft(interaction, vote) {
  const targetMember = await interaction.guild.members.fetch(vote.targetUserId);
  if (targetMember.voice.channelId === vote.voiceChannelId) {
    return false;
  }

  await finalizeVote(
    vote,
    "cancelled",
    `<@${vote.targetUserId}> is no longer in <#${vote.voiceChannelId}>.`,
  );
  return true;
}

async function passVote(interaction, vote) {
  const targetMember = await interaction.guild.members.fetch(vote.targetUserId);

  if (targetMember.voice.channelId !== vote.voiceChannelId) {
    await finalizeVote(
      vote,
      "cancelled",
      `<@${vote.targetUserId}> is no longer in <#${vote.voiceChannelId}>.`,
    );
    return;
  }

  await targetMember.voice.disconnect("Vote kick passed");
  await finalizeVote(vote, "passed");
}

async function execute(interaction) {
  const targetUser = interaction.options.getUser("user");

  if (targetUser.bot) {
    await interaction.reply({
      content: "You can't start a vote kick against a bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      content: "You can't start a vote kick against yourself.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member;
  const callerVoiceChannel = member.voice?.channel;
  if (!callerVoiceChannel) {
    await interaction.reply({
      content: "You need to be in a voice channel to start a vote kick.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({
      content: "That user is not a member of this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetMember.voice.channelId !== callerVoiceChannel.id) {
    await interaction.reply({
      content: "You can only vote kick someone who is in your current voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await interaction.reply({
      content: "I need the Move Members permission to disconnect someone from voice chat.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingVote = getActiveVoteForTarget(interaction.guild.id, targetUser.id);
  if (existingVote) {
    await interaction.reply({
      content: `There is already an active vote kick for <@${targetUser.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const eligibleVoterIds = new Set(
    callerVoiceChannel.members
      .filter((voiceMember) => !voiceMember.user.bot && voiceMember.id !== targetUser.id)
      .map((voiceMember) => voiceMember.id),
  );

  if (!eligibleVoterIds.has(interaction.user.id)) {
    await interaction.reply({
      content: "You need to be an eligible voter in that voice channel to start a vote kick.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (eligibleVoterIds.size < MIN_ELIGIBLE_VOTERS) {
    await interaction.reply({
      content: `At least ${MIN_ELIGIBLE_VOTERS} eligible non-bot voters are required to start a vote kick.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const vote = {
    guildId: interaction.guild.id,
    voiceChannelId: callerVoiceChannel.id,
    targetUserId: targetUser.id,
    eligibleVoterIds,
    yesVoterIds: new Set([interaction.user.id]),
    noVoterIds: new Set(),
    requiredYesVotes: getRequiredYesVotes(eligibleVoterIds),
    expiresAt: Date.now() + VOTE_DURATION_MS,
    status: "active",
    messageId: null,
    message: null,
    timeoutId: null,
    cancelReason: null,
  };

  await interaction.reply({
    content: buildVoteContent(vote),
    components: buildVoteComponents(vote),
  });

  const message = await interaction.fetchReply();
  vote.messageId = message.id;
  vote.message = message;
  vote.timeoutId = setTimeout(async () => {
    const activeVote = activeVotes.get(message.id);
    if (!activeVote) {
      return;
    }

    try {
      await finalizeVote(activeVote, "failed");
    } catch (error) {
      console.error("Error finalizing expired vote kick:", error);
    }
  }, VOTE_DURATION_MS);

  activeVotes.set(message.id, vote);

  if (vote.yesVoterIds.size >= vote.requiredYesVotes) {
    try {
      await passVote(interaction, vote);
    } catch (error) {
      console.error("Error applying vote kick:", error);
      await finalizeVote(vote, "cancelled", `Vote passed, but I couldn't disconnect <@${vote.targetUserId}>.`);
    }
  }
}

async function handleVoteButton(interaction) {
  const vote = activeVotes.get(interaction.message.id);
  if (!vote || vote.status !== "active") {
    await interaction.reply({
      content: "That vote kick is no longer active.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!vote.eligibleVoterIds.has(interaction.user.id)) {
    await interaction.reply({
      content: "Only non-bot members in that voice channel can vote.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    if (await cancelVoteIfTargetLeft(interaction, vote)) {
      return;
    }

    vote.yesVoterIds.delete(interaction.user.id);
    vote.noVoterIds.delete(interaction.user.id);

    if (interaction.customId === "votekick_yes") {
      vote.yesVoterIds.add(interaction.user.id);
    } else {
      vote.noVoterIds.add(interaction.user.id);
    }

    if (vote.yesVoterIds.size >= vote.requiredYesVotes) {
      await passVote(interaction, vote);
      return;
    }

    await interaction.message.edit({
      content: buildVoteContent(vote),
      components: buildVoteComponents(vote),
    });
  } catch (error) {
    console.error("Error handling vote kick button:", error);

    if (activeVotes.has(interaction.message.id)) {
      await interaction.message.edit({
        content: buildVoteContent(vote),
        components: buildVoteComponents(vote),
      }).catch(() => null);
    }
  }
}

module.exports = {
  data,
  execute,
  handleVoteButton,
};