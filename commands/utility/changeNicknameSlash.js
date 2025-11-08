const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require("discord.js");

const data = new SlashCommandBuilder()
  .setName("changenickname")
  .setDescription("Change a user's nickname")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user whose nickname you want to change")
      .setRequired(true)
  );

module.exports = {
  data,
  async execute(interaction) {
    const targetUser = interaction.options.getUser("user");

    const modal = new ModalBuilder()
      .setCustomId(`changeNicknameModal_${targetUser.id}`)
      .setTitle("Change Nickname")
      .setLabelComponents([
        new LabelBuilder()
          .setLabel("New Nickname")
          .setTextInputComponent(
            new TextInputBuilder({
              custom_id: "nickname",
              style: TextInputStyle.Short,
              placeholder: "Enter new nickname (leave empty to remove)",
              required: false,
              max_length: 32,
            })
          ),
      ]);

    await interaction.showModal(modal);
  },
};


