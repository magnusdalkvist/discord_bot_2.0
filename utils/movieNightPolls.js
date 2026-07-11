const db = require("./db");

const MOVIENIGHT_KEY = "movienight";

const getStmt = db.prepare("SELECT value FROM kv_store WHERE key = ?");
const setStmt = db.prepare(
  "INSERT INTO kv_store (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

/**
 * Load the movienight data document.
 * @returns {Object}
 */
function loadMovieNightData() {
  const row = getStmt.get(MOVIENIGHT_KEY);
  return row ? JSON.parse(row.value) : {};
}

/**
 * Save the movienight data document.
 * @param {Object} data
 */
function saveMovieNightData(data) {
  setStmt.run(MOVIENIGHT_KEY, JSON.stringify(data));
}

async function finalizeRatingPoll(client, guildId, channelId, messageId) {
  const data = loadMovieNightData();
  const night = (data.nights || []).find((n) => n.ratingPollMessageId === messageId);
  if (!night) return;
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId);
  if (!channel) return;
  let message;
  try {
    message = await channel.messages.fetch(messageId);
  } catch {
    return;
  }
  if (!message.poll) return;
  if (!message.poll.resultsFinalized) {
    try {
      await message.poll.end();
    } catch (err) {
      console.error("Error ending rating poll:", err);
      return;
    }
  }
  const answers = Array.from(message.poll.answers.values()).sort((a, b) => a.id - b.id);
  let totalScore = 0;
  let totalVotes = 0;
  for (let i = 0; i < answers.length; i++) {
    const votes = answers[i].voteCount ?? 0;
    totalScore += (i + 1) * votes;
    totalVotes += votes;
  }
  night.ratingScore = totalVotes > 0 ? totalScore / totalVotes : 0;
  night.ratingVotes = totalVotes;
  const movie = (data.movies || []).find((m) => m.movieId === night.movieId);
  if (movie) movie.watched = true;
  saveMovieNightData(data);
  try {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await message.delete();
  } catch (err) {
    console.error("Error deleting rating poll message:", err);
  }
}

function scheduleFinalize(client, night, messageId) {
  setTimeout(
    () => finalizeRatingPoll(client, night.guildId, night.channelId, messageId),
    1 * 60 * 1000
  );
}

module.exports = { scheduleFinalize, loadMovieNightData, saveMovieNightData };
