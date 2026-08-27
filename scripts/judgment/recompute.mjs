import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJsonBytes, parseStrictJson } from '../pr2/canonical.mjs';
import { assertSafePath, sha256 } from '../pr2/inputs.mjs';
import { loadCorpus } from './core.mjs';

function value(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? fallback : argv[index + 1];
}

export function recomputeFinding({ corpusRoot, manifestBytes, priorBytes, artifactBytes, findingId }) {
  const corpus = loadCorpus({ corpusRoot, manifestBytes });
  const artifact = parseStrictJson(artifactBytes.toString('utf8'));
  const finding = artifact?.findings?.find(item => item.finding_id === findingId);
  if (!finding) throw new TypeError('finding absent');
  const file = corpus.files.find(item => item.path === finding.observed.file);
  if (!file) throw new TypeError('observed file absent');
  const needle = finding.observed.exact_bytes;
  const first = file.text.indexOf(needle);
  const second = first < 0 ? -1 : file.text.indexOf(needle, first + Math.max(1, needle.length));
  const line = first < 0 ? 0 : file.text.slice(0, first).split('\n').length;
  const evidence = finding.evidence?.[0];
  let knownMatchEstablished = true;
  const knownEvidence = finding.evidence?.find(item => item?.kind === 'PRIOR_KNOWLEDGE_MATCH');
  if (knownEvidence) {
    if (!priorBytes) {
      knownMatchEstablished = false;
    } else {
      const prior = parseStrictJson(priorBytes.toString('utf8'));
      knownMatchEstablished = sha256(priorBytes) === artifact.prior_knowledge_sha256 &&
        knownEvidence.prior_knowledge_sha256 === artifact.prior_knowledge_sha256 &&
        prior.known_conditions?.some(condition => condition.id === knownEvidence.known_condition_id) === true;
    }
  }
  const established = first >= 0 && second < 0 && line === finding.observed.line &&
    evidence?.occurrence_count === 1 && evidence?.file_sha256 === sha256(file.bytes) &&
    evidence?.exact_bytes_sha256 === sha256(Buffer.from(needle, 'utf8')) &&
    artifact.corpus_manifest_sha256 === corpus.manifestSha256 && knownMatchEstablished;
  return {
    schema: 'finding_recomputation/v1',
    finding_id: findingId,
    observed_line: line,
    occurrence_count: first < 0 ? 0 : second < 0 ? 1 : 2,
    status: established ? 'RECOMPUTED' : 'NOT_ESTABLISHED',
  };
}

if (process.argv[1]?.endsWith('/recompute.mjs')) {
  const argv = process.argv.slice(2);
  const run = value(argv, 'run');
  if (!run) throw new TypeError('--run is required');
  assertSafePath(run, 'run path');
  const result = recomputeFinding({
    corpusRoot: join(run, 'corpus'),
    manifestBytes: readFileSync(join(run, 'corpus_manifest.json')),
    priorBytes: readFileSync(join(run, 'PRIOR_KNOWLEDGE.json')),
    artifactBytes: readFileSync(join(run, 'judgment_run_artifact.json')),
    findingId: value(argv, 'finding'),
  });
  process.stdout.write(canonicalJsonBytes(result));
  process.exitCode = result.status === 'RECOMPUTED' ? 0 : 1;
}
