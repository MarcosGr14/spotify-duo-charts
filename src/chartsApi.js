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
      GROUP BY u.id, u.nombre_display, u.imagen_url, c.nombre, al.nombre, al.imagen_url, ra.actualizado_en
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
// GET /api/charts?scope=global|individual&usuario_id=1&dias=7
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

  try {
    const { rows } = await db.query(
      `
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
        SELECT cancion_id, plays,
               RANK() OVER (ORDER BY plays DESC) AS posicion
        FROM periodo_actual
      ),
      rank_anterior AS (
        SELECT cancion_id,
               RANK() OVER (ORDER BY plays DESC) AS posicion
        FROM periodo_anterior
      )
      SELECT
        c.id AS cancion_id,
        c.nombre AS cancion,
        al.nombre AS album,
        al.imagen_url AS portada,
        string_agg(DISTINCT ar.nombre, ', ') AS artistas,
        ra.posicion AS posicion,
        ra.plays AS veces_escuchada,
        ran.posicion AS posicion_anterior
      FROM rank_actual ra
      JOIN canciones c ON c.id = ra.cancion_id
      LEFT JOIN albumes al ON al.id = c.album_id
      LEFT JOIN cancion_artistas ca ON ca.cancion_id = c.id
      LEFT JOIN artistas ar ON ar.id = ca.artista_id
      LEFT JOIN rank_anterior ran ON ran.cancion_id = ra.cancion_id
      GROUP BY c.id, c.nombre, al.nombre, al.imagen_url, ra.posicion, ra.plays, ran.posicion
      ORDER BY ra.posicion
      LIMIT 20
      `,
      [dias, usuarioId]
    );

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
      'SELECT id, nombre_display, imagen_url FROM usuarios_spotify ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/usuarios:', err.message);
    res.status(500).json({ error: 'No se pudo consultar los usuarios.' });
  }
});

module.exports = router;
