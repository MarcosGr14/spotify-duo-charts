/* DUO_BUILD contiene solo recursos públicos y una huella de su contenido. */
const PREFIX = 'duo-charts-pwa-';
const CACHE = PREFIX + DUO_BUILD.version;
const OFFLINE = new URL('/__duo_offline__', self.location.origin).href;
const ASSETS = new Set(DUO_BUILD.assets.map(file => new URL(file, self.location.origin).href));
self.addEventListener('install', event => {
  // Fallback sintético, nunca una página obtenida con cookies o credenciales.
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.put(OFFLINE, new Response(DUO_BUILD.offline, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    } }));
    await cache.put(DUO_BUILD.offlineCssUrl, new Response(DUO_BUILD.offlineCss,
      { headers: { 'Content-Type': 'text/css; charset=utf-8' } }));
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  // La página envía este mensaje únicamente tras pulsar Actualizar.
  if (event.data?.type === 'DUO_ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Login, OAuth, health y API nunca se interceptan, ni siquiera como navegación.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || ['/login', '/callback', '/health'].includes(url.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.open(CACHE)).match(OFFLINE)));
    return;
  }
  if (!ASSETS.has(url.href) || req.headers.has('authorization') || req.headers.has('range')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req.url);
    if (hit) return hit;
    // Nunca almacenar una respuesta obtenida mediante credenciales del navegador.
    const response = await fetch(new Request(req, { credentials: 'omit' }));
    const policy = response.headers.get('cache-control') || '';
    const vary = response.headers.get('vary') || '';
    if (response.ok && !response.redirected && /\bpublic\b/i.test(policy) && /\bimmutable\b/i.test(policy)
      && !/private|no-store/i.test(policy) && !/cookie|authorization|\*/i.test(vary)) {
      await cache.put(req.url, response.clone());
    }
    // En modo privado, conservar el flujo original sin guardar la respuesta.
    if (response.status === 401 || response.status === 403) return fetch(req);
    return response;
  })());
});
