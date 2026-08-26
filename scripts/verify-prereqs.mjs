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

const verdict = decide(checks, ['node', 'trueforge', 'sdk']);

const report = {
  ...verdict,
  claim: 'This process observed the local Node runtime and package resolution. Nothing else.',
  checks,

  // Raw observations, deliberately outside the verdict. Whether a credential is
  // usable, or configured inside the TrueForge UI where this process cannot see
  // it, is not locally observable — so no readiness claim is made about it.
  // The previous code emitted 'missing_or_configured_in_trueforge_ui', a
  // disjunction with no false case (Qodo #2 / D2), and then excluded it from the
  // verdict anyway (Qodo #1 / D1).
  credentials_observed_in_env: [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'DAYTONA_API_KEY',
  ].map(name => observeEnv(name)),

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
