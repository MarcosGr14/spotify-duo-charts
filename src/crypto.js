const crypto = require('crypto');
const { ENCRYPTION_KEY } = require('./config');

const ALGORITHM = 'aes-256-gcm';

function getKeyBuffer() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
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
  return Buffer.concat([iv, authTag, cifrado]).toString('base64');
}

function decrypt(payload) {
  const key = getKeyBuffer();
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const cifrado = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const descifrado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
  return descifrado.toString('utf8');
}

// Migración suave: los tokens guardados ANTES de este cambio están en
// texto plano. Si desencriptar falla, asumimos que es uno de esos
// tokens viejos y lo devolvemos tal cual — así nadie tiene que volver
// a loguearse a la fuerza. La próxima vez que ese token se renueve,
// se guarda ya encriptado.
function decryptSafe(payload) {
  try {
    return decrypt(payload);
  } catch (err) {
    return payload;
  }
}

module.exports = { encrypt, decrypt, decryptSafe };
