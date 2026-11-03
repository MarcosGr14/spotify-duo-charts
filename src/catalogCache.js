// Caché acotada de metadatos, nunca de reproducciones.
function createCatalogCache({ maxEntries = 2000, ttl = 3600000 } = {}) {
  const entries = new Map(), pending = new Map();
  return async function cached(key, load) {
    const hit = entries.get(key);
    if (hit && hit.until > Date.now()) { entries.delete(key); entries.set(key,hit); return hit.value; }
    entries.delete(key);
    if (pending.has(key)) return pending.get(key);
    const work = Promise.resolve().then(load).then((value) => {
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key,{ value, until: Date.now()+ttl }); return value;
    }).finally(() => pending.delete(key));
    pending.set(key,work); return work;
  };
}
module.exports = { createCatalogCache };
