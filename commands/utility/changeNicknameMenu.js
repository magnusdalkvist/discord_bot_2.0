const { ContextMenuCommandBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } = require("discord.js");

const data = new ContextMenuCommandBuilder()
  .setName("Change Nickname")
  .setType(ApplicationCommandType.User);

module.exports = {
  data,
  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId(`changeNicknameModal_${interaction.targetUser.id}`)
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


