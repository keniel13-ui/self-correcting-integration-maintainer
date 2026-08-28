import { Buffer } from 'node:buffer';
import { canonicalJsonBytes, parseStrictJson } from '../pr2/canonical.mjs';
import { deriveBundle, sha256, validateExecArguments } from '../pr2/inputs.mjs';
import { CHANGE_PROPOSAL_SCHEMA_SHA256 } from './constants.mjs';

const RESULT_KEYS = [
  'schema', 'command_manifest_sha256', 'verifier_sha256', 'payload_bundle_sha256', 'exit_code',
  'stdout_sha256', 'stdout_length', 'stderr_sha256', 'stderr_length',
];

const ARTIFACT_MIME = 'application/octet-stream';
const ARTIFACT_NAMES = Object.freeze({
  verifier: 'candidate-verifier.cjs',
  payload: 'candidate-payload.json',
  manifest: 'candidate-command-manifest.json',
});
const UPLOAD_DIR = '/opt/tf/uploads';
const artifactPath = role => `${UPLOAD_DIR}/${ARTIFACT_NAMES[role]}`;

// V6 §4A.2: this source closes over no run-specific value. T21 compares
// its exact bytes across preparations with different inputs and manifests.
const FIXED_VERIFIER_SOURCE = [
  "'use strict';",
  "const {createHash}=require('node:crypto');",
  "const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');",
  "const {dirname,posix}=require('node:path');",
  "const {spawnSync}=require('node:child_process');",
  "const hash=b=>createHash('sha256').update(b).digest('hex');",
  "const cmp=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));",
  "const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort(cmp).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';",
  "const exact=(v,keys,label)=>{if(v===null||typeof v!=='object'||Array.isArray(v))throw new Error(label+'_SHAPE');const a=Object.keys(v).sort(cmp),b=[...keys].sort(cmp);if(a.length!==b.length||a.some((k,i)=>k!==b[i]))throw new Error(label+'_KEYS')};",
  "const readCanonical=(p,label)=>{const bytes=readFileSync(p);const value=JSON.parse(bytes.toString('utf8'));if(!bytes.equals(Buffer.from(canon(value)+'\\n')))throw new Error(label+'_NOT_CANONICAL');return{bytes,value}};",
  "const safe=p=>{if(typeof p!=='string'||!p||p!==p.normalize('NFC')||p.startsWith('/')||p.includes('\\\\')||p.includes('\\0')||posix.normalize(p)!==p||p.split('/').some(s=>!s||s==='.'||s==='..'))throw new Error('PAYLOAD_PATH_INVALID');return p};",
  "const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b};",
  "if(process.argv.length!==4)throw new Error('ARGUMENT_COUNT_INVALID');",
  "const verifierPath=process.argv[1],payloadPath=process.argv[2],manifestPath=process.argv[3];",
  "const payloadRead=readCanonical(payloadPath,'PAYLOAD'),manifestRead=readCanonical(manifestPath,'MANIFEST');",
  "const payload=payloadRead.value,manifest=manifestRead.value;",
  "exact(payload,['schema','files'],'PAYLOAD');if(payload.schema!=='candidate_payload/v1'||!Array.isArray(payload.files)||payload.files.length===0)throw new Error('PAYLOAD_INVALID');",
  "exact(manifest,['schema','change_proposal_schema_sha256','corpus_manifest_sha256','verifier_sha256','payload_bundle_sha256','verification','transport','irreversible_actions_allowed'],'MANIFEST');",
  "if(manifest.schema!=='candidate_verification_command/v2'||manifest.irreversible_actions_allowed!==false)throw new Error('MANIFEST_INVALID');",
  "exact(manifest.verification,['argv','timeout_ms'],'VERIFICATION');if(!Array.isArray(manifest.verification.argv)||manifest.verification.argv.length===0||manifest.verification.argv.some(x=>typeof x!=='string'||!x)||!Number.isSafeInteger(manifest.verification.timeout_ms)||manifest.verification.timeout_ms<1)throw new Error('VERIFICATION_INVALID');",
  "exact(manifest.transport,['type','verifier_file_name','payload_file_name','manifest_file_name','verifier_path','payload_path','manifest_path','payload_artifact_sha256','exec_arguments_sha256'],'TRANSPORT');",
  "if(manifest.transport.type!=='trueforge_file_parts/v2'||verifierPath!==manifest.transport.verifier_path||payloadPath!==manifest.transport.payload_path||manifestPath!==manifest.transport.manifest_path)throw new Error('TRANSPORT_PATH_MISMATCH');",
  "const chunks=[Buffer.from('candidate-bundle/v1\\0')],decoded=[];let previous=null;",
  "for(const file of payload.files){exact(file,['path','data_base64'],'PAYLOAD_FILE');const p=safe(file.path);if(previous!==null&&cmp(previous,p)>=0)throw new Error('PAYLOAD_ORDER_INVALID');previous=p;const bytes=Buffer.from(file.data_base64,'base64');if(bytes.toString('base64')!==file.data_base64)throw new Error('PAYLOAD_BASE64_INVALID');const pb=Buffer.from(p);chunks.push(u64(pb.length),pb,u64(bytes.length),bytes);decoded.push({path:p,bytes})}",
  "const self=hash(readFileSync(verifierPath)),bundle=hash(Buffer.concat(chunks));",
  "if(self!==manifest.verifier_sha256)throw new Error('VERIFIER_IDENTITY_MISMATCH');",
  "if(hash(payloadRead.bytes)!==manifest.transport.payload_artifact_sha256||bundle!==manifest.payload_bundle_sha256)throw new Error('PAYLOAD_IDENTITY_MISMATCH');",
  "for(const file of decoded){mkdirSync(dirname(file.path),{recursive:true});writeFileSync(file.path,file.bytes,{flag:'wx'})}",
  "const child=spawnSync(manifest.verification.argv[0],manifest.verification.argv.slice(1),{encoding:null,maxBuffer:2097152,timeout:manifest.verification.timeout_ms,env:{PATH:process.env.PATH??''}});",
  "const stdout=child.stdout??Buffer.alloc(0),stderr=child.stderr??Buffer.alloc(0);",
  "const result={command_manifest_sha256:hash(manifestRead.bytes),exit_code:child.status??-1,payload_bundle_sha256:bundle,schema:'candidate_verification_result/v1',stderr_length:stderr.length,stderr_sha256:hash(stderr),stdout_length:stdout.length,stdout_sha256:hash(stdout),verifier_sha256:self};",
  "process.stdout.write(canon(result)+'\\n');",
  '',
].join('\n');

const FIXED_VERIFIER_BYTES = Buffer.from(FIXED_VERIFIER_SOURCE, 'utf8');
const FIXED_VERIFIER_SHA256 = sha256(FIXED_VERIFIER_BYTES);

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

function outboundArtifact(role, bytes) {
  const name = ARTIFACT_NAMES[role];
  return {
    role,
    name,
    mime: ARTIFACT_MIME,
    intended_sandbox_path: artifactPath(role),
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    data_uri: `data:${ARTIFACT_MIME};base64,${bytes.toString('base64')}`,
  };
}

export function prepareCandidateVerification({ corpus, finding }) {
  const repaired = applyExactRepair(corpus, finding);
  const files = repaired.files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const candidateBundleSha256 = deriveBundle(files);
  const payloadBytes = canonicalJsonBytes({
    schema: 'candidate_payload/v1',
    files: files.map(file => ({ path: file.path, data_base64: file.bytes.toString('base64') })),
  });
  const expectedExecArguments = validateExecArguments({
    command: `node ${artifactPath('verifier')} ${artifactPath('payload')} ${artifactPath('manifest')}`,
  });
  if (Buffer.byteLength(expectedExecArguments.command, 'utf8') > 256) {
    throw new TypeError('exec command exceeds 256 bytes');
  }
  const commandManifest = {
    schema: 'candidate_verification_command/v2',
    change_proposal_schema_sha256: CHANGE_PROPOSAL_SCHEMA_SHA256,
    corpus_manifest_sha256: corpus.manifestSha256,
    verifier_sha256: FIXED_VERIFIER_SHA256,
    payload_bundle_sha256: candidateBundleSha256,
    verification: corpus.manifest.verification,
    transport: {
      type: 'trueforge_file_parts/v2',
      verifier_file_name: ARTIFACT_NAMES.verifier,
      payload_file_name: ARTIFACT_NAMES.payload,
      manifest_file_name: ARTIFACT_NAMES.manifest,
      verifier_path: artifactPath('verifier'),
      payload_path: artifactPath('payload'),
      manifest_path: artifactPath('manifest'),
      payload_artifact_sha256: sha256(payloadBytes),
      exec_arguments_sha256: sha256(canonicalJsonBytes(expectedExecArguments)),
    },
    irreversible_actions_allowed: false,
  };
  const commandManifestBytes = canonicalJsonBytes(commandManifest);
  const commandManifestSha256 = sha256(commandManifestBytes);
  const outboundArtifacts = [
    outboundArtifact('verifier', FIXED_VERIFIER_BYTES),
    outboundArtifact('payload', payloadBytes),
    outboundArtifact('manifest', commandManifestBytes),
  ];
  return {
    ...repaired,
    candidateBundleSha256,
    commandManifest,
    commandManifestSha256,
    verifierSha256: FIXED_VERIFIER_SHA256,
    expectedExecArguments,
    outboundArtifacts,
  };
}

export function parseCandidateResult(text) {
  const bytes = Buffer.from(text, 'utf8');
  const result = parseStrictJson(text);
  const actual = Object.keys(result ?? {}).sort();
  const wanted = [...RESULT_KEYS].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError('candidate result keys invalid');
  }
  if (!bytes.equals(canonicalJsonBytes(result)) || result.schema !== 'candidate_verification_result/v1' ||
      !/^[0-9a-f]{64}$/.test(result.command_manifest_sha256) ||
      !/^[0-9a-f]{64}$/.test(result.verifier_sha256) ||
      !/^[0-9a-f]{64}$/.test(result.payload_bundle_sha256) ||
      !Number.isSafeInteger(result.exit_code) || !Number.isSafeInteger(result.stdout_length) ||
      result.stdout_length < 0 || !Number.isSafeInteger(result.stderr_length) || result.stderr_length < 0 ||
      !/^[0-9a-f]{64}$/.test(result.stdout_sha256) || !/^[0-9a-f]{64}$/.test(result.stderr_sha256)) {
    throw new TypeError('candidate result invalid');
  }
  return result;
}
