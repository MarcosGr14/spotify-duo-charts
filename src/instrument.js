// Este archivo tiene que ser el PRIMER require de toda la app (antes que
// express, antes que todo) — así Sentry puede instrumentar automáticamente
// los módulos que se cargan después.
//
// Por eso cargamos dotenv ACÁ mismo, al principio: si esperáramos a que
// lo haga config.js (que se requiere más tarde), Sentry.init() leería
// process.env.SENTRY_DSN todavía vacío.
require('dotenv').config();

const Sentry = require('@sentry/node');

// Si no hay SENTRY_DSN configurado (por ejemplo, corriendo en local sin
// haberlo seteado), Sentry.init con dsn vacío simplemente no manda nada
// a ningún lado — no rompe la app, solo queda desactivado.
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'production',
  integrations: [Sentry.expressIntegration()],
  tracesSampleRate: 0.1 // 10% de los requests, para no gastar cuota gratis de más
});

module.exports = Sentry;
