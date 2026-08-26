import assert from 'node:assert/strict';
import test from 'node:test';
import { describeProviders } from '../scripts/providers.mjs';

// Re-review finding: the provider check returned configured:true for any body that
// parsed as JSON, so {"data": []} — TrueForge reporting nothing configured — read
// as configured. Third instance of one shape in this repo, and this one was written
// while repairing the second. These tests exist so it cannot return a fourth time.

test('an EMPTY provider array is not configured', () => {
  const r = describeProviders({ data: [] });
  assert.equal(r.configured, false);
  assert.equal(r.entry_count, 0);
  assert.equal(r.observation, 'NONE_CONFIGURED');
});

test('a populated provider array is configured and counted', () => {
  const r = describeProviders({ data: [{ name: 'anthropic' }, { name: 'openai' }] });
  assert.equal(r.configured, true);
  assert.equal(r.entry_count, 2);
});

// The two endpoints do not share a shape. Measured against TrueForge 0.1.4:
//   model-providers   -> {"data": [ ... ]}
//   sandbox-providers -> {"data": { ... }}

test('a single-object provider response is configured and counts as one', () => {
  const r = describeProviders({ data: { manifest: { type: 'daytona' } } });
  assert.equal(r.configured, true);
  assert.equal(r.entry_count, 1);
  assert.equal(r.shape, 'object');
});

test('an EMPTY object is not configured', () => {
  const r = describeProviders({ data: {} });
  assert.equal(r.configured, false);
  assert.equal(r.observation, 'EMPTY_OBJECT');
});

test('a null data field is not configured', () => {
  assert.equal(describeProviders({ data: null }).observation, 'NULL_DATA');
});

test('a null or absent body is not configured', () => {
  assert.equal(describeProviders(null).configured, false);
  assert.equal(describeProviders(undefined).observation, 'NO_BODY');
});

test('an unwrapped array is handled without assuming a data envelope', () => {
  assert.equal(describeProviders([{ name: 'x' }]).entry_count, 1);
  assert.equal(describeProviders([]).configured, false);
});

test('an unexpected scalar shape is not configured', () => {
  const r = describeProviders({ data: 'ready' });
  assert.equal(r.configured, false);
  assert.equal(r.observation, 'UNEXPECTED_SHAPE');
});

test('no input shape returns configured without a positive count', () => {
  for (const body of [{ data: [] }, { data: {} }, { data: null }, null, undefined, { data: 7 }]) {
    const r = describeProviders(body);
    assert.equal(r.configured, r.entry_count > 0, `disagreement on ${JSON.stringify(body)}`);
  }
});
