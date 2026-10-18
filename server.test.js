import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';

async function withServer(fetchImpl, run) {
  const server = createAppServer({ fetchImpl });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const json = payload => ({ ok: true, status: 200, json: async () => payload });

test('backend health is explicit that it does not certify upstream freshness or a dispersion model', async () => {
  await withServer(async () => { throw new Error('health should not call a provider'); }, async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.match(body.note, /does not certify upstream freshness/);
  });
});

test('backend rejects invalid coordinates before making provider requests', async () => {
  let calls = 0;
  await withServer(async () => { calls++; return json({}); }, async base => {
    const response = await fetch(`${base}/api/weather?lat=91&lon=0`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Valid latitude/);
    assert.equal(calls, 0);
  });
});

test('place search proxies a bounded Photon query and caches the response briefly', async () => {
  let calls = 0;
  await withServer(async input => {
    calls++;
    const url = new URL(input);
    assert.equal(url.hostname, 'photon.komoot.io');
    assert.equal(url.searchParams.get('q'), 'Brookfield Bengaluru');
    assert.equal(url.searchParams.get('limit'), '6');
    return json({ features: [{ type:'Feature', properties:{name:'Brookfield',city:'Bengaluru'}, geometry:{type:'Point',coordinates:[77.7,12.9]} }] });
  }, async base => {
    const first = await fetch(`${base}/api/place-search?q=Brookfield%20Bengaluru`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-urban-ventai-cache'), 'MISS');
    assert.equal((await first.json()).features.length, 1);
    const second = await fetch(`${base}/api/place-search?q=Brookfield%20Bengaluru`);
    assert.equal(second.headers.get('x-urban-ventai-cache'), 'HIT');
    assert.equal(calls, 1);
  });
});

test('weather proxy requests only the declared Open-Meteo variables and preserves provider payload', async () => {
  let requested;
  await withServer(async input => {
    requested = new URL(input);
    return json({ timezone:'Asia/Kolkata', utc_offset_seconds:19800, current:{time:'2026-10-18T16:00',wind_speed_10m:1.3} });
  }, async base => {
    const response = await fetch(`${base}/api/weather?lat=12.97&lon=77.59`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.current.wind_speed_10m, 1.3);
    assert.equal(requested.hostname, 'api.open-meteo.com');
    assert.equal(requested.searchParams.get('latitude'), '12.97');
    assert.match(requested.searchParams.get('current'), /wind_direction_10m/);
    assert.equal(requested.searchParams.get('wind_speed_unit'), 'ms');
  });
});

test('air-quality proxy explicitly requests CAMS regional model fields, not a sensor endpoint', async () => {
  let requested;
  await withServer(async input => { requested = new URL(input); return json({ current:{time:'2026-10-18T16:00',pm2_5:30} }); }, async base => {
    const response = await fetch(`${base}/api/air-quality?lat=12.97&lon=77.59`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).current.pm2_5, 30);
    assert.equal(requested.hostname, 'air-quality-api.open-meteo.com');
    assert.equal(requested.searchParams.get('domains'), 'cams_global');
    assert.match(requested.searchParams.get('current'), /pm2_5/);
  });
});

test('weather and air-quality proxies request hourly series for the past 24 h and next 24 h', async () => {
  const seen = [];
  await withServer(async input => { seen.push(new URL(input)); return json({ current: {} }); }, async base => {
    await fetch(`${base}/api/weather?lat=1.5&lon=2.5`);
    await fetch(`${base}/api/air-quality?lat=1.5&lon=2.5`);
  });
  assert.match(seen[0].searchParams.get('hourly'), /wind_direction_10m/);
  assert.match(seen[1].searchParams.get('hourly'), /pm2_5/);
  for (const url of seen) { assert.equal(url.searchParams.get('past_days'), '1'); assert.equal(url.searchParams.get('forecast_days'), '2'); }
});

test('sensor route reports not-configured instead of inventing observations', async () => {
  const server = createAppServer({ fetchImpl: async () => { throw new Error('must not call provider'); }, env: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sensors?lat=12.97&lon=77.59`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.sourceStatus, 'not-configured');
    assert.match(body.note, /substituted or fabricated/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('sensor route joins OpenAQ latest PM2.5 values with station metadata and sends the API key', async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input); requests.push({ url, init });
    if (url.pathname === '/v3/locations') return json({ results: [{ id: 7, name: 'Silk Board', provider: { name: 'CPCB' }, coordinates: { latitude: 12.917, longitude: 77.623 } }] });
    return json({ results: [{ locationsId: 7, sensorsId: 70, value: 61.5, datetime: { utc: '2026-10-18T10:00:00Z', local: '2026-10-18T15:30:00+05:30' }, coordinates: { latitude: 12.917, longitude: 77.623 } }, { locationsId: 8, sensorsId: 80, value: -999, coordinates: { latitude: 1, longitude: 1 } }] });
  };
  const server = createAppServer({ fetchImpl, env: { OPENAQ_API_KEY: 'test-key' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sensors?lat=12.97&lon=77.59`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sensors.length, 1, 'invalid negative sentinel readings are dropped');
    assert.equal(body.sensors[0].name, 'Silk Board');
    assert.equal(body.sensors[0].value, 61.5);
    assert.equal(requests.every(r => r.init.headers['X-API-Key'] === 'test-key'), true);
    assert.equal(requests.find(r => r.url.pathname === '/v3/parameters/2/latest').url.searchParams.get('radius'), '25000');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('reverse geocode proxy validates coordinates and calls Photon reverse', async () => {
  let requested;
  await withServer(async input => { requested = new URL(input); return json({ features: [] }); }, async base => {
    assert.equal((await fetch(`${base}/api/reverse-geocode?lat=abc&lon=1`)).status, 400);
    assert.equal((await fetch(`${base}/api/reverse-geocode?lat=12.97&lon=77.59`)).status, 200);
  });
  assert.equal(requested.pathname, '/reverse');
});
