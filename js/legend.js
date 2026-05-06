import { state, emit } from './state.js';
import { MODELS, RANGE_MODES, STOP_DENSITIES } from './config.js';

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

const RANGE_RADIO_DEFS = [
  { key: 'radar',    label: 'Radar focus (12h passé + 2h futur)' },
  { key: 'week',     label: '7 prochains jours' },
  { key: 'extended', label: '14 prochains jours' }
];

const TABS = [
  { key: 'layers', label: 'Couches' },
  { key: 'data',   label: 'Données' },
  { key: 'chart',  label: 'Graphique' }
];

// Module-scoped: persists across buildLegend() rebuilds (e.g. mode switch)
let activeTab = 'layers';

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
  return `<div class="legend-section">
    <div class="legend-section-title">Plage temporelle</div>
    ${RANGE_RADIO_DEFS.map(r => `
      <div class="chart-radio-row${state.rangeMode === r.key ? ' active' : ''}" data-range="${r.key}">
        <div class="chart-radio"></div>
        <div class="chart-radio-label">${r.label}</div>
      </div>`).join('')}
  </div>`;
}

function densitySection() {
  if (state.mode !== 'route') return '';
  return `<div class="legend-section">
    <div class="legend-section-title">Densité des marqueurs météo</div>
    ${Object.entries(STOP_DENSITIES).map(([key, d]) => `
      <div class="chart-radio-row${state.stopDensity === key ? ' active' : ''}" data-density="${key}">
        <div class="chart-radio"></div>
        <div class="chart-radio-label">
          <div>${d.label}</div>
          <div class="legend-radio-desc">${d.desc}</div>
        </div>
      </div>`).join('')}
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

function tabsBar() {
  return `<div class="legend-tabs" role="tablist">
    ${TABS.map(t => `<button class="legend-tab${t.key === activeTab ? ' active' : ''}" data-tab="${t.key}" role="tab" aria-selected="${t.key === activeTab}">${t.label}</button>`).join('')}
  </div>`;
}

function paneLayers() {
  return `<div class="legend-pane${activeTab === 'layers' ? ' active' : ''}" data-pane="layers">
    <div class="legend-section">
      <div class="legend-section-title">Couches affichées</div>
      ${LAYER_DEFS.map(layerRow).join('')}
    </div>
  </div>`;
}

function paneData() {
  return `<div class="legend-pane${activeTab === 'data' ? ' active' : ''}" data-pane="data">
    <div class="legend-section">
      <div class="legend-section-title">Modèle météo</div>
      <select class="legend-model-select" id="legend-model">${modelOptions()}</select>
    </div>
    ${rangeSection()}
    ${densitySection()}
  </div>`;
}

function paneChart() {
  return `<div class="legend-pane${activeTab === 'chart' ? ' active' : ''}" data-pane="chart">
    ${chartSection()}
  </div>`;
}

export function buildLegend() {
  const panel = document.getElementById('legend-panel');
  panel.innerHTML = `
    ${tabsBar()}
    <div class="legend-content">
      ${paneLayers()}
      ${paneData()}
      ${paneChart()}
    </div>`;

  // Tab switching — keep the panel open, just swap pane visibility (no rebuild)
  panel.querySelectorAll('.legend-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      if (t === activeTab) return;
      activeTab = t;
      panel.querySelectorAll('.legend-tab').forEach(b => {
        const on = b.dataset.tab === t;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panel.querySelectorAll('.legend-pane').forEach(p => {
        p.classList.toggle('active', p.dataset.pane === t);
      });
      // Reset scroll to top of new pane for predictable feel
      const content = panel.querySelector('.legend-content');
      if (content) content.scrollTop = 0;
    });
  });

  const modelSel = panel.querySelector('#legend-model');
  if (modelSel) {
    modelSel.addEventListener('change', e => {
      state.currentModel = e.target.value;
      emit('modelChange', { model: e.target.value });
    });
  }
  panel.querySelectorAll('[data-range]').forEach(row => {
    row.addEventListener('click', () => {
      const r = row.dataset.range;
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
  panel.querySelectorAll('[data-density]').forEach(row => {
    row.addEventListener('click', () => {
      const k = row.dataset.density;
      if (k === state.stopDensity) return;
      state.stopDensity = k;
      panel.querySelectorAll('[data-density]').forEach(r => r.classList.toggle('active', r.dataset.density === k));
      emit('densityChange', { density: k });
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
    // Switch glyph: + (open) ↔ − (close). Same convention as the day-frame
    // zoom toggle and the astro-box collapse button so the user has one
    // consistent affordance for "expand / collapse" across the app.
    btn.textContent = open ? '−' : '+';
    btn.title = open ? 'Fermer le menu' : 'Légende et options';
  });
}
