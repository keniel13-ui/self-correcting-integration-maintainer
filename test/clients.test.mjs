import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupSandboxes } from '../scripts/pr2/cleanup.mjs';
import { daytonaCleanupProvider } from '../scripts/pr2/run.mjs';
import { BoundedHttpError, TrueForgeClient } from '../scripts/pr2/trueforge-client.mjs';

const daytonaId = 'v1:daytona:default.12345678-1234-1234-1234-123456789abc';
const rawDaytonaId = '12345678-1234-1234-1234-123456789abc';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recordingClient(respond) {
  const calls = [];
  const client = new TrueForgeClient({
    baseUrl: 'http://127.0.0.1:8790',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return respond(String(url), init);
    },
  });
  return { client, calls };
}

// TrueForgeClient.request: every failure is a bounded, typed error.

test('C01 request maps timeout and network failure to bounded codes', async () => {
  const timeout = new TrueForgeClient({
    fetchImpl: async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); },
  });
  await assert.rejects(timeout.request('GET', '/x'), error =>
    error instanceof BoundedHttpError && error.code === 'TIMEOUT' && error.status === 0);

  const down = new TrueForgeClient({
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  await assert.rejects(down.request('GET', '/x'), error =>
    error instanceof BoundedHttpError && error.code === 'UNAVAILABLE');
});

test('C02 request rejects non-2xx and unparseable JSON, and returns null for 204', async () => {
  const rejected = recordingClient(() => new Response('nope', { status: 503 }));
  await assert.rejects(rejected.client.request('GET', '/x'), error =>
    error.code === 'HTTP_REJECTED' && error.status === 503);

  const garbled = recordingClient(() => new Response('{not json', { status: 200 }));
  await assert.rejects(garbled.client.request('GET', '/x'), error =>
    error.code === 'INVALID_JSON_RESPONSE' && error.status === 200);

  const empty = recordingClient(() => new Response(null, { status: 204 }));
  assert.equal(await empty.client.request('POST', '/x', {}), null);
});

test('C03 request sends JSON only with a body and always carries an abort signal', async () => {
  const { client, calls } = recordingClient(() => jsonResponse({ ok: true }));
  await client.request('GET', '/api/v1/a');
  await client.request('POST', '/api/v1/b', { k: 1 });
  assert.equal(calls[0].url, 'http://127.0.0.1:8790/api/v1/a');
  assert.deepEqual(calls[0].init.headers, {});
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(calls[1].init.headers, { 'content-type': 'application/json' });
  assert.equal(calls[1].init.body, '{"k":1}');
  for (const call of calls) assert.ok(call.init.signal instanceof AbortSignal);
});

test('C04 bounded errors never echo a response body', async () => {
  const secret = 'sk-ant-sentinel-should-not-appear';
  const { client } = recordingClient(() => new Response(secret, { status: 401 }));
  await assert.rejects(client.request('GET', '/x'), error => !String(error.message).includes(secret));
});

// Provider readiness counts entries; absence never reads as configured.

test('C05 providersConfigured requires both a model and a sandbox entry', async () => {
  const cases = [
    [{ model: 404, sandbox: 404 }, false],
    [{ model: [], sandbox: { type: 'daytona' } }, false],
    [{ model: [{ id: 'm' }], sandbox: {} }, false],
    [{ model: [{ id: 'm' }], sandbox: 404 }, false],
    [{ model: [{ id: 'm' }], sandbox: { manifest: { type: 'daytona' } } }, true],
  ];
  for (const [shape, expected] of cases) {
    const { client } = recordingClient(url => {
      const value = url.endsWith('model-providers') ? shape.model : shape.sandbox;
      return value === 404 ? new Response('', { status: 404 }) : jsonResponse({ data: value });
    });
    assert.equal(await client.providersConfigured(), expected, JSON.stringify(shape));
  }
});

test('C06 providersConfigured propagates a non-404 failure instead of reporting unconfigured', async () => {
  const { client } = recordingClient(() => new Response('', { status: 500 }));
  await assert.rejects(client.providersConfigured(), error => error.code === 'HTTP_REJECTED' && error.status === 500);
});

// Event retrieval shape guards.

test('C07 listEvents rejects a non-array data field', async () => {
  const { client } = recordingClient(() => jsonResponse({ data: { events: [] } }));
  await assert.rejects(client.listEvents('s', 't'), error => error.code === 'EVENTS_SHAPE_INVALID');
});

test('C08 listSessionEventsForTurn filters to the turn and refuses partial pages or bad items', async () => {
  const items = [
    { turn_id: 'turn-a', event: { type: 'sandbox.created', sandbox_id: daytonaId } },
    { turn_id: 'turn-b', event: { type: 'sandbox.created', sandbox_id: 'other' } },
  ];
  const ok = recordingClient(() => jsonResponse({ data: items, pagination: {} }));
  assert.deepEqual(await ok.client.listSessionEventsForTurn('sess 1', 'turn-a'), [items[0].event]);
  const url = new URL(ok.calls[0].url);
  assert.equal(url.pathname, '/api/v1/sessions/sess%201/events');
  assert.equal(url.searchParams.get('last_turn_id'), 'turn-a');
  assert.equal(url.searchParams.get('limit'), '100');

  const paged = recordingClient(() => jsonResponse({ data: items, pagination: { next_page_token: 'p2' } }));
  await assert.rejects(paged.client.listSessionEventsForTurn('s', 'turn-a'),
    error => error.code === 'SESSION_EVENTS_PAGINATION_UNEXPECTED');

  const noPagination = recordingClient(() => jsonResponse({ data: items }));
  await assert.rejects(noPagination.client.listSessionEventsForTurn('s', 'turn-a'),
    error => error.code === 'SESSION_EVENTS_SHAPE_INVALID');

  const badItem = recordingClient(() => jsonResponse({ data: [{ turn_id: 'turn-a', event: [] }], pagination: {} }));
  await assert.rejects(badItem.client.listSessionEventsForTurn('s', 'turn-a'),
    error => error.code === 'SESSION_EVENTS_SHAPE_INVALID');
});

test('C09 cancelSession is best effort and never throws', async () => {
  const { client, calls } = recordingClient(() => new Response('', { status: 500 }));
  await assert.doesNotReject(client.cancelSession('session/../x'));
  assert.equal(calls[0].url, 'http://127.0.0.1:8790/api/v1/sessions/session%2F..%2Fx/cancel');
  assert.equal(calls[0].init.method, 'POST');
});

// Daytona cleanup provider.

function daytona(respond, apiKey = 'daytona-sentinel-key') {
  return daytonaWithKey(respond, apiKey);
}

function daytonaWithKey(respond, apiKey) {
  const calls = [];
  const provider = daytonaCleanupProvider({
    apiKey,
    baseUrl: 'https://daytona.example.test',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return respond(String(url), init);
    },
  });
  return { provider, calls };
}

test('C10 cleanup deletes by raw Daytona id with force and bearer auth, then re-observes', async () => {
  const { provider, calls } = daytona((url, init) => new Response(null, { status: init.method === 'DELETE' ? 202 : 404 }));
  await provider.deleteSandbox(daytonaId);
  assert.equal(await provider.observeAbsent(daytonaId), true);
  assert.equal(calls[0].url, `https://daytona.example.test/api/sandbox/${rawDaytonaId}?force=true`);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer daytona-sentinel-key');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[1].url, `https://daytona.example.test/api/sandbox/${rawDaytonaId}`);
  assert.equal(calls[1].init.method, 'GET');
});

test('C11 cleanup refuses ids outside the exact Daytona shape before any request', async () => {
  const { provider, calls } = daytona(() => new Response(null, { status: 204 }));
  for (const id of ['v1:daytona:default.*', 'v1:daytona:other.12345678-1234-1234-1234-123456789abc', rawDaytonaId]) {
    await assert.rejects(provider.deleteSandbox(id), BoundedHttpError);
    await assert.rejects(provider.observeAbsent(id), BoundedHttpError);
  }
  assert.equal(calls.length, 0);
});

test('C12 delete and observe statuses map to bounded outcomes', async () => {
  const deleteRejected = daytona(() => new Response(null, { status: 500 }));
  await assert.rejects(deleteRejected.provider.deleteSandbox(daytonaId),
    error => error.code === 'DAYTONA_DELETE_REJECTED' && error.status === 500);

  const alreadyGone = daytona(() => new Response(null, { status: 404 }));
  await assert.doesNotReject(alreadyGone.provider.deleteSandbox(daytonaId));

  const stillThere = daytona(() => new Response(null, { status: 200 }));
  assert.equal(await stillThere.provider.observeAbsent(daytonaId), false);

  const unknown = daytona(() => new Response(null, { status: 403 }));
  await assert.rejects(unknown.provider.observeAbsent(daytonaId),
    error => error.code === 'DAYTONA_OBSERVE_REJECTED' && error.status === 403);

  const down = daytona(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(down.provider.deleteSandbox(daytonaId), error => error.code === 'DAYTONA_CLEANUP_UNAVAILABLE');
});

test('C13 a missing Daytona key leaves the sandbox unconfirmed and never calls the network', async t => {
  const previous = process.env.DAYTONA_API_KEY;
  delete process.env.DAYTONA_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.DAYTONA_API_KEY = previous; });
  for (const apiKey of [undefined, '']) {
    const { provider, calls } = daytonaWithKey(() => new Response(null, { status: 404 }), apiKey);
    const result = await cleanupSandboxes({
      createdIds: [daytonaId],
      deleteSandbox: provider.deleteSandbox,
      observeAbsent: provider.observeAbsent,
      checkedAtUtc: () => '2026-01-01T00:00:00.000Z',
    });
    assert.deepEqual(result.unconfirmed_ids, [daytonaId]);
    assert.deepEqual(result.confirmed_absent_ids, []);
    assert.equal(calls.length, 0);
  }
});

test('C14 the Daytona key never appears in a bounded error', async () => {
  const key = 'daytona-sentinel-key';
  const { provider } = daytona(() => new Response(key, { status: 500 }), key);
  await assert.rejects(provider.deleteSandbox(daytonaId), error => !String(error.message).includes(key));
});
