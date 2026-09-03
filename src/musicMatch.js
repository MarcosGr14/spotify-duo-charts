const db = require('./db');

// Trae, para el período indicado, cuántas veces escuchó CADA usuario
// a CADA artista. Una sola query para los dos usuarios a la vez —
// después separamos por usuario_id en JS, que es más simple de leer
// y de testear que armar todo en un CTE gigante de SQL.
//
// Recibe la conexión por parámetro (dependency injection) en vez de
// usar siempre el pool de producción de db.js. Así los tests pueden
// pasarle un Pool apuntando a TEST_DATABASE_URL sin tocar producción.
async function reproduccionesPorArtista(dias, database) {
  const { rows } = await database.query(
    `SELECT r.usuario_id, ca.artista_id, ar.nombre, ar.imagen_url, COUNT(*)::int AS plays
     FROM reproducciones r
     JOIN cancion_artistas ca ON ca.cancion_id = r.cancion_id
     JOIN artistas ar ON ar.id = ca.artista_id
     WHERE r.reproducido_en >= now() - make_interval(days => $1)
     GROUP BY r.usuario_id, ca.artista_id, ar.nombre, ar.imagen_url`,
    [dias]
  );
  return rows;
}

// Trae, para el período indicado, cuántas veces escuchó CADA usuario
// a CADA canción (por cancion_id — dos canciones distintas del mismo
// artista NUNCA cuentan como la misma). Misma idea que
// reproduccionesPorArtista: se agrupa en SQL, se separa por usuario
// en JS.
async function reproduccionesPorCancion(dias, database) {
  const { rows } = await database.query(
    `SELECT r.usuario_id, c.id AS cancion_id, c.nombre, al.imagen_url, COUNT(*)::int AS plays
     FROM reproducciones r
     JOIN canciones c ON c.id = r.cancion_id
     LEFT JOIN albumes al ON al.id = c.album_id
     WHERE r.reproducido_en >= now() - make_interval(days => $1)
     GROUP BY r.usuario_id, c.id, c.nombre, al.imagen_url`,
    [dias]
  );
  return rows;
}

// Music Match entre los dos primeros usuarios conectados (Duo Charts
// asume exactamente 2 cuentas). Usa similitud de Jaccard sobre el
// conjunto de artistas escuchados por cada uno en el período:
//
//   artistas compartidos / artistas distintos entre los dos × 100
//
// `database` es inyectable: en producción se usa el pool real de
// db.js (default), y en los tests se le pasa un Pool apuntando a
// TEST_DATABASE_URL. La ruta /api/music-match NO pasa este segundo
// parámetro, así que en producción el comportamiento es idéntico al
// de antes — sigue usando db.js / DATABASE_URL sin cambios.
async function calcularMusicMatch(dias, database = db) {
  const { rows: usuarios } = await database.query(
    'SELECT id, nombre_display FROM usuarios_spotify ORDER BY id LIMIT 2'
  );

  if (usuarios.length < 2) {
    return { disponible: false, motivo: 'Hacen falta 2 cuentas conectadas.' };
  }

  const [u1, u2] = usuarios;
  const [filas, filasCanciones] = await Promise.all([
    reproduccionesPorArtista(dias, database),
    reproduccionesPorCancion(dias, database)
  ]);

  // artista_id -> { nombre, imagen_url, plays_u1, plays_u2 }
  const porArtista = new Map();
  for (const fila of filas) {
    if (fila.usuario_id !== u1.id && fila.usuario_id !== u2.id) continue;
    if (!porArtista.has(fila.artista_id)) {
      porArtista.set(fila.artista_id, {
        nombre: fila.nombre,
        imagen_url: fila.imagen_url,
        plays_u1: 0,
        plays_u2: 0
      });
    }
    const entrada = porArtista.get(fila.artista_id);
    if (fila.usuario_id === u1.id) entrada.plays_u1 += fila.plays;
    else entrada.plays_u2 += fila.plays;
  }

  const union = [...porArtista.values()];
  const compartidos = union.filter((a) => a.plays_u1 > 0 && a.plays_u2 > 0);

  const totalArtistasUnion = union.length;
  const totalArtistasCompartidos = compartidos.length;
  const porcentaje = totalArtistasUnion
    ? Math.round((totalArtistasCompartidos / totalArtistasUnion) * 1000) / 10
    : 0;

  const artistaPrincipal =
    compartidos
      .slice()
      .sort((a, b) => b.plays_u1 + b.plays_u2 - (a.plays_u1 + a.plays_u2))[0] || null;

  const reproduccionesU1 = union.reduce((acc, a) => acc + a.plays_u1, 0);
  const reproduccionesU2 = union.reduce((acc, a) => acc + a.plays_u2, 0);
  const totalReproducciones = reproduccionesU1 + reproduccionesU2;

  // Shared Tracks: mismo patrón que los artistas, pero agrupado por
  // cancion_id — así dos canciones distintas del mismo artista jamás
  // cuentan como "compartida" entre sí, solo la MISMA canción exacta.
  const porCancion = new Map();
  for (const fila of filasCanciones) {
    if (fila.usuario_id !== u1.id && fila.usuario_id !== u2.id) continue;
    if (!porCancion.has(fila.cancion_id)) {
      porCancion.set(fila.cancion_id, {
        nombre: fila.nombre,
        imagen_url: fila.imagen_url,
        plays_u1: 0,
        plays_u2: 0
      });
    }
    const entrada = porCancion.get(fila.cancion_id);
    if (fila.usuario_id === u1.id) entrada.plays_u1 += fila.plays;
    else entrada.plays_u2 += fila.plays;
  }

  const cancionesCompartidas = [...porCancion.values()].filter(
    (c) => c.plays_u1 > 0 && c.plays_u2 > 0
  );
  const totalTracksCompartidos = cancionesCompartidas.length;

  const trackPrincipal =
    cancionesCompartidas
      .slice()
      .sort((a, b) => b.plays_u1 + b.plays_u2 - (a.plays_u1 + a.plays_u2))[0] || null;

  return {
    disponible: true,
    periodo_dias: dias,
    porcentaje,
    artistas_compartidos: totalArtistasCompartidos,
    artistas_union: totalArtistasUnion,
    artista_principal: artistaPrincipal
      ? {
          nombre: artistaPrincipal.nombre,
          imagen_url: artistaPrincipal.imagen_url,
          reproducciones_totales: artistaPrincipal.plays_u1 + artistaPrincipal.plays_u2
        }
      : null,
    tracks_compartidos: totalTracksCompartidos,
    track_principal: trackPrincipal
      ? {
          nombre: trackPrincipal.nombre,
          imagen_url: trackPrincipal.imagen_url,
          reproducciones_totales: trackPrincipal.plays_u1 + trackPrincipal.plays_u2
        }
      : null,
    usuarios: [u1, u2],
    balance: [
      {
        usuario_id: u1.id,
        nombre_display: u1.nombre_display,
        reproducciones: reproduccionesU1,
        porcentaje: totalReproducciones
          ? Math.round((reproduccionesU1 / totalReproducciones) * 1000) / 10
          : 0
      },
      {
        usuario_id: u2.id,
        nombre_display: u2.nombre_display,
        reproducciones: reproduccionesU2,
        porcentaje: totalReproducciones
          ? Math.round((reproduccionesU2 / totalReproducciones) * 1000) / 10
          : 0
      }
    ]
  };
}

module.exports = { calcularMusicMatch };