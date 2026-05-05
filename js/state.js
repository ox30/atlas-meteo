// Global app state + event bus

export const state = {
  mode: 'city',           // 'city' or 'route'
  city: null,             // current city object {name, latitude, longitude, country}
  currentModel: 'best_match',
  layers: { radar: true, clouds: true, terminator: true, sun: true, stops: true },
  rangeMode: 'short',     // 'short' or 'long'
  // Route data
  routeData: null,
  routeStops: null,
  routeWeather: null,
  routeStopNames: null,
  cumDistances: null,
  // City data
  cityHourly: null,       // hourly data array
  cityDaily: null
};

// Event bus
export const bus = new EventTarget();

export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  const h = e => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
};
