/**
 * Pure catalog description, kept out of smoke-trueforge.mjs so that importing it
 * does not execute a script whose top-level code performs network requests.
 *
 * Qodo #4 / D3: the previous code used Boolean(body), which is true for [] and
 * {} alike, so a catalog with no providers reported success. Reachability,
 * shape, and content are three different observations and stay three fields.
 */
export function describeCatalog(body) {
  const shape = Array.isArray(body) ? 'array' : body === null ? 'null' : typeof body;
  const entries = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? Object.values(body).find(Array.isArray) ?? null
      : null;
  return {
    endpoint_reached: true,
    response_shape: shape,
    entry_count: entries === null ? null : entries.length,
    has_entries: entries === null ? false : entries.length > 0,
  };
}
