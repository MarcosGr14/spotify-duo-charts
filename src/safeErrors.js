function resumenError(err) {
  return { code: /^[A-Z0-9_]{1,40}$/.test(err?.code || '') ? err.code : 'ERROR', status: err?.response?.status || null };
}
function limpiarEvento(event) {
  // Axios y las URL de callback pueden contener códigos, cookies y tokens.
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
    delete event.request.query_string;
  }
  if (event.exception?.values) for (const value of event.exception.values) value.value = 'Error de aplicación (detalle privado omitido)';
  if (event.transaction) event.transaction = event.transaction.split('?')[0];
  if (event.spans) event.spans = event.spans.map(({ data, ...span }) => span);
  delete event.extra;
  delete event.breadcrumbs;
  return event;
}
module.exports = { resumenError, limpiarEvento };
