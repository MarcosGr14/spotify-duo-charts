const db = require('./db');

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
      albumSpotify.release_date || null
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

module.exports = { upsertArtista, upsertAlbum, upsertCancion };
