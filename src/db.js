const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Evita que /health y las APIs queden esperando indefinidamente
  // cuando la red local no puede alcanzar el PostgreSQL remoto.
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres:', err);
});

module.exports = pool;
