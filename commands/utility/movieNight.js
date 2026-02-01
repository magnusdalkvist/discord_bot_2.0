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
  Poll,
} = require("discord.js");

const fs = require("fs");

const getMovieNightData = () => {
  return JSON.parse(fs.readFileSync("movienight.json", "utf8"));
};

const data = new SlashCommandBuilder()
  .setName("movienight")
  .setDescription("Movie Night commands")
  .addSubcommand((subcommand) =>
    subcommand.setName("create").setDescription("Create a poll for the movie night"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("start").setDescription("Starts the movie night"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("suggest").setDescription("Add a movie to the movie night suggestion list"),
  );

module.exports = {
  data,
  async execute(interaction) {
    const movieNightData = getMovieNightData();
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      // create a poll for the movie night. The poll should have a title, description, and a list of options. The options should be the movies in the movieNightData.movies array. The poll should be a standard discord poll. the poll should be created in the channel the command was used in. the poll should be multiple choice.
      case "create": {
        const reply = await interaction.reply({
          poll: {
            allowMultiselect: true,
            answers: movieNightData.movies.map((movie) => ({ text: movie.movieName })),
            duration: 1,
            question: { text: "What movie should we watch?" },
          },
        });
        // save the poll id to the movieNightData.nights array.
        movieNightData.activePollId = reply.id;
        fs.writeFileSync("movienight.json", JSON.stringify(movieNightData, null, 2));
        break;
      }
      // start the movie night. find the last sent poll and end the poll. then create an event for the selected movie from the poll results.
      case "start": {
        const messages = await interaction.channel.messages.fetch({
          id: movieNightData.activePollId,
        });
        const message = Array.from(messages.values())[0];
        const poll = message.poll;
        if (!poll) {
          await interaction.reply({ content: "No poll found.", ephemeral: true });
          break;
        }
        if (poll.resultsFinalized) {
          await interaction.reply({ content: "Poll already finalized.", ephemeral: true });
          break;
        }

        
        await interaction.reply({ content: "Ending poll...", ephemeral: true });
        try {
          await poll.end();
        } catch (error) {
          await interaction.reply({ content: "Error ending poll.", ephemeral: true });
          break;
        }
        await interaction.deleteReply();

        // Find the poll answer with the most votes
        let winningAnswer = null;
        let maxVotes = -1;

        for (const answer of poll.answers.values()) {
          if (answer.voteCount > maxVotes) {
            maxVotes = answer.voteCount;
            winningAnswer = answer;
          }
        }

        // TODO: create an event for the selected movie.

        break;
      }
      // add a movie to the movie night suggestion list. (movieNightData.movies). Add a modal to add a movie to the suggestion list. The modal should have a text input for the movie name and a button to add the movie to the suggestion list.
      case "suggest": {
        const modal = new ModalBuilder()
          .setCustomId("movieNightSuggestionModal")
          .setTitle("Movie Night Suggestion")
          .setLabelComponents([
            new LabelBuilder().setLabel("Movie Name").setTextInputComponent(
              new TextInputBuilder({
                custom_id: "movieName",
                style: TextInputStyle.Short,
                placeholder: "Enter the movie name",
                required: true,
                max_length: 100,
              }),
            ),
          ]);
        await interaction.showModal(modal);
        break;
      }
    }
  },
};
