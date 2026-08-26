// Estos tests necesitan una base de Postgres real (las queries usan
// funciones específicas de Postgres como RANK() OVER, make_interval,
// generate_series — no se pueden simular con un mock). Se conectan a
// TEST_DATABASE_URL, que NUNCA debe apuntar a la base de datos real
// de producción — estos tests BORRAN todo el contenido de las tablas
// antes de cada uno.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const chartsApi = require('../src/chartsApi');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { canciones: QUERY_CANCIONES, artistas: QUERY_ARTISTAS, albumes: QUERY_ALBUMES } =
  chartsApi.QUERIES_POR_TIPO;

// Si no hay TEST_DATABASE_URL configurada, saltamos todo este archivo
// en vez de fallar — así npm test sigue siendo útil aunque no tengas
// Postgres a mano (por ejemplo, en tu compu local con el problema de
// red a Supabase). En GitHub Actions sí va a estar siempre configurada.
const describeSiHayDB = TEST_DATABASE_URL ? describe : describe.skip;

describeSiHayDB('cálculo de rankings (requiere TEST_DATABASE_URL)', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await pool.query(schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Limpiamos todo antes de cada test para que no se pisen entre sí
    await pool.query(
      'TRUNCATE reproducciones, reproduccion_actual, cancion_artistas, canciones, albumes, artistas, usuarios_spotify RESTART IDENTITY CASCADE'
    );
    await pool.query(`
      INSERT INTO usuarios_spotify (spotify_user_id, nombre_display, access_token, refresh_token, token_expira_en)
      VALUES ('test-user', 'Test', 'x', 'y', now() + interval '1 hour')
    `);
  });

  async function insertarCancion({ spotifyId, nombre, artista }) {
    const { rows: [art] } = await pool.query(
      `INSERT INTO artistas (spotify_artist_id, nombre) VALUES ($1, $2)
       ON CONFLICT (spotify_artist_id) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [`artist-${artista}`, artista]
    );
    const { rows: [c] } = await pool.query(
      `INSERT INTO canciones (spotify_track_id, nombre) VALUES ($1, $2) RETURNING id`,
      [spotifyId, nombre]
    );
    await pool.query(`INSERT INTO cancion_artistas (cancion_id, artista_id) VALUES ($1, $2)`, [
      c.id,
      art.id
    ]);
    return c.id;
  }

  async function reproducir(cancionId, cantidad, haceCuantosDias = 0) {
    for (let i = 0; i < cantidad; i++) {
      await pool.query(
        `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en)
         VALUES (1, $1, now() - ($2 || ' days')::interval - ($3 || ' minutes')::interval)`,
        [cancionId, haceCuantosDias, i]
      );
    }
  }

  test('ordena las canciones por cantidad de reproducciones, de más a menos', async () => {
    const idA = await insertarCancion({ spotifyId: 't1', nombre: 'La más escuchada', artista: 'Grupo A' });
    const idB = await insertarCancion({ spotifyId: 't2', nombre: 'La del medio', artista: 'Grupo B' });
    const idC = await insertarCancion({ spotifyId: 't3', nombre: 'La menos escuchada', artista: 'Grupo C' });
    await reproducir(idA, 10);
    await reproducir(idB, 5);
    await reproducir(idC, 1);

    const { rows } = await pool.query(QUERY_CANCIONES, [7, null, 20, 0, null]);

    expect(rows.map((r) => r.nombre)).toEqual([
      'La más escuchada',
      'La del medio',
      'La menos escuchada'
    ]);
    expect(rows[0].posicion).toBe(1);
    expect(rows[1].posicion).toBe(2);
    expect(rows[2].posicion).toBe(3);
  });

  // Este es el caso que nos generó un bug real en el dashboard: cuando
  // dos canciones empatan en reproducciones, RANK() les da la MISMA
  // posición (no 1 y 2 — las dos son 1, y la siguiente salta a 3).
  test('las canciones empatadas comparten la misma posición (RANK, no ROW_NUMBER)', async () => {
    const idA = await insertarCancion({ spotifyId: 't1', nombre: 'Empatada 1', artista: 'X' });
    const idB = await insertarCancion({ spotifyId: 't2', nombre: 'Empatada 2', artista: 'Y' });
    const idC = await insertarCancion({ spotifyId: 't3', nombre: 'Tercera', artista: 'Z' });
    await reproducir(idA, 5);
    await reproducir(idB, 5); // mismo total que idA
    await reproducir(idC, 2);

    const { rows } = await pool.query(QUERY_CANCIONES, [7, null, 20, 0, null]);
    const porNombre = Object.fromEntries(rows.map((r) => [r.nombre, r.posicion]));

    expect(porNombre['Empatada 1']).toBe(1);
    expect(porNombre['Empatada 2']).toBe(1);
    expect(porNombre['Tercera']).toBe(3); // salta el 2, como corresponde con RANK()
  });

  test('calcula "cambio" comparando el período actual contra el anterior', async () => {
    const idA = await insertarCancion({ spotifyId: 't1', nombre: 'Subiendo', artista: 'X' });
    const idB = await insertarCancion({ spotifyId: 't2', nombre: 'Bajando', artista: 'Y' });

    // Semana pasada (días 8-14 atrás): "Subiendo" tenía pocas, "Bajando" tenía muchas
    await reproducir(idA, 1, 10);
    await reproducir(idB, 8, 10);
    // Esta semana (últimos 7 días): se invierte
    await reproducir(idA, 8, 1);
    await reproducir(idB, 1, 1);

    const { rows } = await pool.query(QUERY_CANCIONES, [7, null, 20, 0, null]);
    const subiendo = rows.find((r) => r.nombre === 'Subiendo');
    const bajando = rows.find((r) => r.nombre === 'Bajando');

    expect(subiendo.posicion).toBe(1); // ahora es la más escuchada
    expect(subiendo.posicion_anterior).toBe(2); // antes era la segunda
    expect(bajando.posicion).toBe(2);
    expect(bajando.posicion_anterior).toBe(1);
  });

  // El bug que probamos a mano en la sesión de búsqueda: al filtrar por
  // artista, la posición mostrada tiene que seguir siendo la posición
  // REAL dentro de todo el ranking, no una renumeración del resultado
  // filtrado (si buscás algo que está en el puesto #5, tiene que seguir
  // diciendo #5, no #1).
  test('la búsqueda por artista conserva la posición real, no renumera', async () => {
    const idA = await insertarCancion({ spotifyId: 't1', nombre: 'Top 1', artista: 'Popular' });
    const idB = await insertarCancion({ spotifyId: 't2', nombre: 'Top 2', artista: 'Popular' });
    const idC = await insertarCancion({ spotifyId: 't3', nombre: 'La buscada', artista: 'Buscado' });
    await reproducir(idA, 10);
    await reproducir(idB, 8);
    await reproducir(idC, 3); // esta va a quedar en la posición 3

    const { rows } = await pool.query(QUERY_CANCIONES, [7, null, 20, 0, 'Buscado']);

    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe('La buscada');
    expect(rows[0].posicion).toBe(3); // NO debe ser 1
  });

  test('el ranking de artistas suma las reproducciones de todas sus canciones', async () => {
    const idA = await insertarCancion({ spotifyId: 't1', nombre: 'Canción 1', artista: 'Mismo Artista' });
    const idB = await insertarCancion({ spotifyId: 't2', nombre: 'Canción 2', artista: 'Mismo Artista' });
    await reproducir(idA, 4);
    await reproducir(idB, 3);

    const { rows } = await pool.query(QUERY_ARTISTAS, [7, null, 20, 0, null]);

    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe('Mismo Artista');
    expect(Number(rows[0].veces_escuchada)).toBe(7); // 4 + 3
  });

  test('una búsqueda sin resultados no rompe, devuelve array vacío', async () => {
    await insertarCancion({ spotifyId: 't1', nombre: 'Algo', artista: 'X' });
    const { rows } = await pool.query(QUERY_CANCIONES, [7, null, 20, 0, 'ArtistaQueNoExiste']);
    expect(rows).toEqual([]);
  });
});
