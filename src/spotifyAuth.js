const express = require('express');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const db = require('./db');
const spotify = require('./spotifyClient');
const { encrypt, decryptSafe } = require('./crypto');
const { resumenError } = require('./safeErrors');
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } = require('./config');
const router = express.Router();
router.use(cookieParser());
const SCOPES = 'user-read-currently-playing user-read-playback-state user-read-recently-played';
const cookies = { httpOnly: true, secure: SPOTIFY_REDIRECT_URI?.startsWith('https:'), sameSite: 'lax', path: '/callback' };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function basicAuthHeader() { return 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'); }
const escapar = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
router.get('/login/:persona', async (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(req.params.persona)) return res.sendStatus(400);
  try {
    const state = crypto.randomBytes(32).toString('hex');
    const browser = crypto.randomBytes(32).toString('hex');
    await db.query(`DELETE FROM app_private.runtime WHERE clave LIKE 'oauth:%' AND (valor->>'expira')::bigint < $1`, [Date.now()]);
    await db.query(`INSERT INTO app_private.runtime(clave,valor) VALUES($1,$2::jsonb)`,
      [`oauth:${hash(state)}`, JSON.stringify({ browser: hash(browser), persona: req.params.persona, expira: Date.now() + 600000 })]);
    res.cookie('duo_oauth', browser, { ...cookies, maxAge: 600000 });
    res.set('Cache-Control', 'no-store');
    const params = new URLSearchParams({ response_type: 'code', client_id: SPOTIFY_CLIENT_ID, scope: SCOPES, redirect_uri: SPOTIFY_REDIRECT_URI, state });
    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
  } catch (err) { console.error('[oauth inicio]', resumenError(err)); res.sendStatus(503); }
});
router.get('/callback', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { code, state, error } = req.query;
  const browser = req.cookies.duo_oauth;
  res.clearCookie('duo_oauth', cookies);
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || typeof browser !== 'string') return res.status(400).send('Autorización inválida o caducada.');
  try {
    // DELETE + RETURNING consume el nonce una sola vez y verifica también el navegador.
    const { rows } = await db.query(`DELETE FROM app_private.runtime WHERE clave=$1
      AND valor->>'browser'=$2 AND (valor->>'expira')::bigint > $3 RETURNING valor`,
    [`oauth:${hash(state)}`, hash(browser), Date.now()]);
    if (!rows.length) return res.status(400).send('Autorización inválida o caducada.');
    if (error) return res.status(400).send('La autorización fue cancelada.');
    if (typeof code !== 'string' || code.length > 2048) return res.sendStatus(400);
    const tokenResp = await spotify.request({ method: 'POST', url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() } });
    const { access_token, refresh_token, expires_in } = tokenResp.data;
    const { data: perfil } = await spotify.request({ url: 'https://api.spotify.com/v1/me', headers: { Authorization: `Bearer ${access_token}` } });
    const known = await db.query('SELECT id FROM usuarios_spotify WHERE spotify_user_id=$1', [perfil.id]);
    const permitidos = (process.env.SPOTIFY_ALLOWED_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!known.rows.length && !permitidos.includes(perfil.id)) return res.status(403).send('Esta cuenta no está autorizada para este dúo.');
    await db.query(`INSERT INTO usuarios_spotify
      (spotify_user_id,nombre_display,imagen_url,access_token,refresh_token,token_expira_en,necesita_reconexion)
      VALUES($1,$2,$3,$4,$5,$6,false) ON CONFLICT(spotify_user_id) DO UPDATE SET
      access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
      token_expira_en=EXCLUDED.token_expira_en, nombre_display=EXCLUDED.nombre_display,
      imagen_url=EXCLUDED.imagen_url, necesita_reconexion=false`,
    [perfil.id, perfil.display_name || rows[0].valor.persona, perfil.images?.[0]?.url || null,
      encrypt(access_token), encrypt(refresh_token), new Date(Date.now() + expires_in * 1000)]);
    res.send(`<h2>Cuenta de ${escapar(perfil.display_name || 'Spotify')} conectada.</h2><p>Ya puedes cerrar esta pestaña.</p>`);
  } catch (err) { console.error('[oauth callback]', resumenError(err)); res.status(503).send('No se pudo completar la conexión. Inténtalo más tarde.'); }
});
const renovaciones = new Map();
async function renovar(usuarioId) {
  const { rows } = await db.query('SELECT * FROM usuarios_spotify WHERE id=$1', [usuarioId]);
  const usuario = rows[0];
  if (!usuario) throw Object.assign(new Error('Cuenta no encontrada'), { code: 'ACCOUNT_MISSING' });
  if (new Date(usuario.token_expira_en).getTime() > Date.now() + 60000) return decryptSafe(usuario.access_token);
  let resp;
  try {
    resp = await spotify.request({ method: 'POST', url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decryptSafe(usuario.refresh_token) }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() } });
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data?.error === 'invalid_grant') {
      await db.query('UPDATE usuarios_spotify SET necesita_reconexion=true WHERE id=$1', [usuarioId]);
    }
    throw err;
  }
  const { access_token, expires_in, refresh_token } = resp.data;
  await db.query(`UPDATE usuarios_spotify SET access_token=$1,token_expira_en=$2,
    refresh_token=COALESCE($3,refresh_token),necesita_reconexion=false WHERE id=$4`,
  [encrypt(access_token), new Date(Date.now() + expires_in * 1000), refresh_token ? encrypt(refresh_token) : null, usuarioId]);
  return access_token;
}
function obtenerAccessTokenValido(id) {
  if (!renovaciones.has(id)) renovaciones.set(id, renovar(id).finally(() => renovaciones.delete(id)));
  return renovaciones.get(id);
}
module.exports = { router, obtenerAccessTokenValido, escapar };
