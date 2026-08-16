const axios = require('axios');
const db = require('./db');
const { obtenerAccessTokenValido } = require('./spotifyAuth');
const { upsertCancion } = require('./catalog');

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
             actualizado_en = now()`,
      [usuario.id, cancionId]
    );
  } catch (err) {
    console.error(
      `[currently-playing] Error con usuario ${usuario.nombre_display}:`,
      err.response?.data || err.message
    );
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
      err.response?.data || err.message
    );
  }
}

// ------------------------------------------------------------
// Los artistas que vienen embebidos en una canción (recently-played,
// currently-playing) traen una versión resumida SIN foto. Para
// conseguir la foto real hay que pedirle a Spotify el perfil completo
// del artista aparte. Esta función busca los que todavía no tienen
// imagen guardada y se las completa en lotes de hasta 50.
// ------------------------------------------------------------
async function completarImagenesDeArtistas(usuario) {
  try {
    const { rows } = await db.query(
      `SELECT id, spotify_artist_id FROM artistas WHERE imagen_url IS NULL LIMIT 50`
    );
    if (!rows.length) return;

    const token = await obtenerAccessTokenValido(usuario.id);
    const ids = rows.map((r) => r.spotify_artist_id).join(',');
    const resp = await axios.get(`https://api.spotify.com/v1/artists?ids=${ids}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    for (const artistaSpotify of resp.data.artists) {
      if (!artistaSpotify) continue;
      const imagenUrl = artistaSpotify.images?.[0]?.url;
      if (imagenUrl) {
        await db.query(`UPDATE artistas SET imagen_url = $1 WHERE spotify_artist_id = $2`, [
          imagenUrl,
          artistaSpotify.id
        ]);
      }
    }
  } catch (err) {
    console.error(
      '[completar imágenes de artistas] Error:',
      err.response?.data || err.message
    );
  }
}

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
