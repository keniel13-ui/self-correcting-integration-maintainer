import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE_COMMIT,
  LOCK_SHA256,
  PACKAGE_SHA256,
  SDK_VERSION,
  TRUEFORGE_VERSION,
} from './constants.mjs';
import { sha256 } from './inputs.mjs';

function installedVersion(repoRoot, specifier) {
  const require = createRequire(join(repoRoot, 'package.json'));
  return JSON.parse(readFileSync(require.resolve(specifier), 'utf8')).version;
}

export function observePreflight(repoRoot) {
  return {
    baseCommit: execFileSync('git', ['merge-base', 'HEAD', BASE_COMMIT], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    packageSha256: sha256(readFileSync(join(repoRoot, 'package.json'))),
    lockSha256: sha256(readFileSync(join(repoRoot, 'package-lock.json'))),
    trueforgeVersion: installedVersion(repoRoot, '@truefoundry/trueforge/package.json'),
    sdkVersion: installedVersion(repoRoot, '@truefoundry/trueforge-sdk/package.json'),
    nodeVersion: process.version,
    npmVersion: execFileSync('npm', ['--version'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  };
}

export function preflightFailures(observed) {
  const failures = [];
  if (observed.baseCommit !== BASE_COMMIT) failures.push('BASE_MISMATCH');
  if (observed.packageSha256 !== PACKAGE_SHA256 || observed.lockSha256 !== LOCK_SHA256 ||
      observed.trueforgeVersion !== TRUEFORGE_VERSION || observed.sdkVersion !== SDK_VERSION) {
    failures.push('DEPENDENCY_MISMATCH');
  }
  return failures;
}
