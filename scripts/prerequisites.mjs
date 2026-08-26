import { accessSync, constants } from 'node:fs';

export const REQUIRED_NODE = Object.freeze({ major: 22, minor: 14 });

/** Kept here, not in verify-prereqs.mjs, so consumers can name the artifact
 *  without importing a module whose top-level code runs the verification. */
export const ARTIFACT = 'local-prereqs.json';

export function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unrecognized Node.js version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function nodeMeetsMinimum(actual, required = REQUIRED_NODE) {
  return actual.major > required.major ||
    (actual.major === required.major && actual.minor >= required.minor);
}

/**
 * Resolution IS the check. Qodo #3 / D5: the previous code called require.resolve()
 * before packageIsInstalled(), so resolve() threw on a missing package and
 * packageIsInstalled() could only ever be handed a path that already existed. Its
 * false branch was unreachable, which made the package half of the verdict a
 * tautology. Here the failure is observed and returned rather than thrown past.
 */
export function resolvePackage(specifier, require) {
  try {
    const path = require.resolve(specifier);
    accessSync(path, constants.R_OK);
    return { observed: true, specifier };
  } catch (error) {
    return { observed: false, specifier, failure: error.code ?? 'RESOLUTION_FAILED' };
  }
}

/**
 * Raw observation of an environment variable, never a derived label and never the
 * value. D2/D4: the previous presence() returned the string 'present'|'missing',
 * a conclusion stored in place of the evidence, and reported a whitespace-only
 * value as present because it only tested length > 0.
 */
export function observeEnv(name, env = process.env) {
  const raw = env[name];
  if (typeof raw !== 'string') return { name, set: false, observation: 'UNSET' };
  if (raw.length === 0) return { name, set: false, observation: 'EMPTY_STRING' };
  if (raw.trim().length === 0) {
    return { name, set: false, observation: 'WHITESPACE_ONLY', length: raw.length };
  }
  return { name, set: true, observation: 'NONEMPTY', length: raw.length };
}

/**
 * Every field named here enters the verdict. Nothing else may. A field that is
 * computed, printed, and excluded from the decision is the D1 defect, and this
 * function exists so that the set of deciding fields is enumerable rather than
 * implied by a boolean expression.
 */
export function decide(checks, decidingFields) {
  const blocked = decidingFields.filter(field => checks[field]?.observed !== true);
  return {
    status: blocked.length === 0 ? 'LOCAL_PREREQS_OK' : 'LOCAL_PREREQS_BLOCKED',
    deciding_fields: decidingFields,
    blocked_by: blocked,
  };
}

export const RECEIPT_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * A fingerprint of the world the receipt was produced in. The consumer recomputes
 * this and compares. Re-review finding: the previous receipt carried a `status`
 * field and nothing else, so a consumer had no way to tell a fresh pass from one
 * produced before the packages were uninstalled — and a hand-edited `status` was
 * accepted verbatim. A stored conclusion may not outrank recoverable evidence.
 */
export function fingerprint(checks) {
  return JSON.stringify(
    Object.keys(checks).sort().map(k => [k, checks[k].observed === true, checks[k].actual ?? null]),
  );
}

/**
 * Validates a receipt WITHOUT trusting its status field. The verdict is
 * recomputed from the receipt's own raw checks, then the world is re-observed and
 * compared. Returns the reason on failure so a caller records the observed reason
 * rather than only the outcome.
 */
export function validateReceipt(receipt, currentChecks, now = Date.now()) {
  if (!receipt || typeof receipt !== 'object') return { valid: false, reason: 'RECEIPT_ABSENT' };
  if (typeof receipt.generated_at !== 'number') return { valid: false, reason: 'NO_TIMESTAMP' };
  if (now - receipt.generated_at > RECEIPT_MAX_AGE_MS) {
    return { valid: false, reason: 'RECEIPT_EXPIRED', age_ms: now - receipt.generated_at };
  }
  if (!receipt.checks || !Array.isArray(receipt.deciding_fields)) {
    return { valid: false, reason: 'RECEIPT_MALFORMED' };
  }
  // Recompute rather than read. A tampered or stale `status` cannot help here.
  const recomputed = decide(receipt.checks, receipt.deciding_fields);
  if (recomputed.status !== 'LOCAL_PREREQS_OK') {
    return { valid: false, reason: 'RECOMPUTED_BLOCKED', blocked_by: recomputed.blocked_by };
  }
  if (fingerprint(receipt.checks) !== fingerprint(currentChecks)) {
    return { valid: false, reason: 'WORLD_CHANGED_SINCE_RECEIPT' };
  }
  return { valid: true, reason: 'RECOMPUTED_AND_REOBSERVED' };
}

/**
 * Re-review finding: Number(process.env.X) is NaN for any non-numeric value and
 * AbortSignal.timeout(NaN) throws RangeError, so a typo in an env var crashed the
 * smoke check instead of bounding it.
 */
export function parseTimeout(raw, fallback = 10_000) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { ms: fallback, source: 'FALLBACK' };
  return { ms: Math.floor(value), source: 'ENV' };
}
