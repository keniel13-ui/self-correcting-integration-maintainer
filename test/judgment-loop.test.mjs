import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { canonicalJson, canonicalJsonBytes } from '../scripts/pr2/canonical.mjs';
import { sha256 } from '../scripts/pr2/inputs.mjs';
import { prepareCandidateVerification } from '../scripts/judgment/candidate.mjs';
import {
  buildAgentPrompt,
  instructionSha256,
  loadCorpus,
  runtimeToolSurfaceSha256,
  toolsSha256,
  validateAgentResponse,
  validateCorpusManifest,
  validatePriorKnowledge,
} from '../scripts/judgment/core.mjs';
import {
  AGENT_CAPABILITIES,
  AGENT_CAPABILITY_MANIFEST_SHA256,
  CALLER_TOOL_DESCRIPTIONS_SHA256,
  CHANGE_PROPOSAL_SCHEMA_SHA256,
  JUDGMENT_CONTRACT_SHA256,
  JUDGMENT_RESPONSE_FORMAT,
  JUDGMENT_SESSION_CONFIG,
  RUNTIME_TOOL_SURFACE_SHA256,
  SYSTEM_INSTRUCTIONS,
  TOOL_DESCRIPTIONS,
} from '../scripts/judgment/constants.mjs';
import {
  assertPreparedTransport,
  inspectPreparedTransport,
  JudgmentTrueForgeClient,
  reduceCandidateVerification,
  reduceJudgmentExecution,
  runCandidateVerification,
  runJudgmentModel,
} from '../scripts/judgment/live.mjs';
import { assertJudgmentRuntimeInstallation } from '../scripts/judgment/runtime-surface.mjs';
import { validateChangeProposal } from '../scripts/judgment/proposal.mjs';
import { recomputeFinding } from '../scripts/judgment/recompute.mjs';
import { executeJudgmentLoop } from '../scripts/judgment/run.mjs';

const sandboxId = 'v1:daytona:default.12345678-1234-1234-1234-123456789abc';
const FIXED_EXEC_INTENT = 'Run candidate verification';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'judgment-corpus-'));
  const path = 'src/check.mjs';
  const text = [
    '// bug tracking label is ordinary source text',
    'export function decide(report) {',
    '  const ok = report.node && report.packages;',
    '  return { ok, credentials: report.credentials };',
    '}',
    '',
  ].join('\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, path), text);
  const bytes = Buffer.from(text);
  const manifest = {
    schema: 'judgment_corpus/v1',
    corpus_id: 'unpublished-demo-1',
    files: [{ path, sha256: sha256(bytes), size_bytes: bytes.length }],
    verification: { argv: ['node', '--test'], timeout_ms: 10_000 },
  };
  const manifestBytes = canonicalJsonBytes(manifest);
  const prior = {
    schema: 'prior_knowledge/v2',
    what_the_agent_is_given: {
      instructions_sha256: instructionSha256(),
      caller_tool_descriptions_sha256: toolsSha256(),
      runtime_tool_surface_sha256: runtimeToolSurfaceSha256(),
      runtime_tool_surface_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
      corpus_manifest_sha256: sha256(manifestBytes),
    },
    known_conditions: structuredClone(
      JSON.parse(readFileSync('docs/contracts/PRIOR_KNOWLEDGE.json')).known_conditions,
    ),
  };
  return { root, text, manifest, manifestBytes, prior, priorBytes: canonicalJsonBytes(prior) };
}

function response(changes = {}) {
  return canonicalJson({
    schema: 'judgment_response/v1',
    findings: [{
      condition: 'credentials are reported but excluded from the verdict',
      path: 'src/check.mjs',
      exact_bytes: 'const ok = report.node && report.packages;',
      why_it_matters: 'A caller can proceed while credentials are absent.',
      evidence: ['The returned credentials field does not enter ok.'],
      novelty: 'CONFIRMS_KNOWN',
      known_condition_id: 'K5',
      confidence_basis: 'Inspected the deciding expression and the returned sibling field.',
      not_established: ['No live credential was tested.'],
      repair: {
        before_exact: 'const ok = report.node && report.packages;',
        after_exact: 'const ok = report.node && report.packages && report.credentials;',
      },
      ...changes,
    }],
  });
}

function state(f = fixture()) {
  const corpus = loadCorpus({ corpusRoot: f.root, manifestBytes: f.manifestBytes });
  const priorState = validatePriorKnowledge(f.priorBytes, {
    instructions_sha256: instructionSha256(),
    caller_tool_descriptions_sha256: toolsSha256(),
    runtime_tool_surface_sha256: runtimeToolSurfaceSha256(),
    runtime_tool_surface_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
    corpus_manifest_sha256: corpus.manifestSha256,
  });
  return { f, corpus, priorState };
}

function findingState() {
  const s = state();
  const [finding] = validateAgentResponse(response(), {
    corpus: s.corpus,
    priorSha256: s.priorState.priorSha256,
    knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-00000000000000000000000000000000',
  });
  const prepared = prepareCandidateVerification({ corpus: s.corpus, finding });
  return { ...s, finding, prepared };
}

function outboundArtifactBytes(prepared, role) {
  const artifact = prepared.outboundArtifacts.find(item => item.role === role);
  assert.ok(artifact, `missing ${role} outbound artifact`);
  const prefix = `data:${artifact.mime};base64,`;
  assert.equal(artifact.data_uri.startsWith(prefix), true);
  return Buffer.from(artifact.data_uri.slice(prefix.length), 'base64');
}

function withOutboundArtifacts(prepared, outboundArtifacts) {
  return { ...prepared, outboundArtifacts };
}

function tamperArtifactData(prepared, role) {
  return withOutboundArtifacts(prepared, prepared.outboundArtifacts.map(artifact => {
    if (artifact.role !== role) return artifact;
    const comma = artifact.data_uri.indexOf(',');
    const index = comma + 1;
    const replacement = artifact.data_uri[index] === 'A' ? 'B' : 'A';
    return {
      ...artifact,
      data_uri: `${artifact.data_uri.slice(0, index)}${replacement}${artifact.data_uri.slice(index + 1)}`,
    };
  }));
}

function noAuthorityClient() {
  const calls = { provider: 0, session: 0, turn: 0 };
  return {
    calls,
    client: {
      async assertDaytonaSandboxProvider() { calls.provider += 1; },
      async createRelaySession() { calls.session += 1; return 'session-should-not-exist'; },
      async createRelayTurn() { calls.turn += 1; return 'turn-should-not-exist'; },
    },
  };
}

function variantFindingState() {
  const f = fixture();
  const path = f.manifest.files[0].path;
  const text = `${f.text}// second run has different corpus bytes\n`;
  writeFileSync(join(f.root, path), text);
  const bytes = Buffer.from(text);
  f.text = text;
  f.manifest = {
    ...f.manifest,
    corpus_id: 'unpublished-demo-2',
    files: [{ path, sha256: sha256(bytes), size_bytes: bytes.length }],
    verification: { argv: ['node', '--test'], timeout_ms: 11_000 },
  };
  f.manifestBytes = canonicalJsonBytes(f.manifest);
  f.prior.what_the_agent_is_given.corpus_manifest_sha256 = sha256(f.manifestBytes);
  f.priorBytes = canonicalJsonBytes(f.prior);
  const s = state(f);
  const [finding] = validateAgentResponse(response({
    condition: 'a second finding produces a different candidate payload',
    why_it_matters: 'The second run must not change the verifier program.',
    repair: {
      before_exact: 'const ok = report.node && report.packages;',
      after_exact: 'const ok = Boolean(report.node && report.packages && report.credentials);',
    },
  }), {
    corpus: s.corpus,
    priorSha256: s.priorState.priorSha256,
    knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-22222222222222222222222222222222',
  });
  return { ...s, finding, prepared: prepareCandidateVerification({ corpus: s.corpus, finding }) };
}

function sandboxResult(prepared, changes = {}) {
  return {
    command_manifest_sha256: prepared.commandManifestSha256,
    exit_code: 0,
    payload_bundle_sha256: prepared.candidateBundleSha256,
    schema: 'candidate_verification_result/v1',
    stderr_length: 0,
    stderr_sha256: sha256(Buffer.alloc(0)),
    stdout_length: 4,
    stdout_sha256: sha256(Buffer.from('ok\n')),
    verifier_sha256: prepared.verifierSha256,
    ...changes,
  };
}

function successEvents(prepared, changes = {}) {
  const callId = 'call-1';
  return [
    { type: 'sandbox.created', sandbox_id: sandboxId },
    {
      type: 'model.message',
      tool_calls: [{
        id: callId,
        function: { name: 'exec', arguments: JSON.stringify(prepared.expectedExecArguments) },
        tool_info: { type: 'truefoundry-system', name: 'exec' },
      }],
    },
    {
      type: 'tool.response',
      tool_call_id: callId,
      content: JSON.stringify({
        success: true,
        response: { exitCode: 0, result: canonicalJson(sandboxResult(prepared, changes)) },
      }),
    },
  ];
}

function successVerification(prepared) {
  return reduceCandidateVerification({
    events: successEvents(prepared),
    turnStatus: 'done',
    prepared,
    sessionId: 'session-1',
    turnId: 'turn-1',
    cleanup: {
      attempted_ids: [sandboxId],
      confirmed_absent_ids: [sandboxId],
      unconfirmed_ids: [],
      checked_at_utc: '2026-08-27T15:00:00.000Z',
    },
  });
}

function judgmentEvents({ withClock = false, callChanges = {}, extraEvents = [] } = {}) {
  const events = [{ type: 'turn.created', id: 'judgment-event-created', state: { status: 'running' } }];
  if (withClock) {
    const call = {
      id: 'clock-call-1',
      type: 'function',
      function: { name: 'get_current_datetime', arguments: '' },
      tool_info: { type: 'truefoundry-system', name: 'get_current_datetime' },
      ...callChanges,
    };
    events.push({ type: 'model.message', id: 'judgment-event-tool', tool_calls: [call] });
    events.push({
      type: 'tool.response',
      id: 'judgment-event-response',
      tool_call_id: call.id,
      content: '{"iso":"2026-08-28T15:20:38.131Z","unixEpochMS":1787930438131}',
    });
  }
  events.push(...extraEvents);
  events.push({ type: 'model.message', id: 'judgment-event-final', content: response() });
  events.push({ type: 'turn.done', id: 'judgment-event-done', state: { status: 'done' } });
  return events;
}

function successfulJudgmentModel(content = response(), { withClock = false } = {}) {
  const persistedEvents = judgmentEvents({ withClock });
  const executionEvidence = reduceJudgmentExecution({
    events: persistedEvents,
    eventsObserved: true,
    turnStatus: 'done',
    sessionId: 'judgment-session-1',
    turnId: 'judgment-turn-1',
  });
  assert.equal(executionEvidence.status, 'ESTABLISHED');
  return {
    content,
    usage: { input_tokens: 100, output_tokens: 20 },
    runtimePreflight: assertJudgmentRuntimeInstallation(),
    persistedEvents,
    executionEvidence,
  };
}

test('V5-T1 declared minimum surface matches the single unavoidable stock TrueForge tool', async () => {
  const expectedConfig = {
    iteration_limit: 2,
    sandbox: { enabled: false, file_downloads: false },
    dynamic_sub_agents: { enabled: false },
    context_management: {
      compaction: { enabled: false },
      large_tool_response: { enabled: false },
    },
    generative_ui: { enabled: false },
    ask_user_questions: { enabled: false },
  };
  const logger = { child() { return this; } };
  const [{ AgentSpecSchema }, { builtinsFromSpec }, constants] = await Promise.all([
    import('../node_modules/@truefoundry/trueforge-core/dist/agent-session/schemas/agentSpec.mjs'),
    import('../node_modules/@truefoundry/trueforge-core/dist/agent-session/builtinsFromSpec.mjs'),
    import('../scripts/judgment/constants.mjs'),
  ]);
  const spec = AgentSpecSchema.parse({
    model: { name: 'anthropic/claude-haiku-4-5' },
    config: expectedConfig,
  });
  const effectiveTools = builtinsFromSpec({
    spec,
    definition: {},
    isChild: false,
    sandboxAvailable: false,
    tracing: {},
    logger,
  }).flatMap(capability => capability.systemToolSets ?? []).flatMap(toolSet => toolSet.getTools().map(tool => ({
    type: 'truefoundry-system',
    mcp_server_id: toolSet.id,
    mcp_server_name: toolSet.name,
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    is_approval_required: false,
  })));

  assert.deepEqual(constants.JUDGMENT_SESSION_CONFIG, expectedConfig);
  assert.deepEqual(constants.RUNTIME_TOOL_SURFACE, effectiveTools);
  assert.deepEqual(effectiveTools.map(tool => tool.name), ['get_current_datetime']);
});

test('V5-T2 installed version or source mismatch blocks before session creation', async () => {
  const verified = assertJudgmentRuntimeInstallation();
  assert.equal(verified.status, 'VERIFIED_BEFORE_TURN');
  assert.throws(() => assertJudgmentRuntimeInstallation({
    readBytes(path) {
      const bytes = readFileSync(path);
      return path.endsWith('/trueforge/dist/main.js')
        ? Buffer.concat([bytes, Buffer.from('\nchanged')])
        : bytes;
    },
  }), /JUDGMENT_RUNTIME_SOURCE_MISMATCH/);

  let sessions = 0;
  await assert.rejects(runJudgmentModel({
    prompt: 'bounded prompt',
    instructions: SYSTEM_INSTRUCTIONS,
    runtimeGate() { throw new TypeError('JUDGMENT_RUNTIME_SOURCE_MISMATCH'); },
    client: {
      async createJudgmentSession() { sessions += 1; return 'must-not-exist'; },
    },
  }), /JUDGMENT_RUNTIME_SOURCE_MISMATCH/);
  assert.equal(sessions, 0);
});

test('V5-T5 final JSON without persisted execution evidence writes no artifact', async () => {
  const s = findingState();
  const runsRoot = join(mkdtempSync(join(tmpdir(), 'judgment-no-events-')), 'runs');
  let verifierCalled = false;
  await assert.rejects(executeJudgmentLoop({
    corpusRoot: s.f.root,
    manifestBytes: s.f.manifestBytes,
    priorBytes: s.f.priorBytes,
    runsRoot,
    runModel: async () => ({ content: response(), usage: null }),
    verifyCandidate: async () => { verifierCalled = true; },
  }), /judgment runtime preflight evidence invalid/);
  assert.equal(verifierCalled, false);
  assert.equal(existsSync(runsRoot), false);
});

test('V5-T6 unexpected judgment tool call fails closed', () => {
  const events = judgmentEvents({ withClock: true });
  const call = events.find(event => Array.isArray(event.tool_calls)).tool_calls[0];
  call.function.name = 'exec';
  call.tool_info.name = 'exec';
  const evidence = reduceJudgmentExecution({
    events,
    turnStatus: 'done',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.ok(evidence.failure_reasons.includes('JUDGMENT_TOOL_CALL_SHAPE_INVALID'));
});

test('V5-T7 zero clock calls is admissible and records availability separately from exercise', () => {
  const events = judgmentEvents();
  const evidence = reduceJudgmentExecution({
    events,
    turnStatus: 'done',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  assert.equal(evidence.status, 'ESTABLISHED');
  assert.equal(evidence.availability.available_tool_count, 1);
  assert.equal(evidence.availability.runtime_tool_surface_sha256, RUNTIME_TOOL_SURFACE_SHA256);
  assert.equal(evidence.exercise.tool_call_count, 0);
  assert.equal(evidence.exercise.tool_response_count, 0);
  assert.equal(evidence.exercise.call, null);
});

test('V6-T8 exactly one persisted empty-argument clock call and response is admissible', () => {
  const events = judgmentEvents({ withClock: true });
  const evidence = reduceJudgmentExecution({
    events,
    turnStatus: 'done',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  assert.equal(evidence.status, 'ESTABLISHED');
  assert.equal(evidence.exercise.tool_call_count, 1);
  assert.equal(evidence.exercise.tool_response_count, 1);
  assert.deepEqual(evidence.exercise.call.tool_info, {
    type: 'truefoundry-system',
    name: 'get_current_datetime',
  });
  assert.equal(evidence.exercise.call.arguments_empty, true);
  assert.match(evidence.exercise.response_content_sha256, /^[0-9a-f]{64}$/);
});

test('V6-T9 duplicate, malformed, mismatched, sandbox, and question events all block', () => {
  const duplicate = judgmentEvents({ withClock: true });
  const duplicateMessage = duplicate.find(event => Array.isArray(event.tool_calls));
  duplicateMessage.tool_calls.push(structuredClone(duplicateMessage.tool_calls[0]));

  const malformed = judgmentEvents({ withClock: true });
  malformed.find(event => Array.isArray(event.tool_calls)).tool_calls[0].tool_info.mcp_server_id =
    'current-datetime';

  const mismatched = judgmentEvents({ withClock: true });
  mismatched.find(event => event.type === 'tool.response').tool_call_id = 'different-call';

  const missingResponse = judgmentEvents({ withClock: true })
    .filter(event => event.type !== 'tool.response');
  const sandbox = judgmentEvents({ extraEvents: [{ type: 'sandbox.created', sandbox_id: sandboxId }] });
  const question = judgmentEvents({ extraEvents: [{ type: 'ask_user_question.created', id: 'question-1' }] });
  const malformedEvent = judgmentEvents({ extraEvents: [null] });

  for (const events of [duplicate, malformed, mismatched, missingResponse, sandbox, question, malformedEvent]) {
    const evidence = reduceJudgmentExecution({ events, turnStatus: 'done' });
    assert.equal(evidence.status, 'NOT_ESTABLISHED');
    assert.ok(evidence.failure_reasons.length > 0);
  }
});

test('V5-T10 caller descriptions and effective runtime surface remain distinct nonempty hashes', () => {
  assert.equal(toolsSha256(), CALLER_TOOL_DESCRIPTIONS_SHA256);
  assert.equal(runtimeToolSurfaceSha256(), RUNTIME_TOOL_SURFACE_SHA256);
  assert.notEqual(CALLER_TOOL_DESCRIPTIONS_SHA256, RUNTIME_TOOL_SURFACE_SHA256);
  assert.notEqual(RUNTIME_TOOL_SURFACE_SHA256, sha256(canonicalJsonBytes([])));
});

test('V5-T12 consumed Run 001 prior cannot govern the successor execution path', () => {
  const predecessor = readFileSync('docs/contracts/PRIOR_KNOWLEDGE.json');
  assert.throws(() => validatePriorKnowledge(predecessor, {
    instructions_sha256: instructionSha256(),
    caller_tool_descriptions_sha256: CALLER_TOOL_DESCRIPTIONS_SHA256,
    runtime_tool_surface_sha256: RUNTIME_TOOL_SURFACE_SHA256,
    runtime_tool_surface_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
  }), /consumed predecessor prior/);
});

test('V9-F3 successor prior rejects one reworded known condition', () => {
  const successor = JSON.parse(readFileSync('docs/contracts/PRIOR_KNOWLEDGE_RUN_003.json'));
  successor.known_conditions[0].description += ' Reworded after the predecessor was consumed.';
  assert.throws(
    () => validatePriorKnowledge(canonicalJsonBytes(successor)),
    /known conditions digest mismatch/,
  );
});

test('Run 004 has a separately frozen prior while Run 003 custody remains exact', () => {
  const run3PriorBytes = readFileSync('docs/contracts/PRIOR_KNOWLEDGE_RUN_003.json');
  const run4PriorBytes = readFileSync('docs/contracts/PRIOR_KNOWLEDGE_RUN_004.json');
  assert.equal(
    sha256(run3PriorBytes),
    '04b4c700bdae79b6a550d20618eae79aa525c5335a273193be9616987fff93f3',
  );
  assert.equal(
    sha256(run4PriorBytes),
    '93820ea5a67e732aa55e896cd838200c3590af1e98368fd87e85dfd66da1cf1e',
  );
  assert.deepEqual(canonicalJsonBytes(JSON.parse(run4PriorBytes)), run4PriorBytes);

  const expected = {
    instructions_sha256: instructionSha256(),
    caller_tool_descriptions_sha256: CALLER_TOOL_DESCRIPTIONS_SHA256,
    runtime_tool_surface_sha256: RUNTIME_TOOL_SURFACE_SHA256,
    runtime_tool_surface_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
    corpus_manifest_sha256: '914b22f52a9d7d8ce382458caa3915cc47841ccfd153f72f314107c55be08fb6',
  };
  const run4 = validatePriorKnowledge(run4PriorBytes, expected);
  assert.deepEqual([...run4.knownIds], ['K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
  assert.equal(run4.prior.run_identity, 'Run 004');
  assert.equal(run4.prior.status, 'FROZEN_BEFORE_RUN_004');
  assert.equal(run4.prior.run_003_compliance, 'NON_COMPLIANT_V7_1_6_PERMANENT');
  assert.throws(
    () => validatePriorKnowledge(run3PriorBytes, expected),
    /instructions_sha256 mismatch/,
  );
});

test('J01 corpus manifest rejects empty, unsorted, duplicate, oversized, and mismatched inputs', () => {
  const f = fixture();
  assert.equal(loadCorpus({ corpusRoot: f.root, manifestBytes: f.manifestBytes }).files.length, 1);
  assert.throws(() => validateCorpusManifest({ ...f.manifest, files: [] }), /length/);
  const duplicate = { ...f.manifest, files: [f.manifest.files[0], f.manifest.files[0]] };
  assert.throws(() => validateCorpusManifest(duplicate), /duplicate/);
  writeFileSync(join(f.root, 'src/check.mjs'), 'changed\n');
  assert.throws(() => loadCorpus({ corpusRoot: f.root, manifestBytes: f.manifestBytes }), /mismatch/);
});

test('J02 unresolved or mismatched prior hashes block before a model call', () => {
  const f = fixture();
  const pending = structuredClone(f.prior);
  pending.what_the_agent_is_given.runtime_tool_surface_sha256 = 'PENDING';
  assert.throws(() => validatePriorKnowledge(canonicalJsonBytes(pending)), /unresolved/);
  assert.throws(() => validatePriorKnowledge(f.priorBytes, {
    runtime_tool_surface_sha256: '0'.repeat(64),
    runtime_tool_surface_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
  }), /mismatch/);
});

test('J03 prompt contains every corpus file and discloses only the bounded stock clock tool', () => {
  const s = state();
  const prompt = buildAgentPrompt(s.corpus, s.priorState.prior);
  assert.match(prompt, /src\/check\.mjs/);
  assert.match(prompt, /report\.credentials/);
  assert.match(prompt, /bug tracking label/);
  assert.match(prompt, /signal nobody consumes/i);
  assert.deepEqual(TOOL_DESCRIPTIONS, []);
  assert.match(SYSTEM_INSTRUCTIONS, /one clock tool/i);
  assert.match(SYSTEM_INSTRUCTIONS, /no other tool/i);
  assert.ok(AGENT_CAPABILITIES.denied.includes('apply_change'));
  assert.doesNotMatch(SYSTEM_INSTRUCTIONS, /READY_LOCAL/);
});

test('J04 line and exact-byte evidence are computed by the harness', () => {
  const s = findingState();
  assert.equal(s.finding.observed.line, 3);
  assert.equal(s.finding.evidence[0].occurrence_count, 1);
  assert.equal(s.finding.proposed_action, 'CP-001');
  assert.equal(Object.hasOwn(s.finding.observed, 'model_line'), false);
});

test('J05 ambiguous bytes, bare confidence, empty limits, and false novelty references are rejected', () => {
  const s = state();
  assert.throws(() => validateAgentResponse(response({ exact_bytes: 'report' }), {
    corpus: s.corpus, priorSha256: s.priorState.priorSha256, knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-00000000000000000000000000000000',
  }), /exact bytes/);
  assert.throws(() => validateAgentResponse(response({ confidence_basis: '95%' }), {
    corpus: s.corpus, priorSha256: s.priorState.priorSha256, knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-00000000000000000000000000000000',
  }), /bare number/);
  assert.throws(() => validateAgentResponse(response({ not_established: [] }), {
    corpus: s.corpus, priorSha256: s.priorState.priorSha256, knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-00000000000000000000000000000000',
  }), /nonempty/);
  assert.throws(() => validateAgentResponse(response({ novelty: 'NEW' }), {
    corpus: s.corpus, priorSha256: s.priorState.priorSha256, knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-00000000000000000000000000000000',
  }), /must not cite/);
  assert.throws(() => validateAgentResponse(response({ repair: {
    before_exact: 'const ok = report.node && report.packages;',
    after_exact: 'é'.repeat(5_000),
  } }), {
    corpus: s.corpus, priorSha256: s.priorState.priorSha256, knownIds: s.priorState.knownIds,
    recomputeRunPath: 'docs/demo/runs/judgment-00000000000000000000000000000000',
  }), /byte bounds/);
});

test('J06 exact repair changes only the named file and binds the complete result', () => {
  const s = findingState();
  const target = s.prepared.files.find(file => file.path === 'src/check.mjs');
  assert.match(target.bytes.toString('utf8'), /&& report\.credentials/);
  assert.equal(sha256(target.bytes), s.prepared.target.resulting_file_sha256);
  assert.equal(s.prepared.commandManifest.irreversible_actions_allowed, false);
  assert.equal(
    s.prepared.expectedExecArguments.command,
    'node /opt/tf/uploads/candidate-verifier.cjs /opt/tf/uploads/candidate-payload.json ' +
      '/opt/tf/uploads/candidate-command-manifest.json',
  );
  assert.equal(Buffer.byteLength(s.prepared.expectedExecArguments.command, 'utf8'), 130);
  assert.equal(Buffer.byteLength(JSON.stringify(s.prepared.expectedExecArguments), 'utf8'), 182);
  assert.equal(canonicalJsonBytes(s.prepared.expectedExecArguments).length, 183);
  assert.deepEqual(s.prepared.outboundArtifacts.map(artifact => artifact.role), ['verifier', 'payload', 'manifest']);
  for (const artifact of s.prepared.outboundArtifacts) {
    const encoded = artifact.data_uri.split(',', 2)[1];
    assert.equal(sha256(Buffer.from(encoded, 'base64')), artifact.sha256);
  }
  assert.equal(s.prepared.commandManifest.verifier_sha256, s.prepared.verifierSha256);
  assert.equal(s.prepared.commandManifest.payload_bundle_sha256, s.prepared.candidateBundleSha256);
  assert.deepEqual(
    Object.keys(JSON.parse(outboundArtifactBytes(s.prepared, 'payload'))).sort(),
    ['files', 'schema'],
  );
  assert.equal(
    s.prepared.commandManifest.transport.exec_arguments_sha256,
    sha256(canonicalJsonBytes(s.prepared.expectedExecArguments)),
  );
});

test('J07 candidate verification requires persisted call, nested response, exit zero, and exact cleanup', () => {
  const s = findingState();
  assert.equal(successVerification(s.prepared).status, 'VERIFIED_IN_DAYTONA');
  const malformed = reduceCandidateVerification({
    events: [{ type: 'model.message', content: 'worked' }],
    turnStatus: 'done',
    prepared: s.prepared,
    cleanup: { attempted_ids: [], confirmed_absent_ids: [], unconfirmed_ids: [] },
  });
  assert.equal(malformed.status, 'NOT_ESTABLISHED');
  const nonzero = reduceCandidateVerification({
    events: successEvents(s.prepared, { exit_code: 1 }),
    turnStatus: 'done',
    prepared: s.prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.ok(nonzero.failure_reasons.includes('CANDIDATE_EXIT_NONZERO'));
});

test('J07b duplicate or malformed sandbox creation events fail raw cardinality', () => {
  const prepared = findingState().prepared;
  const base = successEvents(prepared);
  const variants = [
    [base[0], base[0], ...base.slice(1)],
    [base[0], { type: 'sandbox.created', sandbox_id: 'malformed' }, ...base.slice(1)],
  ];
  for (const events of variants) {
    const evidence = reduceCandidateVerification({
      events,
      turnStatus: 'done',
      prepared,
      cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
    });
    assert.deepEqual(evidence.failure_reasons, ['SANDBOX_EVENT_CARDINALITY_INVALID']);
    assert.equal(evidence.status, 'NOT_ESTABLISHED');
  }
});

test('J08 proposal schema cannot represent approval or application', () => {
  const s = findingState();
  const verification = successVerification(s.prepared);
  const repoRoot = mkdtempSync(join(tmpdir(), 'judgment-repo-'));
  const runs = join(repoRoot, 'docs/demo/runs');
  return executeJudgmentLoop({
    corpusRoot: s.f.root,
    manifestBytes: s.f.manifestBytes,
    priorBytes: s.f.priorBytes,
    repoRoot,
    runsRoot: runs,
    runId: 'judgment-00000000000000000000000000000000',
    now: () => '2026-08-27T15:00:00.000Z',
    runModel: async () => successfulJudgmentModel(),
    verifyCandidate: async () => verification,
  }).then(result => {
    assert.equal(result.status, 'BREAKER_PENDING');
    assert.equal(result.classification_correct, false);
    assert.equal(result.authority.target_mutated, false);
    const proposal = JSON.parse(readFileSync(join(result.run_dir, 'change_proposal.json'), 'utf8'));
    assert.equal(validateChangeProposal(proposal), proposal);
    assert.equal(proposal.authority.state, 'AWAITING_HUMAN_APPROVAL');
    assert.equal(proposal.authority.applied, false);
  });
});

test('J09 empty finding set is NO_FINDINGS, not CLEAN, and writes no artifact', async () => {
  const s = state();
  let verifierCalled = false;
  const repoRoot = mkdtempSync(join(tmpdir(), 'judgment-empty-'));
  const outcome = await executeJudgmentLoop({
    corpusRoot: s.f.root,
    manifestBytes: s.f.manifestBytes,
    priorBytes: s.f.priorBytes,
    repoRoot,
    runsRoot: join(repoRoot, 'docs/demo/runs'),
    runModel: async () => successfulJudgmentModel(
      canonicalJson({ schema: 'judgment_response/v1', findings: [] }),
    ),
    verifyCandidate: async () => { verifierCalled = true; },
  });
  assert.equal(outcome.status, 'NO_FINDINGS');
  assert.equal(outcome.scanned_item_count, 1);
  assert.equal(outcome.artifact_written, false);
  assert.equal(verifierCalled, false);
  assert.equal(JSON.stringify(outcome).includes('CLEAN'), false);
});

test('J10 recomputation rejects model assertion and re-derives bytes, count, line, and hashes', async () => {
  const s = findingState();
  const repoRoot = mkdtempSync(join(tmpdir(), 'judgment-recompute-'));
  const runs = join(repoRoot, 'docs/demo/runs');
  const result = await executeJudgmentLoop({
    corpusRoot: s.f.root,
    manifestBytes: s.f.manifestBytes,
    priorBytes: s.f.priorBytes,
    repoRoot,
    runsRoot: runs,
    runId: 'judgment-11111111111111111111111111111111',
    runModel: async () => successfulJudgmentModel(),
    verifyCandidate: async ({ prepared }) => successVerification(prepared),
  });
  const artifactBytes = readFileSync(join(result.run_dir, 'judgment_run_artifact.json'));
  assert.equal(
    JSON.parse(artifactBytes).findings[0].recompute_command,
    'node recompute/scripts/judgment/recompute.mjs --run . --finding F-001',
  );
  const recomputed = recomputeFinding({
    corpusRoot: join(result.run_dir, 'corpus'),
    manifestBytes: readFileSync(join(result.run_dir, 'corpus_manifest.json')),
    priorBytes: readFileSync(join(result.run_dir, 'PRIOR_KNOWLEDGE.json')),
    artifactBytes,
    findingId: 'F-001',
  });
  assert.equal(recomputed.status, 'RECOMPUTED');
  assert.equal(recomputed.observed_line, 3);
  const projectRoot = dirname(dirname(new URL(import.meta.url).pathname));
  const cli = spawnSync(process.execPath, [
    join(projectRoot, 'scripts/judgment/recompute.mjs'),
    '--run', relative(repoRoot, result.run_dir),
    '--finding', 'F-001',
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, 'RECOMPUTED');
});

test('J10b external run roots remain recomputable after relocation without shell-specific quoting', async () => {
  const s = findingState();
  const runs = mkdtempSync(join(tmpdir(), "judgment external root's "));
  const result = await executeJudgmentLoop({
    corpusRoot: s.f.root,
    manifestBytes: s.f.manifestBytes,
    priorBytes: s.f.priorBytes,
    runsRoot: runs,
    runId: 'judgment-22222222222222222222222222222222',
    runModel: async () => successfulJudgmentModel(),
    verifyCandidate: async ({ prepared }) => successVerification(prepared),
  });
  const publishedRoot = mkdtempSync(join(tmpdir(), 'judgment published '));
  const movedRun = join(publishedRoot, 'copied-run');
  renameSync(result.run_dir, movedRun);
  const artifact = JSON.parse(readFileSync(join(movedRun, 'judgment_run_artifact.json')));
  assert.equal(
    artifact.findings[0].recompute_command,
    'node recompute/scripts/judgment/recompute.mjs --run . --finding F-001',
  );
  const cli = spawnSync(process.execPath, [
    'recompute/scripts/judgment/recompute.mjs', '--run', '.', '--finding', 'F-001',
  ], {
    cwd: movedRun,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, 'RECOMPUTED');
});

test('J11 controlling contract, proposal schema, and capability manifest hashes are exact', () => {
  const root = dirname(dirname(new URL(import.meta.url).pathname));
  const artifacts = [
    ['docs/contracts/HACKATHON_JUDGMENT_LOOP_CONTRACT_V9_ADDENDUM_2026-08-28.md', JUDGMENT_CONTRACT_SHA256],
    ['docs/contracts/change-proposal-v2.schema.json', CHANGE_PROPOSAL_SCHEMA_SHA256],
    ['docs/contracts/agent-capability-manifest-v2.json', AGENT_CAPABILITY_MANIFEST_SHA256],
  ];
  for (const [path, expected] of artifacts) {
    assert.equal(sha256(readFileSync(join(root, path))), expected);
  }
});

test('J12 transmits the exact minimized config and closed JSON schema request', async () => {
  let observed;
  const client = new JudgmentTrueForgeClient();
  client.request = async (method, path, body) => {
    observed = { method, path, body };
    return {
      data: {
        id: 'session-1',
        agent: {
          spec: {
            config: JUDGMENT_SESSION_CONFIG,
            response_format: JUDGMENT_RESPONSE_FORMAT,
          },
        },
      },
    };
  };
  assert.equal(await client.createJudgmentSession(SYSTEM_INSTRUCTIONS), 'session-1');
  assert.equal(observed.method, 'POST');
  assert.equal(observed.path, '/api/v1/sessions');
  assert.deepEqual(observed.body.agent.spec.config, JUDGMENT_SESSION_CONFIG);
  assert.deepEqual(observed.body.agent.spec.response_format, JUDGMENT_RESPONSE_FORMAT);
  assert.equal(Object.hasOwn(observed.body.agent.spec, 'tools'), false);
  const { AgentSpecSchema } = await import(
    '../node_modules/@truefoundry/trueforge-core/dist/agent-session/schemas/agentSpec.mjs'
  );
  assert.deepEqual(
    AgentSpecSchema.parse(observed.body.agent.spec).response_format,
    JUDGMENT_RESPONSE_FORMAT,
  );
});

test('V9-F4 returned response format mismatch cancels before the model prompt', async () => {
  const requests = [];
  const client = new JudgmentTrueForgeClient();
  client.request = async (method, path, body) => {
    requests.push({ method, path, body });
    if (path === '/api/v1/sessions') {
      return {
        data: {
          id: 'session-response-format-mismatch',
          agent: {
            spec: {
              config: JUDGMENT_SESSION_CONFIG,
              response_format: { type: 'json_object' },
            },
          },
        },
      };
    }
    return null;
  };
  await assert.rejects(
    client.createJudgmentSession(SYSTEM_INSTRUCTIONS),
    error => error?.code === 'JUDGMENT_RESPONSE_FORMAT_MISMATCH' && error?.status === 422,
  );
  assert.deepEqual(requests.map(request => request.path), [
    '/api/v1/sessions',
    '/api/v1/sessions/session-response-format-mismatch/cancel',
  ]);
});

test('V5-T4 returned session config with one enabled field cancels before the model prompt', async () => {
  const requests = [];
  const client = new JudgmentTrueForgeClient();
  client.request = async (method, path, body) => {
    requests.push({ method, path, body });
    if (path === '/api/v1/sessions') {
      return {
        data: {
          id: 'session-config-mismatch',
          agent: { spec: {
            config: {
              ...structuredClone(JUDGMENT_SESSION_CONFIG),
              generative_ui: { enabled: true },
            },
            response_format: JUDGMENT_RESPONSE_FORMAT,
          } },
        },
      };
    }
    return null;
  };
  await assert.rejects(
    client.createJudgmentSession(SYSTEM_INSTRUCTIONS),
    error => error?.code === 'JUDGMENT_SESSION_CONFIG_MISMATCH' && error?.status === 422,
  );
  assert.deepEqual(requests.map(request => request.path), [
    '/api/v1/sessions',
    '/api/v1/sessions/session-config-mismatch/cancel',
  ]);
});

test('T21 fixed verifier bytes do not vary with corpus, finding, payload, or manifest', () => {
  const first = findingState().prepared;
  const second = variantFindingState().prepared;
  assert.notEqual(first.candidateBundleSha256, second.candidateBundleSha256);
  assert.notEqual(first.commandManifestSha256, second.commandManifestSha256);
  assert.deepEqual(
    outboundArtifactBytes(first, 'verifier'),
    outboundArtifactBytes(second, 'verifier'),
  );
});

test('J13 relay transports exactly three file parts and emits only the fixed short command', async () => {
  const s = findingState();
  const requests = [];
  const client = new JudgmentTrueForgeClient();
  client.request = async (method, path, body) => {
    requests.push({ method, path, body });
    return { data: { id: requests.length === 1 ? 'session-1' : 'turn-1' } };
  };
  assert.equal(await client.createRelaySession(s.prepared), 'session-1');
  assert.equal(
    await client.createRelayTurn(
      'session-1',
      s.prepared,
      60_000,
    ),
    'turn-1',
  );

  const sessionSpec = requests[0].body.agent.spec;
  assert.equal(sessionSpec.model.params.max_tokens, 512);
  assert.equal(sessionSpec.config.sandbox.enabled, true);
  assert.match(sessionSpec.instructions, /candidate-verifier\.cjs/);
  for (const artifact of s.prepared.outboundArtifacts) {
    assert.equal(sessionSpec.instructions.includes(artifact.data_uri), false);
  }

  const content = requests[1].body.input[0].content;
  assert.deepEqual(content.map(part => part.type), ['file', 'file', 'file']);
  assert.deepEqual(
    content.map(part => part.name),
    ['candidate-verifier.cjs', 'candidate-payload.json', 'candidate-command-manifest.json'],
  );
  assert.deepEqual(content.map(part => part.data), s.prepared.outboundArtifacts.map(artifact => artifact.data_uri));

  const changed = {
    ...s.prepared,
    outboundArtifacts: s.prepared.outboundArtifacts.map(artifact => artifact.role === 'payload'
      ? { ...artifact, data_uri: `${artifact.data_uri.slice(0, -1)}A` }
      : artifact),
  };
  await assert.rejects(
    client.createRelayTurn('session-1', changed, 60_000),
    /OUTBOUND_ARTIFACT_HASH_MISMATCH/,
  );
});

test('T22-R outbound cardinality blocks zero, two, and four file parts before provider or session', async () => {
  const prepared = findingState().prepared;
  const cases = [
    [],
    prepared.outboundArtifacts.slice(0, 2),
    [...prepared.outboundArtifacts, prepared.outboundArtifacts[0]],
  ];
  for (const outboundArtifacts of cases) {
    const guarded = noAuthorityClient();
    const evidence = await runCandidateVerification({
      prepared: withOutboundArtifacts(prepared, outboundArtifacts),
      client: guarded.client,
    });
    assert.deepEqual(evidence.failure_reasons, ['OUTBOUND_ARTIFACT_CARDINALITY_INVALID']);
    assert.equal(evidence.session_id, '');
    assert.equal(evidence.turn_id, '');
    assert.deepEqual(guarded.calls, { provider: 0, session: 0, turn: 0 });
  }
});

test('T23-R one changed outbound byte blocks before provider, session, turn, or spend', async () => {
  const prepared = tamperArtifactData(findingState().prepared, 'payload');
  const guarded = noAuthorityClient();
  const evidence = await runCandidateVerification({ prepared, client: guarded.client });
  assert.deepEqual(evidence.failure_reasons, ['OUTBOUND_ARTIFACT_HASH_MISMATCH']);
  assert.equal(evidence.status, 'NOT_ESTABLISHED');
  assert.equal(evidence.session_id, '');
  assert.equal(evidence.turn_id, '');
  assert.deepEqual(guarded.calls, { provider: 0, session: 0, turn: 0 });
  const payloadArtifact = prepared.outboundArtifacts.find(artifact => artifact.role === 'payload');
  const payloadEvidence = evidence.outbound_artifacts.find(artifact => artifact.role === 'payload');
  assert.notEqual(payloadEvidence.sha256, payloadArtifact.sha256);
});

test('T24 a model-emitted 257-byte command blocks while the fixed command remains below 256', () => {
  const prepared = findingState().prepared;
  assert.equal(Buffer.byteLength(prepared.expectedExecArguments.command, 'utf8'), 130);
  const events = successEvents(prepared);
  const call = events.find(event => Array.isArray(event.tool_calls)).tool_calls[0];
  call.function.arguments = canonicalJson({ command: 'x'.repeat(257) });
  const evidence = reduceCandidateVerification({
    events,
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(evidence.failure_reasons, ['EXEC_COMMAND_OVERSIZE']);
});

test('A1 exec arguments missing the fixed intent fail closed', () => {
  const prepared = findingState().prepared;
  assert.equal(prepared.expectedExecArguments.intent, FIXED_EXEC_INTENT);
  const events = successEvents(prepared);
  const call = events.find(event => Array.isArray(event.tool_calls)).tool_calls[0];
  call.function.arguments = canonicalJson({ command: prepared.expectedExecArguments.command });
  const evidence = reduceCandidateVerification({
    events,
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(evidence.failure_reasons, ['EXEC_ARGUMENTS_MISMATCH']);
});

test('A2 exec arguments with an unexpected third key fail closed', () => {
  const prepared = findingState().prepared;
  assert.equal(prepared.expectedExecArguments.intent, FIXED_EXEC_INTENT);
  const events = successEvents(prepared);
  const call = events.find(event => Array.isArray(event.tool_calls)).tool_calls[0];
  call.function.arguments = canonicalJson({ ...prepared.expectedExecArguments, extra: true });
  const evidence = reduceCandidateVerification({
    events,
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(evidence.failure_reasons, ['EXEC_ARGUMENTS_MISMATCH']);
});

test('A3 exec arguments with a one-byte intent change fail closed', () => {
  const prepared = findingState().prepared;
  assert.equal(prepared.expectedExecArguments.intent, FIXED_EXEC_INTENT);
  const events = successEvents(prepared);
  const call = events.find(event => Array.isArray(event.tool_calls)).tool_calls[0];
  call.function.arguments = canonicalJson({
    ...prepared.expectedExecArguments,
    intent: `${FIXED_EXEC_INTENT.slice(0, -1)}o`,
  });
  const evidence = reduceCandidateVerification({
    events,
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(evidence.failure_reasons, ['EXEC_ARGUMENTS_MISMATCH']);
});

test('B1 a valid Run 004 envelope with exitCode 127 is nonzero execution, not malformed output', () => {
  const prepared = findingState().prepared;
  const events = successEvents(prepared);
  const response = events.find(event => event.type === 'tool.response');
  response.content = '{"success":true,"response":{"exitCode":127,"result":"/usr/bin/bash: line 1: node: command not found\\n"}}';
  const evidence = reduceCandidateVerification({
    events,
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(evidence.failure_reasons, ['SANDBOX_EXEC_NONZERO']);
  assert.equal(evidence.sandbox_exec_exit_code, 127);
  assert.equal(evidence.result, null);
  assert.equal(evidence.failure_reasons.includes('EXEC_RESPONSE_SHAPE_UNEXPECTED'), false);
  assert.equal(evidence.failure_reasons.includes('CANDIDATE_RESULT_INVALID'), false);
});

test('T25 verifier and manifest reports are compared by the harness with distinct reasons', () => {
  const prepared = findingState().prepared;
  const verifierMismatch = reduceCandidateVerification({
    events: successEvents(prepared, { verifier_sha256: '0'.repeat(64) }),
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(verifierMismatch.failure_reasons, ['VERIFIER_IDENTITY_MISMATCH']);
  assert.notEqual(verifierMismatch.result, null);

  const manifestMismatch = reduceCandidateVerification({
    events: successEvents(prepared, { command_manifest_sha256: '1'.repeat(64) }),
    turnStatus: 'done',
    prepared,
    cleanup: { attempted_ids: [sandboxId], confirmed_absent_ids: [sandboxId], unconfirmed_ids: [] },
  });
  assert.deepEqual(manifestMismatch.failure_reasons, ['MANIFEST_IDENTITY_MISMATCH']);
  assert.notEqual(manifestMismatch.result, null);
});

test('T26-R pre-submit assertion, evidence, and field names preserve the outbound-byte claim limit', () => {
  const prepared = findingState().prepared;
  const inspection = inspectPreparedTransport(prepared);
  assert.deepEqual(inspection.failure_reasons, []);
  assert.deepEqual(
    inspection.outbound_artifacts.map(artifact => artifact.role),
    ['manifest', 'payload', 'verifier'],
  );
  const forbidden = /\bpersisted\b|\bserver\b|upload identity|\bsandbox_path\b|end-to-end|both ends/i;
  assert.doesNotMatch(JSON.stringify({ outbound_artifacts: inspection.outbound_artifacts }), forbidden);
  for (const artifact of inspection.outbound_artifacts) {
    assert.equal(Object.hasOwn(artifact, 'intended_sandbox_path'), true);
    assert.equal(Object.hasOwn(artifact, 'sandbox_path'), false);
  }

  const tampered = tamperArtifactData(prepared, 'manifest');
  let message = '';
  try {
    assertPreparedTransport(tampered);
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /OUTBOUND_ARTIFACT_HASH_MISMATCH/);
  assert.doesNotMatch(message, forbidden);
});

test('J14 non-Daytona configuration blocks before the relay session', async () => {
  const prepared = findingState().prepared;
  let sessions = 0;
  const evidence = await runCandidateVerification({
    prepared,
    client: {
      async assertDaytonaSandboxProvider() {
        throw new Error('not Daytona');
      },
      async createRelaySession() { sessions += 1; return 'session-should-not-exist'; },
    },
  });
  assert.deepEqual(evidence.failure_reasons, ['PROVIDER_CONFIGURATION_REJECTED']);
  assert.equal(sessions, 0);
  assert.equal(evidence.session_id, '');
});

test('J14b stock provider settings shape admits Daytona and rejects every other type', async () => {
  const client = new JudgmentTrueForgeClient();
  const requests = [];
  client.request = async (method, path) => {
    requests.push({ method, path });
    return { data: { manifest: { type: 'daytona' } } };
  };
  await client.assertDaytonaSandboxProvider();
  assert.deepEqual(requests, [{ method: 'GET', path: '/api/v1/settings/sandbox-providers' }]);

  client.request = async () => ({ data: { manifest: { type: 'local' } } });
  await assert.rejects(
    client.assertDaytonaSandboxProvider(),
    error => error?.code === 'PROVIDER_CONFIGURATION_REJECTED' && error?.status === 422,
  );
});

test('J15 fixed verifier reports actual identities and rejects changed bytes offline', () => {
  const prepared = findingState().prepared;
  const root = mkdtempSync(join(tmpdir(), 'judgment-verifier-'));
  const paths = Object.fromEntries(prepared.outboundArtifacts.map(artifact => [artifact.role, join(root, artifact.name)]));
  const verifierBytes = outboundArtifactBytes(prepared, 'verifier');
  const payloadBytes = outboundArtifactBytes(prepared, 'payload');
  writeFileSync(paths.verifier, verifierBytes);
  writeFileSync(paths.payload, payloadBytes);
  const manifest = JSON.parse(outboundArtifactBytes(prepared, 'manifest').toString('utf8'));
  manifest.transport.verifier_path = paths.verifier;
  manifest.transport.payload_path = paths.payload;
  manifest.transport.manifest_path = paths.manifest;
  const manifestBytes = canonicalJsonBytes(manifest);
  writeFileSync(paths.manifest, manifestBytes);

  const child = spawnSync(process.execPath, [paths.verifier, paths.payload, paths.manifest], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  assert.equal(result.verifier_sha256, prepared.verifierSha256);
  assert.equal(result.payload_bundle_sha256, prepared.candidateBundleSha256);
  assert.equal(result.command_manifest_sha256, sha256(manifestBytes));

  const changedPayload = JSON.parse(payloadBytes.toString('utf8'));
  changedPayload.files[0].data_base64 = Buffer.from('changed candidate bytes').toString('base64');
  writeFileSync(paths.payload, canonicalJsonBytes(changedPayload));
  const payloadMismatch = spawnSync(process.execPath, [paths.verifier, paths.payload, paths.manifest], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(payloadMismatch.status, 0);
  assert.match(payloadMismatch.stderr, /PAYLOAD_IDENTITY_MISMATCH/);

  writeFileSync(paths.payload, payloadBytes);
  writeFileSync(paths.verifier, Buffer.concat([verifierBytes, Buffer.from('\n')]));
  const verifierMismatch = spawnSync(process.execPath, [paths.verifier, paths.payload, paths.manifest], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(verifierMismatch.status, 0);
  assert.match(verifierMismatch.stderr, /VERIFIER_IDENTITY_MISMATCH/);
});
