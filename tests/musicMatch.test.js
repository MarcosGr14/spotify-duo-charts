// Igual que rankings.test.js: se salta si no hay TEST_DATABASE_URL,
// pero cuando corre en GitHub Actions siempre va a estar seteada.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { calcularMusicMatch } = require('../src/musicMatch');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeSiHayDB = TEST_DATABASE_URL ? describe : describe.skip;

describeSiHayDB('Music Match (requiere TEST_DATABASE_URL)', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    // Mismo reset que en rankings.test.js: con --runInBand las suites
    // ya no compiten en paralelo, pero siguen compartiendo la base
    // dentro del mismo job — sin esto, la segunda suite en correr
    // choca contra las tablas que dejó la primera.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await pool.query(schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE reproducciones, reproduccion_actual, cancion_artistas, canciones, albumes, artistas, usuarios_spotify RESTART IDENTITY CASCADE'
    );
  });

  async function crearUsuario(spotifyId, nombre) {
    const { rows } = await pool.query(
      `INSERT INTO usuarios_spotify (spotify_user_id, nombre_display, access_token, refresh_token, token_expira_en)
       VALUES ($1, $2, 'x', 'y', now() + interval '1 hour') RETURNING id`,
      [spotifyId, nombre]
    );
    return rows[0].id;
  }

  async function crearArtista(spotifyId, nombre) {
    const { rows } = await pool.query(
      `INSERT INTO artistas (spotify_artist_id, nombre) VALUES ($1, $2) RETURNING id`,
      [spotifyId, nombre]
    );
    return rows[0].id;
  }

  async function crearCancion(spotifyId, nombre, artistaId) {
    const { rows } = await pool.query(
      `INSERT INTO canciones (spotify_track_id, nombre) VALUES ($1, $2) RETURNING id`,
      [spotifyId, nombre]
    );
    await pool.query(`INSERT INTO cancion_artistas (cancion_id, artista_id) VALUES ($1, $2)`, [
      rows[0].id,
      artistaId
    ]);
    return rows[0].id;
  }

  async function reproducir(usuarioId, cancionId, cantidad) {
    for (let i = 0; i < cantidad; i++) {
      await pool.query(
        `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en)
         VALUES ($1, $2, now() - ($3 || ' minutes')::interval)`,
        [usuarioId, cancionId, i]
      );
    }
  }

  // Reproduce EXACTAMENTE el escenario que ya habían validado en la
  // sesión anterior: 4 artistas distintos, 2 compartidos, 50%, TWICE
  // con 13 reproducciones combinadas, aespa con 7, balance ~46/54.
  test('escenario controlado: 50%, TWICE 13 combinadas, aespa 7, balance ~46/54', async () => {
    const marcosId = await crearUsuario('marcos-id', 'Marcos');
    const jackieId = await crearUsuario('jackie-id', 'Jackie');

    const twiceId = await crearArtista('twice-id', 'TWICE');
    const aespaId = await crearArtista('aespa-id', 'aespa');
    const xgId = await crearArtista('xg-id', 'XG');
    const nmixxId = await crearArtista('nmixx-id', 'NMIXX');

    const cTwice = await crearCancion('t-twice', 'Cancion TWICE', twiceId);
    const cAespa = await crearCancion('t-aespa', 'Cancion aespa', aespaId);
    const cXg = await crearCancion('t-xg', 'Cancion XG', xgId);
    const cNmixx = await crearCancion('t-nmixx', 'Cancion NMIXX', nmixxId);

    // Marcos: TWICE 6 + aespa 3 + XG 4 = 13 reproducciones totales
    await reproducir(marcosId, cTwice, 6);
    await reproducir(marcosId, cAespa, 3);
    await reproducir(marcosId, cXg, 4);

    // Jackie: TWICE 7 + aespa 4 + NMIXX 4 = 15 reproducciones totales
    await reproducir(jackieId, cTwice, 7);
    await reproducir(jackieId, cAespa, 4);
    await reproducir(jackieId, cNmixx, 4);

    const resultado = await calcularMusicMatch(7, pool);

    expect(resultado.disponible).toBe(true);
    expect(resultado.artistas_union).toBe(4);
    expect(resultado.artistas_compartidos).toBe(2);
    expect(resultado.porcentaje).toBe(50);
    expect(resultado.artista_principal.nombre).toBe('TWICE');
    expect(resultado.artista_principal.reproducciones_totales).toBe(13);

    const balanceMarcos = resultado.balance.find((b) => b.usuario_id === marcosId);
    const balanceJackie = resultado.balance.find((b) => b.usuario_id === jackieId);
    expect(balanceMarcos.reproducciones).toBe(13);
    expect(balanceJackie.reproducciones).toBe(15);
    expect(balanceMarcos.porcentaje).toBeCloseTo(46.4, 1);
    expect(balanceJackie.porcentaje).toBeCloseTo(53.6, 1);
  });

  test('sin artistas compartidos da 0%, no rompe', async () => {
    const marcosId = await crearUsuario('marcos-id', 'Marcos');
    const jackieId = await crearUsuario('jackie-id', 'Jackie');
    const artA = await crearArtista('a-id', 'Solo Marcos');
    const artB = await crearArtista('b-id', 'Solo Jackie');
    const cA = await crearCancion('t-a', 'Cancion A', artA);
    const cB = await crearCancion('t-b', 'Cancion B', artB);

    await reproducir(marcosId, cA, 5);
    await reproducir(jackieId, cB, 5);

    const resultado = await calcularMusicMatch(7, pool);
    expect(resultado.porcentaje).toBe(0);
    expect(resultado.artistas_compartidos).toBe(0);
    expect(resultado.artista_principal).toBeNull();
  });

  test('sin ninguna reproducción da union=0 y no divide por cero', async () => {
    await crearUsuario('marcos-id', 'Marcos');
    await crearUsuario('jackie-id', 'Jackie');

    const resultado = await calcularMusicMatch(7, pool);
    expect(resultado.artistas_union).toBe(0);
    expect(resultado.porcentaje).toBe(0);
    expect(resultado.balance[0].porcentaje).toBe(0);
    expect(resultado.balance[1].porcentaje).toBe(0);
  });

  test('con una sola cuenta conectada, devuelve disponible:false en vez de romper', async () => {
    await crearUsuario('marcos-id', 'Marcos');
    const resultado = await calcularMusicMatch(7, pool);
    expect(resultado.disponible).toBe(false);
  });

  test('reproducciones fuera del período no cuentan (respeta la ventana de días)', async () => {
    const marcosId = await crearUsuario('marcos-id', 'Marcos');
    const jackieId = await crearUsuario('jackie-id', 'Jackie');
    const artA = await crearArtista('a-id', 'Viejo');
    const cA = await crearCancion('t-a', 'Cancion vieja', artA);

    await pool.query(
      `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en)
       VALUES ($1, $2, now() - interval '20 days')`,
      [marcosId, cA]
    );
    await pool.query(
      `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en)
       VALUES ($1, $2, now() - interval '20 days')`,
      [jackieId, cA]
    );

    const resultado = await calcularMusicMatch(7, pool);
    expect(resultado.artistas_union).toBe(0);
  });
});