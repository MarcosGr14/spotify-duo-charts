jest.mock('../src/db', () => ({ query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }) }));
const { normalizarFechaLanzamiento, upsertAlbum } = require('../src/catalog');
const db = require('../src/db');
test.each([
  ['2002', '2002-01-01'], ['2026-10', '2026-10-01'],
  ['2024-02-29', '2024-02-29'], ['2023-02-29', null],
  ['2026-13', null], ['2026-04-31', null], ['', null],
  [null, null], [undefined, null], ['0000', null], ['not-a-date', null]
])('normaliza %s sin enviar fechas inválidas a PostgreSQL', (input, expected) => {
  expect(normalizarFechaLanzamiento(input)).toBe(expected);
});
test('un álbum con solo año se puede importar', async () => {
  await expect(upsertAlbum({ id: 'album', name: 'Album', release_date: '2002' })).resolves.toBe(1);
  expect(db.query.mock.calls.at(-1)[1][3]).toBe('2002-01-01');
});
