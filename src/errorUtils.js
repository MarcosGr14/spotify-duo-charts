// Los AggregateError (que Node arma cuando falla la conexión a un host
// que resuelve a varias direcciones, típico con IPv4+IPv6) tienen
// .message VACÍO por diseño del lenguaje — el detalle real vive en
// .errors, un array de errores individuales. Esta función devuelve
// siempre algo legible, sea cual sea el tipo de error.
function describirError(err) {
  if (err?.message) return err.message;
  if (Array.isArray(err?.errors) && err.errors.length) {
    return err.errors.map((e) => e.message || String(e)).join(' | ');
  }
  return String(err);
}

module.exports = { describirError };
