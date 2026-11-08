(() => {
  'use strict';
  let installEvent = null;
  let installing = false;
  let installedThisSession = false;
  let ui = null;
  let waitingWorker = null;
  let reloadRequested = false;
  let updateActivated = false;
  const dirtyForms = new Set();
  const standalone = window.matchMedia('(display-mode: standalone)');
  const installed = () => installedThisSession || standalone.matches || navigator.standalone === true;
  function renderInstall() {
    if (!ui) return;
    ui.install.hidden = installed() || !installEvent;
    ui.install.disabled = installing;
    ui.help.hidden = installed();
    ui.summary.textContent = installed() ? 'Duo Charts está instalada' : 'Instalar Duo Charts';
    if (installed()) ui.status.textContent = 'Ya estás usando la app instalada.';
  }
  // Script síncrono en <head>: conserva el evento aunque aún no exista el panel.
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (!installed() && !installing) installEvent = event;
    renderInstall();
  });
  window.addEventListener('appinstalled', () => {
    installedThisSession = true; installEvent = null; renderInstall();
  });
  standalone.addEventListener?.('change', renderInstall);

  function safeToReload() {
    const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    return !dirtyForms.size && !editing && !document.querySelector('[aria-busy="true"], #profile-download:disabled, #export-chart-btn:disabled');
  }
  function showUpdate(worker) {
    if (!ui || !worker) return;
    waitingWorker = worker;
    ui.update.hidden = false;
  }
  async function setupWorker() {
    if (!('serviceWorker' in navigator)) return;
    const config = window.DUO_PWA;
    if (!config) return;
    if (!config.production) {
      // No tocar registros de otras aplicaciones que compartan el origen.
      for (const reg of await navigator.serviceWorker.getRegistrations()) {
        const worker = reg.active || reg.waiting || reg.installing;
        if (!worker) continue;
        const url = new URL(worker.scriptURL);
        if (url.origin === location.origin && url.pathname === '/sw.js' && url.searchParams.get('app') === 'duo-charts') await reg.unregister();
      }
      if ('caches' in window) for (const key of await caches.keys()) {
        if (key.startsWith('duo-charts-pwa-')) await caches.delete(key);
      }
      return;
    }
    if (!window.isSecureContext) return;
    const reg = await navigator.serviceWorker.register('/sw.js?app=duo-charts', {scope: '/', updateViaCache: 'none'});
    if (reg.waiting) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(reg.waiting || worker);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloadRequested) {
        // Otra pestaña puede haber activado el worker: ofrecer recarga, nunca imponerla.
        if (waitingWorker) {
          updateActivated = true;
          ui.updateButton.disabled = false;
          ui.updateStatus.textContent = 'Versión preparada. Actualiza cuando quieras.';
        }
        return;
      }
      updateActivated = true;
      if (safeToReload()) location.reload();
      else {
        reloadRequested = false;
        ui.updateButton.disabled = false;
        ui.updateStatus.textContent = 'Versión preparada. Termina la edición y actualiza cuando quieras.';
      }
    });
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastCheck > 60000) {
        lastCheck = Date.now(); reg.update().catch(() => {});
      }
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }
  document.addEventListener('DOMContentLoaded', () => {
    ui = {
      install: document.getElementById('pwa-install'), help: document.getElementById('pwa-install-help'),
      summary: document.querySelector('#pwa-install-details summary'), status: document.getElementById('pwa-install-status'),
      update: document.getElementById('pwa-update'), updateButton: document.getElementById('pwa-update-button'),
      updateStatus: document.getElementById('pwa-update-status')
    };
    renderInstall();
    ui.install.addEventListener('click', async () => {
      if (installing || !installEvent || installed()) return;
      installing = true;
      const event = installEvent;
      installEvent = null;
      ui.status.textContent = '';
      renderInstall();
      try {
        await event.prompt();
        const choice = await event.userChoice;
        ui.status.textContent = choice.outcome === 'accepted'
          ? 'Instalación solicitada. Sigue las indicaciones del navegador.'
          : 'Puedes instalarla más adelante desde el menú del navegador.';
      } catch (error) {
        ui.status.textContent = error.name === 'AbortError'
          ? 'Puedes instalarla más adelante desde el menú del navegador.'
          : 'Usa las instrucciones de tu navegador para instalarla.';
      } finally { installing = false; renderInstall(); }
    });
    document.addEventListener('input', event => {
      const form = event.target.closest('form');
      if (form) dirtyForms.add(form);
    });
    // Un formulario puede comunicar explícitamente que ya guardó o descartó sus cambios.
    document.addEventListener('duo:form-saved', event => {
      const form = event.detail?.form || event.target?.closest?.('form');
      if (form) dirtyForms.delete(form);
    });
    document.addEventListener('reset', event => { dirtyForms.delete(event.target); });
    ui.updateButton.addEventListener('click', () => {
      if (reloadRequested || (!waitingWorker && !updateActivated)) return;
      if (!safeToReload()) {
        ui.updateStatus.textContent = 'Termina la edición o el guardado antes de actualizar. La página seguirá abierta.';
        return;
      }
      if (updateActivated) { location.reload(); return; }
      reloadRequested = true;
      ui.updateButton.disabled = true;
      ui.updateStatus.textContent = 'Preparando la nueva versión…';
      try { waitingWorker.postMessage({ type: 'DUO_ACTIVATE_UPDATE' }); }
      catch {
        reloadRequested = false;
        ui.updateButton.disabled = false;
        ui.updateStatus.textContent = 'No se pudo preparar la actualización. Puedes volver a intentarlo.';
      }
    });
    const syncTheme = () => {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = color;
    };
    const light = window.matchMedia('(prefers-color-scheme: light)');
    light.addEventListener?.('change', syncTheme);
    document.addEventListener('duo:theme-change', syncTheme);
    syncTheme();
    // La altura real evita que el buscador quede detrás del nav en móvil/zoom.
    const header = document.querySelector('.topbar');
    if (header && 'ResizeObserver' in window) new ResizeObserver(entries => {
      document.documentElement.style.setProperty('--topbar-height', `${entries[0].target.getBoundingClientRect().height}px`);
    }).observe(header);
    setupWorker().catch(error => { console.warn('Modo instalable no disponible:', error.name); });
  });
})();
