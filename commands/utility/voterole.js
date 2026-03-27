const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const { toggleRoleId } = require("../../config");

const VOTE_THRESHOLD_PERCENT = 60;
const VOTE_DURATION_MS = 3 * 60 * 1000;
const MIN_ELIGIBLE_VOTERS = 2;

const activeVotes = new Map();

const data = new SlashCommandBuilder()
  .setName("voterole")
  .setDescription("Start a vote to add or remove a role from a user")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user to toggle the role for")
      .setRequired(true),
  );

function getRequiredYesVotes(eligibleVoterIds) {
  return Math.max(1, Math.ceil(eligibleVoterIds.size * (VOTE_THRESHOLD_PERCENT / 100)));
}

function getVoteKey(guildId, targetUserId, roleId) {
  return `${guildId}:${targetUserId}:${roleId}`;
}

function buildVoteComponents(vote, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("voterole_yes")
        .setLabel(`Yes (${vote.yesVoterIds.size})`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("voterole_no")
        .setLabel(`No (${vote.noVoterIds.size})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

function buildVoteContent(vote) {
  const actionVerb = vote.action === "remove" ? "remove" : "add";
  const actionPastTense = vote.action === "remove" ? "removed" : "added";
  const actionNoun = vote.action === "remove" ? "removal" : "restore";
  const votesNeededLine = `Votes needed to pass: ${vote.requiredYesVotes}`;

  if (vote.status === "active") {
    return [
      `**Role ${actionNoun} vote in progress**`,
      `Target user: <@${vote.targetUserId}>`,
      `Role to ${actionVerb}: <@&${vote.roleId}>`,
      votesNeededLine,
      `Voting ends: <t:${Math.floor(vote.expiresAt / 1000)}:R>`,
    ].join("\n");
  }

  if (vote.status === "passed") {
    return [
      `**Role ${actionNoun} vote passed**`,
      `${actionPastTense.charAt(0).toUpperCase() + actionPastTense.slice(1)} <@&${vote.roleId}> ${
        vote.action === "remove" ? "from" : "to"
      } <@${vote.targetUserId}>.`,
      votesNeededLine,
    ].join("\n");
  }

  if (vote.status === "cancelled") {
    return [
      `**Role ${actionNoun} vote cancelled**`,
      vote.cancelReason,
    ].join("\n");
  }

  return [
    `**Role ${actionNoun} vote failed**`,
    `<@&${vote.roleId}> was not ${actionPastTense} ${vote.action === "remove" ? "from" : "to"} <@${
      vote.targetUserId
    }>.`,
    votesNeededLine,
  ].join("\n");
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

async function cancelVoteIfStateChanged(interaction, vote) {
  const guild = interaction.guild;
  const targetMember = await guild.members.fetch(vote.targetUserId).catch(() => null);
  if (!targetMember) {
    await finalizeVote(vote, "cancelled", "Target user is no longer in this server.");
    return true;
  }

  const hasRole = targetMember.roles.cache.has(vote.roleId);
  if (vote.action === "remove" && !hasRole) {
    await finalizeVote(vote, "cancelled", `<@${vote.targetUserId}> no longer has <@&${vote.roleId}>.`);
    return true;
  }

  if (vote.action === "add" && hasRole) {
    await finalizeVote(vote, "cancelled", `<@${vote.targetUserId}> already has <@&${vote.roleId}>.`);
    return true;
  }

  const role = guild.roles.cache.get(vote.roleId);
  if (!role || !role.editable) {
    await finalizeVote(
      vote,
      "cancelled",
      `I can no longer manage <@&${vote.roleId}> due to permission or role hierarchy limits.`,
    );
    return true;
  }

  return false;
}

async function passVote(interaction, vote) {
  const guild = interaction.guild;
  const targetMember = await guild.members.fetch(vote.targetUserId).catch(() => null);
  const role = guild.roles.cache.get(vote.roleId);

  if (!targetMember) {
    await finalizeVote(vote, "cancelled", "Target user is no longer in this server.");
    return;
  }

  const hasRole = targetMember.roles.cache.has(vote.roleId);
  if (vote.action === "remove" && !hasRole) {
    await finalizeVote(vote, "cancelled", `<@${vote.targetUserId}> no longer has <@&${vote.roleId}>.`);
    return;
  }

  if (vote.action === "add" && hasRole) {
    await finalizeVote(vote, "cancelled", `<@${vote.targetUserId}> already has <@&${vote.roleId}>.`);
    return;
  }

  if (!role || !role.editable) {
    await finalizeVote(
      vote,
      "cancelled",
      `I can no longer manage <@&${vote.roleId}> due to permission or role hierarchy limits.`,
    );
    return;
  }

  if (vote.action === "remove") {
    await targetMember.roles.remove(vote.roleId, "Role removal vote passed");
  } else {
    await targetMember.roles.add(vote.roleId, "Role restore vote passed");
  }
  await finalizeVote(vote, "passed");
}

async function execute(interaction) {
  const targetUser = interaction.options.getUser("user");

  await interaction.deferReply();

  try {
    if (!toggleRoleId) {
      await interaction.editReply({
        content: "Role vote is not configured. Set TOGGLE_ROLE_ID in your environment.",
      });
      return;
    }

    if (targetUser.bot) {
      await interaction.editReply({
        content: "You cannot start this vote against a bot.",
      });
      return;
    }

    if (targetUser.id === interaction.user.id) {
      await interaction.editReply({
        content: "You cannot start this vote against yourself.",
      });
      return;
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply({
        content: "I need Manage Roles permission to add or remove roles.",
      });
      return;
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.editReply({
        content: "That user is not a member of this server.",
      });
      return;
    }

    const role = await interaction.guild.roles.fetch(toggleRoleId).catch(() => null);
    if (!role) {
      await interaction.editReply({
        content: "Configured TOGGLE_ROLE_ID was not found in this server.",
      });
      return;
    }

    if (role.id === interaction.guild.id) {
      await interaction.editReply({
        content: "You cannot change the @everyone role.",
      });
      return;
    }

    const action = targetMember.roles.cache.has(role.id) ? "remove" : "add";

    if (!role.editable) {
      await interaction.editReply({
        content: "I cannot change that role due to role hierarchy or permissions.",
      });
      return;
    }

    const voteKey = getVoteKey(interaction.guild.id, targetUser.id, role.id);
    const existingVote = [...activeVotes.values()].find((vote) => vote.voteKey === voteKey);
    if (existingVote) {
      await interaction.editReply({
        content: `There is already an active vote for ${role.name} on <@${targetUser.id}>.`,
      });
      return;
    }

    const eligibleMembers = role.members.filter(
      (member) => !member.user.bot && member.id !== targetUser.id,
    );
    const eligibleVoterIds = new Set(eligibleMembers.keys());

    if (!eligibleVoterIds.has(interaction.user.id)) {
      await interaction.editReply({
        content: `Only members with the ${role.name} role can start this vote.`,
      });
      return;
    }

    if (eligibleVoterIds.size < MIN_ELIGIBLE_VOTERS) {
      await interaction.editReply({
        content: `At least ${MIN_ELIGIBLE_VOTERS} eligible voters are required to start this role vote.`,
      });
      return;
    }

    const vote = {
      voteKey,
      action,
      guildId: interaction.guild.id,
      targetUserId: targetUser.id,
      roleId: role.id,
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

    await interaction.editReply({
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
        console.error("Error finalizing expired role vote:", error);
      }
    }, VOTE_DURATION_MS);

    activeVotes.set(message.id, vote);

    if (vote.yesVoterIds.size >= vote.requiredYesVotes) {
      try {
        await passVote(interaction, vote);
      } catch (error) {
        console.error("Error applying role removal vote:", error);
        await finalizeVote(
          vote,
          "cancelled",
          `Vote passed, but I could not ${vote.action} <@&${vote.roleId}> ${
            vote.action === "remove" ? "from" : "to"
          } <@${vote.targetUserId}>.`,
        );
      }
    }
  } catch (error) {
    console.error("Error executing voterole:", error);
    await interaction.editReply({
      content: "There was an error while starting this role vote.",
      components: [],
    }).catch(() => null);
  }
}

async function handleVoteButton(interaction) {
  const vote = activeVotes.get(interaction.message.id);
  if (!vote || vote.status !== "active") {
    await interaction.reply({
      content: "That role vote is no longer active.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!vote.eligibleVoterIds.has(interaction.user.id)) {
    await interaction.reply({
      content: "Only members with that role can vote.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    if (await cancelVoteIfStateChanged(interaction, vote)) {
      return;
    }

    vote.yesVoterIds.delete(interaction.user.id);
    vote.noVoterIds.delete(interaction.user.id);

    if (interaction.customId === "voterole_yes") {
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
    console.error("Error handling role vote button:", error);

    if (activeVotes.has(interaction.message.id)) {
      await interaction.message
        .edit({
          content: buildVoteContent(vote),
          components: buildVoteComponents(vote),
        })
        .catch(() => null);
    }
  }
}

module.exports = {
  data,
  execute,
  handleVoteButton,
};