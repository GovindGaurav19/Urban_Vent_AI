# Urban-VentAI Implementation Plan

Status meanings: **COMPLETE** = implemented and verified; **IN PROGRESS** = currently being built; **BLOCKED** = requires external credentials/service or unavailable runtime dependency; **NOT IMPLEMENTED** = not yet built.

## Phase A — Source and repository audit
- [x] Read master build specification and requirements for References 1–3 in the supplied order.
- [x] Inspect the 50-page UI pack and map the page ranges to S01–S13/state variants.
- [x] Audit supplied workspace for an existing app repository (none supplied; only the prompt and PDFs are present).
- [x] Record external integration boundaries and unavailable dependencies.
- [x] Create the traceability and integration-status documents.

## Phase B — Shared shell and workflow state
- [x] Implement shared brand/header/sidebar/navigation and demo-status indicators.
- [x] Implement shared source-of-truth state for area, hotspot, time window, visual layers, evidence, intervention, scenario, review, action, report, and follow-up.
- [x] Preserve context across navigation and invalidate dependent state when the operating area changes.
- [x] Add route guards for comparison, approval, submission, and case closure.

## Phase C — S02/S03 searchable real geography + 3D map
- [x] Implement map-first Command Centre distinct from the S03 immersive investigation map.
- [x] Add user-triggered place search via Photon/OpenStreetMap data, coordinate validation, map recentering, a location marker and local browser persistence.
- [x] Retain Leaflet 2D for command/map context and add MapLibre GL 3D vector-map rendering with building extrusion when tile attributes are available.
- [x] Add wind-responsive 3D cells, plume-envelope geometry and optional animated particles whose direction responds to returned model wind; explicitly label them visualization proxies, not pollution simulation.
- [x] Keep sensor-marker layer empty until a real observation adapter exists; remove fabricated default hotspot/cell fixture.
- [x] Wire layer toggles, zoom, reset, camera pitch/bearing controls, time-window selection, stale-state warning and Data Health entry point.
- [ ] Verify map tile/3D layer rendering in a real target browser; blocked in this tool environment.

## Phase D — Evidence, data health and intervention branches
- [x] Implement S04 investigation and site-verification draft form.
- [x] Implement S05 evidence sections, checklist, additional-evidence form and prototype-only qualification preview.
- [x] Implement S06 per-source status, freshness, coverage and affected analyses.
- [x] Implement S07 branch selection and S08A/B/C setup forms with branch-specific prerequisites.
- [x] Implement cancellation/discard confirmation while preserving staged settings until discard is confirmed.

## Phase E — Scenario, comparison, review, actions and follow-up
- [x] Implement S09 Ready/Calculating/Completed-example/Failed/Incomplete states with explicit gating.
- [x] Implement S10 baseline/scenario comparison layout, changed-area inspection and no-output state.
- [x] Implement S11 explicit review packet and guarded approval/rejection/edit/evidence paths.
- [x] Implement S12 draft action package, report preview, real local HTML export and unavailable external submission state.
- [x] Implement S13 timeline, follow-up observation draft, verification limitations and prototype-only closed state.

## Phase F — Backend + current data providers
- [x] Add a Node built-in HTTP server, static asset handling, fixed API routes, coordinate/query validation and three-minute in-memory response caching.
- [x] Proxy Photon place search, Open-Meteo weather model, and Open-Meteo/CAMS Global regional air-quality model through the same origin.
- [x] Show provider/model time independently from browser fetch time and compute freshness based on model time.
- [x] Keep regional AQ fields marked modelled (~45 km grid), not direct sensor observations.
- [x] Confirm the existing browser app fails closed if providers fail rather than substituting fake data.

## Phase G — QA and delivery
- [x] Add automated domain/invariant tests, adapter tests and backend route tests using mocked provider responses.
- [ ] Run browser visual regression against the 50-page PDF on a target browser (BLOCKED here: browser navigation is restricted by the environment).
- [ ] Verify real provider responses and live tile rendering from the deployment target (BLOCKED here: outbound DNS to public services is unavailable in this build environment).
- [x] Run Node syntax checks and the automated test suite.
- [x] Update plan, traceability and integration status based on the current verified implementation.

## QA supervisor loop
Before delivery, run the supervisor acceptance suite. Any failure in: (1) evidence/model gates, (2) no synthetic live claims, (3) area/hotspot/time continuity, (4) integration draft truthfulness, or (5) destructive-action confirmation blocks approval of the build. Fix failing cases and re-run tests. Sensor, validated dispersion, routing/effect models and municipal integrations remain BLOCKED. Place search, weather-model and regional air-quality-model request paths are implemented but require real upstream verification from the deployment environment.
