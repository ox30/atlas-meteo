import { TimeCtl } from './time-ctl.js';
import { state, on } from './state.js';
import { fetchCityForecast, pickHour } from './weather.js';
import { fetchIndex, updateLayersForTime, clearLayers as clearRVLayers } from './rainviewer.js';
import { drawTerminator, clearTerminator } from './astronomy.js';
import { updateTheme, resetTheme } from './theme.js';
import { getMap, invalidateSizeSoon, clearLayer } from './map.js';
import { setupAutocomplete } from './geocoding.js';
import { startPicking } from './map-picker.js';
import { RANGE_MODES, wmo } from './config.js';
import { fmtTime, fmtDate, toast } from './utils.js';
import { clearScrubberContent, setWeatherProvider, clearWeatherProvider } from './scrubber.js';
import { renderChart } from './chart.js';

let _cityMarker = null;
let _isActive = false;
let _lastSidebarHour = null;

export function init() {
  setupAutocomplete('city-search', 'city-suggestions', city => {
    if (_isActive) loadCity(city);
  });
  // Pin button for map picker
  document.getElementById('city-pin').addEventListener('click', e => {
    if (!_isActive) return;
    startPicking('Clique sur la carte pour choisir une localité', city => {
      document.getElementById('city-search').value = city.name;
      loadCity(city);
    }, e.currentTarget);
  });
  on('tick', onTick);
  on('modelChange', () => { if (_isActive && state.city) loadCity(state.city); });
  on('rangeChange', () => { if (_isActive && state.city) setupRange(); });
  on('chartChange', () => { if (_isActive) renderChart(); });
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

export function activate() {
  _isActive = true;
  setWeatherProvider(time => {
    if (!state.cityHourly) return null;
    const w = pickHour(state.cityHourly, time);
    return { temp: w.temp, code: w.code };
  });
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
  clearWeatherProvider();
  clearScrubberContent();
  document.getElementById('viewport').classList.remove('viewport-mode-city-anim');
  document.getElementById('viewport').classList.remove('with-chart');
  document.getElementById('chart-box').innerHTML = '';
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
    fetchIndex();
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
  if (state.cityHourly) {
    const hourKey = Math.floor(time.getTime() / 3600000);
    if (hourKey !== _lastSidebarHour) {
      _lastSidebarHour = hourKey;
      renderSidebar(time);
    }
  }
  updateLayersForTime(time);
  if (state.layers.terminator) drawTerminator(time);
  else clearTerminator();
  updateTheme(time, state.city.latitude, state.city.longitude);
  document.getElementById('clock-time').textContent = fmtTime(time);
  document.getElementById('clock-meta').textContent = fmtDate(time);
  document.getElementById('timeline-fill').style.width = `${progress*100}%`;
  if (state.cityHourly) {
    const w = pickHour(state.cityHourly, time);
    const cond = wmo(w.code);
    document.getElementById('scrubber-summary').innerHTML = `<strong>${cond.icon} ${cond.label}</strong>`;
  }
}

function renderSidebar(time) {
  const w = pickHour(state.cityHourly, time);
  const cond = wmo(w.code);
  const c = state.city;
  // Filter to keep only days >= today (skip past_days dupes)
  const today0 = new Date(); today0.setHours(0,0,0,0);
  const days = [];
  for (let i = 0; i < state.cityDaily.time.length; i++) {
    const d = new Date(state.cityDaily.time[i]);
    if (d >= today0) days.push({ idx: i, date: d });
    if (days.length >= 7) break;
  }
  const todayKey = today0.getTime();
  const currentKey = new Date(time); currentKey.setHours(0,0,0,0);
  const currentDayKey = currentKey.getTime();
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
  for (const day of days) {
    const dc = wmo(state.cityDaily.weather_code[day.idx]);
    const dKey = new Date(day.date); dKey.setHours(0,0,0,0);
    const isCurrent = dKey.getTime() === currentDayKey;
    html += `<div class="forecast-day${isCurrent ? ' now' : ''}" title="${dc.label}" data-day-iso="${day.date.toISOString()}">
      <div class="fday-name">${['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][day.date.getDay()]}</div>
      <div class="fday-icon">${dc.icon}</div>
      <div class="fday-temps"><span class="fday-tmax">${Math.round(state.cityDaily.temperature_2m_max[day.idx])}°</span><span class="fday-tmin">/${Math.round(state.cityDaily.temperature_2m_min[day.idx])}°</span></div>
    </div>`;
  }
  html += '</div>';
  document.getElementById('city-data').innerHTML = html;
  // Click handlers on day cards → setTime to that day at noon
  document.querySelectorAll('.forecast-day[data-day-iso]').forEach(el => {
    el.addEventListener('click', () => {
      const d = new Date(el.dataset.dayIso);
      d.setHours(12, 0, 0, 0);
      // If beyond TimeCtl range, expand range to cover it
      if (TimeCtl.end && d > TimeCtl.end) {
        const newEnd = new Date(d.getTime() + 24*3600*1000);
        TimeCtl.init(TimeCtl.start, newEnd);
      }
      TimeCtl.pause();
      TimeCtl.setTime(d.getTime());
    });
  });
}
