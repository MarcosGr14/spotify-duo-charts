const state = {
  view: 'overview',
  scope: 'global',
  usuarioId: null,
  dias: 7,
  tipo: 'canciones',
  usuarios: [],
  offset: 0,
  busqueda: '',
  nowPlaying: {}, // usuario_id -> { empezoEn, duracionMs } — para el ticker de progreso local
  colorCache: {} // url de portada -> color rgb() promedio, para no recalcular
};

const LIMITE_POR_PAGINA = 20;
const DIAS_TODO_EL_TIEMPO = 36500; // ~100 años, reutiliza las mismas queries del backend

const TITULOS_POR_VISTA = {
  songs: { titulo: 'Top Songs', label: 'Title' },
  artists: { titulo: 'Top Artists', label: 'Artist' },
  albums: { titulo: 'Top Albums', label: 'Album' }
};

const VISTA_A_TIPO = { songs: 'canciones', artists: 'artistas', albums: 'albumes' };

const el = {
  ticker: document.getElementById('ticker-row'),
  nowPlayingSection: document.getElementById('now-playing-section'),
  mainNav: document.getElementById('main-nav'),
  searchToggle: document.getElementById('search-toggle'),
  searchOverlay: document.getElementById('search-overlay'),
  searchInput: document.getElementById('search-input'),
  searchClose: document.getElementById('search-close'),
  controlsSection: document.getElementById('controls-section'),
  periodPills: document.getElementById('period-pills'),
  scopePills: document.getElementById('scope-pills'),
  top3Section: document.getElementById('top3-section'),
  listSection: document.getElementById('list-section'),
  colTrackLabel: document.getElementById('col-track-label'),
  chartList: document.getElementById('chart-list'),
  loadMoreBtn: document.getElementById('load-more-btn'),
  loadingState: document.getElementById('loading-state'),
  emptyState: document.getElementById('empty-state')
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function placeholderArt() {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60">
      <rect width="60" height="60" fill="#1c1c23"/>
      <text x="30" y="36" font-size="22" fill="#3a3a45" text-anchor="middle" font-family="sans-serif">♪</text>
    </svg>`
  )}`;
}

function formatearTiempo(ms) {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${min}:${String(seg).padStart(2, '0')}`;
}

function renderCambio(cambio) {
  if (cambio === null || cambio === undefined) return `<span class="change-new">NEW</span>`;
  if (cambio > 0) return `<span class="change-up">▲ ${cambio}</span>`;
  if (cambio < 0) return `<span class="change-down">▼ ${Math.abs(cambio)}</span>`;
  return `<span class="change-same">— 0</span>`;
}

// Saca el color promedio de una portada dibujándola en un canvas chico.
// Si la imagen no permite lectura por CORS (o falla por cualquier razón),
// devolvemos null y el card simplemente no tiene glow de color — nunca rompe.
async function extraerColorPromedio(url) {
  if (!url) return null;
  if (state.colorCache[url] !== undefined) return state.colorCache[url];

  const color = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 8, 8);
        const data = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

  state.colorCache[url] = color;
  return color;
}

// ------------------------------------------------------------
// Now Playing
// ------------------------------------------------------------
async function actualizarTicker() {
  try {
    const resp = await fetch('/api/currently-playing');
    const data = await resp.json();

    const tarjetas = await Promise.all(
      data.map(async (u) => {
        if (u.necesita_reconexion) {
          const slug = encodeURIComponent(u.nombre_display.toLowerCase());
          delete state.nowPlaying[u.usuario_id];
          return `
            <div class="now-card idle needs-reconnect">
              <img class="now-art" src="${u.usuario_imagen || placeholderArt()}" alt="" />
              <div class="now-info">
                <div class="now-user-row"><span class="now-user">${u.nombre_display.toUpperCase()}</span></div>
                <div class="reconnect-msg">Account disconnected</div>
                <a class="reconnect-btn" href="/login/${slug}">Reconnect</a>
              </div>
            </div>`;
        }

        if (!u.sonando) {
          delete state.nowPlaying[u.usuario_id];
          return `
            <div class="now-card idle">
              <img class="now-art" src="${placeholderArt()}" alt="" />
              <div class="now-info">
                <div class="now-user-row"><span class="now-user">${u.nombre_display.toUpperCase()}</span></div>
                <div class="now-status">Not listening right now</div>
              </div>
            </div>`;
        }

        const color = await extraerColorPromedio(u.portada);
        const tieneProgreso = Boolean(u.empezo_en && u.duracion_ms);
        if (tieneProgreso) {
          state.nowPlaying[u.usuario_id] = { empezoEn: u.empezo_en, duracionMs: u.duracion_ms };
        } else {
          delete state.nowPlaying[u.usuario_id];
        }

        return `
          <div class="now-card playing" ${color ? `style="--card-accent: ${color}"` : ''}>
            <img class="now-art" src="${u.portada || placeholderArt()}" alt="" />
            <div class="now-info">
              <div class="now-user-row">
                <span class="now-user">${u.nombre_display.toUpperCase()}</span>
                <span class="live-badge"><span class="live-dot"></span>LIVE</span>
              </div>
              <div class="now-track">${u.cancion}</div>
              <div class="now-artist">${u.artistas || ''}</div>
              ${
                tieneProgreso
                  ? `<div class="now-progress-track"><div class="now-progress-fill" data-usuario="${u.usuario_id}" style="width:0%"></div></div>
                     <div class="now-progress-times">
                       <span data-tiempo-actual="${u.usuario_id}">0:00</span>
                       <span>${formatearTiempo(u.duracion_ms)}</span>
                     </div>`
                  : ''
              }
            </div>
          </div>`;
      })
    );

    el.ticker.innerHTML = tarjetas.join('');
    actualizarBarrasDeProgreso();
  } catch (err) {
    console.error('Error consultando currently-playing:', err);
  }
}

// Corre cada 1s, independiente del poll de 20s — recalcula el ancho de
// la barra a partir de los datos ya guardados, para que se sienta fluida.
function actualizarBarrasDeProgreso() {
  Object.entries(state.nowPlaying).forEach(([usuarioId, info]) => {
    const fill = document.querySelector(`.now-progress-fill[data-usuario="${usuarioId}"]`);
    const tiempoEl = document.querySelector(`[data-tiempo-actual="${usuarioId}"]`);
    if (!fill) return;
    const elapsed = Date.now() - new Date(info.empezoEn).getTime();
    const pct = Math.max(0, Math.min(100, (elapsed / info.duracionMs) * 100));
    fill.style.width = `${pct}%`;
    if (tiempoEl) tiempoEl.textContent = formatearTiempo(elapsed);
  });
}

// ------------------------------------------------------------
// Top 3 destacado
// ------------------------------------------------------------
function renderTop3(items, titulo, subtitulo, esAvatar, mostrarVerTodo) {
  if (!items.length) {
    el.top3Section.innerHTML = '';
    return;
  }

  const [i1, i2, i3] = items;
  const ordenVisual = [i2, i1, i3].filter(Boolean);

  const verTodoBtn = mostrarVerTodo
    ? `<button class="view-all-link" data-goto="songs">View Full Chart →</button>`
    : '';

  const cardsHtml = ordenVisual
    .map((item) => {
      const esFeatured = item === i1;
      return `
        <div class="top3-card${esFeatured ? ' featured' : ''}${esAvatar ? ' avatar' : ''}" data-id="${item.id}">
          <div class="top3-rank mono">#${item.posicion}</div>
          <img class="top3-art" src="${item.portada || placeholderArt()}" alt="" />
          <div class="top3-name">${item.nombre}</div>
          ${item.subtitulo ? `<div class="top3-artist">${item.subtitulo}</div>` : ''}
          <div class="top3-plays">${item.veces_escuchada}× plays</div>
        </div>`;
    })
    .join('');

  el.top3Section.innerHTML = `
    <div class="top3-heading">
      <div><div class="top3-sub mono">${subtitulo}</div><div class="top3-title">${titulo}</div></div>
      ${verTodoBtn}
    </div>
    <div class="top3-grid">${cardsHtml}</div>
  `;
}

el.top3Section.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (btn) switchView(btn.dataset.goto);
});

// ------------------------------------------------------------
// Lista de ranking (posiciones 4+ en las vistas Songs/Artists/Albums)
// ------------------------------------------------------------
function renderFila(item, esAvatar, modoSinComparacion) {
  return `
    <li class="chart-row" data-id="${item.id}">
      <span class="col-pos mono">${item.posicion}</span>
      <div class="track-cell">
        <img class="track-art${esAvatar ? ' avatar' : ''}" src="${item.portada || placeholderArt()}" alt="" />
        <div class="track-meta">
          <div class="track-name">${item.nombre}</div>
          ${item.subtitulo ? `<div class="track-artist">${item.subtitulo}</div>` : ''}
          <div class="evolucion-hint">View trend ▾</div>
        </div>
      </div>
      <span class="col-plays">${item.veces_escuchada}×</span>
      <span class="col-change">${modoSinComparacion ? '<span class="change-same">—</span>' : renderCambio(item.cambio)}</span>
    </li>`;
}

function construirParams(offset) {
  const modoSinComparacion = state.dias === 'all';
  const diasParaApi = modoSinComparacion ? DIAS_TODO_EL_TIEMPO : state.dias;
  const params = new URLSearchParams({ scope: state.scope, dias: diasParaApi, tipo: state.tipo, offset });
  if (state.scope === 'individual' && state.usuarioId) {
    params.set('usuario_id', state.usuarioId);
  }
  if (state.busqueda) {
    params.set('busqueda', state.busqueda);
  }
  return params;
}

let ultimaSolicitudChart = 0;

// reset=true: cambió el tab/periodo/cuenta/búsqueda, arranca de cero.
// reset=false: es "Load more", agrega al final de la lista.
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
    el.loadMoreBtn.textContent = 'Loading…';
    el.loadMoreBtn.disabled = true;
  }

  try {
    const resp = await fetch(`/api/charts?${params.toString()}`);
    const data = await resp.json();
    if (idSolicitud !== ultimaSolicitudChart) return;

    el.loadingState.hidden = true;
    el.chartList.classList.remove('loading');
    el.loadMoreBtn.textContent = 'Load more';
    el.loadMoreBtn.disabled = false;

    const esAvatar = state.tipo === 'artistas';
    const modoSinComparacion = state.dias === 'all';
    const { titulo } = TITULOS_POR_VISTA[state.view] || TITULOS_POR_VISTA.songs;
    const subtitulo = state.dias === 'all' ? 'All time' : state.dias === 1 ? 'Today' : `${state.dias} days`;

    if (reset) {
      const top3 = data.slice(0, 3);
      const resto = data.slice(3);
      renderTop3(top3, titulo, subtitulo, esAvatar, false);

      if (!data.length) {
        el.chartList.innerHTML = '';
        el.emptyState.hidden = false;
      } else {
        el.emptyState.hidden = true;
        el.chartList.innerHTML = resto.map((item) => renderFila(item, esAvatar, modoSinComparacion)).join('');
      }
    } else {
      el.chartList.insertAdjacentHTML(
        'beforeend',
        data.map((item) => renderFila(item, esAvatar, modoSinComparacion)).join('')
      );
    }

    state.offset += data.length;
    el.loadMoreBtn.hidden = data.length < LIMITE_POR_PAGINA;
  } catch (err) {
    if (idSolicitud !== ultimaSolicitudChart) return;
    el.loadingState.hidden = true;
    el.chartList.classList.remove('loading');
    el.loadMoreBtn.textContent = 'Load more';
    el.loadMoreBtn.disabled = false;
    if (reset) {
      el.chartList.innerHTML = '';
      el.emptyState.textContent = 'Could not load the chart. Try reloading the page.';
      el.emptyState.hidden = false;
    }
    console.error('Error consultando charts:', err);
  }
}

el.loadMoreBtn.addEventListener('click', () => actualizarChart(false));

// ------------------------------------------------------------
// Gráfico de evolución al hacer click en una fila
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
              rx="2" fill="${esHoy ? 'var(--up)' : 'var(--text-muted)'}" opacity="${valor === 0 ? 0.25 : 0.9}">
          <title>${fecha.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}: ${valor} plays</title>
        </rect>
        <text x="${(x + anchoReal / 2).toFixed(1)}" y="${alto - 2}" font-size="9" fill="var(--text-muted)" text-anchor="middle">${diasSemana[fecha.getDay()]}</text>
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

  el.chartList.querySelectorAll('.chart-detail').forEach((n) => n.remove());
  el.chartList.querySelectorAll('.chart-row.expanded').forEach((n) => n.classList.remove('expanded'));

  if (yaAbierto) return;

  fila.classList.add('expanded');
  const detalle = document.createElement('li');
  detalle.className = 'chart-detail';
  detalle.innerHTML = '<div class="mini-chart-loading">Loading trend…</div>';
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
        <span class="mini-chart-label">Last 14 days</span>
        ${construirMiniGrafico(dias)}
      </div>`;
  } catch (err) {
    detalle.innerHTML = '<div class="mini-chart-loading">Could not load trend.</div>';
    console.error('Error consultando historial-item:', err);
  }
});

// ------------------------------------------------------------
// Overview: versión liviana (Now Playing + Top 3), sin controles ni lista
// ------------------------------------------------------------
async function cargarOverview() {
  try {
    const params = new URLSearchParams({ scope: 'global', dias: 7, tipo: 'canciones', offset: 0 });
    const resp = await fetch(`/api/charts?${params.toString()}`);
    const data = await resp.json();
    renderTop3(data.slice(0, 3), 'Top Songs', '7 days', false, true);
  } catch (err) {
    console.error('Error consultando overview:', err);
  }
}

// ------------------------------------------------------------
// Navegación entre vistas
// ------------------------------------------------------------
function switchView(view) {
  state.view = view;
  el.mainNav.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  el.searchToggle.hidden = view === 'overview';
  cerrarBusqueda(false);

  if (view === 'overview') {
    el.nowPlayingSection.hidden = false;
    el.controlsSection.hidden = true;
    el.listSection.hidden = true;
    cargarOverview();
  } else {
    el.nowPlayingSection.hidden = true;
    el.controlsSection.hidden = false;
    el.listSection.hidden = false;
    state.tipo = VISTA_A_TIPO[view];
    el.colTrackLabel.textContent = TITULOS_POR_VISTA[view].label;
    actualizarChart(true);
  }
}

el.mainNav.querySelectorAll('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ------------------------------------------------------------
// Pills de período
// ------------------------------------------------------------
el.periodPills.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    el.periodPills.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.dias = btn.dataset.dias === 'all' ? 'all' : parseInt(btn.dataset.dias, 10);
    actualizarChart(true);
  });
});

// ------------------------------------------------------------
// Pills de scope (All / Marcos / Jackie) — se arman según los usuarios reales
// ------------------------------------------------------------
async function cargarUsuarios() {
  try {
    const resp = await fetch('/api/usuarios');
    state.usuarios = await resp.json();
    renderScopePills();
  } catch (err) {
    console.error('Error consultando usuarios:', err);
  }
}

function renderScopePills() {
  const botones = [
    `<button data-scope="global" class="${state.scope === 'global' ? 'active' : ''}">All</button>`,
    ...state.usuarios.map(
      (u) =>
        `<button data-scope="individual" data-usuario="${u.id}" class="${
          state.scope === 'individual' && state.usuarioId === u.id ? 'active' : ''
        }">${u.nombre_display}</button>`
    )
  ];
  el.scopePills.innerHTML = botones.join('');
}

el.scopePills.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  el.scopePills.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.scope = btn.dataset.scope;
  state.usuarioId = btn.dataset.usuario ? parseInt(btn.dataset.usuario, 10) : null;
  actualizarChart(true);
});

// ------------------------------------------------------------
// Búsqueda
// ------------------------------------------------------------
function cerrarBusqueda(recargar = true) {
  el.searchOverlay.hidden = true;
  el.searchInput.value = '';
  if (state.busqueda) {
    state.busqueda = '';
    if (recargar && state.view !== 'overview') actualizarChart(true);
  }
}

el.searchToggle.addEventListener('click', () => {
  el.searchOverlay.hidden = false;
  el.searchInput.focus();
});
el.searchClose.addEventListener('click', () => cerrarBusqueda(true));

let debounceBusqueda = null;
el.searchInput.addEventListener('input', () => {
  clearTimeout(debounceBusqueda);
  debounceBusqueda = setTimeout(() => {
    state.busqueda = el.searchInput.value.trim();
    actualizarChart(true);
  }, 350);
});

// ------------------------------------------------------------
// Arranque
// ------------------------------------------------------------
async function init() {
  await cargarUsuarios();
  actualizarTicker();
  cargarOverview();

  setInterval(actualizarTicker, 20 * 1000);
  setInterval(actualizarBarrasDeProgreso, 1000);
}

init();
