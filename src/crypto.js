const crypto = require('crypto');
const { ENCRYPTION_KEY } = require('./config');

const ALGORITHM = 'aes-256-gcm';

function getKeyBuffer() {
  if (!ENCRYPTION_KEY || !/^[a-fA-F0-9]{64}$/.test(ENCRYPTION_KEY)) {
    throw new Error(
      'ENCRYPTION_KEY inválida: debe ser un string hexadecimal de 64 caracteres (32 bytes). ' +
        'Generá una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(ENCRYPTION_KEY, 'hex');
}

// Empaqueta iv + authTag + contenido cifrado en un solo string base64,
// para guardar todo junto en una sola columna de la base de datos.
function encrypt(texto) {
  const iv = crypto.randomBytes(12);
  const key = getKeyBuffer();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return 'enc:v1:' + Buffer.concat([iv, authTag, cifrado]).toString('base64');
}

function decrypt(payload) {
  const key = getKeyBuffer();
  if (typeof payload !== 'string') throw new Error('Token cifrado inválido');
  const data = Buffer.from(payload.startsWith('enc:v1:') ? payload.slice(7) : payload, 'base64');
  if (data.length < 29) throw new Error('Token cifrado inválido');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const cifrado = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  const descifrado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
  return descifrado.toString('utf8');
}

// Compatibilidad solo con el formato antiguo identificable de Spotify.
// Un cifrado corrupto nunca se interpreta como token en texto plano.
function decryptSafe(payload) {
  if (typeof payload === 'string' && /^AQ[A-Za-z0-9_-]+$/.test(payload)) return payload;
  return decrypt(payload);
}

module.exports = { encrypt, decrypt, decryptSafe };
