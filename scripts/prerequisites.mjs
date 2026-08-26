import { accessSync, constants } from 'node:fs';

export const REQUIRED_NODE = Object.freeze({ major: 22, minor: 14 });

/** Kept here, not in verify-prereqs.mjs, so consumers can name the artifact
 *  without importing a module whose top-level code runs the verification.
 *  Overridable via PREREQ_ARTIFACT_PATH. Re-review finding: the end-to-end tests
 *  spawned the verifier and rmSync'd the real receipt, so running the suite
 *  destroyed the developer's working state and could delete a receipt another
 *  process was mid-way through consuming. */
export const ARTIFACT = process.env.PREREQ_ARTIFACT_PATH || 'local-prereqs.json';

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

/**
 * The canonical set of deciding fields. This is the constant; a receipt's own
 * `deciding_fields` array is EVIDENCE OF WHAT IT CLAIMED, never the terms of its
 * own validation. Re-review finding: validateReceipt recomputed over the list the
 * receipt supplied, so a receipt carrying failing checks plus `deciding_fields: []`
 * validated — an empty enumeration read as a pass, one layer inside the fix for
 * empty enumerations read as passes.
 */
export const CANONICAL_DECIDING_FIELDS = Object.freeze(['node', 'trueforge', 'sdk']);

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
  // The receipt does not get to say what it was judged on. Its claimed list is
  // compared against the constant and must match exactly; then the verdict is
  // recomputed over the CONSTANT, not over anything the receipt supplied.
  const claimed = [...receipt.deciding_fields].sort().join(',');
  const canonical = [...CANONICAL_DECIDING_FIELDS].sort().join(',');
  if (claimed !== canonical) {
    return {
      valid: false,
      reason: 'DECIDING_FIELDS_MISMATCH',
      claimed: receipt.deciding_fields,
      canonical: [...CANONICAL_DECIDING_FIELDS],
    };
  }
  const recomputed = decide(receipt.checks, CANONICAL_DECIDING_FIELDS);
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
