import { TimeCtl } from './time-ctl.js';
import { state, on, newWaypointId } from './state.js';
import { fetchRoute, computeCumDistances, buildSegments, positionAtTime,
         sampleRouteStops, buildRouteStops, findWaypointIndices } from './routing.js';
import { fetchMultiPointHourly, pickHour } from './weather.js';
import { reverseGeocode, geocode } from './geocoding.js';
import { startPicking } from './map-picker.js';
import { getMap, invalidateSizeSoon, clearLayer } from './map.js';
import { fetchIndex, updateLayersForTime, clearLayers as clearRVLayers } from './rainviewer.js';
import { drawTerminator, clearTerminator, computeSunEvents,
         getSunAltitudeDeg, getSunAzimuthDeg, getSunTimes } from './astronomy.js';
import { updateTheme, resetTheme } from './theme.js';
import { placeCar, updateCarPosition, setCarPosition, clearCar } from './car.js';
import { wmo, CAR_SVG } from './config.js';
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
  on('tick', onTick);
  on('modelChange', () => { if (_isActive && state.routeData) calculateTrip(); });
  on('chartChange', () => { if (_isActive) renderChart(); });
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
    // Find which stop's time is closest
    if (!state.routeStops) return null;
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < state.routeStops.length; i++) {
      const d = Math.abs(state.routeStops[i].arrival.getTime() - time.getTime());
      if (d < bestDiff) { bestDiff = d; bestIdx = i; }
    }
    const w = pickHour(state.routeWeather[bestIdx], time);
    return { temp: w.temp, code: w.code };
  });
  updateWaypointMarkers();
  if (state.routeData) {
    document.getElementById('viewport').classList.add('viewport-mode-route');
    invalidateSizeSoon();
  } else {
    document.getElementById('empty-state').style.display = 'flex';
  }
}

export function deactivate() {
  _isActive = false;
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
    const N = Math.min(10, Math.max(filled.length, Math.round(routeData.distance / 100000) + 2));
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

  } catch (e) {
    toast('Erreur : ' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Calculer le voyage';
  }
}

// Build the popup HTML for a stop. For waypoints with pause: 2 columns (arrival/departure).
function buildStopPopup(stop, idx, w, cond) {
  const name = state.routeStopNames[idx];
  const isPause = stop.kind === 'waypoint' && stop.pauseSec > 0;
  if (isPause) {
    // Get departure weather (after the pause)
    const wDataDep = state.routeWeather?.[idx];
    const wDep = wDataDep ? pickHour(wDataDep, stop.pauseDeparture) : { temp: null, code: null, precip: 0, wind: 0 };
    const condDep = wDep.code != null ? wmo(wDep.code) : { icon: '—', label: '—' };
    return `
      <div class="popup-pause">
        <div class="popup-pause-header">${name} · pause de ${fmtDur(stop.pauseSec)}</div>
        <div class="popup-pause-cols">
          <div class="popup-pause-col">
            <div class="popup-pause-label">ARRIVÉE</div>
            <div class="popup-time">${fmtTime(stop.arrival)}</div>
            <div class="popup-temp">${fmtTemp(w.temp)}C</div>
            <div class="popup-cond">${cond.icon} ${cond.label}</div>
            <div class="popup-meta">Vent ${Math.round(w.wind)} km/h · Précip ${w.precip.toFixed(1)} mm</div>
          </div>
          <div class="popup-pause-col">
            <div class="popup-pause-label">DÉPART</div>
            <div class="popup-time">${fmtTime(stop.pauseDeparture)}</div>
            <div class="popup-temp">${fmtTemp(wDep.temp)}C</div>
            <div class="popup-cond">${condDep.icon} ${condDep.label}</div>
            <div class="popup-meta">Vent ${Math.round(wDep.wind)} km/h · Précip ${wDep.precip.toFixed(1)} mm</div>
          </div>
        </div>
      </div>`;
  }
  // Standard single-column popup
  return `
    <div class="popup-time">${fmtDate(stop.arrival)} · ${fmtTime(stop.arrival)}</div>
    <div class="popup-temp">${fmtTemp(w.temp)}C</div>
    <div class="popup-cond">${cond.icon} ${cond.label}</div>
    <div style="font-size:11px;color:var(--text-mute);margin-top:6px;font-family:'JetBrains Mono',monospace">
      ${name} · Vent ${Math.round(w.wind)} km/h · Précip ${w.precip.toFixed(1)} mm
    </div>`;
}

// Format the tooltip text for a stop on the timeline.
// Multi-line for pauses (more readable than a long single line).
function formatStopTip(s, i, w) {
  const isPause = s.kind === 'waypoint' && s.pauseSec > 0;
  const name = state.routeStopNames[i];
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
    const mark = document.createElement('div');
    mark.className = 'tl-stop-mark' + (isEndpoint ? ' endpoint' : '') + (isWaypoint ? ' waypoint' : '');
    mark.style.left = `${progress * 100}%`;
    mark.dataset.stopIdx = i;       // for background-refinement updates
    if (isWaypoint && !isEndpoint) {
      mark.innerHTML = `${(s.waypointIndex ?? 0) + 1}`;
      if (isPause) mark.innerHTML += '<span class="tl-stop-pause-dot">⏸</span>';
    } else if (isEndpoint) {
      mark.innerHTML = '';
    } else {
      mark.innerHTML = cond.icon;
    }
    // Tooltip — multi-line for pauses (more readable)
    mark.innerHTML += `<div class="tl-stop-tip">${formatStopTip(s, i, w)}</div>`;
    mark.addEventListener('click', e => {
      e.stopPropagation();
      TimeCtl.pause();
      TimeCtl.setTime(s.arrival.getTime());
      // Open the corresponding map marker popup so the user sees the (double) card
      const m = _stopMarkers[i];
      if (m && state.layers.stops) m.openPopup();
    });
    tlBar.appendChild(mark);
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
  updateAstroBox(time, pos.lat, pos.lon, bearing);
}

// Direct car position setter via the car module
function setCarPos(lat, lon, bearing) {
  setCarPosition(lat, lon, bearing);
}

function updateAstroBox(time, lat, lon, bearing) {
  const box = document.getElementById('astro-box');
  if (!box.classList.contains('visible')) box.classList.add('visible');
  try {
    const times = getSunTimes(time, lat, lon);
    const altDeg = getSunAltitudeDeg(time, lat, lon);
    const azCompass = getSunAzimuthDeg(time, lat, lon);
    document.getElementById('astro-rise').textContent = isNaN(times.sunrise.getTime()) ? '—' : fmtTime(times.sunrise);
    document.getElementById('astro-set').textContent = isNaN(times.sunset.getTime()) ? '—' : fmtTime(times.sunset);
    let phase;
    if (altDeg > 30) phase = 'Plein jour';
    else if (altDeg > 6) phase = 'Heure dorée';
    else if (altDeg > 0) phase = 'Soleil bas';
    else if (altDeg > -6) phase = 'Crépuscule';
    else if (altDeg > -12) phase = 'Nuit (aube/crép. nautique)';
    else phase = 'Pleine nuit';
    document.getElementById('astro-pos').textContent = `${altDeg > 0 ? '+' : ''}${altDeg.toFixed(0)}° · ${phase}`;
    const warnEl = document.getElementById('astro-warning');
    if (altDeg > 0 && altDeg < 8 && bearing != null) {
      const diff = Math.abs(((bearing - azCompass + 540) % 360) - 180);
      const facingDelta = 180 - diff;
      if (facingDelta < 30) {
        warnEl.style.display = 'block';
        warnEl.textContent = `Soleil bas (${altDeg.toFixed(0)}°) en face — visibilité réduite probable`;
      } else { warnEl.style.display = 'none'; }
    } else { warnEl.style.display = 'none'; }
  } catch (e) {}
}
