const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PUBLIC = path.join(__dirname, '..', 'public');
const ASSETS = ['app.js', 'style.css', 'pwa.js', 'offline.css',
  'pwa-icons/icon-192.png', 'pwa-icons/icon-512.png', 'pwa-icons/maskable-512.png', 'pwa-icons/apple-touch-icon.png'];

// Se calcula por contenido en cada arranque/build, sin pasos manuales ni secretos.
function configurePwa(app, { production = process.env.NODE_ENV === 'production' } = {}) {
  const files = new Map(ASSETS.map(file => [file, fs.readFileSync(path.join(PUBLIC, file))]));
  const template = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, 'serviceWorker.js'), 'utf8');
  const offline = fs.readFileSync(path.join(PUBLIC, 'offline.html'), 'utf8');
  const hash = createHash('sha256').update(template).update(sw).update(offline).update(fs.readFileSync(__filename));
  hash.update(process.env.RAILWAY_GIT_COMMIT_SHA || '');
  for (const [file, body] of files) hash.update(file).update(body);
  const version = hash.digest('hex').slice(0, 20);
  const assetUrl = file => `/assets/duo-pwa/${version}/${file}`;
  const noStore = res => res.set('Cache-Control', 'no-store');
  const html = production ? ASSETS.reduce((text, file) => text.replaceAll(`"/${file}"`, `"${assetUrl(file)}"`), template) : template;

  app.get(['/','/index.html'], (_req, res) => { noStore(res); res.type('html').send(html); });
  app.get('/pwa-config.js', (_req, res) => {
    noStore(res); res.type('js').send(`window.DUO_PWA = ${JSON.stringify({ production, version })};`);
  });
  app.get('/manifest.webmanifest', (_req, res) => {
    noStore(res);
    res.type('application/manifest+json').send(JSON.stringify({
      id: '/', name: 'Duo Charts', short_name: 'Duo Charts', lang: 'es',
      description: 'Tu historial musical y los rankings de Spotify Duo.',
      start_url: '/', scope: '/', display: 'standalone',
      background_color: '#0b0b0f', theme_color: '#0b0b0f',
      icons: [
        { src: assetUrl('pwa-icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: assetUrl('pwa-icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: assetUrl('pwa-icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }));
  });
  // Solo archivos conocidos: no se expone un directorio ni datos de usuario.
  for (const [file, body] of files) app.get(assetUrl(file), (_req, res) => {
    // El middleware de acceso privado puede haber establecido no-store: se respeta.
    if (!res.get('Cache-Control')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(path.extname(file)).send(body);
  });
  const worker = `const DUO_BUILD = ${JSON.stringify({ version, assets: ASSETS.map(assetUrl),
    offline: offline.replace('"/offline.css"', `"${assetUrl('offline.css')}"`),
    offlineCss: files.get('offline.css').toString(), offlineCssUrl: assetUrl('offline.css') })};\n${sw}`;
  app.get('/sw.js', (_req, res) => {
    noStore(res); res.set('Service-Worker-Allowed', '/'); res.type('js').send(worker);
  });
  return { version, assetUrl };
}
module.exports = { configurePwa };
