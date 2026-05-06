import { TimeCtl } from './time-ctl.js';
import { state, on, emit, newWaypointId } from './state.js';
import { fetchRoute, computeCumDistances, buildSegments, positionAtTime,
         sampleRouteStops, buildRouteStops, findWaypointIndices,
         findStopIdxAtTime } from './routing.js';
import { fetchMultiPointHourly, pickHour } from './weather.js';
import { reverseGeocode, geocode } from './geocoding.js';
import { startPicking } from './map-picker.js';
import { getMap, invalidateSizeSoon, clearLayer } from './map.js';
import { fetchIndex, updateLayersForTime, clearLayers as clearRVLayers } from './rainviewer.js';
import { drawTerminator, clearTerminator, computeSunEvents,
         getSunAltitudeDeg, getSunAzimuthDeg, getSunTimes } from './astronomy.js';
import { updateAstroBox } from './astro-ui.js';
import { updateTheme, resetTheme } from './theme.js';
import { placeCar, updateCarPosition, setCarPosition, clearCar } from './car.js';
import { wmo, CAR_SVG, STOP_DENSITIES } from './config.js';
import { fmtKm, fmtDur, fmtTime, fmtDate, fmtTemp, toast, debounce } from './utils.js';
import { clearScrubberContent, setWeatherProvider, clearWeatherProvider } from './scrubber.js';
import { renderChart } from './chart.js';

let _routeLayer = null;
let _stopMarkers = [];
let _wpMarkers = [];
let _isActive = false;
let _sortable = null;

// ============================================================
// WAYPOINT MANAGEMENT
// ============================================================
function ensureMinimumWaypoints() {
  while (state.waypoints.length < 2) {
    state.waypoints.push({ id: newWaypointId(), city: null, pauseHours: 0, pauseMinutes: 0 });
  }
}

function addWaypoint(city = null) {
  // Insert before the last (which is the destination)
  const newWp = { id: newWaypointId(), city, pauseHours: 0, pauseMinutes: 0 };
  state.waypoints.splice(state.waypoints.length - 1, 0, newWp);
  renderWaypoints();
}

function removeWaypoint(id) {
  if (state.waypoints.length <= 2) return;
  state.waypoints = state.waypoints.filter(w => w.id !== id);
  renderWaypoints();
}

function renderWaypoints() {
  const list = document.getElementById('waypoints-list');
  list.innerHTML = '';
  state.waypoints.forEach((wp, i) => {
    const isStart = i === 0;
    const isEnd = i === state.waypoints.length - 1;
    const isEndpoint = isStart || isEnd;
    const card = document.createElement('div');
    card.className = 'waypoint-card' + (isEndpoint ? ' is-endpoint' : '');
    card.dataset.id = wp.id;
    card.innerHTML = `
      <div class="wp-header">
        <span class="wp-handle" title="Glisser pour réordonner">≡</span>
        <span class="wp-index">${i+1}</span>
        <div class="wp-search">
          <input type="text" placeholder="${isStart ? 'Point de départ' : isEnd ? 'Destination' : 'Étape intermédiaire'}" value="${wp.city ? wp.city.name + (wp.city.country?', '+wp.city.country:'') : ''}" autocomplete="off">
          <div class="wp-suggestions"></div>
        </div>
        <button class="wp-pin" title="Sélectionner sur la carte">📍</button>
        ${state.waypoints.length > 2 ? `<button class="wp-remove" title="Supprimer">✕</button>` : ''}
      </div>
      ${!isEndpoint ? `
      <div class="wp-pause">
        <span class="wp-pause-label">Pause</span>
        <input type="number" class="wp-pause-input" data-field="pauseHours" min="0" max="72" value="${wp.pauseHours || 0}">
        <span class="wp-pause-unit">h</span>
        <input type="number" class="wp-pause-input" data-field="pauseMinutes" min="0" max="59" step="5" value="${wp.pauseMinutes || 0}">
        <span class="wp-pause-unit">min</span>
      </div>` : ''}
    `;
    list.appendChild(card);
    bindWaypointCard(card, wp);
  });
  // Re-init Sortable
  if (_sortable) _sortable.destroy();
  _sortable = Sortable.create(list, {
    handle: '.wp-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: () => {
      const newOrder = Array.from(list.querySelectorAll('.waypoint-card')).map(c => c.dataset.id);
      state.waypoints = newOrder.map(id => state.waypoints.find(w => w.id === id));
      renderWaypoints();
      updateWaypointMarkers();
    }
  });
  updateWaypointMarkers();
}

function bindWaypointCard(card, wp) {
  const input = card.querySelector('input[type="text"]');
  const suggBox = card.querySelector('.wp-suggestions');
  const pinBtn = card.querySelector('.wp-pin');
  const removeBtn = card.querySelector('.wp-remove');
  const pauseInputs = card.querySelectorAll('.wp-pause-input');

  // Autocomplete (debounced)
  const handler = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { suggBox.style.display = 'none'; return; }
    const results = await geocode(q);
    if (!results.length) { suggBox.style.display = 'none'; return; }
    suggBox.innerHTML = results.map((r, i) => `
      <div class="suggestion" data-idx="${i}">
        <div class="suggestion-name">${r.name}${r.admin1?', '+r.admin1:''}</div>
        <div class="suggestion-meta">${r.country||''} · ${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}</div>
      </div>`).join('');
    suggBox.style.display = 'block';
    suggBox.querySelectorAll('.suggestion').forEach((el, i) => {
      el.addEventListener('click', () => {
        const item = results[i];
        wp.city = { name: item.name, latitude: item.latitude, longitude: item.longitude, country: item.country || '' };
        input.value = `${item.name}${item.country?', '+item.country:''}`;
        suggBox.style.display = 'none';
        updateWaypointMarkers();
      });
    });
  }, 280);
  input.addEventListener('input', handler);
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !suggBox.contains(e.target)) suggBox.style.display = 'none';
  });

  // Pin button
  pinBtn.addEventListener('click', () => {
    if (!_isActive) return;
    startPicking(`Clique sur la carte pour placer l'étape ${state.waypoints.indexOf(wp)+1}`, city => {
      wp.city = city;
      input.value = city.name;
      updateWaypointMarkers();
    }, pinBtn);
  });

  // Remove button
  if (removeBtn) {
    removeBtn.addEventListener('click', () => removeWaypoint(wp.id));
  }

  // Pause inputs
  pauseInputs.forEach(inp => {
    inp.addEventListener('change', () => {
      const v = parseInt(inp.value, 10) || 0;
      wp[inp.dataset.field] = v;
    });
  });
}

// Place small markers on the map for each filled waypoint (preview before computing)
function updateWaypointMarkers() {
  const map = getMap();
  _wpMarkers.forEach(m => clearLayer(m));
  _wpMarkers = [];
  state.waypoints.forEach((wp, i) => {
    if (!wp.city) return;
    const isEnd = (i === 0 || i === state.waypoints.length - 1);
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:var(--accent);color:var(--bg);border:2px solid var(--bg);width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${i+1}</div>`,
      iconSize: [24, 24], iconAnchor: [12, 12]
    });
    const m = L.marker([wp.city.latitude, wp.city.longitude], { icon, zIndexOffset: 200 }).addTo(map);
    _wpMarkers.push(m);
  });
}

function clearWaypointMarkers() {
  _wpMarkers.forEach(m => clearLayer(m));
  _wpMarkers = [];
}

// ============================================================
// INIT / ACTIVATE / DEACTIVATE
// ============================================================
export function init() {
  ensureMinimumWaypoints();
  setDefaultTime();
  document.getElementById('add-waypoint-btn').addEventListener('click', () => addWaypoint());
  document.getElementById('calc-btn').addEventListener('click', () => { if (_isActive) calculateTrip(); });
  document.getElementById('btn-edit-route').addEventListener('click', () => {
    if (!_isActive) return;
    setRouteSidebarMode('edit');
  });
  on('tick', onTick);
  on('modelChange', () => { if (_isActive && state.routeData) calculateTrip(); });
  on('densityChange', () => { if (_isActive && state.routeData) calculateTrip(); });
  on('chartChange', () => {
    if (!_isActive) return;
    renderChart();
    renderInfluenceBands();
  });
  on('layerToggle', ({ layer }) => {
    if (!_isActive) return;
    if (layer === 'stops') {
      _stopMarkers.forEach(m => {
        if (state.layers.stops) m.addTo(getMap()); else getMap().removeLayer(m);
      });
    } else if (layer === 'terminator') {
      if (state.layers.terminator) drawTerminator(TimeCtl.current || new Date());
      else clearTerminator();
    }
  });
  // Initial render
  renderWaypoints();
  // Apply default sidebar mode (edit)
  applyRouteSidebarMode();

  // Event delegation for "Détails →" buttons inside Leaflet popups
  // (popups are created/destroyed dynamically, so we listen at document level)
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="view-details"]');
    if (!btn) return;
    e.stopPropagation();
    const detail = {
      lat: parseFloat(btn.dataset.lat),
      lon: parseFloat(btn.dataset.lon),
      name: btn.dataset.name,
      time: new Date(btn.dataset.time)
    };
    emit('viewStopDetails', detail);
  });
}

// ============================================================
// LOT B — Edit / Play sidebar modes
// ============================================================

function applyRouteSidebarMode() {
  const editPanel = document.getElementById('route-panel-edit');
  const playPanel = document.getElementById('route-panel-play');
  if (!editPanel || !playPanel) return;
  if (state.routeSidebarMode === 'play') {
    editPanel.classList.remove('is-active');
    playPanel.classList.add('is-active');
  } else {
    playPanel.classList.remove('is-active');
    editPanel.classList.add('is-active');
  }
}

function setRouteSidebarMode(mode) {
  if (mode !== 'edit' && mode !== 'play') return;
  if (state.routeSidebarMode === mode) return;
  state.routeSidebarMode = mode;
  applyRouteSidebarMode();
}

function showRouteLoader() {
  document.getElementById('mode-route')?.classList.add('is-calculating');
}
function hideRouteLoader() {
  document.getElementById('mode-route')?.classList.remove('is-calculating');
}

// Compact summary string for play header
function renderPlaySummary() {
  const el = document.getElementById('play-summary');
  if (!el) return;
  const wps = state.waypoints.filter(w => w.city);
  if (wps.length < 2) { el.innerHTML = '—'; return; }
  const parts = [];
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    const cityName = wp.city.name.split(',')[0];   // strip ", Suisse" etc.
    parts.push(`<span class="ps-step">${cityName}</span>`);
    if (i < wps.length - 1) {
      const pauseSec = (wp.pauseHours || 0) * 3600 + (wp.pauseMinutes || 0) * 60;
      if (pauseSec > 0) {
        parts.push(`<span class="ps-pause">⏸ ${fmtDur(pauseSec)}</span>`);
      }
      parts.push('<span class="ps-arrow">→</span>');
    }
  }
  el.innerHTML = parts.join('');
}

// Find the route stop whose weather should be displayed for time t.
// Pause-aware: during a pause, locks on the waypoint stop. Otherwise: closest in time.
function findStopForTime(t) {
  if (!state.routeStops?.length) return null;
  const idx = findStopIdxAtTime(state.legSegments, state.routeStops, TimeCtl.start, t);
  if (idx < 0) return null;
  return { idx, stop: state.routeStops[idx] };
}

// Update the "Météo courante" card in the play panel based on car position
function updateCurrentWeatherCard(time, pos) {
  const card = document.getElementById('route-current-card');
  if (!card) return;
  if (!state.routeStops?.length || !state.routeWeather?.length) {
    card.innerHTML = '<div class="rcc-empty">En attente de la simulation…</div>';
    return;
  }
  const closest = findStopForTime(time);
  if (!closest) return;
  const wData = state.routeWeather[closest.idx] || state.routeWeather[0];
  const w = wData ? pickHour(wData, time) : { temp: null, code: null, precip: 0, wind: 0 };
  const cond = w.code != null ? wmo(w.code) : { icon: '🌡️', label: 'Inconnu' };
  const name = state.routeStopNames?.[closest.idx] || `${closest.stop.lat.toFixed(2)}°, ${closest.stop.lon.toFixed(2)}°`;
  const isPaused = pos?.isPaused || false;
  const status = isPaused
    ? `⏸ En pause à ${name}`
    : `En route · proche de ${name}`;
  card.innerHTML = `
    <div class="rcc-loc">${name}</div>
    <div class="rcc-status${isPaused ? ' is-paused' : ''}">${status}</div>
    <div class="rcc-row">
      <div>
        <div class="rcc-temp">${w.temp != null ? Math.round(w.temp) : '—'}<span class="unit">°C</span></div>
      </div>
      <div style="text-align:right">
        <div class="rcc-icon">${cond.icon}</div>
        <div class="rcc-label">${cond.label}</div>
      </div>
    </div>
    <div class="rcc-meta">
      <div class="rcc-meta-item"><span class="rcc-meta-label">Vent</span><span class="rcc-meta-value">${w.wind != null ? Math.round(w.wind) : '—'} km/h</span></div>
      <div class="rcc-meta-item"><span class="rcc-meta-label">Précip</span><span class="rcc-meta-value">${w.precip != null ? w.precip.toFixed(1) : '—'} mm</span></div>
      <div class="rcc-meta-item"><span class="rcc-meta-label">Pression</span><span class="rcc-meta-value">${w.pressure ? Math.round(w.pressure) : '—'} hPa</span></div>
      <div class="rcc-meta-item"><span class="rcc-meta-label">Couv.</span><span class="rcc-meta-value">${w.cloudCover != null ? Math.round(w.cloudCover) : '—'} %</span></div>
    </div>`;
}

function setDefaultTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const tz = d.getTimezoneOffset() * 60000;
  document.getElementById('route-time').value = new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function activate() {
  _isActive = true;
  setWeatherProvider(time => {
    if (!state.routeWeather || !state.routeWeather.length) return null;
    if (!state.routeStops) return null;
    const idx = findStopIdxAtTime(state.legSegments, state.routeStops, TimeCtl.start, time);
    if (idx < 0) return null;
    const w = pickHour(state.routeWeather[idx], time);
    return { temp: w.temp, code: w.code };
  });
  updateWaypointMarkers();
  if (state.routeData) {
    document.getElementById('viewport').classList.add('viewport-mode-route');
    invalidateSizeSoon();
    // If a trip was already calculated and we're returning from another mode,
    // re-render all the visuals (polyline, markers, car, scrubber pictograms).
    // state.routeData/routeCoords/legSegments/routeStops/routeWeather are kept
    // intact across deactivate(); only the DOM/Leaflet objects need to be rebuilt.
    if (state.routeStops?.length && state.routeWeather?.length) {
      restoreRouteVisuals();
    }
  } else {
    document.getElementById('empty-state').style.display = 'flex';
  }
}

export function deactivate() {
  _isActive = false;
  // Save the current playback time so we can restore it when returning
  if (state.routeData && TimeCtl.current) {
    state.routeLastTime = new Date(TimeCtl.current);
  }
  TimeCtl.pause();
  clearRouteVisuals();
  clearWaypointMarkers();
  clearRVLayers();
  clearTerminator();
  resetTheme();
  clearWeatherProvider();
  clearScrubberContent();
  document.getElementById('viewport').classList.remove('viewport-mode-route');
  document.getElementById('viewport').classList.remove('with-chart');
  document.getElementById('chart-box').innerHTML = '';
}

// Re-render all route visuals from existing state (after returning from another mode)
function restoreRouteVisuals() {
  const map = getMap();
  // Polyline
  const latlngs = state.routeCoords.map(c => [c[1], c[0]]);
  _routeLayer = L.polyline(latlngs, { color: '#ff9758', weight: 3, opacity: 0.85, smoothFactor: 1 }).addTo(map);
  // Stop markers (re-create from state)
  state.routeStops.forEach((s, i) => {
    const wData = state.routeWeather?.[i] || state.routeWeather?.[0];
    const w = wData ? pickHour(wData, s.arrival) : { temp: null, code: null, precip: 0, wind: 0 };
    const cond = w.code != null ? wmo(w.code) : { icon: '📍', label: 'Étape' };
    const isWaypoint = s.kind === 'waypoint';
    const isPause = isWaypoint && s.pauseSec > 0;
    let html;
    if (isWaypoint) {
      const wpNum = (s.waypointIndex ?? 0) + 1;
      const pauseHint = isPause ? '<div style="position:absolute;top:-4px;right:-4px;background:var(--bg-3);border:1px solid var(--accent);border-radius:50%;width:14px;height:14px;font-size:9px;display:flex;align-items:center;justify-content:center">⏸</div>' : '';
      html = `<div style="position:relative;background:var(--accent);color:var(--bg);border:2px solid var(--bg);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.5)">${wpNum}${pauseHint}</div>`;
    } else {
      html = `<div style="background:var(--bg);border:1.5px solid var(--accent);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 4px 12px rgba(0,0,0,0.4)">${cond.icon}</div>`;
    }
    const icon = L.divIcon({
      className: '', html,
      iconSize: isWaypoint ? [30, 30] : [34, 34],
      iconAnchor: isWaypoint ? [15, 15] : [17, 17]
    });
    const m = L.marker([s.lat, s.lon], { icon, zIndexOffset: isWaypoint ? 600 : 500 });
    if (state.layers.stops) m.addTo(map);
    m.bindPopup(buildStopPopup(s, i, w, cond));
    _stopMarkers.push(m);
  });
  // Car at start
  placeCar(state.routeCoords, state.cumDistances);
  // TimeCtl init from saved state
  const departTime = state.routeStops[0].arrival;
  const arrivalTime = new Date(departTime.getTime() + state.totalSec * 1000);
  TimeCtl.init(departTime, arrivalTime);
  if (state.routeLastTime) TimeCtl.setTime(state.routeLastTime.getTime());
  // Scrubber pictograms + influence bands
  renderScrubberPictograms(departTime);
  // Re-fit map
  map.fitBounds(_routeLayer.getBounds(), { padding: [40, 80] });
  // Refit RainViewer
  fetchIndex();
  console.log('[route] visuals restored from saved state');
}

function clearRouteVisuals() {
  if (_routeLayer) { clearLayer(_routeLayer); _routeLayer = null; }
  _stopMarkers.forEach(m => clearLayer(m));
  _stopMarkers = [];
  clearCar();
}

// ============================================================
// CALCULATE TRIP
// ============================================================
async function calculateTrip() {
  // Validate waypoints
  const filled = state.waypoints.filter(w => w.city);
  if (filled.length < 2) {
    toast('Au moins 2 étapes avec localisation sont requises');
    return;
  }
  if (filled.length !== state.waypoints.length) {
    toast('Toutes les étapes doivent avoir une localisation');
    return;
  }
  const departInput = document.getElementById('route-time').value;
  if (!departInput) { toast('Choisis une heure de départ'); return; }
  const departTime = new Date(departInput);

  const btn = document.getElementById('calc-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  // Loader animation: ensure the spinner is visible at least 600ms for clear feedback
  const calcStart = Date.now();
  const MIN_LOADER_MS = 600;
  showRouteLoader();

  try {
    document.getElementById('empty-state').style.display = 'none';
    const map = getMap();
    invalidateSizeSoon();
    clearRouteVisuals();
    clearRVLayers();
    clearScrubberContent();

    // 1. Routing through all waypoints
    const cities = state.waypoints.map(w => w.city);
    const routeData = await fetchRoute(cities);
    state.routeData = routeData;
    state.routeCoords = routeData.geometry.coordinates;
    state.cumDistances = computeCumDistances(state.routeCoords);
    const latlngs = state.routeCoords.map(c => [c[1], c[0]]);
    _routeLayer = L.polyline(latlngs, { color: '#ff9758', weight: 3, opacity: 0.85, smoothFactor: 1 }).addTo(map);
    map.fitBounds(_routeLayer.getBounds(), { padding: [40, 80] });

    // 2. Build segments with pauses
    const built = buildSegments(routeData, state.waypoints, departTime);
    state.legSegments = built.segments;
    state.totalSec = built.totalSec;

    // 3. Build stops: waypoints (with names + pause info) + interpolated samples
    // Stop count adapts to distance and user-chosen density
    const density = STOP_DENSITIES[state.stopDensity] || STOP_DENSITIES.normal;
    const distKm = routeData.distance / 1000;
    const N = Math.min(density.cap, Math.max(filled.length, Math.round(distKm / density.kmPerStop) + 2));
    state.routeStops = buildRouteStops(state.legSegments, state.routeCoords, state.cumDistances, state.waypoints, departTime, N);
    console.log('[route] built', state.routeStops.length, 'stops (waypoints + interp)');
    try {
      state.routeWeather = await fetchMultiPointHourly(state.routeStops, state.currentModel);
      console.log('[route] received weather for', state.routeWeather?.length || 0, 'points');
    } catch (e) {
      console.warn('[route] weather fetch failed, continuing without:', e.message);
      state.routeWeather = [];
    }

    // 4. Stop names — waypoint stops have known names, interp use coords as fallback
    //    (refined in background by reverseGeocode below)
    state.routeStopNames = state.routeStops.map(s => {
      if (s.kind === 'waypoint') return s.name;
      return `${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°`;
    });

    // 5. Render stop markers on the map
    let markersAdded = 0;
    state.routeStops.forEach((s, i) => {
      const wData = state.routeWeather?.[i] || state.routeWeather?.[0];
      const w = wData ? pickHour(wData, s.arrival) : { temp: null, code: null, precip: 0, wind: 0 };
      const cond = w.code != null ? wmo(w.code) : { icon: '📍', label: 'Étape' };
      // Distinguish waypoints (numbered, larger) from interp stops (weather icon)
      const isWaypoint = s.kind === 'waypoint';
      const isPause = isWaypoint && s.pauseSec > 0;
      let html;
      if (isWaypoint) {
        // Numbered waypoint marker; pause-aware visual
        const wpNum = (s.waypointIndex ?? 0) + 1;
        const pauseHint = isPause ? '<div style="position:absolute;top:-4px;right:-4px;background:var(--bg-3);border:1px solid var(--accent);border-radius:50%;width:14px;height:14px;font-size:9px;display:flex;align-items:center;justify-content:center">⏸</div>' : '';
        html = `<div style="position:relative;background:var(--accent);color:var(--bg);border:2px solid var(--bg);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.5)">${wpNum}${pauseHint}</div>`;
      } else {
        html = `<div style="background:var(--bg);border:1.5px solid var(--accent);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 4px 12px rgba(0,0,0,0.4)">${cond.icon}</div>`;
      }
      const icon = L.divIcon({
        className: '',
        html,
        iconSize: isWaypoint ? [30, 30] : [34, 34],
        iconAnchor: isWaypoint ? [15, 15] : [17, 17]
      });
      const m = L.marker([s.lat, s.lon], { icon, zIndexOffset: isWaypoint ? 600 : 500 });
      if (state.layers.stops) { m.addTo(map); markersAdded++; }
      m.bindPopup(buildStopPopup(s, i, w, cond));
      _stopMarkers.push(m);
    });
    console.log('[route] added', markersAdded, '/', state.routeStops.length, 'stop markers');

    // Refine stop names in background via reverseGeocode (Nominatim, throttled to 1/sec)
    refineStopNamesInBackground();

    // 6. Stats
    const driveSec = state.legSegments.filter(s => s.type === 'drive').reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
    const pauseSec = state.totalSec - driveSec;
    document.getElementById('rs-dist').textContent = fmtKm(routeData.distance);
    const durLabel = pauseSec > 0
      ? `${fmtDur(driveSec)} + ${fmtDur(pauseSec)} pause`
      : fmtDur(driveSec);
    document.getElementById('rs-dur').textContent = durLabel;
    document.getElementById('rs-dur').style.fontSize = pauseSec > 0 ? '14px' : '22px';
    const arrivalTime = new Date(departTime.getTime() + state.totalSec * 1000);
    document.getElementById('rs-arr').textContent = fmtDate(arrivalTime) + ' ' + fmtTime(arrivalTime);
    document.getElementById('rs-stops').textContent = state.waypoints.length;
    document.getElementById('route-stats').classList.add('visible');

    // 7. Summary
    const conds = state.routeStops.map((s, i) => pickHour(state.routeWeather[i] || state.routeWeather[0], s.arrival));
    const maxPrecip = Math.max(...conds.map(c => c.precip || 0));
    const hasStorm = conds.some(c => [95,96,99].includes(c.code));
    const hasSnow = conds.some(c => [71,73,75,85,86].includes(c.code));
    const hasRain = conds.some(c => [51,53,55,61,63,65,80,81,82].includes(c.code));
    let summary;
    if (hasStorm) summary = '<strong>⚠ Orages prévus</strong>';
    else if (hasSnow) summary = '<strong>❄ Neige prévue</strong>';
    else if (maxPrecip > 5) summary = '<strong>🌧 Pluie marquée</strong>';
    else if (hasRain) summary = '<strong>🌦 Pluies sur le parcours</strong>';
    else summary = '<strong>☀ Conditions clémentes</strong>';
    document.getElementById('scrubber-summary').innerHTML = summary;

    // 8. Init RainViewer + place car
    await fetchIndex();
    placeCar(state.routeCoords, state.cumDistances);

    // 9. Render scrubber pictograms
    renderScrubberPictograms(departTime);

    // 10. TimeCtl init
    TimeCtl.init(departTime, arrivalTime);
    document.getElementById('viewport').classList.add('viewport-mode-route');
    invalidateSizeSoon(150);
    setTimeout(() => TimeCtl.play(), 600);

    // 11. Switch to "play" sidebar mode (after loader minimum + smooth transition)
    renderPlaySummary();
    const elapsed = Date.now() - calcStart;
    const remaining = Math.max(0, MIN_LOADER_MS - elapsed);
    setTimeout(() => {
      hideRouteLoader();
      setRouteSidebarMode('play');
    }, remaining);

  } catch (e) {
    hideRouteLoader();
    toast('Erreur : ' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Calculer le voyage';
  }
}

// Build the popup HTML for a stop. For waypoints with pause: 2 columns (arrival/departure).
// Each column gets a "Détails →" button that switches to city mode for that location.
function buildStopPopup(stop, idx, w, cond) {
  const name = state.routeStopNames[idx];
  const isPause = stop.kind === 'waypoint' && stop.pauseSec > 0;
  // Encode time as ISO so it survives the data-attr round-trip
  const tArr = stop.arrival.toISOString();
  if (isPause) {
    const wDataDep = state.routeWeather?.[idx];
    const wDep = wDataDep ? pickHour(wDataDep, stop.pauseDeparture) : { temp: null, code: null, precip: 0, wind: 0 };
    const condDep = wDep.code != null ? wmo(wDep.code) : { icon: '—', label: '—' };
    const tDep = stop.pauseDeparture.toISOString();
    return `
      <div class="popup-pause" data-stop-idx="${idx}">
        <div class="popup-pause-header">${name} · pause de ${fmtDur(stop.pauseSec)}</div>
        <div class="popup-pause-cols">
          <div class="popup-pause-col">
            <div class="popup-pause-label">ARRIVÉE</div>
            <div class="popup-time">${fmtTime(stop.arrival)}</div>
            <div class="popup-temp">${fmtTemp(w.temp)}C</div>
            <div class="popup-cond">${cond.icon} ${cond.label}</div>
            <div class="popup-meta">Vent ${Math.round(w.wind)} km/h · Précip ${w.precip.toFixed(1)} mm</div>
            <button class="popup-details-btn" data-action="view-details" data-time="${tArr}" data-lat="${stop.lat}" data-lon="${stop.lon}" data-name="${name}">Détails →</button>
          </div>
          <div class="popup-pause-col">
            <div class="popup-pause-label">DÉPART</div>
            <div class="popup-time">${fmtTime(stop.pauseDeparture)}</div>
            <div class="popup-temp">${fmtTemp(wDep.temp)}C</div>
            <div class="popup-cond">${condDep.icon} ${condDep.label}</div>
            <div class="popup-meta">Vent ${Math.round(wDep.wind)} km/h · Précip ${wDep.precip.toFixed(1)} mm</div>
            <button class="popup-details-btn" data-action="view-details" data-time="${tDep}" data-lat="${stop.lat}" data-lon="${stop.lon}" data-name="${name}">Détails →</button>
          </div>
        </div>
      </div>`;
  }
  // Standard single-column popup
  return `
    <div data-stop-idx="${idx}">
      <div class="popup-time">${fmtDate(stop.arrival)} · ${fmtTime(stop.arrival)}</div>
      <div class="popup-temp">${fmtTemp(w.temp)}C</div>
      <div class="popup-cond">${cond.icon} ${cond.label}</div>
      <div style="font-size:11px;color:var(--text-mute);margin-top:6px;font-family:'JetBrains Mono',monospace">
        ${name} · Vent ${Math.round(w.wind)} km/h · Précip ${w.precip.toFixed(1)} mm
      </div>
      <button class="popup-details-btn" data-action="view-details" data-time="${tArr}" data-lat="${stop.lat}" data-lon="${stop.lon}" data-name="${name}">Détails →</button>
    </div>`;
}

// Format the tooltip text for a stop on the timeline.
// Multi-line for pauses (more readable than a long single line).
// Format the tooltip text for a stop on the timeline.
// `role` is 'arrival', 'departure', or null for non-paused stops.
function formatStopTip(s, i, w, role = null) {
  const isPause = s.kind === 'waypoint' && s.pauseSec > 0;
  const name = state.routeStopNames[i];
  if (isPause && role === 'arrival') {
    return `<div class="tip-line tip-name">${name}</div>
            <div class="tip-line tip-meta">⏸ arrivée · pause de ${fmtDur(s.pauseSec)}</div>
            <div class="tip-line tip-meta">${fmtTime(s.arrival)} → ${fmtTime(s.pauseDeparture)}</div>`;
  }
  if (isPause && role === 'departure') {
    return `<div class="tip-line tip-name">${name}</div>
            <div class="tip-line tip-meta">▶ départ après pause de ${fmtDur(s.pauseSec)}</div>
            <div class="tip-line tip-meta">${fmtTime(s.pauseDeparture)} · ${fmtTemp(w.temp)}C</div>`;
  }
  if (isPause) {
    return `<div class="tip-line tip-name">${name}</div>
            <div class="tip-line tip-meta">⏸ pause de ${fmtDur(s.pauseSec)}</div>
            <div class="tip-line tip-meta">${fmtTime(s.arrival)} → ${fmtTime(s.pauseDeparture)}</div>`;
  }
  return `<div class="tip-line tip-name">${name}</div>
          <div class="tip-line tip-meta">${fmtTime(s.arrival)} · ${fmtTemp(w.temp)}C</div>`;
}

// Background refinement of stop names: reverseGeocode is throttled to 1/sec by
// Nominatim policy (handled inside geocoding.js). For each interp stop without
// a name, request a name and update both the map popup AND the timeline tooltip.
async function refineStopNamesInBackground() {
  if (!state.routeStops || !_stopMarkers.length) return;
  const target = state.routeStops;
  const markers = [..._stopMarkers];
  for (let i = 0; i < target.length; i++) {
    if (!_isActive) break;
    const s = target[i];
    if (s.kind !== 'interp') continue;
    try {
      const name = await reverseGeocode(s.lat, s.lon);
      if (!_isActive || target !== state.routeStops) break;
      state.routeStopNames[i] = name;
      // Update the map popup
      const wData = state.routeWeather?.[i] || state.routeWeather?.[0];
      const w = wData ? pickHour(wData, s.arrival) : { temp: null, code: null, precip: 0, wind: 0 };
      const cond = w.code != null ? wmo(w.code) : { icon: '📍', label: 'Étape' };
      markers[i]?.setPopupContent(buildStopPopup(s, i, w, cond));
      // Update the timeline pictogram tooltip too
      const mark = document.querySelector(`.tl-stop-mark[data-stop-idx="${i}"] .tl-stop-tip`);
      if (mark) mark.innerHTML = formatStopTip(s, i, w);
    } catch (e) {
      // silently keep coords as fallback
    }
  }
  console.log('[route] background reverseGeocode pass complete');
}

function renderScrubberPictograms(departTime) {
  const tlBar = document.getElementById('timeline-bar');
  // Draw pause zones first (background)
  state.legSegments.filter(s => s.type === 'pause').forEach(s => {
    const left = (s.startSec / state.totalSec) * 100;
    const width = ((s.endSec - s.startSec) / state.totalSec) * 100;
    const zone = document.createElement('div');
    zone.className = 'tl-pause-zone';
    zone.style.left = `${left}%`;
    zone.style.width = `${width}%`;
    tlBar.appendChild(zone);
    // Pause icon (centered)
    const icon = document.createElement('div');
    icon.className = 'tl-pause-icon';
    icon.style.left = `${left + width/2}%`;
    icon.textContent = '⏸';
    tlBar.appendChild(icon);
  });
  // Stop pictograms
  state.routeStops.forEach((s, i) => {
    const isWaypoint = s.kind === 'waypoint';
    const isEndpoint = s.isEndpoint || (isWaypoint && (s.waypointIndex === 0 || s.waypointIndex === state.waypoints.length - 1));
    const isPause = isWaypoint && s.pauseSec > 0;
    const wData = state.routeWeather?.[i] || state.routeWeather?.[0];
    const w = wData ? pickHour(wData, s.arrival) : { temp: null, code: null };
    const cond = w.code != null ? wmo(w.code) : { icon: '', label: '' };
    const progress = s.elapsedSec / state.totalSec;
    // ----- "Arrival" pictogram (always rendered) -----
    const mark = document.createElement('div');
    mark.className = 'tl-stop-mark'
      + (isEndpoint ? ' endpoint' : '')
      + (isWaypoint ? ' waypoint' : '')
      + (isPause ? ' is-pause-arrival' : '');
    mark.style.left = `${progress * 100}%`;
    mark.dataset.stopIdx = i;
    if (isWaypoint && !isEndpoint) {
      mark.innerHTML = `${(s.waypointIndex ?? 0) + 1}`;
      if (isPause) mark.innerHTML += '<span class="tl-stop-pause-dot">⏸</span>';
    } else if (isEndpoint) {
      mark.innerHTML = '';
    } else {
      mark.innerHTML = cond.icon;
    }
    mark.innerHTML += `<div class="tl-stop-tip">${formatStopTip(s, i, w, isPause ? 'arrival' : null)}</div>`;
    mark.addEventListener('click', e => {
      e.stopPropagation();
      TimeCtl.pause();
      TimeCtl.setTime(s.arrival.getTime());
      const m = _stopMarkers[i];
      if (m && state.layers.stops) m.openPopup();
    });
    tlBar.appendChild(mark);

    // ----- "Departure" pictogram for paused waypoints (additional, after pause) -----
    if (isPause && s.pauseDeparture) {
      const depElapsed = s.elapsedSec + s.pauseSec;
      const depProgress = depElapsed / state.totalSec;
      const wDep = wData ? pickHour(wData, s.pauseDeparture) : { temp: null, code: null };
      const depMark = document.createElement('div');
      depMark.className = 'tl-stop-mark waypoint is-pause-departure';
      depMark.style.left = `${depProgress * 100}%`;
      depMark.dataset.stopIdx = i;   // same source stop (refresh updates both)
      depMark.innerHTML = `${(s.waypointIndex ?? 0) + 1}`;
      depMark.innerHTML += `<div class="tl-stop-tip">${formatStopTip(s, i, wDep, 'departure')}</div>`;
      depMark.addEventListener('click', e => {
        e.stopPropagation();
        TimeCtl.pause();
        TimeCtl.setTime(s.pauseDeparture.getTime());
        const m = _stopMarkers[i];
        if (m && state.layers.stops) m.openPopup();
      });
      tlBar.appendChild(depMark);
    }
  });
  // Sun events
  const sunEvents = computeSunEvents(state.routeCoords, state.cumDistances, departTime, state.totalSec);
  sunEvents.forEach(ev => {
    const sm = document.createElement('div');
    sm.className = 'tl-sun-mark';
    sm.style.left = `${ev.progress * 100}%`;
    sm.innerHTML = ev.type === 'sunrise' ? '🌅' : '🌇';
    sm.title = `${ev.type === 'sunrise' ? 'Lever' : 'Coucher'} du soleil · ${fmtTime(ev.time)}`;
    tlBar.appendChild(sm);
  });
  // Influence bands: subtle colored stripes showing which stop drives each
  // section of the chart. Only visible when a chart is active.
  renderInfluenceBands();
}

// Compute the temporal "influence window" for each stop on the timeline.
// For interp stops: midpoint(prev) → midpoint(next).
// For pause waypoints: arrival → departure (locked during the pause).
// Returns array of { stopIdx, startSec, endSec }.
function computeInfluenceWindows() {
  if (!state.routeStops?.length || !state.totalSec) return [];
  const stops = state.routeStops;
  const windows = [];
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const isPause = s.kind === 'waypoint' && s.pauseSec > 0;
    let startSec, endSec;
    if (isPause) {
      // The pause locks the influence window
      startSec = s.elapsedSec;
      endSec = s.elapsedSec + s.pauseSec;
    } else {
      // Midpoint with neighbors (skipping pauses, since their windows are fixed)
      const prev = i > 0 ? stops[i - 1] : null;
      const next = i < stops.length - 1 ? stops[i + 1] : null;
      // If previous is a pause, our window starts at its departure
      if (prev) {
        const prevEnd = prev.kind === 'waypoint' && prev.pauseSec > 0
          ? prev.elapsedSec + prev.pauseSec
          : prev.elapsedSec;
        startSec = (prevEnd + s.elapsedSec) / 2;
      } else {
        startSec = 0;
      }
      if (next) {
        const nextStart = next.elapsedSec;
        endSec = (s.elapsedSec + nextStart) / 2;
      } else {
        endSec = state.totalSec;
      }
    }
    windows.push({ stopIdx: i, startSec, endSec });
  }
  return windows;
}

// Render subtle colored bands on the timeline showing the influence zone of
// each stop on the active chart. Hidden when no chart is selected.
const CHART_COLORS = {
  pressure:      '#6db3d8',
  precipitation: '#4a90b8',
  radiation:     '#f4a460'
};
function renderInfluenceBands() {
  const tlBar = document.getElementById('timeline-bar');
  if (!tlBar) return;
  // Clear existing bands
  tlBar.querySelectorAll('.tl-influence-band').forEach(el => el.remove());
  if (state.currentChart === 'none' || !state.routeStops?.length) return;
  const color = CHART_COLORS[state.currentChart];
  if (!color) return;
  const windows = computeInfluenceWindows();
  windows.forEach(w => {
    const left = (w.startSec / state.totalSec) * 100;
    const width = ((w.endSec - w.startSec) / state.totalSec) * 100;
    const band = document.createElement('div');
    band.className = 'tl-influence-band';
    band.style.left = `${left}%`;
    band.style.width = `${width}%`;
    band.style.background = color;
    band.dataset.stopIdx = w.stopIdx;
    tlBar.appendChild(band);
  });
}

// ============================================================
// TICK HANDLER
// ============================================================
function onTick({ time, progress }) {
  if (!_isActive || !state.routeData) return;
  const elapsedSec = (time.getTime() - TimeCtl.start.getTime()) / 1000;
  const pos = positionAtTime(state.legSegments, state.routeCoords, state.cumDistances, elapsedSec);
  // Compute bearing from current segment direction
  let bearing = 0;
  if (!pos.isPaused) {
    const i = pos.segIdx, j = Math.min(state.routeCoords.length - 1, i + 1);
    const c1 = state.routeCoords[i], c2 = state.routeCoords[j];
    const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
    if (dx !== 0 || dy !== 0) {
      // Same as bearingDeg in utils
      const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
      const phi1 = toRad(c1[1]), phi2 = toRad(c2[1]);
      const dLambda = toRad(c2[0] - c1[0]);
      const y = Math.sin(dLambda) * Math.cos(phi2);
      const x = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(dLambda);
      bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
    }
  }
  // Move car to its computed position
  setCarPos(pos.lat, pos.lon, bearing);

  // UI updates
  document.getElementById('clock-time').textContent = fmtTime(time);
  const dayDelta = TimeCtl.start ? Math.floor((time - TimeCtl.start) / (24*3600*1000)) : 0;
  let metaTxt = `${fmtDate(time)}${dayDelta > 0 ? ` · J+${dayDelta}` : ''}`;
  if (pos.isPaused) {
    const wpName = state.routeStopNames?.find((n, i) => {
      const s = state.routeStops?.[i];
      return s && Math.abs(s.lat - pos.lat) < 0.001 && Math.abs(s.lon - pos.lon) < 0.001;
    }) || `étape ${pos.currentSegment.wpIndex+1}`;
    metaTxt += ` · ⏸ pause`;
  }
  document.getElementById('clock-meta').textContent = metaTxt;
  document.getElementById('timeline-fill').style.width = `${progress*100}%`;

  updateLayersForTime(time);
  if (state.layers.terminator) drawTerminator(time);
  else clearTerminator();
  updateTheme(time, pos.lat, pos.lon);
  updateAstroBox('route-astro-box', time, pos.lat, pos.lon, bearing);
  // Lot B: update the "Météo courante" card in the play sidebar
  if (state.routeSidebarMode === 'play') {
    updateCurrentWeatherCard(time, pos);
  }
}

// Direct car position setter via the car module
function setCarPos(lat, lon, bearing) {
  setCarPosition(lat, lon, bearing);
}
