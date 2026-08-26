import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CANONICAL_DECIDING_FIELDS,
  validateReceipt,
  parseTimeout,
} from '../scripts/prerequisites.mjs';

// Re-review finding: these tests spawned the verifier and rmSync'd the REAL
// receipt, so running the suite destroyed working state. Every test now points the
// verifier at a throwaway path via PREREQ_ARTIFACT_PATH and never touches the
// project's own artifact.
const SCRATCH = mkdtempSync(join(tmpdir(), 'prereq-test-'));
const ARTIFACT = join(SCRATCH, 'local-prereqs.json');

function run(env = {}) {
  const merged = { ...process.env, PREREQ_ARTIFACT_PATH: ARTIFACT, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete merged[k];
  const result = spawnSync(process.execPath, ['scripts/verify-prereqs.mjs'], {
    encoding: 'utf8', env: merged,
  });
  return { ...result, report: JSON.parse(result.stdout) };
}

test('the suite never touches the project receipt', () => {
  assert.equal(ARTIFACT.startsWith(tmpdir()), true);
  assert.equal(ARTIFACT.includes('/self-correcting-integration-maintainer/'), false);
});

// The corrected architecture: this stage claims only what a process with no network
// and no running harness can observe. Credentials are NOT deciding fields here,
// because TrueForge may hold them in its own settings.

test('E2E: a run with no credentials in the environment still passes local prereqs', () => {
  rmSync(ARTIFACT, { force: true });
  const { status, report } = run({
    ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined,
    GOOGLE_API_KEY: undefined, GEMINI_API_KEY: undefined, DAYTONA_API_KEY: undefined,
  });
  assert.equal(report.status, 'LOCAL_PREREQS_OK');
  assert.equal(status, 0);
  assert.deepEqual(report.deciding_fields, [...CANONICAL_DECIDING_FIELDS]);
});

test('E2E: credentials are reported but decide nothing at this stage', () => {
  const { report } = run({ ANTHROPIC_API_KEY: undefined });
  assert.equal(report.credentials_observed_in_env.decides_nothing_here, true);
  assert.equal(report.deciding_fields.includes('model_credential'), false);
  assert.ok(report.not_proven.some(s => /configured in TrueForge/.test(s)));
});

test('E2E: the claim does not overreach past what was observed', () => {
  const { report } = run();
  assert.match(report.claim, /Node runtime and package resolution/);
  assert.match(report.claim, /no claim about credentials/);
});

test('E2E: a passing run writes a timestamped artifact', () => {
  rmSync(ARTIFACT, { force: true });
  const { status, report } = run();
  assert.equal(report.status, 'LOCAL_PREREQS_OK');
  assert.equal(status, 0);
  assert.equal(existsSync(ARTIFACT), true);
  assert.equal(typeof JSON.parse(readFileSync(ARTIFACT, 'utf8')).generated_at, 'number');
});

test('E2E: the report never contains a credential value', () => {
  const secret = 'sk-ant-do-not-leak-this';
  const { stdout } = run({ ANTHROPIC_API_KEY: secret });
  assert.equal(stdout.includes(secret), false);
});

test('E2E: a whitespace-only credential is observed as unset, not as present', () => {
  const { report } = run({ ANTHROPIC_API_KEY: '   ' });
  const seen = report.credentials_observed_in_env.observation
    .find(c => c.name === 'ANTHROPIC_API_KEY');
  assert.equal(seen.set, false);
  assert.equal(seen.observation, 'WHITESPACE_ONLY');
});

// Receipt validation.

const OK_CHECKS = {
  node: { observed: true, actual: 'v24.14.1' },
  trueforge: { observed: true },
  sdk: { observed: true },
};
const receipt = (over = {}) => ({
  status: 'LOCAL_PREREQS_OK',
  generated_at: Date.now(),
  checks: structuredClone(OK_CHECKS),
  deciding_fields: [...CANONICAL_DECIDING_FIELDS],
  ...over,
});

test('a fresh receipt matching the world validates', () => {
  assert.equal(validateReceipt(receipt(), OK_CHECKS).valid, true);
});

test('a receipt whose STATUS was hand-edited to pass is rejected', () => {
  const tampered = receipt();
  tampered.checks.trueforge.observed = false;
  tampered.status = 'LOCAL_PREREQS_OK';
  assert.equal(validateReceipt(tampered, OK_CHECKS).reason, 'RECOMPUTED_BLOCKED');
});

// The re-review finding: an empty enumeration read as a pass.
test('a receipt claiming an EMPTY deciding-field list is rejected', () => {
  const blocked = { node: { observed: true }, trueforge: { observed: false }, sdk: { observed: false } };
  const result = validateReceipt(
    { status: 'LOCAL_PREREQS_OK', generated_at: Date.now(), checks: blocked, deciding_fields: [] },
    blocked,
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'DECIDING_FIELDS_MISMATCH');
});

test('a receipt that drops a single failing field from its list is rejected', () => {
  const blocked = { node: { observed: true }, trueforge: { observed: false }, sdk: { observed: true } };
  const result = validateReceipt(
    { status: 'LOCAL_PREREQS_OK', generated_at: Date.now(), checks: blocked, deciding_fields: ['node', 'sdk'] },
    blocked,
  );
  assert.equal(result.reason, 'DECIDING_FIELDS_MISMATCH');
  assert.deepEqual(result.canonical, [...CANONICAL_DECIDING_FIELDS]);
});

test('a receipt that ADDS an unknown deciding field is rejected', () => {
  const r = receipt({ deciding_fields: [...CANONICAL_DECIDING_FIELDS, 'invented'] });
  assert.equal(validateReceipt(r, OK_CHECKS).reason, 'DECIDING_FIELDS_MISMATCH');
});

test('field order in the receipt does not matter, membership does', () => {
  const r = receipt({ deciding_fields: [...CANONICAL_DECIDING_FIELDS].reverse() });
  assert.equal(validateReceipt(r, OK_CHECKS).valid, true);
});

test('a receipt from a world that has since changed is rejected', () => {
  const changed = { ...structuredClone(OK_CHECKS), trueforge: { observed: false } };
  assert.equal(validateReceipt(receipt(), changed).reason, 'WORLD_CHANGED_SINCE_RECEIPT');
});

test('an expired receipt is rejected even if everything else matches', () => {
  const old = receipt({ generated_at: Date.now() - 60 * 60 * 1000 });
  assert.equal(validateReceipt(old, OK_CHECKS).reason, 'RECEIPT_EXPIRED');
});

test('a receipt with no timestamp is rejected', () => {
  const noStamp = receipt();
  delete noStamp.generated_at;
  assert.equal(validateReceipt(noStamp, OK_CHECKS).reason, 'NO_TIMESTAMP');
});

test('an absent receipt is rejected', () => {
  assert.equal(validateReceipt(null, OK_CHECKS).reason, 'RECEIPT_ABSENT');
});

// Timeout parsing.

test('a non-numeric timeout falls back instead of throwing', () => {
  assert.deepEqual(parseTimeout('abc'), { ms: 10_000, source: 'FALLBACK' });
  assert.doesNotThrow(() => AbortSignal.timeout(parseTimeout('abc').ms));
});

test('a negative or zero timeout falls back instead of throwing', () => {
  assert.equal(parseTimeout('-5').source, 'FALLBACK');
  assert.equal(parseTimeout('0').source, 'FALLBACK');
});

test('a valid timeout is honoured', () => {
  assert.deepEqual(parseTimeout('2500'), { ms: 2500, source: 'ENV' });
});

test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));
