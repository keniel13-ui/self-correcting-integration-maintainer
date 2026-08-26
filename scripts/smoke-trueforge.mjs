import { readFileSync } from 'node:fs';
import { ARTIFACT } from './prerequisites.mjs';
import { describeCatalog } from './catalog.mjs';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:8790';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

// Structural consumption of the previous stage. If local prerequisites did not
// pass, verify-prereqs removed this artifact and this stage cannot start — it is
// missing an input, not ignoring a warning.
let localPrereqs;
try {
  localPrereqs = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
} catch {
  console.error(
    `${ARTIFACT} is absent. Run "npm run verify:prereqs" first; ` +
    'it writes this artifact only when local prerequisites pass.'
  );
  process.exit(1);
}
if (localPrereqs.status !== 'LOCAL_PREREQS_OK') {
  console.error(`${ARTIFACT} reports ${localPrereqs.status}. Refusing to proceed.`);
  process.exit(1);
}

// Qodo #6: every request is bounded. A server that accepts a connection and never
// finishes its response now fails on a deadline instead of stalling the check.
async function readJson(path) {
  const response = await fetch(new URL(path, baseUrl), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const health = await readJson('/healthz');
if (health.status !== 'ok') {
  throw new Error(`TrueForge health status was ${JSON.stringify(health.status)}`);
}

const paths = {
  model_providers: '/api/v1/catalogs/model-providers',
  mcp_servers: '/api/v1/catalogs/mcp-servers',
  sandbox_providers: '/api/v1/catalogs/sandbox-providers',
};
const catalogs = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, describeCatalog(await readJson(path))])
  )
);

const allPopulated = Object.values(catalogs).every(c => c.has_entries);

console.log(JSON.stringify({
  status: allPopulated ? 'TRUEFORGE_CATALOGS_POPULATED' : 'TRUEFORGE_REACHABLE_CATALOGS_INCOMPLETE',
  base_url: baseUrl,
  timeout_ms: TIMEOUT_MS,
  health,
  catalogs,
  not_proven: [
    'that a model can complete a turn',
    'that an MCP tool can be called',
    'that code can execute in a Daytona sandbox',
    'that any catalog entry is usable',
  ],
}, null, 2));

process.exitCode = allPopulated ? 0 : 1;
