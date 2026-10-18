# QA Supervisor — Acceptance Gate

This is a role-based review and automated supervisor suite. It is not a claim that independent autonomous agents or Codex were connected. The original PDFs remain the requirements: the end-to-end workflow controls safe behavior, the prototype-flow/QA reference controls exceptions, and the 50-page UI pack controls screens and variants.

## Review roles

- **Research / source-contract reviewer:** checks the requested source types (OSM/Geofabrik morphology, Open-Meteo/NASA POWER meteorology, OpenAQ/municipal sensors) against what has actually been connected; separates external documentation from implemented code.
- **Workflow analyst:** checks S01–S13 state carrying, human approvals and recovery paths.
- **Prototype/UI reviewer:** checks the 50-page screen/state catalogue and responsive layer controls.
- **Geospatial reviewer:** checks Photon geocoding, Leaflet 2D, MapLibre 3D, GeoJSON overlays, layer toggles and coordinate validation.
- **Data-integrity reviewer:** checks source/model timestamps vs fetch time, observed vs modelled data labels, source failures and no unsupported attribution.
- **Intervention/action reviewer:** checks A/B/C branch prerequisites, scenario gates, report draft, submission and follow-up/closure gates.
- **Supervisor:** runs `npm run check` and `npm test`. A failed test, fake-live claim, or failed/incomplete result that unlocks a consequential step blocks approval.

## Mandatory invariants

1. Current weather/AQ model product timestamps remain independent of fetch time.
2. Regional CAMS model output cannot be called a local sensor observation or a street-level concentration measurement.
3. Wind-responsive cell/plume extrusions and moving points are visualization proxies, not an implemented/calibrated pollutant transport solver.
4. Search result coordinates are map focus, not verified municipal ward boundaries or pollution source attribution.
5. No real run, result, source attribution, emissions reduction, detour, submitted task, acknowledgement or completed case is invented.
6. An illustrative S09 completed state cannot unlock valid S10 comparison, recommendation, S11 approval, municipal submission, or real follow-up closure.
7. A production comparison requires `status === completed`, `validated === true`, `isIllustrative !== true`, and a real `runId`.
8. Human approval requires a valid real run, qualified evidence and an explicit reviewer identifier.
9. Municipal submission requires a configured integration, authorization and a confirmed external response.
10. Case closure requires authorization, closure criteria and a traceable source/time/location/value observation.
11. Changing operating area clears incompatible hotspot/run/comparison/review/action state.
12. Upstream provider failure returns an explicit unavailable/failed state; no environment data is substituted.
13. Backend accepts only fixed provider API routes and validates place query length and geographic coordinate bounds.
14. User cancellation preserves scenario choices until explicit discard confirmation.
15. Report export is a local HTML evidence draft, not an official municipality filing or a validated scientific report.

## Current verification

- `npm run check`: passed, including the Node backend, app modules and tests.
- `npm test`: passed all 25 tests in the current source snapshot (8 domain checks, 5 data-adapter tests, 5 backend tests, and 7 supervisor/source-traceability checks).
- Backend behavior was exercised locally against **mocked provider responses**, including input validation, geocoder request shaping, caching, weather and CAMS routes.
- A browser-driven screenshot/regression pass: **not verified**. The environment blocks navigation to the local dev server with `ERR_BLOCKED_BY_ADMINISTRATOR`, and its outbound DNS lookup for public endpoints fails. No visual test result is claimed.
- Real upstream data availability: **not independently verified from this build environment**. Verify a real place lookup and weather/AQ model response from the intended laptop/host before demonstration.
- Actual sensor readings, validated pollution-dispersion physics, traffic routing, interventions effects and municipal submission integrations remain blocked/not implemented.
