const { describirError } = require('../src/errorUtils');

describe('describirError', () => {
  test('devuelve el .message tal cual para un error normal', () => {
    const err = new Error('conexión rechazada');
    expect(describirError(err)).toBe('conexión rechazada');
  });

  // Este es el test que hubiera evitado el bug real que tuvimos en
  // producción: los AggregateError (típicos de fallos de conexión a un
  // host que resuelve a varias IPs, como el pooler de Supabase) tienen
  // .message VACÍO por diseño del lenguaje — el detalle real vive en
  // .errors. Si algún día alguien vuelve a escribir `err.message` a
  // mano en vez de usar esta función, este test lo va a agarrar.
  test('extrae el detalle real de un AggregateError (message vacío)', () => {
    const err = new AggregateError([
      new Error('connect ETIMEDOUT 44.216.29.125:5432'),
      new Error('connect ETIMEDOUT 44.208.221.186:5432')
    ]);

    expect(err.message).toBe(''); // así es como falla el .message nativo
    expect(describirError(err)).toContain('ETIMEDOUT 44.216.29.125');
    expect(describirError(err)).toContain('ETIMEDOUT 44.208.221.186');
  });

  test('no rompe con un AggregateError vacío (sin errores adentro)', () => {
    const err = new AggregateError([]);
    expect(() => describirError(err)).not.toThrow();
  });

  test('no rompe si le pasan algo que ni siquiera es un Error', () => {
    expect(() => describirError('un string cualquiera')).not.toThrow();
    expect(() => describirError(null)).not.toThrow();
    expect(() => describirError(undefined)).not.toThrow();
  });
});
