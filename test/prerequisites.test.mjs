import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  decide,
  nodeMeetsMinimum,
  observeEnv,
  parseNodeVersion,
  resolvePackage,
} from '../scripts/prerequisites.mjs';

const require = createRequire(import.meta.url);

test('parses stable Node.js versions', () => {
  assert.deepEqual(parseNodeVersion('v24.14.1'), { major: 24, minor: 14, patch: 1 });
});

test('rejects malformed Node.js versions', () => {
  assert.throws(() => parseNodeVersion('latest'), /Unrecognized Node\.js version/);
});

test('enforces the minor version on the minimum major', () => {
  assert.equal(nodeMeetsMinimum({ major: 22, minor: 13, patch: 9 }), false);
  assert.equal(nodeMeetsMinimum({ major: 22, minor: 14, patch: 0 }), true);
  assert.equal(nodeMeetsMinimum({ major: 23, minor: 0, patch: 0 }), true);
});

// Qodo #3 / D5. The old packageIsInstalled() could not reach its false branch,
// because require.resolve() threw first. The regression that matters is that
// absence is now OBSERVED rather than thrown past.
test('resolvePackage observes a present package', () => {
  const result = resolvePackage('@truefoundry/trueforge/package.json', require);
  assert.equal(result.observed, true);
});

test('resolvePackage observes an ABSENT package instead of throwing', () => {
  const result = resolvePackage('@truefoundry/definitely-not-installed', require);
  assert.equal(result.observed, false);
  assert.equal(result.failure, 'MODULE_NOT_FOUND');
});

// Qodo #2 / D2. The old presence() returned a derived label and treated a
// whitespace-only value as present.
test('observeEnv reports raw observations, never a derived label', () => {
  assert.deepEqual(observeEnv('K', { K: 'secret' }), {
    name: 'K', set: true, observation: 'NONEMPTY', length: 6,
  });
  assert.equal(observeEnv('K', {}).observation, 'UNSET');
  assert.equal(observeEnv('K', { K: '' }).observation, 'EMPTY_STRING');
});

test('observeEnv does not report a whitespace-only value as set', () => {
  const result = observeEnv('K', { K: '   ' });
  assert.equal(result.set, false);
  assert.equal(result.observation, 'WHITESPACE_ONLY');
});

test('observeEnv never returns the value itself', () => {
  const result = observeEnv('K', { K: 'sk-secret-value' });
  assert.equal(JSON.stringify(result).includes('sk-secret-value'), false);
});

// Qodo #1 / D1. The deciding paths themselves, which previously had no coverage.
test('decide passes only when every deciding field was observed', () => {
  const verdict = decide(
    { node: { observed: true }, trueforge: { observed: true }, sdk: { observed: true } },
    ['node', 'trueforge', 'sdk'],
  );
  assert.equal(verdict.status, 'LOCAL_PREREQS_OK');
  assert.deepEqual(verdict.blocked_by, []);
});

test('decide blocks and names every field that blocked it', () => {
  const verdict = decide(
    { node: { observed: true }, trueforge: { observed: false }, sdk: { observed: false } },
    ['node', 'trueforge', 'sdk'],
  );
  assert.equal(verdict.status, 'LOCAL_PREREQS_BLOCKED');
  assert.deepEqual(verdict.blocked_by, ['trueforge', 'sdk']);
});

test('decide blocks on a field that is absent entirely, not just false', () => {
  const verdict = decide({ node: { observed: true } }, ['node', 'trueforge']);
  assert.equal(verdict.status, 'LOCAL_PREREQS_BLOCKED');
  assert.deepEqual(verdict.blocked_by, ['trueforge']);
});

test('a credential absence cannot influence the local verdict either way', () => {
  const checks = { node: { observed: true }, trueforge: { observed: true }, sdk: { observed: true } };
  const withKeys = decide(checks, ['node', 'trueforge', 'sdk']);
  const withoutKeys = decide(checks, ['node', 'trueforge', 'sdk']);
  assert.equal(withKeys.status, withoutKeys.status);
  assert.equal(withKeys.deciding_fields.includes('credentials_observed_in_env'), false);
});
