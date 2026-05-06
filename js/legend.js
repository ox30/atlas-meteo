import { state, emit } from './state.js';
import { MODELS, RANGE_MODES } from './config.js';

const LAYER_DEFS = [
  { key: 'radar', name: 'Radar pluie', desc: 'RainViewer · 12h passé + 2h futur' },
  { key: 'clouds', name: 'Nuages (satellite)', desc: 'Imagerie infrarouge animée' },
  { key: 'terminator', name: 'Terminator solaire', desc: 'Ligne jour/nuit en mouvement' },
  { key: 'sun', name: 'Cycle jour / nuit', desc: 'Teinte UI selon position du soleil' },
  { key: 'stops', name: 'Étapes prévues', desc: 'Pictogrammes aux jalons (itinéraire)' }
];

const CHART_DEFS = [
  { key: 'none', label: 'Aucun graphique' },
  { key: 'pressure', label: 'Pression atmosphérique' },
  { key: 'precipitation', label: 'Précipitations' },
  { key: 'radiation', label: 'Rayonnement solaire' }
];

function modelOptions() {
  return MODELS.map(m => `<option value="${m.value}"${m.value === state.currentModel ? ' selected' : ''}>${m.label}</option>`).join('');
}

function layerRow(d) {
  const active = state.layers[d.key];
  if (d.key === 'stops' && state.mode === 'city') return '';
  return `<div class="layer-row${active ? ' active' : ''}" data-layer="${d.key}">
    <div class="layer-toggle"></div>
    <div class="layer-info">
      <div class="layer-name">${d.name}</div>
      <div class="layer-desc">${d.desc}</div>
    </div>
  </div>`;
}

function rangeSection() {
  if (state.mode !== 'city') return '';
  const desc = RANGE_MODES[state.rangeMode].label;
  return `<div class="legend-section">
    <div class="legend-section-title">Plage temporelle</div>
    <div class="range-switch">
      <button class="range-btn${state.rangeMode === 'short' ? ' active' : ''}" data-range="short">Court</button>
      <button class="range-btn${state.rangeMode === 'long' ? ' active' : ''}" data-range="long">Long</button>
    </div>
    <div class="range-desc">${desc}</div>
  </div>`;
}

function chartSection() {
  return `<div class="legend-section">
    <div class="legend-section-title">Graphique sous la timeline</div>
    ${CHART_DEFS.map(c => `
      <div class="chart-radio-row${state.currentChart === c.key ? ' active' : ''}" data-chart="${c.key}">
        <div class="chart-radio"></div>
        <div class="chart-radio-label">${c.label}</div>
      </div>`).join('')}
  </div>`;
}

export function buildLegend() {
  const panel = document.getElementById('legend-panel');
  panel.innerHTML = `
    <div class="legend-section">
      <div class="legend-section-title">Modèle météo</div>
      <select class="legend-model-select" id="legend-model">${modelOptions()}</select>
    </div>
    ${rangeSection()}
    <div class="legend-section">
      <div class="legend-section-title">Couches affichées</div>
      ${LAYER_DEFS.map(layerRow).join('')}
    </div>
    ${chartSection()}`;

  panel.querySelector('#legend-model').addEventListener('change', e => {
    state.currentModel = e.target.value;
    emit('modelChange', { model: e.target.value });
  });
  panel.querySelectorAll('[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.range;
      if (r === state.rangeMode) return;
      state.rangeMode = r;
      buildLegend();
      emit('rangeChange', { range: r });
    });
  });
  panel.querySelectorAll('[data-layer]').forEach(row => {
    row.addEventListener('click', () => {
      const k = row.dataset.layer;
      state.layers[k] = !state.layers[k];
      row.classList.toggle('active', state.layers[k]);
      emit('layerToggle', { layer: k, on: state.layers[k] });
    });
  });
  panel.querySelectorAll('[data-chart]').forEach(row => {
    row.addEventListener('click', () => {
      const k = row.dataset.chart;
      if (k === state.currentChart) return;
      state.currentChart = k;
      panel.querySelectorAll('[data-chart]').forEach(r => r.classList.toggle('active', r.dataset.chart === k));
      emit('chartChange', { chart: k });
    });
  });
}

export function initLegendToggle() {
  const btn = document.getElementById('legend-toggle');
  const panel = document.getElementById('legend-panel');
  let open = false;
  btn.addEventListener('click', () => {
    open = !open;
    btn.classList.toggle('open', open);
    panel.classList.toggle('open', open);
    btn.textContent = open ? '×' : '+';
  });
}
