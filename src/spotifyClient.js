const axios = require('axios');
const db = require('./db');
let pausaHasta = 0;
let cola = Promise.resolve();
let ultimaPeticion = 0;
class SpotifyPause extends Error {
  constructor(until) { super('Spotify temporalmente en pausa'); this.code = 'SPOTIFY_PAUSED'; this.until = until; }
}
async function leerPausa() {
  const { rows } = await db.query(`SELECT valor FROM app_private.runtime WHERE clave='spotify_pause'`);
  pausaHasta = Math.max(pausaHasta, Number(rows[0]?.valor?.hasta) || 0);
}
async function ejecutar(config) {
  await leerPausa(); // Persistencia entre despliegues; errores de DB cierran solicitudes.
  if (Date.now() < pausaHasta) throw new SpotifyPause(pausaHasta);
  const espera = 350 - (Date.now() - ultimaPeticion);
  if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera));
  ultimaPeticion = Date.now();
  try { return await axios.request({ ...config, timeout: 10000, signal: AbortSignal.timeout(12000) }); }
  catch (err) {
    if (err.response?.status === 429) {
      const segundos = Number(err.response.headers?.['retry-after']);
      const cuota = err.response.data?.error?.reason === 'QUOTA_EXCEEDED';
      const duracion = Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : (cuota ? 86400000 : 3600000);
      pausaHasta = Date.now() + Math.max(duracion, 60000);
      await db.query(`INSERT INTO app_private.runtime(clave,valor) VALUES('spotify_pause',$1::jsonb)
        ON CONFLICT(clave) DO UPDATE SET valor=jsonb_build_object('hasta',GREATEST(
          (app_private.runtime.valor->>'hasta')::bigint,($1::jsonb->>'hasta')::bigint))`,
      [JSON.stringify({ hasta: pausaHasta })]);
      console.warn(`[spotify] HTTP 429; reintento a partir de ${new Date(pausaHasta).toISOString()}`);
    }
    throw err;
  }
}
function request(config) {
  const trabajo = cola.then(() => ejecutar(config));
  cola = trabajo.catch(() => {});
  return trabajo;
}
module.exports = { request, SpotifyPause };
