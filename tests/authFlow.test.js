process.env.ENCRYPTION_KEY = 'a'.repeat(64);
jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('../src/spotifyClient', () => ({ request: jest.fn() }));
const express = require('express');
const db = require('../src/db');
const spotify = require('../src/spotifyClient');
const { router } = require('../src/spotifyAuth');
let server, base;
beforeAll(async () => {
  const app = express(); app.use(router); server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { jest.clearAllMocks(); });
const callback = () => fetch(`${base}/callback?state=${'a'.repeat(64)}&code=code`, { headers: { cookie: 'duo_oauth=browser' } });
test('rechaza cuenta desconocida sin guardar sus tokens', async () => {
  db.query.mockImplementation(async (sql) => ({ rows: sql.includes('DELETE FROM app_private.runtime') ? [{ valor: { persona: 'duo' } }] : [] }));
  spotify.request.mockResolvedValueOnce({ data: { access_token: 'AQaccess', refresh_token: 'AQrefresh', expires_in: 3600 } })
    .mockResolvedValueOnce({ data: { id: 'stranger', display_name: 'Extra' } });
  expect((await callback()).status).toBe(403);
  expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO usuarios_spotify'))).toBe(false);
});
test('reconecta cuenta existente, escapa HTML y rechaza replay', async () => {
  let consumed = false;
  db.query.mockImplementation(async (sql) => {
    if (sql.includes('DELETE FROM app_private.runtime')) {
      if (consumed) return { rows: [] }; consumed = true; return { rows: [{ valor: { persona: 'duo' } }] };
    }
    return { rows: [{ id: 1 }] };
  });
  spotify.request.mockResolvedValueOnce({ data: { access_token: 'AQaccess', refresh_token: 'AQrefresh', expires_in: 3600 } })
    .mockResolvedValueOnce({ data: { id: 'known', display_name: '<img src=x onerror=alert(1)>' } });
  const response = await callback();
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('&lt;img');
  expect(db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO usuarios_spotify'))[1][3]).toMatch(/^enc:v1:/);
  expect((await callback()).status).toBe(400);
  expect(spotify.request).toHaveBeenCalledTimes(2);
});
