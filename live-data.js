/**
 * Browser-side adapters for public data services.
 * Place search is explicitly submitted (never search-as-you-type). Public demo
 * endpoints can be throttled; production deployments should use an owned proxy
 * with caching and configurable providers.
 */
export const DEFAULT_LOCATION = Object.freeze({
  name: 'Bengaluru city centre',
  displayName: 'Bengaluru, Karnataka, India',
  lat: 12.9716,
  lon: 77.5946,
  selected: false,
  provider: 'initial map view'
});

export function buildPlaceSearchUrl(query, bias = null) {
  const clean = String(query || '').trim();
  if (clean.length < 2) throw new Error('Enter at least two characters to search for a place.');
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', clean);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'en');
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
    url.searchParams.set('lat', String(bias.lat));
    url.searchParams.set('lon', String(bias.lon));
    url.searchParams.set('zoom', '10');
  }
  return url.toString();
}

function nonEmpty(parts) {
  return parts.filter(part => typeof part === 'string' && part.trim()).filter((part, index, all) => all.indexOf(part) === index);
}

export function normalizePlaceFeature(feature, index = 0) {
  const coordinates = feature?.geometry?.coordinates;
  const properties = feature?.properties || {};
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const address = nonEmpty([
    properties.name, properties.housenumber && properties.street ? `${properties.housenumber} ${properties.street}` : properties.street,
    properties.district, properties.city, properties.state, properties.country
  ]).join(', ');
  const name = properties.name || properties.city || properties.state || address || `Search result ${index + 1}`;
  return {
    id: String(feature.id || properties.osm_id || `${lat.toFixed(5)},${lon.toFixed(5)}:${index}`),
    name,
    city: properties.city || properties.district || properties.state || properties.country || name,
    displayName: address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat, lon,
    provider: 'OpenStreetMap data via Photon geocoder',
    selected: true
  };
}

function browserPlaceSearchUrl(query, bias = null) {
  const url = new URL('/api/place-search', window.location.origin);
  url.searchParams.set('q', String(query || '').trim());
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
    url.searchParams.set('lat', String(bias.lat));
    url.searchParams.set('lon', String(bias.lon));
  }
  return url.toString();
}

function browserDataUrl(path, lat, lon) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  return url.toString();
}

export async function searchPlaces(query, { fetchImpl = globalThis.fetch, bias = null, signal } = {}) {
  const queryUrl = typeof window !== 'undefined' ? browserPlaceSearchUrl(query, bias) : buildPlaceSearchUrl(query, bias);
  const response = await fetchImpl(queryUrl, { signal, headers: { Accept: 'application/geo+json, application/json' } });
  if (!response.ok) throw new Error(`Place search service returned HTTP ${response.status}.`);
  const payload = await response.json();
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return features.map(normalizePlaceFeature).filter(Boolean);
}

export function buildWeatherUrl(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation');
  url.searchParams.set('hourly', 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation');
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '2');
  return url.toString();
}

export function buildAirQualityUrl(lat, lon) {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'pm2_5,pm10,us_aqi,european_aqi');
  url.searchParams.set('hourly', 'pm2_5,pm10,us_aqi');
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('domains', 'cams_global');
  return url.toString();
}

async function requestJson(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Data service returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('Data service returned an invalid response.');
  return payload;
}

export function formatProviderTime(time, utcOffsetSeconds = 0) {
  if (!time) return 'Not supplied';
  // Open-Meteo returns local wall-clock time when timezone=auto and provides
  // utc_offset_seconds separately; convert it without relying on browser TZ.
  const match = String(time).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return String(time);
  const [, y, mo, d, h, mi, sec = '0'] = match;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) - Number(utcOffsetSeconds || 0) * 1000;
  return new Date(utc).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function sourceFreshness(modelTime, utcOffsetSeconds = 0, nowMs = Date.now()) {
  if (!modelTime) return { status: 'missing', ageMinutes: null };
  const formatted = formatProviderTime(modelTime, utcOffsetSeconds);
  const timestamp = Date.parse(formatted.replace(' UTC', 'Z').replace(' ', 'T'));
  if (!Number.isFinite(timestamp)) return { status: 'missing', ageMinutes: null };
  const ageMinutes = Math.max(0, (nowMs - timestamp) / 60000);
  return { status: ageMinutes <= 90 ? 'current' : ageMinutes <= 240 ? 'delayed' : 'stale', ageMinutes };
}

export function parseHourly(payload, keys) {
  const h = payload?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const offset = payload.utc_offset_seconds || 0;
  return h.time.map((time, i) => {
    const row = { time, utcMs: Date.parse(formatProviderTime(time, offset).replace(' UTC', 'Z').replace(' ', 'T')) };
    for (const key of keys) row[key] = numberOrNull(h[key]?.[i]);
    return row;
  });
}

/** Index of the hourly row closest to `nowMs + offsetHours`. */
export function hourlyIndexAt(rows, nowMs, offsetHours = 0) {
  if (!Array.isArray(rows) || !rows.length) return -1;
  const target = nowMs + offsetHours * 3600000;
  let best = 0, bestDiff = Infinity;
  rows.forEach((row, i) => { const d = Math.abs(row.utcMs - target); if (d < bestDiff) { best = i; bestDiff = d; } });
  return best;
}

export function weatherAtOffset(weather, offsetHours, nowMs = Date.now()) {
  if (!weather) return null;
  if (!offsetHours || !weather.hourly?.length) return weather;
  const row = weather.hourly[hourlyIndexAt(weather.hourly, nowMs, offsetHours)];
  if (!row) return weather;
  return { ...weather, windSpeedMs: row.wind_speed_10m ?? weather.windSpeedMs, windDirectionDeg: row.wind_direction_10m ?? weather.windDirectionDeg, temperatureC: row.temperature_2m ?? weather.temperatureC, precipitationMm: row.precipitation ?? weather.precipitationMm, displayTime: formatProviderTime(row.time, weather.utcOffsetSeconds), offsetHours };
}

export function airAtOffset(air, offsetHours, nowMs = Date.now()) {
  if (!air) return null;
  if (!offsetHours || !air.hourly?.length) return air;
  const row = air.hourly[hourlyIndexAt(air.hourly, nowMs, offsetHours)];
  if (!row) return air;
  return { ...air, pm25: row.pm2_5 ?? air.pm25, pm10: row.pm10 ?? air.pm10, usAqi: row.us_aqi ?? air.usAqi, displayTime: formatProviderTime(row.time, air.utcOffsetSeconds), offsetHours };
}

export async function fetchSensors(location, { fetchImpl = globalThis.fetch, signal } = {}) {
  const url = typeof window !== 'undefined' ? browserDataUrl('/api/sensors', location.lat, location.lon) : null;
  if (!url) throw new Error('Sensor adapter requires the Urban-VentAI backend.');
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 503 && body.sourceStatus === 'not-configured') return { status: 'not-configured', sensors: [], message: body.error };
  if (!response.ok) throw new Error(body.error || `Sensor service returned HTTP ${response.status}.`);
  const sensors = (body.sensors || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Number.isFinite(s.value));
  return { status: sensors.length ? 'connected' : 'no-coverage', sensors, fetchedAt: body.fetchedAt, radiusMeters: body.radiusMeters, source: body.source };
}

export function sensorsToGeoJson(sensors, nowMs = Date.now()) {
  return { type: 'FeatureCollection', features: (sensors || []).map(s => {
    const ageMin = s.observedAtUtc ? Math.max(0, (nowMs - Date.parse(s.observedAtUtc)) / 60000) : null;
    return { type: 'Feature', properties: { name: s.name, value: s.value, unit: s.unit, observedAtUtc: s.observedAtUtc, ageMinutes: ageMin, provider: s.provider, stale: ageMin === null || ageMin > 180 }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } };
  }) };
}

export async function reverseGeocode(lat, lon, { fetchImpl = globalThis.fetch, signal } = {}) {
  const url = typeof window !== 'undefined' ? browserDataUrl('/api/reverse-geocode', lat, lon) : null;
  if (!url) return null;
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const payload = await response.json();
  const feature = (payload?.features || [])[0];
  const place = feature ? normalizePlaceFeature(feature) : null;
  return place ? { name: place.name, displayName: place.displayName, city: place.city } : null;
}

export async function fetchCurrentEnvironment(location, { fetchImpl = globalThis.fetch, signal, now = () => new Date() } = {}) {
  const requestedAt = now().toISOString();
  const weatherUrl = typeof window !== 'undefined' ? browserDataUrl('/api/weather', location.lat, location.lon) : buildWeatherUrl(location.lat, location.lon);
  const airUrl = typeof window !== 'undefined' ? browserDataUrl('/api/air-quality', location.lat, location.lon) : buildAirQualityUrl(location.lat, location.lon);
  const [weatherResult, airResult] = await Promise.allSettled([
    requestJson(weatherUrl, fetchImpl, signal),
    requestJson(airUrl, fetchImpl, signal)
  ]);
  const fetchedAt = now().toISOString();
  const result = { location: { ...location }, requestedAt, fetchedAt, weather: null, air: null, errors: {} };
  if (weatherResult.status === 'fulfilled') {
    const payload = weatherResult.value;
    if (!payload.current) result.errors.weather = 'No current weather fields were returned.';
    else {
      const freshness = sourceFreshness(payload.current.time, payload.utc_offset_seconds);
      result.weather = {
        source: 'Open-Meteo weather model', modelTime: payload.current.time,
        displayTime: formatProviderTime(payload.current.time, payload.utc_offset_seconds),
        timezone: payload.timezone || 'Not supplied', utcOffsetSeconds: payload.utc_offset_seconds || 0,
        freshness: freshness.status, ageMinutes: freshness.ageMinutes,
        temperatureC: numberOrNull(payload.current.temperature_2m),
        relativeHumidity: numberOrNull(payload.current.relative_humidity_2m),
        windSpeedMs: numberOrNull(payload.current.wind_speed_10m),
        windDirectionDeg: numberOrNull(payload.current.wind_direction_10m),
        precipitationMm: numberOrNull(payload.current.precipitation),
        units: payload.current_units || {},
        hourly: parseHourly(payload, ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'precipitation'])
      };
    }
  } else result.errors.weather = cleanError(weatherResult.reason);
  if (airResult.status === 'fulfilled') {
    const payload = airResult.value;
    if (!payload.current) result.errors.air = 'No current air-quality model fields were returned.';
    else {
      const freshness = sourceFreshness(payload.current.time, payload.utc_offset_seconds);
      result.air = {
        source: 'Open-Meteo / CAMS global air-quality model', modelTime: payload.current.time,
        displayTime: formatProviderTime(payload.current.time, payload.utc_offset_seconds),
        timezone: payload.timezone || 'Not supplied', freshness: freshness.status, ageMinutes: freshness.ageMinutes,
        pm25: numberOrNull(payload.current.pm2_5), pm10: numberOrNull(payload.current.pm10),
        usAqi: numberOrNull(payload.current.us_aqi), europeanAqi: numberOrNull(payload.current.european_aqi),
        units: payload.current_units || {}, domain: 'cams_global', spatialResolutionKm: 45,
        interpretation: 'Regional model estimate, not a local monitor reading.',
        utcOffsetSeconds: payload.utc_offset_seconds || 0,
        hourly: parseHourly(payload, ['pm2_5', 'pm10', 'us_aqi'])
      };
    }
  } else result.errors.air = cleanError(airResult.reason);
  return result;
}

export function buildWindResponsiveField(location, weather, air, gridCount = 7) {
  // This is a visualization proxy ONLY. It is not a pollutant transport solver
  // and must never be labelled as observed concentration or a validated index.
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return { type: 'FeatureCollection', features: [] };
  const dir = weather && Number.isFinite(weather.windDirectionDeg) ? (weather.windDirectionDeg + 180) % 360 : 0;
  const radians = dir * Math.PI / 180;
  const windSpeed = weather && Number.isFinite(weather.windSpeedMs) ? weather.windSpeedMs : 0;
  const regionalPm = air && Number.isFinite(air.pm25) ? air.pm25 : null;
  const latMeters = 111320;
  const lonMeters = 111320 * Math.cos(location.lat * Math.PI / 180);
  const features = [];
  const spacing = 105;
  const half = spacing / 2;
  const originX = (gridCount - 1) / 2;
  const originY = (gridCount - 1) / 2;
  for (let row = 0; row < gridCount; row++) {
    for (let col = 0; col < gridCount; col++) {
      const east = (col - originX) * spacing;
      const north = (originY - row) * spacing;
      const along = east * Math.sin(radians) + north * Math.cos(radians);
      const cross = east * Math.cos(radians) - north * Math.sin(radians);
      const spread = 100 + Math.max(0, along) * 0.36;
      const core = Math.exp(-(cross * cross) / (2 * spread * spread));
      const downwind = Math.max(0, Math.min(1, (along + 150) / 420));
      const stagnation = 0.45 + Math.max(0, 1.8 - windSpeed) * 0.28;
      const intensity = Math.max(0.03, Math.min(1, core * downwind * stagnation));
      const centerLat = location.lat + north / latMeters;
      const centerLon = location.lon + east / Math.max(1, lonMeters);
      const dLat = half / latMeters;
      const dLon = half / Math.max(1, lonMeters);
      const concentrationScale = regionalPm === null ? 0.7 : Math.max(0.45, Math.min(1.25, regionalPm / 35));
      features.push({
        type: 'Feature',
        properties: {
          intensity: Number(intensity.toFixed(3)),
          heightMeters: Number((5 + intensity * 24 * concentrationScale).toFixed(2)),
          visualizationOnly: true,
          regionalPm25: regionalPm,
          row, col
        },
        geometry: { type: 'Polygon', coordinates: [[
          [centerLon - dLon, centerLat - dLat], [centerLon + dLon, centerLat - dLat],
          [centerLon + dLon, centerLat + dLat], [centerLon - dLon, centerLat + dLat],
          [centerLon - dLon, centerLat - dLat]
        ]] }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function buildDownwindParticles(location, weather, count = 35, phase = 0) {
  if (!location) return { type: 'FeatureCollection', features: [] };
  const direction = (((weather?.windDirectionDeg ?? 0) + 180) % 360) * Math.PI / 180;
  const speed = Math.max(0.3, Math.min(12, weather?.windSpeedMs ?? 0.5));
  const features = [];
  const mPerLon = Math.max(1, 111320 * Math.cos(location.lat * Math.PI / 180));
  for (let i = 0; i < count; i++) {
    const progress = ((i / count + phase * (0.015 + speed * 0.001)) % 1);
    const distance = 35 + progress * (150 + speed * 55);
    const lateral = Math.sin(i * 12.9898 + phase * 0.3) * (16 + progress * 58);
    const east = Math.sin(direction) * distance + Math.cos(direction) * lateral;
    const north = Math.cos(direction) * distance - Math.sin(direction) * lateral;
    features.push({ type: 'Feature', properties: { progress }, geometry: { type: 'Point', coordinates: [location.lon + east / mPerLon, location.lat + north / 111320] } });
  }
  return { type: 'FeatureCollection', features };
}

function numberOrNull(value) { const n = Number(value); return value === null || value === undefined || !Number.isFinite(n) ? null : n; }
function cleanError(error) { return error instanceof Error ? error.message : 'Request failed or was blocked by the browser/network.'; }
