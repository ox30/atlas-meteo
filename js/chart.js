import { state, on } from './state.js';
import { TimeCtl } from './time-ctl.js';
import { pickHour } from './weather.js';
import { fmtTime } from './utils.js';

const CHART_DEFS = {
  pressure:      { label: 'Pression atmosphérique', unit: 'hPa', field: 'pressure',     color: '#6db3d8', kind: 'line', minSpan: 5 },
  precipitation: { label: 'Précipitations',         unit: 'mm/h', field: 'precip',      color: '#4a90b8', kind: 'bars', minSpan: 1 },
  radiation:     { label: 'Rayonnement solaire',    unit: 'W/m²', field: 'radiation',   color: '#f4a460', kind: 'area', minSpan: 100 }
};

// Get hourly source for a given time t (in route mode, picks closest stop in time)
function getHourlyAt(t) {
  if (state.mode === 'city') return state.cityHourly;
  if (state.mode === 'route' && state.routeWeather && state.routeWeather.length && state.routeStops?.length) {
    // Find stop whose arrival is closest to t
    const tt = t.getTime();
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < state.routeStops.length; i++) {
      const d = Math.abs(state.routeStops[i].arrival.getTime() - tt);
      if (d < bestDiff) { bestDiff = d; bestIdx = i; }
    }
    return state.routeWeather[bestIdx] || state.routeWeather[0];
  }
  return null;
}

// Sample N values along the timeline window
// Each sample uses the hourly source matching the location of the car at that time
function sampleSeries(field, samples = 60) {
  if (!TimeCtl.isInitialized()) return null;
  const start = TimeCtl.start, end = TimeCtl.end;
  const span = end - start;
  const data = [];
  for (let i = 0; i < samples; i++) {
    const t = new Date(start.getTime() + (i / (samples-1)) * span);
    const hourly = getHourlyAt(t);
    if (!hourly) { data.push({ t, v: 0 }); continue; }
    const w = pickHour(hourly, t);
    const v = w[field];
    data.push({ t, v: v == null ? 0 : v });
  }
  return data;
}

function buildLine(data, w, h, color, padding = 6) {
  if (!data.length) return '';
  const vals = data.map(d => d.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(0.1, max - min);
  const x = i => padding + (i / (data.length - 1)) * (w - 2*padding);
  const y = v => h - padding - ((v - min) / span) * (h - 2*padding);
  let d = `M ${x(0)} ${y(data[0].v)}`;
  for (let i = 1; i < data.length; i++) d += ` L ${x(i)} ${y(data[i].v)}`;
  return `<path d="${d}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`;
}

function buildArea(data, w, h, color, padding = 6) {
  if (!data.length) return '';
  const vals = data.map(d => d.v);
  const max = Math.max(...vals, 0.1);
  const x = i => padding + (i / (data.length - 1)) * (w - 2*padding);
  const y = v => h - padding - (v / max) * (h - 2*padding);
  let d = `M ${x(0)} ${h - padding}`;
  for (let i = 0; i < data.length; i++) d += ` L ${x(i)} ${y(data[i].v)}`;
  d += ` L ${x(data.length-1)} ${h - padding} Z`;
  return `<path d="${d}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.2"/>`;
}

function buildBars(data, w, h, color, padding = 6) {
  if (!data.length) return '';
  const max = Math.max(...data.map(d => d.v), 0.5);
  const bw = (w - 2*padding) / data.length;
  let out = '';
  for (let i = 0; i < data.length; i++) {
    if (data[i].v <= 0) continue;
    const bx = padding + i * bw;
    const bh = (data[i].v / max) * (h - 2*padding);
    out += `<rect x="${bx}" y="${h - padding - bh}" width="${Math.max(1, bw - 1)}" height="${bh}" fill="${color}" fill-opacity="0.7"/>`;
  }
  return out;
}

let _resizeHandler = null;

export function renderChart() {
  const box = document.getElementById('chart-box');
  const viewport = document.getElementById('viewport');
  if (state.currentChart === 'none') {
    viewport.classList.remove('with-chart');
    box.innerHTML = '';
    return;
  }
  viewport.classList.add('with-chart');
  const def = CHART_DEFS[state.currentChart];
  if (!def) { box.innerHTML = ''; return; }
  const data = sampleSeries(def.field);
  if (!data) { box.innerHTML = `<div class="chart-label">${def.label} — données indisponibles</div>`; return; }
  const w = box.clientWidth || 600;
  const h = 80;
  let inner = '';
  if (def.kind === 'line') inner = buildLine(data, w, h, def.color);
  else if (def.kind === 'area') inner = buildArea(data, w, h, def.color);
  else if (def.kind === 'bars') inner = buildBars(data, w, h, def.color);
  // Current value at TimeCtl.current
  const hourly = getHourlyAt(TimeCtl.current);
  const cur = hourly ? pickHour(hourly, TimeCtl.current)[def.field] : null;
  const curStr = cur != null ? `${Math.round(cur*10)/10} ${def.unit}` : '—';
  box.innerHTML = `
    <div class="chart-label">${def.label}</div>
    <div class="chart-value-label">${curStr}</div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${inner}</svg>`;
}

export function initChart() {
  on('tick', () => renderChart());
  on('layerToggle', () => { /* not needed */ });
  // Re-render on resize
  if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
  _resizeHandler = () => renderChart();
  window.addEventListener('resize', _resizeHandler);
}
