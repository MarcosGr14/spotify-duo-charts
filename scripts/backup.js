#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { pgConnection, caPath } = require('../src/pgConnection');

const tablas = ['albumes', 'artistas', 'cancion_artistas', 'canciones', 'reproduccion_actual', 'reproducciones', 'usuarios_spotify'];
function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    // No heredar stderr: pg_dump puede mostrar la conexión o información privada.
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.resume();
    child.on('error', () => reject(new Error(`${cmd} no disponible`)));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} terminó con error; revisar conectividad y versión de PostgreSQL`)));
  });
}
function pgEnv(connection) {
  const u = new URL(connection);
  return { PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: /\.(supabase\.com|supabase\.co)$/.test(u.hostname) ? 'verify-full' : (u.searchParams.get('sslmode') || 'require'), PGSSLROOTCERT: caPath, PGCONNECT_TIMEOUT: '15' };
}
function seal(payload, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([Buffer.from('DUOBK001'), salt, iv, cipher.getAuthTag(), data]);
}
function open(payload, pass) {
  if (payload.subarray(0, 8).toString() !== 'DUOBK001') throw new Error('Formato de respaldo desconocido');
  const key = crypto.scryptSync(pass, payload.subarray(8, 24), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(24, 36), { authTagLength: 16 });
  decipher.setAuthTag(payload.subarray(36, 52));
  return Buffer.concat([decipher.update(payload.subarray(52)), decipher.final()]);
}
async function crear() {
  const connection = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  const pass = process.env.BACKUP_PASSPHRASE;
  if (!connection || !pass || pass.length < 24 || !/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY || '')) throw new Error('Faltan conexión, clave de tokens o contraseña independiente de respaldo (mínimo 24 caracteres)');
  const pool = new Pool({ ...pgConnection(connection), max: 1, connectionTimeoutMillis: 15000 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-backup-'));
  try {
    await fs.chmod(dir, 0o700);
    await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snap = await pool.query('SELECT pg_export_snapshot() AS snapshot');
    const counts = {};
    for (const table of tablas) counts[table] = (await pool.query(`SELECT count(*)::text AS n FROM public.${table}`)).rows[0].n;
    const dumpPath = path.join(dir, 'db.dump');
    const schemas = ['--schema=public'];
    if ((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='app_private'")).rows.length) schemas.push('--schema=app_private');
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', ...schemas, `--snapshot=${snap.rows[0].snapshot}`, `--file=${dumpPath}`], pgEnv(connection));
    await pool.query('COMMIT');
    const dump = await fs.readFile(dumpPath);
    const roles = (await pool.query("SELECT DISTINCT unnest(roles)::text AS name FROM pg_policies WHERE schemaname IN ('public','app_private')")).rows.map((r) => r.name).filter((name) => name !== 'public');
    const manifest = { version: 1, createdAt: new Date().toISOString(), counts, roles, sha256: crypto.createHash('sha256').update(dump).digest('hex'), schemas: ['public', 'app_private'] };
    const encrypted = seal(Buffer.from(JSON.stringify({ manifest, encryptionKey: process.env.ENCRYPTION_KEY, dump: dump.toString('base64') })), pass);
    // Comprobar autenticación e integridad del archivo cifrado antes de entregarlo.
    const checked = JSON.parse(open(encrypted, pass));
    if (checked.manifest.sha256 !== manifest.sha256) throw new Error('Verificación de cifrado fallida');
    const out = path.resolve(process.env.BACKUP_OUTPUT_DIR || 'backups');
    await fs.mkdir(out, { recursive: true, mode: 0o700 });
    const file = path.join(out, `duo-${Date.now()}.duobak`);
    await fs.writeFile(file, encrypted, { mode: 0o600, flag: 'wx' });
    console.log(`Respaldo cifrado creado: ${file}`);
    return file;
  } finally { await pool.end(); await fs.rm(dir, { recursive: true, force: true }); }
}
async function verificar(file) {
  const connection = process.env.RESTORE_TEST_DATABASE_URL;
  if (!connection || connection === process.env.DATABASE_URL || connection === process.env.BACKUP_DATABASE_URL) throw new Error('Usar una base aislada RESTORE_TEST_DATABASE_URL, diferente de producción');
  const u = new URL(connection);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || !u.pathname.includes('duo_restore_test')) throw new Error('La restauración de prueba solo admite localhost y una base con nombre duo_restore_test');
  const bundle = JSON.parse(open(await fs.readFile(file), process.env.BACKUP_PASSPHRASE));
  const dump = Buffer.from(bundle.dump, 'base64');
  if (crypto.createHash('sha256').update(dump).digest('hex') !== bundle.manifest.sha256) throw new Error('Respaldo dañado');
  const pool = new Pool({ ...pgConnection(connection), connectionTimeoutMillis: 10000 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-restore-'));
  try {
    await fs.chmod(dir, 0o700);
    const tables = await pool.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
    if (tables.rows.length) throw new Error('La base de prueba debe estar vacía; no se borrará nada');
    const objects = await pool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`);
    if (objects.rows.length) throw new Error('El esquema de prueba debe estar vacío');
    // pg_dump crea public; quitar solo el esquema vacío creado por initdb.
    await pool.query('DROP SCHEMA IF EXISTS public');
    for (const role of bundle.manifest.roles || []) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(role)) throw new Error('Rol inválido en manifiesto');
      if (!(await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length) {
        await pool.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      }
    }
    const dumpPath = path.join(dir, 'db.dump'); await fs.writeFile(dumpPath, dump, { mode: 0o600 });
    await run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '-d', u.pathname.slice(1), dumpPath], pgEnv(connection));
    for (const [table, expected] of Object.entries(bundle.manifest.counts)) {
      if (!tablas.includes(table)) throw new Error('Tabla desconocida en manifiesto');
      const actual = (await pool.query(`SELECT count(*)::text AS n FROM public.${table}`)).rows[0].n;
      if (actual !== expected) throw new Error(`Conteo de ${table} no coincide`);
    }
    // La clave de tokens también se comprueba sin imprimirla.
    if (!/^[a-f0-9]{64}$/i.test(bundle.encryptionKey)) throw new Error('Clave de recuperación inválida');
    const tokens = await pool.query('SELECT access_token,refresh_token FROM public.usuarios_spotify');
    for (const row of tokens.rows) for (const payload of [row.access_token, row.refresh_token]) {
      if (/^AQ[A-Za-z0-9_-]+$/.test(payload)) continue; // compatibilidad antigua
      const data = Buffer.from(payload.startsWith('enc:v1:') ? payload.slice(7) : payload, 'base64');
      const dec = crypto.createDecipheriv('aes-256-gcm', Buffer.from(bundle.encryptionKey, 'hex'), data.subarray(0, 12), { authTagLength: 16 });
      dec.setAuthTag(data.subarray(12, 28)); dec.update(data.subarray(28)); dec.final();
    }
    console.log('Restauración comprobada: esquema, conteos y tokens recuperables.');
  } finally { await pool.end(); await fs.rm(dir, { recursive: true, force: true }); }
}
if (require.main === module) {
  const task = process.argv[2] === 'verify' ? verificar(process.argv[3]) : crear();
  task.catch(() => { console.error('Respaldo/restauración falló. Revisar variables, conectividad, versión de Postgres y base de prueba vacía.'); process.exitCode = 1; });
}
module.exports = { crear, verificar, seal, open };
