const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const Sentry = require('@sentry/node');
const db = require('./db');
const { describirError } = require('./errorUtils');
const { encrypt, decryptSafe } = require('./crypto');
const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI
} = require('./config');

const router = express.Router();

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-recently-played',
  'user-read-email'
].join(' ');

function basicAuthHeader() {
  return (
    'Basic ' +
    Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
      'base64'
    )
  );
}

// GET /login/:persona  ->  ej: /login/marcos  /login/jackie
router.get('/login/:persona', (req, res) => {
  const persona = req.params.persona;
  const state = `${persona}:${crypto.randomBytes(8).toString('hex')}`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

// GET /callback  <- Spotify redirige acá después de autorizar
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`Spotify devolvió un error: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Falta el parámetro "code" en la respuesta de Spotify.');
  }

  const [persona] = (state || 'desconocido').split(':');

  try {
    const tokenResp = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader()
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResp.data;

    const perfilResp = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const perfil = perfilResp.data;
    const tokenExpiraEn = new Date(Date.now() + expires_in * 1000);

    await db.query(
      `INSERT INTO usuarios_spotify
         (spotify_user_id, nombre_display, imagen_url, access_token, refresh_token, token_expira_en, necesita_reconexion)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       ON CONFLICT (spotify_user_id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             token_expira_en = EXCLUDED.token_expira_en,
             nombre_display = EXCLUDED.nombre_display,
             imagen_url = EXCLUDED.imagen_url,
             necesita_reconexion = false`,
      [
        perfil.id,
        perfil.display_name || persona,
        perfil.images?.[0]?.url || null,
        encrypt(access_token),
        encrypt(refresh_token),
        tokenExpiraEn
      ]
    );

    res.send(
      `<h2>¡Listo! Cuenta de ${perfil.display_name} conectada correctamente.</h2>
       <p>Ya podés cerrar esta pestaña.</p>`
    );
  } catch (err) {
    console.error('Error en /callback:', err.response?.data || describirError(err));
    Sentry.captureException(err, { tags: { ruta: '/callback' } });
    res.status(500).send('Algo falló conectando la cuenta. Revisa la consola del servidor.');
  }
});

// Devuelve un access_token válido, renovándolo si ya expiró
async function obtenerAccessTokenValido(usuarioId) {
  const { rows } = await db.query(
    'SELECT * FROM usuarios_spotify WHERE id = $1',
    [usuarioId]
  );
  const usuario = rows[0];
  if (!usuario) throw new Error(`Usuario ${usuarioId} no encontrado`);

  const accessTokenActual = decryptSafe(usuario.access_token);
  const refreshTokenActual = decryptSafe(usuario.refresh_token);

  const yaExpiro = new Date(usuario.token_expira_en) <= new Date();
  if (!yaExpiro) return accessTokenActual;

  let resp;
  try {
    resp = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshTokenActual
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader()
        }
      }
    );
  } catch (err) {
    // El refresh token dejó de servir (revocado, expirado por
    // inactividad prolongada, etc.) — marcamos la cuenta para que el
    // dashboard le avise al usuario que hay que volver a loguearse.
    await db.query(
      `UPDATE usuarios_spotify SET necesita_reconexion = true WHERE id = $1`,
      [usuarioId]
    );
    throw err;
  }

  const { access_token, expires_in, refresh_token } = resp.data;
  const nuevaExpiracion = new Date(Date.now() + expires_in * 1000);

  await db.query(
    `UPDATE usuarios_spotify
     SET access_token = $1, token_expira_en = $2, refresh_token = COALESCE($3, refresh_token)
     WHERE id = $4`,
    [encrypt(access_token), nuevaExpiracion, refresh_token ? encrypt(refresh_token) : null, usuarioId]
  );

  return access_token;
}

module.exports = { router, obtenerAccessTokenValido };
