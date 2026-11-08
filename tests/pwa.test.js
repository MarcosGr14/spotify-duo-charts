const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { configurePwa } = require('../src/pwa');
const { configureSecurity } = require('../src/security');
async function withServer(app, test) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await test(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('manifiesto raíz estable, iconos PNG correctos, recursos con hash y cabeceras sin HTML obsoleto', async () => {
  const app = express(); configureSecurity(app); const build = configurePwa(app, {production:true});
  await withServer(app, async base => {
    const manifestResponse = await fetch(base+'/manifest.webmanifest');
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({id:'/',start_url:'/',scope:'/',display:'standalone',lang:'es'});
    expect(manifest.orientation).toBeUndefined();
    expect(manifestResponse.headers.get('cache-control')).toBe('no-store');
    for (const icon of manifest.icons) {
      const response = await fetch(base+icon.src); const png = Buffer.from(await response.arrayBuffer());
      expect(response.status).toBe(200); expect(png.readUInt32BE(16)).toBe(parseInt(icon.sizes));
      expect(response.headers.get('cache-control')).toContain('immutable');
    }
    const apple = fs.readFileSync(path.join(__dirname,'../public/pwa-icons/apple-touch-icon.png'));
    expect(apple.readUInt32BE(16)).toBe(180);
    const html = await fetch(base+'/'); const text = await html.text();
    expect(html.headers.get('cache-control')).toBe('no-store');
    expect(text).toContain(build.assetUrl('app.js'));
    expect(text).toContain(build.assetUrl('pwa.js'));
    expect(text).not.toMatch(/maximum-scale|user-scalable/);
    for (const route of ['/sw.js','/pwa-config.js']) expect((await fetch(base+route)).headers.get('cache-control')).toBe('no-store');
    const workerResponse = await fetch(base+'/sw.js');
    expect(workerResponse.headers.get('content-security-policy')).not.toContain("script-src 'self' 'unsafe");
    const workerSource = await workerResponse.text();
    expect(() => new vm.Script(workerSource)).not.toThrow();
    expect(build.version).toBe(configurePwa(express(), {production:true}).version);
  });
});
test('modo privado mantiene la protección de HTML, manifiesto, worker y assets', async () => {
  const prior = process.env.SITE_VISIBILITY; process.env.SITE_VISIBILITY='private';
  const priorPass = process.env.SITE_PASSWORD; process.env.SITE_PASSWORD='local-test-only-password';
  try {
    const app=express();configureSecurity(app); const build=configurePwa(app,{production:true});
    await withServer(app,async base=>{
      for(const route of ['/','/sw.js','/manifest.webmanifest',build.assetUrl('app.js')]) expect((await fetch(base+route)).status).toBe(401);
      const r=await fetch(base+build.assetUrl('app.js'),{headers:{authorization:'Basic '+Buffer.from('duo:local-test-only-password').toString('base64')}});
      expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');
    });
  } finally {
    if(prior === undefined) delete process.env.SITE_VISIBILITY; else process.env.SITE_VISIBILITY=prior;
    if(priorPass === undefined) delete process.env.SITE_PASSWORD; else process.env.SITE_PASSWORD=priorPass;
  }
});
function workerHarness() {
  const listeners={}; const memory=new Map();const cache={
    put:jest.fn(async(key,value)=>memory.set(new URL(typeof key==='string'?key:key.url,'https://duo.test').href,value.clone())),
    match:jest.fn(async key=>memory.get(new URL(typeof key==='string'?key:key.url,'https://duo.test').href)?.clone())
  };
  const caches={open:jest.fn(async()=>cache),keys:jest.fn(async()=>['duo-charts-pwa-old','other-app','duo-charts-pwa-test']),delete:jest.fn(async()=>true)};
  const self={location:{origin:'https://duo.test'},addEventListener:(name,fn)=>listeners[name]=fn,clients:{claim:jest.fn()},skipWaiting:jest.fn()};
  const fetch=jest.fn();const DUO_BUILD={version:'test',assets:['/assets/duo-pwa/test/app.js','/assets/duo-pwa/test/offline.css'],offline:'<h1>Sin conexión</h1>',offlineCss:'body{}',offlineCssUrl:'/assets/duo-pwa/test/offline.css'};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/serviceWorker.js'),'utf8'),{self,caches,fetch,DUO_BUILD,URL,Request,Response,Set});
  const send=async(name,event={})=>{let work;listeners[name]({...event,waitUntil:p=>work=p,respondWith:p=>work=p});return work && await work;};
  const request=(url,options={})=>new Request(new URL(url,'https://duo.test'),options);
  return {send,request,cache,caches,self,fetch};
}
test('SW: no intercepta API, OAuth, otros orígenes, POST ni archivos sin hash',async()=>{
  const h=workerHarness();
  for(const request of [h.request('/api/charts'),h.request('/login'),h.request('/callback?code=test'),h.request('/health'),h.request('https://other.test/'),h.request('/app.js'),h.request('/',{method:'POST'})]) {
    expect(await h.send('fetch',{request})).toBeUndefined();
  }
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.cache.put).not.toHaveBeenCalled();
});
test('SW: navegación de red sin cachear; pérdida de conexión muestra solo fallback público y recupera la red',async()=>{
  const h=workerHarness();await h.send('install');
  const req={url:'https://duo.test/',method:'GET',mode:'navigate',headers:new Headers()};
  h.fetch.mockResolvedValueOnce(new Response('contenido privado',{headers:{'Cache-Control':'private'}}));
  expect(await (await h.send('fetch',{request:req})).text()).toBe('contenido privado');
  h.fetch.mockRejectedValueOnce(new TypeError('offline'));
  expect(await (await h.send('fetch',{request:req})).text()).toContain('Sin conexión');
  h.fetch.mockResolvedValueOnce(new Response('recuperado'));
  expect(await (await h.send('fetch',{request:req})).text()).toBe('recuperado');
  expect(h.cache.put).toHaveBeenCalledTimes(2); // solo fallback y CSS público
});
test('SW: caché primero para hash público, sin credenciales; no guarda respuestas privadas',async()=>{
  const h=workerHarness();const req=h.request('/assets/duo-pwa/test/app.js');
  h.fetch.mockResolvedValueOnce(new Response('js público',{headers:{'Cache-Control':'public,max-age=31536000,immutable'}}));
  await h.send('fetch',{request:req});await h.send('fetch',{request:req});
  expect(h.fetch).toHaveBeenCalledTimes(1);expect(h.fetch.mock.calls[0][0].credentials).toBe('omit');
  const other=workerHarness();other.fetch.mockResolvedValueOnce(new Response('privado',{headers:{'Cache-Control':'private,no-store'}}));
  await other.send('fetch',{request:req});expect(other.cache.put).not.toHaveBeenCalled();
  expect(await other.send('fetch',{request:h.request('/assets/duo-pwa/test/app.js',{headers:{authorization:'Basic test'}})})).toBeUndefined();
});
test('SW: limpieza limitada al proyecto; activar actualización requiere mensaje explícito',async()=>{
  const h=workerHarness();await h.send('install');expect(h.self.skipWaiting).not.toHaveBeenCalled();
  await h.send('activate');expect(h.caches.delete.mock.calls).toEqual([['duo-charts-pwa-old']]);
  await h.send('message',{data:{type:'DUO_ACTIVATE_UPDATE'}});expect(h.self.skipWaiting).toHaveBeenCalledTimes(1);
});
