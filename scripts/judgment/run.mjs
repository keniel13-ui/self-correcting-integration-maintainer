import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJsonBytes } from '../pr2/canonical.mjs';
import { sha256 } from '../pr2/inputs.mjs';
import {
  AGENT_CAPABILITIES,
  AGENT_CAPABILITY_MANIFEST_SHA256,
  JUDGMENT_CONTRACT_SHA256,
  SYSTEM_INSTRUCTIONS,
} from './constants.mjs';
import {
  buildAgentPrompt,
  coverageFromCorpus,
  instructionSha256,
  loadCorpus,
  toolsSha256,
  validateAgentResponse,
  validatePriorKnowledge,
} from './core.mjs';
import { prepareCandidateVerification } from './candidate.mjs';
import { runCandidateVerification, runJudgmentModel } from './live.mjs';
import { createChangeProposal } from './proposal.mjs';

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = dirname(dirname(dirname(thisFile)));
const RECOMPUTE_SOURCE_PATHS = Object.freeze([
  'scripts/judgment/recompute.mjs',
  'scripts/judgment/core.mjs',
  'scripts/judgment/constants.mjs',
  'scripts/pr2/canonical.mjs',
  'scripts/pr2/inputs.mjs',
  'scripts/pr2/constants.mjs',
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new TypeError('arguments must be --key value pairs');
    options[key.slice(2)] = value;
  }
  for (const required of ['corpus', 'manifest', 'prior']) {
    if (!options[required]) throw new TypeError(`--${required} is required`);
  }
  return options;
}

function newRunId() {
  return `judgment-${randomBytes(16).toString('hex')}`;
}

export async function executeJudgmentLoop({
  corpusRoot,
  manifestBytes,
  priorBytes,
  runsRoot = join(projectRoot, 'docs/demo/runs'),
  runModel = runJudgmentModel,
  verifyCandidate = runCandidateVerification,
  now = () => new Date().toISOString(),
  runId = newRunId(),
}) {
  if (!/^judgment-[0-9a-f]{32}$/.test(runId)) throw new TypeError('runId invalid');
  const runDir = resolve(runsRoot, runId);
  const corpus = loadCorpus({ corpusRoot, manifestBytes });
  const expectedHashes = {
    instructions_sha256: instructionSha256(),
    tools_sha256: toolsSha256(),
    corpus_manifest_sha256: corpus.manifestSha256,
  };
  const priorState = validatePriorKnowledge(priorBytes, expectedHashes);
  const prompt = buildAgentPrompt(corpus, priorState.prior);
  const model = await runModel({ prompt, instructions: SYSTEM_INSTRUCTIONS });
  const findings = validateAgentResponse(model.content, {
    corpus,
    priorSha256: priorState.priorSha256,
    knownIds: priorState.knownIds,
  });
  const coverage = coverageFromCorpus(corpus);
  if (findings.length === 0) {
    return {
      schema: 'judgment_outcome/v1',
      status: 'NO_FINDINGS',
      run_completed: true,
      findings_admissible: false,
      classification_correct: false,
      scanned_item_count: coverage.scanned_item_count,
      coverage,
      artifact_written: false,
    };
  }
  const actionable = findings.filter(finding => finding.repair !== null);
  if (actionable.length !== 1) throw new TypeError('exactly one bounded repair is required');
  const selected = actionable[0];
  const prepared = prepareCandidateVerification({ corpus, finding: selected });
  const verification = await verifyCandidate({ prepared });
  if (verification.status !== 'VERIFIED_IN_DAYTONA') {
    throw new TypeError(`candidate verification blocked: ${verification.failure_reasons.join(',')}`);
  }
  const proposal = createChangeProposal({ corpus, finding: selected, prepared, executionEvidence: verification });
  const proposalBytes = canonicalJsonBytes(proposal);
  const verificationBytes = canonicalJsonBytes(verification);
  const rawModelBytes = Buffer.from(model.content, 'utf8');
  const artifact = {
    schema: 'judgment_run_artifact/v1',
    run_id: runId,
    observed_at_utc: now(),
    judgment_contract_sha256: JUDGMENT_CONTRACT_SHA256,
    prior_knowledge_sha256: priorState.priorSha256,
    instructions_sha256: expectedHashes.instructions_sha256,
    tools_sha256: expectedHashes.tools_sha256,
    agent_capability_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
    corpus_manifest_sha256: corpus.manifestSha256,
    raw_model_output_sha256: sha256(rawModelBytes),
    candidate_verification_sha256: sha256(verificationBytes),
    change_proposal_sha256: sha256(proposalBytes),
    run_completed: true,
    findings_admissible: true,
    classification_correct: false,
    status: 'BREAKER_PENDING',
    coverage,
    findings: findings.map(({ repair, ...finding }) => finding),
    model_usage: model.usage === null || model.usage === undefined ? null : JSON.stringify(model.usage),
    authority: {
      agent_capabilities: AGENT_CAPABILITIES,
      proposal_state: 'AWAITING_HUMAN_APPROVAL',
      target_mutated: false,
    },
    not_established: [
      'the finding classification is correct until an independent breaker adjudicates it',
      'human approval has been granted',
      'the candidate has been applied to the target repository',
    ],
  };
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  for (const sourcePath of RECOMPUTE_SOURCE_PATHS) {
    const target = join(runDir, 'recompute', sourcePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(projectRoot, sourcePath)), { flag: 'wx' });
  }
  mkdirSync(join(runDir, 'corpus'), { recursive: false });
  for (const file of corpus.files) {
    const target = join(runDir, 'corpus', file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes, { flag: 'wx' });
  }
  writeFileSync(join(runDir, 'corpus_manifest.json'), manifestBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'PRIOR_KNOWLEDGE.json'), priorBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'raw_model_response.json'), rawModelBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'candidate_verification_evidence.json'), verificationBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'change_proposal.json'), proposalBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'judgment_run_artifact.json'), canonicalJsonBytes(artifact), { flag: 'wx' });
  return { ...artifact, run_dir: runDir };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(thisFile).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const outcome = await executeJudgmentLoop({
      corpusRoot: options.corpus,
      manifestBytes: readFileSync(options.manifest),
      priorBytes: readFileSync(options.prior),
      runsRoot: options.runs ?? join(projectRoot, 'docs/demo/runs'),
    });
    process.stdout.write(canonicalJsonBytes(outcome));
    process.exitCode = outcome.status === 'BREAKER_PENDING' || outcome.status === 'NO_FINDINGS' ? 0 : 1;
  } catch (error) {
    process.stdout.write(canonicalJsonBytes({
      schema: 'judgment_outcome/v1',
      status: 'SCAN_DID_NOT_COMPLETE',
      reason: error instanceof Error ? error.message : 'UNKNOWN_FAILURE',
      artifact_written: false,
    }));
    process.exitCode = 1;
  }
}
