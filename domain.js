export const SOURCE_STATUSES = Object.freeze({
  geometry: { id: 'geometry', label: 'Building + street geometry', status: 'missing', source: 'Not connected', observationTime: 'Not supplied', refreshTime: 'Not supplied', coverage: 'Building heights / geometry attributes unavailable', affects: '3D morphology, construction assessment, airflow reliability' },
  weather: { id: 'weather', label: 'Meteorology', status: 'missing', source: 'Not connected', observationTime: 'Not supplied', refreshTime: 'Not supplied', coverage: 'Wind direction/speed coverage unknown', affects: 'Plume interpretation, wind vectors, time alignment' },
  air: { id: 'air', label: 'Air-quality observations', status: 'missing', source: 'Not connected', observationTime: 'Not supplied', refreshTime: 'Not supplied', coverage: 'No suitable observation coverage confirmed', affects: 'Evidence qualification, baseline, outcome verification' },
  sensors: { id: 'sensors', label: 'Ground sensor observations (OpenAQ PM₂.₅)', status: 'missing', source: 'Not requested yet', observationTime: 'Not supplied', refreshTime: 'Not supplied', coverage: 'Requires OPENAQ_API_KEY on the server and stations near the selected location', affects: 'Observed baseline context, evidence qualification, outcome verification' },
  traffic: { id: 'traffic', label: 'Traffic / emissions', status: 'missing', source: 'Not configured', observationTime: 'Not supplied', refreshTime: 'Not supplied', coverage: 'No traffic counts or emissions observations supplied', affects: 'Source assessment, route calculation, traffic branch' },
  model: { id: 'model', label: 'Last dispersion calculation', status: 'missing', source: 'Not calculated', observationTime: 'Not supplied', refreshTime: 'Not supplied', coverage: 'No successful calculation exists', affects: 'Valid comparison, recommendation and expected-outcome verification' }
});

export function createInitialState() {
  return {
    screen: 'S01', previousScreen: 'S01', dataHealthReturn: 'S02',
    area: { city: 'Bengaluru, Karnataka, India', ward: 'City start view • choose a specific place', id: 'bengaluru-map-start', illustrative: true, hasBeenSaved: false },
    lastArea: null,
    hotspot: null,
    timeWindow: 'Current model conditions',
    visualization: { cells: true, plume: true, particles: false, wind: true, sensors: false, geometry: true, paused: false, legend: false, controlsExpanded: false, cameraNote: false, viewMode: '3D' },
    sources: structuredClone(SOURCE_STATUSES), weatherStale: false,
    evidence: { timeAlignment: false, observationCoverage: false, buildingHeightCoverage: false, trafficEvidence: false, modelValidity: false, previewQualified: false, comparisonOpen: false, missingWarning: false },
    request: null,
    intervention: { branch: null, unsaved: false, traffic: { corridor: 'Corridor 03', alternative: 'Not calculated', period: 'Next 24 hours (proposed)', restrictions: 'Emergency access must remain available', assumptions: 'Route graph and traffic data required' }, green: { selectedSite: 'S1', compare: false, criteria: ['street context', 'land access', 'exposure / airflow', 'effect assumptions'] }, construction: { footprint: 48, height: 18, orientation: 30, previewed: false } },
    scenarioRun: { status: 'not-calculated', isIllustrative: false, validated: false, runId: null, error: null, branch: null },
    comparison: { previewOnly: false, changedArea: null },
    review: { reviewer: '', team: '', notes: '', decision: null },
    actionRecord: { status: 'draft', created: false, submitted: false, submissionConfirmed: false, timeline: [{ status: 'Draft', detail: 'No action package prepared yet.' }] },
    report: { previewOpen: false, exported: false, lastFilename: null },
    followUp: { source: '', parameter: '', value: '', unit: '', observedAt: '', location: '', coordinates: '', notes: '', draftSaved: false, observations: [], closedPreview: false },
    notices: [], modal: null
  };
}

export function changeOperatingArea(state, city, ward) {
  const unchanged = state.area.city === city && state.area.ward === ward;
  if (unchanged) return { ...state, screen: 'S02', area: { ...state.area, hasBeenSaved: true } };
  return {
    ...state,
    screen: 'S02',
    area: { city, ward, id: `${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ward.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, illustrative: true, hasBeenSaved: true },
    lastArea: { city, ward, savedInBrowser: true },
    hotspot: null,
    evidence: { timeAlignment: false, observationCoverage: false, buildingHeightCoverage: false, trafficEvidence: false, modelValidity: false, previewQualified: false, comparisonOpen: false, missingWarning: false },
    intervention: { branch: null, unsaved: false, traffic: { corridor: 'Corridor 03', alternative: 'Not calculated', period: 'Next 24 hours (proposed)', restrictions: 'Emergency access must remain available', assumptions: 'Route graph and traffic data required' }, green: { selectedSite: 'S1', compare: false, criteria: ['street context', 'land access', 'exposure / airflow', 'effect assumptions'] }, construction: { footprint: 48, height: 18, orientation: 30, previewed: false } },
    scenarioRun: { status: 'not-calculated', isIllustrative: false, validated: false, runId: null, error: null, branch: null },
    comparison: { previewOnly: false, changedArea: null },
    review: { reviewer: '', team: '', notes: '', decision: null },
    actionRecord: { status: 'draft', created: false, submitted: false, submissionConfirmed: false, timeline: [{ status: 'Draft', detail: 'Area changed; prior action context was invalidated.' }] },
    report: { previewOpen: false, exported: false, lastFilename: null },
    followUp: { source: '', parameter: '', value: '', unit: '', observedAt: '', location: '', coordinates: '', notes: '', draftSaved: false, observations: [], closedPreview: false },
    notices: [...(state.notices || []), 'Operating area changed. Hotspot selection and dependent results were cleared.']
  };
}

export function hasValidRun(run) {
  return Boolean(run && run.status === 'completed' && run.validated === true && run.isIllustrative !== true && run.runId);
}

export function canOpenValidComparison(run) {
  return hasValidRun(run);
}

export function canApproveForSubmission(state) {
  return hasValidRun(state.scenarioRun) && state.evidence?.qualified === true && state.review?.reviewer?.trim().length > 0;
}

export function canSubmitAction({ integrationConfigured, authorized, confirmedResponse }) {
  return integrationConfigured === true && authorized === true && confirmedResponse === true;
}

export function canCloseCase({ authorized, criteriaSatisfied, observation }) {
  return authorized === true && criteriaSatisfied === true && Boolean(
    observation && observation.source?.trim() && observation.observedAt?.trim() && observation.location?.trim() && observation.value?.trim()
  );
}

export function normalizeRunAttempt({ requiredInputs, modelAvailable, routeEngineAvailable, effectModelAvailable }) {
  const missing = [...(requiredInputs || [])];
  if (!modelAvailable && !routeEngineAvailable && !effectModelAvailable) missing.push('a supported calculation service');
  if (missing.length) return { status: 'incomplete-inputs', validated: false, isIllustrative: false, runId: null, error: `Required inputs unavailable: ${[...new Set(missing)].join(', ')}. No calculation was started.`, branch: null };
  return { status: 'ready', validated: false, isIllustrative: false, runId: null, error: null, branch: null };
}
