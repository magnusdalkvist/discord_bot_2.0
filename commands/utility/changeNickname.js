const {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
} = require("discord.js");

const slashData = new SlashCommandBuilder()
  .setName("nick")
  .setDescription("Change a user's nickname")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user whose nickname you want to change")
      .setRequired(true),
  );

const menuData = new ContextMenuCommandBuilder()
  .setName("Change nickname")
  .setType(ApplicationCommandType.User);

function buildModal(customId, title = "Change nickname") {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .setLabelComponents([
      new LabelBuilder().setLabel("New Nickname").setTextInputComponent(
        new TextInputBuilder({
          custom_id: "nickname",
          style: TextInputStyle.Short,
          placeholder: "Enter new nickname (leave empty to remove)",
          required: false,
          max_length: 32,
        }),
      ),
    ]);
}

module.exports = [
  {
    data: slashData,
    async execute(interaction) {
      const targetUser = interaction.options.getUser("user");
      const modal = buildModal(`changeNicknameModal_${targetUser.id}`);
      await interaction.showModal(modal);
    },
  },
  {
    data: menuData,
    async execute(interaction) {
      const modal = buildModal(`changeNicknameModal_${interaction.targetUser.id}`);
      await interaction.showModal(modal);
    },
  },
];
