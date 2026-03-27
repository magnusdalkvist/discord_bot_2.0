const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { subscribe, unsubscribe, getSubscriptions } = require("../../utils/vcNotifications");

const data = new SlashCommandBuilder()
  .setName("notify")
  .setDescription("Get notified when someone joins a voice channel")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("subscribe")
      .setDescription("Subscribe to a user's voice channel joins")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user you want to be notified about")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("unsubscribe")
      .setDescription("Unsubscribe from a user's voice channel joins")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user you want to stop being notified about")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("List your current voice channel subscriptions"),
  );

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const subscriberUserId = interaction.user.id;

  if (subcommand === "subscribe") {
    const targetUser = interaction.options.getUser("user");

    // Don't allow subscribing to bots
    if (targetUser.bot) {
      await interaction.reply({
        content: "You can't subscribe to a bot!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Verify the target is a member of this guild
    try {
      await interaction.guild.members.fetch(targetUser.id);
    } catch {
      await interaction.reply({
        content: "That user is not a member of this server!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = subscribe(guildId, subscriberUserId, targetUser.id);

    await interaction.reply({
      content: result.success
        ? `🔔 ${result.message} You'll be notified when **${targetUser.displayName}** joins a voice channel.`
        : `❌ ${result.message}`,
      flags: MessageFlags.Ephemeral,
    });
  } else if (subcommand === "unsubscribe") {
    const targetUser = interaction.options.getUser("user");
    const result = unsubscribe(guildId, subscriberUserId, targetUser.id);

    await interaction.reply({
      content: result.success
        ? `🔕 ${result.message} You'll no longer be notified when **${targetUser.displayName}** joins a voice channel.`
        : `❌ ${result.message}`,
      flags: MessageFlags.Ephemeral,
    });
  } else if (subcommand === "list") {
    const targets = getSubscriptions(guildId, subscriberUserId);

    if (targets.length === 0) {
      await interaction.reply({
        content: "You don't have any voice channel subscriptions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Resolve user names
    const lines = [];
    for (const targetId of targets) {
      try {
        const member = await interaction.guild.members.fetch(targetId);
        lines.push(`• **${member.displayName}** (<@${targetId}>)`);
      } catch {
        // Member may have left the server
        lines.push(`• <@${targetId}> *(may have left the server)*`);
      }
    }

    await interaction.reply({
      content: `🔔 **Your voice channel subscriptions:**\n${lines.join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = {
  data,
  execute,
};
