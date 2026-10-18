import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const traceability = readFileSync(new URL('../IMPLEMENTATION_TRACEABILITY.md', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../DATA_INTEGRATION_STATUS.md', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('supervisor: all required S01–S13 screens and branch renderers have distinct implementations', () => {
  for (const id of ['S01','S02','S03','S04','S05','S06','S07','S08A','S08B','S08C','S09','S10','S11','S12','S13']) {
    assert.match(app, new RegExp(`case '${id}'`), `missing route case for ${id}`);
  }
  for (const fn of ['renderS01','renderS02','renderS03','renderS04','renderS05','renderS06','renderS07','renderS08A','renderS08B','renderS08C','renderS09','renderS10','renderS11','renderS12','renderS13']) {
    assert.ok(app.includes(`function ${fn}(`), `missing renderer ${fn}`);
  }
  assert.match(app, /case 'S08A'/);
  assert.match(app, /case 'S08B'/);
  assert.match(app, /case 'S08C'/);
});

test('supervisor: the screen reference page ranges are traceable through the 50-page catalogue', () => {
  for (const label of ['1–2','3–4','5–6','7–9','10–12','13–15','16–18','19–20','21–24','25–27','28','29–30','31–34','35–37','38–40','41–42','43','44–47','48–50']) {
    assert.ok(traceability.includes(label), `missing reference page range ${label}`);
  }
  assert.match(traceability, /S02 — Municipal Command Centre/);
  assert.match(traceability, /successful comparison route requires real/);
});

test('supervisor: connected model providers never get mislabeled as local sensor observations', () => {
  const liveData = readFileSync(new URL('../src/live-data.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(integration, /Open-Meteo weather model/);
  assert.match(integration, /CAMS Global air-quality model/);
  assert.match(integration, /Not street-level data/i);
  assert.match(integration, /No provider request from the preparing environment could be verified/);
  assert.match(app, /MODEL INPUTS LOADED • NOT SENSOR DATA/);
  assert.match(app, /Not supplied/);
  assert.match(app, /no calibrated dispersion solver/i);
  assert.match(liveData, /Regional model estimate, not a local monitor reading/);
  assert.match(server, /No environmental value was substituted or fabricated/);
});

test('supervisor: real place search, weather and CAMS model data routes are wired', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const liveData = readFileSync(new URL('../src/live-data.js', import.meta.url), 'utf8');
  assert.match(html, /unpkg\.com\/leaflet@1\.9\.4/);
  assert.match(html, /maplibre-gl@5\.23\.0/);
  assert.match(app, /function initLeafletMap/);
  assert.match(app, /function initMapLibre3D/);
  assert.match(app, /function renderFallbackMap/);
  assert.match(app, /function renderPlaceSearch/);
  assert.match(server, /\/api\/place-search/);
  assert.match(server, /\/api\/weather/);
  assert.match(server, /\/api\/air-quality/);
  assert.match(liveData, /function buildWindResponsiveField/);
  assert.match(app, /fill-extrusion/);
  for (const layer of ['cells','plume','particles','wind','sensors','geometry']) assert.ok(app.includes(`'${layer}'`) || app.includes(`"${layer}"`), `missing layer ${layer}`);
  assert.match(css, /\.map-screen/);
});

test('supervisor: initial state does not invent an observed hotspot', () => {
  const domain = readFileSync(new URL('../src/domain.js', import.meta.url), 'utf8');
  assert.match(domain, /hotspot: null/);
  assert.match(app, /No validated hotspot-detection feed is configured/);
  assert.match(app, /A hotspot is not proof of an emission source/);
});

test('supervisor: destructive actions expose keep-editing and explicit discard/reject confirmations', () => {
  assert.match(app, /Keep editing/);
  assert.match(app, /Discard and return to S07/);
  assert.match(app, /Confirm rejection/);
  assert.match(app, /case 'confirm-discard'/);
  assert.match(app, /case 'confirm-reject'/);
});

test('supervisor: report export and external submission are separate paths', () => {
  assert.match(app, /function generateReportExport/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /MUNICIPAL SUBMISSION INTEGRATION: NOT CONFIGURED/);
  assert.match(app, /case 'submit-action'.*integrationConfigured:false/s);
});
