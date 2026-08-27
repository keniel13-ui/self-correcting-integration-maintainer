import { canonicalJsonBytes, assertClosedObject } from '../pr2/canonical.mjs';
import { sha256 } from '../pr2/inputs.mjs';
import { CHANGE_PROPOSAL_SCHEMA_SHA256 } from './constants.mjs';

const PROPOSAL_KEYS = [
  'schema', 'proposal_id', 'finding_id', 'corpus_manifest_sha256', 'target',
  'change', 'verification', 'authority', 'not_established',
];

export function createChangeProposal({ corpus, finding, prepared, executionEvidence }) {
  if (executionEvidence.status !== 'VERIFIED_IN_DAYTONA' || executionEvidence.result.exit_code !== 0) {
    throw new TypeError('sandbox verification did not establish the proposal');
  }
  const proposal = {
    schema: 'change_proposal/v2',
    proposal_id: finding.proposed_action,
    finding_id: finding.finding_id,
    corpus_manifest_sha256: corpus.manifestSha256,
    target: {
      path: prepared.target.path,
      original_sha256: prepared.target.original_sha256,
    },
    change: {
      operation: 'REPLACE_EXACT_BYTES',
      before_exact: finding.repair.before_exact,
      after_exact: finding.repair.after_exact,
      resulting_file_sha256: prepared.target.resulting_file_sha256,
    },
    verification: {
      status: 'VERIFIED_IN_DAYTONA',
      execution_evidence_sha256: sha256(canonicalJsonBytes(executionEvidence)),
      command_manifest_sha256: prepared.commandManifestSha256,
      exit_code: 0,
      candidate_stdout_sha256: executionEvidence.result.stdout_sha256,
    },
    authority: {
      state: 'AWAITING_HUMAN_APPROVAL',
      approval_required: true,
      apply_capability_exposed_to_agent: false,
      applied: false,
    },
    not_established: [...new Set([
      ...finding.not_established,
      'human approval has not been granted',
      'the candidate has not been applied to the target repository',
    ])],
  };
  validateChangeProposal(proposal);
  return proposal;
}

export function validateChangeProposal(proposal) {
  assertClosedObject(proposal, PROPOSAL_KEYS, 'change proposal');
  if (proposal.schema !== 'change_proposal/v2' || !/^CP-[A-Z0-9][A-Z0-9_-]{2,63}$/.test(proposal.proposal_id) ||
      typeof proposal.finding_id !== 'string' || !/^[0-9a-f]{64}$/.test(proposal.corpus_manifest_sha256)) {
    throw new TypeError('proposal identity invalid');
  }
  assertClosedObject(proposal.target, ['path', 'original_sha256'], 'proposal target');
  assertClosedObject(
    proposal.change,
    ['operation', 'before_exact', 'after_exact', 'resulting_file_sha256'],
    'proposal change',
  );
  assertClosedObject(
    proposal.verification,
    ['status', 'execution_evidence_sha256', 'command_manifest_sha256', 'exit_code', 'candidate_stdout_sha256'],
    'proposal verification',
  );
  assertClosedObject(
    proposal.authority,
    ['state', 'approval_required', 'apply_capability_exposed_to_agent', 'applied'],
    'proposal authority',
  );
  const hashes = [
    proposal.target.original_sha256,
    proposal.change.resulting_file_sha256,
    proposal.verification.execution_evidence_sha256,
    proposal.verification.command_manifest_sha256,
    proposal.verification.candidate_stdout_sha256,
  ];
  if (proposal.change.operation !== 'REPLACE_EXACT_BYTES' ||
      typeof proposal.change.before_exact !== 'string' || proposal.change.before_exact.length === 0 ||
      typeof proposal.change.after_exact !== 'string' || hashes.some(hash => !/^[0-9a-f]{64}$/.test(hash)) ||
      proposal.verification.status !== 'VERIFIED_IN_DAYTONA' || proposal.verification.exit_code !== 0 ||
      proposal.authority.state !== 'AWAITING_HUMAN_APPROVAL' ||
      proposal.authority.approval_required !== true ||
      proposal.authority.apply_capability_exposed_to_agent !== false || proposal.authority.applied !== false ||
      !Array.isArray(proposal.not_established) || proposal.not_established.length === 0) {
    throw new TypeError('proposal invariant invalid');
  }
  return proposal;
}

export const changeProposalSchemaSha256 = CHANGE_PROPOSAL_SCHEMA_SHA256;
