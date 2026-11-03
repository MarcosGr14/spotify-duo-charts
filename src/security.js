const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const iguales = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
function accesoPrivado(req, res, next) {
  // El modo público conserva el acceso actual. El modo privado protege HTML y API.
  if (process.env.SITE_VISIBILITY !== 'private') return next();
  const password = process.env.SITE_PASSWORD;
  if (!password || password.length < 20) return res.status(503).send('Acceso privado sin configurar.');
  const auth = req.get('authorization') || '';
  let credencial = '';
  if (auth.startsWith('Basic ')) credencial = Buffer.from(auth.slice(6), 'base64').toString();
  if (iguales(credencial, `duo:${password}`)) { res.set('Cache-Control', 'no-store'); return next(); }
  res.set('WWW-Authenticate', 'Basic realm="Duo Charts", charset="UTF-8"');
  return res.status(401).send('Se necesita acceso al dúo.');
}
function configureSecurity(app) {
  app.disable('x-powered-by');
  // Railway termina HTTPS en su proxy. Se confía solo en el salto inmediato.
  app.set('trust proxy', process.env.RAILWAY_ENVIRONMENT_ID ? 1 : false);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://i.scdn.co', 'https://mosaic.scdn.co', 'https://image-cdn-ak.spotifycdn.com', 'https://image-cdn-fa.spotifycdn.com', 'https://platform-lookaside.fbsbx.com'],
      connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    } },
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? { maxAge: 31536000 } : false
  }));
  const limit = (n, windowMs) => rateLimit({ windowMs, limit: n, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Inténtalo más tarde.' } });
  app.use(['/login', '/callback'], limit(20, 15 * 60000));
  app.use('/api', limit(240, 60000));
  app.use('/api', (req, res, next) => {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value !== 'string' || value.length > 4096) return res.status(400).json({ error: 'Parámetros inválidos.' });
      const bounds = { dias: [1,36500], limit: [1,5001], offset: [0,1000000], usuario_id: [1,2147483647], id: [1,2147483647] }[key];
      if (bounds && (!/^\d+$/.test(value) || Number(value)<bounds[0] || Number(value)>bounds[1])) return res.status(400).json({ error: 'Parámetro fuera de rango.' });
      if (key === 'busqueda' && value.length > 200) return res.status(400).json({ error: 'La búsqueda es demasiado larga.' });
    }
    next();
  });
  app.use((req, res, next) => {
    if (req.path === '/api/charts' && Number(req.query.limit) > 100) return exportLimit(req, res, next);
    next();
  });
  app.use((req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/api/integrations/')) return next();
    return accesoPrivado(req, res, next);
  });
}
const exportLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
module.exports = { configureSecurity, accesoPrivado };
