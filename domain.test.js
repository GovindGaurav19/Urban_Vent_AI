import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, changeOperatingArea, hasValidRun, canOpenValidComparison, canApproveForSubmission, canSubmitAction, canCloseCase, normalizeRunAttempt } from '../src/domain.js';

test('initial scenario is not calculated and source data is missing honestly', () => {
  const state = createInitialState();
  assert.equal(state.scenarioRun.status, 'not-calculated');
  assert.equal(state.scenarioRun.runId, null);
  assert.equal(state.sources.air.status, 'missing');
  assert.equal(state.sources.air.observationTime, 'Not supplied');
});

test('changing operating area clears dependent hotspot and result context', () => {
  const state = createInitialState();
  state.scenarioRun = { status: 'completed', validated: true, isIllustrative: false, runId: 'REAL-1' };
  state.comparison.previewOnly = false;
  const next = changeOperatingArea(state, 'Other Demo City', 'Ward 02');
  assert.equal(next.area.city, 'Other Demo City');
  assert.equal(next.hotspot, null);
  assert.equal(next.scenarioRun.status, 'not-calculated');
  assert.equal(next.scenarioRun.runId, null);
  assert.equal(next.comparison.previewOnly, false);
});

test('illustrative completed example never unlocks production comparison', () => {
  const demo = { status: 'completed', validated: true, isIllustrative: true, runId: null };
  assert.equal(hasValidRun(demo), false);
  assert.equal(canOpenValidComparison(demo), false);
});

test('only a non-illustrative validated run with a real run id opens valid comparison', () => {
  assert.equal(canOpenValidComparison({ status: 'completed', validated: true, isIllustrative: false, runId: 'run-1' }), true);
  assert.equal(canOpenValidComparison({ status: 'completed', validated: false, isIllustrative: false, runId: 'run-1' }), false);
  assert.equal(canOpenValidComparison({ status: 'failed', validated: true, isIllustrative: false, runId: 'run-1' }), false);
  assert.equal(canOpenValidComparison({ status: 'completed', validated: true, isIllustrative: false, runId: null }), false);
});

test('human approval requires a real run, qualified evidence, and named reviewer', () => {
  const state = createInitialState();
  state.scenarioRun = { status: 'completed', validated: true, isIllustrative: false, runId: 'run-1' };
  state.evidence.qualified = true;
  assert.equal(canApproveForSubmission(state), false);
  state.review.reviewer = 'Reviewer A';
  assert.equal(canApproveForSubmission(state), true);
  state.scenarioRun.isIllustrative = true;
  assert.equal(canApproveForSubmission(state), false);
});

test('external submission needs configuration, authorization and confirmed response', () => {
  assert.equal(canSubmitAction({ integrationConfigured: false, authorized: true, confirmedResponse: true }), false);
  assert.equal(canSubmitAction({ integrationConfigured: true, authorized: false, confirmedResponse: true }), false);
  assert.equal(canSubmitAction({ integrationConfigured: true, authorized: true, confirmedResponse: false }), false);
  assert.equal(canSubmitAction({ integrationConfigured: true, authorized: true, confirmedResponse: true }), true);
});

test('case closure requires permission, criteria and traceable observation', () => {
  const observation = { source: 'field officer', observedAt: '2026-10-18T10:00', location: 'Corridor 03', value: 'pending real measurement' };
  assert.equal(canCloseCase({ authorized: true, criteriaSatisfied: true, observation }), true);
  assert.equal(canCloseCase({ authorized: false, criteriaSatisfied: true, observation }), false);
  assert.equal(canCloseCase({ authorized: true, criteriaSatisfied: false, observation }), false);
  assert.equal(canCloseCase({ authorized: true, criteriaSatisfied: true, observation: { source: '', observedAt: '', location: '', value: '' } }), false);
});

test('missing prerequisites produce incomplete-inputs without fake run metadata', () => {
  const run = normalizeRunAttempt({ requiredInputs: ['air-quality coverage', 'wind input'], modelAvailable: false, routeEngineAvailable: false, effectModelAvailable: false });
  assert.equal(run.status, 'incomplete-inputs');
  assert.equal(run.runId, null);
  assert.equal(run.validated, false);
  assert.match(run.error, /air-quality coverage/);
  assert.match(run.error, /No calculation was started/);
});
