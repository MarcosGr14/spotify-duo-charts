const axios = require('axios');
const db = require('./db');
const { obtenerAccessTokenValido } = require('./spotifyAuth');

const SEMANA = 7 * 24 * 60 * 60 * 1000;
const DIA = 24 * 60 * 60 * 1000;
let ocupado = false;
let pausaHasta = 0;

// La fecha persistida evita volver a recorrer todo el catálogo tras cada deploy.
// Las fotos anteriores se conservan hasta obtener una URL válida de Spotify.
async function completarImagenesDeArtistas(usuario) {
  if (ocupado || Date.now() < pausaHasta) return;
  ocupado = true;
  try {
    const { rows } = await db.query(
      `SELECT id, spotify_artist_id FROM public.artistas
       WHERE imagen_revisar_en IS NULL OR imagen_revisar_en <= now()
       ORDER BY imagen_revisar_en ASC NULLS FIRST, id
       LIMIT 5`
    );
    if (!rows.length) return;
    const token = await obtenerAccessTokenValido(usuario.id);
    let actualizadas = 0;
    for (const [indice, artista] of rows.entries()) {
      if (indice > 0) await new Promise((resolve) => setTimeout(resolve, 300));
      let espera = DIA;
      try {
        const { data } = await axios.get(
          `https://api.spotify.com/v1/artists/${encodeURIComponent(artista.spotify_artist_id)}`,
          { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
        );
        const imagen = data.images?.find((item) => {
          try { return new URL(item.url).protocol === 'https:'; } catch { return false; }
        })?.url;
        if (imagen) {
          await db.query(
            `UPDATE public.artistas SET imagen_url = $1, imagen_revisar_en = $2 WHERE id = $3`,
            [imagen, new Date(Date.now() + SEMANA), artista.id]
          );
          actualizadas++;
          continue;
        }
        console.warn(`[foto artista ${artista.spotify_artist_id}] Spotify no devolvió foto; se conserva la anterior.`);
      } catch (err) {
        const estado = err.response?.status;
        // No registrar el objeto Axios: contiene el encabezado Authorization.
        console.error(`[foto artista ${artista.spotify_artist_id}] ${estado ? `HTTP ${estado}` : (err.code || 'error de conexión')}`);
        if (estado === 429 || estado === 401 || estado === 403) {
          const retry = Number(err.response?.headers?.['retry-after']);
          espera = estado === 429 && Number.isFinite(retry) && retry > 0
            ? Math.max(retry * 1000, 60000) : (estado === 429 ? 60 * 60 * 1000 : DIA);
          pausaHasta = Date.now() + espera;
          console.warn(`[fotos artistas] Lote detenido por HTTP ${estado}; próximo intento a partir de ${new Date(pausaHasta).toISOString()}. Se conservan las fotos anteriores.`);
          // Persistir la pausa de pendientes también protege ante reinicios.
          await db.query(
            `UPDATE public.artistas SET imagen_revisar_en = $1
             WHERE imagen_revisar_en IS NULL OR imagen_revisar_en < $1`,
            [new Date(pausaHasta)]
          );
          break;
        }
      }
      await db.query(`UPDATE public.artistas SET imagen_revisar_en = $1 WHERE id = $2`,
        [new Date(Date.now() + espera), artista.id]);
    }
    console.log(`[fotos artistas] ${actualizadas}/${rows.length} fotos revisadas con imagen válida.`);
  } catch (err) {
    pausaHasta = Date.now() + 5 * 60 * 1000;
    console.error(`[fotos artistas] No se completó el lote (${err.code || 'error interno'}).`);
  } finally {
    ocupado = false;
  }
}

module.exports = { completarImagenesDeArtistas };
