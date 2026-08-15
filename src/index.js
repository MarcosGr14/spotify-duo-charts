const path = require('path');
const express = require('express');
const { PORT, INTERVALO_CURRENTLY_MS, INTERVALO_HISTORIAL_MS } = require('./config');
const { router: authRouter } = require('./spotifyAuth');
const chartsApiRouter = require('./chartsApi');
const {
  pollCurrentlyPlaying,
  pollRecentlyPlayed,
  obtenerUsuariosActivos
} = require('./poller');

const app = express();
app.use(authRouter);
app.use('/api', chartsApiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Escuchamos explícitamente en 127.0.0.1 (no en localhost) para que
// coincida siempre con el redirect_uri registrado en Spotify.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Servidor escuchando en http://127.0.0.1:${PORT}`);
});

// ------------------------------------------------------------
// Ciclo de polling: currently-playing (frecuente, para el widget en vivo)
// ------------------------------------------------------------
setInterval(async () => {
  const usuarios = await obtenerUsuariosActivos();
  for (const usuario of usuarios) {
    await pollCurrentlyPlaying(usuario);
  }
}, INTERVALO_CURRENTLY_MS);

// ------------------------------------------------------------
// Ciclo de polling: recently-played (menos frecuente, historial real)
// ------------------------------------------------------------
setInterval(async () => {
  const usuarios = await obtenerUsuariosActivos();
  for (const usuario of usuarios) {
    await pollRecentlyPlayed(usuario);
  }
}, INTERVALO_HISTORIAL_MS);

console.log('Workers de polling programados.');
