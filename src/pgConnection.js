const fs = require('fs');
const path = require('path');
const caPath = path.join(__dirname, '../db/certs/supabase-ca.crt');
function pgConnection(connectionString) {
  // pg también admite configuración mediante PGHOST/PGDATABASE o un pool inyectado.
  if (!connectionString) return {};
  const url = new URL(connectionString);
  if (!/\.(supabase\.com|supabase\.co)$/.test(url.hostname)) return { connectionString };
  // pg-connection-string puede sustituir ssl al interpretar sslmode en la URL.
  // Para Supabase siempre se comprueban CA y hostname con el certificado oficial.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ca: fs.readFileSync(caPath, 'utf8') } };
}
module.exports = { pgConnection, caPath };
