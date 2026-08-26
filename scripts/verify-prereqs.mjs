import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import {
  ARTIFACT,
  CANONICAL_DECIDING_FIELDS,
  decide,
  nodeMeetsMinimum,
  observeEnv,
  parseNodeVersion,
  resolvePackage,
  REQUIRED_NODE,
} from './prerequisites.mjs';

const require = createRequire(import.meta.url);

const checks = {
  node: (() => {
    try {
      const parsed = parseNodeVersion(process.version);
      return {
        observed: nodeMeetsMinimum(parsed),
        actual: process.version,
        required: `>=${REQUIRED_NODE.major}.${REQUIRED_NODE.minor}`,
      };
    } catch (error) {
      return { observed: false, actual: process.version, failure: error.message };
    }
  })(),
  trueforge: resolvePackage('@truefoundry/trueforge/package.json', require),
  sdk: resolvePackage('@truefoundry/trueforge-sdk/package.json', require),
};

const MODEL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'];
const credentials = [...MODEL_KEYS, 'DAYTONA_API_KEY'].map(name => observeEnv(name));

// Re-review finding: making credentials deciding fields here rejected a correctly
// configured installation, because TrueForge's documented setup puts provider
// credentials in its own settings, which this process cannot see — it runs before
// the harness is up. Environment absence is therefore not evidence of absence.
//
// So this stage no longer claims anything about credentials. It claims only what a
// process with no network and no harness can observe. Credential authority moves to
// the smoke stage, which asks TrueForge's settings API, the one surface that knows.
const verdict = decide(checks, CANONICAL_DECIDING_FIELDS);

const report = {
  ...verdict,
  generated_at: Date.now(),
  claim: 'This process observed the local Node runtime and package resolution. Nothing else. It makes no claim about credentials, because TrueForge may hold them in its own settings where this process cannot see them.',
  checks,

  // Advisory only, and deliberately not a deciding field. What was observed is
  // whether these names carry a value in THIS environment. What that cannot
  // establish is whether a provider is configured, because TrueForge's own
  // settings are the authority and are not readable from here.
  credentials_observed_in_env: {
    observation: credentials,
    decides_nothing_here: true,
    authority: 'GET /api/v1/settings/{model-providers,sandbox-providers} on a running TrueForge',
  },

  not_proven: [
    'that any provider is configured in TrueForge',
    'that any credential is valid or usable',
    'that TrueForge holds provider configuration',
    'that a model can complete a turn',
    'that an MCP tool can be called',
    'that code can execute in a Daytona sandbox',
  ],
};

// The signal is consumed structurally, not read. On BLOCKED the artifact is
// removed, so the next stage cannot proceed for lack of an input rather than by
// noticing a status. A nonzero exit that nothing reads relocates the silence; it
// does not end it.
if (verdict.status === 'LOCAL_PREREQS_OK') {
  writeFileSync(ARTIFACT, JSON.stringify(report, null, 2));
} else {
  rmSync(ARTIFACT, { force: true });
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = verdict.status === 'LOCAL_PREREQS_OK' ? 0 : 1;
