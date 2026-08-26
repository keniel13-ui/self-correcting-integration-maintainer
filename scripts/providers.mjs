/**
 * Describes what a TrueForge settings response actually establishes about
 * provider configuration.
 *
 * Re-review finding: the previous check returned `configured: true` for any body
 * that parsed as JSON, so `{"data": []}` — TrueForge saying nothing is configured
 * — read as configured. That is the third instance of one shape in this repo:
 *
 *   1. Boolean(catalogs[i])            true for []  (Qodo #4)
 *   2. decide(checks, [])              passes with no fields  (re-review F1)
 *   3. providerConfigured(any JSON)    true for {"data": []}  (this)
 *
 * All three are absence reading as a pass, and the third was written while
 * repairing the second. Counting is the fix: a verdict must come from how many
 * things were found, never from whether a response arrived.
 *
 * The two endpoints do not share a shape. As measured against TrueForge 0.1.4 on
 * 2026-08-26:
 *   GET /api/v1/settings/model-providers   -> {"data": [ {...}, ... ]}
 *   GET /api/v1/settings/sandbox-providers -> {"data": {...}}
 * so both an array and a single object must count, and neither may be assumed.
 */
export function describeProviders(body) {
  if (body === null || body === undefined) {
    return { configured: false, entry_count: 0, observation: 'NO_BODY' };
  }
  const data = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;

  if (data === null || data === undefined) {
    return { configured: false, entry_count: 0, observation: 'NULL_DATA' };
  }
  if (Array.isArray(data)) {
    return {
      configured: data.length > 0,
      entry_count: data.length,
      shape: 'array',
      observation: data.length > 0 ? 'CONFIGURED' : 'NONE_CONFIGURED',
    };
  }
  if (typeof data === 'object') {
    // A single-object response counts as one entry only if it carries something.
    const keys = Object.keys(data);
    return {
      configured: keys.length > 0,
      entry_count: keys.length > 0 ? 1 : 0,
      shape: 'object',
      observation: keys.length > 0 ? 'CONFIGURED' : 'EMPTY_OBJECT',
    };
  }
  return { configured: false, entry_count: 0, shape: typeof data, observation: 'UNEXPECTED_SHAPE' };
}
