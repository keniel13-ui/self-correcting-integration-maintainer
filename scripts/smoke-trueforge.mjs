import { readFileSync } from 'node:fs';
import { ARTIFACT, parseTimeout, validateReceipt } from './prerequisites.mjs';
import { spawnSync } from 'node:child_process';
import { describeCatalog } from './catalog.mjs';
import { describeProviders } from './providers.mjs';

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:8790';
const timeout = parseTimeout(process.env.SMOKE_TIMEOUT_MS);
const TIMEOUT_MS = timeout.ms;

// Structural consumption of the previous stage. If local prerequisites did not
// pass, verify-prereqs removed this artifact and this stage cannot start — it is
// missing an input, not ignoring a warning.
let receipt;
try {
  receipt = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
} catch {
  receipt = null;
}

// Re-observe the world, then validate the receipt against it. The receipt's own
// `status` is never read — the verdict is recomputed from its raw checks and the
// fingerprint is compared to what is true now. A receipt produced before a
// package was removed, or one edited by hand, fails here.
const fresh = spawnSync(process.execPath, ['scripts/verify-prereqs.mjs'], { encoding: 'utf8' });
let currentChecks = null;
try {
  currentChecks = JSON.parse(fresh.stdout).checks;
} catch {
  console.error('Could not re-observe local prerequisites.');
  process.exit(1);
}

const validation = validateReceipt(receipt, currentChecks);
if (!validation.valid) {
  console.error(JSON.stringify({
    status: 'REFUSED_STALE_OR_ABSENT_RECEIPT',
    reason: validation.reason,
    detail: validation,
    remedy: 'npm run verify:prereqs',
  }, null, 2));
  process.exit(1);
}

// Qodo #6: every request is bounded. A server that accepts a connection and never
// finishes its response now fails on a deadline instead of stalling the check.
// Contracts below were OBSERVED against TrueForge 0.1.4 on 2026-08-26, not
// assumed. The previous version called response.json() on every path and checked
// health.status === 'ok'; /healthz actually returns the plain-text body "OK!",
// so the check could never have passed against the real harness. It had never
// been run against one.
async function read(path) {
  const response = await fetch(new URL(path, baseUrl), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('json') ? { json: JSON.parse(text), text } : { json: null, text };
}

const readJson = async path => {
  const { json, text } = await read(path);
  if (json === null) throw new Error(`${path} did not return JSON: ${text.slice(0, 80)}`);
  return json;
};

try {
  const health = await read('/healthz');
  // Observed contract, measured against TrueForge 0.1.4 on 2026-08-26: HTTP 200
  // with the exact plain-text body "OK!". Re-review finding: startsWith('OK')
  // also accepts "OK-ish", "OKAY BUT DEGRADED", and any body that happens to
  // begin with those two characters, which is a looser claim than what was
  // observed. Match what was measured; a different body is a contract change and
  // should fail loudly rather than pass quietly.
  const HEALTH_BODY = 'OK!';
  const healthy = health.text.trim() === HEALTH_BODY;
  if (!healthy) {
    throw new Error(`TrueForge health body was ${JSON.stringify(health.text.slice(0, 80))}`);
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

  // Credential authority lives HERE, not in verify-prereqs. This stage can ask the
// one surface that knows whether a provider is actually configured, including
// credentials entered through the TrueForge UI that no environment variable
// reflects. A 404 from these endpoints is TrueForge reporting "nothing configured",
// which is a real observation, not an inability to observe.
async function providerConfigured(path) {
  try {
    const { json, text } = await read(path);
    if (json === null) {
      return { configured: false, entry_count: 0, observation: 'NON_JSON_RESPONSE', body: text.slice(0, 80) };
    }
    return describeProviders(json);
  } catch (error) {
    const notFound = /returned 404/.test(error.message);
    return {
      configured: false,
      entry_count: 0,
      observation: notFound ? 'NONE_CONFIGURED' : 'UNREACHABLE',
      detail: error.message.slice(0, 120),
    };
  }
}

const providers = {
  model: await providerConfigured('/api/v1/settings/model-providers'),
  sandbox: await providerConfigured('/api/v1/settings/sandbox-providers'),
};

const allPopulated = Object.values(catalogs).every(c => c.has_entries);
const allProviders = Object.values(providers).every(p => p.configured);

  console.log(JSON.stringify({
    status: allPopulated && allProviders
    ? 'TRUEFORGE_READY'
    : allPopulated ? 'TRUEFORGE_CATALOGS_POPULATED_PROVIDERS_MISSING' : 'TRUEFORGE_REACHABLE_CATALOGS_INCOMPLETE',
  deciding: ['catalogs populated', 'model provider configured', 'sandbox provider configured'],
    base_url: baseUrl,
    timeout_ms: TIMEOUT_MS,
    timeout_source: timeout.source,
    receipt_validation: validation.reason,
    health: {
      body: health.text.trim(),
      observed_contract: 'HTTP 200, body exactly "OK!", measured against TrueForge 0.1.4 on 2026-08-26',
    },
    catalogs,
    providers_configured_in_trueforge: providers,
    not_proven: [
      // Kairos's wording guard: a configured provider proves that stored
      // configuration exists. It does not prove the stored credential works.
      // Only a live model turn and a live sandbox execution establish that.
      'that any configured credential is valid or usable',
      'that a model can complete a turn',
      'that an MCP tool can be called',
      'that code can execute in a Daytona sandbox',
      'that any catalog entry is usable',
    ],
  }, null, 2));

  process.exitCode = allPopulated && allProviders ? 0 : 1;
} catch (error) {
  // Qodo #6 intent: a smoke run terminates deterministically WITH evidence.
  // An uncaught throw prints a stack trace and exits 1 with no structured
  // record of what was reached before it failed.
  console.error(JSON.stringify({
    status: 'SMOKE_FAILED',
    base_url: baseUrl,
    timeout_ms: TIMEOUT_MS,
    failure: error.name === 'TimeoutError' ? 'DEADLINE_EXCEEDED' : (error.cause?.code ?? error.name),
    message: error.message,
  }, null, 2));
  process.exit(1);
}
