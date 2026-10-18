import test from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal browser harness (no jsdom available / no network) ----
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const t = realSetInterval(...args); t.unref?.(); return t; };
const listeners = {};
const root = { innerHTML: '', insertAdjacentHTML() {} };
const store = new Map();
const elements = {};
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost' };
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.document = {
  hidden: false,
  getElementById: id => id === 'app' ? root : root.innerHTML.includes(`id="${id}"`) ? (elements[id] ||= { id, style: {}, dataset: {}, querySelector: () => null }) : null,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  createElement: () => ({ style: {} }), body: { appendChild() {} }, head: { appendChild() {} }
};
Object.defineProperty(globalThis, 'navigator', { value: { geolocation: undefined }, configurable: true });

const maps = [];
class FakeMap {
  constructor(opts) { this.opts = opts; this.sources = {}; this.layers = {}; this.handlers = {}; this.removed = false; maps.push(this); setTimeout(() => (this.handlers.load || []).forEach(f => f()), 5); }
  on(evt, a, b) { const fn = b || a; (this.handlers[evt] ||= []).push(fn); return this; }
  addControl() {} resize() {} remove() { this.removed = true; } zoomIn() {} zoomOut() {} easeTo(o) { this.eased = o; }
  addSource(id, def) { const calls = []; this.sources[id] = { def, calls, setData: d => calls.push(d), data: def.data }; }
  getSource(id) { return this.sources[id]; }
  addLayer(def) { this.layers[def.id] = { ...def, visibility: 'visible' }; }
  getLayer(id) { return this.layers[id]; }
  setLayoutProperty(id, prop, value) { if (this.layers[id]) this.layers[id][prop] = value; }
  getStyle() { return { layers: [{ id: 'building', source: 'openmaptiles', 'source-layer': 'building', type: 'fill' }, { id: 'label', type: 'symbol', layout: { 'text-field': '{name}' } }, ...Object.values(this.layers)] }; }
  isStyleLoaded() { return true; } queryRenderedFeatures() { return []; }
  getCenter() { return { lng: this.opts.center[0], lat: this.opts.center[1] }; } getZoom() { return this.opts.zoom; } getPitch() { return this.opts.pitch; } getBearing() { return this.opts.bearing; }
  getCanvas() { return { style: {} }; }
}
globalThis.maplibregl = { Map: FakeMap, NavigationControl: class {}, ScaleControl: class {}, Popup: class { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } } };

const IST = 19800;
function localIso(ms, step = 3600000) { return new Date(Math.floor(ms / step) * step + IST * 1000).toISOString().slice(0, 16); }
const nowMs = Date.now();
const hours = Array.from({ length: 72 }, (_, i) => Math.floor(nowMs / 3600000) * 3600000 + (i - 24) * 3600000);
const calls = [];
globalThis.fetch = async input => {
  const url = new URL(String(input), 'http://localhost'); calls.push(url.pathname);
  const ok = payload => ({ ok: true, status: 200, json: async () => payload });
  if (url.pathname === '/api/weather') return ok({ timezone: 'Asia/Kolkata', utc_offset_seconds: IST, current: { time: localIso(nowMs, 900000), temperature_2m: 27.5, relative_humidity_2m: 70, wind_speed_10m: 2.4, wind_direction_10m: 250, precipitation: 0 }, hourly: { time: hours.map(h => localIso(h)), temperature_2m: hours.map((_, i) => 24 + i % 6), wind_speed_10m: hours.map((_, i) => 1 + i % 5), wind_direction_10m: hours.map((_, i) => (i * 15) % 360), precipitation: hours.map(() => 0) } });
  if (url.pathname === '/api/air-quality') return ok({ timezone: 'Asia/Kolkata', utc_offset_seconds: IST, current: { time: localIso(nowMs, 900000), pm2_5: 41.2, pm10: 70, us_aqi: 112, european_aqi: 60 }, hourly: { time: hours.map(h => localIso(h)), pm2_5: hours.map((_, i) => 20 + i), pm10: hours.map((_, i) => 40 + i), us_aqi: hours.map((_, i) => 60 + i) } });
  if (url.pathname === '/api/sensors') return ok({ source: 'OpenAQ v3', fetchedAt: new Date().toISOString(), radiusMeters: 25000, sensors: [{ name: 'Test Station', provider: 'OpenAQ', lat: 12.98, lon: 77.6, value: 55.5, unit: 'µg/m³', observedAtUtc: new Date(nowMs - 20 * 60000).toISOString() }] });
  if (url.pathname === '/api/reverse-geocode') return ok({ features: [{ type: 'Feature', properties: { name: 'MG Road', city: 'Bengaluru' }, geometry: { type: 'Point', coordinates: [77.6, 12.97] } }] });
  if (url.pathname === '/api/place-search') return ok({ features: [{ type: 'Feature', properties: { name: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka' }, geometry: { type: 'Point', coordinates: [77.64, 12.97] } }] });
  return { ok: false, status: 404, json: async () => ({}) };
};

const click = action => { const el = { dataset: { action }, type: 'button' }; for (const fn of listeners.click || []) fn({ target: { closest: () => el }, preventDefault() {} }); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = html => assert.ok(html.length > 200 && !html.includes('undefined') && !html.includes('[object Object]'), 'screen rendered without undefined/[object Object]');

await import('../src/app.js');

test('smoke: opens the command centre in 3D and loads live model inputs', async () => {
  click('open-command'); await wait(400);
  assert.match(root.innerHTML, /id="maplibre-command"/);
  const map = maps.at(-1);
  assert.equal(map.opts.container.id, 'maplibre-command');
  assert.ok(map.layers['urban-buildings-3d'], '3D building extrusion layer added from vector style');
  assert.ok(map.layers['wind-field-extrusions'] && map.layers['wind-plume-envelope'] && map.layers['connected-sensor-points']);
  assert.ok(calls.includes('/api/weather') && calls.includes('/api/air-quality') && calls.includes('/api/sensors'));
  assert.match(root.innerHTML, /MODEL INPUTS LOADED/);
  assert.match(root.innerHTML, /41\.2/);
  const sensors = map.sources['connected-sensors-source'].calls.at(-1);
  assert.equal(sensors.features.length, 1, 'ground sensor reaches the 3D map source');
  assert.equal(map.sources['wind-field-source'].calls.length > 0, true, 'wind field updated in place after live data');
  assert.equal(map.removed, false, 'live update does not destroy the 3D map');
});

test('smoke: hour slider changes model values and overlay in place', async () => {
  const map = maps.at(-1);
  const before = map.sources['wind-vector-source'].calls.length;
  const el = { matches: sel => sel === '[data-hour-slider]', value: '6' };
  for (const fn of listeners.input || []) fn({ target: el });
  assert.equal(map.sources['wind-vector-source'].calls.length, before + 1);
  assert.equal(map.removed, false);
});

test('smoke: every screen and action renders without errors', async () => {
  for (const id of ['S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S12']) { click(`navigate:${id}`); await wait(30); check(root.innerHTML); }
  click('open-report'); check(root.innerHTML);
  click('navigate:S03'); await wait(400);
  assert.match(root.innerHTML, /id="maplibre-main"/);
  for (const a of ['toggle-legend', 'toggle-layer-controls', 'toggle-particles', 'toggle-pause', 'toggle-plume', 'toggle-cells', 'toggle-geometry', 'weather-stale', 'weather-stale', 'refresh-live-data', 'map-reset', 'map-zoom-in', 'map-zoom-out', 'locate-me', 'show-help', 'close-modal']) { click(a); await wait(20); check(root.innerHTML); }
  click('toggle-map-mode'); await wait(30); assert.match(root.innerHTML, /id="leaflet-main"/);
  click('toggle-map-mode'); await wait(300); assert.match(root.innerHTML, /id="maplibre-main"/);
  for (const b of ['A', 'B', 'C']) { click('navigate:S07'); click(`select-branch:${b}`); check(root.innerHTML); click('run-scenario'); check(root.innerHTML); click('open-planning'); }
  for (const a of ['preview-qualified', 'view-comparison-preview', 'open-review-preview', 'prepare-action', 'open-followup', 'preview-closed']) { click(a); check(root.innerHTML); }
});

test('smoke: map click chooses a location, resolves its name and refetches inputs', async () => {
  click('navigate:S03'); await wait(400);
  const map = maps.at(-1);
  const before = calls.filter(c => c === '/api/weather').length;
  for (const fn of map.handlers.click || []) fn({ lngLat: { lat: 12.95, lng: 77.58 }, point: {} });
  await wait(300);
  assert.ok(calls.filter(c => c === '/api/weather').length > before, 'weather re-requested for the clicked coordinates');
  assert.ok(calls.includes('/api/reverse-geocode'));
  assert.match(elements['live-card'].outerHTML, /MG Road/, 'reverse-geocoded place name is shown in the live card');
  assert.equal(map.removed, false, 'clicking a point keeps the 3D camera/map');
});
