// Tiene que ser el primer require de todo el archivo
const Sentry = require('./instrument');

const path = require('path');
const express = require('express');
const { PORT, INTERVALO_CURRENTLY_MS, INTERVALO_HISTORIAL_MS } = require('./config');
const { router: authRouter } = require('./spotifyAuth');
const chartsApiRouter = require('./chartsApi');
const { router: integrationsApiRouter } = require('./integrationsApi');
const db = require('./db');
const {
  pollCurrentlyPlaying,
  pollRecentlyPlayed,
  completarImagenesDeArtistas,
  obtenerUsuariosActivos
} = require('./poller');

const app = express();
const { configureSecurity } = require('./security');
const { programar, registrarVisitante, hayVisitantes } = require('./workers');
configureSecurity(app);
app.use((req, res, next) => {
  if (req.path === '/api/currently-playing') registrarVisitante();
  next();
});

// Tras un error no recuperable, Railway reinicia el proceso limpiamente.
process.on('unhandledRejection', () => { console.error('[fatal] Promesa no controlada'); process.exitCode = 1; shutdown(); });
process.on('uncaughtException', () => { console.error('[fatal] Excepción no controlada'); process.exitCode = 1; shutdown(); });

app.use('/api', (req, res, next) => {
  const start = performance.now();
  const end = res.end;
  res.end = function(...args) {
    if (!res.headersSent) res.set('Server-Timing', `app;dur=${(performance.now()-start).toFixed(1)}`);
    return end.apply(this,args);
  };
  next();
});
app.use(authRouter);
app.use('/api', require('./responseCache').responseCache, chartsApiRouter);
app.use('/api/integrations', integrationsApiRouter);
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
    res.status(503).json({ status: 'error', db: 'disconnected', error: 'Servicio temporalmente no disponible' });
  }
});

require('./pwa').configurePwa(app);
app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders(res, file) {
  if (/\.(?:html|js|css|webmanifest)$/.test(file)) res.set('Cache-Control', 'no-store');
} }));

// Sentry captura automáticamente los errores que ocurran en las rutas
// HTTP de arriba. Va después de las rutas, antes de cualquier otro
// middleware de manejo de errores.
Sentry.setupExpressErrorHandler(app);

const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

const paradas = [];
if (process.env.APP_WORKERS_ENABLED !== 'false') {
  let historialActivo = false;
  paradas.push(programar('historial', async () => {
    historialActivo = true;
    try {
      for (const usuario of await obtenerUsuariosActivos()) await pollRecentlyPlayed(usuario);
    } finally { historialActivo = false; }
  }, INTERVALO_HISTORIAL_MS));
  paradas.push(programar('actual', async () => {
    if (!hayVisitantes() || historialActivo) return;
    for (const usuario of await obtenerUsuariosActivos()) await pollCurrentlyPlaying(usuario);
  }, INTERVALO_CURRENTLY_MS));
  paradas.push(programar('fotos', async () => {
    if (historialActivo) return;
    const usuarios = await obtenerUsuariosActivos();
    if (usuarios.length) await completarImagenesDeArtistas(usuarios[0]);
  }, INTERVALO_HISTORIAL_MS));
}
let cerrando = false;
async function shutdown() {
  if (cerrando) return;
  cerrando = true;
  const forzar = setTimeout(() => process.exit(1), 15000);
  forzar.unref();
  server.close();
  await Promise.allSettled(paradas.map((stop) => stop()));
  await db.end();
  clearTimeout(forzar);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log(paradas.length ? 'Workers de polling programados.' : 'Workers desactivados en este proceso.');
