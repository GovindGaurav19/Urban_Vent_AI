import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceSearchUrl, normalizePlaceFeature, searchPlaces, buildWeatherUrl,
  buildAirQualityUrl, fetchCurrentEnvironment, buildWindResponsiveField,
  buildDownwindParticles, sourceFreshness
} from '../src/live-data.js';

test('place search builds an explicit request rather than search-as-you-type', () => {
  const url = new URL(buildPlaceSearchUrl('CMR Institute of Technology, Bengaluru', {lat:12.97,lon:77.59}));
  assert.equal(url.hostname, 'photon.komoot.io');
  assert.equal(url.searchParams.get('q'), 'CMR Institute of Technology, Bengaluru');
  assert.equal(url.searchParams.get('limit'), '6');
  assert.equal(url.searchParams.get('lat'), '12.97');
  assert.throws(() => buildPlaceSearchUrl(' '), /at least two characters/);
});

test('place search normalizes GeoJSON to validated coordinates and a readable label', async () => {
  const fetchMock = async () => ({ ok:true, json:async()=>({features:[{type:'Feature',id:'osm-1',properties:{name:'CMRIT',city:'Bengaluru',state:'Karnataka',country:'India'},geometry:{type:'Point',coordinates:[77.7,12.95]}}]}) });
  const places = await searchPlaces('CMRIT',{fetchImpl:fetchMock});
  assert.equal(places.length,1);
  assert.equal(places[0].name,'CMRIT');
  assert.equal(places[0].city,'Bengaluru');
  assert.equal(places[0].lat,12.95);
  assert.match(places[0].displayName,/Bengaluru/);
  assert.equal(normalizePlaceFeature({geometry:{coordinates:[999,999]}}),null);
});

test('weather and air quality request coordinates and appropriate variable sets', () => {
  const weather = new URL(buildWeatherUrl(12.9,77.5));
  assert.equal(weather.searchParams.get('current'),'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation');
  assert.equal(weather.searchParams.get('wind_speed_unit'),'ms');
  const air = new URL(buildAirQualityUrl(12.9,77.5));
  assert.equal(air.searchParams.get('domains'),'cams_global');
  assert.match(air.searchParams.get('current'),/pm2_5/);
  assert.match(air.searchParams.get('current'),/us_aqi/);
});

test('environment adapter labels regional PM as modelled and keeps independent source times', async () => {
  const fetchMock = async url => {
    const isAir = String(url).includes('air-quality-api');
    return {ok:true,json:async()=>isAir ? {
      timezone:'Asia/Kolkata',utc_offset_seconds:19800,current:{time:'2026-10-18T16:00',pm2_5:31.2,pm10:48,us_aqi:82,european_aqi:55},current_units:{pm2_5:'μg/m³'}
    } : {
      timezone:'Asia/Kolkata',utc_offset_seconds:19800,current:{time:'2026-10-18T16:00',temperature_2m:28.2,relative_humidity_2m:66,wind_speed_10m:1.4,wind_direction_10m:240,precipitation:0},current_units:{wind_speed_10m:'m/s'}
    }};
  };
  let clock = Date.parse('2026-10-18T10:30:00Z');
  const result = await fetchCurrentEnvironment({name:'Bengaluru',lat:12.9,lon:77.5},{fetchImpl:fetchMock,now:()=>new Date(clock += 1000)});
  assert.equal(result.weather.windSpeedMs,1.4);
  assert.equal(result.air.pm25,31.2);
  assert.notEqual(result.requestedAt, result.fetchedAt, 'request and receive times are recorded separately');
  assert.match(result.air.source,/CAMS global air-quality model/);
  assert.match(result.air.interpretation,/not a local monitor reading/);
  assert.notEqual(result.weather.modelTime, undefined);
  assert.notEqual(result.fetchedAt, result.weather.modelTime);
});

test('wind-responsive field is coordinate-based, dynamic, and labelled visualization-only', () => {
  const loc={lat:12.9,lon:77.5};
  const a=buildWindResponsiveField(loc,{windSpeedMs:.5,windDirectionDeg:0},{pm25:20});
  const b=buildWindResponsiveField(loc,{windSpeedMs:7,windDirectionDeg:180},{pm25:80});
  assert.equal(a.features.length,49);
  assert.equal(a.features[0].properties.visualizationOnly,true);
  assert.notDeepEqual(a.features.map(f=>f.properties.intensity),b.features.map(f=>f.properties.intensity));
  assert.equal(a.features[24].geometry.type,'Polygon');
  assert.equal(buildDownwindParticles(loc,{windSpeedMs:1,windDirectionDeg:90},10,0).features.length,10);
  assert.equal(sourceFreshness(null).status,'missing');
});

import { parseHourly, hourlyIndexAt, weatherAtOffset, airAtOffset, sensorsToGeoJson } from '../src/live-data.js';

test('hourly model series are time-aligned, offset-selectable and never invent missing values', () => {
  const base = Date.parse('2026-10-18T10:00:00Z');
  const times = [0, 1, 2, 3].map(h => new Date(base + h * 3600000 + 19800000).toISOString().slice(0, 16));
  const rows = parseHourly({ utc_offset_seconds: 19800, hourly: { time: times, wind_speed_10m: [1, 2, null, 4], wind_direction_10m: [10, 20, 30, 40] } }, ['wind_speed_10m', 'wind_direction_10m']);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].utcMs, base);
  assert.equal(rows[2].wind_speed_10m, null);
  assert.equal(hourlyIndexAt(rows, base + 3 * 3600000 - 1000, 0), 3);
  assert.equal(hourlyIndexAt(rows, base, 2), 2);
  const weather = { windSpeedMs: 9, windDirectionDeg: 99, utcOffsetSeconds: 19800, hourly: rows };
  assert.equal(weatherAtOffset(weather, 0, base), weather, 'offset 0 keeps the provider current value');
  const later = weatherAtOffset(weather, 1, base);
  assert.equal(later.windSpeedMs, 2); assert.equal(later.windDirectionDeg, 20);
  assert.equal(weatherAtOffset(weather, 2, base).windSpeedMs, 9, 'null hourly value falls back to current, not 0');
  assert.equal(airAtOffset(null, 3), null);
});

test('sensor GeoJSON flags stale ground observations', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  const geo = sensorsToGeoJson([{ name: 'A', value: 30, lat: 1, lon: 2, observedAtUtc: '2026-10-18T11:30:00Z' }, { name: 'B', value: 30, lat: 1, lon: 2, observedAtUtc: '2026-10-18T05:00:00Z' }, { name: 'C', value: 30, lat: 1, lon: 2 }], now);
  assert.deepEqual(geo.features.map(f => f.properties.stale), [false, true, true]);
});
