import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertClosedObject,
  canonicalJsonBytes,
  compareUtf8,
  parseStrictJson,
} from '../pr2/canonical.mjs';
import { assertSafePath, sha256 } from '../pr2/inputs.mjs';
import {
  MAX_CORPUS_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_REPLACEMENT_BYTES,
  PROMPT_FRAME,
  SYSTEM_INSTRUCTIONS,
  TOOL_DESCRIPTIONS,
} from './constants.mjs';

const HEX = /^[0-9a-f]{64}$/;
const CORPUS_KEYS = ['schema', 'corpus_id', 'files', 'verification'];
const CORPUS_FILE_KEYS = ['path', 'sha256', 'size_bytes'];
const VERIFICATION_KEYS = ['argv', 'timeout_ms'];
const RESPONSE_KEYS = ['schema', 'findings'];
const RAW_FINDING_KEYS = [
  'condition', 'path', 'exact_bytes', 'why_it_matters', 'evidence', 'novelty',
  'known_condition_id', 'confidence_basis', 'not_established', 'repair',
];
const REPAIR_KEYS = ['before_exact', 'after_exact'];

function nonempty(value, label, maximum = 16_384) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > maximum) {
    throw new TypeError(`${label} must be a bounded nonempty string`);
  }
  return value;
}

function stringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
      value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a' : 'a nonempty'} string array`);
  }
  return value;
}

export function validateCorpusManifest(manifest) {
  assertClosedObject(manifest, CORPUS_KEYS, 'corpus manifest');
  if (manifest.schema !== 'judgment_corpus/v1') throw new TypeError('corpus schema mismatch');
  nonempty(manifest.corpus_id, 'corpus_id', 128);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > MAX_FILES) {
    throw new TypeError('corpus files length invalid');
  }
  let total = 0;
  const paths = [];
  for (const file of manifest.files) {
    assertClosedObject(file, CORPUS_FILE_KEYS, 'corpus file');
    assertSafePath(file.path, 'corpus path');
    if (!HEX.test(file.sha256)) throw new TypeError('corpus file hash invalid');
    if (!Number.isSafeInteger(file.size_bytes) || file.size_bytes < 1 || file.size_bytes > MAX_FILE_BYTES) {
      throw new TypeError('corpus file size invalid');
    }
    total += file.size_bytes;
    paths.push(file.path);
  }
  if (total > MAX_CORPUS_BYTES) throw new TypeError('corpus byte ceiling exceeded');
  if (new Set(paths).size !== paths.length) throw new TypeError('duplicate corpus path');
  const sorted = [...paths].sort(compareUtf8);
  if (paths.some((path, index) => path !== sorted[index])) throw new TypeError('corpus paths not sorted');
  assertClosedObject(manifest.verification, VERIFICATION_KEYS, 'corpus verification');
  stringList(manifest.verification.argv, 'verification argv');
  if (manifest.verification.argv.length > 16 || manifest.verification.argv.some(arg => Buffer.byteLength(arg) > 1024)) {
    throw new TypeError('verification argv exceeds bounds');
  }
  if (!Number.isSafeInteger(manifest.verification.timeout_ms) ||
      manifest.verification.timeout_ms < 1 || manifest.verification.timeout_ms > 60_000) {
    throw new TypeError('verification timeout invalid');
  }
  return manifest;
}

export function loadCorpus({ corpusRoot, manifestBytes }) {
  const manifest = validateCorpusManifest(parseStrictJson(manifestBytes.toString('utf8')));
  if (!canonicalJsonBytes(manifest).equals(manifestBytes)) throw new TypeError('corpus manifest not canonical');
  const files = manifest.files.map(entry => {
    const bytes = readFileSync(join(corpusRoot, entry.path));
    if (bytes.length !== entry.size_bytes || sha256(bytes) !== entry.sha256) {
      throw new TypeError(`corpus file mismatch: ${entry.path}`);
    }
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError(`corpus file is not UTF-8: ${entry.path}`);
    return { ...entry, bytes, text };
  });
  return { manifest, manifestSha256: sha256(manifestBytes), files };
}

export function validatePriorKnowledge(bytes, expected = {}) {
  const prior = parseStrictJson(bytes.toString('utf8'));
  if (prior?.schema !== 'prior_knowledge/v1' || !Array.isArray(prior.known_conditions)) {
    throw new TypeError('prior knowledge schema invalid');
  }
  const given = prior.what_the_agent_is_given;
  if (!given || typeof given !== 'object') throw new TypeError('prior knowledge inputs absent');
  for (const field of ['instructions_sha256', 'tools_sha256', 'corpus_manifest_sha256']) {
    if (!HEX.test(given[field] ?? '')) throw new TypeError(`prior knowledge ${field} unresolved`);
    if (expected[field] && given[field] !== expected[field]) throw new TypeError(`${field} mismatch`);
  }
  const ids = new Set();
  for (const condition of prior.known_conditions) {
    if (!condition || typeof condition !== 'object') throw new TypeError('known condition invalid');
    nonempty(condition.id, 'known condition id', 64);
    nonempty(condition.name, 'known condition name', 256);
    nonempty(condition.description, 'known condition description');
    if (ids.has(condition.id)) throw new TypeError('duplicate known condition id');
    ids.add(condition.id);
  }
  return { prior, priorSha256: sha256(bytes), knownIds: ids };
}

export function instructionSha256() {
  return sha256(canonicalJsonBytes({
    system: SYSTEM_INSTRUCTIONS,
    user_prompt_frame: PROMPT_FRAME,
  }));
}

export function toolsSha256() {
  return sha256(canonicalJsonBytes(TOOL_DESCRIPTIONS));
}

export function buildAgentPrompt(corpus, prior) {
  const known = prior.known_conditions.map(({ id, name, description }) => ({ id, name, description }));
  const files = corpus.files.map(({ path, text, sha256: digest }) => ({ path, sha256: digest, bytes: text }));
  const frame = PROMPT_FRAME;
  // The contract bars the harness from pointing at an answer with these words. Corpus bytes and
  // frozen prior-knowledge descriptions are evidence, not harness-authored framing, and may
  // legitimately contain them.
  if (/\b(?:bug|defect|vulnerability)s?\b/i.test(frame.join('\n'))) {
    throw new TypeError('harness framing contains a withheld answer word');
  }
  return [
    ...frame,
    `Known conditions: ${JSON.stringify(known)}`,
    `Corpus manifest SHA-256: ${corpus.manifestSha256}`,
    `Corpus files: ${JSON.stringify(files)}`,
  ].join('\n');
}

function occurrenceOffsets(haystack, needle) {
  const offsets = [];
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    offsets.push(index);
    from = index + Math.max(1, needle.length);
  }
  return offsets;
}

function observedLine(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

export function validateAgentResponse(text, { corpus, priorSha256, knownIds, recomputeRunPath }) {
  assertSafePath(recomputeRunPath, 'recompute run path');
  if (!/^[A-Za-z0-9._/-]+$/.test(recomputeRunPath)) {
    throw new TypeError('recompute run path is not shell-safe');
  }
  const response = parseStrictJson(text);
  assertClosedObject(response, RESPONSE_KEYS, 'judgment response');
  if (response.schema !== 'judgment_response/v1' || !Array.isArray(response.findings)) {
    throw new TypeError('judgment response invalid');
  }
  if (response.findings.length > 8) throw new TypeError('too many findings');
  const findings = response.findings.map((raw, index) => {
    assertClosedObject(raw, RAW_FINDING_KEYS, `raw finding ${index}`);
    nonempty(raw.condition, 'condition');
    assertSafePath(raw.path, 'finding path');
    nonempty(raw.exact_bytes, 'exact_bytes', MAX_FILE_BYTES);
    nonempty(raw.why_it_matters, 'why_it_matters');
    stringList(raw.evidence, 'evidence');
    if (!['NEW', 'CONFIRMS_KNOWN', 'CHANGES_KNOWN'].includes(raw.novelty)) {
      throw new TypeError('novelty invalid');
    }
    const known = raw.known_condition_id;
    if (raw.novelty === 'NEW') {
      if (known !== null) throw new TypeError('NEW finding must not cite a known condition');
    } else if (typeof known !== 'string' || !knownIds.has(known)) {
      throw new TypeError('known finding must cite a frozen condition');
    }
    nonempty(raw.confidence_basis, 'confidence_basis');
    if (/^\s*[0-9]+(?:\.[0-9]+)?%?\s*$/.test(raw.confidence_basis)) {
      throw new TypeError('confidence_basis cannot be a bare number');
    }
    stringList(raw.not_established, 'not_established');
    const file = corpus.files.find(item => item.path === raw.path);
    if (!file) throw new TypeError('finding path not in corpus');
    const offsets = occurrenceOffsets(file.text, raw.exact_bytes);
    if (offsets.length !== 1) throw new TypeError('exact bytes must occur exactly once');
    let repair = null;
    if (raw.repair !== null) {
      assertClosedObject(raw.repair, REPAIR_KEYS, 'repair');
      if (raw.repair.before_exact !== raw.exact_bytes) throw new TypeError('repair before bytes mismatch');
      if (typeof raw.repair.after_exact !== 'string' || raw.repair.after_exact === raw.repair.before_exact) {
        throw new TypeError('repair after bytes invalid');
      }
      const afterBytes = Buffer.byteLength(raw.repair.after_exact, 'utf8');
      const resultingFileBytes = file.bytes.length - Buffer.byteLength(raw.repair.before_exact, 'utf8') + afterBytes;
      const corpusBytes = corpus.files.reduce((total, item) => total + item.bytes.length, 0) -
        file.bytes.length + resultingFileBytes;
      if (afterBytes > MAX_REPLACEMENT_BYTES || resultingFileBytes > MAX_FILE_BYTES || corpusBytes > MAX_CORPUS_BYTES) {
        throw new TypeError('repair replacement exceeds byte bounds');
      }
      repair = structuredClone(raw.repair);
    }
    const findingId = `F-${String(index + 1).padStart(3, '0')}`;
    return {
      finding_id: findingId,
      observed: {
        file: raw.path,
        line: observedLine(file.text, offsets[0]),
        exact_bytes: raw.exact_bytes,
      },
      why_it_matters: raw.why_it_matters,
      evidence: [{
        kind: 'EXACT_BYTES_PRESENT_ONCE',
        path: raw.path,
        file_sha256: file.sha256,
        exact_bytes_sha256: sha256(Buffer.from(raw.exact_bytes, 'utf8')),
        occurrence_count: 1,
      }, ...(known === null ? [] : [{
        kind: 'PRIOR_KNOWLEDGE_MATCH',
        known_condition_id: known,
        prior_knowledge_sha256: priorSha256,
      }])],
      recompute_command:
        `node scripts/judgment/recompute.mjs --run ${recomputeRunPath} --finding ${findingId}`,
      novelty: raw.novelty,
      prior_knowledge_sha: priorSha256,
      confidence_basis: raw.confidence_basis,
      not_established: [...raw.not_established],
      proposed_action: repair ? `CP-${String(index + 1).padStart(3, '0')}` : 'NONE',
      repair,
    };
  });
  return findings;
}

export function coverageFromCorpus(corpus) {
  return {
    producer: 'HARNESS_PROMPT_ASSEMBLER',
    presented_files: corpus.files.map(file => file.path),
    scanned_item_count: corpus.files.length,
    agent_claim_used: false,
  };
}
