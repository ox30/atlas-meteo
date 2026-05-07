// Atlas Météo — tile + data proxy (Worker v2)
// =============================================================================
// Cloudflare Worker that fronts two upstream weather services:
//
//   1. OpenWeatherMap tile endpoints (clouds_new etc.)
//      Hides the OWM_API_KEY, caches at edge, fail-soft on errors.
//
//   2. Open-Meteo forecast endpoint (heatmap data only)
//      Mutualises rate-limit cost across users. Shared edge cache means
//      that 10 users hitting the same (lat, lon, day, variable) → 1 actual
//      Open-Meteo call. The basic weather queries (city/route forecast,
//      geocoding) still call api.open-meteo.com directly from the browser
//      so a heatmap-induced rate-limit on the Worker IP doesn't break the
//      rest of the app.
//
// Routes
//   GET  /owm/{layer}/{z}/{x}/{y}.png   → OWM Maps 1.0 tile
//   GET  /openmeteo/forecast?...        → Open-Meteo forecast proxy
//   GET  /health                        → "ok"
//   *                                   → 404
//
// Env vars (Cloudflare dashboard → Worker → Settings → Variables):
//   OWM_API_KEY              secret, the OpenWeatherMap appid
//   ALLOWED_ORIGIN           default "*"
//   CACHE_TTL_SECONDS        OWM tiles, default 1800 (30 min)
//   OPENMETEO_TTL_SECONDS    Open-Meteo, default 3600 (1 h)
// =============================================================================

const ALLOWED_OWM_LAYERS = new Set([
  'clouds_new',
  'precipitation_new',
  'pressure_new',
  'wind_new',
  'temp_new',
]);

// Whitelist of params we forward to api.open-meteo.com. Anything else gets
// silently dropped — prevents the proxy being abused for other endpoints
// or with parameters we haven't validated.
const OM_ALLOWED_PARAMS = new Set([
  'latitude',
  'longitude',
  'hourly',
  'daily',
  'current',
  'models',
  'start_date',
  'end_date',
  'past_days',
  'forecast_days',
  'timezone',
  'temperature_unit',
  'wind_speed_unit',
  'precipitation_unit',
  'cell_selection',
]);

const OM_MAX_URL_LENGTH = 8000;   // safe under common GET-URL limits

// 1×1 fully transparent PNG for OWM fail-soft (existing behaviour, untouched).
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
  0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]);

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || '*';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin) },
      });
    }

    // OWM tile route (unchanged from v1)
    const owmMatch = url.pathname.match(/^\/owm\/([a-z0-9_]+)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/);
    if (owmMatch) {
      return handleOwmTile(owmMatch, url, env, ctx, origin);
    }

    // Open-Meteo forecast proxy (new in v2)
    if (url.pathname === '/openmeteo/forecast') {
      return handleOpenMeteo(url, env, ctx, origin);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  },
};

// =============================================================================
// OWM tile handler (verbatim from v1, factored into a function)
// =============================================================================

async function handleOwmTile(match, url, env, ctx, origin) {
  const ttl = parseInt(env.CACHE_TTL_SECONDS || '1800', 10);
  const [, layer, z, x, y] = match;

  if (!ALLOWED_OWM_LAYERS.has(layer)) {
    return new Response('Layer not allowed', { status: 400, headers: corsHeaders(origin) });
  }
  const zNum = parseInt(z, 10), xNum = parseInt(x, 10), yNum = parseInt(y, 10);
  if (zNum < 0 || zNum > 12 || xNum < 0 || yNum < 0) {
    return new Response('Bad tile coords', { status: 400, headers: corsHeaders(origin) });
  }
  if (!env.OWM_API_KEY) {
    return owmFailSoft('OWM_API_KEY not configured', origin);
  }

  const cache    = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached   = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Atlas-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const upstreamUrl = `https://tile.openweathermap.org/map/${layer}/${zNum}/${xNum}/${yNum}.png?appid=${env.OWM_API_KEY}`;
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { cf: { cacheTtl: ttl, cacheEverything: true } });
  } catch (e) {
    return owmFailSoft('Upstream fetch failed: ' + e.message, origin);
  }
  if (!upstream.ok) {
    return owmFailSoft('Upstream status: ' + upstream.status, origin);
  }

  const buf = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set('Content-Type',  'image/png');
  headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  headers.set('X-Atlas-Cache', 'MISS');
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));

  const response = new Response(buf, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function owmFailSoft(reason, origin) {
  const headers = new Headers();
  headers.set('Content-Type',  'image/png');
  headers.set('Cache-Control', 'public, max-age=60');
  headers.set('X-Atlas-Cache', 'FAIL');
  headers.set('X-Atlas-Error', reason);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
  return new Response(TRANSPARENT_PNG, { status: 200, headers });
}

// =============================================================================
// Open-Meteo forecast handler (new in v2)
// =============================================================================

async function handleOpenMeteo(url, env, ctx, origin) {
  const ttl = parseInt(env.OPENMETEO_TTL_SECONDS || '3600', 10);

  // Filter incoming params through the allowlist + sort for a stable cache
  // key (so requests with same params in different orders share cache).
  const allowed = new URLSearchParams();
  const keys = [];
  for (const k of url.searchParams.keys()) keys.push(k);
  keys.sort();
  for (const k of [...new Set(keys)]) {
    if (!OM_ALLOWED_PARAMS.has(k)) continue;
    for (const v of url.searchParams.getAll(k)) allowed.append(k, v);
  }

  if (!allowed.has('latitude') || !allowed.has('longitude')) {
    return new Response(
      JSON.stringify({ error: true, reason: 'Missing latitude/longitude' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  }

  const upstreamUrl = `https://api.open-meteo.com/v1/forecast?${allowed.toString()}`;
  if (upstreamUrl.length > OM_MAX_URL_LENGTH) {
    return new Response(
      JSON.stringify({ error: true, reason: 'Too many points in one request' }),
      { status: 414, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  }

  // Cache lookup keyed by the *normalized* (filtered + sorted) URL so the
  // hit rate is maximized regardless of how the client orders params.
  const cacheUrl = new URL(url.toString());
  cacheUrl.search = allowed.toString();
  const cache    = caches.default;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cached   = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Atlas-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  // Upstream fetch
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { cf: { cacheTtl: ttl, cacheEverything: true } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: true, reason: 'Upstream fetch failed: ' + e.message }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  }

  // Read full body so we can inspect it (Open-Meteo signals rate limits as
  // HTTP 200 with `{"error":true,"reason":"..."}`, NOT a 4xx). We must NOT
  // cache those — otherwise we'd serve a stale rate-limit error for an hour.
  const buf  = await upstream.arrayBuffer();
  const text = new TextDecoder().decode(buf);
  let isOMError = false;
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.error === true) isOMError = true;
  } catch { /* not JSON, treat as success */ }

  // Pass through real HTTP errors as-is, no caching
  if (!upstream.ok) {
    const headers = new Headers();
    headers.set('Content-Type',  upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Atlas-Cache', 'MISS-HTTP-ERROR');
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
    return new Response(buf, { status: upstream.status, headers });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));

  if (isOMError) {
    // Open-Meteo logical error (rate limit etc.) — do NOT cache, return as-is
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Atlas-Cache', 'MISS-RATELIMIT');
    return new Response(buf, { status: 200, headers });
  }

  // Successful payload — cache aggressively
  headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  headers.set('X-Atlas-Cache', 'MISS');
  const response = new Response(buf, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// =============================================================================
// Shared CORS helper
// =============================================================================

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age':       '86400',
  };
}
