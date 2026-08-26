import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nodeMeetsMinimum,
  parseNodeVersion,
  presence,
} from '../scripts/prerequisites.mjs';

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

test('reports configuration presence without exposing values', () => {
  assert.equal(presence('secret'), 'present');
  assert.equal(presence(''), 'missing');
  assert.equal(presence(undefined), 'missing');
});

