require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { pgConnection } = require('../src/pgConnection');
(async () => {
  const db = new Pool({ ...pgConnection(process.env.DATABASE_URL), connectionTimeoutMillis: 15000 });
  try {
    await db.query(fs.readFileSync(path.join(__dirname, '../db/updates/reliability-security.sql'), 'utf8'));
    const result = await db.query(`SELECT count(*)::int AS columnas FROM information_schema.columns
      WHERE table_schema='public' AND table_name='usuarios_spotify'
      AND column_name IN ('ultima_sincronizacion_en','ultimo_intento_en','ultimo_error_sync','posibles_huecos','elementos_fallidos')`);
    if (result.rows[0].columnas !== 5) throw new Error('Verificación fallida');
    console.log('Cambio aditivo verificado. No se modificaron reproducciones.');
  } catch (_) { console.error('No se pudo aplicar/verificar la preparación de fase 1 y 2.'); process.exitCode = 1; }
  finally { await db.end(); }
})();
