const state = {
  scope: 'global',
  usuarioId: null,
  dias: 7,
  tipo: 'canciones',
  usuarios: []
};

const el = {
  ticker: document.getElementById('ticker-row'),
  tabs: document.getElementById('scope-tabs'),
  typeTabs: document.getElementById('type-tabs'),
  colTrackLabel: document.getElementById('col-track-label'),
  userSubtabs: document.getElementById('user-subtabs'),
  periodo: document.getElementById('periodo'),
  chartList: document.getElementById('chart-list'),
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
async function actualizarChart() {
  const params = new URLSearchParams({ scope: state.scope, dias: state.dias, tipo: state.tipo });
  if (state.scope === 'individual' && state.usuarioId) {
    params.set('usuario_id', state.usuarioId);
  }

  try {
    const resp = await fetch(`/api/charts?${params.toString()}`);
    const data = await resp.json();

    if (!data.length) {
      el.chartList.innerHTML = '';
      el.emptyState.hidden = false;
      return;
    }
    el.emptyState.hidden = true;

    const esAvatar = state.tipo === 'artistas';

    el.chartList.innerHTML = data
      .map(
        (item) => `
        <li class="chart-row${item.posicion <= 3 ? ' top3' : ''}">
          <span class="col-pos">${item.posicion}</span>
          <div class="track-cell">
            <img class="track-art${esAvatar ? ' avatar' : ''}" src="${item.portada || placeholderArt()}" alt="" />
            <div class="track-meta">
              <div class="track-name">${item.nombre}</div>
              ${item.subtitulo ? `<div class="track-artist">${item.subtitulo}</div>` : ''}
            </div>
          </div>
          <span class="col-plays">${item.veces_escuchada}×</span>
          <span class="col-change">${renderCambio(item.cambio)}</span>
        </li>`
      )
      .join('');
  } catch (err) {
    console.error('Error consultando charts:', err);
  }
}

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
  state.dias = parseInt(el.periodo.value, 10);
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
