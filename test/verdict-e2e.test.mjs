import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { ARTIFACT, validateReceipt, parseTimeout } from '../scripts/prerequisites.mjs';

// Re-review finding: the previous suite tested pure helpers and never executed the
// scripts that decide anything, so `npm test` stayed green while the executable
// verdict paths were unverified. These spawn the real script and assert on its
// exit code and its artifact.

const VERIFY = ['scripts/verify-prereqs.mjs'];

function run(env = {}) {
  const merged = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete merged[k];
  const result = spawnSync(process.execPath, VERIFY, { encoding: 'utf8', env: merged });
  return { ...result, report: JSON.parse(result.stdout) };
}

test('E2E: a missing model credential BLOCKS and exits nonzero', () => {
  rmSync(ARTIFACT, { force: true });
  const { status, report } = run({
    ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined,
    GOOGLE_API_KEY: undefined, GEMINI_API_KEY: undefined,
  });
  assert.equal(report.status, 'LOCAL_PREREQS_BLOCKED');
  assert.ok(report.blocked_by.includes('model_credential'));
  assert.notEqual(status, 0);
});

test('E2E: a blocked run leaves NO artifact behind', () => {
  rmSync(ARTIFACT, { force: true });
  run({ DAYTONA_API_KEY: undefined });
  assert.equal(existsSync(ARTIFACT), false);
});

test('E2E: a whitespace-only credential does not satisfy the verdict', () => {
  rmSync(ARTIFACT, { force: true });
  const { report } = run({
    ANTHROPIC_API_KEY: '   ', OPENAI_API_KEY: undefined,
    GOOGLE_API_KEY: undefined, GEMINI_API_KEY: undefined,
  });
  assert.ok(report.blocked_by.includes('model_credential'));
});

test('E2E: a passing run writes a timestamped artifact', () => {
  rmSync(ARTIFACT, { force: true });
  const { status, report } = run({ ANTHROPIC_API_KEY: 'x'.repeat(20), DAYTONA_API_KEY: 'y'.repeat(20) });
  assert.equal(report.status, 'LOCAL_PREREQS_OK');
  assert.equal(status, 0);
  assert.equal(existsSync(ARTIFACT), true);
  assert.equal(typeof JSON.parse(readFileSync(ARTIFACT, 'utf8')).generated_at, 'number');
  rmSync(ARTIFACT, { force: true });
});

test('E2E: the report never contains a credential value', () => {
  rmSync(ARTIFACT, { force: true });
  const secret = 'sk-ant-do-not-leak-this';
  const { stdout } = run({ ANTHROPIC_API_KEY: secret, DAYTONA_API_KEY: 'y'.repeat(20) });
  assert.equal(stdout.includes(secret), false);
  rmSync(ARTIFACT, { force: true });
});

// The stale-receipt finding.

const OK_CHECKS = {
  node: { observed: true, actual: 'v24.14.1' },
  trueforge: { observed: true },
  sdk: { observed: true },
  model_credential: { observed: true },
  sandbox_credential: { observed: true },
};
const receipt = (over = {}) => ({
  status: 'LOCAL_PREREQS_OK',
  generated_at: Date.now(),
  checks: structuredClone(OK_CHECKS),
  deciding_fields: Object.keys(OK_CHECKS),
  ...over,
});

test('a fresh receipt matching the world validates', () => {
  assert.equal(validateReceipt(receipt(), OK_CHECKS).valid, true);
});

test('a receipt whose STATUS was hand-edited to pass is rejected', () => {
  const tampered = receipt();
  tampered.checks.trueforge.observed = false;   // the world it saw was blocked
  tampered.status = 'LOCAL_PREREQS_OK';         // but it claims it passed
  const result = validateReceipt(tampered, OK_CHECKS);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'RECOMPUTED_BLOCKED');
});

test('a receipt from a world that has since changed is rejected', () => {
  const changed = { ...structuredClone(OK_CHECKS), trueforge: { observed: false } };
  const result = validateReceipt(receipt(), changed);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'WORLD_CHANGED_SINCE_RECEIPT');
});

test('an expired receipt is rejected even if everything else matches', () => {
  const old = receipt({ generated_at: Date.now() - 60 * 60 * 1000 });
  const result = validateReceipt(old, OK_CHECKS);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'RECEIPT_EXPIRED');
});

test('a receipt with no timestamp is rejected', () => {
  const noStamp = receipt();
  delete noStamp.generated_at;
  assert.equal(validateReceipt(noStamp, OK_CHECKS).reason, 'NO_TIMESTAMP');
});

test('an absent receipt is rejected', () => {
  assert.equal(validateReceipt(null, OK_CHECKS).reason, 'RECEIPT_ABSENT');
});

// The timeout finding.

test('a non-numeric timeout falls back instead of throwing', () => {
  assert.deepEqual(parseTimeout('abc'), { ms: 10_000, source: 'FALLBACK' });
  assert.doesNotThrow(() => AbortSignal.timeout(parseTimeout('abc').ms));
});

test('a negative or zero timeout falls back instead of throwing', () => {
  assert.equal(parseTimeout('-5').source, 'FALLBACK');
  assert.equal(parseTimeout('0').source, 'FALLBACK');
  assert.doesNotThrow(() => AbortSignal.timeout(parseTimeout('-5').ms));
});

test('a valid timeout is honoured', () => {
  assert.deepEqual(parseTimeout('2500'), { ms: 2500, source: 'ENV' });
});
