import { createRequire } from 'node:module';
import {
  nodeMeetsMinimum,
  packageIsInstalled,
  parseNodeVersion,
  presence,
  REQUIRED_NODE,
} from './prerequisites.mjs';

const require = createRequire(import.meta.url);
const node = parseNodeVersion(process.version);
const trueforgePackage = require.resolve('@truefoundry/trueforge/package.json');
const sdkPackage = require.resolve('@truefoundry/trueforge-sdk/package.json');

const report = {
  node: {
    actual: process.version,
    required: `>=${REQUIRED_NODE.major}.${REQUIRED_NODE.minor}`,
    ok: nodeMeetsMinimum(node),
  },
  packages: {
    trueforge: packageIsInstalled(trueforgePackage),
    sdk: packageIsInstalled(sdkPackage),
  },
  external_configuration: {
    model: [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
    ].some(name => presence(process.env[name]) === 'present')
      ? 'present'
      : 'missing_or_configured_in_trueforge_ui',
    daytona: presence(process.env.DAYTONA_API_KEY),
  },
};

const ok = report.node.ok && Object.values(report.packages).every(Boolean);
console.log(JSON.stringify({ status: ok ? 'READY_LOCAL' : 'BLOCKED_LOCAL', ...report }, null, 2));
process.exitCode = ok ? 0 : 1;

