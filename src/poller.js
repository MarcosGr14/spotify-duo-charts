const db = require('./db');
const spotify = require('./spotifyClient');
const { obtenerAccessTokenValido } = require('./spotifyAuth');
const { upsertCancion } = require('./catalog');
const { resumenError } = require('./safeErrors');

async function pollCurrentlyPlaying(usuario) {
  try {
    const token = await obtenerAccessTokenValido(usuario.id);
    const resp = await spotify.request({ url: 'https://api.spotify.com/v1/me/player/currently-playing',
      headers: { Authorization: `Bearer ${token}` }, validateStatus: (s) => s === 200 || s === 204 });
    if (resp.status === 204 || !resp.data?.item || !resp.data.is_playing) {
      await db.query('DELETE FROM reproduccion_actual WHERE usuario_id=$1', [usuario.id]);
      return;
    }
    const track = resp.data.item;
    if (track.type && track.type !== 'track') return;
    const cancionId = await upsertCancion(track);
    const empezo = new Date(Date.now() - Math.max(0, resp.data.progress_ms || 0));
    await db.query(`INSERT INTO reproduccion_actual(usuario_id,cancion_id,empezo_en,actualizado_en)
      VALUES($1,$2,$3,now()) ON CONFLICT(usuario_id) DO UPDATE SET
      cancion_id=EXCLUDED.cancion_id,empezo_en=EXCLUDED.empezo_en,actualizado_en=now()`,
    [usuario.id, cancionId, empezo]);
  } catch (err) { if (err.code !== 'SPOTIFY_PAUSED') console.error('[currently-playing]', resumenError(err)); }
}

async function pollRecentlyPlayed(usuario) {
  let fallidos = 0;
  try {
    await db.query('UPDATE usuarios_spotify SET ultimo_intento_en=now() WHERE id=$1', [usuario.id]);
    const token = await obtenerAccessTokenValido(usuario.id);
    const resp = await spotify.request({ url: 'https://api.spotify.com/v1/me/player/recently-played?limit=50',
      headers: { Authorization: `Bearer ${token}` } });
    if (!Array.isArray(resp.data?.items)) throw Object.assign(new Error('Respuesta inválida'), { code: 'INVALID_RESPONSE' });
    const items = resp.data.items;
    for (const item of items) {
      try {
        if (!item.track?.id || !Number.isFinite(Date.parse(item.played_at))) throw Object.assign(new Error('Registro inválido'), { code: 'INVALID_TRACK' });
        const cancionId = await upsertCancion(item.track);
        await db.query(`INSERT INTO reproducciones(usuario_id,cancion_id,reproducido_en,origen)
          VALUES($1,$2,$3,'recently_played') ON CONFLICT(usuario_id,cancion_id,reproducido_en) DO NOTHING`,
        [usuario.id, cancionId, item.played_at]);
      } catch (err) {
        fallidos++;
        console.error('[historial elemento]', resumenError(err));
      }
    }
    const tiempos = items.map((i) => Date.parse(i.played_at)).filter(Number.isFinite);
    const ultimoExito = Date.parse(usuario.ultima_sincronizacion_en);
    // Solo advertir: una ventana llena cuyo registro más antiguo es posterior
    // al último éxito puede ocultar escuchas. Nunca inventamos ni borramos plays.
    const hueco = items.length >= 50 && Number.isFinite(ultimoExito) && Math.min(...tiempos) > ultimoExito;
    await db.query(`UPDATE usuarios_spotify SET
      ultima_sincronizacion_en=CASE WHEN $2=0 THEN now() ELSE ultima_sincronizacion_en END,
      ultimo_error_sync=$3,elementos_fallidos=$2,posibles_huecos=posibles_huecos+$4 WHERE id=$1`,
    [usuario.id, fallidos, fallidos ? 'ITEMS_FAILED' : null, hueco ? 1 : 0]);
    if (hueco) console.warn('[historial] Posible hueco en la ventana reciente de una cuenta.');
  } catch (err) {
    const codigo = err.code === 'SPOTIFY_PAUSED' || err.response?.status === 429 ? 'SPOTIFY_PAUSED' : 'SYNC_FAILED';
    await db.query('UPDATE usuarios_spotify SET ultimo_error_sync=$2 WHERE id=$1', [usuario.id, codigo]);
    if (codigo !== 'SPOTIFY_PAUSED') console.error('[recently-played]', resumenError(err));
  }
}
const { completarImagenesDeArtistas } = require('./artistImages');
async function obtenerUsuariosActivos() {
  const { rows } = await db.query('SELECT * FROM usuarios_spotify WHERE necesita_reconexion=false ORDER BY id');
  return rows;
}
module.exports = { pollCurrentlyPlaying, pollRecentlyPlayed, completarImagenesDeArtistas, obtenerUsuariosActivos };
