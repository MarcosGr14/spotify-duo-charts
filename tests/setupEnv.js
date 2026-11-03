// Nunca cargar accidentalmente la conexión de producción desde .env durante tests.
const target = process.env.TEST_DATABASE_URL;
if (target) {
  const url = new URL(target);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/test/i.test(url.pathname)) {
    throw new Error('TEST_DATABASE_URL debe apuntar a PostgreSQL local y a una base de pruebas.');
  }
}
process.env.DATABASE_URL = target || 'postgresql://test:test@127.0.0.1:5432/duo_test';
process.env.SENTRY_DSN = '';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
