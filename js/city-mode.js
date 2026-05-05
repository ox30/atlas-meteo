import { TimeCtl } from './time-ctl.js';
import { state, on, emit } from './state.js';
import { fetchCityForecast, pickHour } from './weather.js';
import { fetchIndex, updateLayersForTime, clearLayers as clearRVLayers } from './rainviewer.js';
import { drawTerminator, clearTerminator } from './astronomy.js';
import { updateTheme, resetTheme } from './theme.js';
import { getMap, invalidateSizeSoon, clearLayer } from './map.js';
import { setupAutocomplete } from './geocoding.js';
import { RANGE_MODES, wmo } from './config.js';
import { fmtTime, fmtDate, toast } from './utils.js';

let _cityMarker = null;
let _isActive = false;
let _lastSidebarHour = null;

export function init() {
  setupAutocomplete('city-search', 'city-suggestions', city => {
    if (_isActive) loadCity(city);
  });
  // Subscribe globally — only act if mode is city
  on('tick', onTick);
  on('modelChange', () => {
    if (_isActive && state.city) loadCity(state.city);
  });
  on('rangeChange', () => {
    if (_isActive && state.city) setupRange();
  });
  on('layerToggle', ({ layer }) => {
    if (!_isActive) return;
    if (layer === 'terminator') {
      if (state.layers.terminator) drawTerminator(TimeCtl.current || new Date());
      else clearTerminator();
    } else if (layer === 'sun') {
      updateTheme(TimeCtl.current || new Date(), state.city?.latitude || 0, state.city?.longitude || 0);
    }
  });
}

export async function activate() {
  _isActive = true;
  if (state.city) loadCity(state.city);
  else document.getElementById('empty-state').style.display = 'flex';
}

export function deactivate() {
  _isActive = false;
  TimeCtl.pause();
  clearLayer(_cityMarker); _cityMarker = null;
  clearRVLayers();
  clearTerminator();
  resetTheme();
  document.getElementById('viewport').classList.remove('viewport-mode-city-anim');
}

async function loadCity(city) {
  state.city = city;
  document.getElementById('empty-state').style.display = 'none';
  const map = getMap();
  invalidateSizeSoon();
  map.setView([city.latitude, city.longitude], 9);
  clearLayer(_cityMarker);
  _cityMarker = L.marker([city.latitude, city.longitude]).addTo(map);
  try {
    const data = await fetchCityForecast(city, state.currentModel, 7, 1);
    state.cityHourly = data.hourly;
    state.cityDaily = data.daily;
    setupRange();
    document.getElementById('viewport').classList.add('viewport-mode-city-anim');
    invalidateSizeSoon(150);
    fetchIndex();  // preload in background
  } catch (e) {
    toast('Erreur météo : ' + e.message);
  }
}

function setupRange() {
  const r = RANGE_MODES[state.rangeMode];
  const now = new Date();
  const start = new Date(now.getTime() - r.hoursBefore * 3600 * 1000);
  const end = new Date(now.getTime() + r.hoursAfter * 3600 * 1000);
  TimeCtl.init(start, end);
  TimeCtl.setTime(now.getTime());
}

function onTick({ time, progress }) {
  if (!_isActive || !state.city) return;
  // Sidebar update — throttled to once per hour change
  if (state.cityHourly) {
    const hourKey = Math.floor(time.getTime() / 3600000);
    if (hourKey !== _lastSidebarHour) {
      _lastSidebarHour = hourKey;
      renderSidebar(time);
    }
  }
  // Map layers
  updateLayersForTime(time);
  if (state.layers.terminator) drawTerminator(time);
  else clearTerminator();
  updateTheme(time, state.city.latitude, state.city.longitude);
  // Scrubber UI
  document.getElementById('clock-time').textContent = fmtTime(time);
  document.getElementById('clock-meta').textContent = fmtDate(time);
  document.getElementById('timeline-fill').style.width = `${progress*100}%`;
  // Summary
  const w = pickHour(state.cityHourly || { time:[], temperature_2m:[], weather_code:[], precipitation:[], wind_speed_10m:[] }, time);
  const cond = wmo(w.code);
  document.getElementById('scrubber-summary').innerHTML = `<strong>${cond.icon} ${cond.label}</strong>`;
}

function renderSidebar(time) {
  const w = pickHour(state.cityHourly, time);
  const cond = wmo(w.code);
  const c = state.city;
  let html = `
    <div class="current-card">
      <div class="current-loc">${c.name}${c.country?', '+c.country:''}</div>
      <div class="current-coords">${c.latitude.toFixed(3)}°N · ${c.longitude.toFixed(3)}°E · ${fmtTime(time)} ${fmtDate(time)}</div>
      <div class="current-row">
        <div class="current-temp">${Math.round(w.temp)}<span class="unit">°C</span></div>
        <div style="text-align:right">
          <div class="current-icon">${cond.icon}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${cond.label}</div>
        </div>
      </div>
      <div class="current-meta">
        <div class="meta-item"><span class="meta-label">Ressenti</span><span class="meta-value">${Math.round(w.apparent ?? w.temp)}°C</span></div>
        <div class="meta-item"><span class="meta-label">Humidité</span><span class="meta-value">${w.humidity ?? '—'}%</span></div>
        <div class="meta-item"><span class="meta-label">Vent</span><span class="meta-value">${Math.round(w.wind)} km/h</span></div>
        <div class="meta-item"><span class="meta-label">Pression</span><span class="meta-value">${w.pressure ? Math.round(w.pressure) : '—'} hPa</span></div>
      </div>
    </div>
    <div class="section-label">Prévision 7 jours</div>
    <div class="forecast-grid">`;
  for (let i = 0; i < state.cityDaily.time.length; i++) {
    const d = new Date(state.cityDaily.time[i]);
    const dc = wmo(state.cityDaily.weather_code[i]);
    html += `<div class="forecast-day" title="${dc.label}">
      <div class="fday-name">${['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][d.getDay()]}</div>
      <div class="fday-icon">${dc.icon}</div>
      <div class="fday-temps"><span class="fday-tmax">${Math.round(state.cityDaily.temperature_2m_max[i])}°</span><span class="fday-tmin">/${Math.round(state.cityDaily.temperature_2m_min[i])}°</span></div>
    </div>`;
  }
  html += '</div>';
  document.getElementById('city-data').innerHTML = html;
}
