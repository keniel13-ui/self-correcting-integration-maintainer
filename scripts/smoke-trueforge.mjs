const baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:8790';

async function readJson(path) {
  const response = await fetch(new URL(path, baseUrl));
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

const catalogs = await Promise.all([
  readJson('/api/v1/catalogs/model-providers'),
  readJson('/api/v1/catalogs/mcp-servers'),
  readJson('/api/v1/catalogs/sandbox-providers'),
]);

console.log(JSON.stringify({
  status: 'TRUEFORGE_REACHABLE',
  base_url: baseUrl,
  health,
  catalogs_reached: {
    model_providers: Boolean(catalogs[0]),
    mcp_servers: Boolean(catalogs[1]),
    sandbox_providers: Boolean(catalogs[2]),
  },
  ceiling: 'This proves the local harness and catalogs respond. It does not prove a model call, MCP tool call, or sandbox execution.',
}, null, 2));

