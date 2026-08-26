// Hay que setear la clave ANTES de requerir crypto.js (que a su vez
// requiere config.js), porque config.js lee process.env.ENCRYPTION_KEY
// una sola vez, al cargarse.
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');

const { encrypt, decrypt, decryptSafe } = require('../src/crypto');

describe('encriptación de tokens', () => {
  test('lo que se encripta se puede desencriptar igual', () => {
    const original = 'BQC4_un_access_token_de_spotify_bien_largo_1234567890';
    const cifrado = encrypt(original);
    expect(decrypt(cifrado)).toBe(original);
  });

  test('el texto cifrado no se parece en nada al original (no quedó en texto plano)', () => {
    const original = 'mi-token-secreto';
    const cifrado = encrypt(original);
    expect(cifrado).not.toContain(original);
  });

  test('dos encriptados del mismo texto dan resultados distintos (usa IV random)', () => {
    const original = 'mismo-texto-siempre';
    const cifrado1 = encrypt(original);
    const cifrado2 = encrypt(original);
    expect(cifrado1).not.toBe(cifrado2);
    // pero los dos tienen que desencriptar al mismo original
    expect(decrypt(cifrado1)).toBe(original);
    expect(decrypt(cifrado2)).toBe(original);
  });

  // Este es el test de la "migración suave": los tokens guardados
  // ANTES de agregar la encriptación quedaron en texto plano en la
  // base de datos. decryptSafe tiene que devolverlos tal cual, sin
  // romper, para no forzarle un relogin a nadie.
  test('decryptSafe no rompe con un token viejo en texto plano', () => {
    const tokenViejoSinEncriptar = 'AQD_token_de_antes_de_la_encriptacion';
    expect(decryptSafe(tokenViejoSinEncriptar)).toBe(tokenViejoSinEncriptar);
  });

  test('decryptSafe sí desencripta normal un token ya encriptado', () => {
    const original = 'un-token-encriptado';
    const cifrado = encrypt(original);
    expect(decryptSafe(cifrado)).toBe(original);
  });
});
