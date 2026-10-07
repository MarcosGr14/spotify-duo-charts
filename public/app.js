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
  colorCache: {}, // url de portada -> color rgb() promedio, para no recalcular
  activityMonth: null,
  activityScope: 'global',
  activityUserId: null,
  activityData: null,
  activityTimezone: 'America/Panama',
  profileUserId: null,
  profileData: null,
  profileColor: '#ff5f6d'
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
  exportBtn: document.getElementById('export-chart-btn'),
  exportStatus: document.getElementById('export-status'),
  loadingState: document.getElementById('loading-state'),
  emptyState: document.getElementById('empty-state'),
  retryChartBtn: document.getElementById('retry-chart-btn'),
  // Music Match (Fase 5)
  matchSection: document.getElementById('match-section'),
  matchLoading: document.getElementById('match-loading'),
  matchUnavailable: document.getElementById('match-unavailable'),
  matchContent: document.getElementById('match-content'),
  matchRingFill: document.getElementById('match-ring-fill'),
  matchPercent: document.getElementById('match-percent'),
  matchSubstats: document.getElementById('match-substats'),
  matchArtistArt: document.getElementById('match-artist-art'),
  matchArtistName: document.getElementById('match-artist-name'),
  matchArtistPlays: document.getElementById('match-artist-plays'),
  matchTrackArt: document.getElementById('match-track-art'),
  matchTrackName: document.getElementById('match-track-name'),
  matchTrackPlays: document.getElementById('match-track-plays'),
  balanceRows: document.getElementById('balance-rows'),
  // Insights / Records (Fase 6)
  insightsSection: document.getElementById('insights-section'),
  insightsLoading: document.getElementById('insights-loading'),
  insightsUnavailable: document.getElementById('insights-unavailable'),
  insightsGrid: document.getElementById('insights-grid'),
  insightObsessedArt: document.getElementById('insight-obsessed-art'),
  insightObsessedName: document.getElementById('insight-obsessed-name'),
  insightObsessedArtist: document.getElementById('insight-obsessed-artist'),
  insightObsessedPlays: document.getElementById('insight-obsessed-plays'),
  insightOwlName: document.getElementById('insight-owl-name'),
  insightOwlDetail: document.getElementById('insight-owl-detail'),
  insightSharedArt: document.getElementById('insight-shared-art'),
  insightSharedName: document.getElementById('insight-shared-name'),
  insightSharedArtist: document.getElementById('insight-shared-artist'),
  insightSharedDetail: document.getElementById('insight-shared-detail'),
  activitySection: document.getElementById('activity-section'),
  activityScopePills: document.getElementById('activity-scope-pills'),
  activityMonthLabel: document.getElementById('activity-month-label'),
  activityLoading: document.getElementById('activity-loading'),
  activityError: document.getElementById('activity-error'),
  activityContent: document.getElementById('activity-content'),
  activityStats: document.getElementById('activity-stats'),
  activityHeatmap: document.getElementById('activity-heatmap'),
  activityCalendar: document.getElementById('activity-calendar'),
  activityDayDetail: document.getElementById('activity-day-detail'),
  activityDiscoveries: document.getElementById('activity-discoveries'),
  activityDuoPanel: document.getElementById('activity-duo-panel'),
  activityDuo: document.getElementById('activity-duo'),
  profileSection: document.getElementById('profile-section'),
  profileName: document.getElementById('profile-name'),
  profileUsers: document.getElementById('profile-users'),
  profileColors: document.getElementById('profile-colors'),
  profileCustomColor: document.getElementById('profile-custom-color'),
  profileLoading: document.getElementById('profile-loading'),
  profileError: document.getElementById('profile-error'),
  profileContent: document.getElementById('profile-content'),
  profileStats: document.getElementById('profile-stats'),
  profileTopSongs: document.getElementById('profile-top-songs'),
  profileTopArtists: document.getElementById('profile-top-artists'),
  profileTopAlbums: document.getElementById('profile-top-albums'),
  profileRecapPreview: document.getElementById('profile-recap-preview'),
  profileRecapStatus: document.getElementById('profile-recap-status'),
  profileDownload: document.getElementById('profile-download')
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

function escaparHTML(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caracter]);
}

function imagenSegura(url) {
  if (!url) return placeholderArt();
  try {
    const parsed = new URL(url, window.location.origin);
    return ['https:', 'http:'].includes(parsed.protocol) ? escaparHTML(parsed.href) : placeholderArt();
  } catch {
    return placeholderArt();
  }
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
              <img class="now-art" src="${imagenSegura(u.usuario_imagen)}" alt="" />
              <div class="now-info">
                <div class="now-user-row"><span class="now-user">${escaparHTML(String(u.nombre_display).toUpperCase())}</span></div>
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
                <div class="now-user-row"><span class="now-user">${escaparHTML(String(u.nombre_display).toUpperCase())}</span></div>
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
            <img class="now-art" src="${imagenSegura(u.portada)}" alt="" />
            <div class="now-info">
              <div class="now-user-row">
                <span class="now-user">${escaparHTML(String(u.nombre_display).toUpperCase())}</span>
                <span class="live-badge"><span class="live-dot"></span>LIVE</span>
              </div>
              <div class="now-track">${escaparHTML(u.cancion)}</div>
              <div class="now-artist">${escaparHTML(u.artistas || '')}</div>
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
// Music Match (Fase 5 — Duo Intelligence)
// ------------------------------------------------------------
const CIRCUNFERENCIA_ANILLO = 2 * Math.PI * 52; // r=52, ver style.css

function mostrarEstadoMatch(estado) {
  // estado: 'loading' | 'unavailable' | 'content' | 'error'
  el.matchLoading.hidden = estado !== 'loading';
  el.matchUnavailable.hidden = estado !== 'unavailable' && estado !== 'error';
  el.matchContent.hidden = estado !== 'content';
  if (estado === 'error') {
    el.matchUnavailable.querySelector('p').textContent =
      'No se pudo cargar Music Match. Probá recargando la página.';
  }
}

// Rellena una de las dos tarjetas "Top Shared" (artista o track). Si
// item es null (sin datos compartidos todavía), muestra un estado
// vacío legible en vez de dejar textos "undefined" o imágenes rotas.
function renderTopCompartido({ artEl, nameEl, playsEl, item, esAvatar, mensajeVacio }) {
  if (!item) {
    artEl.src = placeholderArt();
    artEl.alt = '';
    nameEl.textContent = mensajeVacio;
    playsEl.textContent = '';
    return;
  }
  artEl.src = imagenSegura(item.imagen_url);
  artEl.alt = item.nombre;
  nameEl.textContent = item.nombre;
  playsEl.textContent = `${item.reproducciones_totales}× combined plays`;
}

function renderBalance(balance) {
  if (!balance || !balance.length) {
    el.balanceRows.innerHTML = '<p class="balance-detail">No listening data yet for this period.</p>';
    return;
  }

  el.balanceRows.innerHTML = balance
    .map(
      (b) => `
        <div class="balance-row">
          <div class="balance-row-top">
          <span class="balance-name">${escaparHTML(b.nombre_display)}</span>
            <span class="balance-detail">${b.reproducciones}× · ${b.porcentaje}%</span>
          </div>
          <div class="balance-bar-track">
            <div class="balance-bar-fill" style="width:${b.porcentaje}%"></div>
          </div>
        </div>`
    )
    .join('');
}

async function cargarMusicMatch() {
  el.matchSection.hidden = false;
  mostrarEstadoMatch('loading');

  try {
    const resp = await fetch('/api/music-match?dias=7');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.disponible) {
      mostrarEstadoMatch('unavailable');
      return;
    }

    // Anillo de porcentaje
    const porcentaje = Number(data.porcentaje) || 0;
    const offset = CIRCUNFERENCIA_ANILLO * (1 - porcentaje / 100);
    el.matchRingFill.style.strokeDashoffset = String(offset);
    el.matchPercent.textContent = `${porcentaje}%`;

    // Sub-stats: "N shared artists · M shared tracks"
    const artistasCompartidos = data.artistas_compartidos ?? 0;
    const tracksCompartidos = data.tracks_compartidos ?? 0;
    el.matchSubstats.textContent = `${artistasCompartidos} shared artist${artistasCompartidos === 1 ? '' : 's'} · ${tracksCompartidos} shared track${tracksCompartidos === 1 ? '' : 's'}`;

    renderTopCompartido({
      artEl: el.matchArtistArt,
      nameEl: el.matchArtistName,
      playsEl: el.matchArtistPlays,
      item: data.artista_principal,
      esAvatar: true,
      mensajeVacio: 'No shared artists yet'
    });

    renderTopCompartido({
      artEl: el.matchTrackArt,
      nameEl: el.matchTrackName,
      playsEl: el.matchTrackPlays,
      item: data.track_principal,
      esAvatar: false,
      mensajeVacio: 'No shared tracks yet'
    });

    renderBalance(data.balance);

    mostrarEstadoMatch('content');
  } catch (err) {
    console.error('Error consultando music-match:', err);
    mostrarEstadoMatch('error');
  }
}

// ------------------------------------------------------------
// Insights / Records (Fase 6)
// ------------------------------------------------------------
function mostrarEstadoInsights(estado) {
  // estado: 'loading' | 'unavailable' | 'content' | 'error'
  el.insightsLoading.hidden = estado !== 'loading';
  el.insightsUnavailable.hidden = estado !== 'unavailable' && estado !== 'error';
  el.insightsGrid.hidden = estado !== 'content';
  if (estado === 'error') {
    el.insightsUnavailable.querySelector('p').textContent =
      'No se pudieron cargar los insights. Probá recargando la página.';
  }
}

function renderMostObsessedTrack(item) {
  if (!item) {
    el.insightObsessedArt.src = placeholderArt();
    el.insightObsessedArt.alt = '';
    el.insightObsessedName.textContent = 'Not enough plays yet';
    el.insightObsessedArtist.textContent = '';
    el.insightObsessedPlays.textContent = '';
    return;
  }
  el.insightObsessedArt.src = imagenSegura(item.imagen_url);
  el.insightObsessedArt.alt = item.nombre;
  el.insightObsessedName.textContent = item.nombre;
  el.insightObsessedArtist.textContent = item.artista || '';
  el.insightObsessedPlays.textContent = `${item.reproducciones_totales}× plays`;
}

function renderNightOwl(nightOwl) {
  if (!nightOwl) {
    el.insightOwlName.textContent = 'No late-night listening yet';
    el.insightOwlDetail.textContent = '';
    return;
  }
  el.insightOwlName.textContent = nightOwl.nombre_display;
  el.insightOwlDetail.textContent = `${nightOwl.reproducciones_nocturnas} late-night plays · ${nightOwl.porcentaje_nocturno}%`;
}

function renderSharedObsession(item) {
  if (!item) {
    el.insightSharedArt.src = placeholderArt();
    el.insightSharedArt.alt = '';
    el.insightSharedName.textContent = 'No shared obsession yet';
    el.insightSharedArtist.textContent = '';
    el.insightSharedDetail.textContent = '';
    return;
  }

  // plays_usuario_1/2 vienen en el mismo orden por id que /api/usuarios
  // (calcularRecords ordena "ORDER BY id LIMIT 2"), así que usamos los
  // nombres reales ya cargados en state.usuarios en vez de hardcodear
  // "Marcos"/"Jackie" — si algún día cambian los nombres de las cuentas,
  // esto sigue funcionando sin tocar el frontend.
  const [nombreU1, nombreU2] = state.usuarios.length >= 2
    ? [state.usuarios[0].nombre_display, state.usuarios[1].nombre_display]
    : ['Usuario 1', 'Usuario 2'];

  el.insightSharedArt.src = imagenSegura(item.imagen_url);
  el.insightSharedArt.alt = item.nombre;
  el.insightSharedName.textContent = item.nombre;
  el.insightSharedArtist.textContent = item.artista || '';
  el.insightSharedDetail.textContent = `${nombreU1} ${item.plays_usuario_1} · ${nombreU2} ${item.plays_usuario_2}`;
}

async function cargarInsights() {
  el.insightsSection.hidden = false;
  mostrarEstadoInsights('loading');

  try {
    const resp = await fetch('/api/records?dias=7');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.disponible) {
      mostrarEstadoInsights('unavailable');
      return;
    }

    renderMostObsessedTrack(data.most_obsessed_track);
    renderNightOwl(data.night_owl);
    renderSharedObsession(data.shared_obsession);

    mostrarEstadoInsights('content');
  } catch (err) {
    console.error('Error consultando records:', err);
    mostrarEstadoInsights('error');
  }
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
      <div class="top3-card${esFeatured ? ' featured' : ''}${esAvatar ? ' avatar' : ''}" data-id="${Number(item.id)}">
          <div class="top3-rank mono">#${item.posicion}</div>
          <img class="top3-art" src="${imagenSegura(item.portada)}" alt="" loading="lazy" />
          <div class="top3-name">${escaparHTML(item.nombre)}</div>
          ${item.subtitulo ? `<div class="top3-artist">${escaparHTML(item.subtitulo)}</div>` : ''}
          <div class="top3-plays">${Number(item.veces_escuchada) || 0}× plays</div>
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
    <li class="chart-row" data-id="${Number(item.id)}" role="button" tabindex="0" aria-expanded="false" aria-label="View 14-day trend for ${escaparHTML(item.nombre)}">
      <span class="col-pos mono">${Number(item.posicion) || ''}</span>
      <div class="track-cell">
        <img class="track-art${esAvatar ? ' avatar' : ''}" src="${imagenSegura(item.portada)}" alt="" loading="lazy" />
        <div class="track-meta">
          <div class="track-name">${escaparHTML(item.nombre)}</div>
          ${item.subtitulo ? `<div class="track-artist">${escaparHTML(item.subtitulo)}</div>` : ''}
          <div class="evolucion-hint">View trend ▾</div>
        </div>
      </div>
      <span class="col-plays">${Number(item.veces_escuchada) || 0}×</span>
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
    el.retryChartBtn.hidden = true;
    el.loadingState.hidden = false;
    el.chartList.classList.add('loading');
    el.loadMoreBtn.hidden = true;
  } else {
    el.loadMoreBtn.textContent = 'Loading…';
    el.loadMoreBtn.disabled = true;
  }

  try {
    const resp = await fetch(`/api/charts?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error('Invalid chart response');
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
        el.emptyState.textContent = 'Not enough data yet for this window. Keep listening and the chart will build itself.';
        el.emptyState.hidden = false;
        el.retryChartBtn.hidden = true;
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
      el.emptyState.textContent = err.message.startsWith('HTTP')
        ? `The server could not load this chart (${err.message}). Check the terminal for the database/API error.`
        : err instanceof TypeError
          ? 'Could not reach the local server. Confirm it is running, then try again.'
          : 'The server returned an invalid response. Check its terminal output, then try again.';
      el.emptyState.hidden = false;
      el.retryChartBtn.hidden = false;
    }
    console.error('Error consultando charts:', err);
  }
}

el.retryChartBtn.addEventListener('click', () => actualizarChart(true));

// Descarga el ranking filtrado consultando las páginas de la misma API.
// No modifica ni crea datos en la base; el CSV se genera localmente.
function campoCSV(valor) {
  let texto = String(valor ?? '');
  // Evita que hojas de cálculo interpreten nombres como fórmulas.
  if (/^[\t\r\n ]*[=+@-]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

async function exportarRankingCSV() {
  if (el.exportBtn.disabled) return;
  el.exportBtn.disabled = true;
  el.exportBtn.setAttribute('aria-busy', 'true');
  el.exportStatus.textContent = 'Preparing export…';

  const parametrosBase = construirParams(0);
  const tipoExportado = parametrosBase.get('tipo');
  const periodoExportado = parametrosBase.get('dias') === String(DIAS_TODO_EL_TIEMPO)
    ? 'all-time'
    : `${parametrosBase.get('dias')}-days`;
  const usuarioExportado = state.usuarios.find((u) => u.id === Number(parametrosBase.get('usuario_id')));
  const alcanceExportado = parametrosBase.get('scope') === 'individual'
    ? (usuarioExportado?.nombre_display || 'individual')
    : 'global';
  const filas = [];
  const maxFilas = 5000;
  let truncado = false;

  try {
    const params = new URLSearchParams(parametrosBase);
    params.set('limit', String(maxFilas + 1));
    const resp = await fetch(`/api/charts?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const resultado = await resp.json();
    if (!Array.isArray(resultado)) throw new Error('Respuesta de ranking inválida');
    truncado = resultado.length > maxFilas;
    filas.push(...resultado.slice(0, maxFilas));
    el.exportStatus.textContent = `Preparing ${filas.length.toLocaleString()} rows…`;

    if (!filas.length) {
      el.exportStatus.textContent = 'No rows to export for these filters.';
      return;
    }

    const headers = ['Period', 'Scope', 'Search', 'Position', 'Name', 'Artist', 'Plays', 'Rank change'];
    const lineas = [headers.map(campoCSV).join(',')];
    for (const fila of filas) {
      lineas.push([
        periodoExportado,
        alcanceExportado,
        parametrosBase.get('busqueda') || '',
        Number(fila.posicion) || '',
        fila.nombre,
        fila.subtitulo,
        Number(fila.veces_escuchada) || 0,
        fila.cambio == null ? '' : Number(fila.cambio)
      ].map(campoCSV).join(','));
    }

    const blob = new Blob([`\uFEFF${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `spotify-duo-${tipoExportado}-${periodoExportado}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    el.exportStatus.textContent = truncado
      ? `Exported ${filas.length.toLocaleString()} rows (maximum reached).`
      : `Exported ${filas.length.toLocaleString()} rows.`;
  } catch (err) {
    console.error('Error exportando ranking:', err);
    el.exportStatus.textContent = 'Export failed. Please try again.';
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.removeAttribute('aria-busy');
  }
}

el.exportBtn.addEventListener('click', exportarRankingCSV);

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
  el.chartList.querySelectorAll('.chart-row.expanded').forEach((n) => {
    n.classList.remove('expanded');
    n.setAttribute('aria-expanded', 'false');
  });

  if (yaAbierto) {
    fila.setAttribute('aria-expanded', 'false');
    return;
  }

  fila.classList.add('expanded');
  fila.setAttribute('aria-expanded', 'true');
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

el.chartList.addEventListener('keydown', (e) => {
  const fila = e.target.closest('.chart-row');
  if (!fila || !['Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  fila.click();
});

// ------------------------------------------------------------
// Overview: versión liviana (Now Playing + Music Match + Insights + Top 3), sin controles ni lista
// ------------------------------------------------------------
async function cargarOverview() {
  cargarMusicMatch();
  cargarInsights();
  cargarActividad();
  try {
    const params = new URLSearchParams({ scope: 'global', dias: 7, tipo: 'canciones', offset: 0 });
    const resp = await fetch(`/api/charts?${params.toString()}`);
    const data = await resp.json();
    renderTop3(data.slice(0, 3), 'Top Songs', '7 days', false, true);
  } catch (err) {
    console.error('Error consultando overview:', err);
  }
}

function moverMes(mes, delta) {
  const [año, numero] = mes.split('-').map(Number);
  const fecha = new Date(Date.UTC(año, numero - 1 + delta, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
}

function renderActivityScopes() {
  el.activityScopePills.innerHTML = [
    `<button type="button" data-activity-scope="global" class="${state.activityScope === 'global' ? 'active' : ''}">All</button>`,
    ...state.usuarios.map((u) => `<button type="button" data-activity-scope="individual" data-activity-user="${u.id}" class="${state.activityScope === 'individual' && state.activityUserId === u.id ? 'active' : ''}">${escaparHTML(u.nombre_display)}</button>`)
  ].join('');
}

async function cargarActividad() {
  el.activitySection.hidden = false;
  el.activityLoading.hidden = false;
  el.activityError.hidden = true;
  el.activityContent.hidden = true;
  renderActivityScopes();
  try {
    const params = new URLSearchParams();
    if (state.activityMonth) params.set('month', state.activityMonth);
    if (state.activityScope === 'individual' && state.activityUserId) {
      params.set('scope', 'individual');
      params.set('usuario_id', state.activityUserId);
    }
    const response = await fetch(`/api/activity?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.activityData = data;
    state.activityMonth = data.mes;
    state.activityTimezone = data.zona_horaria || 'America/Panama';
    renderActividad(data);
    el.activityLoading.hidden = true;
    el.activityContent.hidden = false;
  } catch (error) {
    console.error('Error consultando actividad:', error);
    el.activityLoading.hidden = true;
    el.activityError.hidden = false;
  }
}

function renderActividad(data) {
  const [año, mes] = data.mes.split('-').map(Number);
  el.activityMonthLabel.textContent = new Intl.DateTimeFormat('es-PA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(año, mes - 1, 1)));
  const rachasPorUsuario = new Map(data.rachas.map((racha) => [racha.usuario_id, racha]));
  el.activityStats.innerHTML = state.usuarios.filter((u) => data.usuario_id == null || u.id === data.usuario_id).map((u) => {
    const r = rachasPorUsuario.get(u.id) || { nombre_display: u.nombre_display, racha_actual: 0, mejor_racha: 0, dias_activos: 0 };
    return `
    <article class="activity-stat-card"><span class="activity-stat-name">${escaparHTML(r.nombre_display)}</span><strong>${r.racha_actual}<small> días</small></strong><span class="activity-stat-caption">racha actual · récord ${r.mejor_racha} días · ${r.dias_activos} días activos registrados</span></article>`;
  }).join('');
  renderMapaActividad(data.mapa_horario);
  renderCalendarioActividad(data.calendario);
  renderDescubrimientos(data.descubrimientos);
  renderDuo(data.duo);
}

function renderMapaActividad(filas) {
  const valores = new Map(filas.map((f) => [`${f.dia_semana}-${f.hora}`, Number(f.reproducciones)]));
  const maximo = Math.max(1, ...valores.values());
  const dias = [{ id: 1, nombre: 'Lun' }, { id: 2, nombre: 'Mar' }, { id: 3, nombre: 'Mié' }, { id: 4, nombre: 'Jue' }, { id: 5, nombre: 'Vie' }, { id: 6, nombre: 'Sáb' }, { id: 0, nombre: 'Dom' }];
  const marcas = Array.from({ length: 24 }, (_, hora) => `<span>${String(hora).padStart(2, '0')}</span>`).join('');
  const filasHTML = dias.map((dia) => `<div class="heatmap-row"><span class="heatmap-day">${dia.nombre}</span>${Array.from({ length: 24 }, (_, hora) => {
    const count = valores.get(`${dia.id}-${hora}`) || 0;
    const level = count ? Math.min(4, Math.ceil((count / maximo) * 4)) : 0;
    return `<i class="heat-cell level-${level}" title="${dia.nombre}, ${String(hora).padStart(2, '0')}:00 · ${count} reproducciones" aria-label="${dia.nombre}, ${hora}:00, ${count} reproducciones"></i>`;
  }).join('')}</div>`).join('');
  el.activityHeatmap.innerHTML = `<div class="heatmap-hours"><span></span>${marcas}</div>${filasHTML}`;
}

function renderCalendarioActividad(filas) {
  const [año, mes] = state.activityMonth.split('-').map(Number);
  const primerDia = new Date(Date.UTC(año, mes - 1, 1));
  const offset = (primerDia.getUTCDay() + 6) % 7;
  const mapa = new Map(filas.map((f) => [f.fecha, f]));
  const encabezados = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((dia) => `<span class="calendar-weekday">${dia}</span>`).join('');
  const huecos = Array.from({ length: offset }, () => '<span class="calendar-blank"></span>').join('');
  const dias = filas.map((dia) => `<button type="button" class="calendar-day${dia.reproducciones ? ' has-plays' : ''}" data-day="${dia.fecha}" aria-label="${dia.fecha}: ${dia.reproducciones} reproducciones"><span>${Number(dia.fecha.slice(-2))}</span>${dia.reproducciones ? `<i style="--day-intensity:${Math.min(100, Math.round(Math.log1p(dia.reproducciones) / 5 * 100))}%"></i>` : ''}</button>`).join('');
  el.activityCalendar.innerHTML = encabezados + huecos + dias;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: state.activityTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const inicial = mapa.get(hoy) || filas.find((dia) => dia.reproducciones > 0) || filas[0];
  el.activityCalendar.querySelectorAll('.calendar-day').forEach((button) => button.classList.toggle('selected', button.dataset.day === inicial?.fecha));
  mostrarDetalleDia(inicial);
}

function mostrarDetalleDia(dia) {
  if (!dia) return;
  const fecha = new Intl.DateTimeFormat('es-PA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${dia.fecha}T12:00:00Z`));
  el.activityDayDetail.innerHTML = `<strong>${escaparHTML(fecha)}</strong><span>${dia.reproducciones} reproducciones</span>${dia.cancion_destacada ? `<p>Más escuchada: <b>${escaparHTML(dia.cancion_destacada)}</b>${dia.artistas_destacados ? ` · ${escaparHTML(dia.artistas_destacados)}` : ''}</p>` : '<p>Sin reproducciones registradas este día.</p>'}`;
}

function renderDescubrimientos(items) {
  el.activityDiscoveries.innerHTML = items.map((u) => `<div class="discovery-person"><h4>${escaparHTML(u.nombre_display)}</h4><p><b>${u.canciones.total || 0}</b> canciones y <b>${u.artistas.total || 0}</b> artistas nuevos registrados este mes</p><ul>${[...u.canciones.recientes.map((n) => ({ ...n, tipo: 'Canción' })), ...u.artistas.recientes.slice(0, 3).map((n) => ({ ...n, tipo: 'Artista' }))].slice(0, 5).map((n) => `<li><span>${escaparHTML(n.tipo)} · ${escaparHTML(n.nombre)}${n.artista ? ` — ${escaparHTML(n.artista)}` : ''}</span><time>${escaparHTML(n.fecha)}</time></li>`).join('') || '<li class="muted-row">No hay primeros registros este mes.</li>'}</ul></div>`).join('') || '<p class="activity-empty">No hay cuentas para mostrar.</p>';
}

function renderDuo(duo) {
  el.activityDuoPanel.hidden = !duo;
  if (!duo) return;
  const destacado = duo.cancion_compartida_destacada;
  el.activityDuo.innerHTML = `<div class="duo-metrics"><div><strong>${duo.dias_compartidos || 0}</strong><span>días escuchando ambos</span></div><div><strong>${duo.canciones_compartidas || 0}</strong><span>canciones compartidas</span></div><div><strong>${duo.artistas_compartidos || 0}</strong><span>artistas compartidos</span></div></div>${destacado ? `<div class="shared-track"><img src="${imagenSegura(destacado.portada)}" alt=""/><div><b>${escaparHTML(destacado.nombre)}</b><span>${escaparHTML(destacado.artistas)}</span><small>${destacado.reproducciones_usuario_1 + destacado.reproducciones_usuario_2} reproducciones entre ambos</small></div></div>` : '<p class="activity-empty">Aún no hay canciones escuchadas por ambas cuentas este mes.</p>'}<p class="presentation-note">Primeros registros de canciones ya escuchadas por la otra cuenta: ${duo.presentaciones.map((p) => `${escaparHTML(p.nombre_display)} ${p.total}`).join(' · ')}</p>`;
}

const CLAVE_COLORES_PERFIL = 'spotify-duo-profile-colors';
let solicitudPerfil = 0;

function coloresPerfilGuardados() {
  try { return JSON.parse(localStorage.getItem(CLAVE_COLORES_PERFIL) || '{}'); }
  catch { return {}; }
}

function aplicarColorPerfil(color = '#ff5f6d') {
  state.profileColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ff5f6d';
  document.documentElement.style.setProperty('--accent-fixed', state.profileColor);
  const rgb = state.profileColor.slice(1).match(/.{2}/g).map((parte) => parseInt(parte, 16));
  const luminosidad = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  document.documentElement.style.setProperty('--accent-ink', luminosidad >= 145 ? '#101116' : '#ffffff');
  el.profileCustomColor.value = state.profileColor;
  el.profileColors.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.color.toLowerCase() === state.profileColor.toLowerCase());
  });
}

function cargarColorPerfilUsuario() {
  const colores = coloresPerfilGuardados();
  aplicarColorPerfil(colores[state.profileUserId] || '#ff5f6d');
}

function renderUsuariosPerfil() {
  el.profileUsers.innerHTML = state.usuarios.map((usuario) => `<button type="button" data-profile-user="${usuario.id}" class="${usuario.id === state.profileUserId ? 'active' : ''}">${escaparHTML(usuario.nombre_display)}</button>`).join('');
}

async function pedirRankingPersonal(usuarioId, tipo, dias, limite = 5) {
  const params = new URLSearchParams({ scope: 'individual', usuario_id: usuarioId, tipo, dias, limit: limite, offset: 0 });
  const response = await fetch(`/api/charts?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function cargarPerfil() {
  if (!state.profileUserId) return;
  const solicitud = ++solicitudPerfil;
  const usuario = state.usuarios.find((item) => item.id === state.profileUserId);
  if (!usuario) return;
  el.profileName.textContent = `El perfil musical de ${usuario.nombre_display}`;
  renderUsuariosPerfil();
  cargarColorPerfilUsuario();
  el.profileLoading.hidden = false;
  el.profileError.hidden = true;
  el.profileContent.hidden = true;
  try {
    const mesActual = await fetch('/api/activity?scope=individual&usuario_id=' + encodeURIComponent(state.profileUserId));
    if (!mesActual.ok) throw new Error(`HTTP ${mesActual.status}`);
    const actividad = await mesActual.json();
    const [cancionesAll, artistasAll, albumesAll, canciones30, artistas30] = await Promise.all([
      pedirRankingPersonal(state.profileUserId, 'canciones', DIAS_TODO_EL_TIEMPO),
      pedirRankingPersonal(state.profileUserId, 'artistas', DIAS_TODO_EL_TIEMPO),
      pedirRankingPersonal(state.profileUserId, 'albumes', DIAS_TODO_EL_TIEMPO),
      pedirRankingPersonal(state.profileUserId, 'canciones', 30, 1),
      pedirRankingPersonal(state.profileUserId, 'artistas', 30, 1)
    ]);
    if (solicitud !== solicitudPerfil) return;
    const datos = { usuario, actividad, cancionesAll, artistasAll, albumesAll, canciones30: canciones30[0] || null, artistas30: artistas30[0] || null };
    state.profileData = datos;
    renderPerfil(datos);
    el.profileLoading.hidden = true;
    el.profileContent.hidden = false;
  } catch (error) {
    if (solicitud !== solicitudPerfil) return;
    console.error('Error consultando perfil:', error);
    el.profileLoading.hidden = true;
    el.profileError.hidden = false;
  }
}

function renderListaPersonal(elemento, filas, avatar = false) {
  elemento.innerHTML = filas.length ? filas.slice(0, 5).map((fila, indice) => `<div class="profile-top-row"><span class="profile-rank mono">${String(indice + 1).padStart(2, '0')}</span><img class="${avatar ? 'avatar' : ''}" src="${imagenSegura(fila.portada)}" alt="" loading="lazy"><div><b>${escaparHTML(fila.nombre)}</b>${fila.subtitulo ? `<span>${escaparHTML(fila.subtitulo)}</span>` : ''}</div><small>${Number(fila.veces_escuchada) || 0} plays</small></div>`).join('') : '<p class="activity-empty">Todavía no hay suficiente historial.</p>';
}

function etiquetaCambioPersonal(item) {
  if (!item) return 'Sin escuchas en los últimos 30 días';
  if (item.cambio == null) return 'Nuevo en tu top de 30 días';
  if (item.cambio > 0) return `Subió ${item.cambio} ${item.cambio === 1 ? 'posición' : 'posiciones'} en tu top personal`;
  if (item.cambio < 0) return `Bajó ${Math.abs(item.cambio)} ${Math.abs(item.cambio) === 1 ? 'posición' : 'posiciones'} en tu top personal`;
  return 'Mantiene su posición en tu top personal';
}

function renderPerfil(datos) {
  const racha = datos.actividad.rachas.find((item) => item.usuario_id === datos.usuario.id) || { racha_actual: 0, mejor_racha: 0, dias_activos: 0 };
  const descubrimiento = datos.actividad.descubrimientos.find((item) => item.usuario_id === datos.usuario.id) || { canciones: { total: 0 }, artistas: { total: 0 } };
  el.profileStats.innerHTML = `<article class="profile-stat-card"><span>Racha actual</span><strong>${racha.racha_actual}<small> días</small></strong><em>Récord personal: ${racha.mejor_racha} días</em></article><article class="profile-stat-card"><span>Días con música</span><strong>${racha.dias_activos}</strong><em>En todo tu historial registrado</em></article><article class="profile-stat-card"><span>Nuevos registros este mes</span><strong>${descubrimiento.canciones.total + descubrimiento.artistas.total}</strong><em>${descubrimiento.canciones.total} canciones · ${descubrimiento.artistas.total} artistas</em></article>`;
  renderListaPersonal(el.profileTopSongs, datos.cancionesAll);
  renderListaPersonal(el.profileTopArtists, datos.artistasAll, true);
  renderListaPersonal(el.profileTopAlbums, datos.albumesAll);
  const cancion = datos.canciones30;
  const artista = datos.artistas30;
  const novedades = [...(descubrimiento.canciones.recientes || []).slice(0, 2).map((item) => item.nombre), ...(descubrimiento.artistas.recientes || []).slice(0, 2).map((item) => item.nombre)];
  el.profileRecapPreview.innerHTML = `<div class="recap-cover"><img src="${imagenSegura(cancion?.portada)}" alt="" crossorigin="anonymous"><span>YOUR SOUND, YOUR STORY</span></div><div class="recap-details"><span class="mono">${escaparHTML(datos.usuario.nombre_display)} · ${escaparHTML(datos.actividad.mes)}</span><h4>Tu música<br>en este momento.</h4><div class="recap-feature"><small>CANCIÓN MÁS ESCUCHADA · 30 DÍAS</small><b>${escaparHTML(cancion?.nombre || 'Tu próxima favorita está por llegar')}</b><span>${escaparHTML(cancion?.subtitulo || 'Sigue escuchando para crear tu recap')}</span><em>${cancion ? `${cancion.veces_escuchada} reproducciones · ` : ''}${etiquetaCambioPersonal(cancion)}</em></div><div class="recap-feature"><small>ARTISTA DESTACADO · 30 DÍAS</small><b>${escaparHTML(artista?.nombre || 'Aún sin artista destacado')}</b><em>${artista ? `${artista.veces_escuchada} reproducciones · ` : ''}${etiquetaCambioPersonal(artista)}</em></div><div class="recap-footer"><span>Racha actual <b>${racha.racha_actual} días</b></span><span>Primeros registros <b>${novedades.length ? novedades.map(escaparHTML).join(' · ') : 'Este mes'}</b></span></div></div>`;
}

async function cargarImagenRecap(url) {
  if (!url) return null;
  try {
    const segura = new URL(url, window.location.origin);
    if (!['https:', 'http:'].includes(segura.protocol)) return null;
    url = segura.href;
  } catch { return null; }
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function descargarRecap() {
  const datos = state.profileData;
  if (!datos) return;
  el.profileDownload.disabled = true;
  el.profileRecapStatus.textContent = 'Preparando tu imagen…';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    const accent = state.profileColor;
    const accentInk = getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim() || '#101116';
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, '#171821');
    gradient.addColorStop(1, '#090a0e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.14;
    ctx.beginPath(); ctx.arc(930, 120, 310, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const portada = await cargarImagenRecap(datos.canciones30?.portada);
    if (portada) {
      ctx.save(); ctx.beginPath(); ctx.roundRect(720, 110, 250, 250, 28); ctx.clip(); ctx.drawImage(portada, 720, 110, 250, 250); ctx.restore();
    } else {
      ctx.fillStyle = accent; ctx.globalAlpha = .18; ctx.beginPath(); ctx.roundRect(720, 110, 250, 250, 28); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = accent; ctx.font = '700 115px Manrope, sans-serif'; ctx.fillText('♪', 790, 280);
    }
    const text = (value, x, y, size, color, weight = 500) => { ctx.fillStyle = color; ctx.font = `${weight} ${size}px Manrope, sans-serif`; ctx.fillText(value, x, y, 850); };
    text('DUO CHARTS  /  YOUR PROFILE', 78, 110, 23, accent, 700);
    text(datos.usuario.nombre_display, 78, 215, 62, '#f6f6f8', 800);
    text(`YOUR LISTENING RECAP · ${datos.actividad.mes}`, 78, 270, 22, '#a2a3ad', 500);
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = .08; ctx.beginPath(); ctx.roundRect(70, 430, 940, 500, 28); ctx.fill(); ctx.globalAlpha = 1;
    text('TU CANCIÓN DE LOS ÚLTIMOS 30 DÍAS', 110, 500, 20, accent, 700);
    text(datos.canciones30?.nombre || 'Sigue escuchando', 110, 580, 40, '#f6f6f8', 800);
    text(datos.canciones30?.subtitulo || 'Tu próxima canción favorita', 110, 625, 23, '#a2a3ad');
    text(`${datos.canciones30?.veces_escuchada || 0} reproducciones · ${etiquetaCambioPersonal(datos.canciones30)}`, 110, 685, 20, '#f6f6f8');
    text('ARTISTA DESTACADO', 110, 770, 20, accent, 700);
    text(datos.artistas30?.nombre || 'Por descubrir', 110, 825, 36, '#f6f6f8', 800);
    text(`${datos.artistas30?.veces_escuchada || 0} reproducciones · ${etiquetaCambioPersonal(datos.artistas30)}`, 110, 870, 20, '#a2a3ad');
    const racha = datos.actividad.rachas.find((item) => item.usuario_id === datos.usuario.id)?.racha_actual || 0;
    ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(70, 990, 940, 245, 28); ctx.fill();
    text(`${racha} días`, 110, 1080, 54, accentInk, 800);
    text('de racha actual', 110, 1125, 22, accentInk, 600);
    const descubrimiento = datos.actividad.descubrimientos.find((item) => item.usuario_id === datos.usuario.id);
    const totalNuevos = (descubrimiento?.canciones.total || 0) + (descubrimiento?.artistas.total || 0);
    text(`${totalNuevos} primeros registros este mes`, 110, 1165, 21, accentInk, 600);
    const recientes = [...(descubrimiento?.canciones.recientes || []).slice(0, 2).map((item) => item.nombre), ...(descubrimiento?.artistas.recientes || []).slice(0, 2).map((item) => item.nombre)].join(' · ');
    if (recientes) text(recientes, 110, 1190, 16, accentInk, 500);
    text('Tu música. Tu ritmo.', 78, 1280, 22, '#a2a3ad', 600);
    const enlace = document.createElement('a');
    enlace.download = `duo-charts-recap-${datos.usuario.nombre_display.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${datos.actividad.mes}.png`;
    enlace.href = canvas.toDataURL('image/png');
    enlace.click();
    el.profileRecapStatus.textContent = 'Tu recap se descargó como PNG.';
  } catch (error) {
    console.error('No se pudo exportar el recap:', error);
    el.profileRecapStatus.textContent = 'No se pudo crear la imagen. Inténtalo de nuevo.';
  } finally {
    el.profileDownload.disabled = false;
  }
}

el.profileUsers.addEventListener('click', (event) => {
  const button = event.target.closest('[data-profile-user]');
  if (!button) return;
  state.profileUserId = Number(button.dataset.profileUser);
  cargarPerfil();
});
el.profileColors.addEventListener('click', (event) => {
  const button = event.target.closest('[data-color]');
  if (!button) return;
  aplicarColorPerfil(button.dataset.color);
  const colores = coloresPerfilGuardados(); colores[state.profileUserId] = state.profileColor;
  try { localStorage.setItem(CLAVE_COLORES_PERFIL, JSON.stringify(colores)); } catch { /* La selección visual sigue activa esta sesión. */ }
});
el.profileCustomColor.addEventListener('input', () => {
  aplicarColorPerfil(el.profileCustomColor.value);
  const colores = coloresPerfilGuardados(); colores[state.profileUserId] = state.profileColor;
  try { localStorage.setItem(CLAVE_COLORES_PERFIL, JSON.stringify(colores)); } catch { /* La selección visual sigue activa esta sesión. */ }
});
el.profileDownload.addEventListener('click', descargarRecap);
document.getElementById('profile-retry').addEventListener('click', cargarPerfil);

el.activityScopePills.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-activity-scope]');
  if (!button) return;
  state.activityScope = button.dataset.activityScope;
  state.activityUserId = button.dataset.activityUser ? Number(button.dataset.activityUser) : null;
  cargarActividad();
});
document.getElementById('activity-prev').addEventListener('click', () => { state.activityMonth = moverMes(state.activityMonth, -1); cargarActividad(); });
document.getElementById('activity-next').addEventListener('click', () => { state.activityMonth = moverMes(state.activityMonth, 1); cargarActividad(); });
document.getElementById('activity-retry').addEventListener('click', cargarActividad);
el.activityCalendar.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-day]');
  if (!button || !state.activityData) return;
  const dia = state.activityData.calendario.find((item) => item.fecha === button.dataset.day);
  el.activityCalendar.querySelectorAll('.calendar-day').forEach((item) => item.classList.toggle('selected', item === button));
  mostrarDetalleDia(dia);
});

// ------------------------------------------------------------
// Navegación entre vistas
// ------------------------------------------------------------
function switchView(view) {
  state.view = view;
  el.mainNav.querySelectorAll('.nav-link').forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  el.searchToggle.hidden = view === 'overview' || view === 'profile';
  const placeholders = {
    songs: 'Search songs, artists, or albums…',
    artists: 'Search artists…',
    albums: 'Search albums or artists…'
  };
  if (placeholders[view]) el.searchInput.placeholder = placeholders[view];
  cerrarBusqueda(false);
  guardarPreferencias();

  if (view === 'overview') {
    el.nowPlayingSection.hidden = false;
    el.controlsSection.hidden = true;
    el.listSection.hidden = true;
    el.matchSection.hidden = false;
    el.insightsSection.hidden = false;
    el.activitySection.hidden = false;
    el.profileSection.hidden = true;
    cargarOverview();
  } else if (view === 'profile') {
    el.nowPlayingSection.hidden = true;
    el.controlsSection.hidden = true;
    el.listSection.hidden = true;
    el.matchSection.hidden = true;
    el.insightsSection.hidden = true;
    el.activitySection.hidden = true;
    el.profileSection.hidden = false;
    cargarPerfil();
  } else {
    el.nowPlayingSection.hidden = true;
    el.controlsSection.hidden = false;
    el.listSection.hidden = false;
    el.matchSection.hidden = true;
    el.insightsSection.hidden = true;
    el.activitySection.hidden = true;
    el.profileSection.hidden = true;
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
    guardarPreferencias();
    actualizarChart(true);
  });
});

// ------------------------------------------------------------
// Pills de scope (All / Marcos / Jackie) — se arman según los usuarios reales
// ------------------------------------------------------------
async function cargarUsuarios() {
  try {
    const resp = await fetch('/api/usuarios');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const usuarios = await resp.json();
    if (!Array.isArray(usuarios)) throw new Error('Invalid accounts response');
    state.usuarios = usuarios;
    state.profileUserId = usuarios[0]?.id || null;
    cargarColorPerfilUsuario();
    renderScopePills();
  } catch (err) {
    console.error('Error consultando usuarios:', err);
  }
}

function renderScopePills() {
  el.scopePills.hidden = false;
  const botones = [
    `<button data-scope="global" class="${state.scope === 'global' ? 'active' : ''}">All</button>`,
    ...state.usuarios.map(
      (u) =>
        `<button data-scope="individual" data-usuario="${u.id}" class="${
          state.scope === 'individual' && state.usuarioId === u.id ? 'active' : ''
        }">${escaparHTML(u.nombre_display)}</button>`
    )
  ];
  el.scopePills.innerHTML = botones.join('');
}

const CLAVE_PREFERENCIAS = 'spotify-duo-dashboard-preferences';

function guardarPreferencias() {
  try {
    window.localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify({
      view: state.view,
      dias: state.dias,
      scope: state.scope,
      usuarioId: state.usuarioId
    }));
  } catch (err) {
    // El almacenamiento local puede estar deshabilitado; el dashboard sigue funcionando.
    console.warn('No se pudieron guardar las preferencias locales.');
  }
}

function restaurarPreferencias() {
  try {
    const guardadas = JSON.parse(window.localStorage.getItem(CLAVE_PREFERENCIAS) || 'null');
    if (!guardadas || typeof guardadas !== 'object') return;

    if (['overview', 'songs', 'artists', 'albums', 'profile'].includes(guardadas.view)) {
      state.view = guardadas.view;
    }
    if ([1, 7, 30, 'all'].includes(guardadas.dias)) state.dias = guardadas.dias;
    const usuario = state.usuarios.find((u) => u.id === Number(guardadas.usuarioId));
    if (guardadas.scope === 'individual' && usuario) {
      state.scope = 'individual';
      state.usuarioId = usuario.id;
    }

    el.periodPills.querySelectorAll('button').forEach((boton) => {
      const diasBoton = boton.dataset.dias === 'all' ? 'all' : Number(boton.dataset.dias);
      boton.classList.toggle('active', diasBoton === state.dias);
    });
    renderScopePills();
  } catch (err) {
    console.warn('Se ignoraron las preferencias locales guardadas.');
  }
}

el.scopePills.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  el.scopePills.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.scope = btn.dataset.scope;
  state.usuarioId = btn.dataset.usuario ? parseInt(btn.dataset.usuario, 10) : null;
  guardarPreferencias();
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
  restaurarPreferencias();
  actualizarTicker();
  if (state.view === 'overview') cargarOverview();
  else switchView(state.view);

  setInterval(actualizarTicker, 20 * 1000);
  setInterval(actualizarBarrasDeProgreso, 1000);
}

init();
