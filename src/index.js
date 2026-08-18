const path = require('path');
const express = require('express');
const { PORT, INTERVALO_CURRENTLY_MS, INTERVALO_HISTORIAL_MS } = require('./config');
const { router: authRouter } = require('./spotifyAuth');
const chartsApiRouter = require('./chartsApi');
const db = require('./db');
const {
  pollCurrentlyPlaying,
  pollRecentlyPlayed,
  completarImagenesDeArtistas,
  obtenerUsuariosActivos
} = require('./poller');

const app = express();

// Red de seguridad: si algo se escapa sin capturar, lo logueamos
// pero NO dejamos que tumbe el servidor entero.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.use(authRouter);
app.use('/api', chartsApiRouter);
// ------------------------------------------------------------
// GET /health — para el monitor de uptime. Chequea que el servidor
// responda Y que la base de datos esté realmente accesible (no solo
// que Express esté vivo), que es la falla más probable en este proyecto.
// ------------------------------------------------------------
app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

// ------------------------------------------------------------
// Ciclo de polling: currently-playing (frecuente, para el widget en vivo)
// Envuelto en try/catch para que un error de red o de base de datos
// no tumbe todo el proceso — solo se saltea ese ciclo y reintenta
// en el próximo intervalo.
// ------------------------------------------------------------
setInterval(async () => {
  try {
    const usuarios = await obtenerUsuariosActivos();
    for (const usuario of usuarios) {
      await pollCurrentlyPlaying(usuario);
    }
  } catch (err) {
    console.error('[ciclo currently-playing] Error:', err.message);
  }
}, INTERVALO_CURRENTLY_MS);

// ------------------------------------------------------------
// Ciclo de polling: recently-played (menos frecuente, historial real)
// ------------------------------------------------------------
setInterval(async () => {
  try {
    const usuarios = await obtenerUsuariosActivos();
    for (const usuario of usuarios) {
      await pollRecentlyPlayed(usuario);
    }
    // Con cualquier cuenta activa alcanza para pedirle a Spotify
    // las fotos de artistas que todavía falten
    if (usuarios.length) {
      await completarImagenesDeArtistas(usuarios[0]);
    }
  } catch (err) {
    console.error('[ciclo recently-played] Error:', err.message);
  }
}, INTERVALO_HISTORIAL_MS);

console.log('Workers de polling programados.');