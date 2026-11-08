// Vista previa aislada: no lee .env, no carga db/poller ni llama a Spotify/Supabase.
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const {configureSecurity}=require('../src/security');
const {configurePwa}=require('../src/pwa');
const app=express();
configureSecurity(app);
let offline=false, generation=1, current;
function build() {
  process.env.RAILWAY_GIT_COMMIT_SHA=`local-pwa-preview-${generation}`;
  current=express.Router();configurePwa(current,{production:true});
}
build();
app.post('/__pwa-test/network/:state',(req,res)=>{offline=req.params.state==='offline';res.sendStatus(204);});
app.post('/__pwa-test/version',(_req,res)=>{generation++;build();res.sendStatus(204);});
app.get('/__pwa-test/theme/:theme', (req,res)=>{
  const css=fs.readFileSync(path.join(__dirname,'../public/style.css'),'utf8');
  res.type('css').send(css.replaceAll('@media (prefers-color-scheme: light)', req.params.theme==='light'?'@media all':'@media not all'));
});
app.get('/__pwa-test/client.js',(_req,res)=>res.sendFile(path.join(__dirname,'../tests/fixtures/pwa-browser.js')));
app.use('/api',(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(req.path==='/usuarios')return res.json([{id:1,nombre_display:'Cuenta demo A'},{id:2,nombre_display:'Cuenta demo B'}]);
  if(req.path==='/currently-playing')return res.json([]);
  if(req.path==='/charts'){
    const offset=Number(req.query.offset)||0, limit=Number(req.query.limit)||20;
    return res.json(Array.from({length:60},(_,n)=>({id:n+1,nombre:`${req.query.tipo==='artistas'?'Artista':'Canción'} de prueba ${n+1}`,subtitulo:'Datos locales simulados',posicion:n+1,veces_escuchada:100-n,portada:'/favicon.png',cambio:0})).slice(offset,offset+limit));
  }
  res.status(503).json({error:'Esta sección no usa servicios reales en la vista previa.'});
});
app.use((req,res,next)=>{
  if(offline && ['/', '/index.html'].includes(req.path)) {res.socket.destroy();return;}
  const send=res.send.bind(res);
  res.send=body=>send(typeof body==='string'&&/^text\/html/.test(res.get('Content-Type')||'')&&body.includes('</body>')?body.replace('</body>','<script src="/__pwa-test/client.js"></script></body>'):body);
  current(req,res,next);
});
app.use(express.static(path.join(__dirname,'../public')));
app.listen(55932,'127.0.0.1',()=>console.log('PWA preview aislada: http://127.0.0.1:55932 (datos simulados)'));
