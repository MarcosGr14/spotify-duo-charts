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

module.exports = pool;
