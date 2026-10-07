const db = require('./db');
const { ZONA_HORARIA } = require('./config');

const SQL_CALENDARIO = `
  WITH por_cancion_dia AS (
    SELECT
      (r.reproducido_en AT TIME ZONE $3)::date AS dia,
      r.cancion_id,
      COUNT(*)::int AS reproducciones
    FROM reproducciones r
    WHERE r.reproducido_en >= ($1::date::timestamp AT TIME ZONE $3)
      AND r.reproducido_en < ($2::date::timestamp AT TIME ZONE $3)
      AND ($4::int IS NULL OR r.usuario_id = $4::int)
    GROUP BY dia, r.cancion_id
  ),
  clasificado AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY dia ORDER BY reproducciones DESC, cancion_id) AS orden
    FROM por_cancion_dia
  ),
  totales AS (
    SELECT dia, SUM(reproducciones)::int AS reproducciones
    FROM por_cancion_dia
    GROUP BY dia
  ),
  artistas AS (
    SELECT ca.cancion_id, string_agg(DISTINCT ar.nombre, ', ') AS nombres
    FROM cancion_artistas ca
    JOIN artistas ar ON ar.id = ca.artista_id
    GROUP BY ca.cancion_id
  ),
  dias AS (
    SELECT generate_series($1::date, ($2::date - 1), interval '1 day')::date AS dia
  )
  SELECT
    to_char(d.dia, 'YYYY-MM-DD') AS fecha,
    COALESCE(t.reproducciones, 0)::int AS reproducciones,
    c.nombre AS cancion_destacada,
    a.nombres AS artistas_destacados,
    cl.reproducciones AS reproducciones_cancion
  FROM dias d
  LEFT JOIN totales t ON t.dia = d.dia
  LEFT JOIN clasificado cl ON cl.dia = d.dia AND cl.orden = 1
  LEFT JOIN canciones c ON c.id = cl.cancion_id
  LEFT JOIN artistas a ON a.cancion_id = cl.cancion_id
  ORDER BY d.dia
`;

const SQL_MAPA_HORARIO = `
  SELECT
    EXTRACT(DOW FROM (r.reproducido_en AT TIME ZONE $3))::int AS dia_semana,
    EXTRACT(HOUR FROM (r.reproducido_en AT TIME ZONE $3))::int AS hora,
    COUNT(*)::int AS reproducciones
  FROM reproducciones r
  WHERE r.reproducido_en >= ($1::date::timestamp AT TIME ZONE $3)
    AND r.reproducido_en < ($2::date::timestamp AT TIME ZONE $3)
    AND ($4::int IS NULL OR r.usuario_id = $4::int)
  GROUP BY dia_semana, hora
`;

const SQL_DIAS_ACTIVOS = `
  SELECT usuario_id,
         array_agg(to_char(dia, 'YYYY-MM-DD') ORDER BY dia) AS dias
  FROM (
    SELECT DISTINCT r.usuario_id, (r.reproducido_en AT TIME ZONE $2)::date AS dia
    FROM reproducciones r
    WHERE ($1::int IS NULL OR r.usuario_id = $1::int)
  ) actividad
  GROUP BY usuario_id
`;

const SQL_PRIMERAS_CANCIONES = `
  WITH primeras AS (
    SELECT r.usuario_id, r.cancion_id, MIN(r.reproducido_en) AS primera_vez
    FROM reproducciones r
    GROUP BY r.usuario_id, r.cancion_id
  ),
  del_mes AS (
    SELECT p.*
    FROM primeras p
    WHERE p.primera_vez >= ($1::date::timestamp AT TIME ZONE $3)
      AND p.primera_vez < ($2::date::timestamp AT TIME ZONE $3)
      AND ($4::int IS NULL OR p.usuario_id = $4::int)
  ),
  artistas AS (
    SELECT ca.cancion_id, string_agg(DISTINCT ar.nombre, ', ') AS nombres
    FROM cancion_artistas ca
    JOIN artistas ar ON ar.id = ca.artista_id
    GROUP BY ca.cancion_id
  ),
  ordenadas AS (
    SELECT m.usuario_id, m.cancion_id, m.primera_vez, c.nombre, a.nombres AS artista,
           COUNT(*) OVER (PARTITION BY m.usuario_id)::int AS total,
           ROW_NUMBER() OVER (PARTITION BY m.usuario_id ORDER BY m.primera_vez DESC, m.cancion_id)::int AS posicion
    FROM del_mes m
    JOIN canciones c ON c.id = m.cancion_id
    LEFT JOIN artistas a ON a.cancion_id = m.cancion_id
  )
  SELECT usuario_id, total, nombre, artista,
         to_char(primera_vez AT TIME ZONE $3, 'YYYY-MM-DD') AS fecha
  FROM ordenadas
  WHERE posicion <= 5
  ORDER BY usuario_id, primera_vez DESC
`;

const SQL_PRIMEROS_ARTISTAS = `
  WITH primeras AS (
    SELECT r.usuario_id, ca.artista_id, MIN(r.reproducido_en) AS primera_vez
    FROM reproducciones r
    JOIN cancion_artistas ca ON ca.cancion_id = r.cancion_id
    GROUP BY r.usuario_id, ca.artista_id
  ),
  del_mes AS (
    SELECT p.*
    FROM primeras p
    WHERE p.primera_vez >= ($1::date::timestamp AT TIME ZONE $3)
      AND p.primera_vez < ($2::date::timestamp AT TIME ZONE $3)
      AND ($4::int IS NULL OR p.usuario_id = $4::int)
  ),
  ordenados AS (
    SELECT m.usuario_id, m.primera_vez, ar.nombre,
           COUNT(*) OVER (PARTITION BY m.usuario_id)::int AS total,
           ROW_NUMBER() OVER (PARTITION BY m.usuario_id ORDER BY m.primera_vez DESC, m.artista_id)::int AS posicion
    FROM del_mes m
    JOIN artistas ar ON ar.id = m.artista_id
  )
  SELECT usuario_id, total, nombre,
         to_char(primera_vez AT TIME ZONE $3, 'YYYY-MM-DD') AS fecha
  FROM ordenados
  WHERE posicion <= 5
  ORDER BY usuario_id, primera_vez DESC
`;

const SQL_DUO = `
  WITH periodo AS (
    SELECT r.usuario_id, r.cancion_id,
           (r.reproducido_en AT TIME ZONE $3)::date AS dia
    FROM reproducciones r
    WHERE r.reproducido_en >= ($1::date::timestamp AT TIME ZONE $3)
      AND r.reproducido_en < ($2::date::timestamp AT TIME ZONE $3)
      AND r.usuario_id IN ($4::int, $5::int)
  ),
  dias_compartidos AS (
    SELECT dia FROM periodo GROUP BY dia HAVING COUNT(DISTINCT usuario_id) = 2
  ),
  canciones_usuario AS (
    SELECT usuario_id, cancion_id, COUNT(*)::int AS reproducciones
    FROM periodo GROUP BY usuario_id, cancion_id
  ),
  canciones_compartidas AS (
    SELECT cancion_id,
           SUM(reproducciones)::int AS total,
           MIN(reproducciones)::int AS equilibrio,
           (MAX(reproducciones) FILTER (WHERE usuario_id = $4))::int AS usuario_1,
           (MAX(reproducciones) FILTER (WHERE usuario_id = $5))::int AS usuario_2
    FROM canciones_usuario
    GROUP BY cancion_id
    HAVING COUNT(*) = 2
  ),
  artistas_usuario AS (
    SELECT p.usuario_id, ca.artista_id, COUNT(*)::int AS reproducciones
    FROM periodo p
    JOIN cancion_artistas ca ON ca.cancion_id = p.cancion_id
    GROUP BY p.usuario_id, ca.artista_id
  ),
  artistas_compartidos AS (
    SELECT artista_id FROM artistas_usuario GROUP BY artista_id HAVING COUNT(*) = 2
  ),
  primeras_por_usuario AS (
    SELECT r.usuario_id, r.cancion_id, MIN(r.reproducido_en) AS primera_vez
    FROM reproducciones r
    WHERE r.usuario_id IN ($4::int, $5::int)
    GROUP BY r.usuario_id, r.cancion_id
  ),
  orden_primeras AS (
    SELECT cancion_id,
           (array_agg(usuario_id ORDER BY primera_vez, usuario_id))[1] AS quien_primero,
           (array_agg(primera_vez ORDER BY primera_vez, usuario_id))[2] AS segunda_vez
    FROM primeras_por_usuario
    GROUP BY cancion_id
    HAVING COUNT(*) = 2
  ),
  presentaciones AS (
    SELECT quien_primero, COUNT(*)::int AS total
    FROM orden_primeras
    WHERE segunda_vez >= ($1::date::timestamp AT TIME ZONE $3)
      AND segunda_vez < ($2::date::timestamp AT TIME ZONE $3)
    GROUP BY quien_primero
  )
  SELECT
    (SELECT COUNT(*)::int FROM dias_compartidos) AS dias_compartidos,
    (SELECT COUNT(*)::int FROM canciones_compartidas) AS canciones_compartidas,
    (SELECT COUNT(*)::int FROM artistas_compartidos) AS artistas_compartidos,
    (SELECT COALESCE(MAX(total), 0)::int FROM presentaciones WHERE quien_primero = $4) AS presentadas_por_usuario_1,
    (SELECT COALESCE(MAX(total), 0)::int FROM presentaciones WHERE quien_primero = $5) AS presentadas_por_usuario_2,
    (
      SELECT jsonb_build_object(
        'nombre', c.nombre,
        'artistas', COALESCE(a.nombres, ''),
        'portada', al.imagen_url,
        'reproducciones_usuario_1', cc.usuario_1,
        'reproducciones_usuario_2', cc.usuario_2,
        'reproducciones_totales', cc.usuario_1 + cc.usuario_2
      )
      FROM canciones_compartidas cc
      JOIN canciones c ON c.id = cc.cancion_id
      LEFT JOIN albumes al ON al.id = c.album_id
      LEFT JOIN (
        SELECT ca.cancion_id, string_agg(DISTINCT ar.nombre, ', ') AS nombres
        FROM cancion_artistas ca JOIN artistas ar ON ar.id = ca.artista_id
        GROUP BY ca.cancion_id
      ) a ON a.cancion_id = c.id
      ORDER BY cc.equilibrio DESC, cc.total DESC, cc.cancion_id
      LIMIT 1
    ) AS cancion_compartida_destacada
`;

function obtenerMesActual(zonaHoraria) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date());
  const año = partes.find((parte) => parte.type === 'year').value;
  const mes = partes.find((parte) => parte.type === 'month').value;
  return `${año}-${mes}`;
}

function rangoMes(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '')) {
    throw new Error('El mes debe tener formato YYYY-MM.');
  }
  const [año, numeroMes] = mes.split('-').map(Number);
  const siguiente = new Date(Date.UTC(año, numeroMes, 1));
  return {
    inicio: `${mes}-01`,
    siguiente: `${siguiente.getUTCFullYear()}-${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}-01`
  };
}

function fechaUTC(fecha) {
  const [año, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(año, mes - 1, dia));
}

function sumarDias(fecha, cantidad) {
  const fechaDate = fechaUTC(fecha);
  fechaDate.setUTCDate(fechaDate.getUTCDate() + cantidad);
  return fechaDate.toISOString().slice(0, 10);
}

function calcularRacha(dias, hoy) {
  const conjunto = new Set(dias || []);
  let actual = 0;
  let cursor = hoy;
  if (!conjunto.has(cursor)) cursor = sumarDias(cursor, -1);
  while (conjunto.has(cursor)) {
    actual += 1;
    cursor = sumarDias(cursor, -1);
  }

  let mayor = 0;
  let racha = 0;
  let anterior = null;
  for (const dia of [...conjunto].sort()) {
    racha = anterior && sumarDias(anterior, 1) === dia ? racha + 1 : 1;
    mayor = Math.max(mayor, racha);
    anterior = dia;
  }
  return { racha_actual: actual, mejor_racha: mayor, dias_activos: conjunto.size };
}

function agruparNovedades(filas, tipo) {
  const agrupado = new Map();
  for (const fila of filas) {
    if (!agrupado.has(fila.usuario_id)) {
      agrupado.set(fila.usuario_id, { usuario_id: fila.usuario_id, total: fila.total, recientes: [] });
    }
    agrupado.get(fila.usuario_id).recientes.push({
      nombre: fila.nombre,
      artista: fila.artista || null,
      fecha: fila.fecha
    });
  }
  return [...agrupado.values()].map((item) => ({ ...item, tipo }));
}

async function calcularActividad({ mes, usuarioId = null }, database = db) {
  const { rows: usuarios } = await database.query(
    'SELECT id, nombre_display FROM usuarios_spotify ORDER BY id LIMIT 2'
  );
  const usuarioSeleccionado = usuarios.find((usuario) => usuario.id === Number(usuarioId));
  const filtroUsuario = usuarioSeleccionado ? usuarioSeleccionado.id : null;
  const mesSeleccionado = mes || obtenerMesActual(ZONA_HORARIA);
  const { inicio, siguiente } = rangoMes(mesSeleccionado);

  const [calendario, mapa, diasActivos, nuevasCanciones, nuevosArtistas, hoy] = await Promise.all([
    database.query(SQL_CALENDARIO, [inicio, siguiente, ZONA_HORARIA, filtroUsuario]),
    database.query(SQL_MAPA_HORARIO, [inicio, siguiente, ZONA_HORARIA, filtroUsuario]),
    database.query(SQL_DIAS_ACTIVOS, [filtroUsuario, ZONA_HORARIA]),
    database.query(SQL_PRIMERAS_CANCIONES, [inicio, siguiente, ZONA_HORARIA, filtroUsuario]),
    database.query(SQL_PRIMEROS_ARTISTAS, [inicio, siguiente, ZONA_HORARIA, filtroUsuario]),
    database.query("SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS fecha", [ZONA_HORARIA])
  ]);

  const rachas = diasActivos.rows.map((fila) => ({
    usuario_id: fila.usuario_id,
    nombre_display: usuarios.find((usuario) => usuario.id === fila.usuario_id)?.nombre_display || 'Cuenta',
    ...calcularRacha(fila.dias, hoy.rows[0].fecha)
  }));

  const descubrimientos = usuarios
    .filter((usuario) => !filtroUsuario || usuario.id === filtroUsuario)
    .map((usuario) => ({
      usuario_id: usuario.id,
      nombre_display: usuario.nombre_display,
      canciones: agruparNovedades(nuevasCanciones.rows, 'cancion').find((item) => item.usuario_id === usuario.id)
        || { total: 0, recientes: [] },
      artistas: agruparNovedades(nuevosArtistas.rows, 'artista').find((item) => item.usuario_id === usuario.id)
        || { total: 0, recientes: [] }
    }));

  let duo = null;
  if (!filtroUsuario && usuarios.length >= 2) {
    const resultadoDuo = await database.query(SQL_DUO, [
      inicio, siguiente, ZONA_HORARIA, usuarios[0].id, usuarios[1].id
    ]);
    duo = {
      ...resultadoDuo.rows[0],
      presentaciones: [
        {
          usuario_id: usuarios[0].id,
          nombre_display: usuarios[0].nombre_display,
          total: resultadoDuo.rows[0].presentadas_por_usuario_1
        },
        {
          usuario_id: usuarios[1].id,
          nombre_display: usuarios[1].nombre_display,
          total: resultadoDuo.rows[0].presentadas_por_usuario_2
        }
      ]
    };
  }

  return {
    mes: mesSeleccionado,
    zona_horaria: ZONA_HORARIA,
    alcance: filtroUsuario ? 'individual' : 'global',
    usuario_id: filtroUsuario,
    calendario: calendario.rows,
    mapa_horario: mapa.rows,
    rachas,
    descubrimientos,
    duo
  };
}

module.exports = { calcularActividad, calcularRacha, rangoMes };
