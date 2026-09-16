// Igual que musicMatch.test.js: se salta si no hay TEST_DATABASE_URL,
// resetea el schema en beforeAll (necesario porque --runInBand corre
// las suites en serie pero siguen compartiendo la misma base dentro
// del mismo job de CI).
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { calcularRecords } = require('../src/records');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeSiHayDB = TEST_DATABASE_URL ? describe : describe.skip;

// Zona horaria fija para los tests de Night Owl, independiente de lo
// que diga config.js/ZONA_HORARIA en el entorno donde corre Jest —
// así el test no depende de una env var externa. America/Panama es
// UTC-5 fijo (sin horario de verano), lo que hace la aritmética de
// horas simple y predecible entre corridas.
const ZONA_TEST = 'America/Panama';

describeSiHayDB('Records / Insights (requiere TEST_DATABASE_URL)', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
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

  // reproducido_en se inserta como timestamp UTC explícito (no
  // "hace N minutos" como en los otros suites) porque Night Owl
  // necesita controlar la HORA exacta, no solo que caiga dentro del
  // período de días.
  async function reproducirEnUTC(usuarioId, cancionId, timestampISO) {
    await pool.query(
      `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en) VALUES ($1, $2, $3)`,
      [usuarioId, cancionId, timestampISO]
    );
  }

  // Construye un timestamp UTC "hace N días, a tal hora UTC" relativo
  // al momento REAL en que corre el test — así siempre cae dentro de
  // la ventana de período (now() - 7 days), sin importar en qué fecha
  // calendario se ejecute la suite. Los tests de Night Owl controlan
  // la hora UTC exacta para forzar a qué hora local cae en America/Panama.
  function utcHaceDiasConHora(diasAtras, horaUTC, minutoUTC = 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - diasAtras);
    d.setUTCHours(horaUTC, minutoUTC, 0, 0);
    return d.toISOString();
  }

  async function reproducirHaceMinutos(usuarioId, cancionId, cantidad) {
    for (let i = 0; i < cantidad; i++) {
      await pool.query(
        `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en)
         VALUES ($1, $2, now() - ($3 || ' minutes')::interval)`,
        [usuarioId, cancionId, i]
      );
    }
  }

  async function reproducirHaceDias(usuarioId, cancionId, cantidad, haceCuantosDias) {
    for (let i = 0; i < cantidad; i++) {
      await pool.query(
        `INSERT INTO reproducciones (usuario_id, cancion_id, reproducido_en)
         VALUES ($1, $2, now() - ($3 || ' days')::interval - ($4 || ' minutes')::interval)`,
        [usuarioId, cancionId, haceCuantosDias, i]
      );
    }
  }

  // ==============================================================
  // MOST OBSESSED TRACK
  // ==============================================================
  describe('Most Obsessed Track', () => {
    test('1. selecciona correctamente la canción más reproducida', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const popular = await crearCancion('t-popular', 'La Popular', art);
      const otra = await crearCancion('t-otra', 'La Otra', art);

      await reproducirHaceMinutos(marcosId, popular, 10);
      await reproducirHaceMinutos(jackieId, otra, 2);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.most_obsessed_track.nombre).toBe('La Popular');
    });

    test('2. suma reproducciones de ambos usuarios combinadas', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancion = await crearCancion('t1', 'Canción', art);

      await reproducirHaceMinutos(marcosId, cancion, 5);
      await reproducirHaceMinutos(jackieId, cancion, 4);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.most_obsessed_track.reproducciones_totales).toBe(9);
      expect(resultado.most_obsessed_track.artista).toBe('Artista');
    });

    test('3. respeta el período (reproducciones viejas no cuentan)', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const vieja = await crearCancion('t-vieja', 'Vieja', art);
      const reciente = await crearCancion('t-reciente', 'Reciente', art);

      await reproducirHaceDias(marcosId, vieja, 20, 15); // fuera de la ventana de 7 días
      await reproducirHaceMinutos(jackieId, reciente, 2);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.most_obsessed_track.nombre).toBe('Reciente');
    });

    test('4. base sin reproducciones → null', async () => {
      await crearUsuario('marcos-id', 'Marcos');
      await crearUsuario('jackie-id', 'Jackie');

      const resultado = await calcularRecords(7, pool);
      expect(resultado.most_obsessed_track).toBeNull();
    });

    test('5. empate determinista: gana el cancion_id más bajo', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      // cA se crea primero => id más bajo
      const cA = await crearCancion('t-a', 'Zeta', art);
      const cB = await crearCancion('t-b', 'Alfa', art);

      await reproducirHaceMinutos(marcosId, cA, 5);
      await reproducirHaceMinutos(jackieId, cB, 5); // mismo total: empate

      const resultado = await calcularRecords(7, pool);
      expect(resultado.most_obsessed_track.nombre).toBe('Zeta'); // cA tiene id menor
    });
  });

  // ==============================================================
  // NIGHT OWL
  // ==============================================================
  describe('Night Owl', () => {
    test('6. cuenta solo reproducciones dentro del horario nocturno (00:00-05:59 hora local)', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancion = await crearCancion('t1', 'Canción', art);

      // America/Panama es UTC-5 fijo: 03:00 UTC = 22:00 local (día anterior, NO nocturno)
      //                                07:00 UTC = 02:00 local (SÍ nocturno)
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(1, 3)); // 22:00 local -> no nocturno
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(1, 7)); // 02:00 local -> nocturno

      const resultado = await calcularRecords(7, pool);
      expect(resultado.night_plays_total).toBe(1);
    });

    test('7. selecciona correctamente al usuario con más plays nocturnos', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancion = await crearCancion('t1', 'Canción', art);

      // 07:00 UTC = 02:00 local (nocturno) para ambos, pero Marcos escucha más
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(1, 7, 0));
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(1, 7, 10));
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(2, 7, 0));
      await reproducirEnUTC(jackieId, cancion, utcHaceDiasConHora(1, 7, 0));

      const resultado = await calcularRecords(7, pool);
      expect(resultado.night_owl.nombre_display).toBe('Marcos');
      expect(resultado.night_owl.reproducciones_nocturnas).toBe(3);
    });

    test('8. calcula el porcentaje sobre el total nocturno del dúo', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancion = await crearCancion('t1', 'Canción', art);

      for (let i = 1; i <= 3; i++) {
        await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(i, 7));
      }
      await reproducirEnUTC(jackieId, cancion, utcHaceDiasConHora(1, 7));

      const resultado = await calcularRecords(7, pool);
      // Marcos: 3 de 4 nocturnas totales => 75%
      expect(resultado.night_plays_total).toBe(4);
      expect(resultado.night_owl.porcentaje_nocturno).toBe(75);
    });

    test('9. cero reproducciones nocturnas → night_owl null', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancion = await crearCancion('t1', 'Canción', art);

      // 12:00 UTC = 07:00 local -> NO nocturno
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(1, 12));
      await reproducirEnUTC(jackieId, cancion, utcHaceDiasConHora(1, 13));

      const resultado = await calcularRecords(7, pool);
      expect(resultado.night_owl).toBeNull();
      expect(resultado.night_plays_total).toBe(0);
    });

    test('10. respeta la zona horaria: una hora que es de día en UTC pero de noche en America/Panama', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancion = await crearCancion('t1', 'Canción', art);

      // 09:00 UTC = 04:00 local en America/Panama (UTC-5) -> SÍ nocturno,
      // aunque en UTC "9am" suene a horario diurno. Esto es justamente
      // lo que prueba que la conversión de zona horaria se está aplicando
      // y no comparando la hora UTC cruda.
      await reproducirEnUTC(marcosId, cancion, utcHaceDiasConHora(1, 9));

      const resultado = await calcularRecords(7, pool);
      expect(resultado.night_plays_total).toBe(1);
      expect(resultado.night_owl.nombre_display).toBe('Marcos');
    });
  });

  // ==============================================================
  // SHARED OBSESSION
  // ==============================================================
  describe('Shared Obsession', () => {
    test('11. solo considera canciones escuchadas por ambos usuarios', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const compartida = await crearCancion('t-shared', 'Compartida', art);
      const soloMarcos = await crearCancion('t-solo', 'Solo Marcos', art);

      await reproducirHaceMinutos(marcosId, compartida, 3);
      await reproducirHaceMinutos(jackieId, compartida, 3);
      await reproducirHaceMinutos(marcosId, soloMarcos, 10); // no cuenta, Jackie no la escuchó

      const resultado = await calcularRecords(7, pool);
      expect(resultado.shared_obsession.nombre).toBe('Compartida');
    });

    test('12. mismo artista pero canciones diferentes no cuenta como shared', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Mismo Artista');
      const cancionMarcos = await crearCancion('t-1', 'Canción Uno', art);
      const cancionJackie = await crearCancion('t-2', 'Canción Dos', art);

      await reproducirHaceMinutos(marcosId, cancionMarcos, 5);
      await reproducirHaceMinutos(jackieId, cancionJackie, 5);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.shared_obsession).toBeNull();
    });

    test('13. aplica la fórmula MIN(): 10/9 le gana a 20/1', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const balanceada = await crearCancion('t-balanceada', 'Balanceada', art);
      const desbalanceada = await crearCancion('t-desbalanceada', 'Desbalanceada', art);

      await reproducirHaceMinutos(marcosId, balanceada, 10);
      await reproducirHaceMinutos(jackieId, balanceada, 9);
      await reproducirHaceMinutos(marcosId, desbalanceada, 20);
      await reproducirHaceMinutos(jackieId, desbalanceada, 1);

      const resultado = await calcularRecords(7, pool);
      // MIN(10,9)=9 > MIN(20,1)=1, aunque el total de "Desbalanceada" (21) sea mayor
      expect(resultado.shared_obsession.nombre).toBe('Balanceada');
      expect(resultado.shared_obsession.plays_usuario_1).toBe(10);
      expect(resultado.shared_obsession.plays_usuario_2).toBe(9);
    });

    test('14. desempate por total combinado cuando MIN() es igual', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancionA = await crearCancion('t-a', 'Cancion A', art); // MIN=5, total=10
      const cancionB = await crearCancion('t-b', 'Cancion B', art); // MIN=5, total=15

      await reproducirHaceMinutos(marcosId, cancionA, 5);
      await reproducirHaceMinutos(jackieId, cancionA, 5);
      await reproducirHaceMinutos(marcosId, cancionB, 10);
      await reproducirHaceMinutos(jackieId, cancionB, 5);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.shared_obsession.nombre).toBe('Cancion B'); // mismo MIN, más total
    });

    test('15. sin canciones compartidas → null', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const artA = await crearArtista('a-id', 'Artista A');
      const artB = await crearArtista('b-id', 'Artista B');
      const cA = await crearCancion('t-a', 'De Marcos', artA);
      const cB = await crearCancion('t-b', 'De Jackie', artB);

      await reproducirHaceMinutos(marcosId, cA, 5);
      await reproducirHaceMinutos(jackieId, cB, 5);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.shared_obsession).toBeNull();
    });

    test('16. respeta el período (reproducciones viejas de ambos no cuentan)', async () => {
      const marcosId = await crearUsuario('marcos-id', 'Marcos');
      const jackieId = await crearUsuario('jackie-id', 'Jackie');
      const art = await crearArtista('a-id', 'Artista');
      const cancionVieja = await crearCancion('t-vieja', 'Vieja', art);

      await reproducirHaceDias(marcosId, cancionVieja, 5, 20);
      await reproducirHaceDias(jackieId, cancionVieja, 5, 20);

      const resultado = await calcularRecords(7, pool);
      expect(resultado.shared_obsession).toBeNull();
    });
  });

  // ==============================================================
  // Casos generales (no pedidos explícitamente en la lista de 16,
  // pero cubren el contrato del endpoint completo)
  // ==============================================================
  test('con una sola cuenta conectada, devuelve disponible:false', async () => {
    await crearUsuario('marcos-id', 'Marcos');
    const resultado = await calcularRecords(7, pool);
    expect(resultado.disponible).toBe(false);
  });

  test('con 2 cuentas y cero reproducciones, disponible:true pero todo en null/0', async () => {
    await crearUsuario('marcos-id', 'Marcos');
    await crearUsuario('jackie-id', 'Jackie');
    const resultado = await calcularRecords(7, pool);
    expect(resultado.disponible).toBe(true);
    expect(resultado.most_obsessed_track).toBeNull();
    expect(resultado.night_owl).toBeNull();
    expect(resultado.night_plays_total).toBe(0);
    expect(resultado.shared_obsession).toBeNull();
  });
});