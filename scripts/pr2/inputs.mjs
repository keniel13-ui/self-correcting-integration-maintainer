import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import {
  BASE_COMMIT,
  BUNDLE_SHA256,
  CANDIDATE_ID,
  CONTRACT_SHA256,
  ENTRYPOINT,
  ENTRYPOINT_BYTES,
  ENTRYPOINT_SHA256,
  EXPECTED_CANDIDATE_RESULT_BYTES,
  EXPECTED_RESULT_SHA256,
  FIXTURE_BYTES,
  FIXTURE_PATH,
  FIXTURE_SHA256,
  MAXIMUM_TURN_MS,
} from './constants.mjs';
import {
  assertClosedObject,
  canonicalJsonBytes,
  compareUtf8,
  parseStrictJson,
} from './canonical.mjs';

const HEX = /^[0-9a-f]{64}$/;
const RUN_ID = /^pr2-[0-9a-f]{32}$/;
const CANDIDATE_ID_PATTERN = /^[a-z0-9._-]+$/;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function u64be(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

export function assertSafePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0 || value.normalize('NFC') !== value) {
    throw new TypeError(`${label} must be a nonempty NFC string`);
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    throw new TypeError(`${label} is not a safe relative POSIX path`);
  }
  const segments = value.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} contains an invalid segment`);
  }
  if (posix.normalize(value) !== value) throw new TypeError(`${label} is not normalized`);
  return value;
}

export function deriveBundle(files) {
  const chunks = [Buffer.from('candidate-bundle/v1\0', 'utf8')];
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    const content = Buffer.from(file.bytes);
    chunks.push(u64be(pathBytes.length), pathBytes, u64be(content.length), content);
  }
  return sha256(Buffer.concat(chunks));
}

const MANIFEST_KEYS = [
  'schema', 'contract_sha256', 'base_commit', 'run_id', 'candidate_id', 'entrypoint',
  'fixture_path', 'files', 'candidate_bundle_sha256', 'expected_candidate_result_sha256',
  'exec_arguments_sha256', 'maximum_turn_ms', 'network_required', 'credentials_required',
  'irreversible_actions_allowed',
];
const FILE_KEYS = ['path', 'size_bytes', 'sha256'];
const REQUEST_KEYS = [
  'schema', 'contract_sha256', 'base_commit', 'run_id', 'candidate_manifest_sha256',
  'candidate_bundle_sha256', 'expected_candidate_result_sha256', 'exec_arguments_sha256',
  'maximum_turn_ms',
];

export function validateManifest(manifest) {
  assertClosedObject(manifest, MANIFEST_KEYS, 'candidate manifest');
  if (manifest.schema !== 'candidate_execution_manifest/v1') throw new TypeError('manifest schema mismatch');
  if (manifest.contract_sha256 !== CONTRACT_SHA256 || !HEX.test(manifest.contract_sha256)) {
    throw new TypeError('manifest contract hash mismatch');
  }
  if (manifest.base_commit !== BASE_COMMIT) throw new TypeError('manifest base mismatch');
  if (!RUN_ID.test(manifest.run_id)) throw new TypeError('manifest run_id invalid');
  if (!CANDIDATE_ID_PATTERN.test(manifest.candidate_id) || Buffer.byteLength(manifest.candidate_id) > 80) {
    throw new TypeError('manifest candidate_id invalid');
  }
  assertSafePath(manifest.entrypoint, 'entrypoint');
  assertSafePath(manifest.fixture_path, 'fixture_path');
  if (!manifest.entrypoint.endsWith('.mjs') || !manifest.fixture_path.endsWith('.json')) {
    throw new TypeError('entrypoint or fixture extension invalid');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length < 2 || manifest.files.length > 32) {
    throw new TypeError('manifest files length invalid');
  }
  const paths = [];
  for (const file of manifest.files) {
    assertClosedObject(file, FILE_KEYS, 'manifest file');
    assertSafePath(file.path, 'file path');
    if (!Number.isSafeInteger(file.size_bytes) || file.size_bytes < 0 || file.size_bytes > 1_048_576) {
      throw new TypeError('file size invalid');
    }
    if (!HEX.test(file.sha256)) throw new TypeError('file hash invalid');
    paths.push(file.path);
  }
  if (new Set(paths).size !== paths.length) throw new TypeError('duplicate file path');
  const sorted = [...paths].sort(compareUtf8);
  if (paths.some((path, index) => path !== sorted[index])) throw new TypeError('file paths are not sorted');
  if (!paths.includes(manifest.entrypoint) || !paths.includes(manifest.fixture_path)) {
    throw new TypeError('entrypoint or fixture not listed');
  }
  for (const key of ['candidate_bundle_sha256', 'expected_candidate_result_sha256', 'exec_arguments_sha256']) {
    if (!HEX.test(manifest[key])) throw new TypeError(`${key} invalid`);
  }
  if (manifest.maximum_turn_ms !== MAXIMUM_TURN_MS || manifest.network_required !== false ||
      manifest.credentials_required !== false || manifest.irreversible_actions_allowed !== false) {
    throw new TypeError('manifest constants invalid');
  }
  return manifest;
}

export function validateExecArguments(value) {
  assertClosedObject(value, ['command'], 'exec arguments');
  if (typeof value.command !== 'string' || Buffer.byteLength(value.command, 'ascii') < 1 ||
      Buffer.byteLength(value.command, 'ascii') > 65_535 || /[^\x20-\x7e]/.test(value.command)) {
    throw new TypeError('exec command must be printable ASCII without line breaks');
  }
  return value;
}

export function validateExecutionRequest(value, manifestSha256, manifest) {
  assertClosedObject(value, REQUEST_KEYS, 'execution request');
  if (value.schema !== 'candidate_execution_request/v1' ||
      value.contract_sha256 !== CONTRACT_SHA256 || value.base_commit !== BASE_COMMIT ||
      value.run_id !== manifest.run_id || value.candidate_manifest_sha256 !== manifestSha256 ||
      value.candidate_bundle_sha256 !== manifest.candidate_bundle_sha256 ||
      value.expected_candidate_result_sha256 !== manifest.expected_candidate_result_sha256 ||
      value.exec_arguments_sha256 !== manifest.exec_arguments_sha256 ||
      value.maximum_turn_ms !== MAXIMUM_TURN_MS) {
    throw new TypeError('execution request mismatch');
  }
  return value;
}

export function encodeCandidateBytesAsData(files) {
  return Object.fromEntries(files.map(file => {
    assertSafePath(file.path, 'candidate data path');
    if (!Buffer.isBuffer(file.bytes)) throw new TypeError('candidate data must be bytes');
    return [file.path, file.bytes.toString('base64')];
  }));
}

function sandboxProgram(runId) {
  const files = encodeCandidateBytesAsData([
    { path: ENTRYPOINT, bytes: ENTRYPOINT_BYTES },
    { path: FIXTURE_PATH, bytes: FIXTURE_BYTES },
  ]);
  return [
    "const {createHash}=require('node:crypto');",
    "const {mkdirSync,writeFileSync}=require('node:fs');",
    "const {dirname}=require('node:path');",
    "const {spawnSync}=require('node:child_process');",
    `const files=${JSON.stringify(files)};`,
    `const runId=${JSON.stringify(runId)};`,
    `const entry=${JSON.stringify(ENTRYPOINT)};`,
    `const fixture=${JSON.stringify(FIXTURE_PATH)};`,
    `const expectedBundle=${JSON.stringify(BUNDLE_SHA256)};`,
    "const hash=b=>createHash('sha256').update(b).digest('hex');",
    "const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b};",
    "const order=Object.keys(files).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));",
    "const chunks=[Buffer.from('candidate-bundle/v1\\0')];",
    "for(const p of order){const pb=Buffer.from(p);const bytes=Buffer.from(files[p],'base64');mkdirSync(dirname(p),{recursive:true});writeFileSync(p,bytes,{flag:'wx'});chunks.push(u64(pb.length),pb,u64(bytes.length),bytes)}",
    "const bundle=hash(Buffer.concat(chunks));if(bundle!==expectedBundle)throw new Error('BUNDLE_MISMATCH');",
    "const child=spawnSync(process.execPath,[entry,fixture],{encoding:null,maxBuffer:2097152,env:{PATH:process.env.PATH??''}});",
    "const stdout=child.stdout??Buffer.alloc(0);const stderr=child.stderr??Buffer.alloc(0);let parsed=null;try{parsed=JSON.parse(stdout.toString('utf8'))}catch{}",
    "const result={candidate_bundle_sha256:bundle,candidate_exit_code:child.status??-1,candidate_result:parsed,candidate_stderr_length:stderr.length,candidate_stderr_sha256:hash(stderr),candidate_stdout_length:stdout.length,candidate_stdout_sha256:hash(stdout),entrypoint_sha256:hash(Buffer.from(files[entry],'base64')),fixture_sha256:hash(Buffer.from(files[fixture],'base64')),run_id:runId,schema:'sandbox_execution_result/v1'};",
    "const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';",
    "process.stdout.write(canon(result)+'\\n');",
  ].join('');
}

export function buildSandboxCommand(runId) {
  if (!RUN_ID.test(runId)) throw new TypeError('run_id invalid');
  const encoded = Buffer.from(sandboxProgram(runId), 'utf8').toString('base64');
  const command = `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
  return validateExecArguments({ command }).command;
}

export function newRunId() {
  return `pr2-${randomBytes(16).toString('hex')}`;
}

export function createRunInputs({ repoRoot, runsRoot = join(repoRoot, '.pr2-runs'), runId = newRunId() }) {
  const runDir = join(runsRoot, runId);
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(runDir, { recursive: false });
  const files = [
    { path: FIXTURE_PATH, bytes: FIXTURE_BYTES, sha256: FIXTURE_SHA256 },
    { path: ENTRYPOINT, bytes: ENTRYPOINT_BYTES, sha256: ENTRYPOINT_SHA256 },
  ].sort((a, b) => compareUtf8(a.path, b.path));
  for (const file of files) {
    const target = join(runDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes, { flag: 'wx' });
  }
  const expectedExecArguments = { command: buildSandboxCommand(runId) };
  const execArgumentsBytes = canonicalJsonBytes(expectedExecArguments);
  const manifest = {
    schema: 'candidate_execution_manifest/v1',
    contract_sha256: CONTRACT_SHA256,
    base_commit: BASE_COMMIT,
    run_id: runId,
    candidate_id: CANDIDATE_ID,
    entrypoint: ENTRYPOINT,
    fixture_path: FIXTURE_PATH,
    files: files.map(file => ({ path: file.path, size_bytes: file.bytes.length, sha256: file.sha256 })),
    candidate_bundle_sha256: BUNDLE_SHA256,
    expected_candidate_result_sha256: EXPECTED_RESULT_SHA256,
    exec_arguments_sha256: sha256(execArgumentsBytes),
    maximum_turn_ms: MAXIMUM_TURN_MS,
    network_required: false,
    credentials_required: false,
    irreversible_actions_allowed: false,
  };
  validateManifest(manifest);
  const manifestBytes = canonicalJsonBytes(manifest);
  const manifestSha256 = sha256(manifestBytes);
  const request = {
    schema: 'candidate_execution_request/v1',
    contract_sha256: CONTRACT_SHA256,
    base_commit: BASE_COMMIT,
    run_id: runId,
    candidate_manifest_sha256: manifestSha256,
    candidate_bundle_sha256: manifest.candidate_bundle_sha256,
    expected_candidate_result_sha256: manifest.expected_candidate_result_sha256,
    exec_arguments_sha256: manifest.exec_arguments_sha256,
    maximum_turn_ms: MAXIMUM_TURN_MS,
  };
  validateExecutionRequest(request, manifestSha256, manifest);
  const requestBytes = canonicalJsonBytes(request);
  writeFileSync(join(runDir, 'candidate_manifest.json'), manifestBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'expected_exec_arguments.json'), execArgumentsBytes, { flag: 'wx' });
  writeFileSync(join(runDir, 'execution_request.json'), requestBytes, { flag: 'wx' });
  return {
    runDir,
    manifest,
    manifestSha256,
    expectedExecArguments,
    executionRequest: request,
    requestSha256: sha256(requestBytes),
  };
}

export function verifyRunInputs(runDir) {
  const manifestBytes = readFileSync(join(runDir, 'candidate_manifest.json'));
  const manifest = validateManifest(parseStrictJson(manifestBytes.toString('utf8')));
  if (!manifestBytes.equals(canonicalJsonBytes(manifest))) throw new TypeError('manifest is not canonical');
  const manifestSha256 = sha256(manifestBytes);
  const argumentsBytes = readFileSync(join(runDir, 'expected_exec_arguments.json'));
  const expectedExecArguments = validateExecArguments(parseStrictJson(argumentsBytes.toString('utf8')));
  if (!argumentsBytes.equals(canonicalJsonBytes(expectedExecArguments)) || sha256(argumentsBytes) !== manifest.exec_arguments_sha256) {
    throw new TypeError('exec arguments mismatch');
  }
  const requestBytes = readFileSync(join(runDir, 'execution_request.json'));
  const executionRequest = validateExecutionRequest(
    parseStrictJson(requestBytes.toString('utf8')),
    manifestSha256,
    manifest,
  );
  if (!requestBytes.equals(canonicalJsonBytes(executionRequest))) throw new TypeError('execution request is not canonical');
  const files = manifest.files.map(file => {
    const bytes = readFileSync(join(runDir, file.path));
    if (bytes.length !== file.size_bytes || sha256(bytes) !== file.sha256) throw new TypeError(`candidate file mismatch: ${file.path}`);
    return { path: file.path, bytes };
  });
  if (deriveBundle(files) !== manifest.candidate_bundle_sha256) throw new TypeError('candidate bundle mismatch');
  const pinnedFiles = [
    { path: FIXTURE_PATH, size_bytes: FIXTURE_BYTES.length, sha256: FIXTURE_SHA256 },
    { path: ENTRYPOINT, size_bytes: ENTRYPOINT_BYTES.length, sha256: ENTRYPOINT_SHA256 },
  ];
  if (manifest.candidate_id !== CANDIDATE_ID || manifest.entrypoint !== ENTRYPOINT ||
      manifest.fixture_path !== FIXTURE_PATH ||
      canonicalJsonBytes(manifest.files).equals(canonicalJsonBytes(pinnedFiles)) === false ||
      manifest.candidate_bundle_sha256 !== BUNDLE_SHA256 ||
      manifest.expected_candidate_result_sha256 !== sha256(EXPECTED_CANDIDATE_RESULT_BYTES)) {
    throw new TypeError('pinned maker candidate mismatch');
  }
  return {
    manifest,
    manifestSha256,
    expectedExecArguments,
    executionRequest,
    requestSha256: sha256(requestBytes),
  };
}
