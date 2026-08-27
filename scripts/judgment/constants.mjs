export const JUDGMENT_CONTRACT_SHA256 =
  '2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3';
export const CHANGE_PROPOSAL_SCHEMA_SHA256 =
  '5fd077e8c615c586d6e24db7eb7760ffb147516772108734df6f352560df84b0';
export const AGENT_CAPABILITY_MANIFEST_SHA256 =
  '1306e3d7204d73f600b1655b40b821a03ee62cbd0097d2ea58ead5a29334bd72';

export const MAX_FILES = 32;
// Candidate bytes are carried twice through the stock exec relay (file base64, then program
// base64). This ceiling keeps the final printable exec command below PR #3's 65,535-byte bound.
export const MAX_FILE_BYTES = 30_000;
export const MAX_CORPUS_BYTES = 30_000;
export const MAX_MODEL_TURN_MS = 60_000;
export const MAX_SANDBOX_TURN_MS = 60_000;

export const SYSTEM_INSTRUCTIONS = `You inspect an unfamiliar code corpus for consequential conditions.
You are not told what condition to find. Return exactly one JSON object and no markdown.
For every finding, quote exact bytes from one supplied file. Never provide a line number; the
harness computes it. State a concrete consequence, the evidence you inspected, an honest novelty
class, a prose confidence basis, at least one limit, and at most one bounded exact-byte repair.
You have no tools and no authority to modify any repository. A proposal is not approval.`;

export const TOOL_DESCRIPTIONS = Object.freeze([]);

export const AGENT_CAPABILITIES = Object.freeze({
  allowed: Object.freeze(['receive_corpus_bytes', 'return_json']),
  denied: Object.freeze([
    'apply_change',
    'commit',
    'filesystem_write',
    'git_push',
    'mint_approval',
    'network',
    'read_approval_token',
    'spawn_subagent',
  ]),
});
