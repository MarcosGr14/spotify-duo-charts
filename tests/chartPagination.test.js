const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function harness() {
  const el = Object.fromEntries(['emptyState','retryChartBtn','loadingState','chartList','loadMoreBtn'].map(name => [name, {
    innerHTML: '', classList: {add() {},remove() {}},
    insertAdjacentHTML(_where, html) { this.innerHTML += html; }
  }]));
  const state = {view:'artists', tipo:'artistas', offset:0,dias:7};
  const vistaFetch = jest.fn();
  const top = jest.fn();
  const context = vm.createContext({state, el, vistaFetch, nuevoGrupo() {},
    construirParams: offset => new URLSearchParams({offset}),
    VISTA_A_TIPO:{artists:'artistas',songs:'canciones',albums:'albumes'},
    TITULOS_POR_VISTA:{artists:{titulo:'Artists'}}, LIMITE_POR_PAGINA:20,
    renderTop3:top,renderFila:item=>`[${item.id}]`, console:{error() {}},URLSearchParams
  });
  vm.runInContext(source.slice(source.indexOf('let ultimaSolicitudChart = 0;'),source.indexOf('el.retryChartBtn.addEventListener')),context);
  const response = ids => ({ok:true,json:async()=>ids.map(id=>({id}))});
  return {state,el,vistaFetch,top,context,response,load:reset=>context.actualizarChart(reset)};
}
test('cargar más evita IDs repetidos incluso del podio y avanza por filas recibidas', async()=>{
  const h = harness();
  h.vistaFetch.mockResolvedValueOnce(h.response(Array.from({length:20},(_,i)=>i+1)));
  await h.load(true);
  h.vistaFetch.mockResolvedValueOnce(h.response([1,20,21,22]));
  await h.load(false);
  expect(h.el.chartList.innerHTML.match(/\[20\]/g)).toHaveLength(1);
  expect(h.el.chartList.innerHTML).not.toContain('[1]');
  expect(h.el.chartList.innerHTML).toContain('[21][22]');
  expect(h.state.offset).toBe(24);
  expect(h.el.loadMoreBtn.hidden).toBe(true);
});
test('doble pulsación solo hace una petición; un fallo conserva filas y permite reintentar',async()=>{
  const h=harness();h.vistaFetch.mockResolvedValueOnce(h.response([1,2,3,4]));await h.load(true);
  let reject;h.vistaFetch.mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));
  const pending=h.load(false);await h.load(false);expect(h.vistaFetch).toHaveBeenCalledTimes(2);
  reject(new Error('network'));await pending;
  expect(h.state.offset).toBe(4);expect(h.el.chartList.innerHTML).toBe('[4]');
  expect(h.el.loadMoreBtn.disabled).toBe(false);expect(h.el.emptyState.hidden).toBe(false);
  h.vistaFetch.mockResolvedValueOnce(h.response([5]));await h.load(false);
  expect(h.el.chartList.innerHTML).toBe('[4][5]');
  expect(h.el.emptyState.hidden).toBe(true);
});
test('una respuesta antigua no sustituye filtros nuevos; el reset permite mostrar IDs previos',async()=>{
  const h=harness();let resolve;
  h.vistaFetch.mockImplementationOnce(()=>new Promise(ok=>{resolve=ok;}));
  const old=h.load(true);h.vistaFetch.mockResolvedValueOnce(h.response([1,2,3,4]));await h.load(true);
  resolve(h.response([11,12,13,14]));await old;
  expect(h.el.chartList.innerHTML).toBe('[4]');
  h.vistaFetch.mockResolvedValueOnce(h.response([1,2,3,4]));await h.load(true);
  expect(h.el.chartList.innerHTML).toBe('[4]');
  h.state.view='profile';await h.load(true);expect(h.vistaFetch).toHaveBeenCalledTimes(3);
});
test('cerrar búsqueda cancela el debounce para que no reabra un ranking en otra vista',()=>{
  const clearTimeout=jest.fn();const h=harness();h.context.clearTimeout=clearTimeout;
  h.context.debounceBusqueda=99;h.el.searchOverlay={};h.el.searchInput={value:'RIIZE'};h.state.busqueda='';
  vm.runInContext(source.slice(source.indexOf('function cerrarBusqueda('),source.indexOf('el.searchToggle.addEventListener')),h.context);
  h.context.cerrarBusqueda(false);expect(clearTimeout).toHaveBeenCalledWith(99);
});
