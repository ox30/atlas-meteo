// Atlas Météo — tile proxy
// =============================================================================
// Cloudflare Worker that fronts OpenWeatherMap tile endpoints.
// - Hides the OWM_API_KEY from the client.
// - Caches tiles at the edge (Cloudflare Cache API) for CACHE_TTL_SECONDS.
// - Fail-soft: returns a transparent 1×1 PNG with HTTP 200 on upstream errors,
//   so Leaflet doesn't render broken tiles or retry forever.
// - Allowlist of layers prevents the proxy being abused as a generic OWM relay.
//
// Routes
//   GET  /owm/{layer}/{z}/{x}/{y}.png   → OpenWeatherMap Maps 1.0 tile
//   GET  /health                        → "ok"
//   *                                   → 404
//
// Required environment variables (set via Cloudflare dashboard or wrangler):
//   OWM_API_KEY           secret, the OpenWeatherMap appid
//
// Optional environment variables:
//   ALLOWED_ORIGIN        default "*" — set to "https://ox30.github.io" to lock down
//   CACHE_TTL_SECONDS     default 1800 (30 min)
// =============================================================================

const ALLOWED_OWM_LAYERS = new Set([
  'clouds_new',
  'precipitation_new',
  'pressure_new',
  'wind_new',
  'temp_new',
]);

// 1×1 fully transparent PNG (67 bytes). Used for fail-soft responses so
// Leaflet treats failing tiles as "empty" rather than "broken".
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
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || '*';
    const ttl = parseInt(env.CACHE_TTL_SECONDS || '1800', 10);

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

    // OWM tile route: /owm/{layer}/{z}/{x}/{y}.png
    const owmMatch = url.pathname.match(/^\/owm\/([a-z0-9_]+)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/);
    if (owmMatch) {
      const [, layer, z, x, y] = owmMatch;

      // Allowlist
      if (!ALLOWED_OWM_LAYERS.has(layer)) {
        return new Response('Layer not allowed', { status: 400, headers: corsHeaders(origin) });
      }

      // Sanity check tile coords (avoid garbage requests cached forever)
      const zNum = parseInt(z, 10);
      const xNum = parseInt(x, 10);
      const yNum = parseInt(y, 10);
      if (zNum < 0 || zNum > 12 || xNum < 0 || yNum < 0) {
        return new Response('Bad tile coords', { status: 400, headers: corsHeaders(origin) });
      }

      if (!env.OWM_API_KEY) {
        return failSoft('OWM_API_KEY not configured', origin);
      }

      // Cache lookup — keyed by the incoming (clean) URL, not the upstream URL
      // with the API key, so all clients share the same cache entry per tile.
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-Atlas-Cache', 'HIT');
        return new Response(cached.body, { status: cached.status, headers });
      }

      // Fetch upstream
      const upstreamUrl = `https://tile.openweathermap.org/map/${layer}/${zNum}/${xNum}/${yNum}.png?appid=${env.OWM_API_KEY}`;
      let upstream;
      try {
        upstream = await fetch(upstreamUrl, {
          cf: { cacheTtl: ttl, cacheEverything: true },
        });
      } catch (e) {
        return failSoft('Upstream fetch failed: ' + e.message, origin);
      }

      if (!upstream.ok) {
        return failSoft('Upstream status: ' + upstream.status, origin);
      }

      // Build a clean response with our own cache headers, strip anything
      // that might leak upstream identity.
      const buf = await upstream.arrayBuffer();
      const headers = new Headers();
      headers.set('Content-Type', 'image/png');
      headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
      headers.set('X-Atlas-Cache', 'MISS');
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));

      const response = new Response(buf, { status: 200, headers });

      // Persist in edge cache (don't block the response on this).
      ctx.waitUntil(cache.put(cacheKey, response.clone()));

      return response;
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function failSoft(reason, origin) {
  // Returns a transparent 1×1 PNG with HTTP 200 so Leaflet treats this tile
  // as "empty" rather than "broken". The reason is exposed in X-Atlas-Error
  // for debugging via the Network tab.
  const headers = new Headers();
  headers.set('Content-Type', 'image/png');
  headers.set('Cache-Control', 'public, max-age=60'); // short TTL so we recover fast
  headers.set('X-Atlas-Cache', 'FAIL');
  headers.set('X-Atlas-Error', reason);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
  return new Response(TRANSPARENT_PNG, { status: 200, headers });
}
