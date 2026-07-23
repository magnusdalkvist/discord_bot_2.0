require("dotenv/config");

module.exports = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  toggleRoleId: process.env.TOGGLE_ROLE_ID,
  tmdbApiKey: process.env.TMDB_API_KEY,
};
