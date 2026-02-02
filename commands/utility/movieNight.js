const {
  SlashCommandBuilder,
  GuildScheduledEventManager,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const { scheduleFinalize } = require("../../utils/movieNightPolls");

const movienightPath = path.join(__dirname, "../../movienight.json");

const getMovieNightData = () => {
  return JSON.parse(fs.readFileSync(movienightPath, "utf8"));
};

const getSecondsFromNow = (seconds) => {
  return Date.now() + seconds * 1000;
};

const data = new SlashCommandBuilder()
  .setName("movienight")
  .setDescription("Movie Night commands")
  .addSubcommand((subcommand) =>
    subcommand.setName("vote").setDescription("Create a poll to vote on which movie to watch"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("start").setDescription("Starts the movie night"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("suggest")
      .setDescription("Add a movie to the movie night suggestion list")
      .addStringOption((option) =>
        option
          .setName("imdb_url")
          .setDescription("The IMDB URL of the movie"),
      )
      .addStringOption((option) =>
        option
          .setName("movie_name")
          .setDescription("Search by movie name"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("history").setDescription("Show last watched movies and our ratings"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("rate")
      .setDescription("Create a rating poll for the most recent night that has no rating yet"),
  );

module.exports = {
  data,
  async execute(interaction) {
    const movieNightData = getMovieNightData();
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      // Create a poll to vote on which movie to watch. Discord allows max 10 options; shuffle when more so it varies each time.
      case "vote": {
        const filteredMovies = movieNightData.movies.filter((movie) => movie.watched === false);
        if (filteredMovies.length === 0) {
          await interaction.reply({ content: "No movies to vote on.", ephemeral: true });
          break;
        }

        const shuffled = [...filteredMovies];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const moviesForPoll = shuffled.slice(0, 10);

        const reply = await interaction.reply({
          fetchReply: true,
          poll: {
            allowMultiselect: true,
            answers: moviesForPoll.map((movie) => ({ text: movie.movieName })),
            duration: 1,
            question: { text: "What movie should we watch?" },
          },
        });

        movieNightData.activePollId = reply.id;
        fs.writeFileSync(movienightPath, JSON.stringify(movieNightData, null, 2));
        break;
      }
      // start the movie night. find the last sent poll and end the poll. then create an event for the selected movie from the poll results.
      case "start": {
        const filteredMovies = movieNightData.movies.filter((movie) => movie.watched === false);
        const messages = await interaction.channel.messages.fetch({
          id: movieNightData.activePollId,
        });
        const message = Array.from(messages.values())[0];
        const poll = message.poll;
        if (!poll || poll.resultsFinalized) {
          await interaction.reply({ content: "No active poll found.", ephemeral: true });
          break;
        }

        await poll.end();
        await interaction.reply({ content: "Ending poll...", ephemeral: true });
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

        const movieId = filteredMovies.find(
          (movie) => movie.movieName === winningAnswer.text,
        )?.movieId;

        try {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await message.delete();
        } catch (err) {
          console.error("Error deleting create poll message:", err);
        }

        // Fetch information about the winning movie from IMDB API
        const imdbMovieRequest = await fetch(`https://api.imdbapi.dev/titles/${movieId}`);
        const imdbMovie = await imdbMovieRequest.json();

        if (!imdbMovie) {
          await interaction.reply({ content: "Movie not found.", ephemeral: true });
          break;
        }

        // Prepare a detailed description from the IMDB movie data
        const {
          primaryTitle,
          startYear,
          runtimeSeconds,
          plot,
          genres,
          rating,
          metacritic,
          directors,
          writers,
          stars,
          originCountries,
          spokenLanguages,
          primaryImage,
        } = imdbMovie;

        // Prepare textual summary
        const directorNames = directors?.map((d) => d.displayName).join(", ") || "N/A";
        const writerNames = writers?.map((w) => w.displayName).join(", ") || "N/A";
        const starNames = stars?.map((s) => s.displayName).join(", ") || "N/A";
        const countryNames = originCountries?.map((c) => c.name).join(", ") || "N/A";
        const languageNames = spokenLanguages?.map((l) => l.name).join(", ") || "N/A";
        const movieGenres = genres?.join(", ") || "N/A";
        const releaseYear = startYear || "N/A";
        const durationMinutes = runtimeSeconds ? Math.floor(runtimeSeconds / 60) : "N/A";
        const imdbRating = rating?.aggregateRating
          ? `${rating.aggregateRating}/10 (${rating.voteCount} votes)`
          : "N/A";
        const metacriticScore = metacritic?.score
          ? `${metacritic.score}/100 (${metacritic.reviewCount} reviews)`
          : "N/A";
        const poster = primaryImage?.url || null;

        // Compose the event description
        // Limit plot to a max length (250 chars) and end with "..." if truncated.
        let maxPlotLength = 500;
        let formattedPlot = "";
        if (plot) {
          if (plot.length > maxPlotLength) {
            // Cut off at last whitespace within limit for cleaner stop
            let trimmed = plot.slice(0, maxPlotLength);
            let lastSpace = trimmed.lastIndexOf(" ");
            let cutoff = lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
            formattedPlot = `${cutoff}...`;
          } else {
            formattedPlot = plot;
          }
        }
        let description = formattedPlot ? `\n*${formattedPlot}*\n\n` : "\n";
        description += `**Genres:** ${movieGenres}\n`;
        description += `**Duration:** ${durationMinutes} minutes\n`;
        description += `**Directors:** ${directorNames}\n`;
        description += `**Writers:** ${writerNames}\n`;
        description += `**Stars:** ${starNames}\n`;
        description += `**Country:** ${countryNames}\n`;
        description += `**Languages:** ${languageNames}\n`;
        description += `**IMDb Rating:** ${imdbRating}\n`;
        description += `**Metacritic:** ${metacriticScore}\n`;

        // Schedule the event in 1 minute, and set end time according to movie length (or +2 hours if not known)
        const startTimestamp = getSecondsFromNow(5);
        const endTimestamp =
          durationMinutes !== "N/A"
            ? startTimestamp + runtimeSeconds * 1000
            : startTimestamp + 2 * 60 * 60 * 1000;

        const event_manager = new GuildScheduledEventManager(interaction.guild);
        const scheduledEvent = await event_manager.create({
          name: `Movie Night: ${primaryTitle} (${releaseYear})`,
          scheduledStartTime: startTimestamp,
          scheduledEndTime: endTimestamp,
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType: GuildScheduledEventEntityType.External,
          entityMetadata: {
            location: "Dalles Filmklub",
          },
          description: description,
          image: poster,
          reason: `Scheduled for Movie Night: ${primaryTitle}`,
        });

        if (!movieNightData.pendingEvents) movieNightData.pendingEvents = {};
        movieNightData.pendingEvents[scheduledEvent.id] = {
          channelId: interaction.channel.id,
          guildId: interaction.guild.id,
          movieId,
          movieName: primaryTitle,
        };
        fs.writeFileSync(movienightPath, JSON.stringify(movieNightData, null, 2));

        break;
      }
      case "suggest": {
        const imdbUrl = interaction.options.getString("imdb_url");
        const movieNameQuery = interaction.options.getString("movie_name");

        if (!imdbUrl && !movieNameQuery) {
          await interaction.reply({
            content: "Provide either **imdb_url** or **movie_name**.",
            ephemeral: true,
          });
          break;
        }
        if (imdbUrl && movieNameQuery) {
          await interaction.reply({
            content: "Provide only one of **imdb_url** or **movie_name**, not both.",
            ephemeral: true,
          });
          break;
        }

        let movieId;
        let movieData;

        if (imdbUrl) {
          if (!imdbUrl.match(/https:\/\/www\.imdb\.com\/title\/tt\d+/)) {
            await interaction.reply({ content: "Invalid IMDB URL.", ephemeral: true });
            break;
          }
          const movieIdMatch = imdbUrl.match(/title\/(tt\d+)/);
          movieId = movieIdMatch ? movieIdMatch[1] : null;
          const movieRequest = await fetch(`https://api.imdbapi.dev/titles/${movieId}`);
          movieData = await movieRequest.json();
        } else {
          const searchRequest = await fetch(
            `https://api.imdbapi.dev/search/titles?query=${encodeURIComponent(movieNameQuery)}`
          );
          const searchResponse = await searchRequest.json();
          const titles = searchResponse.titles || [];
          const firstMovie = titles.find((t) => t.type === "movie") || titles[0];
          if (!firstMovie || !firstMovie.id) {
            await interaction.reply({ content: "No movie found for that search.", ephemeral: true });
            break;
          }
          movieId = firstMovie.id;
          const movieRequest = await fetch(`https://api.imdbapi.dev/titles/${movieId}`);
          movieData = await movieRequest.json();
        }

        if (!movieData) {
          await interaction.reply({ content: "Movie not found.", ephemeral: true });
          break;
        }
        if (movieData.type !== "movie") {
          await interaction.reply({ content: "This is not a movie.", ephemeral: true });
          break;
        }
        if (
          movieNightData.movies.some(
            (movie) => movie.movieId === movieId && movie.watched === false,
          )
        ) {
          await interaction.reply({
            content: "This movie has already been suggested.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const { primaryTitle: movieName } = movieData;

        const existingWatched = movieNightData.movies.find(
          (movie) => movie.movieId === movieId && movie.watched === true,
        );
        if (existingWatched) {
          existingWatched.watched = false;
        } else {
          movieNightData.movies.push({ movieName, movieId, watched: false });
        }
        fs.writeFileSync(movienightPath, JSON.stringify(movieNightData, null, 2));

        const imdbLink = imdbUrl || `https://www.imdb.com/title/${movieId}/`;
        const embed = new EmbedBuilder()
          .setTitle(movieName)
          .setDescription(movieData.plot)
          .setThumbnail(movieData.primaryImage?.url || null)
          .setURL(imdbLink)
          .setFooter({
            text: `IMDB Rating: ${movieData.rating?.aggregateRating}/10 (${movieData.rating?.voteCount} votes)`,
          });
        await interaction.reply({ content: "New movie suggested:", embeds: [embed] });

        break;
      }
      case "history": {
        const movieNights = (movieNightData.nights || [])
          .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
          .slice(0, 15);
        if (movieNights.length === 0) {
          await interaction.reply({
            content: "No watched movies with ratings yet.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const lines = movieNights.map((n, i) => {
          if (n.ratingScore == null || n.ratingVotes == null) {
            return `${i + 1}. **${n.movieName}** — not rated yet`;
          }
          return `${i + 1}. **${n.movieName}** — ${Number(n.ratingScore).toFixed(1)}/10 (${
            n.ratingVotes
          } votes)`;
        });
        const embed = new EmbedBuilder()
          .setTitle("Movie Night history")
          .setDescription(lines.join("\n"))
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }
      case "rate": {
        const nightsWithoutRating = (movieNightData.nights || [])
          .filter((n) => !n.ratingScore || !n.ratingVotes)
          .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
        const night = nightsWithoutRating[0];
        if (!night) {
          await interaction.reply({
            content: "No night without a rating found.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const movieTitle = night.movieName || "the movie";
        const pollMessage = await interaction.reply({
          fetchReply: true,
          poll: {
            question: { text: `How much did you enjoy "${movieTitle}"?` },
            answers: [
              { text: "1" },
              { text: "2" },
              { text: "3" },
              { text: "4" },
              { text: "5" },
              { text: "6" },
              { text: "7" },
              { text: "8" },
              { text: "9" },
              { text: "10" },
            ],
            duration: 1,
            allowMultiselect: false,
          },
        });
        night.ratingPollMessageId = pollMessage.id;
        fs.writeFileSync(movienightPath, JSON.stringify(movieNightData, null, 2));
        scheduleFinalize(interaction.client, night, pollMessage.id);
        break;
      }
    }
  },
};
