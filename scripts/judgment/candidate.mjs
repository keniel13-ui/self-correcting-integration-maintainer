import { Buffer } from 'node:buffer';
import { canonicalJsonBytes, parseStrictJson } from '../pr2/canonical.mjs';
import { deriveBundle, sha256, validateExecArguments } from '../pr2/inputs.mjs';
import { CHANGE_PROPOSAL_SCHEMA_SHA256 } from './constants.mjs';

const RESULT_KEYS = [
  'schema', 'command_manifest_sha256', 'candidate_bundle_sha256', 'exit_code',
  'stdout_sha256', 'stdout_length', 'stderr_sha256', 'stderr_length',
];

const RELAY_FILE_NAME = 'candidate-verifier.cjs';
const RELAY_FILE_MIME = 'application/octet-stream';
const RELAY_SANDBOX_PATH = `/opt/tf/uploads/${RELAY_FILE_NAME}`;

export function applyExactRepair(corpus, finding) {
  if (!finding.repair) throw new TypeError('finding has no repair');
  const target = corpus.files.find(file => file.path === finding.observed.file);
  if (!target) throw new TypeError('repair target absent');
  const before = finding.repair.before_exact;
  const after = finding.repair.after_exact;
  const first = target.text.indexOf(before);
  if (first < 0 || target.text.indexOf(before, first + Math.max(1, before.length)) >= 0) {
    throw new TypeError('repair target is not unique');
  }
  const resultingText = `${target.text.slice(0, first)}${after}${target.text.slice(first + before.length)}`;
  const files = corpus.files.map(file => file.path === target.path
    ? { path: file.path, bytes: Buffer.from(resultingText, 'utf8') }
    : { path: file.path, bytes: Buffer.from(file.bytes) });
  return {
    files,
    target: {
      path: target.path,
      original_sha256: target.sha256,
      resulting_file_sha256: sha256(Buffer.from(resultingText, 'utf8')),
    },
  };
}

function sandboxProgram({ files, verification, candidateBundleSha256, commandManifestSha256 }) {
  const encodedFiles = Object.fromEntries(files.map(file => [file.path, file.bytes.toString('base64')]));
  return [
    "const {createHash}=require('node:crypto');",
    "const {mkdirSync,writeFileSync}=require('node:fs');",
    "const {dirname}=require('node:path');",
    "const {spawnSync}=require('node:child_process');",
    `const files=${JSON.stringify(encodedFiles)};`,
    `const argv=${JSON.stringify(verification.argv)};`,
    `const timeout=${JSON.stringify(verification.timeout_ms)};`,
    `const expectedBundle=${JSON.stringify(candidateBundleSha256)};`,
    `const commandManifest=${JSON.stringify(commandManifestSha256)};`,
    "const hash=b=>createHash('sha256').update(b).digest('hex');",
    "const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b};",
    "const order=Object.keys(files).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));",
    "const chunks=[Buffer.from('candidate-bundle/v1\\0')];",
    "for(const p of order){const pb=Buffer.from(p);const bytes=Buffer.from(files[p],'base64');mkdirSync(dirname(p),{recursive:true});writeFileSync(p,bytes,{flag:'wx'});chunks.push(u64(pb.length),pb,u64(bytes.length),bytes)}",
    "const bundle=hash(Buffer.concat(chunks));if(bundle!==expectedBundle)throw new Error('BUNDLE_MISMATCH');",
    "const child=spawnSync(argv[0],argv.slice(1),{encoding:null,maxBuffer:2097152,timeout,env:{PATH:process.env.PATH??''}});",
    "const stdout=child.stdout??Buffer.alloc(0);const stderr=child.stderr??Buffer.alloc(0);",
    "const result={candidate_bundle_sha256:bundle,command_manifest_sha256:commandManifest,exit_code:child.status??-1,schema:'candidate_verification_result/v1',stderr_length:stderr.length,stderr_sha256:hash(stderr),stdout_length:stdout.length,stdout_sha256:hash(stdout)};",
    "const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';",
    "process.stdout.write(canon(result)+'\\n');",
  ].join('');
}

export function prepareCandidateVerification({ corpus, finding }) {
  const repaired = applyExactRepair(corpus, finding);
  const files = repaired.files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const candidateBundleSha256 = deriveBundle(files);
  const expectedExecArguments = validateExecArguments({
    command: `node ${RELAY_SANDBOX_PATH}`,
  });
  const commandManifest = {
    schema: 'candidate_verification_command/v1',
    change_proposal_schema_sha256: CHANGE_PROPOSAL_SCHEMA_SHA256,
    corpus_manifest_sha256: corpus.manifestSha256,
    candidate_bundle_sha256: candidateBundleSha256,
    verification: corpus.manifest.verification,
    relay_transport: {
      type: 'trueforge_user_file/v1',
      file_name: RELAY_FILE_NAME,
      mime: RELAY_FILE_MIME,
      sandbox_path: RELAY_SANDBOX_PATH,
      exec_arguments_sha256: sha256(canonicalJsonBytes(expectedExecArguments)),
    },
    irreversible_actions_allowed: false,
  };
  const commandManifestSha256 = sha256(canonicalJsonBytes(commandManifest));
  const program = sandboxProgram({
    files,
    verification: corpus.manifest.verification,
    candidateBundleSha256,
    commandManifestSha256,
  });
  const programBytes = Buffer.from(program, 'utf8');
  const relayFile = {
    name: RELAY_FILE_NAME,
    mime: RELAY_FILE_MIME,
    sandbox_path: RELAY_SANDBOX_PATH,
    sha256: sha256(programBytes),
    size_bytes: programBytes.length,
    data_uri: `data:${RELAY_FILE_MIME};base64,${programBytes.toString('base64')}`,
  };
  return {
    ...repaired,
    candidateBundleSha256,
    commandManifest,
    commandManifestSha256,
    expectedExecArguments,
    relayFile,
  };
}

export function parseCandidateResult(text, expected) {
  const bytes = Buffer.from(text, 'utf8');
  const result = parseStrictJson(text);
  const actual = Object.keys(result ?? {}).sort();
  const wanted = [...RESULT_KEYS].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError('candidate result keys invalid');
  }
  if (!bytes.equals(canonicalJsonBytes(result)) || result.schema !== 'candidate_verification_result/v1' ||
      result.command_manifest_sha256 !== expected.commandManifestSha256 ||
      result.candidate_bundle_sha256 !== expected.candidateBundleSha256 ||
      !Number.isSafeInteger(result.exit_code) || !Number.isSafeInteger(result.stdout_length) ||
      !Number.isSafeInteger(result.stderr_length) ||
      !/^[0-9a-f]{64}$/.test(result.stdout_sha256) || !/^[0-9a-f]{64}$/.test(result.stderr_sha256)) {
    throw new TypeError('candidate result invalid');
  }
  return result;
}
