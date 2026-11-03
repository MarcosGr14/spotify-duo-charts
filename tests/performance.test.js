const express = require('express');
const { createResponseCache } = require('../src/responseCache');
const { createCatalogCache } = require('../src/catalogCache');
async function serverTask(app, task) {
  const server=app.listen(0,'127.0.0.1'); await new Promise((r)=>server.once('listening',r));
  try { await task(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r)=>server.close(r)); }
}
test('coalesce consultas iguales, aísla filtros y nunca cachea errores ni exportaciones',async()=>{
  const store=createResponseCache(); const app=express(); let calls=0;
  app.use(store.middleware);
  app.get('/charts',async(req,res)=>{calls++;await new Promise(r=>setTimeout(r,30));if(req.query.error)return res.status(500).json({error:true});res.json({user:req.query.usuario_id,calls});});
  await serverTask(app,async(base)=>{
    const [a,b]=await Promise.all([fetch(base+'/charts?usuario_id=1'),fetch(base+'/charts?usuario_id=1')]);
    expect(await a.json()).toEqual(await b.json()); expect(calls).toBe(1);
    expect((await fetch(base+'/charts?usuario_id=1')).headers.get('x-app-cache')).toBe('HIT');
    expect((await (await fetch(base+'/charts?usuario_id=2')).json()).user).toBe('2');
    await fetch(base+'/charts?error=1'); await fetch(base+'/charts?error=1'); expect(calls).toBe(4);
    await fetch(base+'/charts?limit=5001'); await fetch(base+'/charts?limit=5001'); expect(calls).toBe(6);
  });
});
test('la caché de respuestas tiene límite de memoria y entradas',async()=>{
  const store=createResponseCache({maxEntries:2,maxBytes:1000,maxItemBytes:100});const app=express();app.use(store.middleware);app.get('/charts',(req,res)=>res.json(req.query));
  await serverTask(app,async(base)=>{for(let n=0;n<5;n++)await fetch(base+'/charts?usuario_id='+n);expect(store.stats().entries).toBeLessThanOrEqual(2);expect(store.stats().bytes).toBeLessThanOrEqual(1000);});
});
test('metadatos repetidos se guardan una vez; errores se reintentan; TTL y capacidad se respetan',async()=>{
  jest.useFakeTimers();
  try {const cached=createCatalogCache({maxEntries:1,ttl:100});const load=jest.fn().mockResolvedValue(7);
    expect(await Promise.all([cached('a',load),cached('a',load)])).toEqual([7,7]);expect(load).toHaveBeenCalledTimes(1);
    await cached('a',load);expect(load).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(101);await cached('a',load);expect(load).toHaveBeenCalledTimes(2);
    await cached('b',load);await cached('a',load);expect(load).toHaveBeenCalledTimes(4);
    const fail=jest.fn().mockRejectedValueOnce(new Error('DB')).mockResolvedValueOnce(9);
    await expect(cached('c',fail)).rejects.toThrow('DB');expect(await cached('c',fail)).toBe(9);
  }finally{jest.useRealTimers();}
});
