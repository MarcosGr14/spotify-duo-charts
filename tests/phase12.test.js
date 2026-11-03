process.env.ENCRYPTION_KEY = 'a'.repeat(64);
jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('axios', () => ({ request: jest.fn() }));
const db = require('../src/db');
const axios = require('axios');
const express = require('express');

beforeEach(() => { jest.clearAllMocks(); });
test('el respaldo detecta corrupción y contraseña incorrecta', () => {
  const { seal, open } = require('../scripts/backup');
  const payload = seal(Buffer.from('private-data'), 'independent-password-long-enough');
  expect(open(payload, 'independent-password-long-enough').toString()).toBe('private-data');
  expect(() => open(payload, 'wrong')).toThrow();
  payload[payload.length - 1] ^= 1;
  expect(() => open(payload, 'independent-password-long-enough')).toThrow();
});
test('un token cifrado corrupto nunca se devuelve como token plano', () => {
  const { encrypt, decryptSafe } = require('../src/crypto');
  const value = Buffer.from(encrypt('private-token').slice(7), 'base64');
  value[value.length - 1] ^= 1;
  expect(() => decryptSafe('enc:v1:' + value.toString('base64'))).toThrow();
});
test('la pausa 429 bloquea también otros endpoints y sobrevive en DB', async () => {
  jest.resetModules();
  const pool = require('../src/db'), http = require('axios');
  const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  pool.query.mockResolvedValue({ rows: [] });
  http.request.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '600' }, data: { error: { reason: 'QUOTA_EXCEEDED' } } } });
  const client = require('../src/spotifyClient');
  await expect(client.request({ url: 'https://api.spotify.com/v1/artists/a' })).rejects.toBeDefined();
  await expect(client.request({ url: 'https://api.spotify.com/v1/me/player/recently-played' })).rejects.toMatchObject({ code: 'SPOTIFY_PAUSED' });
  expect(http.request).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO app_private.runtime'))).toBe(true);
  spy.mockRestore();
});
async function conServidor(router, task) {
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await task(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
test('callback sin state no contacta Spotify', async () => {
  jest.resetModules();
  const { router } = require('../src/spotifyAuth');
  await conServidor(router, async (base) => {
    expect((await fetch(base + '/callback?code=untrusted')).status).toBe(400);
    expect(require('axios').request).not.toHaveBeenCalled();
  });
});
test('callback exige nonce del navegador y consumo válido en DB', async () => {
  jest.resetModules();
  require('../src/db').query.mockResolvedValue({ rows: [] });
  const { router } = require('../src/spotifyAuth');
  await conServidor(router, async (base) => {
    const result = await fetch(base + '/callback?code=x&state=' + 'a'.repeat(64), { headers: { cookie: 'duo_oauth=browser' } });
    expect(result.status).toBe(400);
    expect(require('axios').request).not.toHaveBeenCalled();
    expect(require('../src/db').query.mock.calls[0][0]).toContain('DELETE FROM app_private.runtime');
  });
});
test('modo privado bloquea interfaz y API sin credencial válida', async () => {
  process.env.SITE_VISIBILITY = 'private'; process.env.SITE_PASSWORD = 'private-password-long-enough';
  const { accesoPrivado } = require('../src/security');
  const router = express.Router(); router.use(accesoPrivado); router.get('/api/test', (_, res) => res.json({ ok: true }));
  try { await conServidor(router, async (base) => {
    expect((await fetch(base + '/api/test')).status).toBe(401);
    const good = await fetch(base + '/api/test', { headers: { authorization: 'Basic ' + Buffer.from('duo:' + process.env.SITE_PASSWORD).toString('base64') } });
    expect(good.status).toBe(200);
  }); } finally { delete process.env.SITE_VISIBILITY; delete process.env.SITE_PASSWORD; }
});
test('un fallo temporal de refresh no exige reconectar la cuenta', async () => {
  jest.resetModules();
  const pool = require('../src/db');
  pool.query.mockImplementation(async (sql) => ({ rows: sql.startsWith('SELECT * FROM usuarios') ? [{ id: 1, access_token: 'AQold', refresh_token: 'AQrefresh', token_expira_en: '2000-01-01' }] : [] }));
  require('axios').request.mockRejectedValue({ code: 'ETIMEDOUT' });
  const { obtenerAccessTokenValido } = require('../src/spotifyAuth');
  await expect(obtenerAccessTokenValido(1)).rejects.toBeDefined();
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('necesita_reconexion=true'))).toBe(false);
});
test('invalid_grant sí marca la cuenta para reconexión', async () => {
  jest.resetModules();
  const pool = require('../src/db');
  pool.query.mockImplementation(async (sql) => ({ rows: sql.startsWith('SELECT * FROM usuarios') ? [{ id: 1, access_token: 'AQold', refresh_token: 'AQrefresh', token_expira_en: '2000-01-01' }] : [] }));
  require('axios').request.mockRejectedValue({ response: { status: 400, data: { error: 'invalid_grant' } } });
  await expect(require('../src/spotifyAuth').obtenerAccessTokenValido(1)).rejects.toBeDefined();
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('necesita_reconexion=true'))).toBe(true);
});
test('un elemento defectuoso no impide guardar las siguientes reproducciones', async () => {
  jest.resetModules();
  jest.doMock('../src/spotifyAuth', () => ({ obtenerAccessTokenValido: jest.fn().mockResolvedValue('AQtoken') }));
  jest.doMock('../src/catalog', () => ({ upsertCancion: jest.fn().mockResolvedValue(1) }));
  const pool = require('../src/db'); pool.query.mockResolvedValue({ rows: [] });
  const fecha = new Date().toISOString();
  require('axios').request.mockResolvedValue({ data: { items: [{ track: null, played_at: fecha }, { track: { id: 'valid' }, played_at: fecha }] } });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await require('../src/poller').pollRecentlyPlayed({ id: 1 });
  expect(pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO reproducciones'))).toHaveLength(1);
  expect(pool.query.mock.calls.at(-1)[1]).toEqual([1, 1, 'ITEMS_FAILED', 0]);
  spy.mockRestore();
});
test('el planificador no solapa trabajo aunque transcurra el intervalo', async () => {
  jest.useFakeTimers();
  let finish; const tarea = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const stop = require('../src/workers').programar('test', tarea, 1000);
  await Promise.resolve(); await jest.advanceTimersByTimeAsync(5000);
  expect(tarea).toHaveBeenCalledTimes(1);
  finish(); await Promise.resolve();
  await stop(); jest.useRealTimers();
});
test('parámetros repetidos y rangos gigantes son rechazados sin llegar a SQL', async () => {
  const { configureSecurity } = require('../src/security');
  const app = express(); configureSecurity(app); app.get('/api/charts', (_, res) => res.json({ ok: true }));
  await conServidor(app, async (base) => {
    expect((await fetch(base + '/api/charts?dias=9999999')).status).toBe(400);
    expect((await fetch(base + '/api/charts?busqueda=x&busqueda=y')).status).toBe(400);
    const good = await fetch(base + '/api/charts?dias=36500');
    expect(good.status).toBe(200);
    expect(good.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(good.headers.get('x-powered-by')).toBeNull();
  });
});
