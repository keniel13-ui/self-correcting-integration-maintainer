import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, canonicalJsonBytes } from '../scripts/pr2/canonical.mjs';
import { sha256 } from '../scripts/pr2/inputs.mjs';
import { prepareCandidateVerification } from '../scripts/judgment/candidate.mjs';
import { loadCorpus, validateAgentResponse } from '../scripts/judgment/core.mjs';
import { JudgmentTrueForgeClient, runCandidateVerification } from '../scripts/judgment/live.mjs';
import {
  BoundedHttpError,
  DEFAULT_TRUEFORGE_BASE_URL,
  RELAY_SESSION_CONFIG,
  TrueForgeClient,
  assertReturnedRelaySessionConfig,
  resolveTrueForgeBaseUrl,
} from '../scripts/pr2/trueforge-client.mjs';
import {
  CANONICAL_DECIDING_FIELDS,
  MAX_TIMER_MS,
  parseTimeout,
  validateReceipt,
} from '../scripts/prerequisites.mjs';

const sandboxId = 'v1:daytona:default.12345678-1234-1234-1234-123456789abc';

function prepared() {
  const root = mkdtempSync(join(tmpdir(), 'hardening-corpus-'));
  const text = 'export const ok = a && b;\n';
  writeFileSync(join(root, 'a.mjs'), text);
  const manifestBytes = canonicalJsonBytes({
    schema: 'judgment_corpus/v1',
    corpus_id: 'hardening-1',
    files: [{ path: 'a.mjs', sha256: sha256(Buffer.from(text)), size_bytes: Buffer.byteLength(text) }],
    verification: { argv: ['node', 'a.mjs'], timeout_ms: 1_000 },
  });
  const corpus = loadCorpus({ corpusRoot: root, manifestBytes });
  const [finding] = validateAgentResponse(canonicalJson({
    schema: 'judgment_response/v1',
    findings: [{
      condition: 'conjunction may need to be a disjunction',
      path: 'a.mjs',
      exact_bytes: 'export const ok = a && b;',
      why_it_matters: 'A caller may be rejected.',
      evidence: ['Inspected the single expression.'],
      novelty: 'NEW',
      known_condition_id: null,
      confidence_basis: 'Read the exported expression.',
      not_established: ['No caller was inspected.'],
      repair: { before_exact: 'export const ok = a && b;', after_exact: 'export const ok = a || b;' },
    }],
  }), { corpus, priorSha256: 'unused', knownIds: new Set() });
  return prepareCandidateVerification({ corpus, finding });
}

function relayClient(overrides = {}) {
  const calls = { cancel: 0 };
  return {
    calls,
    client: {
      async assertDaytonaSandboxProvider() {},
      async createRelaySession() { return 'session-1'; },
      async createRelayTurn() { return 'turn-1'; },
      async getTurn() { return { state: { status: 'done' } }; },
      async listEvents() { return [{ type: 'sandbox.created', sandbox_id: sandboxId }]; },
      async cancelSession() { calls.cancel += 1; },
      ...overrides,
    },
  };
}

function recordingCleanup() {
  const deleted = [];
  return {
    deleted,
    provider: {
      async deleteSandbox(id) { deleted.push(id); },
      async observeAbsent() { return true; },
    },
  };
}

// Relay failure paths and sandbox cleanup.

test('H1 a relay poll failure after sandbox creation still deletes the sandbox and returns evidence', async () => {
  const { client, calls } = relayClient({
    async getTurn() { throw new BoundedHttpError('TIMEOUT'); },
  });
  const cleanup = recordingCleanup();
  const evidence = await runCandidateVerification({
    prepared: prepared(),
    client,
    cleanupProvider: cleanup.provider,
  });
  assert.deepEqual(cleanup.deleted, [sandboxId]);
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.ok(evidence.failure_reasons.includes('TURN_NOT_DONE'));
  assert.equal(evidence.failure_reasons.includes('CLEANUP_UNCONFIRMED'), false);
  assert.deepEqual(evidence.cleanup.confirmed_absent_ids, [sandboxId]);
  assert.ok(calls.cancel >= 1);
});

test('H2 a turn request with no returned turn id records CLEANUP_UNCONFIRMED', async () => {
  const { client } = relayClient({
    async createRelayTurn() { throw new BoundedHttpError('TIMEOUT'); },
  });
  const evidence = await runCandidateVerification({
    prepared: prepared(),
    client,
    cleanupProvider: recordingCleanup().provider,
  });
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.ok(evidence.failure_reasons.includes('CLEANUP_UNCONFIRMED'));
});

test('H3 unretrievable relay events record CLEANUP_UNCONFIRMED instead of an empty clean set', async () => {
  const { client } = relayClient({
    async listEvents() { throw new BoundedHttpError('UNAVAILABLE'); },
  });
  const evidence = await runCandidateVerification({
    prepared: prepared(),
    client,
    cleanupProvider: recordingCleanup().provider,
  });
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.ok(evidence.failure_reasons.includes('CLEANUP_UNCONFIRMED'));
});

test('H4 a session that fails before any turn request records no cleanup failure', async () => {
  const { client } = relayClient({
    async createRelaySession() { throw new BoundedHttpError('HTTP_REJECTED', 500); },
  });
  const evidence = await runCandidateVerification({
    prepared: prepared(),
    client,
    cleanupProvider: recordingCleanup().provider,
  });
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.equal(evidence.session_id, '');
  assert.equal(evidence.failure_reasons.includes('CLEANUP_UNCONFIRMED'), false);
});

// Relay session capability surface.

test('H5 the relay config states every optional TrueForge capability as disabled', () => {
  assert.equal(RELAY_SESSION_CONFIG.sandbox.enabled, true);
  assert.equal(RELAY_SESSION_CONFIG.sandbox.file_downloads, false);
  assert.equal(RELAY_SESSION_CONFIG.dynamic_sub_agents.enabled, false);
  assert.equal(RELAY_SESSION_CONFIG.generative_ui.enabled, false);
  assert.equal(RELAY_SESSION_CONFIG.ask_user_questions.enabled, false);
  assert.equal(RELAY_SESSION_CONFIG.context_management.compaction.enabled, false);
  assert.equal(RELAY_SESSION_CONFIG.context_management.large_tool_response.enabled, false);
  assert.equal(Object.isFrozen(RELAY_SESSION_CONFIG.sandbox), true);
});

for (const [label, makeClient, create] of [
  ['judgment relay', () => new JudgmentTrueForgeClient(), client => client.createRelaySession(prepared())],
  ['PR2 relay', () => new TrueForgeClient(), client => client.createSession({ command: 'node -e 1' })],
]) {
  test(`H6 ${label} sends the full config and cancels when TrueForge echoes a different one`, async () => {
    const client = makeClient();
    const requests = [];
    let echoed = null;
    client.request = async (method, path, body) => {
      requests.push({ method, path, body });
      if (path === '/api/v1/sessions') {
        return { data: { id: 'session-x', agent: { spec: { config: echoed } } } };
      }
      return {};
    };

    echoed = structuredClone(RELAY_SESSION_CONFIG);
    assert.equal(await create(client), 'session-x');
    assert.deepEqual(requests[0].body.agent.spec.config, RELAY_SESSION_CONFIG);

    requests.length = 0;
    echoed = { ...structuredClone(RELAY_SESSION_CONFIG), dynamic_sub_agents: { enabled: true } };
    await assert.rejects(create(client), error => error.code === 'RELAY_SESSION_CONFIG_MISMATCH');
    assert.deepEqual(requests.map(item => item.path), [
      '/api/v1/sessions',
      '/api/v1/sessions/session-x/cancel',
    ]);

    requests.length = 0;
    echoed = undefined;
    await assert.rejects(create(client), error => error.code === 'RELAY_SESSION_CONFIG_MALFORMED');
    assert.equal(requests.at(-1).path, '/api/v1/sessions/session-x/cancel');
  });
}

test('H7 an omitted capability in the echoed config is a mismatch, not a pass', () => {
  const { generative_ui: _omitted, ...partial } = structuredClone(RELAY_SESSION_CONFIG);
  assert.throws(() => assertReturnedRelaySessionConfig(partial), error => error.code === 'RELAY_SESSION_CONFIG_MISMATCH');
  assert.throws(() => assertReturnedRelaySessionConfig(null), error => error.code === 'RELAY_SESSION_CONFIG_MISMATCH');
  assert.throws(() => assertReturnedRelaySessionConfig(undefined), error => error.code === 'RELAY_SESSION_CONFIG_MALFORMED');
});

// Harness location.

test('H8 TRUEFORGE_BASE_URL is honoured by the live clients and validated', () => {
  assert.equal(resolveTrueForgeBaseUrl(undefined), DEFAULT_TRUEFORGE_BASE_URL);
  assert.equal(resolveTrueForgeBaseUrl(''), DEFAULT_TRUEFORGE_BASE_URL);
  assert.equal(resolveTrueForgeBaseUrl('http://127.0.0.1:9999'), 'http://127.0.0.1:9999/');
  assert.equal(resolveTrueForgeBaseUrl('https://tf.example.test/base/'), 'https://tf.example.test/base/');
  for (const bad of ['not a url', 'ftp://127.0.0.1:8790', 'file:///etc/passwd', 'http://user:pass@127.0.0.1:8790']) {
    assert.throws(() => resolveTrueForgeBaseUrl(bad), TypeError, bad);
  }
  const previous = process.env.TRUEFORGE_BASE_URL;
  try {
    process.env.TRUEFORGE_BASE_URL = 'http://127.0.0.1:9999';
    assert.equal(new TrueForgeClient().baseUrl, 'http://127.0.0.1:9999/');
    assert.equal(new JudgmentTrueForgeClient().baseUrl, 'http://127.0.0.1:9999/');
    assert.equal(new TrueForgeClient({ baseUrl: 'http://127.0.0.1:1' }).baseUrl, 'http://127.0.0.1:1');
  } finally {
    if (previous === undefined) delete process.env.TRUEFORGE_BASE_URL;
    else process.env.TRUEFORGE_BASE_URL = previous;
  }
});

// Timeout parsing and receipt freshness.

test('H9 out-of-range or fractional timeouts fall back and always yield a usable signal', () => {
  for (const raw of ['1e20', String(2 ** 31), '9007199254740993', '0.5', '2500.7', 'Infinity']) {
    const parsed = parseTimeout(raw);
    assert.equal(parsed.source, 'FALLBACK', raw);
    assert.doesNotThrow(() => AbortSignal.timeout(parsed.ms), raw);
  }
  assert.deepEqual(parseTimeout(String(MAX_TIMER_MS)), { ms: MAX_TIMER_MS, source: 'ENV' });
  assert.deepEqual(parseTimeout('1'), { ms: 1, source: 'ENV' });
});

function passingChecks() {
  return Object.fromEntries(CANONICAL_DECIDING_FIELDS.map(field => [field, { observed: true }]));
}

test('H10 a receipt dated in the future cannot bypass expiry', () => {
  const now = 1_800_000_000_000;
  const receipt = generatedAt => ({
    generated_at: generatedAt,
    checks: passingChecks(),
    deciding_fields: [...CANONICAL_DECIDING_FIELDS],
  });
  assert.equal(validateReceipt(receipt(now), passingChecks(), now).valid, true);
  assert.equal(validateReceipt(receipt(now + 30_000), passingChecks(), now).valid, true);
  const future = validateReceipt(receipt(now + 24 * 60 * 60 * 1000), passingChecks(), now);
  assert.equal(future.valid, false);
  assert.equal(future.reason, 'RECEIPT_FROM_FUTURE');
  assert.equal(validateReceipt(receipt(1e308), passingChecks(), now).reason, 'RECEIPT_FROM_FUTURE');
  assert.equal(validateReceipt(receipt(Number.NaN), passingChecks(), now).reason, 'NO_TIMESTAMP');
});

test('H11 a malformed Daytona id is reported as a refused shape, not an outage, with no request', async () => {
  const { daytonaCleanupProvider } = await import('../scripts/pr2/run.mjs');
  let requests = 0;
  const provider = daytonaCleanupProvider({
    apiKey: 'sentinel',
    fetchImpl: async () => { requests += 1; return new Response(null, { status: 404 }); },
  });
  for (const id of ['v1:daytona:default.*', 'v1:daytona:other.12345678-1234-1234-1234-123456789abc']) {
    await assert.rejects(provider.deleteSandbox(id), error => error.code === 'DAYTONA_SANDBOX_ID_SHAPE_REJECTED');
    await assert.rejects(provider.observeAbsent(id), error => error.code === 'DAYTONA_SANDBOX_ID_SHAPE_REJECTED');
  }
  assert.equal(requests, 0);
});
