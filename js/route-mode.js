import { TimeCtl } from './time-ctl.js';
import { state, on } from './state.js';
import { fetchRoute, sampleStops, computeCumDistances, pointAtProgress } from './routing.js';
import { fetchMultiPointForecast, pickHour } from './weather.js';
import { reverseGeocode } from './geocoding.js';
import { setupAutocomplete } from './geocoding.js';
import { getMap, invalidateSizeSoon, clearLayer } from './map.js';
import { fetchIndex, updateLayersForTime, clearLayers as clearRVLayers } from './rainviewer.js';
import { drawTerminator, clearTerminator, computeSunEvents,
         getSunAltitudeDeg, getSunAzimuthDeg, getSunTimes } from './astronomy.js';
import { updateTheme, resetTheme } from './theme.js';
import { placeCar, updateCarPosition, clearCar } from './car.js';
import { wmo } from './config.js';
import { fmtKm, fmtDur, fmtTime, fmtDate, fmtTemp, toast, bearingDeg } from './utils.js';

let _fromCity = null, _toCity = null;
let _routeLayer = null;
let _stopMarkers = [];
let _isActive = false;

export function init() {
  setupAutocomplete('route-from', 'from-suggestions', c => _fromCity = c);
  setupAutocomplete('route-to', 'to-suggestions', c => _toCity = c);
  setDefaultTime();
  document.getElementById('calc-btn').addEventListener('click', () => {
    if (_isActive) calculateTrip();
  });
  on('tick', onTick);
  on('modelChange', () => {
    if (_isActive && state.routeData) calculateTrip();
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
}

function setDefaultTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const tz = d.getTimezoneOffset() * 60000;
  document.getElementById('route-time').value = new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function activate() {
  _isActive = true;
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
  clearRVLayers();
  clearTerminator();
  resetTheme();
  document.getElementById('viewport').classList.remove('viewport-mode-route');
}

function clearRouteVisuals() {
  const map = getMap();
  if (_routeLayer) { clearLayer(_routeLayer); _routeLayer = null; }
  _stopMarkers.forEach(m => clearLayer(m));
  _stopMarkers = [];
  clearCar();
}

async function calculateTrip() {
  if (!_fromCity || !_toCity) {
    toast('Sélectionne un point de départ et une destination dans les suggestions');
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

    // 1. Routing
    const routeData = await fetchRoute(_fromCity, _toCity);
    state.routeData = routeData;
    const coords = routeData.geometry.coordinates;
    state.cumDistances = computeCumDistances(coords);
    const latlngs = coords.map(c => [c[1], c[0]]);
    _routeLayer = L.polyline(latlngs, { color: '#ff9758', weight: 3, opacity: 0.85, smoothFactor: 1 }).addTo(map);
    map.fitBounds(_routeLayer.getBounds(), { padding: [40, 80] });

    // 2. Stops
    const N = Math.min(8, Math.max(4, Math.round(routeData.distance / 100000) + 2));
    state.routeStops = sampleStops(coords, routeData.distance, routeData.duration, departTime, N);
    state.routeWeather = await fetchMultiPointForecast(state.routeStops, state.currentModel);

    // 3. Reverse geocode
    state.routeStopNames = await Promise.all(state.routeStops.map(async (s, i) => {
      if (i === 0) return _fromCity.name;
      if (i === state.routeStops.length - 1) return _toCity.name;
      return await reverseGeocode(s.lat, s.lon);
    }));

    // 4. Stop markers
    state.routeStops.forEach((s, i) => {
      const w = pickHour(state.routeWeather[i] || state.routeWeather[0], s.arrival);
      const cond = wmo(w.code);
      const isEnd = (i === 0 || i === state.routeStops.length - 1);
      const icon = L.divIcon({
        className: isEnd ? 'endpoint-marker' : '',
        html: isEnd ? '' : `<div style="background:var(--bg);border:1.5px solid var(--accent);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 12px rgba(0,0,0,0.4)">${cond.icon}</div>`,
        iconSize: isEnd ? [14, 14] : [36, 36],
        iconAnchor: isEnd ? [7, 7] : [18, 18]
      });
      const m = L.marker([s.lat, s.lon], { icon, zIndexOffset: 500 });
      if (state.layers.stops) m.addTo(map);
      m.bindPopup(`
        <div class="popup-time">${fmtDate(s.arrival)} · ${fmtTime(s.arrival)}</div>
        <div class="popup-temp">${fmtTemp(w.temp)}C</div>
        <div class="popup-cond">${cond.icon} ${cond.label}</div>
        <div style="font-size:11px;color:var(--text-mute);margin-top:6px;font-family:'JetBrains Mono',monospace">
          ${state.routeStopNames[i]} · Vent ${Math.round(w.wind)} km/h · Précip ${w.precip.toFixed(1)} mm
        </div>`);
      _stopMarkers.push(m);
    });

    // 5. Stats
    document.getElementById('rs-dist').textContent = fmtKm(routeData.distance);
    document.getElementById('rs-dur').textContent = fmtDur(routeData.duration);
    const arrivalTime = new Date(departTime.getTime() + routeData.duration * 1000);
    document.getElementById('rs-arr').textContent = fmtDate(arrivalTime) + ' ' + fmtTime(arrivalTime);
    document.getElementById('rs-stops').textContent = state.routeStops.length;
    document.getElementById('route-stats').classList.add('visible');

    // 6. Summary
    const conds = state.routeStops.map((s, i) => pickHour(state.routeWeather[i] || state.routeWeather[0], s.arrival));
    const maxPrecip = Math.max(...conds.map(c => c.precip));
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

    // 7. Init RainViewer + place car
    await fetchIndex();
    placeCar(coords, state.cumDistances);

    // 8. Render timeline marks
    const tlBar = document.getElementById('timeline-bar');
    tlBar.querySelectorAll('.tl-stop-mark, .tl-sun-mark').forEach(el => el.remove());
    state.routeStops.forEach((s, i) => {
      const isEnd = (i === 0 || i === state.routeStops.length - 1);
      const w = pickHour(state.routeWeather[i] || state.routeWeather[0], s.arrival);
      const cond = wmo(w.code);
      const progress = s.elapsedSec / routeData.duration;
      const mark = document.createElement('div');
      mark.className = 'tl-stop-mark' + (isEnd ? ' endpoint' : '');
      mark.style.left = `${progress * 100}%`;
      mark.innerHTML = isEnd ? '' : cond.icon;
      mark.innerHTML += `<div class="tl-stop-tip">${fmtTime(s.arrival)} · ${state.routeStopNames[i]} · ${fmtTemp(w.temp)}C</div>`;
      mark.addEventListener('click', e => {
        e.stopPropagation();
        TimeCtl.pause();
        TimeCtl.setTime(s.arrival.getTime());
      });
      tlBar.appendChild(mark);
    });
    const sunEvents = computeSunEvents(coords, state.cumDistances, departTime, routeData.duration);
    sunEvents.forEach(ev => {
      const sm = document.createElement('div');
      sm.className = 'tl-sun-mark';
      sm.style.left = `${ev.progress * 100}%`;
      sm.innerHTML = ev.type === 'sunrise' ? '🌅' : '🌇';
      sm.title = `${ev.type === 'sunrise' ? 'Lever' : 'Coucher'} du soleil · ${fmtTime(ev.time)}`;
      tlBar.appendChild(sm);
    });

    // 9. Setup time controller
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

function onTick({ time, progress }) {
  if (!_isActive || !state.routeData) return;
  const coords = state.routeData.geometry.coordinates;
  const carPos = updateCarPosition(coords, state.cumDistances, progress);
  document.getElementById('clock-time').textContent = fmtTime(time);
  const dayDelta = TimeCtl.start ? Math.floor((time - TimeCtl.start) / (24*3600*1000)) : 0;
  document.getElementById('clock-meta').textContent = `${fmtDate(time)}${dayDelta > 0 ? ` · J+${dayDelta}` : ''}`;
  document.getElementById('timeline-fill').style.width = `${progress*100}%`;
  updateLayersForTime(time);
  if (state.layers.terminator) drawTerminator(time);
  else clearTerminator();
  if (carPos) {
    updateTheme(time, carPos.lat, carPos.lon);
    updateAstroBox(time, carPos.lat, carPos.lon, carPos.bearing);
  }
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
  } catch (e) { /* ignore */ }
}
