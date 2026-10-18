<<<<<<< HEAD
# Urban-VentAI — Municipal Pollution Intelligence

Urban-VentAI is a municipal workflow prototype built from the supplied concept whitepaper, the S01–S13 operating workflow, and the 50-page high-fidelity prototype. It has a browser UI plus a small Node.js backend that serves the app and proxies selected public geographic/weather/model APIs.

## Run on your laptop

Requirements: Node.js 18+ (no dependency installation is needed).

1. Extract the project ZIP.
2. Open PowerShell / Terminal in the extracted `urban-ventai` folder.
3. Start the application:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:8080`.
5. Run checks in another terminal:

   ```bash
   npm run check
   npm test
   ```

The server uses Node's built-in `http`, `fetch`, and filesystem APIs. It serves the UI and exposes only these fixed upstream API routes:

- `GET /api/health` — backend health only (not proof of upstream freshness).
- `GET /api/place-search?q=...&lat=...&lon=...` — Photon place search backed by OpenStreetMap data.
- `GET /api/weather?lat=...&lon=...` — Open-Meteo current weather model fields.
- `GET /api/air-quality?lat=...&lon=...` — Open-Meteo / CAMS Global regional air-quality model fields (current + hourly −24 h … +24 h).
- `GET /api/sensors?lat=...&lon=...` — OpenAQ v3 ground-station PM₂.₅ within 25 km. Needs `OPENAQ_API_KEY` (free key from explore.openaq.org); without it the route returns 503 `not-configured` and the UI says so.
- `GET /api/reverse-geocode?lat=...&lon=...` — Photon reverse geocoding, used to name map-click locations.

Environmental data auto-refreshes every 5 minutes (and when the tab regains focus); successful responses are cached server-side for up to two minutes. To enable ground sensors run `OPENAQ_API_KEY=your_key npm start` or put it in a `.env` file. The Node server must be running for these same-origin API routes. Public providers and map tiles require network access and may throttle or fail. On such failures, the UI reports the unavailable source rather than substituting a fabricated live value.

## Maps and dynamic visualization

- **MapLibre GL JS 3D** (pinned to 5.23.0 — the previously referenced 6.14.0 does not exist on npm, which is why the 3D map never loaded) is now the default in both the Command Centre (S02) and the S03 immersive view, with OpenFreeMap vector geometry and extruded buildings where the source provides height attributes. Live layers update in place (no map reload) when data refreshes, the hour slider moves, or you click a new point.
- **Leaflet 2D** stays available through the *Switch to 2D* button and as an automatic fallback if WebGL/CDN access fails.
- **Time window**: a −24 h … +24 h slider scrubs the Open-Meteo/CAMS hourly model series (past = model hindcast, future = forecast; neither is an observation).
- **My location** uses the browser's geolocation; clicking the map picks a point and names it via reverse geocoding.
- The 3D concentration-style cells and plume envelope are **weather-responsive visual proxies** whose geometry changes with the selected coordinates and returned wind model. Optional animated points move with the selected modelled wind direction and speed. They are not a calibrated dispersion solver and their height/intensity must not be interpreted as actual street-level pollution.
- Place search moves the map camera and marker to a searched city, ward-like area, street, address, or landmark where the geocoder returns a feature. It does not establish municipal ward membership or pollution-source attribution.
- The map start view is Bengaluru city centre only as a convenient starting coordinate; no observation/hotspot is implied there.

## Available data and evidence boundaries

- Open-Meteo provides weather model output, including its model timestamp. The app separately records the browser-side request/fetch time.
- Open-Meteo's CAMS Global air-quality fields are regional model estimates (about 45 km grid resolution), **not street-level sensor observations**. They may provide environmental context and visualization scaling but cannot qualify a local baseline, validate a hotspot, confirm a source, or verify intervention impact.
- Direct OpenAQ / municipal sensor observations are not connected. OpenAQ API credentials, provider attribution, sensor coordinates, measurement units and observation time/quality checks would be required.
- No calibrated urban-canopy / street-canyon dispersion solver, road graph + traffic engine, green-infrastructure effect model, construction airflow model, authoritative municipal boundaries, or municipality submission connector is included.
- Scenario outcomes, source attribution, detour/time/emissions changes, intervention reductions, official case assignment, submission confirmation and operational closure are not fabricated. The appropriate states remain unavailable, draft, or incomplete until supported by real integrations.

## Workflow coverage

Distinct UI states exist for S01 through S13, including all A/B/C intervention branches, evidence and data-health gates, scenario incomplete/failure recovery, discard confirmation, human approval, report preview/export, and follow-up verification. The supervisor test suite enforces important domain and truthfulness rules; it does not claim browser-level visual regression was executed.

## Deploying a same-day demo

The app is served by `server.mjs`, so use a Node-capable host rather than a static-only upload unless you add equivalent API rewrites. Generic Node deployment commands are:

- Build/check: `npm run check && npm test`
- Start: `npm start` (or `npm run dev` for development)
- Runtime port: reads `PORT` when supplied by the host; otherwise `8080`.

The container used to prepare this bundle cannot resolve external provider hosts, so I could test backend proxy behavior with mocked upstream responses but could not independently verify live upstream responses or perform a browser screenshot pass. Before presenting the demo, start it on a network-enabled laptop and verify a real place search plus weather/AQ model response. Even when those services work, do not present the platform as an operational pollution warning or a validated micro-canyon physics model.

## Project documents

- `ANTIGRAVITY_PLAN.md` — implementation and verification plan.
- `IMPLEMENTATION_TRACEABILITY.md` — workflow/screens-to-code and QA coverage.
- `DATA_INTEGRATION_STATUS.md` — connected, partially connected, and unavailable services.
- `QA_SUPERVISOR.md` — supervisor checks, test results, and unresolved gates.
=======
# Urban_Vent_AI
Urban-VentAI is an end-to-end municipal intelligence platform that shifts urban air quality management from passive monitoring to active, simulation-driven decision support. Urban street canyons actively trap or disperse vehicle emissions based on localized aerodynamic forces
>>>>>>> 2695bf970120213f9f709a0fc211f3b1baca7e73
