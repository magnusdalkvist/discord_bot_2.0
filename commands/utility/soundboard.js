const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  LabelBuilder,
  ContainerBuilder,
  ButtonBuilder,
  MessageFlags,
  ButtonStyle,
  ActionRowBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

const data = new SlashCommandBuilder()
  .setName("soundboard")
  .setDescription("Soundboard commands")
  .addSubcommand((subcommand) => subcommand.setName("show").setDescription("show the soundboard"))
  .addSubcommand((subcommand) => subcommand.setName("upload").setDescription("Upload a sound"))
  .addSubcommand((subcommand) =>
    subcommand.setName("entrance").setDescription("Set your entrance sound")
  );

// Helper function to get sorted sound list
function getSortedSounds() {
  const fs = require("fs");
  return fs.readdirSync("./sounds").sort((a, b) => a.localeCompare(b));
}

// Helper function to render entrance sound selection (similar to soundboard but for selecting entrance sound)
async function renderEntranceSoundSelection(interaction, page = 1) {
  const rows = 3;
  const columns = 3;
  const allSounds = getSortedSounds();
  const totalPages = Math.max(1, Math.ceil(allSounds.length / (rows * columns)));

  // Ensure page is within valid range
  page = Math.max(1, Math.min(page, totalPages));

  const sounds = allSounds.slice((page - 1) * rows * columns, page * rows * columns);

  const actionRows = [];
  for (let row = 0; row < rows; row++) {
    const buttons = [];
    for (let col = 0; col < columns; col++) {
      const soundIdx = row * columns + col;
      const sound = sounds[soundIdx];
      if (!sound) {
        continue;
      }
      const soundName = sound.replace(/\.mp3$/, "");
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`set_entrance_${(page - 1) * rows * columns + soundIdx}`)
          .setLabel(soundName)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    // Wrap the 3 buttons in an ActionRowBuilder
    if (buttons.length > 0) {
      actionRows.push(new ActionRowBuilder().addComponents(buttons));
    }
  }

  const Title = new TextDisplayBuilder({
    content: "# Select Entrance Sound",
  });

  const separator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small,
    divider: false,
  });

  const soundsContainer = new ContainerBuilder()
    .addTextDisplayComponents(Title)
    .addSeparatorComponents(separator)
    .addActionRowComponents(actionRows);

  const paginationButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`entrance_previous_page_${page}`)
      .setLabel("←")
      .setStyle(page === 1 ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(page === 1),
    new ButtonBuilder()
      .setCustomId(`entrance_page_number_${page}`)
      .setLabel(`${page} / ${totalPages}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`entrance_next_page_${page}`)
      .setLabel("→")
      .setStyle(page === totalPages ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(page === totalPages)
  );

  return {
    components: [soundsContainer, paginationButtons],
    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
  };
}

// Helper function to render the soundboard for a given page
async function renderSoundboard(interaction, page = 1) {
  const fs = require("fs");
  const rows = 3;
  const columns = 3;
  const allSounds = getSortedSounds();
  const totalPages = Math.max(1, Math.ceil(allSounds.length / (rows * columns)));

  // Ensure page is within valid range
  page = Math.max(1, Math.min(page, totalPages));

  const sounds = allSounds.slice((page - 1) * rows * columns, page * rows * columns);

  const actionRows = [];
  for (let row = 0; row < rows; row++) {
    const buttons = [];
    for (let col = 0; col < columns; col++) {
      const soundIdx = row * columns + col;
      const sound = sounds[soundIdx];
      if (!sound) {
        continue;
      }
      const soundName = sound.replace(/\.mp3$/, "");
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`play_sound_${(page - 1) * rows * columns + soundIdx}`)
          .setLabel(soundName)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    // Wrap the 3 buttons in an ActionRowBuilder
    if (buttons.length > 0) {
      actionRows.push(new ActionRowBuilder().addComponents(buttons));
    }
  }

  const Title = new TextDisplayBuilder({
    content: "# Soundboard",
  });

  const separator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small,
    divider: false,
  });

  const soundsContainer = new ContainerBuilder()
    .addTextDisplayComponents(Title)
    .addSeparatorComponents(separator)
    .addActionRowComponents(actionRows);

  const paginationButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`previous_page_${page}`)
      // left arrow text
      .setLabel("←")
      .setStyle(page === 1 ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(page === 1),
    new ButtonBuilder()
      .setCustomId(`page_number_${page}`)
      .setLabel(`${page} / ${totalPages}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`next_page_${page}`)
      .setLabel("→")
      .setStyle(page === totalPages ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(page === totalPages)
  );

  return {
    components: [soundsContainer, paginationButtons],
    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
  };
}

module.exports = {
  data,
  renderSoundboard,
  renderEntranceSoundSelection,
  getSortedSounds,
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "upload": {
        const modal = new ModalBuilder()
          .setCustomId("uploadSoundModal")
          .setTitle("Upload Sound")
          .setLabelComponents([
            new LabelBuilder().setLabel("Sound Name").setTextInputComponent(
              new TextInputBuilder({
                custom_id: "sound_name",
                style: TextInputStyle.Short,
                placeholder: "Enter a name for the sound",
                required: true,
                max_length: 20,
              })
            ),
            new LabelBuilder().setLabel("Sound File").setFileUploadComponent(
              new FileUploadBuilder({
                custom_id: "sound_file",
                min_values: 1,
                max_values: 1,
              }).setRequired()
            ),
            new LabelBuilder().setLabel("Set as entrance").setStringSelectMenuComponent(
              new StringSelectMenuBuilder()
                .setCustomId("set_as_entrance")
                .setPlaceholder("Select an option")
                .addOptions([
                  new StringSelectMenuOptionBuilder()
                    .setLabel("No")
                    .setValue("no")
                    .setDefault(true),
                  new StringSelectMenuOptionBuilder().setLabel("Yes").setValue("yes"),
                ])
            ),
          ]);

        await interaction.showModal(modal);
        break;
      }
      case "show": {
        const response = await renderSoundboard(interaction, 1);
        await interaction.reply(response);
        break;
      }
      case "entrance": {
        const response = await renderEntranceSoundSelection(interaction, 1);
        await interaction.reply(response);
        break;
      }
    }
  },
};
