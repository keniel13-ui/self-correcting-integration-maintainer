import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import {
  ARTIFACT,
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

// Re-review finding: credentials were reported and excluded from every verdict,
// so nothing in the pipeline could ever block on a missing one. They are deciding
// fields now. A local run that cannot reach a model is not "prereqs ok" — it is
// blocked, and it says which credential blocked it.
checks.model_credential = {
  observed: credentials.some(c => MODEL_KEYS.includes(c.name) && c.set),
  candidates: MODEL_KEYS,
};
checks.sandbox_credential = {
  observed: credentials.find(c => c.name === 'DAYTONA_API_KEY')?.set === true,
};

const verdict = decide(checks, ['node', 'trueforge', 'sdk', 'model_credential', 'sandbox_credential']);

const report = {
  ...verdict,
  generated_at: Date.now(),
  claim: 'This process observed the local Node runtime, package resolution, and whether a model and sandbox credential exist in this environment. Nothing else.',
  checks,

  // Raw observations behind the model_credential / sandbox_credential verdicts.
  // Kept as evidence, not as the decision: presence in the environment is what
  // was observed; usability is not, and stays in not_proven.
  credentials_observed_in_env: credentials,

  not_proven: [
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
