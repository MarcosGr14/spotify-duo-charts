const db = require('./db');
const { ZONA_HORARIA } = require('./config');

// ------------------------------------------------------------
// Trae, para el período indicado, cuántas veces escuchó CADA usuario
// a CADA canción, más el nombre del artista. Deliberadamente NO se
// reutiliza reproduccionesPorCancion() de musicMatch.js: esa versión
// no trae artista, y agregar el JOIN ahí arriesgaba una regresión en
// un archivo ya validado en Fase 5. Se resuelve con dos CTEs para
// evitar el bug clásico de "fan-out": si se hiciera un JOIN directo
// reproducciones -> cancion_artistas, una canción con 2 artistas
// duplicaría sus plays (cada reproducción matchea 2 filas). Acá el
// conteo de plays se cierra ANTES de traer el artista.
// ------------------------------------------------------------
async function reproduccionesPorCancionConArtista(dias, database) {
  const { rows } = await database.query(
    `WITH plays_por_cancion AS (
       SELECT r.usuario_id, r.cancion_id, COUNT(*)::int AS plays
       FROM reproducciones r
       WHERE r.reproducido_en >= now() - make_interval(days => $1)
       GROUP BY r.usuario_id, r.cancion_id
     ),
     artistas_por_cancion AS (
       SELECT ca.cancion_id, string_agg(DISTINCT ar.nombre, ', ') AS artista
       FROM cancion_artistas ca
       JOIN artistas ar ON ar.id = ca.artista_id
       GROUP BY ca.cancion_id
     )
     SELECT p.usuario_id, p.cancion_id, c.nombre, al.imagen_url, apc.artista, p.plays
     FROM plays_por_cancion p
     JOIN canciones c ON c.id = p.cancion_id
     LEFT JOIN albumes al ON al.id = c.album_id
     LEFT JOIN artistas_por_cancion apc ON apc.cancion_id = p.cancion_id`,
    [dias]
  );
  return rows;
}

// ------------------------------------------------------------
// MOST OBSESSED TRACK
// La canción con más reproducciones combinadas (Marcos + Jackie) en
// el período. Criterio de empate documentado: gana el cancion_id más
// bajo (más antiguo en el catálogo) — determinista porque es una
// PK, nunca puede volver a empatar.
// ------------------------------------------------------------
function calcularMostObsessedTrack(filasCanciones, u1Id, u2Id) {
  const porCancion = new Map();
  for (const fila of filasCanciones) {
    if (fila.usuario_id !== u1Id && fila.usuario_id !== u2Id) continue;
    if (!porCancion.has(fila.cancion_id)) {
      porCancion.set(fila.cancion_id, {
        cancion_id: fila.cancion_id,
        nombre: fila.nombre,
        artista: fila.artista,
        imagen_url: fila.imagen_url,
        total: 0
      });
    }
    porCancion.get(fila.cancion_id).total += fila.plays;
  }

  const candidatas = [...porCancion.values()];
  if (!candidatas.length) return null;

  candidatas.sort((a, b) => b.total - a.total || a.cancion_id - b.cancion_id);
  const ganadora = candidatas[0];

  return {
    nombre: ganadora.nombre,
    artista: ganadora.artista,
    imagen_url: ganadora.imagen_url,
    reproducciones_totales: ganadora.total
  };
}

// ------------------------------------------------------------
// NIGHT OWL
// "Noche" = reproducciones entre las 00:00 y las 05:59, hora local
// según ZONA_HORARIA (ver config.js — asunción documentada ahí).
// reproducido_en AT TIME ZONE <zona> convierte el instante UTC a la
// hora de pared de esa zona; EXTRACT(HOUR ...) da 0-23 en esa hora.
//
// Devuelve quién de los dos escuchó más de noche, y qué porcentaje
// del total de reproducciones nocturnas del DÚO le corresponde a esa
// persona. Empate (mismos plays nocturnos, > 0): gana u1 por
// convención determinista explícita.
// ------------------------------------------------------------
async function reproduccionesNocturnasPorUsuario(dias, database, zonaHoraria) {
  const { rows } = await database.query(
    `SELECT r.usuario_id, COUNT(*)::int AS plays
     FROM reproducciones r
     WHERE r.reproducido_en >= now() - make_interval(days => $1)
       AND EXTRACT(HOUR FROM (r.reproducido_en AT TIME ZONE $2)) < 6
     GROUP BY r.usuario_id`,
    [dias, zonaHoraria]
  );
  return rows;
}

function calcularNightOwl(filasNocturnas, u1, u2) {
  const playsPorUsuario = { [u1.id]: 0, [u2.id]: 0 };
  for (const fila of filasNocturnas) {
    if (fila.usuario_id === u1.id || fila.usuario_id === u2.id) {
      playsPorUsuario[fila.usuario_id] = fila.plays;
    }
  }

  const totalNocturno = playsPorUsuario[u1.id] + playsPorUsuario[u2.id];
  if (totalNocturno === 0) {
    return { night_owl: null, night_plays_total: 0 };
  }

  // Empate determinista: gana u1 (menor id de usuario) si no hay diferencia.
  const ganador = playsPorUsuario[u1.id] >= playsPorUsuario[u2.id] ? u1 : u2;
  const playsGanador = playsPorUsuario[ganador.id];

  return {
    night_owl: {
      usuario_id: ganador.id,
      nombre_display: ganador.nombre_display,
      reproducciones_nocturnas: playsGanador,
      porcentaje_nocturno: Math.round((playsGanador / totalNocturno) * 1000) / 10
    },
    night_plays_total: totalNocturno
  };
}

// ------------------------------------------------------------
// SHARED OBSESSION
// La canción compartida (ambos con al menos 1 play) que maximiza
// MIN(plays_u1, plays_u2) — así una canción 20/1 no le gana a una
// 10/9, que refleja mejor una obsesión realmente compartida.
// Desempate documentado: 1) mayor total combinado, 2) menor
// cancion_id (determinista, PK).
// ------------------------------------------------------------
function calcularSharedObsession(filasCanciones, u1Id, u2Id) {
  const porCancion = new Map();
  for (const fila of filasCanciones) {
    if (fila.usuario_id !== u1Id && fila.usuario_id !== u2Id) continue;
    if (!porCancion.has(fila.cancion_id)) {
      porCancion.set(fila.cancion_id, {
        cancion_id: fila.cancion_id,
        nombre: fila.nombre,
        artista: fila.artista,
        imagen_url: fila.imagen_url,
        plays_u1: 0,
        plays_u2: 0
      });
    }
    const entrada = porCancion.get(fila.cancion_id);
    if (fila.usuario_id === u1Id) entrada.plays_u1 += fila.plays;
    else entrada.plays_u2 += fila.plays;
  }

  const compartidas = [...porCancion.values()].filter((c) => c.plays_u1 > 0 && c.plays_u2 > 0);
  if (!compartidas.length) return null;

  compartidas.sort((a, b) => {
    const scoreA = Math.min(a.plays_u1, a.plays_u2);
    const scoreB = Math.min(b.plays_u1, b.plays_u2);
    if (scoreB !== scoreA) return scoreB - scoreA; // mayor MIN() primero
    const totalA = a.plays_u1 + a.plays_u2;
    const totalB = b.plays_u1 + b.plays_u2;
    if (totalB !== totalA) return totalB - totalA; // desempate 1: mayor total
    return a.cancion_id - b.cancion_id; // desempate 2: determinista
  });

  const ganadora = compartidas[0];
  return {
    nombre: ganadora.nombre,
    artista: ganadora.artista,
    imagen_url: ganadora.imagen_url,
    plays_usuario_1: ganadora.plays_u1,
    plays_usuario_2: ganadora.plays_u2,
    reproducciones_totales: ganadora.plays_u1 + ganadora.plays_u2
  };
}

// ------------------------------------------------------------
// Función principal. `database` inyectable (default = db real de
// producción) igual que calcularMusicMatch — la ruta /api/records NO
// pasa el segundo argumento, así que producción no cambia.
// ------------------------------------------------------------
async function calcularRecords(dias, database = db) {
  const { rows: usuarios } = await database.query(
    'SELECT id, nombre_display FROM usuarios_spotify ORDER BY id LIMIT 2'
  );

  if (usuarios.length < 2) {
    return { disponible: false, motivo: 'Hacen falta 2 cuentas conectadas.' };
  }

  const [u1, u2] = usuarios;

  const [filasCanciones, filasNocturnas] = await Promise.all([
    reproduccionesPorCancionConArtista(dias, database),
    reproduccionesNocturnasPorUsuario(dias, database, ZONA_HORARIA)
  ]);

  const mostObsessedTrack = calcularMostObsessedTrack(filasCanciones, u1.id, u2.id);
  const { night_owl, night_plays_total } = calcularNightOwl(filasNocturnas, u1, u2);
  const sharedObsession = calcularSharedObsession(filasCanciones, u1.id, u2.id);

  return {
    disponible: true,
    periodo_dias: dias,
    most_obsessed_track: mostObsessedTrack,
    night_owl,
    night_plays_total,
    shared_obsession: sharedObsession
  };
}

module.exports = { calcularRecords };