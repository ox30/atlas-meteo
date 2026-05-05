import { API } from './config.js';

// Fetch hourly + daily forecast for a single city
export async function fetchCityForecast(city, model = 'best_match', forecastDays = 7, pastDays = 0) {
  const params = new URLSearchParams({
    latitude: city.latitude,
    longitude: city.longitude,
    hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: forecastDays,
    past_days: pastDays,
    models: model
  });
  const r = await fetch(`${API.forecast}?${params}`);
  if (!r.ok) throw new Error('Échec récupération météo');
  return r.json();
}

// Pick the hourly index closest to a target time
export function pickHourIndex(hourly, target) {
  const ts = hourly.time.map(t => new Date(t).getTime());
  const tgt = target.getTime();
  let best = 0, diff = Infinity;
  for (let i = 0; i < ts.length; i++) {
    const d = Math.abs(ts[i] - tgt);
    if (d < diff) { diff = d; best = i; }
  }
  return best;
}

export function pickHour(hourly, target) {
  const i = pickHourIndex(hourly, target);
  return {
    temp: hourly.temperature_2m[i],
    code: hourly.weather_code[i],
    precip: hourly.precipitation[i],
    wind: hourly.wind_speed_10m[i],
    humidity: hourly.relative_humidity_2m?.[i],
    apparent: hourly.apparent_temperature?.[i],
    pressure: hourly.pressure_msl?.[i],
    cloudCover: hourly.cloud_cover?.[i],
    windDir: hourly.wind_direction_10m?.[i],
    time: new Date(hourly.time[i])
  };
}

// Multi-point forecast (route mode)
export async function fetchMultiPointForecast(stops, model = 'best_match') {
  const lats = stops.map(s => s.lat).join(',');
  const lons = stops.map(s => s.lon).join(',');
  const params = new URLSearchParams({
    latitude: lats, longitude: lons,
    hourly: 'temperature_2m,precipitation,weather_code,wind_speed_10m',
    timezone: 'auto', forecast_days: 7, models: model
  });
  const r = await fetch(`${API.forecast}?${params}`);
  if (!r.ok) throw new Error('Échec multi-point météo');
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}
