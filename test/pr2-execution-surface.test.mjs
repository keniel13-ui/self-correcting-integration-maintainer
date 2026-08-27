import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  canonicalJson,
  canonicalJsonBytes,
  parseStrictJson,
} from '../scripts/pr2/canonical.mjs';
import {
  assertExactCleanupTargets,
  cleanupSandboxes,
} from '../scripts/pr2/cleanup.mjs';
import {
  BASE_COMMIT,
  BUNDLE_SHA256,
  EMPTY_SHA256,
  ENTRYPOINT_SHA256,
  EXPECTED_CANDIDATE_RESULT_BYTES,
  EXPECTED_RESULT_SHA256,
  FAILURE_ORDER,
  FIXTURE_SHA256,
  LOCK_SHA256,
  PACKAGE_SHA256,
  SDK_VERSION,
  TRUEFORGE_VERSION,
} from '../scripts/pr2/constants.mjs';
import {
  assertSafePath,
  createRunInputs,
  deriveBundle,
  encodeCandidateBytesAsData,
  sha256,
  validateExecArguments,
  validateManifest,
  verifyRunInputs,
} from '../scripts/pr2/inputs.mjs';
import { preflightFailures } from '../scripts/pr2/preflight.mjs';
import { reduceExecution } from '../scripts/pr2/reducer.mjs';
import { daytonaCleanupProvider, executePreparedSurface } from '../scripts/pr2/run.mjs';
import { BoundedHttpError, TrueForgeClient } from '../scripts/pr2/trueforge-client.mjs';

const repoRoot = dirname(dirname(new URL(import.meta.url).pathname));
const runId = 'pr2-0123456789abcdef0123456789abcdef';
const sandboxId = 'v1:daytona:default.test-sandbox';

function tempRoot(label) {
  return mkdtempSync(join(tmpdir(), `${label}-`));
}

function prepared(label = 'pr2-test') {
  return createRunInputs({ repoRoot, runsRoot: tempRoot(label), runId });
}

function successSandboxResult(manifest, changes = {}) {
  return {
    candidate_bundle_sha256: manifest.candidate_bundle_sha256,
    candidate_exit_code: 0,
    candidate_result: parseStrictJson(EXPECTED_CANDIDATE_RESULT_BYTES.toString('utf8')),
    candidate_stderr_length: 0,
    candidate_stderr_sha256: EMPTY_SHA256,
    candidate_stdout_length: EXPECTED_CANDIDATE_RESULT_BYTES.length,
    candidate_stdout_sha256: EXPECTED_RESULT_SHA256,
    entrypoint_sha256: ENTRYPOINT_SHA256,
    fixture_sha256: FIXTURE_SHA256,
    run_id: manifest.run_id,
    schema: 'sandbox_execution_result/v1',
    ...changes,
  };
}

function successEvents(p, changes = {}) {
  const resultLine = canonicalJson(successSandboxResult(p.manifest, changes.sandboxResult));
  const callId = changes.callId ?? 'tool-call-1';
  const call = {
    id: callId,
    function: {
      name: 'exec',
      arguments: changes.arguments ?? JSON.stringify(p.expectedExecArguments),
    },
    tool_info: { type: 'truefoundry-system', name: 'exec' },
    ...changes.call,
  };
  return [
    { type: 'sandbox.created', sandbox_id: changes.sandboxId ?? sandboxId },
    { type: 'model.message', tool_calls: changes.calls ?? [call] },
    {
      type: 'tool.response',
      tool_call_id: changes.responseId ?? callId,
      content: changes.content ?? JSON.stringify({ success: true, response: { exitCode: 0, result: resultLine } }),
    },
  ];
}

function successCleanup(id = sandboxId) {
  return {
    attempted_ids: [id],
    confirmed_absent_ids: [id],
    unconfirmed_ids: [],
    checked_at_utc: '2026-08-27T05:00:00.000Z',
  };
}

function reduce(p, overrides = {}) {
  return reduceExecution({
    manifest: p.manifest,
    expectedExecArguments: p.expectedExecArguments,
    requestSha256: p.requestSha256,
    sessionId: 'session-1',
    turnId: 'turn-1',
    turnStatus: 'done',
    events: successEvents(p),
    cleanup: successCleanup(),
    versions: {
      trueforgeVersion: TRUEFORGE_VERSION,
      sdkVersion: SDK_VERSION,
      nodeVersion: process.version,
      npmVersion: '11.0.0',
    },
    observedAtUtc: '2026-08-27T05:00:01.000Z',
    ...overrides,
  });
}

test('T01 canonical JSON enforces ordering, LF, NFC, integers, duplicates, and closed keys', () => {
  assert.equal(canonicalJson({ z: 1, é: 'é', a: [true, null] }), '{"a":[true,null],"z":1,"é":"é"}\n');
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate key/);
  assert.throws(() => parseStrictJson('{"n":1.5}'), /trailing content|expected comma/);
  assert.throws(() => parseStrictJson('{"n":-0}'), /integer out of contract/);
  assert.throws(() => canonicalJson({ value: 'e\u0301' }), /not NFC/);
  assert.throws(() => validateExecArguments({ command: 'true', extra: false }), /keys must be exactly/);
});

test('T02 safe paths reject traversal, ambiguity, duplicates, and unsorted manifests', () => {
  for (const path of ['/a', '../a', 'a/../b', 'a/./b', 'a//b', 'a\\b', `a\0b`]) {
    assert.throws(() => assertSafePath(path), /path|segment|normalized/);
  }
  const p = prepared('paths');
  const duplicate = structuredClone(p.manifest);
  duplicate.files[1].path = duplicate.files[0].path;
  assert.throws(() => validateManifest(duplicate), /duplicate/);
  const unsorted = structuredClone(p.manifest);
  unsorted.files.reverse();
  assert.throws(() => validateManifest(unsorted), /not sorted/);
});

test('T03 bundle framing changes on path, length, order, and one content byte', () => {
  const files = [
    { path: 'candidate/fixture.json', bytes: Buffer.from('{"x":1}\n') },
    { path: 'candidate/repair.mjs', bytes: Buffer.from('export {};\n') },
  ];
  const baseline = deriveBundle(files);
  assert.equal(deriveBundle(files), baseline);
  assert.notEqual(deriveBundle([{ ...files[0], path: 'candidate/fixture2.json' }, files[1]]), baseline);
  assert.notEqual(deriveBundle([{ ...files[0], bytes: Buffer.concat([files[0].bytes, Buffer.from('x')]) }, files[1]]), baseline);
  assert.notEqual(deriveBundle([...files].reverse()), baseline);
  assert.notEqual(deriveBundle([{ ...files[0], bytes: Buffer.from('{"x":2}\n') }, files[1]]), baseline);
  const p = prepared('bundle');
  assert.equal(p.manifest.candidate_bundle_sha256, BUNDLE_SHA256);
});

test('T04 missing files, byte mismatches, and bad references fail before a client is called', () => {
  const p = prepared('missing');
  unlinkSync(join(p.runDir, 'candidate/fixture.json'));
  assert.throws(() => verifyRunInputs(p.runDir), /ENOENT/);
  const q = prepared('badref');
  const manifest = structuredClone(q.manifest);
  manifest.entrypoint = 'candidate/not-listed.mjs';
  assert.throws(() => validateManifest(manifest), /not listed/);
});

test('T05 wrong contract/base/dependency observations map to exact preflight reasons', () => {
  const p = prepared('preflight');
  const manifest = structuredClone(p.manifest);
  manifest.contract_sha256 = '0'.repeat(64);
  assert.throws(() => validateManifest(manifest), /contract hash/);
  const correct = {
    baseCommit: BASE_COMMIT,
    packageSha256: PACKAGE_SHA256,
    lockSha256: LOCK_SHA256,
    trueforgeVersion: TRUEFORGE_VERSION,
    sdkVersion: SDK_VERSION,
  };
  assert.deepEqual(preflightFailures({ ...correct, baseCommit: 'bad' }), ['BASE_MISMATCH']);
  assert.deepEqual(preflightFailures({ ...correct, lockSha256: 'bad' }), ['DEPENDENCY_MISMATCH']);
  assert.deepEqual(preflightFailures({ ...correct, trueforgeVersion: '9.9.9' }), ['DEPENDENCY_MISMATCH']);
});

test('T06 hostile candidate source is encoded as data and never imported or spawned on the host', () => {
  const hostile = Buffer.from('throw new Error("HOST_EXECUTED")\n');
  let received;
  const mockSandbox = data => { received = data; };
  mockSandbox(encodeCandidateBytesAsData([{ path: 'candidate/hostile.mjs', bytes: hostile }]));
  assert.equal(Buffer.from(received['candidate/hostile.mjs'], 'base64').toString('utf8'), hostile.toString('utf8'));
});

test('T07 success requires one sandbox, one stock exec, one matched response, and done', () => {
  const evidence = reduce(prepared('success'));
  assert.equal(evidence.status, 'EXECUTED_IN_DAYTONA');
  assert.deepEqual(evidence.failure_reasons, []);
});

test('T08 assistant success prose cannot replace persisted tool evidence', () => {
  const p = prepared('prose');
  const evidence = reduce(p, {
    events: [{ type: 'model.message', content: 'Everything worked.' }],
    cleanup: { attempted_ids: [], confirmed_absent_ids: [], unconfirmed_ids: [], checked_at_utc: '' },
  });
  assert.ok(evidence.failure_reasons.includes('EXEC_CALL_CARDINALITY_INVALID'));
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
});

test('T09 zero or two sandbox events, calls, and responses fail cardinality without selection', () => {
  const p = prepared('cardinality');
  const base = successEvents(p);
  const variants = [
    { events: base.filter(event => event.type !== 'sandbox.created'), reason: 'SANDBOX_EVENT_CARDINALITY_INVALID' },
    { events: [base[0], base[0], ...base.slice(1)], reason: 'SANDBOX_EVENT_CARDINALITY_INVALID' },
    { events: base.map(event => event.type === 'model.message' ? { ...event, tool_calls: [] } : event), reason: 'EXEC_CALL_CARDINALITY_INVALID' },
    { events: base.map(event => event.type === 'model.message' ? { ...event, tool_calls: [...event.tool_calls, ...event.tool_calls] } : event), reason: 'EXEC_CALL_CARDINALITY_INVALID' },
    { events: base.filter(event => event.type !== 'tool.response'), reason: 'TOOL_RESPONSE_CARDINALITY_INVALID' },
    { events: [...base, base[2]], reason: 'TOOL_RESPONSE_CARDINALITY_INVALID' },
  ];
  for (const variant of variants) assert.ok(reduce(p, { events: variant.events }).failure_reasons.includes(variant.reason));
});

test('T10 changed exec arguments, call ID, or response ID returns the exact mismatch', () => {
  const p = prepared('mismatch');
  const changedArgs = { command: `${p.expectedExecArguments.command} ` };
  assert.ok(reduce(p, { events: successEvents(p, { arguments: JSON.stringify(changedArgs) }) }).failure_reasons.includes('EXEC_ARGUMENTS_MISMATCH'));
  assert.ok(reduce(p, { events: successEvents(p, { responseId: 'wrong' }) }).failure_reasons.includes('TOOL_RESPONSE_ID_MISMATCH'));
  assert.ok(reduce(p, { events: successEvents(p, { call: { id: undefined } }) }).failure_reasons.includes('EXEC_CALL_CARDINALITY_INVALID'));
});

test('T11 nested response attacks fail shape; malformed inner result fails sandbox parsing', () => {
  const p = prepared('shape');
  const line = canonicalJson(successSandboxResult(p.manifest));
  const attacks = [
    { success: true, exitCode: 0, result: line },
    { success: true },
    { success: true, response: null },
    { success: true, response: { exitCode: 0, result: line, extra: true } },
    { success: true, response: { exitCode: 1, result: line } },
    { success: true, response: { exitCode: 0 } },
    { success: true, response: { exitCode: 0, result: 7 } },
  ];
  for (const attack of attacks) {
    const evidence = reduce(p, { events: successEvents(p, { content: JSON.stringify(attack) }) });
    assert.ok(evidence.failure_reasons.includes('EXEC_RESPONSE_SHAPE_UNEXPECTED'));
  }
  const malformed = reduce(p, {
    events: successEvents(p, { content: JSON.stringify({ success: true, response: { exitCode: 0, result: '{}\n' } }) }),
  });
  assert.ok(malformed.failure_reasons.includes('SANDBOX_RESULT_INVALID'));
});

test('T12 entrypoint, fixture, and bundle disagreements return CANDIDATE_BYTES_MISMATCH', () => {
  const p = prepared('bytes');
  for (const change of [
    { entrypoint_sha256: '0'.repeat(64) },
    { fixture_sha256: '0'.repeat(64) },
    { candidate_bundle_sha256: '0'.repeat(64) },
  ]) {
    assert.ok(reduce(p, { events: successEvents(p, { sandboxResult: change }) }).failure_reasons.includes('CANDIDATE_BYTES_MISMATCH'));
  }
});

test('T13 exit, stderr, malformed candidate result, and stdout hash fail exact reasons', () => {
  const p = prepared('candidate');
  assert.ok(reduce(p, { events: successEvents(p, { sandboxResult: { candidate_exit_code: 7 } }) }).failure_reasons.includes('CANDIDATE_EXIT_NONZERO'));
  assert.ok(reduce(p, { events: successEvents(p, { sandboxResult: { candidate_stderr_length: 1, candidate_stderr_sha256: sha256(Buffer.from('x')) } }) }).failure_reasons.includes('CANDIDATE_STDERR_NONEMPTY'));
  assert.ok(reduce(p, { events: successEvents(p, { sandboxResult: { candidate_result: null } }) }).failure_reasons.includes('CANDIDATE_RESULT_INVALID'));
  assert.ok(reduce(p, { events: successEvents(p, { sandboxResult: { candidate_stdout_sha256: '0'.repeat(64) } }) }).failure_reasons.includes('CANDIDATE_RESULT_HASH_MISMATCH'));
});

test('T14 turn error, cancellation, and timeout never succeed and still invoke cleanup', async () => {
  for (const status of ['error', 'cancelled', 'timeout']) {
    const p = prepared(`turn-${status}`);
    let deleted = 0;
    let cancelled = 0;
    let turnBudget = 0;
    const client = {
      providersConfigured: async () => true,
      createSession: async () => 'session',
      createTurn: async (_session, _request, _arguments, timeoutMs) => {
        turnBudget = timeoutMs;
        return 'turn';
      },
      getTurn: async () => ({ state: { status: status === 'timeout' ? 'running' : status } }),
      listEvents: async () => successEvents(p),
      cancelSession: async () => { cancelled += 1; },
    };
    const evidence = await executePreparedSurface({
      repoRoot,
      prepared: p,
      client,
      cleanupProvider: {
        deleteSandbox: async () => { deleted += 1; },
        observeAbsent: async () => true,
      },
      observations: {
        baseCommit: BASE_COMMIT, packageSha256: PACKAGE_SHA256, lockSha256: LOCK_SHA256,
        trueforgeVersion: TRUEFORGE_VERSION, sdkVersion: SDK_VERSION,
        nodeVersion: process.version, npmVersion: '11.0.0',
      },
      clock: status === 'timeout' ? (() => {
        const values = [0, 0, 60_001];
        return () => {
          return values.shift() ?? 60_001;
        };
      })() : Date.now,
      sleep: async () => {},
    });
    assert.equal(evidence.status, 'NOT_ESTABLISHED');
    assert.ok(evidence.failure_reasons.includes('TURN_NOT_DONE'));
    assert.equal(deleted, 1);
    assert.ok(turnBudget > 0 && turnBudget <= 60_000);
    if (status === 'timeout') assert.ok(cancelled >= 1);
  }

  const outage = prepared('event-outage');
  let outageCancellations = 0;
  const outageEvidence = await executePreparedSurface({
    repoRoot,
    prepared: outage,
    client: {
      providersConfigured: async () => true,
      createSession: async () => 'session',
      createTurn: async () => 'turn',
      getTurn: async () => ({ state: { status: 'done' } }),
      listEvents: async () => { throw new BoundedHttpError('UNAVAILABLE'); },
      cancelSession: async () => { outageCancellations += 1; },
    },
    cleanupProvider: { deleteSandbox: async () => {}, observeAbsent: async () => false },
    observations: {
      baseCommit: BASE_COMMIT, packageSha256: PACKAGE_SHA256, lockSha256: LOCK_SHA256,
      trueforgeVersion: TRUEFORGE_VERSION, sdkVersion: SDK_VERSION,
      nodeVersion: process.version, npmVersion: '11.0.0',
    },
    sleep: async () => {},
  });
  assert.ok(outageEvidence.failure_reasons.includes('CLEANUP_UNCONFIRMED'));
  assert.ok(outageCancellations >= 1);
});

test('T15 cleanup dedupes exact run IDs and rejects unrelated or wildcard targets', async () => {
  assert.deepEqual(assertExactCleanupTargets([sandboxId, sandboxId], [sandboxId]), [sandboxId]);
  assert.throws(() => assertExactCleanupTargets([sandboxId], ['v1:daytona:default.other']), /differ/);
  assert.throws(() => assertExactCleanupTargets([sandboxId], ['*']), /exact/);
  const receipt = await cleanupSandboxes({
    createdIds: [sandboxId, sandboxId],
    deleteSandbox: async () => {},
    observeAbsent: async () => true,
  });
  assert.deepEqual(receipt.attempted_ids, [sandboxId]);

  const wrapped = 'v1:daytona:default.5e45da1b-a5aa-424f-be9d-559ad933dc1a';
  const urls = [];
  const provider = daytonaCleanupProvider({
    apiKey: 'sentinel-key',
    fetchImpl: async (url, init) => {
      urls.push([String(url), init.method]);
      return new Response(null, { status: init.method === 'DELETE' ? 204 : 404 });
    },
  });
  const direct = await cleanupSandboxes({
    createdIds: [wrapped],
    deleteSandbox: provider.deleteSandbox,
    observeAbsent: provider.observeAbsent,
  });
  assert.deepEqual(direct.confirmed_absent_ids, [wrapped]);
  assert.equal(urls.every(([url]) => url.includes('/api/sandbox/5e45da1b-a5aa-424f-be9d-559ad933dc1a')), true);
  assert.equal(urls.some(([url]) => url.includes('v1%3Adaytona')), false);
});

test('T16 a successful delete without re-observed absence remains unconfirmed', async () => {
  const cleanup = await cleanupSandboxes({
    createdIds: [sandboxId],
    deleteSandbox: async () => {},
    observeAbsent: async () => false,
  });
  assert.deepEqual(cleanup.unconfirmed_ids, [sandboxId]);
  const p = prepared('unconfirmed');
  assert.ok(reduce(p, { cleanup }).failure_reasons.includes('CLEANUP_UNCONFIRMED'));
});

test('T17 sentinel provider secrets never enter artifacts, prompts, evidence, or bounded errors', async () => {
  const sentinel = 'SENTINEL_DO_NOT_SERIALIZE_4b377f';
  const p = prepared('secrets');
  const files = ['candidate_manifest.json', 'expected_exec_arguments.json', 'execution_request.json']
    .map(name => readFileSync(join(p.runDir, name), 'utf8')).join('');
  assert.equal(files.includes(sentinel), false);
  let serializedRequests = '';
  const fetchImpl = async (_url, init) => {
    serializedRequests += init.body ?? '';
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new TrueForgeClient({ fetchImpl });
  await client.providersConfigured();
  assert.equal(serializedRequests.includes(sentinel), false);
  const error = new BoundedHttpError('HTTP_REJECTED', 403);
  assert.equal(error.message.includes(sentinel), false);
  assert.equal(JSON.stringify(reduce(p)).includes(sentinel), false);
  const hostile = successSandboxResult(p.manifest, {
    candidate_result: {
      candidate_id: p.manifest.candidate_id,
      input_sha256: FIXTURE_SHA256,
      payload: { customer_id: sentinel },
      schema: 'candidate_repair_result/v1',
      status: 'ok',
    },
  });
  hostile.candidate_stdout_length = canonicalJsonBytes(hostile.candidate_result).length;
  hostile.candidate_stdout_sha256 = sha256(canonicalJsonBytes(hostile.candidate_result));
  const hostileEvidence = reduce(p, {
    events: successEvents(p, { sandboxResult: hostile }),
  });
  assert.equal(JSON.stringify(hostileEvidence).includes(sentinel), false);
  assert.equal(hostileEvidence.sandbox_result.candidate_result, null);
});

test('T18 stock provider rejection is preserved without session creation or direct execution fallback', async () => {
  for (const status of [0, 401, 403, 422]) {
    const p = prepared(`provider-${status}`);
    let sessions = 0;
    let cleanupCalls = 0;
    const evidence = await executePreparedSurface({
      repoRoot,
      prepared: p,
      client: {
        providersConfigured: async () => { throw new BoundedHttpError('HTTP_REJECTED', status); },
        createSession: async () => { sessions += 1; },
      },
      cleanupProvider: {
        deleteSandbox: async () => { cleanupCalls += 1; },
        observeAbsent: async () => false,
      },
      observations: {
        baseCommit: BASE_COMMIT, packageSha256: PACKAGE_SHA256, lockSha256: LOCK_SHA256,
        trueforgeVersion: TRUEFORGE_VERSION, sdkVersion: SDK_VERSION,
        nodeVersion: process.version, npmVersion: '11.0.0',
      },
    });
    assert.ok(evidence.failure_reasons.includes('PROVIDER_CONFIGURATION_REJECTED'));
    assert.equal(sessions, 0);
    assert.equal(cleanupCalls, 0);
  }

  const scoped404 = new TrueForgeClient({
    fetchImpl: async url => String(url).endsWith('/model-providers')
      ? new Response(JSON.stringify({ data: [{}] }), { status: 200 })
      : new Response(null, { status: 404 }),
  });
  assert.equal(await scoped404.providersConfigured(), false);
});

test('T20 reducer emits exhaustive failures in frozen order and no authority verdict words', () => {
  const p = prepared('exhaustive');
  const evidence = reduce(p, { preflight: FAILURE_ORDER });
  assert.deepEqual(evidence.failure_reasons, FAILURE_ORDER);
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.doesNotMatch(JSON.stringify(evidence), /\b(?:PASS|SAFE|CORRECT|APPROVED|PROMOTED|FIXED)\b/);
});
