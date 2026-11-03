const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');
const { pgConnection } = require('./pgConnection');

const pool = new Pool({
  ...pgConnection(DATABASE_URL),
  // Evita que /health y las APIs queden esperando indefinidamente
  // cuando la red local no puede alcanzar el PostgreSQL remoto.
  connectionTimeoutMillis: 10000,
  query_timeout: 15000,
  statement_timeout: 15000,
  max: 5,
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('Error en el pool de Postgres:', err.code || 'DB_ERROR');
});

const metrics = { queries: 0, failures: 0, slow: 0, totalMs: 0 };
const query = pool.query.bind(pool);
pool.query = async (...args) => {
  const start = performance.now();
  metrics.queries++;
  try { return await query(...args); }
  catch (err) { metrics.failures++; throw err; }
  finally {
    const elapsed = performance.now() - start; metrics.totalMs += elapsed;
    if (elapsed >= 500) metrics.slow++;
  }
};
pool.performanceStats = () => ({ ...metrics, connections: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
module.exports = pool;
