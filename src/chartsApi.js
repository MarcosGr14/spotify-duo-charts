const express = require('express');
const db = require('./db');

const router = express.Router();

// ------------------------------------------------------------
// GET /api/currently-playing
// Devuelve qué está sonando ahora mismo en cada cuenta
// ------------------------------------------------------------
router.get('/currently-playing', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        u.id AS usuario_id,
        u.nombre_display,
        u.imagen_url AS usuario_imagen,
        u.necesita_reconexion,
        c.nombre AS cancion,
        al.nombre AS album,
        al.imagen_url AS portada,
        ra.actualizado_en,
        string_agg(DISTINCT ar.nombre, ', ') AS artistas
      FROM usuarios_spotify u
      LEFT JOIN reproduccion_actual ra ON ra.usuario_id = u.id
      LEFT JOIN canciones c ON c.id = ra.cancion_id
      LEFT JOIN albumes al ON al.id = c.album_id
      LEFT JOIN cancion_artistas ca ON ca.cancion_id = c.id
      LEFT JOIN artistas ar ON ar.id = ca.artista_id
      GROUP BY u.id, u.nombre_display, u.imagen_url, u.necesita_reconexion, c.nombre, al.nombre, al.imagen_url, ra.actualizado_en
      ORDER BY u.id
    `);

    // Si la última actualización tiene más de 2 minutos, la consideramos "pausado"
    const DOS_MINUTOS = 2 * 60 * 1000;
    const resultado = rows.map((r) => ({
      ...r,
      sonando: r.actualizado_en
        ? Date.now() - new Date(r.actualizado_en).getTime() < DOS_MINUTOS
        : false
    }));

    res.json(resultado);
  } catch (err) {
    console.error('Error en /api/currently-playing:', err.message);
    res.status(500).json({ error: 'No se pudo consultar el estado actual.' });
  }
});

// ------------------------------------------------------------
// Consultas SQL por tipo de ranking. Las tres devuelven las mismas
// columnas (id, nombre, subtitulo, portada, posicion, veces_escuchada,
// posicion_anterior) para que el frontend no tenga que distinguir casos.
// ------------------------------------------------------------
const QUERY_CANCIONES = `
  WITH periodo_actual AS (
    SELECT r.cancion_id, COUNT(*) AS plays
    FROM reproducciones r
    WHERE r.reproducido_en >= now() - make_interval(days => $1)
      AND ($2::int IS NULL OR r.usuario_id = $2::int)
    GROUP BY r.cancion_id
  ),
  periodo_anterior AS (
    SELECT r.cancion_id, COUNT(*) AS plays
    FROM reproducciones r
    WHERE r.reproducido_en >= now() - make_interval(days => $1 * 2)
      AND r.reproducido_en < now() - make_interval(days => $1)
      AND ($2::int IS NULL OR r.usuario_id = $2::int)
    GROUP BY r.cancion_id
  ),
  rank_actual AS (
    SELECT cancion_id, plays, RANK() OVER (ORDER BY plays DESC) AS posicion
    FROM periodo_actual
  ),
  rank_anterior AS (
    SELECT cancion_id, RANK() OVER (ORDER BY plays DESC) AS posicion
    FROM periodo_anterior
  )
  SELECT
    c.id AS id,
    c.nombre AS nombre,
    string_agg(DISTINCT ar.nombre, ', ') AS subtitulo,
    al.imagen_url AS portada,
    ra.posicion AS posicion,
    ra.plays AS veces_escuchada,
    ran.posicion AS posicion_anterior
  FROM rank_actual ra
  JOIN canciones c ON c.id = ra.cancion_id
  LEFT JOIN albumes al ON al.id = c.album_id
  LEFT JOIN cancion_artistas ca ON ca.cancion_id = c.id
  LEFT JOIN artistas ar ON ar.id = ca.artista_id
  LEFT JOIN rank_anterior ran ON ran.cancion_id = ra.cancion_id
  GROUP BY c.id, c.nombre, al.imagen_url, ra.posicion, ra.plays, ran.posicion
  ORDER BY ra.posicion
  LIMIT 20
`;

const QUERY_ARTISTAS = `
  WITH periodo_actual AS (
    SELECT ca.artista_id, COUNT(*) AS plays
    FROM reproducciones r
    JOIN cancion_artistas ca ON ca.cancion_id = r.cancion_id
    WHERE r.reproducido_en >= now() - make_interval(days => $1)
      AND ($2::int IS NULL OR r.usuario_id = $2::int)
    GROUP BY ca.artista_id
  ),
  periodo_anterior AS (
    SELECT ca.artista_id, COUNT(*) AS plays
    FROM reproducciones r
    JOIN cancion_artistas ca ON ca.cancion_id = r.cancion_id
    WHERE r.reproducido_en >= now() - make_interval(days => $1 * 2)
      AND r.reproducido_en < now() - make_interval(days => $1)
      AND ($2::int IS NULL OR r.usuario_id = $2::int)
    GROUP BY ca.artista_id
  ),
  rank_actual AS (
    SELECT artista_id, plays, RANK() OVER (ORDER BY plays DESC) AS posicion
    FROM periodo_actual
  ),
  rank_anterior AS (
    SELECT artista_id, RANK() OVER (ORDER BY plays DESC) AS posicion
    FROM periodo_anterior
  )
  SELECT
    a.id AS id,
    a.nombre AS nombre,
    NULL AS subtitulo,
    a.imagen_url AS portada,
    ra.posicion AS posicion,
    ra.plays AS veces_escuchada,
    ran.posicion AS posicion_anterior
  FROM rank_actual ra
  JOIN artistas a ON a.id = ra.artista_id
  LEFT JOIN rank_anterior ran ON ran.artista_id = ra.artista_id
  ORDER BY ra.posicion
  LIMIT 20
`;

const QUERY_ALBUMES = `
  WITH periodo_actual AS (
    SELECT c.album_id, COUNT(*) AS plays
    FROM reproducciones r
    JOIN canciones c ON c.id = r.cancion_id
    WHERE c.album_id IS NOT NULL
      AND r.reproducido_en >= now() - make_interval(days => $1)
      AND ($2::int IS NULL OR r.usuario_id = $2::int)
    GROUP BY c.album_id
  ),
  periodo_anterior AS (
    SELECT c.album_id, COUNT(*) AS plays
    FROM reproducciones r
    JOIN canciones c ON c.id = r.cancion_id
    WHERE c.album_id IS NOT NULL
      AND r.reproducido_en >= now() - make_interval(days => $1 * 2)
      AND r.reproducido_en < now() - make_interval(days => $1)
      AND ($2::int IS NULL OR r.usuario_id = $2::int)
    GROUP BY c.album_id
  ),
  rank_actual AS (
    SELECT album_id, plays, RANK() OVER (ORDER BY plays DESC) AS posicion
    FROM periodo_actual
  ),
  rank_anterior AS (
    SELECT album_id, RANK() OVER (ORDER BY plays DESC) AS posicion
    FROM periodo_anterior
  )
  SELECT
    al.id AS id,
    al.nombre AS nombre,
    string_agg(DISTINCT ar.nombre, ', ') AS subtitulo,
    al.imagen_url AS portada,
    ra.posicion AS posicion,
    ra.plays AS veces_escuchada,
    ran.posicion AS posicion_anterior
  FROM rank_actual ra
  JOIN albumes al ON al.id = ra.album_id
  LEFT JOIN canciones c3 ON c3.album_id = al.id
  LEFT JOIN cancion_artistas ca3 ON ca3.cancion_id = c3.id
  LEFT JOIN artistas ar ON ar.id = ca3.artista_id
  LEFT JOIN rank_anterior ran ON ran.album_id = ra.album_id
  GROUP BY al.id, al.nombre, al.imagen_url, ra.posicion, ra.plays, ran.posicion
  ORDER BY ra.posicion
  LIMIT 20
`;

const QUERIES_POR_TIPO = {
  canciones: QUERY_CANCIONES,
  artistas: QUERY_ARTISTAS,
  albumes: QUERY_ALBUMES
};

// ------------------------------------------------------------
// GET /api/charts?scope=global|individual&usuario_id=1&dias=7&tipo=canciones|artistas|albumes
// Devuelve el ranking con posición actual y variación vs el
// período anterior (para las flechas de sube/baja)
// ------------------------------------------------------------
router.get('/charts', async (req, res) => {
  const dias = parseInt(req.query.dias, 10) || 7;
  const scope = req.query.scope === 'individual' ? 'individual' : 'global';
  const usuarioId =
    scope === 'individual' && req.query.usuario_id
      ? parseInt(req.query.usuario_id, 10)
      : null;
  const tipo = QUERIES_POR_TIPO[req.query.tipo] ? req.query.tipo : 'canciones';

  try {
    const { rows } = await db.query(QUERIES_POR_TIPO[tipo], [dias, usuarioId]);

    const resultado = rows.map((r) => ({
      ...r,
      cambio: r.posicion_anterior ? r.posicion_anterior - r.posicion : null // positivo = subió, null = nuevo
    }));

    res.json(resultado);
  } catch (err) {
    console.error('Error en /api/charts:', err.message);
    res.status(500).json({ error: 'No se pudo calcular el ranking.' });
  }
});

// ------------------------------------------------------------
// GET /api/usuarios  ->  para poblar el selector de charts individuales
// ------------------------------------------------------------
router.get('/usuarios', async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nombre_display, imagen_url, necesita_reconexion FROM usuarios_spotify ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/usuarios:', err.message);
    res.status(500).json({ error: 'No se pudo consultar los usuarios.' });
  }
});

module.exports = router;
