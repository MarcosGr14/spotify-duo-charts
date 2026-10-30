const db = require('./db');

// Spotify entrega fechas con precisión de año, mes o día. PostgreSQL DATE
// necesita un día: para precisiones parciales usamos el primero del período.
function normalizarFechaLanzamiento(valor) {
  if (typeof valor !== 'string' || !/^\d{4}(-\d{2})?(-\d{2})?$/.test(valor)) return null;
  const partes = valor.split('-');
  const fecha = partes.length === 1 ? `${valor}-01-01` : partes.length === 2 ? `${valor}-01` : valor;
  const parsed = new Date(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fecha || fecha.startsWith('0000')) return null;
  return fecha;
}


async function upsertArtista(artistaSpotify) {
  const { rows } = await db.query(
    `INSERT INTO artistas (spotify_artist_id, nombre, imagen_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (spotify_artist_id) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [artistaSpotify.id, artistaSpotify.name, artistaSpotify.images?.[0]?.url || null]
  );
  return rows[0].id;
}

async function upsertAlbum(albumSpotify) {
  const { rows } = await db.query(
    `INSERT INTO albumes (spotify_album_id, nombre, imagen_url, fecha_lanzamiento)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (spotify_album_id) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [
      albumSpotify.id,
      albumSpotify.name,
      albumSpotify.images?.[0]?.url || null,
      normalizarFechaLanzamiento(albumSpotify.release_date)
    ]
  );
  return rows[0].id;
}

// Recibe un objeto "track" tal cual lo devuelve la API de Spotify
// y devuelve el id interno de la canción, creando todo lo necesario
// en el catálogo (artistas, álbum) si no existía.
async function upsertCancion(trackSpotify) {
  const albumId = await upsertAlbum(trackSpotify.album);

  const { rows } = await db.query(
    `INSERT INTO canciones (spotify_track_id, nombre, album_id, duracion_ms)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (spotify_track_id) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [trackSpotify.id, trackSpotify.name, albumId, trackSpotify.duration_ms]
  );
  const cancionId = rows[0].id;

  for (const [index, artistaSpotify] of trackSpotify.artists.entries()) {
    const artistaId = await upsertArtista(artistaSpotify);
    await db.query(
      `INSERT INTO cancion_artistas (cancion_id, artista_id, es_principal)
       VALUES ($1, $2, $3)
       ON CONFLICT (cancion_id, artista_id) DO NOTHING`,
      [cancionId, artistaId, index === 0]
    );
  }

  return cancionId;
}

module.exports = { upsertArtista, upsertAlbum, upsertCancion, normalizarFechaLanzamiento };
