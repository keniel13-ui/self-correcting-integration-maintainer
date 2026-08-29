import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes, parseStrictJson } from '../pr2/canonical.mjs';
import { sha256 } from '../pr2/inputs.mjs';
import {
  AGENT_CAPABILITY_MANIFEST_SHA256,
  CALLER_TOOL_DESCRIPTIONS_SHA256,
  JUDGMENT_CONTRACT_SHA256,
  JUDGMENT_RESPONSE_FORMAT,
  JUDGMENT_SESSION_CONFIG,
  RUNTIME_PACKAGE_VERSIONS,
  RUNTIME_SOURCE_RECEIPTS,
  RUNTIME_TOOL_SURFACE_SHA256,
} from './constants.mjs';

const thisFile = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(dirname(dirname(thisFile)));
const MANIFEST_PATH = 'docs/contracts/agent-capability-manifest-v2.json';
const PACKAGE_PATHS = Object.freeze({
  '@truefoundry/trueforge': 'node_modules/@truefoundry/trueforge/package.json',
  '@truefoundry/trueforge-core': 'node_modules/@truefoundry/trueforge-core/package.json',
});

function fail(code, detail = '') {
  throw new TypeError(detail ? `${code}:${detail}` : code);
}

export function assertReturnedJudgmentSessionConfig(config, responseFormat) {
  let actualConfig;
  try {
    actualConfig = canonicalJsonBytes(config);
  } catch {
    fail('JUDGMENT_SESSION_CONFIG_MALFORMED');
  }
  if (!actualConfig.equals(canonicalJsonBytes(JUDGMENT_SESSION_CONFIG))) {
    fail('JUDGMENT_SESSION_CONFIG_MISMATCH');
  }
  let actualResponseFormat;
  try {
    actualResponseFormat = canonicalJsonBytes(responseFormat);
  } catch {
    fail('JUDGMENT_RESPONSE_FORMAT_MALFORMED');
  }
  if (!actualResponseFormat.equals(canonicalJsonBytes(JUDGMENT_RESPONSE_FORMAT))) {
    fail('JUDGMENT_RESPONSE_FORMAT_MISMATCH');
  }
  return { config, response_format: responseFormat };
}

export function assertJudgmentRuntimeInstallation({
  projectRoot = PROJECT_ROOT,
  readBytes = readFileSync,
} = {}) {
  const packageVersions = {};
  for (const [name, relativePath] of Object.entries(PACKAGE_PATHS)) {
    let packageJson;
    try {
      packageJson = JSON.parse(readBytes(join(projectRoot, relativePath)).toString('utf8'));
    } catch {
      fail('JUDGMENT_RUNTIME_PACKAGE_UNREADABLE', name);
    }
    if (packageJson?.name !== name || packageJson?.version !== RUNTIME_PACKAGE_VERSIONS[name]) {
      fail('JUDGMENT_RUNTIME_VERSION_MISMATCH', name);
    }
    packageVersions[name] = packageJson.version;
  }

  const sourceSha256 = {};
  for (const [relativePath, expected] of Object.entries(RUNTIME_SOURCE_RECEIPTS)) {
    let actual;
    try {
      actual = sha256(readBytes(join(projectRoot, relativePath)));
    } catch {
      fail('JUDGMENT_RUNTIME_SOURCE_UNREADABLE', relativePath);
    }
    if (actual !== expected) fail('JUDGMENT_RUNTIME_SOURCE_MISMATCH', relativePath);
    sourceSha256[relativePath] = actual;
  }

  if (CALLER_TOOL_DESCRIPTIONS_SHA256 === RUNTIME_TOOL_SURFACE_SHA256) {
    fail('JUDGMENT_RUNTIME_TOOL_SURFACE_COLLAPSED');
  }

  let manifestBytes;
  let manifest;
  try {
    manifestBytes = readBytes(join(projectRoot, MANIFEST_PATH));
    manifest = parseStrictJson(manifestBytes.toString('utf8'));
  } catch {
    fail('JUDGMENT_RUNTIME_MANIFEST_UNREADABLE');
  }
  if (!canonicalJsonBytes(manifest).equals(manifestBytes) ||
      sha256(manifestBytes) !== AGENT_CAPABILITY_MANIFEST_SHA256 ||
      manifest?.caller_tool_descriptions_sha256 !== CALLER_TOOL_DESCRIPTIONS_SHA256 ||
      manifest?.runtime_tool_surface_sha256 !== RUNTIME_TOOL_SURFACE_SHA256 ||
      manifest?.governing_contracts?.judgment_v9_addendum_sha256 !== JUDGMENT_CONTRACT_SHA256) {
    fail('JUDGMENT_RUNTIME_MANIFEST_MISMATCH');
  }
  if (!canonicalJsonBytes(manifest.requested_config).equals(
    canonicalJsonBytes(JUDGMENT_SESSION_CONFIG),
  ) || !canonicalJsonBytes(manifest.response_format).equals(
    canonicalJsonBytes(JUDGMENT_RESPONSE_FORMAT),
  )) {
    fail('JUDGMENT_RUNTIME_MANIFEST_SURFACE_MISMATCH');
  }

  return {
    schema: 'judgment_runtime_preflight/v1',
    package_versions: packageVersions,
    source_sha256: sourceSha256,
    requested_config_sha256: sha256(canonicalJsonBytes(JUDGMENT_SESSION_CONFIG)),
    response_format_sha256: sha256(canonicalJsonBytes(JUDGMENT_RESPONSE_FORMAT)),
    caller_tool_descriptions_sha256: CALLER_TOOL_DESCRIPTIONS_SHA256,
    runtime_tool_surface_sha256: RUNTIME_TOOL_SURFACE_SHA256,
    runtime_tool_surface_manifest_sha256: AGENT_CAPABILITY_MANIFEST_SHA256,
    status: 'VERIFIED_BEFORE_TURN',
  };
}
