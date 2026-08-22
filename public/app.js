const state = {
  scope: 'global',
  usuarioId: null,
  dias: 7,
  tipo: 'canciones',
  usuarios: [],
  offset: 0,
  busqueda: ''
};

const LIMITE_POR_PAGINA = 20;

const el = {
  ticker: document.getElementById('ticker-row'),
  tabs: document.getElementById('scope-tabs'),
  typeTabs: document.getElementById('type-tabs'),
  colTrackLabel: document.getElementById('col-track-label'),
  userSubtabs: document.getElementById('user-subtabs'),
  periodo: document.getElementById('periodo'),
  chartList: document.getElementById('chart-list'),
  loadMoreBtn: document.getElementById('load-more-btn'),
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  loadingState: document.getElementById('loading-state'),
  emptyState: document.getElementById('empty-state'),
  statusPill: document.getElementById('status-pill')
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function placeholderArt(seed) {
  // Portada de respaldo si Spotify no trae imagen (poco común, pero por las dudas)
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60">
      <rect width="60" height="60" fill="#1c243a"/>
      <text x="30" y="36" font-size="22" fill="#3a4568" text-anchor="middle" font-family="sans-serif">♪</text>
    </svg>`
  )}`;
}

function renderCambio(cambio) {
  if (cambio === null || cambio === undefined) {
    return `<span class="change-new">NEW</span>`;
  }
  if (cambio > 0) return `<span class="change-up">▲ ${cambio}</span>`;
  if (cambio < 0) return `<span class="change-down">▼ ${Math.abs(cambio)}</span>`;
  return `<span class="change-same">— 0</span>`;
}

// ------------------------------------------------------------
// Ticker "sonando ahora"
// ------------------------------------------------------------
async function actualizarTicker() {
  try {
    const resp = await fetch('/api/currently-playing');
    const data = await resp.json();

    el.ticker.innerHTML = data
      .map((u) => {
        if (u.necesita_reconexion) {
          const slug = encodeURIComponent(u.nombre_display.toLowerCase());
          return `
            <div class="ticker-card needs-reconnect">
              <img class="ticker-art" src="${u.usuario_imagen || placeholderArt()}" alt="" />
              <div class="ticker-info reconnect-info">
                <div class="ticker-user">${u.nombre_display}</div>
                <div class="reconnect-msg">⚠ Cuenta desconectada</div>
              </div>
              <a class="reconnect-btn" href="/login/${slug}">Reconectar</a>
            </div>`;
        }
        if (!u.sonando) {
          return `
            <div class="ticker-card">
              <img class="ticker-art" src="${placeholderArt()}" alt="" />
              <div class="ticker-info">
                <div class="ticker-user">${u.nombre_display}</div>
                <div class="ticker-track">Sin reproducir</div>
                <div class="ticker-artist">—</div>
              </div>
            </div>`;
        }
        return `
          <div class="ticker-card playing">
            <img class="ticker-art" src="${u.portada || placeholderArt()}" alt="" />
            <div class="ticker-info">
              <div class="ticker-user">${u.nombre_display}</div>
              <div class="ticker-track">${u.cancion}</div>
              <div class="ticker-artist">${u.artistas || ''}</div>
            </div>
            <div class="ticker-eq"><span></span><span></span><span></span></div>
          </div>`;
      })
      .join('');
  } catch (err) {
    console.error('Error consultando currently-playing:', err);
  }
}

// ------------------------------------------------------------
// Ranking / chart principal
// ------------------------------------------------------------
let ultimaSolicitudChart = 0;

// "Todo el tiempo" reutiliza las mismas consultas del backend (que ya
// comparan contra "el período anterior de igual duración") pidiendo
// una ventana enorme — cualquier historial real cabe ahí. No hace
// falta tocar el backend para esto.
const DIAS_TODO_EL_TIEMPO = 36500; // ~100 años

function renderFila(item, esAvatar, modoSinComparacion) {
  return `
    <li class="chart-row${item.posicion <= 3 ? ' top3' : ''}" data-id="${item.id}">
      <span class="col-pos">${item.posicion}</span>
      <div class="track-cell">
        <img class="track-art${esAvatar ? ' avatar' : ''}" src="${item.portada || placeholderArt()}" alt="" />
        <div class="track-meta">
          <div class="track-name">${item.nombre}</div>
          ${item.subtitulo ? `<div class="track-artist">${item.subtitulo}</div>` : ''}
          <div class="evolucion-hint">Ver evolución ▾</div>
        </div>
      </div>
      <span class="col-plays">${item.veces_escuchada}×</span>
      <span class="col-change">${modoSinComparacion ? '<span class="change-same">—</span>' : renderCambio(item.cambio)}</span>
    </li>`;
}

function construirParams(offset) {
  const modoSinComparacion = state.dias === 'all';
  const diasParaApi = modoSinComparacion ? DIAS_TODO_EL_TIEMPO : state.dias;
  const params = new URLSearchParams({
    scope: state.scope,
    dias: diasParaApi,
    tipo: state.tipo,
    offset
  });
  if (state.scope === 'individual' && state.usuarioId) {
    params.set('usuario_id', state.usuarioId);
  }
  if (state.busqueda) {
    params.set('busqueda', state.busqueda);
  }
  return params;
}

// reset=true: es una carga nueva (cambió el tab/periodo/cuenta), reemplaza
// todo desde cero. reset=false: es "Ver más", agrega filas al final.
async function actualizarChart(reset = true) {
  if (reset) state.offset = 0;

  const idSolicitud = ++ultimaSolicitudChart;
  const params = construirParams(state.offset);

  if (reset) {
    el.emptyState.hidden = true;
    el.loadingState.hidden = false;
    el.chartList.classList.add('loading');
    el.loadMoreBtn.hidden = true;
  } else {
    el.loadMoreBtn.textContent = 'Cargando…';
    el.loadMoreBtn.disabled = true;
  }

  try {
    const resp = await fetch(`/api/charts?${params.toString()}`);
    const data = await resp.json();

    // Si mientras esperábamos la respuesta el usuario ya cambió de tab
    // de nuevo, esta respuesta quedó vieja — la ignoramos.
    if (idSolicitud !== ultimaSolicitudChart) return;

    el.loadingState.hidden = true;
    el.chartList.classList.remove('loading');
    el.loadMoreBtn.textContent = 'Ver más';
    el.loadMoreBtn.disabled = false;

    if (reset && !data.length) {
      el.chartList.innerHTML = '';
      el.emptyState.textContent =
        'Todavía no hay suficientes datos en esta ventana. Dejá sonando música un rato y el ranking se va a ir armando solo.';
      el.emptyState.hidden = false;
      return;
    }

    const esAvatar = state.tipo === 'artistas';
    const modoSinComparacion = state.dias === 'all';
    const filasHtml = data.map((item) => renderFila(item, esAvatar, modoSinComparacion)).join('');

    if (reset) {
      el.chartList.innerHTML = filasHtml;
    } else {
      el.chartList.insertAdjacentHTML('beforeend', filasHtml);
    }

    state.offset += data.length;
    // Si vino una página completa, probablemente haya más para pedir
    el.loadMoreBtn.hidden = data.length < LIMITE_POR_PAGINA;
  } catch (err) {
    if (idSolicitud !== ultimaSolicitudChart) return;
    el.loadingState.hidden = true;
    el.chartList.classList.remove('loading');
    el.loadMoreBtn.textContent = 'Ver más';
    el.loadMoreBtn.disabled = false;
    if (reset) {
      el.chartList.innerHTML = '';
      el.emptyState.textContent = 'No se pudo cargar el ranking. Probá recargar la página.';
      el.emptyState.hidden = false;
    }
    console.error('Error consultando charts:', err);
  }
}

el.loadMoreBtn.addEventListener('click', () => actualizarChart(false));

// ------------------------------------------------------------
// Gráfico de evolución: al hacer click en una fila, se despliega
// un mini-gráfico de barras con las reproducciones día por día de
// los últimos 14 días, justo debajo de esa fila.
// ------------------------------------------------------------
function construirMiniGrafico(dias) {
  const max = Math.max(...dias.map((d) => Number(d.plays)), 1);
  const ancho = 320;
  const alto = 90;
  const anchoBarra = ancho / dias.length;
  const diasSemana = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

  const barras = dias
    .map((d, i) => {
      const valor = Number(d.plays);
      const alturaBarra = valor === 0 ? 2 : Math.max((valor / max) * (alto - 20), 6);
      const x = i * anchoBarra + anchoBarra * 0.2;
      const y = alto - alturaBarra - 14;
      const anchoReal = anchoBarra * 0.6;
      const fecha = new Date(d.fecha);
      const esHoy = i === dias.length - 1;
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${anchoReal.toFixed(1)}" height="${alturaBarra.toFixed(1)}"
              rx="2" fill="${esHoy ? 'var(--dial-red)' : 'var(--tune-green)'}" opacity="${valor === 0 ? 0.25 : 0.85}">
          <title>${fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}: ${valor} reproducciones</title>
        </rect>
        <text x="${(x + anchoReal / 2).toFixed(1)}" y="${alto - 2}" font-size="9" fill="var(--ink-faint)" text-anchor="middle">${diasSemana[fecha.getDay()]}</text>
      `;
    })
    .join('');

  return `<svg viewBox="0 0 ${ancho} ${alto}" class="mini-chart-svg">${barras}</svg>`;
}

el.chartList.addEventListener('click', async (e) => {
  const fila = e.target.closest('.chart-row');
  if (!fila) return;

  const idItem = fila.dataset.id;
  const detalleExistente = fila.nextElementSibling;
  const yaAbierto = detalleExistente && detalleExistente.classList.contains('chart-detail');

  // Cerrar cualquier otro gráfico que haya quedado abierto
  el.chartList.querySelectorAll('.chart-detail').forEach((n) => n.remove());
  el.chartList.querySelectorAll('.chart-row.expanded').forEach((n) => n.classList.remove('expanded'));

  if (yaAbierto) return; // el click fue para cerrar el que ya estaba abierto

  fila.classList.add('expanded');
  const detalle = document.createElement('li');
  detalle.className = 'chart-detail';
  detalle.innerHTML = '<div class="mini-chart-loading">Sintonizando historial…</div>';
  fila.after(detalle);

  try {
    const params = new URLSearchParams({ tipo: state.tipo, id: idItem, scope: state.scope });
    if (state.scope === 'individual' && state.usuarioId) {
      params.set('usuario_id', state.usuarioId);
    }
    const resp = await fetch(`/api/historial-item?${params.toString()}`);
    const dias = await resp.json();
    detalle.innerHTML = `
      <div class="mini-chart-wrap">
        <span class="mini-chart-label">Últimos 14 días</span>
        ${construirMiniGrafico(dias)}
      </div>`;
  } catch (err) {
    detalle.innerHTML = '<div class="mini-chart-loading">No se pudo cargar el historial.</div>';
    console.error('Error consultando historial-item:', err);
  }
});

// ------------------------------------------------------------
// Cargar usuarios para el sub-tab "individual"
// ------------------------------------------------------------
async function cargarUsuarios() {
  try {
    const resp = await fetch('/api/usuarios');
    state.usuarios = await resp.json();
  } catch (err) {
    console.error('Error consultando usuarios:', err);
  }
}

function renderUserSubtabs() {
  if (state.scope !== 'individual') {
    el.userSubtabs.hidden = true;
    return;
  }
  el.userSubtabs.hidden = false;

  if (!state.usuarioId && state.usuarios[0]) {
    state.usuarioId = state.usuarios[0].id;
  }

  el.userSubtabs.innerHTML = state.usuarios
    .map(
      (u) => `
      <button data-usuario="${u.id}" class="${u.id === state.usuarioId ? 'active' : ''}">
        ${u.nombre_display}
      </button>`
    )
    .join('');

  el.userSubtabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.usuarioId = parseInt(btn.dataset.usuario, 10);
      renderUserSubtabs();
      actualizarChart();
    });
  });
}

// ------------------------------------------------------------
// Eventos de UI
// ------------------------------------------------------------
el.tabs.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    el.tabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.scope = tab.dataset.scope;
    renderUserSubtabs();
    actualizarChart();
  });
});

const LABELS_POR_TIPO = {
  canciones: 'Canción',
  artistas: 'Artista',
  albumes: 'Álbum'
};

el.typeTabs.querySelectorAll('.type-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    el.typeTabs.querySelectorAll('.type-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.tipo = tab.dataset.tipo;
    el.colTrackLabel.textContent = LABELS_POR_TIPO[state.tipo];
    actualizarChart();
  });
});

el.periodo.addEventListener('change', () => {
  state.dias = el.periodo.value === 'all' ? 'all' : parseInt(el.periodo.value, 10);
  actualizarChart();
});

let debounceBusqueda = null;
el.searchInput.addEventListener('input', () => {
  el.searchClear.hidden = el.searchInput.value.length === 0;
  clearTimeout(debounceBusqueda);
  debounceBusqueda = setTimeout(() => {
    state.busqueda = el.searchInput.value.trim();
    actualizarChart();
  }, 350);
});

el.searchClear.addEventListener('click', () => {
  el.searchInput.value = '';
  el.searchClear.hidden = true;
  state.busqueda = '';
  actualizarChart();
});

// ------------------------------------------------------------
// Arranque
// ------------------------------------------------------------
async function init() {
  await cargarUsuarios();
  renderUserSubtabs();
  actualizarTicker();
  actualizarChart();

  setInterval(actualizarTicker, 20 * 1000);
  setInterval(actualizarChart, 60 * 1000);
}

init();
