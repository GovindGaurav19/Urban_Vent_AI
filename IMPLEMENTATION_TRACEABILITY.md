# Urban-VentAI Implementation Traceability

Source authority: Reference 1 controls the end-to-end municipal journey; Reference 2 controls traceability and exception paths; Reference 3 (50-page prototype) controls screen structure and visual states. Demo content is isolated from observed/modelled data.

## Workflow and screen mapping

| Workflow screen | UI / source module | Meaningful interactions | QA coverage / state rule |
|---|---|---|---|
| S01 — Operating Area Selection | `renderS01()` in `src/app.js` | city/ward selectors; expanded dropdowns; Open Command Centre; Cancel | selected area is carried forward; only configured demo options appear; prior area shown only when persisted |
| S02 — Municipal Command Centre | `renderS02()`; `initLeafletMap()`; `renderPlaceSearch()`; `server.mjs` geocoding endpoint | Search real place; select result; recenter map; Open Live 3D; inspect only user-selected context; View Data Status; Change Area | real geographic map focus; no asserted ward membership/hotspot; weather/AQ models labelled as modelled |
| S03 — Interactive 3D Pollution Map | `renderS03()`; `initMapLibre3D()`; `initLeafletMap()`; `src/live-data.js` | MapLibre vector basemap/building extrusion; switch to Leaflet 2D; search/select place; zoom/reset/pitch/bearing; data-responsive visual proxy; cells/plume/particles/wind/sensor/geometry toggles; pause; legend; time-window selector; stale-state view; Data Health | 3D map tile rendering still needs target-browser verification; overlay responds to returned model wind but is not a validated pollution/airflow calculation; no sensor markers without feed |
| S04 — Hotspot Investigation | `renderS04()` | Inspect contributing factors; Review Data Quality; Return to Map; Request Site Verification | hotspot/time/area retained; hotspot not treated as source attribution; site request remains draft |
| S05 — Evidence Review | `renderS05()` | checklist; compare layers; request more evidence; site verification; continue gated planning; preview qualified example | production continuation blocked until requirements are truly available; prototype preview is explicitly tagged and does not validate a run |
| S06 — Shared Data Health | `renderS06()`; `updateSourceFromLiveData()`; `server.mjs` | per-source status/detail; refresh weather + regional AQ; return to origin; inspect stale/unavailable/no-observation/missing-height states | provider model time and request/fetch time are separate; regional modeled AQ is not presented as observations; source failure stays visible |
| S07 — Intervention Selection | `renderS07()` | select Traffic, Green Infrastructure, or Construction/Zoning | each branch remains distinct; requirements/limits visible |
| S08A — Traffic Scenario | `renderS08A()` | corridor/period/constraints/assumptions; Run; Cancel with confirmation | missing road graph/route engine/traffic blocks result; cancel preserves draft unless discard confirmed |
| S08B — Green Infrastructure | `renderS08B()` | select candidate; compare criteria; Run; Cancel with confirmation | candidate sites are illustrative; land/access unverified; no quantified benefit without a model |
| S08C — Construction/Zoning | `renderS08C()` | footprint/height/orientation; geometry preview; Run; Cancel with confirmation | proposed geometry is visually distinct; preview is not impact prediction; no supported airflow model by default |
| S09 — Scenario Processing | `renderS09()` | validate/inspect readiness; retry only if prerequisites restored; return setup/data health; illustrative completed-state preview | successful comparison route requires real `completed + validated + non-illustrative` run; incomplete/failure cannot route to valid comparison |
| S10 — Baseline vs Scenario | `renderS10()` | inspect changed area; adjust selected branch; export report; reject confirmation; recommendation gating | no fabricated deltas; illustrative layout is viewable but recommendation is disabled absent valid run |
| S11 — Municipal Review | `renderS11()` | return for more evidence; edit; reject confirmation; approve gating | explicit human gate; approval unavailable without valid run, sufficient evidence and configured authority path |
| S12 — Action + Reporting | `renderS12()` / `renderReportPreview()` | prepare draft; preview; download locally generated HTML evidence report; return | absent municipal integration stays `DRAFT • NOT SUBMITTED`; local export only claims success after generating a file |
| S13 — Tracking + Verification | `renderS13()` | save follow-up observation draft; review verification gaps; reopen investigation; prototype closed preview | external statuses aren't fabricated; no closure without actual evidence, configured permissions and criteria |

## UI reference page coverage

| PDF pages | Reference state(s) | Implementation location |
|---|---|---|
| 1–2 | S01 selection and expanded selectors | S01 dropdowns; only Demo City / Ward 08 is configured |
| 3–4 | S03 default map and expanded visualization controls | S03 MapLibre GL 3D map, Leaflet 2D fallback/mode, right control panel |
| 5–6 | cells hidden; plume off | layer toggles and restoration states |
| 7–9 | particles enabled; wind vectors off; sensor markers shown | toggles + wind-responsive proxy labels; sensor markers stay empty without connected readings |
| 10–12 | stale weather; paused; urban geometry off | `weather-stale`, pause flag, geometry toggle |
| 13–15 | legend; camera limitations; time selection | legend drawer, map toolbar note, time-window selector |
| 16–18 | recent observations / model timestep / historical window | time options, disabled/unavailable statuses reflect no connected data/model |
| 19–20 | hotspot review; site verification request | S04 and draft form modal |
| 21–24 | evidence review; missing/qualify request; warning; qualified example | S05 checklist and modals, clearly marked preview branch |
| 25–27 | source health; no suitable air-quality coverage; missing geometry/height | S06 source cards and detail notices |
| 28 | three intervention choices | S07 branch cards |
| 29–30 | traffic setup and discard confirmation | S08A + modal |
| 31–34 | green site selection, selected candidate, comparisons, discard confirmation | S08B candidate cards and criteria comparison + modal |
| 35–37 | construction setup, geometry preview, discard confirmation | S08C dual views, editable shape values + modal |
| 38–40 | scenario ready/processing; completed example; failed/incomplete | S09 real incomplete-inputs default + explicit demo-preview state |
| 41–42 | comparison and changed-area selection | S10 side-by-side map panes + changed-area control |
| 43 | human review | S11 packet with guarded approval |
| 44–47 | action package, report preview, integration unavailable, export unavailable/preview | S12 draft and generated local HTML export; no authority submission claim |
| 48–50 | tracking, follow-up input, closed example | S13 timeline, required fields and prototype-only closure state |

## Live geography and public data adapters

- Place search is user-submitted to Photon/OpenStreetMap via `GET /api/place-search`, then validates coordinates and changes the map focus; it does not assert administrative ward membership.
- Weather model fields are returned via `GET /api/weather`; regional CAMS Global air-quality model fields via `GET /api/air-quality`. These are fixed backend routes, not an arbitrary URL proxy.
- Provider/model timestamp and browser request time are separate. Model field requests are refreshed no more often than the client refresh policy and can still return a model timestep that is delayed.
- MapLibre vector basemap uses OpenFreeMap's Liberty style with `fill-extrusion` building geometry where source layer/height attributes are available. Cell/plume/particle layers are weather-responsive illustrative proxies, not concentration calculations.
- `tests/server.test.js` exercises provider URL shaping, query/coordinate validation and short-cache behavior using mocked upstreams. These tests do not demonstrate that external providers are reachable from deployment.

## Cross-screen invariants

- Changing city/ward invalidates hotspot, scenario output, comparison, approval and action draft; it does not silently transfer results across areas.
- Opening S06 records the return screen; Return keeps area, hotspot, time, intervention and run state.
- Data-source status labels are `missing`, `not connected`, `stale`, `failed`, or `illustrative` based on configured facts; timestamps remain `Not supplied` where absent.
- A scenario attempt with missing prerequisites can produce only `INCOMPLETE INPUTS`; no run ID or successful run timestamp is assigned.
- Illustrative completed states are view-only. They cannot unlock S10 recommendation, S11 approval, municipal submission, real follow-up closure, or causal claims.
- External submission/acknowledgement/team assignment are unavailable unless a real municipal connector returns a confirmed response.
- Browser report export creates a real local HTML file when clicked; it is not described as an external submission or validated scientific report.

## Known scope limitations (not silently replaced)

- No existing application repository was attached, so the supplied prototype was the starting point and a Node server was added.
- External provider calls and tile rendering cannot be end-to-end verified from this build environment; a local browser visual regression pass is blocked. Browser/target-host verification remains open.
- Open-Meteo weather and CAMS Global regional air-quality model requests are connected through the Node server, but no OpenAQ/municipal monitor feed is connected. Regional model outputs do not qualify street-level evidence.
- MapLibre 3D building geometry is available when the vector style/tile attributes load, but height completeness and geometry freshness are not guaranteed.
- No calibrated street-canyon dispersion model, traffic/route engine, intervention effect model, municipal action service, authentication/authorization provider, database or external persistence exists. These steps remain blocked with no fabricated outcome.
- The 3D cells, plume envelope and particles visualize a wind-responsive proxy only. A validated pollutant prediction still needs sourced emissions, quality-controlled street geometry, time-aligned observations/model inputs, calibrated physics and validation evidence.
