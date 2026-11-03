#!/usr/bin/env node
// Actualización interactiva: las contraseñas nunca van al chat ni al historial de comandos.
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { pgConnection } = require('../src/pgConnection');
function buildUrl(base, role, password) {
  const u = new URL(base);
  if (!password || !['duo_runtime','postgres'].includes(role)) throw new Error('Datos inválidos');
  if (!/\.(supabase\.com|supabase\.co)$/.test(u.hostname)) throw new Error('Se esperaba el proyecto Supabase');
  u.username = `${role}.fnotlneiauhkjsgynxuk`;
  // Contraseñas se codifican por completo, incluidos delimitadores de .env.
  u.password = encodeURIComponent(password);
  u.port = '5432';
  return u.toString();
}
function secreto(prompt) {
  if (!process.stdin.isTTY) throw new Error('Ejecutar desde una terminal interactiva');
  process.stdout.write(prompt);
  const silent = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const rl = readline.createInterface({ input: process.stdin, output: silent, terminal: true });
  return new Promise((resolve, reject) => {
    rl.once('SIGINT', () => { rl.close(); process.stdout.write('\n'); reject(new Error('Cancelado')); });
    rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}
async function verificar(url, expected) {
  const pool = new Pool({ ...pgConnection(url), connectionTimeoutMillis: 10000, query_timeout: 10000 });
  try {
    const { rows } = await pool.query('SELECT current_user AS role');
    if (rows[0].role !== expected) throw new Error('Cuenta inesperada');
    await pool.query('SELECT count(*) FROM public.reproducciones');
    if (expected === 'duo_runtime') await pool.query('SELECT clave FROM app_private.runtime LIMIT 0');
  } finally { await pool.end(); }
}
async function main() {
  const envFile = path.resolve('.env');
  let contents = await fs.readFile(envFile, 'utf8');
  const previous = dotenv.parse(contents);
  const base = previous.BACKUP_DATABASE_URL || previous.DATABASE_URL;
  const runtime = buildUrl(base, 'duo_runtime', await secreto('Contraseña de duo_runtime (oculta): '));
  const backup = buildUrl(base, 'postgres', await secreto('Nueva contraseña GENERAL de Supabase (oculta): '));
  console.log('Verificando ambas conexiones con TLS y acceso al historial…');
  await verificar(runtime, 'duo_runtime');
  await verificar(backup, 'postgres');
  for (const [key, value] of Object.entries({ DATABASE_URL: runtime, BACKUP_DATABASE_URL: backup })) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  const temp = `${envFile}.update-${process.pid}`;
  try {
    await fs.writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, envFile);
  } finally { await fs.rm(temp, { force: true }); }
  console.log('Conexión local actualizada y comprobada.');
  const result = spawnSync('gh', ['secret','set','BACKUP_DATABASE_URL','--repo','MarcosGr14/spotify-duo-charts'],
    { input: backup, encoding: 'utf8', timeout: 20000, stdio: ['pipe','ignore','ignore'] });
  if (result.status !== 0) throw new Error('LOCAL_OK_GITHUB_PENDING');
  console.log('BACKUP_DATABASE_URL actualizado en GitHub. Contraseñas no mostradas.');
}
if (require.main === module) main().catch((error) => {
  console.error(error.message === 'LOCAL_OK_GITHUB_PENDING' ? 'El .env quedó actualizado; falta reintentar el secreto de GitHub.' : 'No se completó la actualización. Comprueba las contraseñas y la conexión; no se muestran detalles sensibles.');
  process.exitCode = 1;
});
module.exports = { buildUrl };
