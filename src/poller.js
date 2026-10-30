const axios = require('axios');
const Sentry = require('@sentry/node');
const db = require('./db');
const { obtenerAccessTokenValido } = require('./spotifyAuth');
const { upsertCancion } = require('./catalog');
const { describirError } = require('./errorUtils');

// ------------------------------------------------------------
// Actualiza "qué está sonando ahora mismo" (para el widget en vivo)
// ------------------------------------------------------------
async function pollCurrentlyPlaying(usuario) {
  try {
    const token = await obtenerAccessTokenValido(usuario.id);
    const resp = await axios.get(
      'https://api.spotify.com/v1/me/player/currently-playing',
      {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: (s) => s === 200 || s === 204
      }
    );

    if (resp.status === 204 || !resp.data?.item) {
      // No está escuchando nada en este momento
      return;
    }

    const track = resp.data.item;
    const cancionId = await upsertCancion(track);

    await db.query(
      `INSERT INTO reproduccion_actual (usuario_id, cancion_id, empezo_en, actualizado_en)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (usuario_id) DO UPDATE
         SET cancion_id = EXCLUDED.cancion_id,
             empezo_en = CASE
               WHEN reproduccion_actual.cancion_id IS DISTINCT FROM EXCLUDED.cancion_id
               THEN now()
               ELSE reproduccion_actual.empezo_en
             END,
             actualizado_en = now()`,
      [usuario.id, cancionId]
    );
  } catch (err) {
    console.error(
      `[currently-playing] Error con usuario ${usuario.nombre_display}:`,
      err.response?.data || describirError(err)
    );
    Sentry.captureException(err, { tags: { ciclo: 'currently-playing', usuario: usuario.nombre_display } });
  }
}

// ------------------------------------------------------------
// Trae el historial real (últimas 50 reproducciones con timestamp
// oficial de Spotify) y lo guarda en "reproducciones".
// Esta es la fuente de verdad para los charts y rankings.
// ------------------------------------------------------------
async function pollRecentlyPlayed(usuario) {
  try {
    const token = await obtenerAccessTokenValido(usuario.id);
    const resp = await axios.get(
      'https://api.spotify.com/v1/me/player/recently-played?limit=50',
      { headers: { Authorization: `Bearer ${token}` } }
    );

    for (const item of resp.data.items) {
      const cancionId = await upsertCancion(item.track);

      await db.query(
        `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en, origen)
         VALUES ($1, $2, $3, 'recently_played')
         ON CONFLICT (usuario_id, cancion_id, reproducido_en) DO NOTHING`,
        [usuario.id, cancionId, item.played_at]
      );
    }
  } catch (err) {
    console.error(
      `[recently-played] Error con usuario ${usuario.nombre_display}:`,
      err.response?.data || describirError(err)
    );
    Sentry.captureException(err, { tags: { ciclo: 'recently-played', usuario: usuario.nombre_display } });
  }
}

const { completarImagenesDeArtistas } = require('./artistImages');

async function obtenerUsuariosActivos() {
  const { rows } = await db.query('SELECT * FROM usuarios_spotify');
  return rows;
}

module.exports = {
  pollCurrentlyPlaying,
  pollRecentlyPlayed,
  completarImagenesDeArtistas,
  obtenerUsuariosActivos
};
