import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon'
};
const cache = new Map();
const CACHE_MS = 2 * 60 * 1000;

function send(res, status, payload, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': type.startsWith('application/json') ? 'no-store' : 'no-cache',
    ...extraHeaders
  });
  res.end(payload);
}
function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8', headers);
}
function parseCoordinates(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_MS) { cache.delete(key); return null; }
  return entry.value;
}
function setCache(key, value) {
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}
async function providerJson(url, fetchImpl, cacheKey, extraHeaders = {}) {
  const cached = getCache(cacheKey);
  if (cached) return { payload: cached, cached: true };
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Urban-VentAI-prototype/0.3 (municipal pollution intelligence demo)', ...extraHeaders },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Upstream provider returned HTTP ${response.status}.`);
  const payload = await response.json();
  setCache(cacheKey, payload);
  return { payload, cached: false };
}

export function createAppServer({ fetchImpl = globalThis.fetch, root = ROOT, env = process.env } = {}) {
  return http.createServer(async (req, res) => {
    const base = `http://${req.headers.host || 'localhost'}`;
    let url;
    try { url = new URL(req.url || '/', base); }
    catch { sendJson(res, 400, { error: 'Invalid request URL.' }); return; }

    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      sendJson(res, 405, { error: 'Only GET and HEAD are supported.' }, { Allow: 'GET, HEAD' });
      return;
    }

    try {
      if (url.pathname === '/api/health') {
        sendJson(res, 200, { status: 'ok', service: 'urban-ventai', externalProviders: ['Photon geocoder', 'Open-Meteo weather model', 'Open-Meteo/CAMS regional air-quality model', (env.OPENAQ_API_KEY || '').trim() ? 'OpenAQ ground sensors (configured)' : 'OpenAQ ground sensors (not configured)'], note: 'Health status reports this backend only; it does not certify upstream freshness or dispersion-model availability.' });
        return;
      }

      if (url.pathname === '/api/place-search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (q.length < 2 || q.length > 160) { sendJson(res, 400, { error: 'Place query must contain 2–160 characters.' }); return; }
        const target = new URL('https://photon.komoot.io/api/');
        target.searchParams.set('q', q);
        target.searchParams.set('limit', '6');
        target.searchParams.set('lang', 'en');
        const bias = parseCoordinates(url);
        if (bias) { target.searchParams.set('lat', String(bias.lat)); target.searchParams.set('lon', String(bias.lon)); target.searchParams.set('zoom', '10'); }
        const { payload, cached } = await providerJson(target, fetchImpl, `photon:${target}`);
        sendJson(res, 200, payload, { 'X-Urban-VentAI-Cache': cached ? 'HIT' : 'MISS' });
        return;
      }

      if (url.pathname === '/api/weather' || url.pathname === '/api/air-quality') {
        const coordinates = parseCoordinates(url);
        if (!coordinates) { sendJson(res, 400, { error: 'Valid latitude (-90..90) and longitude (-180..180) are required.' }); return; }
        const isWeather = url.pathname === '/api/weather';
        const target = new URL(isWeather ? 'https://api.open-meteo.com/v1/forecast' : 'https://air-quality-api.open-meteo.com/v1/air-quality');
        target.searchParams.set('latitude', String(coordinates.lat));
        target.searchParams.set('longitude', String(coordinates.lon));
        target.searchParams.set('timezone', 'auto');
        if (isWeather) {
          target.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation');
          target.searchParams.set('hourly', 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation');
          target.searchParams.set('wind_speed_unit', 'ms');
          target.searchParams.set('past_days', '1');
          target.searchParams.set('forecast_days', '2');
        } else {
          target.searchParams.set('current', 'pm2_5,pm10,us_aqi,european_aqi');
          target.searchParams.set('hourly', 'pm2_5,pm10,us_aqi');
          target.searchParams.set('past_days', '1');
          target.searchParams.set('forecast_days', '2');
          target.searchParams.set('domains', 'cams_global');
        }
        const { payload, cached } = await providerJson(target, fetchImpl, `${url.pathname}:${target}`);
        sendJson(res, 200, payload, { 'X-Urban-VentAI-Cache': cached ? 'HIT' : 'MISS' });
        return;
      }

      if (url.pathname === '/api/reverse-geocode') {
        const coordinates = parseCoordinates(url);
        if (!coordinates) { sendJson(res, 400, { error: 'Valid latitude (-90..90) and longitude (-180..180) are required.' }); return; }
        const target = new URL('https://photon.komoot.io/reverse');
        target.searchParams.set('lat', coordinates.lat.toFixed(5));
        target.searchParams.set('lon', coordinates.lon.toFixed(5));
        target.searchParams.set('lang', 'en');
        const { payload, cached } = await providerJson(target, fetchImpl, `reverse:${target}`);
        sendJson(res, 200, payload, { 'X-Urban-VentAI-Cache': cached ? 'HIT' : 'MISS' });
        return;
      }

      if (url.pathname === '/api/sensors') {
        const coordinates = parseCoordinates(url);
        if (!coordinates) { sendJson(res, 400, { error: 'Valid latitude (-90..90) and longitude (-180..180) are required.' }); return; }
        const apiKey = (env.OPENAQ_API_KEY || '').trim();
        if (!apiKey) {
          sendJson(res, 503, { error: 'OpenAQ is not configured on this server. Set OPENAQ_API_KEY to enable ground-sensor observations.', sourceStatus: 'not-configured', note: 'No sensor value was substituted or fabricated.' });
          return;
        }
        const radius = Math.min(25000, Math.max(1000, Number(url.searchParams.get('radius')) || 25000));
        const base = (env.OPENAQ_API_BASE_URL || 'https://api.openaq.org').replace(/\/+$/, '');
        const headers = { 'X-API-Key': apiKey };
        const coord = `${coordinates.lat.toFixed(5)},${coordinates.lon.toFixed(5)}`;
        const locTarget = new URL(`${base}/v3/locations`);
        locTarget.searchParams.set('coordinates', coord);
        locTarget.searchParams.set('radius', String(radius));
        locTarget.searchParams.set('parameters_id', '2');
        locTarget.searchParams.set('limit', '20');
        const latestTarget = new URL(`${base}/v3/parameters/2/latest`);
        latestTarget.searchParams.set('coordinates', coord);
        latestTarget.searchParams.set('radius', String(radius));
        latestTarget.searchParams.set('limit', '100');
        const cacheKey = `openaq:${coord}:${radius}`;
        const cached = getCache(cacheKey);
        if (cached) { sendJson(res, 200, cached, { 'X-Urban-VentAI-Cache': 'HIT' }); return; }
        const [locations, latest] = await Promise.all([
          providerJson(locTarget, fetchImpl, `${cacheKey}:loc`, headers),
          providerJson(latestTarget, fetchImpl, `${cacheKey}:latest`, headers)
        ]);
        const byLocation = new Map((locations.payload.results || []).map(l => [l.id, l]));
        const sensors = [];
        for (const row of latest.payload.results || []) {
          const loc = byLocation.get(row.locationsId);
          const point = row.coordinates || loc?.coordinates;
          const value = Number(row.value);
          if (!point || !Number.isFinite(value) || value < 0) continue;
          sensors.push({
            locationId: row.locationsId, sensorId: row.sensorsId,
            name: loc?.name || `OpenAQ location ${row.locationsId}`,
            provider: loc?.provider?.name || 'OpenAQ', lat: Number(point.latitude), lon: Number(point.longitude),
            parameter: 'pm25', value, unit: 'µg/m³',
            observedAtUtc: row.datetime?.utc || null, observedAtLocal: row.datetime?.local || null
          });
        }
        const body = { source: 'OpenAQ v3', fetchedAt: new Date().toISOString(), radiusMeters: radius, sensors };
        setCache(cacheKey, body);
        sendJson(res, 200, body, { 'X-Urban-VentAI-Cache': 'MISS' });
        return;
      }

      if (url.pathname.startsWith('/api/')) { sendJson(res, 404, { error: 'Unknown API endpoint.' }); return; }

      let pathname;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { sendJson(res, 400, { error: 'Invalid path.' }); return; }
      if (pathname.includes('\0') || pathname.split('/').some(part => part === '..')) { sendJson(res, 400, { error: 'Invalid path.' }); return; }
      let targetPath = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (targetPath !== root && !targetPath.startsWith(root + path.sep)) { sendJson(res, 403, { error: 'Path is outside the application directory.' }); return; }
      let data;
      try { data = await readFile(targetPath); }
      catch { send(res, 404, 'Not found.', 'text/plain; charset=utf-8'); return; }
      const type = CONTENT_TYPES[path.extname(targetPath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'External data provider timed out.' : (error?.message || 'External data provider request failed.');
      sendJson(res, 502, { error: message, sourceStatus: 'failed', note: 'No environmental value was substituted or fabricated.' });
    }
  });
}

function loadDotEnv() {
  try {
    for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env is optional */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadDotEnv();
  const server = createAppServer();
  server.listen(PORT, '0.0.0.0', () => console.log(`Urban-VentAI listening on http://localhost:${PORT}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
