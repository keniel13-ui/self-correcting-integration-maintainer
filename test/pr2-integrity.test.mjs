import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SDK_VERSION, TRUEFORGE_VERSION } from '../scripts/pr2/constants.mjs';

const repoRoot = dirname(dirname(new URL(import.meta.url).pathname));

test('T19 fresh offline npm ci is clean, pinned, and does not alter the source worktree', { timeout: 120_000 }, () => {
  const before = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoRoot, encoding: 'utf8' });
  const clone = mkdtempSync(join(tmpdir(), 'fresh-install-'));
  cpSync(join(repoRoot, 'package.json'), join(clone, 'package.json'));
  cpSync(join(repoRoot, 'package-lock.json'), join(clone, 'package-lock.json'));
  const install = spawnSync('npm', ['ci', '--offline', '--ignore-scripts'], { cwd: clone, encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  assert.doesNotMatch(install.stderr, /invalid|damaged/i);
  const listing = spawnSync('npm', ['ls', '--all', '--json'], { cwd: clone, encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  const tree = JSON.parse(listing.stdout);
  assert.equal(tree.dependencies['@truefoundry/trueforge'].version, TRUEFORGE_VERSION);
  assert.equal(tree.dependencies['@truefoundry/trueforge-sdk'].version, SDK_VERSION);
  const after = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(after, before);
});
