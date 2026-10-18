const crypto = require('crypto');
const express = require('express');
const Sentry = require('@sentry/node');
const db = require('./db');
const { ZONA_HORARIA, INTEGRATION_TOKEN } = require('./config');
const { describirError } = require('./errorUtils');

const router = express.Router();

// Compara dos strings sin filtrar información por tiempo de respuesta
function tokensIguales(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Middleware de autenticación segura
function verificarTokenIntegracion(req, res, next) {
  // Si el token no está configurado, el endpoint se CIERRA (no se abre)
  if (!INTEGRATION_TOKEN) {
    console.warn('[integrationsApi] INTEGRATION_TOKEN no configurado en entorno.');
    return res.status(503).json({
      error: 'Integración no configurada en el servidor.'
    });
  }

  const tokenHeader = req.headers['x-integration-token'];
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const tokenProporcionado = tokenHeader || bearerToken;

  if (!tokenProporcionado || !tokensIguales(tokenProporcionado, INTEGRATION_TOKEN)) {
    return res.status(401).json({
      error: 'Acceso no autorizado: Token de integración inválido o ausente.'
    });
  }

  next();
}

router.use(verificarTokenIntegracion);

// GET /api/integrations/health
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    module: 'spotify-duo-charts-integration',
    timezone: ZONA_HORARIA,
    timestamp: new Date().toISOString()
  });
});

function obtenerFechaLocalHoy(zonaHoraria) {
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formateador.format(new Date());
}

// Consulta SQL de sólo lectura
const SQL_DAILY_ARTIST_STREAMS = `
  WITH rango_dia AS (
    SELECT 
      ($1::date::timestamp AT TIME ZONE $2) AS inicio,
      (($1::date + 1)::timestamp AT TIME ZONE $2) AS fin
  ),
  cuentas AS (
    SELECT id, spotify_user_id, nombre_display, ROW_NUMBER() OVER (ORDER BY id) AS pos
    FROM usuarios_spotify
    ORDER BY id
    LIMIT 2
  ),
  reproducciones_filtradas AS (
    SELECT 
      r.usuario_id,
      ca.artista_id
    FROM reproducciones r
    JOIN rango_dia rd ON r.reproducido_en >= rd.inicio AND r.reproducido_en < rd.fin
    JOIN cancion_artistas ca ON ca.cancion_id = r.cancion_id
  )
  SELECT 
    ar.spotify_artist_id,
    ar.nombre AS artista_nombre,
    ar.imagen_url,
    COUNT(CASE WHEN rf.usuario_id = (SELECT id FROM cuentas WHERE pos = 1) THEN 1 END)::int AS account_1_streams,
    COUNT(CASE WHEN rf.usuario_id = (SELECT id FROM cuentas WHERE pos = 2) THEN 1 END)::int AS account_2_streams,
    COUNT(*)::int AS combined_streams
  FROM reproducciones_filtradas rf
  JOIN artistas ar ON ar.id = rf.artista_id
  GROUP BY ar.id, ar.spotify_artist_id, ar.nombre, ar.imagen_url
  ORDER BY combined_streams DESC, ar.nombre ASC;
`;

async function obtenerStreamsDiariosPorArtista(fecha, zonaHoraria, database = db) {
  const [resultadoStreams, resultadoCuentas] = await Promise.all([
    database.query(SQL_DAILY_ARTIST_STREAMS, [fecha, zonaHoraria]),
    database.query(
      'SELECT id, spotify_user_id, nombre_display, necesita_reconexion FROM usuarios_spotify ORDER BY id LIMIT 2'
    )
  ]);

  return {
    accounts: resultadoCuentas.rows,
    rows: resultadoStreams.rows
  };
}

// GET /api/integrations/daily-artist-streams?date=YYYY-MM-DD
router.get('/daily-artist-streams', async (req, res) => {
  const fechaParam = req.query.date;
  let fecha = fechaParam;

  if (fechaParam) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fechaParam)) {
      return res.status(400).json({
        error: 'Formato de fecha inválido. Debe ser YYYY-MM-DD.'
      });
    }
  } else {
    fecha = obtenerFechaLocalHoy(ZONA_HORARIA);
  }

  try {
    const { accounts, rows } = await obtenerStreamsDiariosPorArtista(fecha, ZONA_HORARIA);

    const records = rows.map((r) => ({
      spotify_artist_id: r.spotify_artist_id,
      artist_name: r.artista_nombre,
      image_url: r.imagen_url,
      competition_date: fecha,
      account_1_streams: r.account_1_streams,
      account_2_streams: r.account_2_streams,
      combined_streams: r.combined_streams
    }));

    res.status(200).json({
      success: true,
      date: fecha,
      timezone: ZONA_HORARIA,
      synced_at: new Date().toISOString(),
      accounts: accounts.map((u) => ({
        id: u.id,
        spotify_user_id: u.spotify_user_id,
        nombre_display: u.nombre_display,
        necesita_reconexion: u.necesita_reconexion
      })),
      total_records: records.length,
      records
    });
  } catch (err) {
    console.error('Error en /api/integrations/daily-artist-streams:', describirError(err));
    Sentry.captureException(err, { tags: { ruta: '/api/integrations/daily-artist-streams' } });
    res.status(500).json({
      error: 'No se pudieron consultar las estadísticas de escucha por artista.'
    });
  }
});

module.exports = {
  router,
  obtenerStreamsDiariosPorArtista,
  SQL_DAILY_ARTIST_STREAMS
};