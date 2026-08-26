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
