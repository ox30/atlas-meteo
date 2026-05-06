// Global app state + event bus

export const state = {
  mode: 'city',
  city: null,
  cityHourly: null,
  cityDaily: null,
  waypoints: [],
  routeData: null,
  routeCoords: null,
  cumDistances: null,
  legSegments: null,
  totalSec: 0,
  routeStops: null,
  routeWeather: null,
  routeStopNames: null,
  currentModel: 'best_match',
  layers: { radar: true, clouds: true, terminator: true, sun: true, stops: true },
  rangeMode: 'week',
  currentChart: 'none',
  routeSidebarMode: 'edit'    // 'edit' (config) | 'play' (post-calcul)
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  const h = e => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
};

let _wpId = 0;
export const newWaypointId = () => `wp_${Date.now()}_${++_wpId}`;
