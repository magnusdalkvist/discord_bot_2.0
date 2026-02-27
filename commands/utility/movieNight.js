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

/**
 * Resolve a movie from an IMDb URL or a search query (movie name).
 * @param {string} imdbUrlOrName - Either an IMDb title URL or a movie name to search
 * @returns {Promise<{ok: true, movieId: string, movieData: object}|{ok: false, error: string}>}
 */
async function resolveMovieFromInput(imdbUrlOrName) {
  const trimmed = (imdbUrlOrName || "").trim();
  if (!trimmed) {
    return { ok: false, error: "empty" };
  }

  const imdbUrlRegex = /https?:\/\/(?:www\.)?imdb\.com\/title\/(tt\d+)/i;
  const movieIdMatch = trimmed.match(imdbUrlRegex);

  let movieId;
  let movieData;

  if (movieIdMatch) {
    movieId = movieIdMatch[1];
    const movieRequest = await fetch(`https://api.imdbapi.dev/titles/${movieId}`);
    movieData = await movieRequest.json();
  } else {
    const searchRequest = await fetch(
      `https://api.imdbapi.dev/search/titles?query=${encodeURIComponent(trimmed)}`,
    );
    const searchResponse = await searchRequest.json();
    const titles = searchResponse.titles || [];
    const firstMovie = titles.find((t) => t.type === "movie") || titles[0];
    if (!firstMovie || !firstMovie.id) {
      return { ok: false, error: "no_search_result" };
    }
    movieId = firstMovie.id;
    const movieRequest = await fetch(`https://api.imdbapi.dev/titles/${movieId}`);
    movieData = await movieRequest.json();
  }

  if (!movieData) {
    return { ok: false, error: "not_found" };
  }
  if (movieData.type !== "movie") {
    return { ok: false, error: "not_movie" };
  }
  return { ok: true, movieId, movieData };
}

/**
 * Build event description and create the scheduled event from IMDB movie data.
 * Mutates movieNightData.pendingEvents and writes movienight.json.
 */
async function createMovieNightEvent(interaction, movieNightData, imdbMovie, movieId) {
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

  let maxPlotLength = 500;
  let formattedPlot = "";
  if (plot) {
    if (plot.length > maxPlotLength) {
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
}

const data = new SlashCommandBuilder()
  .setName("movienight")
  .setDescription("Movie Night commands")
  .addSubcommand((subcommand) =>
    subcommand.setName("vote").setDescription("Create a poll to vote on which movie to watch"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("Starts the movie night")
      .addStringOption((option) =>
        option
          .setName("movie")
          .setDescription("Force a specific movie by name or IMDb URL (skips the poll)"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("suggest")
      .setDescription("Add a movie to the movie night suggestion list")
      .addStringOption((option) =>
        option.setName("imdb_url").setDescription("The IMDB URL of the movie"),
      )
      .addStringOption((option) =>
        option.setName("movie_name").setDescription("Search by movie name"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("undo").setDescription("Undo the last suggestion you made"),
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
          await interaction.reply({
            content: "No movies to vote on.",
            flags: MessageFlags.Ephemeral,
          });
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
        movieNightData.activePollCreatedByUserId = interaction.user.id;
        fs.writeFileSync(movienightPath, JSON.stringify(movieNightData, null, 2));
        break;
      }
      // start the movie night. optionally force a specific movie (name or IMDb URL); otherwise use poll winner.
      case "start": {
        const forceMovie = interaction.options.getString("movie");

        if (forceMovie) {
          // Force path: resolve movie, ensure in list, create event (no poll).
          const result = await resolveMovieFromInput(forceMovie);
          if (!result.ok) {
            const messages = {
              empty: "Provide a movie name or IMDb URL.",
              no_search_result: "No movie found for that search.",
              not_found: "Movie not found.",
              not_movie: "This is not a movie.",
            };
            await interaction.reply({
              content: messages[result.error] || "Could not resolve movie.",
              flags: MessageFlags.Ephemeral,
            });
            break;
          }
          const { movieId, movieData: imdbMovie } = result;
          const existing = movieNightData.movies.find((m) => m.movieId === movieId);
          if (!existing) {
            movieNightData.movies.push({
              movieName: imdbMovie.primaryTitle,
              movieId,
              watched: false,
              suggestedByUserId: interaction.user.id,
            });
          }
          await createMovieNightEvent(interaction, movieNightData, imdbMovie, movieId);
          await interaction.reply({
            content: `Movie night started with **${imdbMovie.primaryTitle}**.`,
            flags: MessageFlags.Ephemeral,
          });
          break;
        }

        // Poll path: only poll creator can start; require active poll.
        if (
          movieNightData.activePollCreatedByUserId &&
          movieNightData.activePollCreatedByUserId !== interaction.user.id
        ) {
          await interaction.reply({
            content: "Only the person who started the vote can start the movie night.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const filteredMovies = movieNightData.movies.filter((movie) => movie.watched === false);
        const message = await interaction.channel.messages.fetch(movieNightData.activePollId);
        const poll = message.poll;
        if (!poll || poll.resultsFinalized) {
          await interaction.reply({
            content: "No active poll found.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }

        await poll.end();
        await interaction.reply({ content: "Ending poll...", flags: MessageFlags.Ephemeral });
        await interaction.deleteReply();

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

        const imdbMovieRequest = await fetch(`https://api.imdbapi.dev/titles/${movieId}`);
        const imdbMovie = await imdbMovieRequest.json();
        if (!imdbMovie) {
          await interaction.reply({ content: "Movie not found.", flags: MessageFlags.Ephemeral });
          break;
        }

        await createMovieNightEvent(interaction, movieNightData, imdbMovie, movieId);
        break;
      }
      case "suggest": {
        const imdbUrl = interaction.options.getString("imdb_url");
        const movieNameQuery = interaction.options.getString("movie_name");

        if (!imdbUrl && !movieNameQuery) {
          await interaction.reply({
            content: "Provide either **imdb_url** or **movie_name**.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        if (imdbUrl && movieNameQuery) {
          await interaction.reply({
            content: "Provide only one of **imdb_url** or **movie_name**, not both.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        if (imdbUrl && !imdbUrl.match(/https?:\/\/(?:www\.)?imdb\.com\/title\/tt\d+/i)) {
          await interaction.reply({
            content: "Invalid IMDB URL.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }

        const result = await resolveMovieFromInput(imdbUrl || movieNameQuery);
        if (!result.ok) {
          const messages = {
            empty: "Provide either **imdb_url** or **movie_name**.",
            no_search_result: "No movie found for that search.",
            not_found: "Movie not found.",
            not_movie: "This is not a movie.",
          };
          await interaction.reply({
            content: messages[result.error] || "Could not resolve movie.",
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const { movieId, movieData } = result;
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
        const movieName = movieData.primaryTitle;
        movieNightData.movies.push({
          movieName,
          movieId,
          watched: false,
          suggestedByUserId: interaction.user.id,
        });
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
            content: "No watched movies yet.",
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
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
      case "undo": {
        // find the last suggestion made by the user that is not watched. then remove that one suggestion from the list.
        const lastSuggestion = movieNightData.movies.filter((m) => m.suggestedByUserId === interaction.user.id && m.watched == false).reverse()[0];
        if (!lastSuggestion) {
          await interaction.reply({ content: "No suggestions to undo.", flags: MessageFlags.Ephemeral });
          break;
        }
        // remove the suggestion from the list
        movieNightData.movies = movieNightData.movies.filter((m) => !(m.movieId === lastSuggestion.movieId && m.suggestedByUserId === interaction.user.id));
        fs.writeFileSync(movienightPath, JSON.stringify(movieNightData, null, 2));
        await interaction.reply({ content: `Suggestion for **${lastSuggestion.movieName}** removed.` });
        break;
      }
    }
  },
};
