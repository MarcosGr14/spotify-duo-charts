jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/spotifyAuth', () => ({ obtenerAccessTokenValido: jest.fn().mockResolvedValue('private-token') }));
let completar;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  completar = require('../src/artistImages').completarImagenesDeArtistas;
  require('../src/db').query.mockResolvedValue({ rows: [{ id: 22, spotify_artist_id: 'artist' }] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
test('actualiza la foto y programa su renovación semanal', async () => {
  const http = require('axios'); const pool = require('../src/db');
  http.get.mockResolvedValue({ data: { images: [{ url: 'https://i.scdn.co/new' }] } });
  const inicio = Date.now();
  await completar({ id: 1 });
  const args = pool.query.mock.calls[1][1];
  expect(args[0]).toBe('https://i.scdn.co/new');
  expect(args[1].getTime()).toBeGreaterThanOrEqual(inicio + 7 * 86400000);
  expect(args[2]).toBe(22);
});
test.each([undefined, []])('conserva la foto cuando Spotify no devuelve imágenes (%s)', async (images) => {
  require('axios').get.mockResolvedValue({ data: { images } });
  await completar({ id: 1 });
  const llamada = require('../src/db').query.mock.calls[1];
  expect(llamada[0]).not.toContain('imagen_url');
});
test('respeta Retry-After y detiene peticiones sin registrar credenciales', async () => {
  const http = require('axios'); const pool = require('../src/db');
  pool.query.mockResolvedValueOnce({ rows: [{ id: 1, spotify_artist_id: 'a' }, { id: 2, spotify_artist_id: 'b' }] });
  http.get.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '600' } }, config: { token: 'private-token' } });
  await completar({ id: 1 });
  await completar({ id: 1 });
  expect(http.get).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls[1][1][0].getTime()).toBeGreaterThan(Date.now() + 590000);
  expect(JSON.stringify(console.error.mock.calls)).not.toContain('private-token');
});
test('no solapa lotes cuando llega otro ciclo', async () => {
  const http = require('axios');
  let resolver;
  http.get.mockImplementation(() => new Promise((resolve) => { resolver = resolve; }));
  const primero = completar({ id: 1 });
  await new Promise(setImmediate);
  await completar({ id: 1 });
  expect(http.get).toHaveBeenCalledTimes(1);
  resolver({ data: { images: [] } });
  await primero;
});
