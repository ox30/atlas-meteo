// Global app state + event bus

export const state = {
  mode: 'city',
  // City mode
  city: null,
  cityHourly: null,
  cityDaily: null,
  // Route mode (multi-waypoints)
  waypoints: [
    // { id, city: {name, latitude, longitude, country}, pauseHours, pauseMinutes }
  ],
  routeData: null,        // OSRM response (full route through all waypoints)
  routeCoords: null,      // geometry [lon,lat][]
  cumDistances: null,     // cumulative distances along routeCoords
  legSegments: null,      // [{ startSec, endSec, type:'drive'|'pause', wpIndex, fromIdx, toIdx, fromCum, toCum }]
  totalSec: 0,            // total duration including pauses
  routeStops: null,       // sampling points (driving only) for weather pictograms
  routeWeather: null,     // hourly arrays per stop
  routeStopNames: null,
  // Shared display options
  currentModel: 'best_match',
  layers: { radar: true, clouds: true, terminator: true, sun: true, stops: true },
  rangeMode: 'short',
  currentChart: 'none'    // 'none' | 'pressure' | 'precipitation' | 'radiation'
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  const h = e => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
};

// Helper to generate waypoint IDs
let _wpId = 0;
export const newWaypointId = () => `wp_${Date.now()}_${++_wpId}`;
