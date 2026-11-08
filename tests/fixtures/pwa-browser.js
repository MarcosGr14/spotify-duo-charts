// Controles exclusivos de scripts/pwa-preview.js. Nunca servidos en producción.
document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('aside');panel.className='pwa-section';
  const title=document.createElement('h2');title.textContent='Pruebas locales · datos simulados';panel.append(title);
  const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
  function button(label,action){const b=document.createElement('button');b.className='retry-chart-btn';b.textContent=label;b.addEventListener('click',async()=>{try{await action();}catch(e){status.textContent=e.message;}});panel.append(b);}
  for (const theme of ['light','dark']) button(theme==='light'?'Probar tema claro':'Probar tema oscuro',async()=>{
    let link=document.getElementById('pwa-test-theme');
    if (!link) {link=document.createElement('link');link.id='pwa-test-theme';link.rel='stylesheet';document.head.append(link);}
    link.onload=()=>document.dispatchEvent(new Event('duo:theme-change'));
    link.href='/__pwa-test/theme/'+theme;
    status.textContent='Tema forzado para comprobación visual local: '+theme;
  });
  button('Comprobar worker y caché',async()=>{
    const reg=await navigator.serviceWorker.getRegistration('/');
    await fetch('/api/usuarios');
    const names=(await caches.keys()).filter(n=>n.startsWith('duo-charts-pwa-'));
    const paths=(await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>new URL(r.url).pathname)))).flat();
    status.textContent=`Worker activo: ${Boolean(reg?.active)}. Esperando: ${Boolean(reg?.waiting)}. Instalando: ${reg?.installing?.state || 'no'}. Cachés del proyecto: ${names.length}. API almacenada: ${paths.some(p=>p.startsWith('/api/'))}.`;
  });
  button('Simular cancelación y doble toque',async()=>{
    let calls=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{calls++;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);
    const b=document.getElementById('pwa-install');b.click();b.click();await new Promise(r=>setTimeout(r,20));
    status.textContent=`Diálogos simulados: ${calls}. ${document.getElementById('pwa-install-status').textContent}`;
  });
  button('Preparar actualización local',async()=>{
    await fetch('/__pwa-test/version',{method:'POST'});
    const reg=await navigator.serviceWorker.getRegistration('/');await reg.update();
    status.textContent='Nueva build local solicitada; el aviso de actualización aparecerá sin recargar.';
  });
  button('Simular pérdida de conexión',async()=>{
    await fetch('/__pwa-test/network/offline',{method:'POST'});location.href='/';
  });
  document.querySelector('.pwa-section').after(panel);
});
