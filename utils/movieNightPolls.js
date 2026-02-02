const fs = require("node:fs");
const path = require("node:path");

const movienightPath = path.join(__dirname, "..", "movienight.json");

async function finalizeRatingPoll(client, guildId, channelId, messageId) {
  const data = JSON.parse(fs.readFileSync(movienightPath, "utf8"));
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
  fs.writeFileSync(movienightPath, JSON.stringify(data, null, 2));
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

module.exports = { scheduleFinalize, movienightPath };
