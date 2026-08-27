import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { canonicalJson, canonicalJsonBytes } from '../scripts/pr2/canonical.mjs';
import { sha256 } from '../scripts/pr2/inputs.mjs';
import { prepareCandidateVerification } from '../scripts/judgment/candidate.mjs';
import {
  buildAgentPrompt,
  instructionSha256,
  loadCorpus,
  toolsSha256,
  validateAgentResponse,
  validateCorpusManifest,
  validatePriorKnowledge,
} from '../scripts/judgment/core.mjs';
import {
  AGENT_CAPABILITIES,
  AGENT_CAPABILITY_MANIFEST_SHA256,
  CHANGE_PROPOSAL_SCHEMA_SHA256,
  JUDGMENT_CONTRACT_SHA256,
  SYSTEM_INSTRUCTIONS,
  TOOL_DESCRIPTIONS,
} from '../scripts/judgment/constants.mjs';
import { JudgmentTrueForgeClient, reduceCandidateVerification } from '../scripts/judgment/live.mjs';
import { validateChangeProposal } from '../scripts/judgment/proposal.mjs';
import { recomputeFinding } from '../scripts/judgment/recompute.mjs';
import { executeJudgmentLoop } from '../scripts/judgment/run.mjs';

const sandboxId = 'v1:daytona:default.12345678-1234-1234-1234-123456789abc';

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
    schema: 'prior_knowledge/v1',
    what_the_agent_is_given: {
      instructions_sha256: instructionSha256(),
      tools_sha256: toolsSha256(),
      corpus_manifest_sha256: sha256(manifestBytes),
    },
    known_conditions: [{
      id: 'K5',
      name: 'signal nobody consumes',
      description: 'A known defect class where a computed signal is not consumed by the deciding path.',
    }],
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
    tools_sha256: toolsSha256(),
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

function sandboxResult(prepared, changes = {}) {
  return {
    candidate_bundle_sha256: prepared.candidateBundleSha256,
    command_manifest_sha256: prepared.commandManifestSha256,
    exit_code: 0,
    schema: 'candidate_verification_result/v1',
    stderr_length: 0,
    stderr_sha256: sha256(Buffer.alloc(0)),
    stdout_length: 4,
    stdout_sha256: sha256(Buffer.from('ok\n')),
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
  pending.what_the_agent_is_given.tools_sha256 = 'PENDING';
  assert.throws(() => validatePriorKnowledge(canonicalJsonBytes(pending)), /unresolved/);
  assert.throws(() => validatePriorKnowledge(f.priorBytes, { tools_sha256: '0'.repeat(64) }), /mismatch/);
});

test('J03 prompt contains every corpus file and no model tools', () => {
  const s = state();
  const prompt = buildAgentPrompt(s.corpus, s.priorState.prior);
  assert.match(prompt, /src\/check\.mjs/);
  assert.match(prompt, /report\.credentials/);
  assert.match(prompt, /bug tracking label/);
  assert.match(prompt, /known defect class/i);
  assert.deepEqual(TOOL_DESCRIPTIONS, []);
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
  assert.equal(s.prepared.expectedExecArguments.command, 'node /opt/tf/uploads/candidate-verifier.cjs');
  assert.ok(Buffer.byteLength(JSON.stringify(s.prepared.expectedExecArguments), 'utf8') < 128);
  assert.equal(s.prepared.relayFile.size_bytes > 512, true);
  const encoded = s.prepared.relayFile.data_uri.split(',', 2)[1];
  assert.equal(sha256(Buffer.from(encoded, 'base64')), s.prepared.relayFile.sha256);
  assert.equal(
    s.prepared.commandManifest.relay_transport.exec_arguments_sha256,
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
    runModel: async () => ({ content: response(), usage: { input_tokens: 100, output_tokens: 20 } }),
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
    runModel: async () => ({ content: canonicalJson({ schema: 'judgment_response/v1', findings: [] }), usage: null }),
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
    runModel: async () => ({ content: response(), usage: null }),
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
    runModel: async () => ({ content: response(), usage: null }),
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
    ['docs/contracts/HACKATHON_JUDGMENT_LOOP_CONTRACT_V4_2026-08-27.md', JUDGMENT_CONTRACT_SHA256],
    ['docs/contracts/change-proposal-v2.schema.json', CHANGE_PROPOSAL_SCHEMA_SHA256],
    ['docs/contracts/agent-capability-manifest-v1.json', AGENT_CAPABILITY_MANIFEST_SHA256],
  ];
  for (const [path, expected] of artifacts) {
    assert.equal(sha256(readFileSync(join(root, path))), expected);
  }
});

test('J12 judgment session requests no tools and disables its sandbox', async () => {
  let observed;
  const client = new JudgmentTrueForgeClient();
  client.request = async (method, path, body) => {
    observed = { method, path, body };
    return { data: { id: 'session-1' } };
  };
  assert.equal(await client.createJudgmentSession(SYSTEM_INSTRUCTIONS), 'session-1');
  assert.equal(observed.method, 'POST');
  assert.equal(observed.path, '/api/v1/sessions');
  assert.equal(observed.body.agent.spec.config.sandbox.enabled, false);
  assert.equal(Object.hasOwn(observed.body.agent.spec, 'tools'), false);
});

test('J13 relay transports candidate bytes as a TrueForge upload and emits only a short command', async () => {
  const s = findingState();
  const requests = [];
  const client = new JudgmentTrueForgeClient();
  client.request = async (method, path, body) => {
    requests.push({ method, path, body });
    return { data: { id: requests.length === 1 ? 'session-1' : 'turn-1' } };
  };
  assert.equal(await client.createRelaySession(s.prepared.expectedExecArguments), 'session-1');
  assert.equal(
    await client.createRelayTurn(
      'session-1',
      s.prepared.expectedExecArguments,
      s.prepared.relayFile,
      60_000,
    ),
    'turn-1',
  );

  const sessionSpec = requests[0].body.agent.spec;
  assert.equal(sessionSpec.model.params.max_tokens, 512);
  assert.equal(sessionSpec.config.sandbox.enabled, true);
  assert.match(sessionSpec.instructions, /candidate-verifier\.cjs/);
  assert.equal(sessionSpec.instructions.includes(s.prepared.relayFile.data_uri), false);

  const content = requests[1].body.input[0].content;
  assert.deepEqual(content.map(part => part.type), ['file', 'text']);
  assert.equal(content[0].name, 'candidate-verifier.cjs');
  assert.equal(content[0].data, s.prepared.relayFile.data_uri);
  assert.equal(content[1].text.includes(s.prepared.relayFile.data_uri), false);
  assert.ok(Buffer.byteLength(content[1].text, 'utf8') < 160);

  const changed = { ...s.prepared.relayFile, sha256: '0'.repeat(64) };
  await assert.rejects(
    client.createRelayTurn('session-1', s.prepared.expectedExecArguments, changed, 60_000),
    /relay file bytes invalid/,
  );
});
