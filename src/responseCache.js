const TTL = new Map([['/charts',30000],['/activity',60000],['/records',60000],['/music-match',60000],['/usuarios',30000],['/currently-playing',3000],['/historial-item',60000]]);
function createResponseCache({ maxEntries = 128, maxBytes = 8 * 1024 * 1024, maxItemBytes = 512 * 1024 } = {}) {
  const cache = new Map(), pending = new Map();
  let bytes = 0;
  const counters = { hits: 0, misses: 0, coalesced: 0 };
  function remove(key) { bytes -= cache.get(key)?.bytes || 0; cache.delete(key); }
  function save(key, body, ttl) {
    const size = Buffer.byteLength(body);
    if (size > maxItemBytes || size > maxBytes) return;
    remove(key);
    while (cache.size >= maxEntries || bytes + size > maxBytes) remove(cache.keys().next().value);
    cache.set(key, { body, bytes: size, expires: Date.now() + ttl }); bytes += size;
  }
  function send(res, body, kind) { res.set('X-App-Cache', kind); res.type('json').send(body); }
  async function middleware(req, res, next) {
    const ttl = TTL.get(req.path);
    if (req.method !== 'GET' || !ttl || Number(req.query.limit) > 100) return next();
    // No usar caché del navegador/CDN para datos musicales ni credenciales.
    res.set('Cache-Control','private, no-store');
    const key = req.path + '?' + new URLSearchParams(Object.entries(req.query).sort(([a],[b]) => a.localeCompare(b))).toString();
    const item = cache.get(key);
    if (item && item.expires > Date.now()) {
      cache.delete(key); cache.set(key,item); counters.hits++; return send(res,item.body,'HIT');
    }
    if (item) remove(key);
    if (pending.has(key)) {
      counters.coalesced++;
      const body = await pending.get(key);
      if (res.destroyed) return;
      if (body !== null) return send(res,body,'COALESCED');
      return next();
    }
    if (pending.size >= maxEntries) return next();
    counters.misses++;
    let settle;
    pending.set(key,new Promise((resolve) => { settle = resolve; }));
    const finish = (body) => { if (settle) { pending.delete(key); settle(body); settle = null; } };
    const json = res.json.bind(res);
    res.json = (value) => {
      if (res.statusCode === 200) {
        const body = JSON.stringify(value);
        save(key,body,ttl); finish(body); res.set('X-App-Cache','MISS');
      } else finish(null);
      return json(value);
    };
    res.once('finish',() => finish(null));
    res.once('close',() => finish(null));
    next();
  }
  return { middleware, stats: () => ({ ...counters, entries: cache.size, pending: pending.size, bytes }) };
}
const shared = createResponseCache();
module.exports = { createResponseCache, responseCache: shared.middleware, cacheStats: shared.stats };
