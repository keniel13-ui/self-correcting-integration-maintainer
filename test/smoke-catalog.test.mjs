import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCatalog } from '../scripts/catalog.mjs';

// Qodo #4 / D3. Boolean(body) was true for [] and {} alike, so an empty catalog
// reported success. These are the cases that distinguish reachability from content.

test('a populated array catalog reports its entry count', () => {
  const result = describeCatalog([{ name: 'anthropic' }, { name: 'openai' }]);
  assert.equal(result.response_shape, 'array');
  assert.equal(result.entry_count, 2);
  assert.equal(result.has_entries, true);
});

test('an EMPTY catalog does not report success', () => {
  const result = describeCatalog([]);
  assert.equal(result.entry_count, 0);
  assert.equal(result.has_entries, false);
});

test('an empty object does not report success', () => {
  const result = describeCatalog({});
  assert.equal(result.has_entries, false);
});

test('a null body at HTTP 200 does not report success', () => {
  const result = describeCatalog(null);
  assert.equal(result.response_shape, 'null');
  assert.equal(result.entry_count, null);
  assert.equal(result.has_entries, false);
});

test('a wrapped array is counted, not merely truthy', () => {
  const result = describeCatalog({ providers: [{ name: 'daytona' }] });
  assert.equal(result.entry_count, 1);
  assert.equal(result.has_entries, true);
});

test('reachability is reported separately from content', () => {
  const empty = describeCatalog([]);
  assert.equal(empty.endpoint_reached, true);
  assert.equal(empty.has_entries, false);
});
