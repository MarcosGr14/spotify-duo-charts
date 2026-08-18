require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  // Cada cuántos ms se consulta "currently-playing" (widget en vivo)
  INTERVALO_CURRENTLY_MS: 20 * 1000,
  // Cada cuántos ms se consulta "recently-played" (historial real para los charts)
  INTERVALO_HISTORIAL_MS: 5 * 60 * 1000
};
