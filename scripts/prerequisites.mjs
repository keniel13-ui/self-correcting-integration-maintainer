import { accessSync, constants } from 'node:fs';

export const REQUIRED_NODE = Object.freeze({ major: 22, minor: 14 });

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

export function packageIsInstalled(packageJsonPath) {
  try {
    accessSync(packageJsonPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function presence(value) {
  return typeof value === 'string' && value.length > 0 ? 'present' : 'missing';
}

