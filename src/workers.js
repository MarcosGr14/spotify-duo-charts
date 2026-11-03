// Bloqueo por proceso: una réplica, ciclos sin solapamiento, espera tras cada ciclo.
function programar(nombre, tarea, intervalo) {
  let detenido = false;
  let timer;
  let actual;
  const ejecutar = async () => {
    if (detenido) return;
    actual = Promise.resolve().then(tarea).catch(() => console.error(`[${nombre}] ciclo fallido`));
    await actual;
    if (!detenido) { timer = setTimeout(ejecutar, intervalo); timer.unref(); }
  };
  ejecutar();
  return async () => { detenido = true; clearTimeout(timer); await actual; };
}
// Marca de actividad en memoria; el historial sigue funcionando sin visitantes.
let ultimoVisitante = 0;
function registrarVisitante() { ultimoVisitante = Date.now(); }
function hayVisitantes() { return Date.now() - ultimoVisitante < 90000; }
module.exports = { programar, registrarVisitante, hayVisitantes };
