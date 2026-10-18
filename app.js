import {
  SOURCE_STATUSES, createInitialState, changeOperatingArea, canOpenValidComparison,
  canApproveForSubmission, canSubmitAction, canCloseCase, normalizeRunAttempt
} from './domain.js';
import { DEFAULT_LOCATION, searchPlaces, fetchCurrentEnvironment, buildWindResponsiveField, buildDownwindParticles, fetchSensors, sensorsToGeoJson, reverseGeocode, weatherAtOffset, airAtOffset, hourlyIndexAt } from './live-data.js';

const MAPLIBRE_VERSION = '5.23.0';

const state = createInitialState();
const root = document.getElementById('app');
const maps = new Map();
const maplibreMaps = new Map();
const mapViewCache = new Map();
let pendingMapCenter = null;
let resetMapViewBeforeRender = false;
const liveRuntime = { location: { ...DEFAULT_LOCATION }, query: '', searchResults: [], searching: false, weather: null, air: null, errors: {}, fetchedAt: null, fetching: false, fetchKey: null, lastSearchError: null, statusMessage: '', refreshedTimerStarted: false, hourOffset: 0, sensors: { status: 'idle', sensors: [], message: '' } };
try {
  const savedLocation = JSON.parse(localStorage.getItem('urban-ventai-selected-place') || 'null');
  if (savedLocation && Number.isFinite(Number(savedLocation.lat)) && Number.isFinite(Number(savedLocation.lon)) && Math.abs(Number(savedLocation.lat)) <= 90 && Math.abs(Number(savedLocation.lon)) <= 180) {
    liveRuntime.location = { ...DEFAULT_LOCATION, ...savedLocation, lat: Number(savedLocation.lat), lon: Number(savedLocation.lon), selected: true };
    state.area = { ...state.area, city: savedLocation.city || savedLocation.displayName || savedLocation.name || state.area.city, ward: savedLocation.ward || `${savedLocation.name || 'Saved place'} • Search location`, locationName: savedLocation.name || 'Saved place', displayName: savedLocation.displayName || savedLocation.name || 'Saved place', lat: Number(savedLocation.lat), lon: Number(savedLocation.lon), hasBeenSaved: true };
  }
} catch { /* private browsing or malformed stored state should not block startup */ }
let particleTimer = null;
let liveRefreshTimer = null;
let ageTimer = null;
let areaReturnScreen = null;
let toastTimer = null;
let toastMessage = null;
let toastKind = 'info';

const NAV = [
  { id: 'S02', label: 'Command', glyph: '⌂' },
  { id: 'S03', label: 'Live 3D', glyph: '◉' },
  { id: 'S04', label: 'Hotspots', glyph: '⌖' },
  { id: 'S07', label: 'Scenario', glyph: '◇' },
  { id: 'S12', label: 'Actions', glyph: '▣' },
  { id: 'REPORTS', label: 'Reports', glyph: '▤' },
  { id: 'SOURCES', label: 'Sources', glyph: '≋' }
];

const SCREEN_TITLES = {
  S01: ['OPERATING CONTEXT', 'Choose your monitoring area'],
  S02: ['MUNICIPAL COMMAND CENTRE', 'Operational context'],
  S03: ['IMMERSIVE 3D ANALYSIS', 'Street-level dispersion view'],
  S04: ['S04 • HOTSPOT REVIEW', 'Hotspot investigation'],
  S05: ['S05 • EVIDENCE REVIEW', 'Contributing-factor investigation'],
  S06: ['S06 • SHARED DATA HEALTH', 'Input health and calculation readiness'],
  S07: ['S07 • INTERVENTION SELECTION', 'Select a municipal response'],
  S08A: ['S08A • TRAFFIC ORCHESTRATION', 'Configure a corridor diversion'],
  S08B: ['S08B • GREEN INFRASTRUCTURE', 'Compare candidate sites'],
  S08C: ['S08C • CONSTRUCTION / ZONING', 'Preview the proposed building'],
  S09: ['S09 • SCENARIO SYSTEM STATE', 'Scenario calculation'],
  S10: ['S10 • BASELINE VS INTERVENTION', 'Compare the spatial pattern'],
  S11: ['S11 • HUMAN REVIEW', 'Review the proposed municipal action'],
  S12: ['S12 • ACTION PACKAGE', 'Prepare a municipal action record'],
  REPORT: ['S12 • REPORT PREVIEW', 'Review the evidence packet'],
  S13: ['S13 • FOLLOW-UP', 'Verify subsequent conditions'],
  S13CLOSED: ['S13 • CLOSED STATE EXAMPLE', 'Case closure example']
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function attr(value) { return esc(value).replace(/\n/g, '&#10;'); }
function btn(label, action, variant = 'secondary', opts = {}) {
  const disabled = opts.disabled ? ' disabled aria-disabled="true"' : '';
  const title = opts.title ? ` title="${attr(opts.title)}"` : '';
  const extra = (opts.extra || '').replace(/type=\"submit\"/g, '');
  const buttonType = (opts.extra || '').includes('type=\"submit\"') ? 'submit' : 'button';
  return `<button type="${buttonType}" class="btn btn-${variant} ${opts.className || ''}" data-action="${attr(action)}" ${extra}${title}${disabled}>${label}</button>`;
}
function status(label, type = 'neutral') { return `<span class="status ${type}"><span class="dot"></span>${esc(label)}</span>`; }
function pageHeader(eyebrow, title, desc, right = '') {
  return `<div class="page-header"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${right ? `<div>${right}</div>` : ''}</div>`;
}
function card(title, body, right = '') {
  return `<section class="card"><div class="card-header"><h2>${title}</h2>${right}</div><div class="card-body">${body}</div></section>`;
}
function notice(title, body, type = '') {
  return `<div class="notice ${type}"><div class="notice-icon">${type === 'red' ? '!' : type === 'green' ? '✓' : type === 'blue' ? 'i' : '!'}</div><div><strong>${esc(title)}</strong>${body}</div></div>`;
}
function currentArea() { return `${state.area.city} / ${state.area.ward.replace(' • Illustrative district', '')}`; }
function hotspotLabel() { return state.hotspot ? state.hotspot.label : 'No hotspot selected'; }
function currentBranchLabel() {
  return ({ A: 'Traffic orchestration', B: 'Green infrastructure', C: 'Construction / zoning' })[state.intervention.branch] || 'No intervention selected';
}
function screenTitle(id) { return SCREEN_TITLES[id] || ['URBAN-VENTAI', 'Municipal workflow']; }

function effWeather() { return weatherAtOffset(liveRuntime.weather, liveRuntime.hourOffset); }
function effAir() { return airAtOffset(liveRuntime.air, liveRuntime.hourOffset); }
function uses3D() { return state.visualization.viewMode === '3D' && (state.screen === 'S02' || state.screen === 'S03'); }
function current3DId() { return state.screen === 'S02' ? 'maplibre-command' : state.screen === 'S03' ? 'maplibre-main' : null; }
function distanceKm(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function ageText(iso) {
  if (!iso) return 'not fetched yet';
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 1 ? 'fetched just now' : min < 60 ? `fetched ${min} min ago` : `fetched ${Math.round(min / 6) / 10} h ago`;
}
function renderSensorSummary() {
  const s = liveRuntime.sensors;
  if (s.status === 'not-configured') return 'Ground sensors: OpenAQ not configured on the server (set OPENAQ_API_KEY).';
  if (s.status === 'error') return `Ground sensors unavailable: ${s.message}`;
  if (s.status === 'no-coverage') return 'Ground sensors: no OpenAQ PM₂.₅ stations found within 25 km.';
  if (s.status === 'connected' && s.sensors.length) {
    const near = s.sensors.map(x => ({ ...x, km: distanceKm(liveRuntime.location.lat, liveRuntime.location.lon, x.lat, x.lon) })).sort((a, b) => a.km - b.km)[0];
    const age = near.observedAtUtc ? Math.round((Date.now() - Date.parse(near.observedAtUtc)) / 60000) : null;
    return `Ground sensors: ${s.sensors.length} OpenAQ PM₂.₅ stations ≤25 km. Nearest ${near.name} (${near.km.toFixed(1)} km): ${fmtNum(near.value, 1)} μg/m³${age === null ? '' : `, observed ${age < 60 ? age + ' min' : Math.round(age / 6) / 10 + ' h'} ago`}.`;
  }
  return liveRuntime.fetching ? 'Ground sensors: loading…' : 'Ground sensors: not requested yet.';
}
function renderTrendChart() {
  const air = liveRuntime.air?.hourly || [], wx = liveRuntime.weather?.hourly || [];
  const base = air.length > 2 ? air : wx;
  if (base.length < 3) return '';
  const W = 250, H = 62, P = 4, now = Date.now();
  const line = (rows, key) => {
    const vals = rows.map(r => r[key]); const ok = vals.filter(Number.isFinite);
    if (ok.length < 2) return '';
    const min = Math.min(...ok), span = (Math.max(...ok) - min) || 1;
    const pts = vals.map((v, i) => Number.isFinite(v) ? `${(P + i * (W - 2 * P) / (vals.length - 1)).toFixed(1)} ${(H - P - (v - min) / span * (H - 2 * P)).toFixed(1)}` : null).filter(Boolean);
    return pts.length > 1 ? `M${pts.join(' L')}` : '';
  };
  const x = (rows, off) => (P + hourlyIndexAt(rows, now, off) * (W - 2 * P) / (rows.length - 1)).toFixed(1);
  return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="48-hour model series: PM2.5 (orange) and wind speed (blue)"><rect width="${W}" height="${H}" fill="#f4f8fa" rx="5"/><path d="${line(air, 'pm2_5')}" fill="none" stroke="#e0763f" stroke-width="1.8"/><path d="${line(wx, 'wind_speed_10m')}" fill="none" stroke="#237bb0" stroke-width="1.5" stroke-dasharray="4 3"/><line x1="${x(base, 0)}" x2="${x(base, 0)}" y1="0" y2="${H}" stroke="#12a894" stroke-width="1.2"/>${liveRuntime.hourOffset ? `<line x1="${x(base, liveRuntime.hourOffset)}" x2="${x(base, liveRuntime.hourOffset)}" y1="0" y2="${H}" stroke="#6554be" stroke-width="1.6"/>` : ''}</svg><div class="tiny muted">Model series −24 h … +24 h · <span style="color:#e0763f">PM₂.₅ (CAMS)</span> · <span style="color:#237bb0">wind speed</span> · green = now${liveRuntime.hourOffset ? ' · purple = selected hour' : ''}</div>`;
}
function renderHourSlider() {
  const off = liveRuntime.hourOffset;
  const disabled = !(liveRuntime.weather?.hourly?.length || liveRuntime.air?.hourly?.length);
  return `<div class="hour-slider"><label for="hour-offset"><strong>Model hour:</strong> <span data-hour-label>${off === 0 ? 'now' : (off > 0 ? '+' : '') + off + ' h'}</span></label><input id="hour-offset" data-hour-slider type="range" min="-24" max="24" step="1" value="${off}" ${disabled ? 'disabled' : ''}/><div class="tiny muted">${off === 0 ? 'Current model conditions' : off < 0 ? 'Past model series (hindcast), not observations' : 'Model forecast'}</div></div>`;
}
function mapCenterLatLng() { return [liveRuntime.location.lat, liveRuntime.location.lon]; }
function renderGlobalLiveStatus() {
  if (liveRuntime.weather || liveRuntime.air) return '<span class="pill live-model">MODEL INPUTS LOADED • NOT SENSOR DATA</span>';
  if (liveRuntime.fetching) return '<span class="pill demo">CONNECTING TO MODEL PROVIDERS</span>';
  return '<span class="pill demo">MODEL INPUTS UNAVAILABLE</span>';
}
function renderShortLiveSummary() {
  const bits = [];
  const w = effWeather(), a = effAir();
  if (w) bits.push(`Wind ${fmtNum(w.windSpeedMs, 1)} m/s from ${fmtNum(w.windDirectionDeg, 0)}°`);
  if (a) bits.push(`regional model PM₂.₅ ${fmtNum(a.pm25, 1)} μg/m³`);
  if (!bits.length) return liveRuntime.fetching ? 'Loading current model inputs…' : 'Live weather/AQ model data is not available in this browser session.';
  return bits.join(' · ');
}
function fmtNum(n, digits = 1) { return n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits); }
function renderLiveValues() {
  const rw = liveRuntime.weather, ra = liveRuntime.air, w = effWeather(), a = effAir();
  const weatherStatus = rw?.freshness || 'missing';
  const airStatus = ra?.freshness || 'missing';
  const when = liveRuntime.hourOffset ? ` (${liveRuntime.hourOffset > 0 ? 'forecast +' : 'model −'}${Math.abs(liveRuntime.hourOffset)} h)` : '';
  return `<strong>WEATHER MODEL ${esc(String(weatherStatus).toUpperCase())}${esc(when)}</strong><br/><span>${esc(liveRuntime.location.name)}</span><br/>${w ? `Wind <b>${fmtNum(w.windSpeedMs,1)} m/s</b> · from ${fmtNum(w.windDirectionDeg,0)}° (blows toward ${fmtNum((w.windDirectionDeg + 180) % 360,0)}°)<br/>Temperature ${fmtNum(w.temperatureC,1)} °C${w.relativeHumidity === undefined || w.offsetHours ? '' : ` · RH ${fmtNum(w.relativeHumidity,0)}%`}<br/><small>Model valid time: ${esc(w.displayTime)}</small>` : `Weather model unavailable: ${esc(liveRuntime.errors.weather || 'no response')}`}<hr/><strong>REGIONAL AIR-QUALITY MODEL ${esc(String(airStatus).toUpperCase())}</strong><br/>${a ? `PM₂.₅ <b>${fmtNum(a.pm25,1)} μg/m³</b> · PM₁₀ ${fmtNum(a.pm10,1)} μg/m³<br/>US AQI ${fmtNum(a.usAqi,0)}${a.offsetHours ? '' : ` · EU AQI ${fmtNum(a.europeanAqi,0)}`}<br/><small>CAMS global model • ~${a.spatialResolutionKm} km grid<br/>Model valid time: ${esc(a.displayTime)}</small>` : `Air-quality model unavailable: ${esc(liveRuntime.errors.air || 'no response')}`}<hr/><small>${esc(renderSensorSummary())}</small>`;
}
function renderLiveWeatherCard() {
  if (!liveRuntime.weather && !liveRuntime.air) return `<div class="map-weather" id="live-card"><strong>${liveRuntime.fetching ? 'CONNECTING TO MODEL PROVIDERS' : 'MODEL INPUTS UNAVAILABLE'}</strong><br/>${esc(liveRuntime.lastSearchError || liveRuntime.errors.weather || liveRuntime.errors.air || 'Search a place or refresh to request current public model data.')}<br/><button class="btn btn-link btn-sm" data-action="refresh-live-data">Retry model-input refresh →</button></div>`;
  return `<div class="map-weather live-weather-card" id="live-card"><div id="live-values">${renderLiveValues()}</div><hr/>${renderHourSlider()}<div id="trend-holder">${renderTrendChart()}</div><small data-live-age>${esc(ageText(liveRuntime.fetchedAt))} · auto-refresh every 5 min</small><br/><button class="btn btn-link btn-sm" data-action="refresh-live-data">↻ Refresh now</button> <button class="btn btn-link btn-sm" data-action="open-health">Inspect source status →</button></div>`;
}
function renderPlaceSearch() {
  const results = liveRuntime.searchResults || [];
  return `<section class="place-search" aria-label="Search real-world map locations"><form id="place-search-form" class="place-search-form"><label class="visually-hidden" for="place-query">Place, address or landmark</label><input id="place-query" name="q" type="search" minlength="2" maxlength="160" autocomplete="off" placeholder="Search a place, address or landmark…" value="${attr(liveRuntime.query)}" required/><button class="btn btn-primary btn-sm" type="submit" ${liveRuntime.searching?'disabled':''}>${liveRuntime.searching?'Searching…':'Search'}</button></form><div class="place-search-caption">Real geography • OpenStreetMap-based search • explicit search only (no auto-query)</div>${liveRuntime.lastSearchError ? `<div class="place-search-error" role="alert">${esc(liveRuntime.lastSearchError)}</div>` : ''}${results.length ? `<div class="place-results" role="list" aria-label="Place search results">${results.map((r,i)=>`<button type="button" data-action="choose-place:${i}" class="place-result" role="listitem"><strong>${esc(r.name)}</strong><span>${esc(r.displayName)}</span></button>`).join('')}</div>` : ''}${liveRuntime.location.selected ? `<div class="place-current">MAP FOCUSED ON <strong>${esc(liveRuntime.location.displayName)}</strong></div>` : ''}</section>`;
}
function updateSourceFromLiveData() {
  const now = new Date().toISOString();
  if (liveRuntime.weather) {
    const w = liveRuntime.weather;
    state.sources.weather = { ...state.sources.weather, status: w.freshness, source: w.source, observationTime: `Model valid time: ${w.displayTime}`, refreshTime: liveRuntime.fetchedAt || now, coverage: `Open-Meteo model at selected coordinates; not a station observation. ${w.timezone || ''}`, affects: 'Wind-vector display and weather-responsive visualization only; not a validated local dispersion run.' };
  } else if (liveRuntime.errors.weather) {
    state.sources.weather = { ...state.sources.weather, status: 'failed', source: 'Open-Meteo request failed', observationTime: 'Not supplied', refreshTime: liveRuntime.fetchedAt || now, coverage: liveRuntime.errors.weather };
  }
  if (liveRuntime.air) {
    const a = liveRuntime.air;
    state.sources.air = { ...state.sources.air, label: 'Regional air-quality model estimates (not observations)', status: a.freshness, source: a.source, observationTime: `Model valid time: ${a.displayTime}`, refreshTime: liveRuntime.fetchedAt || now, coverage: `CAMS global model grid, approximately ${a.spatialResolutionKm} km. No street-level sensor coverage is asserted.`, affects: 'Regional context only; not local baseline qualification, source attribution or post-action verification.' };
  } else if (liveRuntime.errors.air) {
    state.sources.air = { ...state.sources.air, label: 'Regional air-quality model estimates (not observations)', status: 'failed', source: 'Open-Meteo / CAMS request failed', observationTime: 'Not supplied', refreshTime: liveRuntime.fetchedAt || now, coverage: liveRuntime.errors.air };
  }
  const sn = liveRuntime.sensors;
  if (sn.status === 'connected' && sn.sensors.length) {
    const newest = sn.sensors.map(x => Date.parse(x.observedAtUtc)).filter(Number.isFinite).sort((x, y) => y - x)[0];
    const ageMin = Number.isFinite(newest) ? (Date.now() - newest) / 60000 : null;
    state.sources.sensors = { ...state.sources.sensors, status: ageMin === null ? 'missing' : ageMin <= 90 ? 'current' : ageMin <= 240 ? 'delayed' : 'stale', source: 'OpenAQ v3 (ground-sensor PM₂.₅)', observationTime: newest ? `Newest station reading: ${new Date(newest).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}` : 'Not supplied', refreshTime: sn.fetchedAt || now, coverage: `${sn.sensors.length} PM₂.₅ stations within ${Math.round((sn.radiusMeters || 25000) / 1000)} km. Station quality/calibration is the provider's; not a hotspot validation.`, affects: 'Observed regional context and evidence review; does not by itself qualify a hotspot or source.' };
  } else if (sn.status === 'no-coverage') {
    state.sources.sensors = { ...state.sources.sensors, status: 'missing', source: 'OpenAQ v3', coverage: 'No PM₂.₅ stations within 25 km of this location.', refreshTime: sn.fetchedAt || now };
  } else if (sn.status === 'error') {
    state.sources.sensors = { ...state.sources.sensors, status: 'failed', source: 'OpenAQ request failed', coverage: sn.message || 'Request failed', refreshTime: now };
  } else if (sn.status === 'not-configured') {
    state.sources.sensors = { ...state.sources.sensors, status: 'missing', source: 'OpenAQ not configured (OPENAQ_API_KEY)', coverage: 'Server has no OpenAQ API key; no ground observations are shown.' };
  }
}
async function ensureLiveEnvironment(force = false) {
  if (!['S02','S03','S04','S06'].includes(state.screen)) return;
  const key = `${liveRuntime.location.lat.toFixed(5)},${liveRuntime.location.lon.toFixed(5)}`;
  const previousAge = liveRuntime.fetchedAt ? Date.now() - Date.parse(liveRuntime.fetchedAt) : Infinity;
  if (!force && liveRuntime.fetchKey === key && (liveRuntime.fetching || previousAge < 5 * 60 * 1000)) return;
  liveRuntime.fetching = true;
  liveRuntime.fetchKey = key;
  liveRuntime.lastSearchError = null;
  let refreshView = false;
  try {
    const [response, sensorResult] = await Promise.all([
      fetchCurrentEnvironment(liveRuntime.location),
      fetchSensors(liveRuntime.location).catch(error => ({ status: 'error', sensors: [], message: error?.message || 'Sensor request failed' }))
    ]);
    const currentKey = `${liveRuntime.location.lat.toFixed(5)},${liveRuntime.location.lon.toFixed(5)}`;
    if (liveRuntime.fetchKey !== key || currentKey !== key) return; // ignore out-of-order responses after a location change
    liveRuntime.weather = response.weather;
    liveRuntime.air = response.air;
    liveRuntime.errors = response.errors || {};
    liveRuntime.sensors = sensorResult;
    liveRuntime.fetchedAt = response.fetchedAt;
    updateSourceFromLiveData();
    refreshView = true;
  } catch (error) {
    const currentKey = `${liveRuntime.location.lat.toFixed(5)},${liveRuntime.location.lon.toFixed(5)}`;
    if (liveRuntime.fetchKey !== key || currentKey !== key) return;
    liveRuntime.errors = { weather: error?.message || 'Unknown request failure', air: error?.message || 'Unknown request failure' };
    liveRuntime.fetchedAt = new Date().toISOString();
    updateSourceFromLiveData();
    refreshView = true;
  } finally {
    if (liveRuntime.fetchKey === key) liveRuntime.fetching = false;
  }
  if (refreshView && ['S02','S03','S06','S04'].includes(state.screen)) {
    if (uses3D() && maplibreMaps.get(current3DId())) refreshLiveInPlace();
    else render();
  }
}
/** Update overlays and panels without destroying the 3D map camera. */
function refreshLiveInPlace() {
  const map = maplibreMaps.get(current3DId());
  if (map && map.isStyleLoaded?.() !== false) { try { update3DSources(map); } catch { /* sources may not exist yet */ } }
  const card = document.getElementById('live-card');
  if (card) card.outerHTML = renderLiveWeatherCard();
  const hot = document.querySelector('.map-hotspot-card');
  if (hot) hot.outerHTML = renderHotspotCard();
  const side = document.getElementById('s02-side');
  if (side) side.innerHTML = renderS02Side();
  const slot = document.getElementById('live-status-slot');
  if (slot) slot.innerHTML = renderGlobalLiveStatus();
  const area = document.querySelector('.top-area');
  if (area) area.textContent = `${currentArea()} ▾`;
  ensureParticleTimer();
}
function update3DSources(map) {
  const w = effWeather(), a = effAir(), loc = liveRuntime.location;
  const set = (id, data) => { const src = map.getSource(id); if (src) src.setData(data); };
  set('wind-field-source', buildWindResponsiveField(loc, w, a));
  set('wind-plume-source', add3DWindEnvelope(loc, w));
  set('wind-vector-source', add3DWindVector(loc, w));
  set('wind-particles-source', buildDownwindParticles(loc, w, 42, 0));
  set('connected-sensors-source', sensorsToGeoJson(liveRuntime.sensors.sensors));
  set('place-focus-source', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { label: loc.name }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }] });
  apply3DLayerVisibility(map);
}
function ensureParticleTimer() {
  const want = uses3D() && state.visualization.particles && !state.visualization.paused && Boolean(liveRuntime.weather);
  if (!want) { if (particleTimer) { clearInterval(particleTimer); particleTimer = null; } return; }
  if (particleTimer) return;
  let phase = 0;
  particleTimer = setInterval(() => {
    if (!uses3D() || state.visualization.paused || !state.visualization.particles) return;
    const src = maplibreMaps.get(current3DId())?.getSource('wind-particles-source');
    if (src) src.setData(buildDownwindParticles(liveRuntime.location, effWeather(), 42, ++phase));
  }, 500);
}
function startPeriodicRefresh() {
  if (liveRefreshTimer) return;
  // Open-Meteo "current" values advance every 15 min; poll every 5 min (server caches 2 min).
  liveRefreshTimer = setInterval(() => {
    if (!document.hidden && ['S02','S03'].includes(state.screen)) ensureLiveEnvironment(true);
  }, 5 * 60 * 1000);
  ageTimer = setInterval(() => {
    document.querySelectorAll('[data-live-age]').forEach(el => { el.textContent = `${ageText(liveRuntime.fetchedAt)} · auto-refresh every 5 min`; });
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !['S02','S03'].includes(state.screen)) return;
    const age = liveRuntime.fetchedAt ? Date.now() - Date.parse(liveRuntime.fetchedAt) : Infinity;
    if (age > 5 * 60 * 1000) ensureLiveEnvironment(true);
  });
}
async function submitPlaceSearch(form) {
  const input = form.querySelector('[name="q"]');
  liveRuntime.query = String(input?.value || '').trim();
  if (liveRuntime.query.length < 2) { liveRuntime.lastSearchError = 'Enter a place name, address or landmark (at least two characters).'; render(); return; }
  liveRuntime.searching = true; liveRuntime.searchResults = []; liveRuntime.lastSearchError = null; render();
  try {
    liveRuntime.searchResults = await searchPlaces(liveRuntime.query, { bias: liveRuntime.location });
    if (!liveRuntime.searchResults.length) liveRuntime.lastSearchError = 'No places matched that search. Try a nearby landmark, area, city or full address.';
  } catch (error) {
    liveRuntime.lastSearchError = `${error?.message || 'Place search failed.'} Check internet access or configure a production geocoding provider.`;
  } finally { liveRuntime.searching = false; render(); }
}
function selectPlace(index) {
  const place = liveRuntime.searchResults[index];
  if (!place) { showToast('That search result is no longer available. Search again.','warn'); return; }
  commitLocation(place);
}
function locateMe() {
  if (!navigator.geolocation) { showToast('Geolocation is not available in this browser.','warn'); return; }
  showToast('Requesting your device location…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    let info = null;
    try { info = await reverseGeocode(lat, lon); } catch { /* name lookup is optional */ }
    commitLocation({ id: `gps-${lat.toFixed(4)}-${lon.toFixed(4)}`, name: info?.name || 'My location', city: info?.city || 'My location', displayName: info?.displayName || `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon, provider: `Device geolocation (±${Math.round(accuracy)} m)`, selected: true });
  }, error => showToast(`Could not read device location: ${error.message}`,'warn'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}
function commitLocation(place) {
  const city = place.city || place.name || 'Selected map location';
  const ward = `${place.name} • Search location`;
  Object.assign(state, changeOperatingArea(state, city, ward));
  state.area = { ...state.area, id: `searched-${place.id}`, city, ward, locationName: place.name, displayName: place.displayName, lat: place.lat, lon: place.lon, illustrative: true, hasBeenSaved: true };
  state.hotspot = null;
  state.evidence.qualified = false;
  state.scenarioRun = { status:'not-calculated', isIllustrative:false, validated:false, runId:null, error:null, branch:null };
  state.visualization.viewMode = '3D';
  liveRuntime.location = { ...place, selected: true };
  resetMapViewBeforeRender = true;
  state.sources.weather = { ...SOURCE_STATUSES.weather };
  state.sources.air = { ...SOURCE_STATUSES.air };
  liveRuntime.weather = null; liveRuntime.air = null; liveRuntime.errors = {}; liveRuntime.fetchedAt = null; liveRuntime.fetchKey = null; liveRuntime.sensors = { status: 'idle', sensors: [], message: '' };
  liveRuntime.searchResults = []; liveRuntime.lastSearchError = null; liveRuntime.query = place.name;
  try { localStorage.setItem('urban-ventai-selected-place', JSON.stringify({ ...liveRuntime.location, city, ward })); } catch { /* local persistence is optional */ }
  showToast(`Map moved to ${place.displayName}. Fetching location-specific model inputs; this does not identify a pollution source.`, 'info');
  render();
}
function addWeatherFieldToLeaflet(map, {mode = 'main'} = {}) {
  if (!liveRuntime.weather && !liveRuntime.air) return;
  const ew = effWeather(), ea = effAir();
  const geo = buildWindResponsiveField(liveRuntime.location, ew, ea);
  if (state.visualization.cells && geo.features.length) {
    window.L.geoJSON(geo, { style: feature => {
      const intensity = feature?.properties?.intensity || 0;
      const color = intensity > .72 ? '#d9574c' : intensity > .48 ? '#ee9c45' : intensity > .24 ? '#d8c85f' : '#50b6bb';
      return { color, weight: .4, opacity: .45, fillColor: color, fillOpacity: .47 };
    }, onEachFeature: (feature, layer) => layer.bindTooltip(`Weather-responsive visual intensity: ${Math.round((feature.properties.intensity || 0)*100)}% • visualization only, not concentration`) }).addTo(map);
  }
  if (state.visualization.plume) {
    const envelope=add3DWindEnvelope(liveRuntime.location,ew);
    window.L.geoJSON(envelope,{style:{color:'#e66b45',weight:1.5,opacity:.65,fillColor:'#ee8050',fillOpacity:.18},onEachFeature:(_,layer)=>layer.bindTooltip('Weather-responsive plume envelope • shape is a visualization proxy, not a calibrated dispersion model')}).addTo(map);
  }
  if (state.visualization.wind && ew) {
    const start=mapCenterLatLng();
    const toward=((ew.windDirectionDeg || 0)+180)%360*Math.PI/180;
    const distance=Math.max(.002,Math.min(.012,.0025+(ew.windSpeedMs||0)*.001));
    const end=[start[0]+Math.cos(toward)*distance,start[1]+Math.sin(toward)*distance/Math.max(.2,Math.cos(start[0]*Math.PI/180))];
    window.L.polyline([start,end],{color:'#237bb0',weight:3,dashArray:'7 5',opacity:.9}).addTo(map)
      .bindTooltip(`Open-Meteo wind model: ${fmtNum(ew.windSpeedMs,1)} m/s; direction from ${fmtNum(ew.windDirectionDeg,0)}°; arrow points downwind.`);
  }
}
function addSensorMarkersLeaflet(map) {
  if (!state.visualization.sensors) return;
  const now = Date.now();
  for (const sensor of liveRuntime.sensors.sensors || []) {
    const age = sensor.observedAtUtc ? Math.round((now - Date.parse(sensor.observedAtUtc)) / 60000) : null;
    window.L.circleMarker([sensor.lat, sensor.lon], { radius: 8, color: '#fff', weight: 2, fillColor: age === null || age > 180 ? '#9aa6b1' : '#7965d8', fillOpacity: .95 }).addTo(map)
      .bindPopup(sensorPopupHtml(sensor, age));
  }
}
function sensorPopupHtml(sensor, age) {
  return `<strong>${esc(sensor.name)}</strong><br/>PM₂.₅ <b>${fmtNum(sensor.value,1)} ${esc(sensor.unit || 'μg/m³')}</b><br/><small>${esc(sensor.provider || 'OpenAQ')} · observed ${age === null || age === undefined ? 'time not supplied' : age < 60 ? age + ' min ago' : Math.round(age / 6) / 10 + ' h ago'}${age > 180 ? ' · STALE' : ''}<br/>Ground observation, not a hotspot validation.</small>`;
}
function addMapLocationMarker(map) {
  const L = window.L;
  L.circleMarker(mapCenterLatLng(), {radius:7, color:'#fff', weight:2, fillColor:'#0d9c89', fillOpacity:.95}).addTo(map)
    .bindPopup(`<strong>${esc(liveRuntime.location.name)}</strong><br/>${esc(liveRuntime.location.displayName)}<br/><small>Map location only; not a detected pollution hotspot.</small>`);
}
function add3DWindEnvelope(location, weather) {
  if (!location) return { type:'FeatureCollection', features:[] };
  const dir = ((weather?.windDirectionDeg ?? 0) + 180) * Math.PI / 180;
  const mLat = 111320, mLon = Math.max(1,111320*Math.cos(location.lat*Math.PI/180));
  const l= Math.max(180,Math.min(650,180 + (weather?.windSpeedMs || 0)*35));
  const w= Math.max(70,Math.min(210,70 + (weather?.windSpeedMs || 0)*10));
  const ux=Math.sin(dir), uy=Math.cos(dir), px=uy, py=-ux;
  const offsets=[[0,0],[ux*l*.35+px*w,uy*l*.35+py*w],[ux*l+px*w*1.5,uy*l+py*w*1.5],[ux*l+px*w*-1.5,uy*l+py*w*-1.5],[ux*l*.35+px*w*-1,uy*l*.35+py*w*-1],[0,0]];
  const coords=offsets.map(([east,north])=>[location.lon+east/mLon,location.lat+north/mLat]);
  return {type:'FeatureCollection',features:[{type:'Feature',properties:{visualizationOnly:true},geometry:{type:'Polygon',coordinates:[coords]}}]};
}
function add3DWindVector(location, weather) {
  if (!location || !weather) return {type:'FeatureCollection',features:[]};
  const direction=((weather.windDirectionDeg ?? 0)+180)*Math.PI/180;
  const distance=350+Math.max(0,weather.windSpeedMs || 0)*70;
  const mLon=Math.max(1,111320*Math.cos(location.lat*Math.PI/180));
  return {type:'FeatureCollection',features:[{type:'Feature',properties:{speed:weather.windSpeedMs,direction:weather.windDirectionDeg},geometry:{type:'LineString',coordinates:[[location.lon,location.lat],[location.lon+Math.sin(direction)*distance/mLon,location.lat+Math.cos(direction)*distance/111320]]}}]};
}
function apply3DLayerVisibility(map) {
  const v=state.visualization;
  const visibility = (id, on) => { if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',on?'visible':'none'); };
  visibility('wind-field-extrusions',v.cells);
  visibility('wind-plume-envelope',v.plume);
  visibility('wind-particles-live',v.particles && !v.paused && Boolean(liveRuntime.weather));
  visibility('wind-vector-line',v.wind);
  visibility('connected-sensor-points',v.sensors); // empty until a real station adapter is configured
  visibility('urban-buildings-3d',v.geometry);
  const layers = map.getStyle()?.layers || [];
  for (const layer of layers) {
    if (layer.id === 'urban-buildings-3d') continue;
    const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
    const id = String(layer.id || '').toLowerCase();
    if (/building|transportation|road/.test(`${sourceLayer} ${id}`)) {
      try { map.setLayoutProperty(layer.id,'visibility',v.geometry?'visible':'none'); } catch { /* optional style layers */ }
    }
  }
}

function captureMapViewsBeforeRender() {
  for (const [id, map] of maps.entries()) {
    try {
      const center = map.getCenter();
      mapViewCache.set(id, { center: [center.lng, center.lat], zoom: map.getZoom(), mode: '2D' });
    } catch { /* map may be in teardown */ }
  }
  for (const [id, map] of maplibreMaps.entries()) {
    try {
      const center = map.getCenter();
      mapViewCache.set(id, { center: [center.lng, center.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), mode: '3D' });
    } catch { /* map may be in teardown */ }
  }
  if (pendingMapCenter) {
    const activeId = state.screen === 'S02' ? (state.visualization.viewMode === '3D' ? 'maplibre-command' : 'leaflet-command') : state.screen === 'S03' ? (state.visualization.viewMode === '3D' ? 'maplibre-main' : 'leaflet-main') : state.screen === 'S04' ? 'leaflet-hotspot' : null;
    const prior = activeId ? mapViewCache.get(activeId) : null;
    if (activeId) mapViewCache.set(activeId, { ...(prior || { zoom: state.screen === 'S02' ? 14 : 15 }), center: pendingMapCenter, mode: activeId?.startsWith('maplibre') ? '3D' : '2D' });
    pendingMapCenter = null;
  }
}

function render() {
  if (resetMapViewBeforeRender) { mapViewCache.clear(); resetMapViewBeforeRender = false; }
  else captureMapViewsBeforeRender();
  if (particleTimer) { clearInterval(particleTimer); particleTimer = null; }
  for (const map of maps.values()) {
    try { map.remove(); } catch { /* map may already have been removed */ }
  }
  maps.clear();
  for (const map of maplibreMaps.values()) { try { map.remove(); } catch { /* map may already be removed */ } }
  maplibreMaps.clear();
  const title = screenTitle(state.screen);
  const activeNav = state.screen === 'S01' ? 'S02' : state.screen === 'REPORT' ? 'REPORTS' : state.screen === 'S06' ? 'SOURCES' : state.screen.startsWith('S08') || state.screen === 'S09' || state.screen === 'S10' || state.screen === 'S11' ? 'S07' : state.screen === 'S13' || state.screen === 'S13CLOSED' ? 'S12' : state.screen;
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Primary navigation">
        <button class="brand-mark" data-action="go-command" aria-label="Urban-VentAI home">U<span>·</span></button>
        ${NAV.map(item => `<button class="nav-button ${activeNav === item.id ? 'active' : ''}" data-action="${item.id === 'REPORTS' ? 'open-report' : item.id === 'SOURCES' ? 'open-health' : `navigate:${item.id}`}" aria-label="${item.label}" ${activeNav === item.id ? 'aria-current="page"' : ''}><span class="nav-glyph">${item.glyph}</span><span>${item.label}</span></button>`).join('')}
        <div class="nav-bottom">LIVE MODEL INPUTS<br/>v0.3</div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div class="topbrand"><div class="brand-mark">U<span>·</span></div><div><div class="brand-name">URBAN-VENTAI</div><div class="brand-sub">MUNICIPAL POLLUTION INTELLIGENCE</div></div></div>
          <button class="top-area" data-action="change-area" title="Change operating area">${esc(currentArea())} ▾</button>
          <div class="top-time">TIME WINDOW <strong>${esc(state.timeWindow)}</strong></div>
          <span id="live-status-slot">${renderGlobalLiveStatus()}</span>
          <button class="pill health" data-action="open-health">Data health !</button>
          <div class="model-status">MODEL RUN<strong>${state.scenarioRun.status === 'completed' && state.scenarioRun.isIllustrative ? 'EXAMPLE ONLY' : 'NOT CALCULATED'}</strong></div>
          <button class="icon-btn" data-action="show-help" aria-label="Platform information" title="Platform information">i</button>
        </header>
        <section class="screen-root" id="screen-root" aria-label="${esc(title[1])}">${renderCurrentScreen()}</section>
      </main>
    </div>
    ${renderModal()}
    ${renderToast()}
  `;
  initMapsForScreen();
  if (['S02','S03'].includes(state.screen)) { ensureLiveEnvironment(); startPeriodicRefresh(); }
}

function renderCurrentScreen() {
  switch (state.screen) {
    case 'S01': return renderS01();
    case 'S02': return renderS02();
    case 'S03': return renderS03();
    case 'S04': return renderS04();
    case 'S05': return renderS05();
    case 'S06': return renderS06();
    case 'S07': return renderS07();
    case 'S08A': return renderS08A();
    case 'S08B': return renderS08B();
    case 'S08C': return renderS08C();
    case 'S09': return renderS09();
    case 'S10': return renderS10();
    case 'S11': return renderS11();
    case 'S12': return renderS12();
    case 'REPORT': return renderReportPreview();
    case 'S13': return renderS13();
    case 'S13CLOSED': return renderS13Closed();
    default: return renderS02();
  }
}

function renderS01() {
  const persisted = getPersistedArea();
  return `<div class="area-entry"><div class="area-modal">
    <div class="eyebrow">OPERATIONAL CONTEXT</div>
    <h1>Choose your monitoring area</h1>
    <p class="intro">Select the area to load the map-first command centre. Availability is shown only when supplied.</p>
    <div class="area-form">
      <div class="field"><label for="city-select">City</label><select id="city-select" data-area-select="city"><option value="${attr(state.area.city)}" selected>${esc(state.area.city)}</option></select><div class="field-help">Current map context only; municipality/ward boundaries are not connected.</div></div>
      <div class="field"><label for="ward-select">Ward / monitoring area</label><select id="ward-select" data-area-select="ward"><option value="${attr(state.area.ward)}" selected>${esc(state.area.ward)}</option></select><div class="field-help">Use real place search to set a geographic focus; official ward membership is not asserted.</div></div>
    </div>
    <div class="notice" style="margin-top:18px"><div class="notice-icon">!</div><div><strong>MAP / DATA STATUS: PLACE SEARCH + MODEL INPUTS</strong>Place search focuses the map. Regional weather/AQ model inputs are fetched when available; sensor observations, official ward coverage and dispersion results are not asserted.</div></div>
    ${persisted ? `<div class="area-last">LAST USED AREA · Saved in this browser: <strong>${esc(persisted.city)} / ${esc(persisted.ward)}</strong></div>` : `<div class="area-last">MAP LOCATION · ${esc(liveRuntime.location.displayName)} • You can search for any place after opening the command centre.</div>`}
    <div class="area-actions">${btn('Cancel', 'cancel-area')}${btn('Open Command Centre →', 'open-command', 'primary')}</div>
  </div></div>`;
}

function renderS02() {
  const is3D = state.visualization.viewMode === '3D';
  const mapId = is3D ? 'maplibre-command' : 'leaflet-command';
  return `<div class="command-layout">
    <div class="map-frame">${is3D ? `<div id="maplibre-command" class="leaflet-map maplibre-map command-map" aria-label="Interactive 3D map with building geometry"></div>` : `<div id="leaflet-command" class="leaflet-map command-map" aria-label="Interactive geographic map"></div>`}<div class="place-search-overlay">${renderPlaceSearch()}</div>
      <div class="map-top-controls"><button class="btn btn-secondary btn-sm" data-action="map-zoom-in" data-mapid="${mapId}" aria-label="Zoom in">＋</button><button class="btn btn-secondary btn-sm" data-action="map-zoom-out" data-mapid="${mapId}" aria-label="Zoom out">−</button><button class="btn btn-secondary btn-sm" data-action="map-reset" data-mapid="${mapId}">↻ Reset</button><button class="btn btn-secondary btn-sm" data-action="locate-me">◎ My location</button><button class="btn btn-secondary btn-sm" data-action="toggle-map-mode">${is3D ? 'Switch to 2D' : 'Switch to 3D'}</button></div>
      <div class="map-base-note"><strong>MAP BASE • CONTEXT ONLY</strong><br/>${is3D ? 'OpenFreeMap / OpenStreetMap vector tiles with 3D buildings.' : 'OpenStreetMap tiles.'} Click the map to choose an investigation point. No live hotspot-detection feed or official municipal ward boundaries are connected. The model-responsive overlay is a visualization proxy, not an observed pollution field.</div></div>
    <div id="s02-side" style="display:flex;flex-direction:column;gap:14px;min-width:0">${renderS02Side()}</div>
  </div>`;
}
function renderS02Metrics() {
  return `<div class="card metric-card"><div class="metric-kicker">Regional PM₂.₅ (CAMS model)</div><div class="metric-value">${fmtNum(effAir()?.pm25, 1)}<small style="font-size:11px"> μg/m³</small></div><div class="metric-note">Model estimate, ~45 km grid — not a monitor reading.</div></div>
        <div class="card metric-card"><div class="metric-kicker">Wind (weather model)</div><div class="metric-value" style="font-size:20px">${fmtNum(effWeather()?.windSpeedMs, 1)} m/s</div><div class="metric-note">From ${fmtNum(effWeather()?.windDirectionDeg, 0)}° · valid ${esc(effWeather()?.displayTime || '—')}</div></div>`;
}
function renderS02Side() {
  const haveHotspot = Boolean(state.hotspot);
  const loaded = liveRuntime.weather || liveRuntime.air;
  return `<div>${pageHeader('S02 • COMMAND CENTRE', 'Municipal command centre', 'Triage this operating area, inspect a selected location, or review input readiness.')}</div>
      ${notice(loaded ? 'MODEL INPUTS LOADED • DISPERSION NOT CALCULATED' : 'MAP READY • INPUTS NOT YET LOADED', `${esc(liveRuntime.location.displayName)} · ${esc(renderShortLiveSummary())} Weather and regional air-quality model inputs are fetched from public services; a validated street-canyon dispersion run is not available.`, 'blue')}
      <div class="grid two" id="s02-metrics">${renderS02Metrics()}</div>
      
      <div class="card"><div class="card-header"><h2>Live input timeline</h2>${status(loaded ? 'Model inputs loaded' : 'Loading / unavailable', loaded ? 'good' : 'missing')}</div><div class="card-body">${renderHourSlider()}<div id="trend-holder">${renderTrendChart() || '<div class="tiny muted">Hourly model series will appear once the providers respond.</div>'}</div><div class="tiny muted" data-live-age style="margin-top:6px">${esc(ageText(liveRuntime.fetchedAt))} · auto-refresh every 5 min</div><div class="tiny muted" style="margin-top:4px">${esc(renderSensorSummary())}</div></div></div>
      <div class="card"><div class="card-header"><h2>Current operating context</h2>${status('Live model inputs','good')}</div><div class="card-body">
        <div class="list-row"><div class="list-icon">⌖</div><div class="list-main"><strong>${esc(currentArea())}</strong><p>Geographic focus from place search / map click. Official ward membership is not asserted.</p></div></div>
        <div class="list-row"><div class="list-icon">▦</div><div class="list-main"><strong>${esc(hotspotLabel())}</strong><p>${haveHotspot ? 'User-selected location for investigation; this is not a detected pollution hotspot.' : 'No validated hotspot-detection feed is configured. Click the map to choose a location for evidence review.'}</p></div></div>
        <div class="action-row" style="margin-top:15px">${btn('Open Live 3D Map →','open-map','primary')}${btn('Inspect selected location →','inspect-hotspot','secondary',{disabled:!haveHotspot,title:haveHotspot?'Inspect the selected location and its evidence':'Click the map to select a location first'})}${btn('View Data Status','open-health')}</div>
      </div></div>
      <div class="screen-footer"><span>Operating area persists through the investigation. Area changes clear dependent hotspot and scenario state.</span><div class="action-row">${btn('Change Area','change-area','link')}</div></div>`;
}

function renderS03() {
  const v = state.visualization;
  const stateBanner = !v.cells ? 'INDEX CELLS HIDDEN • underlying map remains visible' : !v.plume ? 'VOLUMETRIC PLUME OFF • index cells remain visible' : v.particles ? 'PARTICLES ENABLED • weather-responsive visualization, not a scientific transport simulation' : v.paused ? 'VISUALISATION PAUSED • no live model is running' : (state.weatherStale || liveRuntime.weather?.freshness === 'stale') ? 'WEATHER INPUT STALE / UNAVAILABLE • output interpretation is affected' : '';
  return `<div class="map-screen ${v.geometry ? '' : 'geometry-off'} ${v.paused ? 'paused' : ''}">
    ${state.visualization.viewMode === '3D' ? `<div id="maplibre-main" class="leaflet-map maplibre-map" aria-label="Interactive 3D map with OpenStreetMap building geometry"></div>` : `<div id="leaflet-main" class="leaflet-map" aria-label="Interactive 2D Leaflet map"></div>`}
    <div class="place-search-overlay map-search-main">${renderPlaceSearch()}</div>
    <div class="map-label"><div class="eyebrow" style="margin-bottom:4px">S03 • INTERACTIVE MAP</div><strong>Street-level dispersion view</strong><span>${state.visualization.viewMode === '3D' ? 'MapLibre 3D building geometry' : 'Leaflet 2D map'} • ${esc(liveRuntime.location.displayName)}</span></div>
    <div class="map-top-controls">
      <button class="btn btn-secondary btn-sm" data-action="map-zoom-in" data-mapid="${state.visualization.viewMode === '3D' ? 'maplibre-main' : 'leaflet-main'}" aria-label="Zoom in">＋</button>
      <button class="btn btn-secondary btn-sm" data-action="map-zoom-out" data-mapid="${state.visualization.viewMode === '3D' ? 'maplibre-main' : 'leaflet-main'}" aria-label="Zoom out">−</button>
      <button class="btn btn-secondary btn-sm" data-action="map-reset" data-mapid="${state.visualization.viewMode === '3D' ? 'maplibre-main' : 'leaflet-main'}">↻ Reset</button>
      <button class="btn btn-secondary btn-sm" data-action="locate-me">◎ My location</button>
      <button class="btn btn-secondary btn-sm" data-action="toggle-map-mode">${state.visualization.viewMode === '3D' ? 'Switch to 2D' : 'Switch to 3D'}</button>
      <button class="btn btn-secondary btn-sm" data-action="toggle-legend">Legend</button>
      <select class="btn btn-secondary btn-sm" aria-label="Time window" data-bind="timeWindow" data-control="timewindow" style="max-width:190px"><option ${state.timeWindow==='Current model conditions'?'selected':''}>Current model conditions</option><option ${state.timeWindow==='Past 24 h (model series)'?'selected':''}>Past 24 h (model series)</option><option ${state.timeWindow==='Next 24 h (model forecast)'?'selected':''}>Next 24 h (model forecast)</option></select>
      <button class="btn btn-secondary btn-sm" data-action="refresh-live-data">↻ Refresh inputs</button>
      <button class="btn btn-secondary btn-sm" data-action="open-health">Data health</button>
    </div>
    ${stateBanner ? `<div class="map-state-banner">${esc(stateBanner)}</div>` : ''}
    ${renderLiveWeatherCard()}
    ${renderHotspotCard()}
    <aside class="map-controls-panel" aria-label="Visualization layers">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>VISUALISATION LAYERS</h3>${btn(v.controlsExpanded?'Collapse':'Expand', 'toggle-layer-controls','secondary',{className:'btn-sm'})}</div>
      ${renderLayerToggle('3D concentration-style cells','Wind-responsive visual proxy • not measured concentration','cells',v.cells)}
      ${renderLayerToggle('Wind-responsive plume','Direction follows current modelled wind • not a validated solver','plume',v.plume)}
      ${v.controlsExpanded ? renderLayerToggle('Particles','Optional • simulated prototype state','particles',v.particles) : ''}
      ${renderLayerToggle('Wind vectors',effWeather() ? `${fmtNum(effWeather().windSpeedMs,1)} m/s • ${fmtNum(effWeather().windDirectionDeg,0)}° from north` : 'Waiting for location-specific weather model','wind',v.wind)}
      ${renderLayerToggle('Sensor markers', liveRuntime.sensors.status === 'connected' ? `${liveRuntime.sensors.sensors.length} OpenAQ PM₂.₅ ground stations` : renderSensorSummary(), 'sensors', v.sensors)}
      ${renderLayerToggle('Buildings + streets','Live vector map geometry; height coverage varies','geometry',v.geometry)}
      <div class="action-row" style="margin-top:13px">${btn(v.particles?'Disable particles':'Enable particles','toggle-particles',v.particles?'primary':'secondary',{className:'btn-sm'})}${btn(v.plume?'Hide plume':'Show plume','toggle-plume','secondary',{className:'btn-sm'})}</div>
      <div class="action-row" style="margin-top:7px">${btn('Simulate stale-weather (QA)','weather-stale','amber',{className:'btn-sm'})}${btn('Inspect data health','open-health','secondary',{className:'btn-sm'})}</div>
      <div class="action-row" style="margin-top:7px">${btn(v.paused?'Resume visualisation':'Pause visualisation','toggle-pause','secondary',{className:'btn-wide'})}</div>
      ${!v.cells ? `<div class="notice" style="margin-top:10px"><div class="notice-icon">i</div><div><strong>Index cells hidden</strong>The underlying map remains visible. Restore cells to inspect the weather-responsive visualization proxy.</div></div>${btn('Restore index cells →','toggle-cells','primary',{className:'btn-wide'})}` : ''}
      ${v.cameraNote ? `<div class="notice blue" style="margin-top:10px"><div class="notice-icon">i</div><div><strong>Camera-control limitation</strong>Use MapLibre 3D mode for building extrusions, camera pitch and bearing. Leaflet mode remains a 2D geographic map.</div></div>` : ''}
      <div class="demo-cells-note">${state.visualization.viewMode === '3D' ? 'Buildings are rendered from OpenFreeMap / OpenStreetMap-based vector tiles where height attributes are available. The wind-shaped overlay is a visualization proxy, not a calibrated pollutant-dispersion calculation.' : '2D mode shows geography. The weather-responsive overlay remains a visualization proxy; it is not a measured concentration.'}</div>
    </aside>
    ${v.legend ? `<div class="map-legend"><strong>Pollution visualisation</strong><div class="tiny muted" style="margin-top:3px">Regional AQ estimates and live wind are shown separately from illustrative street-level visualisation</div><div class="legend-bar"></div><div class="legend-labels"><span>Lower relative index</span><span>Higher relative index</span></div><div class="tiny muted" style="margin-top:9px">No local readings or validated hyperlocal concentration are available. Cell extrusion height is visual-only.</div>${btn('Close legend','toggle-legend','link',{className:'btn-sm'})}</div>` : `<button class="map-mini-note" data-action="toggle-legend"><strong>POLLUTION VISUALISATION</strong><p>Illustrative spatial field • modelled index label only • no connected sensor readings.</p></button>`}
    <div class="map-footer">${liveRuntime.weather || liveRuntime.air ? 'CURRENT MODEL INPUTS • VISUAL FIELD IS NOT A VALIDATED STREET-LEVEL POLLUTION MODEL' : 'LIVE MAP GEOMETRY • SEARCH A PLACE TO LOAD LOCATION-SPECIFIC INPUTS'} • No validated PM₂.₅ claim</div>
  </div>`;
}
function renderHotspotCard() {
  return `<aside class="map-hotspot-card"><div class="eyebrow">${state.hotspot ? (state.hotspot.type === 'map-location' ? 'SELECTED INVESTIGATION LOCATION' : 'SELECTED HOTSPOT • DEMO') : 'MAP LOCATION / HOTSPOT STATUS'}</div><h3>${esc(state.hotspot?.label || liveRuntime.location.name)}</h3><div class="tiny muted">${esc(state.hotspot?.location || liveRuntime.location.displayName)}</div><div class="section-label">STREET-LEVEL DISPERSION INDEX</div><div class="detail-number">Not calculated</div><div class="detail-caption">No calibrated dispersion solver or validated hotspot-detection service is connected. The map visualization is not a concentration reading.</div><div class="section-label">EVIDENCE SNAPSHOT</div><div class="tiny muted">Regional model PM₂.₅: ${fmtNum(effAir()?.pm25,1)} μg/m³ (not a monitor)<br/>Wind model: ${fmtNum(effWeather()?.windSpeedMs,1)} m/s<br/>Building height completeness: unknown</div><div style="margin-top:12px">${btn(state.hotspot ? 'Investigate selected location →' : 'Select a map point to investigate','inspect-hotspot','primary',{className:'btn-wide btn-sm',disabled:!state.hotspot})}</div><div class="tiny muted" style="margin-top:8px">A hotspot is not proof of an emission source.</div></aside>`;
}
function renderLayerToggle(title, sub, key, checked) {
  return `<div class="layer-row"><div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><label class="switch"><input type="checkbox" data-vis="${key}" ${checked?'checked':''} aria-label="Toggle ${esc(title)}"><span></span></label></div>`;
}

function renderS04() {
  return `<div class="page-content">
    ${pageHeader('S04 • HOTSPOT REVIEW','Hotspot investigation','Understand the selected location and evidence context. A flagged pattern is not proof of a specific emission source.', btn('Return to 3D Map','return-map','secondary'))}
    <div class="hotspot-layout">
      <div class="card"><div class="card-header"><h2>Selected real-world location</h2>${status('Map geometry','demo')}</div><div id="leaflet-hotspot" class="leaflet-map hotspot-map" aria-label="Selected illustrative hotspot map"></div><div class="card-body"><div class="map-chip">⌖ ${esc(state.hotspot ? state.hotspot.id : 'No selection')} • SELECTED</div><div class="demo-cells-note">Map base is contextual only. A selected location is user-chosen, not detected by a live hotspot model. No pollution hotspot feed is connected.</div></div></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card"><div class="card-body"><div class="eyebrow">SELECTED LOCATION</div><h2 style="font-size:20px;margin:0 0 5px">${esc(hotspotLabel())}</h2><p class="muted" style="margin:0 0 14px">${esc(state.hotspot?.location || 'No selected location')} • ${esc(state.timeWindow)}</p>
          <div class="grid two"><div class="metric-card" style="background:#f7fafc;border-radius:8px"><div class="metric-kicker">Provisional index</div><div class="metric-value" style="font-size:18px">Not computed</div><div class="metric-note">No validated dispersion calculation.</div></div><div class="metric-card" style="background:#f7fafc;border-radius:8px"><div class="metric-kicker">Evidence quality</div><div style="margin-top:9px">${status('Incomplete','missing')}</div><div class="metric-note" style="margin-top:6px">Coverage and timestamps not supplied.</div></div></div>
          <hr class="hr"/><div class="list-row"><div class="list-icon">◌</div><div class="list-main"><strong>Air quality baseline</strong><p>Observation source, timestamps and coverage: not supplied.</p></div>${status('No station feed','missing')}</div><div class="list-row"><div class="list-icon">↗</div><div class="list-main"><strong>Weather / wind model</strong><p>${liveRuntime.weather ? `Open-Meteo model ${esc(liveRuntime.weather.displayTime)} UTC · ${fmtNum(liveRuntime.weather.windSpeedMs,1)} m/s at ${fmtNum(liveRuntime.weather.windDirectionDeg,0)}°` : esc(liveRuntime.errors.weather || 'No model response received.')}</p></div>${status(liveRuntime.weather?.freshness || 'Missing',liveRuntime.weather?'demo':'missing')}</div><div class="list-row"><div class="list-icon">▥</div><div class="list-main"><strong>Urban morphology</strong><p>Building-height completeness and street attributes: unknown.</p></div>${status('Incomplete','missing')}</div>
          ${notice('Interpretation guardrail','This hotspot indicates a spatial pattern in an illustrative overlay. It does not establish which vehicle, activity, business or source caused pollution.','blue')}
          <div class="action-row" style="margin-top:15px">${btn('Inspect Contributing Factors →','open-evidence','primary')}${btn('Review Data Quality','open-health')}${btn('Request Site Verification','request-site')}</div>
        </div></div>
      </div>
    </div>
  </div>`;
}

function renderS05() {
  const openComparison = state.evidence.comparisonOpen;
  return `<div class="page-content">
    ${pageHeader('S05 • EVIDENCE REVIEW','What evidence supports this hotspot?','Compare observed air quality, meteorology, urban form, traffic/emissions when connected, model output and missing evidence.')}
    ${notice('INCOMPLETE • QUALIFICATION REQUIRED','Required live observations and calculation inputs are not configured. Production intervention planning remains blocked. The qualified example is for interface demonstration only.','')}
    <div class="grid two" style="margin-top:15px;align-items:start">
      <div class="card"><div class="card-header"><h2>Evidence layers</h2><span class="tag amber">Observed ≠ modelled</span></div><div class="card-body">
        ${evidenceRow('Air-quality observations','Source, measurement timestamp, sensor coordinates and coverage not supplied.','Missing','missing')}
        ${evidenceRow('Meteorology + time alignment','Weather provider and observation/model time not supplied.','Missing','missing')}
        ${evidenceRow('Building / street form','Street orientation, width and height coverage are not verified.','Incomplete','missing')}
        ${evidenceRow('Traffic / emissions','No traffic counts or emissions integration is configured.','Unavailable','missing')}
        ${evidenceRow('Modelled output','Relative index is not computed; no validated concentration result exists.','Not computed','neutral')}
        ${evidenceRow('Missing data / alternatives','Weather, source coverage and morphology gaps can explain apparent patterns.','Review needed','missing')}
        <div class="action-row" style="margin-top:12px">${btn(openComparison?'Hide evidence comparison':'Compare Evidence Layers','compare-evidence','secondary')}${btn('Request Additional Evidence','request-evidence','primary')}${btn('Request Site Verification','request-site','secondary')}</div>
        ${openComparison ? `<div class="notice blue" style="margin-top:14px"><div class="notice-icon">i</div><div><strong>Layer comparison state</strong>Air-quality observations: missing. Meteorology: missing. Morphology: incomplete. Traffic/emissions: unavailable. Modelled output: not computed. These are kept as distinct evidence categories.</div></div>` : ''}
      </div></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card"><div class="card-header"><h2>Qualification checklist</h2>${status('Not qualified','missing')}</div><div class="card-body"><div class="check-list">
          ${checkItem('timeAlignment','Time alignment verified','Observation and meteorology times are required; both are missing.')}
          ${checkItem('observationCoverage','Measurement locations / coverage sufficient','No connected air-quality observation coverage is available.')}
          ${checkItem('buildingHeightCoverage','Building-height attributes reviewed','Geometry completeness is unknown; fallback height cannot be treated as measured.')}
          ${checkItem('trafficEvidence','Traffic / emissions evidence available','Applicable to traffic/source claims; no integration is configured.')}
          ${checkItem('modelValidity','Model validity and assumptions accepted','No valid model run or calibration record exists.')}
        </div><hr class="hr"/>
        ${btn('Continue to Intervention Planning →','continue-planning','primary',{className:'btn-wide',disabled:!state.evidence.qualified,title:'Blocked until real evidence criteria are satisfied'})}
        <div class="tiny muted" style="margin-top:8px">The checklist documents review work but does not create real observations or qualify missing data.</div>
        </div></div>
        <div class="card"><div class="card-header"><h2>Prototype-only preview</h2>${status('Example only','demo')}</div><div class="card-body"><p class="muted" style="line-height:1.55;margin-top:0">Preview the qualified-evidence screen state to review the downstream interface. This does not alter source status, qualify evidence, or unlock a production scenario run.</p>${btn('Preview Qualified Example (prototype)','preview-qualified','amber',{className:'btn-wide'})}</div></div>
      </div>
    </div>
  </div>`;
}
function evidenceRow(title, body, pill, type) {
  return `<div class="list-row"><div class="list-icon">${title.startsWith('Air')?'◌':title.startsWith('Meteor')?'↗':title.startsWith('Building')?'▥':title.startsWith('Traffic')?'⇄':title.startsWith('Modelled')?'◇':'!'}</div><div class="list-main"><strong>${esc(title)}</strong><p>${esc(body)}</p></div><div class="row-end">${status(pill,type)}</div></div>`;
}
function checkItem(key, label, detail) {
  return `<label class="check-line"><input type="checkbox" data-check="${key}" ${state.evidence[key]?'checked':''}/><span><strong>${esc(label)}</strong><small>${esc(detail)}</small></span></label>`;
}

function renderS06() {
  const rows = Object.values(state.sources).map(source => {
    let s = source.status; let st = s === 'current' ? 'good' : s === 'delayed' ? 'demo' : s === 'stale' || s === 'failed' ? 'stale' : 'missing'; let display = s.toUpperCase();
    if (source.id === 'weather' && state.weatherStale) { display = 'STALE • PROTOTYPE STATE'; st = 'stale'; }
    return `<div class="source-row"><div class="source-label"><strong>${esc(source.label)}</strong><span>${esc(source.source)}</span></div><div>${status(display,st)}</div><div class="source-meta"><strong>Observation / model time:</strong> ${esc(source.observationTime)}<br/><strong>Ingestion / refresh:</strong> ${esc(source.refreshTime)}<br/><strong>Coverage:</strong> ${esc(source.coverage)}</div><div class="source-impact"><strong>Affected analyses</strong><br/>${esc(source.affects)}</div></div>`;
  }).join('');
  return `<div class="page-content">
    ${pageHeader('S06 • SHARED DATA HEALTH','Input health and calculation readiness','Source status, observation/model timestamps, ingestion time, coverage and affected analyses are tracked independently.',btn('Return to Investigation','return-health','secondary'))}
    ${notice('Refresh is not freshness','An API refresh can update ingestion time but does not prove that the underlying environmental observation is new. No refresh service is configured here.','blue')}
    ${state.weatherStale ? notice('Weather stale / unavailable prototype state','No last-valid timestamp is available. Wind-vector interpretation, plume interpretation and scenario readiness are affected. This is an explicit QA variant, not a connected weather observation.','red') : ''}
    <div class="card" style="margin-top:15px"><div class="card-header"><h2>Per-source status</h2><span class="tag amber">${Object.keys(state.sources).length} input groups</span><div>${btn('Refresh weather + regional AQ','refresh-live-data','secondary',{className:'btn-sm'})}</div></div>${rows}</div>
    <div class="grid two" style="margin-top:15px">
      <div class="card"><div class="card-header"><h2>Insufficient air-quality observation coverage</h2>${status('Blocked','missing')}</div><div class="card-body">${notice('No suitable observation coverage','Observed readings remain missing and are not substituted with estimates. Request site verification or return to monitoring.','')}<div class="action-row" style="margin-top:12px">${btn('Request Site Verification','request-site','secondary')}${btn('Return to Live Monitoring','open-map','primary')}</div></div></div>
      <div class="card"><div class="card-header"><h2>Building-height / geometry gaps</h2>${status('Incomplete','missing')}</div><div class="card-body">${notice('Geometry attributes unavailable','Fallback geometry is not supplied in this build. If a later adapter uses estimated heights, they must be labelled estimated—not measured—and disclose reliability impact.','')}<div class="action-row" style="margin-top:12px">${btn('Review evidence gaps','open-evidence','secondary')}${btn('Return to hotspot','return-map','primary')}</div></div></div>
    </div>
    <div class="screen-footer"><span>Refresh requests update the fetch timestamp; source/model timestamps can remain unchanged and stale.</span><div class="action-row">${btn('Back to previous screen','return-health','link')}</div></div>
  </div>`;
}

function renderS07() {
  const branches = [
    { key:'A', title:'Traffic Orchestration', icon:'⇄', desc:'Configure a corridor diversion and inspect route constraints.', requirements:['Supported road graph','Route engine','Traffic / emissions evidence'], to:'S08A', color:'teal' },
    { key:'B', title:'Green Infrastructure', icon:'♧', desc:'Select and compare candidate locations using transparent suitability criteria.', requirements:['Site / land geometry','Access / ownership verification','Intervention-effect assumptions'], to:'S08B', color:'green' },
    { key:'C', title:'Construction / Zoning', icon:'▥', desc:'Preview a proposed footprint and height against existing context.', requirements:['Proposed geometry','Building geometry coverage','Valid airflow / dispersion model'], to:'S08C', color:'purple' }
  ];
  return `<div class="page-content">
    ${pageHeader('S07 • INTERVENTION SELECTION','Select a municipal response','Choose based on the evidence and municipal responsibility. There is no universal best response.')}
    ${state.evidence.previewQualified ? notice('PROTOTYPE EXAMPLE CONTEXT','You entered from the qualified-example preview. It is for UI demonstration only and does not qualify real evidence, calculation or consequential actions.','blue') : notice('Prerequisites unavailable','No connected source, route engine or effect/dispersion model is configured. Branch screens remain usable, but unsupported scenario outputs are blocked.','')}
    <div class="grid three" style="margin-top:16px">${branches.map(b => `<div class="card" style="display:flex;flex-direction:column"><div class="card-body" style="flex:1"><div class="list-icon" style="width:42px;height:42px;font-size:20px;margin-bottom:17px">${b.icon}</div><div class="eyebrow">BRANCH ${b.key}</div><h2 style="font-size:17px;margin:0 0 8px">${b.title}</h2><p class="muted" style="line-height:1.5;margin:0 0 13px">${b.desc}</p><div class="field-label" style="margin-bottom:8px">Required inputs</div>${b.requirements.map(r=>`<div class="check-line" style="margin-bottom:8px"><span class="tag red">Missing</span><span>${esc(r)}</span></div>`).join('')}<div class="notice blue" style="margin-top:14px"><div class="notice-icon">i</div><div><strong>What remains unavailable</strong>${b.key==='A'?'No detour, travel time, traffic shift or emissions estimate.':b.key==='B'?'No surveyed-site claim or quantified pollution-reduction estimate.':'No reliable airflow or pollution-impact prediction.'}</div></div></div><div class="card-body" style="padding-top:0">${btn(`Configure ${b.key} →`, `select-branch:${b.key}`,'primary',{className:'btn-wide'})}</div></div>`).join('')}</div>
    <div class="screen-footer"><span>Scenario settings and selected hotspot remain in context when switching branches.</span><div class="action-row">${btn('Back to evidence','open-evidence','link')}</div></div>
  </div>`;
}

function renderS08A() {
  const cfg = state.intervention.traffic;
  return `<div class="page-content">
    ${pageHeader('S08A • TRAFFIC ORCHESTRATION','Configure a corridor diversion','Configure the proposed corridor, period and constraints. Candidate route is illustrative unless a supported routing engine computes it.',btn('Data Health','open-health','secondary'))}
    <div class="branch-layout"><div class="card"><div class="card-header"><h2>Illustrative route context</h2>${status('Not calculated','missing')}</div><div id="leaflet-traffic" class="leaflet-map branch-map" aria-label="Traffic corridor illustration"></div><div class="card-body"><div class="demo-cells-note">No road graph or traffic feed is connected. No alternative route, detour distance, travel time or emissions estimate is available.</div></div></div>
      <div class="card"><div class="card-header"><h2>Scenario inputs</h2><span class="tag amber">Unsaved draft</span></div><div class="card-body"><div class="form-grid">
        <div class="field span-2"><label>Affected corridor</label><input data-bind="intervention.traffic.corridor" value="${attr(cfg.corridor)}" /></div>
        <div class="field span-2"><label>Alternative route area</label><input data-bind="intervention.traffic.alternative" value="${attr(cfg.alternative)}" /></div>
        <div class="field span-2"><label>Scenario period</label><select data-bind="intervention.traffic.period"><option ${cfg.period==='Next 24 hours (proposed)'?'selected':''}>Next 24 hours (proposed)</option><option ${cfg.period==='Next 7 days (proposed)'?'selected':''}>Next 7 days (proposed)</option><option ${cfg.period==='Custom / not specified'?'selected':''}>Custom / not specified</option></select></div>
        <div class="field span-2"><label>Route constraints</label><textarea data-bind="intervention.traffic.restrictions">${esc(cfg.restrictions)}</textarea></div>
        <div class="field span-2"><label>Assumptions / limitations</label><textarea data-bind="intervention.traffic.assumptions">${esc(cfg.assumptions)}</textarea></div>
      </div><div class="notice" style="margin-top:14px"><div class="notice-icon">!</div><div><strong>Route calculation prerequisites missing</strong>A supported road graph, route engine and traffic/emissions data are required. Running creates an incomplete-inputs state, not an invented route result.</div></div><div class="action-row" style="margin-top:15px">${btn('Run Scenario →','run-scenario','primary')}${btn('Cancel Scenario','cancel-scenario','secondary')}</div></div></div></div>
    <div class="screen-footer"><span>Back/cancel retains these values until you explicitly discard them.</span><div class="action-row">${btn('Return to intervention choice','open-planning','link')}</div></div>
  </div>`;
}

function renderS08B() {
  const cfg = state.intervention.green;
  const candidates = ['S1','S2','S3'];
  return `<div class="page-content">
    ${pageHeader('S08B • GREEN INFRASTRUCTURE','Compare candidate sites','Illustrative candidate IDs only. Site ownership/access and intervention-effect assumptions are not verified.',btn('Data Health','open-health','secondary'))}
    <div class="branch-layout"><div class="card"><div class="card-header"><h2>Candidate-site map</h2>${status('Illustrative sites','demo')}</div><div id="leaflet-green" class="leaflet-map branch-map" aria-label="Illustrative green infrastructure candidate sites"></div><div class="card-body"><div class="action-row">${candidates.map(c=>btn(`${c}${cfg.selectedSite===c?' • Selected':''}`,`select-site:${c}`,cfg.selectedSite===c?'primary':'secondary',{className:'btn-sm'})).join('')}${btn(cfg.compare?'Hide candidate comparison':'Compare Candidates','compare-candidates','secondary',{className:'btn-sm'})}</div><p class="demo-cells-note">Site pins are demo fixtures. They are not surveyed land parcels or claims of municipal ownership.</p></div></div>
      <div class="card"><div class="card-header"><h2>Site suitability criteria</h2><span class="tag amber">Not verified</span></div><div class="card-body"><div class="field"><label>Selected candidate</label><select data-bind="intervention.green.selectedSite"><option ${cfg.selectedSite==='S1'?'selected':''}>S1</option><option ${cfg.selectedSite==='S2'?'selected':''}>S2</option><option ${cfg.selectedSite==='S3'?'selected':''}>S3</option></select></div><div class="check-list" style="margin-top:15px">${cfg.criteria.map(c=>`<div class="check-line"><span class="tag red">Missing</span><span><strong>${esc(c[0].toUpperCase()+c.slice(1))}</strong><small>Required evidence or assumptions have not been supplied.</small></span></div>`).join('')}</div>
      ${cfg.compare ? `<div class="notice blue" style="margin-top:14px"><div class="notice-icon">i</div><div><strong>Candidate comparison • criteria only</strong>S1, S2 and S3 are compared against the same criteria. No numeric scores or reductions are available without verified site/land data and an effect model.</div></div>` : ''}
      <div class="notice" style="margin-top:14px"><div class="notice-icon">!</div><div><strong>No quantified intervention benefit</strong>Suitability and pollution effects cannot be calculated without suitable site data and valid, documented effect assumptions.</div></div>
      <div class="action-row" style="margin-top:15px">${btn('Select Site','select-site-confirm','secondary')}${btn('Run Scenario →','run-scenario','primary')}${btn('Cancel Scenario','cancel-scenario','secondary')}</div></div></div></div>
    <div class="screen-footer"><span>Staged site selection is retained until discard is explicitly confirmed.</span><div class="action-row">${btn('Return to intervention choice','open-planning','link')}</div></div>
  </div>`;
}

function renderS08C() {
  const cfg = state.intervention.construction;
  return `<div class="page-content">
    ${pageHeader('S08C • CONSTRUCTION / ZONING','Preview the proposed building','Compare existing urban context with distinct proposed geometry. Geometry preview is not an airflow or pollution-impact result.',btn('Data Health','open-health','secondary'))}
    <div class="dual-map-grid"><div class="card dual-map-card"><div class="dual-map-title">EXISTING GEOMETRY • REFERENCE ONLY</div><div id="leaflet-existing" class="leaflet-map branch-map" aria-label="Existing geographic context"></div></div><div class="card dual-map-card geometry-preview"><div class="dual-map-title">PROPOSED GEOMETRY • EDITABLE PREVIEW</div><div id="leaflet-proposed" class="leaflet-map branch-map" aria-label="Proposed building geometry preview"></div><div class="proposal-box" title="Illustrative proposed building footprint"></div><div class="geometry-caption">Proposed footprint / height • illustrative overlay only</div></div></div>
    <div class="card" style="margin-top:15px"><div class="card-header"><h2>Proposed geometry</h2>${status(cfg.previewed?'Preview state updated':'Not previewed','neutral')}</div><div class="card-body"><div class="form-grid">
      <div class="field"><label>Footprint area (m²)</label><input type="number" min="1" max="10000" data-bind="intervention.construction.footprint" value="${attr(cfg.footprint)}" /></div><div class="field"><label>Proposed height (m)</label><input type="number" min="1" max="300" data-bind="intervention.construction.height" value="${attr(cfg.height)}" /></div><div class="field"><label>Orientation (degrees)</label><input type="number" min="0" max="359" data-bind="intervention.construction.orientation" value="${attr(cfg.orientation)}" /></div><div class="field"><label>Geometry validity</label><input value="Not validated against a real parcel" readonly /></div>
    </div><div class="action-row" style="margin-top:15px">${btn('Preview Geometry','preview-geometry','secondary')}${btn('Run Scenario →','run-scenario','primary')}${btn('Cancel','cancel-scenario','secondary')}</div>
    ${cfg.previewed?notice('Geometry preview updated','The proposed footprint/height values are reflected in this illustrative preview. No airflow or pollution prediction has been calculated.','blue'):''}
    ${notice('Airflow model unavailable','A valid geometry dataset, complete building attributes and suitable calibrated airflow/dispersion model are required before impact can be assessed.','')}</div></div>
    <div class="screen-footer"><span>Estimated geometry, if used by a later connector, must stay distinguishable from measured building heights.</span><div class="action-row">${btn('Return to intervention choice','open-planning','link')}</div></div>
  </div>`;
}

function renderS09() {
  const r = state.scenarioRun;
  const stateName = r.status === 'not-calculated' ? 'Not calculated' : r.status === 'incomplete-inputs' ? 'Incomplete inputs' : r.status === 'failed' ? 'Failed' : r.status === 'completed' && r.isIllustrative ? 'Completed • illustrative example' : r.status;
  const error = r.error || 'No validated calculation service is connected. No calculation run ID or output is available.';
  const sequence = [
    ['1','Input check','Source availability, timestamps and completeness.',r.status==='incomplete-inputs'?'blocked':'current'],
    ['2','Prepare scenario','Intervention branch, settings, period and assumptions.','current'],
    ['3','Calculate','No supported model, route engine or effect model is configured.','blocked'],
    ['4','Validate output','No run metadata or output to validate.','blocked']
  ];
  return `<div class="page-content">
    ${pageHeader('S09 • SCENARIO SYSTEM STATE','Scenario calculation','The calculation lifecycle is guarded. Only an actual successful, validated, non-illustrative run can unlock the production comparison route.')}
    <div class="card"><div class="card-header"><h2>Current system state</h2>${status(stateName,r.status==='completed'?'demo':r.status==='failed'?'stale':r.status==='incomplete-inputs'?'missing':'neutral')}</div><div class="card-body"><div class="grid two"><div><div class="metric-kicker">Intervention</div><div class="metric-value" style="font-size:18px">${esc(currentBranchLabel())}</div><div class="metric-note">${esc(state.hotspot?.label || 'No selected hotspot')} • ${esc(state.timeWindow)}</div></div><div><div class="metric-kicker">Run metadata</div><div class="metric-value" style="font-size:18px">${r.runId ? esc(r.runId) : 'No run ID'}</div><div class="metric-note">Execution time and model version: not supplied.</div></div></div><hr class="hr"/><div class="processing-grid">${sequence.map(s=>`<div class="process-step ${s[3]}"><div class="step-num">${s[0]}</div><strong>${s[1]}</strong><p>${s[2]}</p></div>`).join('')}</div>
    ${notice(r.status==='completed'?'ILLUSTRATIVE COMPLETED EXAMPLE':r.status==='failed'?'CALCULATION FAILED / INCOMPLETE':'INCOMPLETE INPUTS',esc(error)+(r.status==='completed'?' This is a visual example only; it is not a real run and has no result metadata.':''),r.status==='failed'?'red':'')}
    <div class="action-row" style="margin-top:15px">${btn('Compare Results →','valid-compare','primary',{disabled:!canOpenValidComparison(r),title:'Requires a real successful validated calculation'})}${btn('View comparison layout (prototype preview)','view-comparison-preview','secondary')}${btn('Return to Scenario Setup','return-setup','secondary')}${btn('Review Data Health','open-health','secondary')}</div>
    <div class="screen-footer"><span>${r.status==='completed'&&r.isIllustrative?'Example state is not a real model result.':'No calculation was started because required prerequisites are missing.'}</span><div class="action-row">${btn('Preview completed state (prototype only)','preview-completed','amber')}</div></div>
    </div></div>
  </div>`;
}

function renderS10() {
  return `<div class="page-content">
    ${pageHeader('S10 • BASELINE VS INTERVENTION','Compare the spatial pattern','The paired maps demonstrate the comparison layout. Baseline/scenario deltas, hotspot shifts and causal outcomes are unavailable without a genuine validated run.')}
    ${state.comparison.previewOnly ? notice('COMPARISON LAYOUT • PROTOTYPE PREVIEW','This is a visual comparison example, not a calculated baseline-versus-intervention result. Metrics, shifts and reductions remain unavailable.','blue') : notice('VALID COMPARISON UNAVAILABLE','A production comparison opens only after a successful, validated non-illustrative calculation.','')}
    <div class="comparison-grid" style="margin-top:15px"><div class="card"><div class="dual-map-title">BASELINE • ${esc(state.timeWindow)}</div><div id="leaflet-baseline" class="leaflet-map" aria-label="Baseline comparison map"></div><div class="comparison-caption">Baseline observations: not supplied. Spatial overlay is illustrative only.</div></div><div class="card"><div class="dual-map-title">INTERVENTION • ${esc(currentBranchLabel())}</div><div id="leaflet-intervention" class="leaflet-map" aria-label="Intervention comparison map"></div><div class="comparison-caption">Scenario output: not calculated. No result delta or hotspot movement is asserted.</div></div></div>
    <div class="grid three" style="margin-top:15px"><div class="card metric-card"><div class="metric-kicker">Output metric</div><div class="metric-value" style="font-size:16px">Not available</div><div class="metric-note">No valid model output.</div></div><div class="card metric-card"><div class="metric-kicker">Model delta</div><div class="metric-value" style="font-size:16px">Not calculated</div><div class="metric-note">No baseline/scenario pair.</div></div><div class="card metric-card"><div class="metric-kicker">Quality / uncertainty</div><div class="metric-value" style="font-size:16px">Incomplete</div><div class="metric-note">Source coverage, model metadata and assumptions missing.</div></div></div>
    <div class="card" style="margin-top:15px"><div class="card-header"><h2>Inspect changed areas</h2>${status(state.comparison.changedArea?'Selection updated':'No region selected','neutral')}</div><div class="card-body"><div class="form-grid"><div class="field"><label>Changed-area selection</label><select data-bind="comparison.changedArea"><option value="" ${!state.comparison.changedArea?'selected':''}>Choose a region</option><option value="North corridor" ${state.comparison.changedArea==='North corridor'?'selected':''}>North corridor • illustrative</option><option value="Central cells" ${state.comparison.changedArea==='Central cells'?'selected':''}>Central cells • illustrative</option><option value="South approach" ${state.comparison.changedArea==='South approach'?'selected':''}>South approach • illustrative</option></select></div><div class="field"><label>Difference interpretation</label><input readonly value="Unavailable without a valid scenario run" /></div></div>${state.comparison.changedArea?notice('Changed area selected',`${esc(state.comparison.changedArea)} is a demo region. No numeric difference or pollution source can be inferred.`,'blue'):''}</div></div>
    <div class="action-row" style="margin-top:18px">${btn('Adjust Traffic Scenario','adjust:A','secondary')}${btn('Adjust Green Infrastructure','adjust:B','secondary')}${btn('Adjust Geometry','adjust:C','secondary')}${btn('Export Comparison','open-report','secondary')}${btn('Recommend for Review →','recommend-review','primary',{disabled:!canOpenValidComparison(state.scenarioRun),title:'Requires a genuine successful validated run'})}${btn('Reject Scenario','reject-scenario','danger')}</div>
    <div class="screen-footer"><span>No made-up reductions, gains, plume shifts or numeric differences are shown.</span><div class="action-row">${btn('Open review packet layout (prototype)','open-review-preview','amber')}</div></div>
  </div>`;
}

function renderS11() {
  const realRun = canOpenValidComparison(state.scenarioRun);
  return `<div class="page-content">
    ${pageHeader('S11 • HUMAN REVIEW','Review the proposed municipal action','A person—not the model—makes the consequential decision. Inspect the evidence, uncertainty, intervention and comparison before approval.')}
    ${notice('APPROVAL BLOCKED','No real validated scenario run, qualified evidence packet or configured municipal authority connector is available. The review packet can be inspected as a prototype but cannot approve an operational action.','')}
    <div class="grid two" style="margin-top:15px;align-items:start"><div style="display:flex;flex-direction:column;gap:14px">
      <div class="card"><div class="card-header"><h2>Hotspot context</h2>${status('Illustrative','demo')}</div><div class="card-body"><strong>${esc(hotspotLabel())}</strong><p class="muted">${esc(currentArea())} • ${esc(state.timeWindow)}</p><div id="leaflet-review" class="leaflet-map" style="height:230px" aria-label="Review location map"></div></div></div>
      <div class="card"><div class="card-header"><h2>Intervention + scenario</h2>${status(state.scenarioRun.status==='completed'&&realRun?'Calculated':'Not calculated','missing')}</div><div class="card-body"><div class="list-row"><div class="list-main"><strong>${esc(currentBranchLabel())}</strong><p>Branch settings are retained in the workflow state. Route/site/geometry prerequisites remain unavailable.</p></div></div><div class="list-row"><div class="list-main"><strong>Baseline / scenario comparison</strong><p>${realRun?'Validated result available':'No validated model deltas, run metadata or measured comparison outputs.'}</p></div></div><div class="list-row"><div class="list-main"><strong>Data quality / uncertainty</strong><p>Air quality, meteorology and morphology are missing or incomplete. No source attribution is confirmed.</p></div></div></div></div>
    </div><div style="display:flex;flex-direction:column;gap:14px">
      <div class="card"><div class="card-header"><h2>Review record</h2><span class="tag amber">Explicit human action</span></div><div class="card-body"><div class="form-grid"><div class="field"><label>Reviewer name / identifier</label><input data-bind="review.reviewer" value="${attr(state.review.reviewer)}" placeholder="Required for a real review" /></div><div class="field"><label>Responsible team</label><input data-bind="review.team" value="${attr(state.review.team)}" placeholder="Not configured" /></div><div class="field span-2"><label>Operator notes</label><textarea data-bind="review.notes" placeholder="Record assumptions, limitations and rationale.">${esc(state.review.notes)}</textarea></div></div><hr class="hr"/><div class="section-title">Assumptions and limitations</div><ul style="padding-left:18px;line-height:1.65;color:#6e7f8d;font-size:11px"><li>Observed measurements are distinct from modelled/illustrative layers.</li><li>Hotspot alone does not establish an emission source.</li><li>No quantified intervention benefit is supported.</li><li>External authority submission is not configured.</li></ul></div></div>
      <div class="card"><div class="card-header"><h2>Decision</h2>${status('Not approved','missing')}</div><div class="card-body"><div class="action-row">${btn('Return for More Evidence','open-evidence','secondary')}${btn('Edit Recommendation','open-planning','secondary')}</div><div class="action-row" style="margin-top:9px">${btn('Reject Recommendation','reject-review','danger')}${btn('Approve for Submission →','approve-review','primary',{disabled:!canApproveForSubmission(state),title:'Requires a genuine validated run and a qualified packet'})}</div><div class="tiny muted" style="margin-top:10px">A prototype preview does not grant approval authority or unlock submission.</div></div></div>
    </div></div>
  </div>`;
}

function renderS12() {
  const a = state.actionRecord;
  return `<div class="page-content">
    ${pageHeader('S12 • ACTION PACKAGE','Prepare a municipal action record','Build a traceable draft with selected area, hotspot, source timestamps, intervention settings, limitations and human decision status.')}
    ${notice('MUNICIPAL SUBMISSION INTEGRATION: NOT CONFIGURED','The action package remains Draft until a connected authority service returns a confirmed submission response. No external submission or acknowledgement can be made from this build.','')}
    <div class="grid two" style="margin-top:15px;align-items:start"><div class="card"><div class="card-header"><h2>Action package contents</h2>${status(a.created?'Draft prepared':'Not prepared',a.created?'demo':'neutral')}</div><div class="card-body">
      ${packageRow('Selected area + location reference',`${currentArea()} • ${hotspotLabel()}`)}
      ${packageRow('Observation sources + timestamps','Not supplied • source coverage incomplete')}
      ${packageRow('Model output / run time',state.scenarioRun.isIllustrative?'Illustrative example only • not a real run':'Not calculated • no run ID')}
      ${packageRow('Intervention details',currentBranchLabel())}
      ${packageRow('Assumptions + limitations','Sources missing; no model benefit claim; source attribution not established')}
      ${packageRow('Scenario comparison',state.comparison.previewOnly?'Prototype layout only':'Unavailable without valid calculation')}
      ${packageRow('Review / approval status','Not approved for operational submission')}
      <div class="action-row" style="margin-top:15px">${btn('Prepare Action Record','prepare-action','primary')}${btn('Preview Evidence Report','open-report','secondary')}</div>
    </div></div><div style="display:flex;flex-direction:column;gap:14px">
      <div class="card"><div class="card-header"><h2>Action status</h2>${status(a.submissionConfirmed?'Submitted':'Draft • not submitted',a.submissionConfirmed?'good':'missing')}</div><div class="card-body"><div class="timeline">${a.timeline.map((t,i)=>`<div class="timeline-item"><div class="timeline-dot ${i===0?'active':''}"></div><div class="timeline-copy"><strong>${esc(t.status)}</strong><p>${esc(t.detail)}</p></div></div>`).join('')}</div>${notice('External submission unavailable','No municipal endpoint, authentication or response is configured. A draft is retained in this page state; submission, acknowledgment and assignment are not represented as completed.','blue')}${btn('Submit to connected municipal system','submit-action','primary',{disabled:true,title:'Municipal integration is not configured',className:'btn-wide'})}</div></div>
      <div class="card"><div class="card-header"><h2>Report / export</h2>${status(state.report.exported?'Local file generated':'Preview only',state.report.exported?'good':'neutral')}</div><div class="card-body"><p class="muted" style="line-height:1.5;margin-top:0">A report preview is not a PDF download. The app can generate a local HTML evidence draft when you explicitly export it; it is not a validated scientific report or external submission.</p>${btn('Open report preview →','open-report','secondary',{className:'btn-wide'})}${state.report.exported?`<div class="notice green" style="margin-top:10px"><div class="notice-icon">✓</div><div><strong>Local file generated</strong>${esc(state.report.lastFilename || 'Evidence report file')}</div></div>`:''}</div></div>
    </div></div>
    <div class="screen-footer"><span>Action status remains Draft until a real external system confirms submission.</span><div class="action-row">${btn('Track / verify outcome','open-followup','secondary')}</div></div>
  </div>`;
}

function packageRow(title, detail) {
  return `<div class="list-row"><div class="list-icon">✓</div><div class="list-main"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div><div class="row-end">${status('Draft item','neutral')}</div></div>`;
}

function renderReportPreview() {
  return `<div class="page-content">
    ${pageHeader('S12 • REPORT PREVIEW','Review the exportable evidence packet','Inspect the report sections before creating a local HTML draft. Actual source timestamps and calculation metadata are only included when supplied.',btn('Return to Action Package','open-actions','secondary'))}
    ${notice('NO FILE GENERATED • DRAFT / PREVIEW ONLY','This screen is a preview until you choose Export local HTML. It does not mean a PDF was generated, a report was uploaded, or an authority system accepted an action.','')}
    <div class="card" style="margin-top:15px"><div class="card-header"><h2>URBAN-VENTAI / MUNICIPAL EVIDENCE REPORT</h2><span class="tag amber">DRAFT</span></div><div class="card-body" style="padding:24px">
      <div class="grid two"><div><div class="metric-kicker">Operating area</div><div style="font-size:15px;font-weight:800;margin-top:6px">${esc(currentArea())}</div><div class="tiny muted" style="margin-top:4px">Geographic focus only • official ward membership not confirmed</div></div><div><div class="metric-kicker">Location reference</div><div style="font-size:15px;font-weight:800;margin-top:6px">${esc(hotspotLabel())}</div><div class="tiny muted" style="margin-top:4px">${esc(state.timeWindow)}</div></div></div>
      <hr class="hr"/><div class="list-row"><div class="list-icon">01</div><div class="list-main"><strong>Observed inputs and provenance</strong><p>No air-quality observation source or timestamp supplied. Meteorology and traffic/emissions inputs are unavailable.</p></div></div>
      <div class="list-row"><div class="list-icon">02</div><div class="list-main"><strong>Spatial / model representation</strong><p>Leaflet base map provides geographic context only. Pollution cells and plume are illustrative overlays. No validated PM₂.₅ output or model run ID exists.</p></div></div>
      <div class="list-row"><div class="list-icon">03</div><div class="list-main"><strong>Intervention and assumptions</strong><p>${esc(currentBranchLabel())}. Prerequisites remain missing; no calculated route, site benefit or construction impact is asserted.</p></div></div>
      <div class="list-row"><div class="list-icon">04</div><div class="list-main"><strong>Comparison, uncertainty and review</strong><p>Comparison unavailable or prototype-only. Source attribution is not established. Human approval and municipal submission remain incomplete.</p></div></div>
      <div class="list-row"><div class="list-icon">05</div><div class="list-main"><strong>Action / follow-up</strong><p>${esc(state.actionRecord.status.toUpperCase())} • Not submitted. No follow-up observation has been verified.</p></div></div>
      <div class="action-row" style="margin-top:20px">${btn('Export local HTML evidence draft','export-html','primary')}${btn('Return to Action Package','open-actions','secondary')}</div>
      ${state.report.exported?notice('LOCAL FILE GENERATED',`The browser generated <strong>${esc(state.report.lastFilename)}</strong>. It is a local HTML draft, not a validated PDF or external submission.`,'green'):''}
    </div></div>
  </div>`;
}

function renderS13() {
  const a = state.actionRecord;
  const f = state.followUp;
  return `<div class="page-content">
    ${pageHeader('S13 • ACTION TRACKING / VERIFICATION','Follow-up and outcome verification','Compare expected model output with later observations only when both are traceable and comparable. A post-action decrease does not prove causation.')}
    ${notice('FOLLOW-UP IS A DRAFT','There is no connected authority status feed or sensor integration. Follow-up form entries remain local draft records until a real persistence/source integration exists.','')}
    <div class="grid two" style="margin-top:15px;align-items:start"><div class="card"><div class="card-header"><h2>Action timeline</h2>${status(a.status.toUpperCase(),a.status==='draft'?'missing':'neutral')}</div><div class="card-body"><div class="timeline">${[
      ['Draft',a.created?'Draft action record prepared locally.':'No action record has been prepared.'],
      ['Submitted','No submission confirmation from a municipal authority.'],['Acknowledged','No authority acknowledgement supplied.'],['In Progress','No assigned team or progress response supplied.'],['Awaiting Verification','Awaiting a traceable follow-up observation.']
    ].map((t,i)=>`<div class="timeline-item"><div class="timeline-dot ${i===0&&a.created?'active':''}"></div><div class="timeline-copy"><strong>${t[0]}</strong><p>${esc(t[1])}</p></div></div>`).join('')}</div><div class="action-row">${btn('Open Action Package','open-actions','secondary')}${btn('Record a new observation','new-followup','primary')}</div></div></div>
    <div class="card"><div class="card-header"><h2>Follow-up observation</h2>${status(f.draftSaved?'Draft saved':'Not recorded',f.draftSaved?'demo':'neutral')}</div><div class="card-body"><form id="followup-form"><div class="form-grid">
      <div class="field span-2"><label>Observation source *</label><select name="source" required data-bind="followUp.source"><option value="">Select traceable source</option><option value="Authorised field observation (draft)" ${f.source==='Authorised field observation (draft)'?'selected':''}>Authorised field observation (manual draft)</option><option value="Connected sensor (not configured)" ${f.source==='Connected sensor (not configured)'?'selected':''}>Connected sensor (not configured)</option></select><div class="field-help">Selecting a source here records a draft only; it does not validate that a real sensor is connected.</div></div>
      <div class="field"><label>Parameter</label><input name="parameter" data-bind="followUp.parameter" value="${attr(f.parameter)}" placeholder="e.g. particulate matter" required /></div><div class="field"><label>Value *</label><input name="value" data-bind="followUp.value" value="${attr(f.value)}" placeholder="Enter observed value" required /></div><div class="field"><label>Unit *</label><input name="unit" data-bind="followUp.unit" value="${attr(f.unit)}" placeholder="e.g. µg/m³" required /></div><div class="field"><label>Observation timestamp *</label><input name="observedAt" type="datetime-local" data-bind="followUp.observedAt" value="${attr(f.observedAt)}" required /></div><div class="field"><label>Location / sensor reference *</label><input name="location" data-bind="followUp.location" value="${attr(f.location)}" placeholder="Location or sensor ID" required /></div><div class="field"><label>Coordinates / coverage</label><input name="coordinates" data-bind="followUp.coordinates" value="${attr(f.coordinates)}" placeholder="Coordinates or coverage notes" /></div><div class="field span-2"><label>Conditions / notes</label><textarea name="notes" data-bind="followUp.notes" placeholder="Weather context, data quality, limitations, alternate explanations">${esc(f.notes)}</textarea></div>
    </div><div class="action-row" style="margin-top:15px">${btn('Save follow-up draft','save-followup','primary',{extra:'type="submit"'})}${btn('Reopen Investigation','reopen-investigation','secondary')}</div></form>
    ${f.draftSaved?notice('FOLLOW-UP DRAFT SAVED','The form values are stored in this browser session for the prototype. They have not been submitted to an external data service or verified as a real observation.','blue'):''}
    </div></div></div>
    <div class="card" style="margin-top:15px"><div class="card-header"><h2>Verification gate</h2>${status('Cannot close','missing')}</div><div class="card-body"><p class="muted" style="line-height:1.55;margin-top:0">A valid verification would require a traceable later observation source, timestamp, location, comparable time window, coverage/freshness checks, an actual expected output from a successful model run, and configured permission/closure criteria. Those requirements are not met in this build.</p><div class="action-row">${btn('Close case','close-case','primary',{disabled:true,title:'Requires real verification evidence, permissions and closure criteria'})}${btn('Preview closed example state','preview-closed','amber')}</div></div></div>
  </div>`;
}

function renderS13Closed() {
  return `<div class="page-content">
    ${pageHeader('S13 • CLOSED STATE EXAMPLE','Case closure recorded — illustrative example','This page mirrors the closure state shown in the visual reference. It is not an operational closure or verification event.')}
    ${notice('ILLUSTRATIVE CLOSED STATE ONLY','Production closure requires authorised permissions and applicable verification criteria. No connected follow-up observation or municipal status event has been recorded.','blue')}
    <div class="card" style="margin-top:15px"><div class="card-body"><div class="eyebrow">CASE STATUS</div><h2 style="font-size:25px;margin:0 0 10px">Closed • example only</h2><p class="muted" style="line-height:1.55">No actual close timestamp, assigned team, outcome verification or causal relationship is asserted. The operational case remains in draft / awaiting evidence.</p><div class="action-row">${btn('Return to follow-up','open-followup','secondary')}${btn('Reopen investigation','reopen-investigation','primary')}</div></div></div>
  </div>`;
}

function renderModal() {
  if (!state.modal) return '';
  const m = state.modal;
  if (m.type === 'discard') return `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">Discard unsaved scenario edits?</h2><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><div class="modal-body">${notice('Changes may be lost','Your selected hotspot and operating area will remain. Only staged inputs for this intervention branch will be reset if you discard.','')}<p class="muted">Choose Keep editing to preserve your settings or Discard and return to S07.</p></div><div class="modal-footer">${btn('Keep editing','close-modal','secondary')}${btn('Discard and return to S07','confirm-discard','danger')}</div></section></div>`;
  if (m.type === 'reject-scenario' || m.type === 'reject-review') return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">Confirm rejection</h2><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><div class="modal-body">${notice('Reject this recommendation?','The workflow will return to hotspot investigation. Context is preserved; no external action is executed.','red')}<p class="muted">Rejection is a human decision and should be recorded deliberately.</p></div><div class="modal-footer">${btn('Cancel','close-modal','secondary')}${btn('Confirm rejection','confirm-reject','danger')}</div></section></div>`;
  if (m.type === 'site-verification' || m.type === 'additional-evidence') {
    const isSite = m.type === 'site-verification';
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${isSite?'Request site verification':'Request additional evidence'}</h2><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><form id="request-form"><div class="modal-body">${notice('Draft request only','No external task, team assignment or evidence request service is connected. Saving creates a local draft only.','blue')}<div class="form-grid"><div class="field span-2"><label>Selected location</label><input name="location" readonly value="${attr(hotspotLabel())}" /></div>${isSite?`<div class="field span-2"><label>Reason for site verification *</label><textarea name="reason" required placeholder="Describe what needs to be checked on site"></textarea></div><div class="field span-2"><label>Requested team (if configured)</label><input name="team" placeholder="Not configured" /></div>`:`<div class="field span-2"><label>Evidence type *</label><select name="evidenceType" required><option value="">Select evidence type</option><option>Air-quality observation</option><option>Meteorology / wind</option><option>Building-height / geometry</option><option>Traffic / emissions</option><option>Other authorised evidence</option></select></div><div class="field span-2"><label>Why it is needed *</label><textarea name="reason" required placeholder="Describe the missing evidence and the decision it affects"></textarea></div>`}<div class="field span-2"><label>Time window</label><input readonly value="${attr(state.timeWindow)}" /></div><div class="field span-2"><label>Supporting evidence / notes</label><textarea name="notes" placeholder="Known source, timestamp, limitations (if any)"></textarea></div></div></div><div class="modal-footer">${btn('Cancel','close-modal','secondary')}${btn('Save draft request','submit-request','primary',{extra:'type="submit"'})}</div></form></section></div>`;
  }
  if (m.type === 'camera-help') return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">Map camera controls</h2><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body">${notice('Leaflet map capability','Zoom, pan, layer visibility and feature selection are interactive. The 3D mode uses MapLibre GL with vector-tile building extrusions. Street-level pollution concentrations are not scientifically validated; the displayed plume is a weather-responsive visualization proxy, not a dispersion-model result.','blue')}</div><div class="modal-footer">${btn('Close','close-modal','primary')}</div></section></div>`;
  if (m.type === 'help') return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">About Urban-VentAI</h2><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><p>Urban-VentAI is a municipal pollution-intelligence workflow prototype. The design preserves the S01–S13 review lifecycle.</p>${notice('Data integrity by design','Observed measurements, modelled output, illustrative fixtures and unavailable sources remain distinct. Consequential actions are blocked until their prerequisites are real and validated.','blue')}<p class="tiny muted">Build status: no source API, dispersion model, route engine, municipal submission endpoint or authentication provider is configured.</p></div><div class="modal-footer">${btn('Close','close-modal','primary')}</div></section></div>`;
  return '';
}

function renderToast() {
  if (!toastMessage) return '';
  return `<div class="toast-stack"><div class="toast ${toastKind==='warn'?'warn':toastKind==='error'?'error':''}" role="status">${esc(toastMessage)}</div></div>`;
}

function getPersistedArea() {
  try { const raw = localStorage.getItem('urban-ventai-last-area'); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function showToast(message, kind = 'info') {
  toastMessage = message; toastKind = kind;
  renderToastOnly();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMessage = null; renderToastOnly(); }, 3800);
}
function renderToastOnly() {
  const old = document.querySelector('.toast-stack');
  if (old) old.remove();
  if (toastMessage) root.insertAdjacentHTML('beforeend', renderToast());
}

function setDeep(obj, path, value) {
  const parts = path.split('.'); let target = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (target[parts[i]] == null) target[parts[i]] = {}; target = target[parts[i]]; }
  const key = parts[parts.length - 1];
  if (['footprint','height','orientation'].includes(key)) value = Number(value);
  target[key] = value;
}
function syncSourceOfTruthFromVisibleInputs() {
  const controls = document.querySelectorAll('[data-bind]');
  controls.forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') return;
    if (el.dataset.bind && el.value !== undefined) setDeep(state, el.dataset.bind, el.value);
  });
  document.querySelectorAll('[data-check]').forEach(el => { state.evidence[el.dataset.check] = el.checked; });
  document.querySelectorAll('[data-vis]').forEach(el => { state.visualization[el.dataset.vis] = el.checked; });
}

function goto(screen, opts = {}) {
  syncSourceOfTruthFromVisibleInputs();
  if (screen === 'S06' && state.screen !== 'S06') state.dataHealthReturn = state.screen;
  state.previousScreen = state.screen;
  state.screen = screen;
  if (opts.previewOnly !== undefined) state.comparison.previewOnly = opts.previewOnly;
  state.modal = null;
  render();
}
function resetBranchConfig(branch) {
  if (branch === 'A') state.intervention.traffic = { corridor: 'Corridor 03', alternative: 'Not calculated', period: 'Next 24 hours (proposed)', restrictions: 'Emergency access must remain available', assumptions: 'Route graph and traffic data required' };
  if (branch === 'B') state.intervention.green = { selectedSite: 'S1', compare: false, criteria: ['street context','land access','exposure / airflow','effect assumptions'] };
  if (branch === 'C') state.intervention.construction = { footprint: 48, height: 18, orientation: 30, previewed: false };
}
function attemptScenario() {
  syncSourceOfTruthFromVisibleInputs();
  let missing = [];
  const branch = state.intervention.branch;
  if (branch === 'A') missing = ['supported road graph', 'route engine', 'traffic / emissions evidence'];
  else if (branch === 'B') missing = ['verified site / land data', 'ownership / access', 'intervention-effect model'];
  else if (branch === 'C') missing = ['complete building geometry', 'valid airflow / dispersion model'];
  else missing = ['selected intervention branch'];
  state.scenarioRun = normalizeRunAttempt({ requiredInputs: missing, modelAvailable: false, routeEngineAvailable: false, effectModelAvailable: false });
  state.scenarioRun.branch = branch;
  state.scenarioRun.error = `Required inputs unavailable: ${missing.join(', ')}. No calculation was started; no run ID or output exists.`;
  state.screen = 'S09';
  state.previousScreen = 'S09';
  render();
}

function performAction(action, el) {
  syncSourceOfTruthFromVisibleInputs();
  const [name, value] = action.split(':');
  switch (name) {
    case 'go-command': goto('S02'); break;
    case 'navigate': goto(value); break;
    case 'change-area': areaReturnScreen = state.screen; goto('S01'); break;
    case 'cancel-area': if (areaReturnScreen) { const target=areaReturnScreen; areaReturnScreen=null; goto(target); } else showToast('Choose an operating area to continue.','warn'); break;
    case 'open-command': {
      const city = document.getElementById('city-select')?.value || state.area.city;
      const ward = document.getElementById('ward-select')?.value || state.area.ward;
      const result = changeOperatingArea(state, city, ward);
      Object.assign(state, result);
      try { localStorage.setItem('urban-ventai-last-area', JSON.stringify({ city, ward, savedAt: new Date().toISOString(), storage: 'this browser' })); } catch { /* persistence is optional */ }
      areaReturnScreen = null; render(); break;
    }
    case 'open-map': goto('S03'); break;
    case 'inspect-hotspot': if (state.hotspot) goto('S04'); else showToast('Select an illustrative map cell first.','warn'); break;
    case 'open-evidence': goto('S05'); break;
    case 'open-health': goto('S06'); break;
    case 'return-health': goto(state.dataHealthReturn || 'S02'); break;
    case 'return-map': goto('S03'); break;
    case 'open-planning': goto('S07'); break;
    case 'open-actions': goto('S12'); break;
    case 'open-report': goto('REPORT'); break;
    case 'open-followup': goto('S13'); break;
    case 'new-followup': goto('S13'); setTimeout(() => document.querySelector('[name="source"]')?.focus(), 50); break;
    case 'reopen-investigation': goto('S04'); break;
    case 'toggle-layer-controls': state.visualization.controlsExpanded = !state.visualization.controlsExpanded; render(); break;
    case 'toggle-particles': state.visualization.particles = !state.visualization.particles; render(); break;
    case 'toggle-plume': state.visualization.plume = !state.visualization.plume; render(); break;
    case 'toggle-cells': state.visualization.cells = !state.visualization.cells; render(); break;
    case 'toggle-wind': state.visualization.wind = !state.visualization.wind; render(); break;
    case 'toggle-sensors': state.visualization.sensors = !state.visualization.sensors; render(); break;
    case 'toggle-geometry': state.visualization.geometry = !state.visualization.geometry; render(); break;
    case 'toggle-pause': state.visualization.paused = !state.visualization.paused; render(); break;
    case 'toggle-legend': state.visualization.legend = !state.visualization.legend; render(); break;
    case 'camera-note': state.visualization.cameraNote = !state.visualization.cameraNote; state.modal = null; render(); break;
    case 'weather-stale': state.weatherStale = !state.weatherStale; state.visualization.wind = false; render(); showToast(state.weatherStale ? 'Prototype stale-weather variant enabled; no real weather timestamp exists.' : 'Stale-weather prototype variant cleared.'); break;
    case 'map-zoom-in': mapZoom(el?.dataset.mapid, 1); break;
    case 'map-zoom-out': mapZoom(el?.dataset.mapid, -1); break;
    case 'map-reset': mapReset(el?.dataset.mapid); break;
    case 'locate-me': locateMe(); break;
    case 'toggle-map-mode': {
      const current3D = state.visualization.viewMode === '3D';
      const key2D = state.screen === 'S02' ? 'leaflet-command' : 'leaflet-main';
      const key3D = state.screen === 'S02' ? 'maplibre-command' : 'maplibre-main';
      const currentMap = current3D ? maplibreMaps.get(key3D) : maps.get(key2D);
      if (currentMap) {
        try {
          const center = current3D ? currentMap.getCenter() : currentMap.getCenter();
          const zoom = currentMap.getZoom();
          mapViewCache.set(current3D ? key2D : key3D, {
            center: [center.lng, center.lat], zoom,
            pitch: current3D ? currentMap.getPitch() : 58,
            bearing: current3D ? currentMap.getBearing() : -22,
            mode: current3D ? '2D' : '3D'
          });
        } catch { /* map could be loading during mode switch */ }
      }
      state.visualization.viewMode = current3D ? '2D' : '3D'; render(); break;
    }
    case 'refresh-live-data': ensureLiveEnvironment(true); showToast('Requesting a fresh data response. The model timestamp may remain unchanged if the provider has not published a new timestep.','info'); break;
    case 'choose-place': selectPlace(Number(value)); break;
    case 'show-help': state.modal = {type:'help'}; render(); break;
    case 'request-site': state.modal = {type:'site-verification'}; render(); break;
    case 'request-evidence': state.modal = {type:'additional-evidence'}; render(); break;
    case 'close-modal': state.modal = null; render(); break;
    case 'submit-request': if (el?.type === 'submit') return; else document.getElementById('request-form')?.requestSubmit(); break;
    case 'request-submit': saveRequestDraft(); break;
    case 'compare-evidence': state.evidence.comparisonOpen = !state.evidence.comparisonOpen; render(); break;
    case 'continue-planning': if (state.evidence.qualified) goto('S07'); else showToast('Blocked: production evidence criteria are not satisfied. Use the explicitly labelled prototype preview only to view downstream UI.','warn'); break;
    case 'preview-qualified': state.evidence.previewQualified = true; state.evidence.qualified = false; goto('S07'); showToast('Prototype example entered. This does not qualify evidence or enable a real calculation.','warn'); break;
    case 'select-branch': state.intervention.branch = value; state.intervention.unsaved = false; state.scenarioRun = {status:'not-calculated',isIllustrative:false,validated:false,runId:null,error:null,branch:value}; goto(`S08${value}`); break;
    case 'run-scenario': attemptScenario(); break;
    case 'cancel-scenario': if (state.intervention.unsaved) { state.modal = {type:'discard', branch:state.intervention.branch}; render(); } else { state.intervention.branch = null; goto('S07'); } break;
    case 'confirm-discard': resetBranchConfig(state.intervention.branch); state.intervention.branch = null; state.intervention.unsaved = false; state.modal = null; state.screen = 'S07'; render(); break;
    case 'preview-geometry': state.intervention.construction.previewed = true; state.intervention.unsaved = true; render(); showToast('Geometry preview updated. No airflow or pollution impact was calculated.','warn'); break;
    case 'select-site': state.intervention.green.selectedSite = value; state.intervention.unsaved = true; render(); break;
    case 'select-site-confirm': state.intervention.green.unsaved = false; showToast(`Selected site ${state.intervention.green.selectedSite} remains an illustrative candidate.`,'warn'); break;
    case 'compare-candidates': state.intervention.green.compare = !state.intervention.green.compare; render(); break;
    case 'return-setup': goto(state.intervention.branch ? `S08${state.intervention.branch}` : 'S07'); break;
    case 'preview-completed': state.scenarioRun = {status:'completed',isIllustrative:true,validated:true,runId:null,error:'Illustrative Figma-style success state only. No live model run was executed.',branch:state.intervention.branch}; goto('S09'); break;
    case 'view-comparison-preview': goto('S10',{previewOnly:true}); break;
    case 'valid-compare': if (canOpenValidComparison(state.scenarioRun)) goto('S10',{previewOnly:false}); else showToast('Comparison is locked until a real successful validated calculation exists.','warn'); break;
    case 'inspect-changed-area': state.comparison.changedArea = value || 'Central cells'; render(); break;
    case 'adjust': state.intervention.branch=value; goto(`S08${value}`); break;
    case 'recommend-review': if (canOpenValidComparison(state.scenarioRun)) goto('S11'); else showToast('Recommendation is blocked because no real validated calculation exists.','warn'); break;
    case 'open-review-preview': goto('S11'); showToast('Read-only prototype review layout opened; approval remains blocked.','warn'); break;
    case 'reject-scenario': state.modal={type:'reject-scenario'}; render(); break;
    case 'reject-review': state.modal={type:'reject-review'}; render(); break;
    case 'confirm-reject': state.review.decision='rejected'; state.modal=null; goto('S04'); showToast('Recommendation rejected in this local workflow state. No external action was executed.'); break;
    case 'approve-review': if (canApproveForSubmission(state)) goto('S12'); else showToast('Approval requires a validated real run, qualified evidence and an explicitly identified reviewer.','warn'); break;
    case 'prepare-action': state.actionRecord.created=true; state.actionRecord.status='draft'; state.actionRecord.timeline=[{status:'Draft',detail:'Action record prepared locally; not submitted to a municipal system.'}]; goto('S12'); showToast('Action record prepared as a local draft.'); break;
    case 'submit-action': if (canSubmitAction({integrationConfigured:false,authorized:false,confirmedResponse:false})) showToast('Submission confirmed.'); else showToast('Blocked: municipal integration and confirmation response are unavailable. Action remains Draft.','warn'); break;
    case 'export-html': generateReportExport(); break;
    case 'save-followup': if (el?.type === 'submit') return; else document.getElementById('followup-form')?.requestSubmit(); break;
    case 'preview-closed': state.followUp.closedPreview=true; goto('S13CLOSED'); break;
    case 'close-case': if (canCloseCase({authorized:false,criteriaSatisfied:false,observation:null})) showToast('Case closed.'); else showToast('Closure blocked: permissions, criteria and validated follow-up evidence are not configured.','warn'); break;
    default: showToast(`No handler exists for ${action}.`,'error');
  }
}

function saveRequestDraft() {
  const form = document.getElementById('request-form');
  if (!form) return;
  if (!form.reportValidity()) return;
  const fd = new FormData(form); state.request = Object.fromEntries(fd.entries());
  state.request.kind = state.modal?.type === 'site-verification' ? 'site-verification draft' : 'additional-evidence draft';
  state.modal = null; render(); showToast('Draft request saved locally. No external task was created.','warn');
}

function generateReportExport() {
  syncSourceOfTruthFromVisibleInputs();
  const filename = `urban-ventai-evidence-draft-${new Date().toISOString().slice(0,10)}.html`;
  const reportHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Urban-VentAI Evidence Draft</title><style>body{font:14px system-ui,sans-serif;max-width:820px;margin:38px auto;padding:0 20px;color:#172b3b}h1{border-bottom:2px solid #12a894;padding-bottom:12px}h2{margin-top:25px} .label{color:#607486;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.warn{padding:12px;border:1px solid #ecd08b;background:#fff5d9;border-radius:8px}</style></head><body><h1>URBAN-VENTAI / MUNICIPAL EVIDENCE REPORT</h1><p class="label">DRAFT • ILLUSTRATIVE • NOT LIVE</p><div class="warn"><strong>Data integrity note:</strong> This report contains no real sensor readings or validated model output. Do not treat it as a pollution-source determination or official action submission.</div><h2>Operating area</h2><p>${esc(currentArea())} • ${esc(state.area.illustrative ? 'Illustrative area' : 'Configured area')}</p><h2>Hotspot and time window</h2><p>${esc(hotspotLabel())} • ${esc(state.timeWindow)}</p><h2>Intervention</h2><p>${esc(currentBranchLabel())}</p><h2>Sources and calculation</h2><ul>${Object.values(state.sources).map(s=>`<li><strong>${esc(s.label)}:</strong> ${esc(s.status)}; source ${esc(s.source)}; observation/model time ${esc(s.observationTime)}; refresh ${esc(s.refreshTime)}.</li>`).join('')}</ul><p>Scenario state: ${esc(state.scenarioRun.status)}. Run ID: ${esc(state.scenarioRun.runId || 'None')}. No model run is asserted.</p><h2>Assumptions and limitations</h2><ul><li>Observed data is separate from modelled and illustrative overlays.</li><li>Hotspot does not prove source attribution.</li><li>No numeric intervention effect is available.</li><li>External municipal submission is not configured.</li></ul><h2>Action status</h2><p>${esc(state.actionRecord.status.toUpperCase())} • Not submitted to an external system.</p><p>Generated locally in the browser on ${esc(new Date().toISOString())}.</p></body></html>`;
  try {
    const blob = new Blob([reportHtml], {type:'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    state.report.exported = true; state.report.lastFilename = filename; state.report.previewOpen = true;
    render(); showToast(`Generated local HTML draft: ${filename}`);
  } catch (err) {
    showToast('Local report export failed in this browser. The preview is unchanged.','error');
  }
}

function mapZoom(mapId, direction) {
  const map = maps.get(mapId) || [...maps.values()][0];
  const map3d = maplibreMaps.get(mapId) || [...maplibreMaps.values()][0];
  if (map) direction > 0 ? map.zoomIn() : map.zoomOut();
  else if (map3d) direction > 0 ? map3d.zoomIn() : map3d.zoomOut();
  else showToast('Map controls are available once the map has loaded.','warn');
}
function mapReset(mapId) {
  const map = maps.get(mapId);
  const map3d = maplibreMaps.get(mapId);
  if (map) map.setView(mapCenterLatLng(),15,{animate:true});
  else if (map3d) map3d.easeTo({center:[liveRuntime.location.lon,liveRuntime.location.lat],zoom:15.5,pitch:56,bearing:-20,duration:650});
  else showToast('Map reset is unavailable while the map is offline.','warn');
}
function initMapsForScreen() {
  const configs = [];
  const id = state.screen;
  if ((id === 'S02' || id === 'S03') && state.visualization.viewMode === '3D') { setTimeout(() => initMapLibre3D(id === 'S02' ? 'maplibre-command' : 'maplibre-main'), 40); return; }
  if (id === 'S02') configs.push({id:'leaflet-command',mode:'overview',interactive:true});
  if (id === 'S03') configs.push({id:'leaflet-main',mode:'main',interactive:true});
  if (id === 'S04') configs.push({id:'leaflet-hotspot',mode:'hotspot',interactive:true});
  if (id === 'S08A') configs.push({id:'leaflet-traffic',mode:'traffic',interactive:false});
  if (id === 'S08B') configs.push({id:'leaflet-green',mode:'green',interactive:false});
  if (id === 'S08C') configs.push({id:'leaflet-existing',mode:'existing',interactive:false},{id:'leaflet-proposed',mode:'proposed',interactive:false});
  if (id === 'S10') configs.push({id:'leaflet-baseline',mode:'baseline',interactive:false},{id:'leaflet-intervention',mode:'intervention',interactive:false});
  if (id === 'S11') configs.push({id:'leaflet-review',mode:'review',interactive:false});
  setTimeout(() => configs.forEach(cfg => initLeafletMap(cfg)), 40);
}
async function initMapLibre3D(mapKey = 'maplibre-main') {
  const el = document.getElementById(mapKey);
  if (!el || current3DId() !== mapKey) return;
  if (!window.maplibregl) {
    // Retry as a dynamic script in case the deferred CDN script was blocked/raced.
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
        script.onload = resolve; script.onerror = () => reject(new Error('MapLibre CDN could not be loaded.'));
        document.head.appendChild(script);
        setTimeout(() => reject(new Error('MapLibre loading timed out.')), 10000);
      });
    } catch {
      if (current3DId() === mapKey) {
        state.visualization.viewMode = '2D';
        render();
        showToast('3D map library unavailable in this browser/network; switched to Leaflet 2D. Check CDN access to enable 3D.','warn');
      }
      return;
    }
  }
  if (!window.maplibregl || current3DId() !== mapKey) return;
  let map;
  const setupWeather = effWeather(), setupAir = effAir();
  try {
    const savedView = mapViewCache.get(mapKey);
    map = new window.maplibregl.Map({
      container: el,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: savedView?.mode === '3D' ? savedView.center : [liveRuntime.location.lon, liveRuntime.location.lat],
      zoom: savedView?.mode === '3D' ? savedView.zoom : 15.5, pitch: savedView?.mode === '3D' ? savedView.pitch : 58, bearing: savedView?.mode === '3D' ? savedView.bearing : -22,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true }
    });
    maplibreMaps.set(mapKey, map);
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-left');
    map.addControl(new window.maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
    let notifiedStyleFailure = false;
    map.on('error', event => {
      if (!notifiedStyleFailure && event?.error && /style|source|tile/i.test(String(event.error.message || ''))) {
        notifiedStyleFailure = true;
        showToast('3D map data service returned an error. Verify network access or use Switch to 2D.','warn');
      }
    });
    map.on('load', () => {
      if (current3DId() !== mapKey || maplibreMaps.get(mapKey) !== map) return;
      try {
        const styleLayers = map.getStyle()?.layers || [];
        const buildingTemplate = styleLayers.find(layer => String(layer['source-layer'] || '').toLowerCase() === 'building' && layer.source);
        if (buildingTemplate && !map.getLayer('urban-buildings-3d')) {
          const firstLabel = styleLayers.find(layer => layer.type === 'symbol' && layer.layout && layer.layout['text-field']);
          map.addLayer({
            id: 'urban-buildings-3d', type: 'fill-extrusion', source: buildingTemplate.source,
            'source-layer': buildingTemplate['source-layer'], minzoom: 14,
            filter: ['!=', ['get','hide_3d'], true],
            paint: {
              'fill-extrusion-color': ['interpolate',['linear'],['coalesce',['to-number',['get','render_height']],8],0,'#657d8b',25,'#8a9eaa',80,'#b9c9cf',180,'#e0e9e9'],
              'fill-extrusion-height': ['interpolate',['linear'],['zoom'],14,0,15,['coalesce',['to-number',['get','render_height']],8]],
              'fill-extrusion-base': ['coalesce',['to-number',['get','render_min_height']],0],
              'fill-extrusion-opacity': 0.88
            }
          }, firstLabel?.id);
        }
        const initialField = buildWindResponsiveField(liveRuntime.location, setupWeather, setupAir);
        map.addSource('wind-field-source', { type:'geojson', data:initialField });
        map.addLayer({
          id:'wind-field-extrusions',type:'fill-extrusion',source:'wind-field-source',minzoom:13,
          paint:{
            'fill-extrusion-color':['interpolate',['linear'],['get','intensity'],0,'#34b7c4',0.32,'#9bce84',0.55,'#f1c65c',0.78,'#ee8c46',1,'#d74c52'],
            'fill-extrusion-height':['get','heightMeters'],
            'fill-extrusion-base':0,
            'fill-extrusion-opacity':0.68
          }
        });
        map.addSource('wind-plume-source',{type:'geojson',data:add3DWindEnvelope(liveRuntime.location,setupWeather)});
        map.addLayer({id:'wind-plume-envelope',type:'fill-extrusion',source:'wind-plume-source',minzoom:12,paint:{'fill-extrusion-color':'#ef8052','fill-extrusion-height':38,'fill-extrusion-base':1,'fill-extrusion-opacity':0.24}});
        map.addSource('wind-vector-source',{type:'geojson',data:add3DWindVector(liveRuntime.location,setupWeather)});
        map.addLayer({id:'wind-vector-line',type:'line',source:'wind-vector-source',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#18a7d0','line-width':4,'line-opacity':0.9,'line-dasharray':[1.2,1.4]}});
        map.addSource('wind-particles-source',{type:'geojson',data:buildDownwindParticles(liveRuntime.location,setupWeather,42,0)});
        map.addLayer({id:'wind-particles-live',type:'circle',source:'wind-particles-source',paint:{'circle-radius':['interpolate',['linear'],['zoom'],13,1.8,17,3.6],'circle-color':'#f7fcff','circle-stroke-color':'#149aba','circle-stroke-width':1,'circle-opacity':0.88}});
        map.addSource('connected-sensors-source',{type:'geojson',data:sensorsToGeoJson(liveRuntime.sensors.sensors)});
        map.addLayer({id:'connected-sensor-points',type:'circle',source:'connected-sensors-source',paint:{'circle-radius':8,'circle-color':['case',['get','stale'],'#9aa6b1','#7965d8'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
        map.addSource('place-focus-source',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{label:liveRuntime.location.name},geometry:{type:'Point',coordinates:[liveRuntime.location.lon,liveRuntime.location.lat]}}]}});
        map.addLayer({id:'place-focus-point',type:'circle',source:'place-focus-source',paint:{'circle-radius':7,'circle-color':'#11a38f','circle-stroke-color':'#fff','circle-stroke-width':3}});
        map.addLayer({id:'place-focus-label',type:'symbol',source:'place-focus-source',layout:{'text-field':['get','label'],'text-offset':[0,1.5],'text-size':12,'text-anchor':'top','text-optional':true},paint:{'text-color':'#0b2637','text-halo-color':'#fff','text-halo-width':1.5}});
        update3DSources(map);
        map.resize();
        state.sources.geometry = { ...state.sources.geometry, status:'delayed', source:'OpenFreeMap / OpenStreetMap vector tiles (connected)', observationTime:'Tile data age not published', refreshTime:new Date().toISOString(), coverage:'3D vector geometry available in the rendered viewport; source height completeness and age are not verified.', affects:'Urban morphology context and visual building heights only; not a calibrated airflow solver.' };
        ensureParticleTimer();
        map.on('click', event => {
          if (current3DId() !== mapKey) return;
          const hit = map.getLayer('connected-sensor-points') ? map.queryRenderedFeatures(event.point, { layers: ['connected-sensor-points'] })[0] : null;
          if (hit) {
            const props = hit.properties || {};
            new window.maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(hit.geometry.coordinates).setHTML(sensorPopupHtml({ name: props.name, value: Number(props.value), unit: props.unit, provider: props.provider }, props.ageMinutes === null || props.ageMinutes === undefined || props.ageMinutes === 'null' ? null : Math.round(Number(props.ageMinutes)))).addTo(map);
            return;
          }
          setMapInvestigationLocation(event.lngLat.lat,event.lngLat.lng);
        });
        map.on('mouseenter','connected-sensor-points',()=>{ map.getCanvas().style.cursor='pointer'; });
        map.on('mouseleave','connected-sensor-points',()=>{ map.getCanvas().style.cursor=''; });
      } catch (error) {
        showToast(`3D layer setup incomplete: ${error?.message || 'unknown error'}. Base map may still be usable.`, 'warn');
      }
    });
  } catch (error) {
    if (current3DId() === mapKey) {
      state.visualization.viewMode='2D'; render();
      showToast('3D map initialization failed; switched to Leaflet 2D.','warn');
    }
  }
}
function initLeafletMap(cfg) {
  const el = document.getElementById(cfg.id);
  if (!el) return;
  if (!window.L) { renderFallbackMap(el, cfg); return; }
  try {
    const savedView = mapViewCache.get(cfg.id);
    const map = window.L.map(el, { zoomControl:false, scrollWheelZoom:true, attributionControl:true, zoomAnimation:true }).setView(savedView?.mode === '2D' ? [savedView.center[1], savedView.center[0]] : mapCenterLatLng(), savedView?.mode === '2D' ? savedView.zoom : (cfg.mode==='overview'?14:15));
    maps.set(cfg.id,map);
    const showTiles = cfg.mode !== 'main' || state.visualization.geometry;
    if (showTiles) {
      const tiles = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap contributors'});
      tiles.addTo(map);
      tiles.on('tileerror', () => { /* Leaflet will continue requesting neighbouring tiles as the user moves */ });
    }
    // Do not fabricate hot cells, sensors, routes or measured pollution. The only
    // local field shown is explicitly a weather-responsive visualization proxy.
    if (['main','overview'].includes(cfg.mode) && (liveRuntime.weather || liveRuntime.air) && (state.visualization.cells || state.visualization.plume || state.visualization.wind)) addWeatherFieldToLeaflet(map,{mode:cfg.mode});
    if (['main','overview','hotspot'].includes(cfg.mode)) addSensorMarkersLeaflet(map);
    // No connected sensor feed: intentionally draw no sensor pins.
    if (cfg.mode === 'proposed' && state.intervention.construction.previewed) addProposedFootprint(map);
    if (cfg.mode === 'green') addHypotheticalCandidateMarkers(map);
    if (state.hotspot?.type === 'map-location' || liveRuntime.location.selected) addMapLocationMarker(map);
    if (cfg.interactive) {
      map.on('click', ev => {
        if (['S02','S03','S04'].includes(state.screen)) setMapInvestigationLocation(ev.latlng.lat,ev.latlng.lng);
        else showToast('Map click recorded as geographic context only; no route or intervention outcome is calculated.','warn');
      });
    }
    setTimeout(() => map.invalidateSize(), 80);
  } catch (error) {
    renderFallbackMap(el,cfg);
  }
}
function setMapInvestigationLocation(lat,lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const display = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  liveRuntime.location = {name:'Selected map location',displayName:display,lat,lon,selected:true,provider:'Map click coordinates'};
  liveRuntime.weather = null; liveRuntime.air = null; liveRuntime.errors = {}; liveRuntime.fetchedAt=null; liveRuntime.fetchKey=null;
  state.sources.weather = { ...SOURCE_STATUSES.weather };
  state.sources.air = { ...SOURCE_STATUSES.air };
  state.hotspot = {id:'LOC-01',label:'Selected investigation location',location:display,lat,lng:lon,type:'map-location'};
  state.area = {...state.area, ward:`Map point ${display}`, locationName:'Selected map location',displayName:display,lat,lon,illustrative:true};
  state.evidence.qualified=false;
  state.scenarioRun={status:'not-calculated',isIllustrative:false,validated:false,runId:null,error:null,branch:null};
  state.timeWindow='Current model conditions';
  try {localStorage.setItem('urban-ventai-selected-place',JSON.stringify({ ...liveRuntime.location, city: state.area.city, ward: state.area.ward }));} catch { /* no persistence required */ }
  liveRuntime.sensors = { status: 'idle', sensors: [], message: '' };
  const map3d = uses3D() ? maplibreMaps.get(current3DId()) : null;
  if (map3d) {
    refreshLiveInPlace();
    ensureLiveEnvironment(true);
  } else {
    pendingMapCenter = [lon, lat];
    render();
    if (!['S02','S03'].includes(state.screen)) ensureLiveEnvironment(true);
  }
  reverseGeocode(lat, lon).then(info => {
    if (!info || liveRuntime.location.lat !== lat || liveRuntime.location.lon !== lon) return;
    liveRuntime.location = { ...liveRuntime.location, name: info.name, displayName: info.displayName };
    state.hotspot = state.hotspot ? { ...state.hotspot, label: `Selected location: ${info.name}`, location: info.displayName } : state.hotspot;
    state.area = { ...state.area, locationName: info.name, displayName: info.displayName, ward: `${info.name} • Map point` };
    if (uses3D() && maplibreMaps.get(current3DId())) refreshLiveInPlace(); else if (['S02','S03','S04'].includes(state.screen)) render();
  }).catch(() => { /* name lookup is optional */ });
  showToast('Selected map coordinates for investigation. This is not a detected pollution hotspot; input quality remains unqualified.','warn');
}
function addHypotheticalCandidateMarkers(map) {
  const L=window.L, center=mapCenterLatLng(), mLon=Math.max(1,111320*Math.cos(center[0]*Math.PI/180));
  const candidates=[['S1',-210,-90],['S2',160,170],['S3',220,-180]];
  candidates.forEach(([id,east,north])=>{
    const lat=center[0]+north/111320, lon=center[1]+east/mLon;
    const active=state.intervention.green.selectedSite===id;
    L.circleMarker([lat,lon],{radius:active?9:6,color:'#fff',weight:2,fillColor:active?'#0d8d7e':'#7867d5',fillOpacity:.95})
      .addTo(map).bindPopup(`<strong>${id} • hypothetical planning point</strong><br/>Placed relative to the selected map location for scenario comparison only. Site ownership, land access, vegetation, measured airflow and suitability are not verified.`);
  });
}function addProposedFootprint(map) {
  const L=window.L, center=mapCenterLatLng();
  const widthM=Math.max(10,Number(state.intervention.construction.footprint)||48);
  const depthM=Math.max(10,widthM*0.72);
  const angle=(Number(state.intervention.construction.orientation)||0)*Math.PI/180;
  const mLat=111320, mLon=Math.max(1,111320*Math.cos(center[0]*Math.PI/180));
  const corners=[[-widthM/2,-depthM/2],[widthM/2,-depthM/2],[widthM/2,depthM/2],[-widthM/2,depthM/2],[-widthM/2,-depthM/2]];
  const points=corners.map(([x,y])=>{const east=x*Math.cos(angle)-y*Math.sin(angle), north=x*Math.sin(angle)+y*Math.cos(angle);return [center[0]+north/mLat,center[1]+east/mLon];});
  L.polygon(points,{color:'#6554be',weight:2,fillColor:'#8879e3',fillOpacity:.65}).addTo(map)
    .bindTooltip(`Proposed footprint ${widthM} m × ${depthM.toFixed(0)} m; proposed height ${Number(state.intervention.construction.height)||18} m. Preview geometry only; airflow impact not calculated.`);
}
function renderFallbackMap(el,cfg) {
  if (!el || el.dataset.fallback === '1') return;
  el.dataset.fallback='1';
  const label = cfg.mode==='main'?'Live map library unavailable':'Map tile service unavailable';
  el.innerHTML=`<div class="map-fallback" role="status"><div class="fallback-label"><strong>${label}</strong><span>External map assets could not be loaded in this browser/network. No fake pollution cells are shown. Place search can still be used when the geocoder is reachable; try again on a network that allows the map tile services.</span></div><div class="map-base-note">Required public services: Leaflet / OpenStreetMap tiles. The 3D view uses MapLibre / OpenFreeMap vector tiles.</div></div>`;
}

// All controls use delegated events so rerendered screens keep behaviour.
document.addEventListener('click', event => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  if (actionEl.type === 'submit' && ['submit-request','save-followup'].includes(actionEl.dataset.action)) return;
  if (actionEl.type === 'submit') return;
  event.preventDefault();
  performAction(actionEl.dataset.action, actionEl);
});

document.addEventListener('change', event => {
  const el = event.target;
  if (el.matches('[data-bind]')) {
    setDeep(state,el.dataset.bind,el.value);
    if (state.screen.startsWith('S08')) state.intervention.unsaved = true;
    if (el.dataset.control==='timewindow') {
      state.timeWindow=el.value;
      liveRuntime.hourOffset = el.value.startsWith('Past') ? -12 : el.value.startsWith('Next') ? 12 : 0;
      if (liveRuntime.hourOffset && !(liveRuntime.weather?.hourly?.length || liveRuntime.air?.hourly?.length)) showToast('Hourly model series has not loaded yet; showing current values until it arrives.','warn');
      if (uses3D() && maplibreMaps.get(current3DId())) refreshLiveInPlace(); else render();
    } else if (el.dataset.bind==='comparison.changedArea' || el.dataset.bind==='intervention.green.selectedSite') { render(); }
  }
  if (el.matches('[data-hour-slider]') && !uses3D() && ['S02','S03'].includes(state.screen)) render();
  if (el.matches('[data-check]')) { state.evidence[el.dataset.check]=el.checked; }
  if (el.matches('[data-vis]')) { state.visualization[el.dataset.vis]=el.checked; if(el.dataset.vis==='sensors' && el.checked && liveRuntime.sensors.status !== 'connected') showToast(renderSensorSummary(),'warn'); if(el.dataset.vis==='particles' && el.checked && !liveRuntime.weather) showToast('Wind input is unavailable. Particle motion is withheld until a weather-model response is received.','warn'); render(); }
});

document.addEventListener('input', event => {
  const el = event.target;
  if (!el.matches?.('[data-hour-slider]')) return;
  liveRuntime.hourOffset = Number(el.value) || 0;
  state.timeWindow = liveRuntime.hourOffset < 0 ? 'Past 24 h (model series)' : liveRuntime.hourOffset > 0 ? 'Next 24 h (model forecast)' : 'Current model conditions';
  const tw = document.querySelector('[data-control="timewindow"]'); if (tw) tw.value = state.timeWindow;
  document.querySelectorAll('[data-hour-label]').forEach(l => { l.textContent = liveRuntime.hourOffset === 0 ? 'now' : `${liveRuntime.hourOffset > 0 ? '+' : ''}${liveRuntime.hourOffset} h`; });
  const values = document.getElementById('live-values'); if (values) values.innerHTML = renderLiveValues();
  const metrics = document.getElementById('s02-metrics'); if (metrics) metrics.innerHTML = renderS02Metrics();
  document.querySelectorAll('#trend-holder').forEach(h => { h.innerHTML = renderTrendChart(); });
  const map = uses3D() ? maplibreMaps.get(current3DId()) : null;
  if (map) { try { update3DSources(map); } catch { /* style still loading */ } }
});

document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'place-search-form') { submitPlaceSearch(event.target); return; }
  if (event.target.id === 'request-form') { saveRequestDraft(); return; }
  if (event.target.id === 'followup-form') {
    syncSourceOfTruthFromVisibleInputs();
    const form=event.target;
    if (!form.reportValidity()) return;
    const observation={source:state.followUp.source,parameter:state.followUp.parameter,value:state.followUp.value,unit:state.followUp.unit,observedAt:state.followUp.observedAt,location:state.followUp.location,coordinates:state.followUp.coordinates,notes:state.followUp.notes,draft:true,storedIn:'browser session'};
    state.followUp.observations.push(observation);state.followUp.draftSaved=true;render();showToast('Follow-up observation saved as a local draft. It has not been verified or submitted.','warn');
  }
});

// Load a genuinely saved area only when the browser contains one from a prior user action.
const savedArea = getPersistedArea();
if (savedArea && savedArea.city && savedArea.ward) {
  state.lastArea = savedArea;
}
render();
