const { pgConnection } = require('../src/pgConnection');
test('admite inicializar pg sin DATABASE_URL', () => {
  expect(pgConnection(undefined)).toEqual({});
});
test('conserva la conexión local de pruebas', () => {
  const url = 'postgresql://test:test@127.0.0.1:5432/duo_test';
  expect(pgConnection(url)).toEqual({ connectionString: url });
});
test('Supabase siempre verifica el certificado incluso si la URL intenta desactivar SSL', () => {
  const result = pgConnection('postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=disable');
  expect(result.ssl.rejectUnauthorized).toBe(true);
  expect(result.ssl.ca).toContain('BEGIN CERTIFICATE');
  expect(result.connectionString).not.toContain('sslmode');
});
