const vm=require('node:vm');
const fs=require('node:fs');
function harness({production=true,installed=false,worker=null,config=true}={}) {
  const events={},docEvents={},swEvents={};
  const element=()=>({hidden:false,disabled:false,textContent:'',content:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});
  const ids=['pwa-install','pwa-install-help','pwa-install-status','pwa-update','pwa-update-button','pwa-update-status'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));elements.summary=element();
  const standalone={matches:installed,addEventListener:jest.fn()};
  const reg={waiting:worker,addEventListener:jest.fn(),update:jest.fn(async()=>{})};
  const serviceWorker={register:jest.fn(async()=>reg),controller:{},addEventListener:(name,fn)=>swEvents[name]=fn,getRegistrations:jest.fn(async()=>[])};
  const document={activeElement:null,hidden:false,getElementById:id=>elements[id],querySelector:selector=>selector.includes('summary')?elements.summary:null,querySelectorAll:()=>[],documentElement:{},addEventListener:(name,fn)=>docEvents[name]=fn};
  const window={DUO_PWA:config?{production}:undefined,matchMedia:()=>standalone,isSecureContext:true,addEventListener:(name,fn)=>events[name]=fn};
  const location={origin:'https://duo.test',reload:jest.fn()};
  const caches={keys:jest.fn(async()=>['duo-charts-pwa-test','other-project']),delete:jest.fn(async()=>{})};
  window.caches=caches;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/pwa.js'),'utf8'),{window,document,navigator:{serviceWorker},location,caches,getComputedStyle:()=>({getPropertyValue:()=> '#0b0b0f'}),URL,setInterval:jest.fn(),Date});
  const ready=async()=>{docEvents.DOMContentLoaded();await new Promise(resolve=>setImmediate(resolve));};
  return {elements,events,docEvents,swEvents,window,serviceWorker,reg,caches,location,ready,document};
}
test('captura antes del DOM; solo un diálogo por doble toque; cancelación sin error ni segundo prompt automático',async()=>{
  const h=harness();let resolve;const event={preventDefault:jest.fn(),prompt:jest.fn(()=>new Promise(ok=>resolve=ok)),userChoice:Promise.resolve({outcome:'dismissed'})};
  h.events.beforeinstallprompt(event);expect(event.preventDefault).toHaveBeenCalledTimes(1);await h.ready();
  expect(h.elements['pwa-install'].hidden).toBe(false);
  const first=h.elements['pwa-install'].listeners.click();await h.elements['pwa-install'].listeners.click();
  expect(event.prompt).toHaveBeenCalledTimes(1);resolve();await first;
  expect(h.elements['pwa-install-status'].textContent).toContain('más adelante');
  expect(h.elements['pwa-install'].hidden).toBe(true);
});
test('instalada o sin evento nativo: muestra estado o instrucciones sin ofrecer otro diálogo',async()=>{
  const h=harness({installed:true});await h.ready();expect(h.elements['pwa-install'].hidden).toBe(true);expect(h.elements['pwa-install-help'].hidden).toBe(true);
  const normal=harness();await normal.ready();expect(normal.elements['pwa-install-help'].hidden).toBe(false);expect(normal.elements['pwa-install'].hidden).toBe(true);
  normal.events.appinstalled();expect(normal.elements['pwa-install-help'].hidden).toBe(true);
});
test('aceptar y AbortError tienen mensajes normales, sin intentar instalar dos veces',async()=>{
  for(const outcome of ['accepted','abort']) {
    const h=harness();const event={preventDefault(){},prompt:jest.fn(async()=>{if(outcome==='abort')throw Object.assign(new Error(),{name:'AbortError'});}),userChoice:Promise.resolve({outcome})};
    h.events.beforeinstallprompt(event);await h.ready();await h.elements['pwa-install'].listeners.click();
    expect(h.elements['pwa-install-status'].textContent).toContain(outcome==='accepted'?'Instalación solicitada':'más adelante');
    expect(h.elements['pwa-install'].hidden).toBe(true);
  }
});
test('desarrollo retira exclusivamente el SW marcado y las cachés del proyecto',async()=>{
  const h=harness({production:false});
  const own={active:{scriptURL:'https://duo.test/sw.js?app=duo-charts'},unregister:jest.fn()};
  const other={active:{scriptURL:'https://duo.test/sw.js?app=another'},unregister:jest.fn()};
  h.serviceWorker.getRegistrations.mockResolvedValue([own,other]);await h.ready();
  expect(own.unregister).toHaveBeenCalledTimes(1);expect(other.unregister).not.toHaveBeenCalled();
  expect(h.caches.delete.mock.calls).toEqual([['duo-charts-pwa-test']]);expect(h.serviceWorker.register).not.toHaveBeenCalled();
});
test('actualización exige clic, bloquea edición/guardado y solo recarga la pestaña que consintió',async()=>{
  const worker={postMessage:jest.fn()};const h=harness({worker});await h.ready();
  expect(h.elements['pwa-update'].hidden).toBe(false);expect(h.location.reload).not.toHaveBeenCalled();
  h.document.activeElement={matches:()=>true};h.elements['pwa-update-button'].listeners.click();expect(worker.postMessage).not.toHaveBeenCalled();
  h.document.activeElement=null;const form={};h.docEvents.input({target:{closest:()=>form}});h.elements['pwa-update-button'].listeners.click();expect(worker.postMessage).not.toHaveBeenCalled();
  h.docEvents['duo:form-saved']({detail:{form}});h.elements['pwa-update-button'].listeners.click();h.elements['pwa-update-button'].listeners.click();expect(worker.postMessage).toHaveBeenCalledTimes(1);
  h.swEvents.controllerchange();expect(h.location.reload).toHaveBeenCalledTimes(1);
});
test('si se empieza a editar tras pedir actualización tampoco se fuerza la recarga',async()=>{
  const worker={postMessage:jest.fn()};const h=harness({worker});await h.ready();
  h.elements['pwa-update-button'].listeners.click();h.docEvents.input({target:{closest:()=>({})}});h.swEvents.controllerchange();
  expect(h.location.reload).not.toHaveBeenCalled();expect(h.elements['pwa-update-button'].disabled).toBe(false);
});

test('actualizar desde otra pestaña prepara la recarga sin forzarla ni enviar mensajes a un worker obsoleto',async()=>{
  const worker={postMessage:jest.fn()};const h=harness({worker});await h.ready();h.swEvents.controllerchange();
  expect(h.location.reload).not.toHaveBeenCalled();h.elements['pwa-update-button'].listeners.click();
  expect(h.location.reload).toHaveBeenCalledTimes(1);expect(worker.postMessage).not.toHaveBeenCalled();
});
test('guardar o resetear un formulario no descarta los cambios de otro',async()=>{
  const worker={postMessage:jest.fn()};const h=harness({worker});await h.ready();const a={},b={};
  for(const form of [a,b])h.docEvents.input({target:{closest:()=>form}});
  h.docEvents.reset({target:a});h.elements['pwa-update-button'].listeners.click();expect(worker.postMessage).not.toHaveBeenCalled();
  h.docEvents['duo:form-saved']({detail:{form:b}});h.elements['pwa-update-button'].listeners.click();expect(worker.postMessage).toHaveBeenCalledTimes(1);
});

test('no interrumpe un guardado o descarga en curso al solicitar actualización',async()=>{
  const worker={postMessage:jest.fn()};const h=harness({worker});await h.ready();
  const query=h.document.querySelector;h.document.querySelector=selector=>selector.includes('aria-busy')?{}:query(selector);
  h.elements['pwa-update-button'].listeners.click();expect(worker.postMessage).not.toHaveBeenCalled();expect(h.location.reload).not.toHaveBeenCalled();
});
