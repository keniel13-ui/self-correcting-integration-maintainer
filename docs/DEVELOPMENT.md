# Local development

Every command here was run on macOS with Node v22.14.0 and npm 10.9.2. The observed result is
noted next to each one.

## Install and test (offline)

```bash
node --version        # must be >= 22.14 (package.json engines); .nvmrc names 24
npm ci
npm test              # node --test; no network, no credentials
```

Observed on `main`: `# tests 108`, `# pass 108`, `# fail 0`, about 5 seconds.

Notes:

- Run tests from the repository root. Several tests read files by relative path
  (`docs/contracts/...`).
- `T19` runs `npm ci --offline` in a temporary directory, so the preceding `npm ci` must have
  filled the npm cache. It also asserts that `git status --porcelain` does not change during the
  test, so a dirty worktree is fine but files written mid-test are not.
- `npm audit` reports advisories in the `@truefoundry/trueforge` devDependency tree;
  `npm audit --omit=dev` reports 0. Do not run `npm audit fix`: it rewrites `package-lock.json`,
  which is hash-pinned (see below).

## Local prerequisite check

```bash
npm run verify:prereqs
```

Observed: prints `"status": "LOCAL_PREREQS_OK"` and writes `local-prereqs.json` (gitignored).
It only observes Node and package resolution. On a block it deletes the receipt.

## TrueForge harness

```bash
npm run trueforge     # serves on localhost:8790; first start runs DB migrations
```

Observed: logs `Agent server listening on http://localhost:8790` within a few seconds. State is
stored outside the repo, in `~/Library/Application Support/trueforge/db/db.sqlite` on macOS.

TrueForge binds `localhost`, which on macOS resolved to IPv6 `::1`. In the verification session
an unrelated process already held IPv4 `*:8790`, so `http://127.0.0.1:8790/healthz` returned
that process's 404 while `http://localhost:8790/healthz` returned `OK!`. Check first:

```bash
lsof -nP -iTCP:8790 -sTCP:LISTEN
```

## Smoke check

```bash
npm run smoke:trueforge
# or, when 127.0.0.1 is taken as described above:
TRUEFORGE_BASE_URL=http://localhost:8790 npm run smoke:trueforge
```

Observed against a fresh harness with no providers configured: status
`TRUEFORGE_CATALOGS_POPULATED_PROVIDERS_MISSING`, health body `OK!`, catalogs with 9 model
providers, 14 MCP servers, 1 sandbox provider, both providers `NONE_CONFIGURED`, exit code `1`.
It reaches `TRUEFORGE_READY` only after a model provider and a Daytona provider are added in the
TrueForge UI. Run `npm run verify:prereqs` first; smoke refuses a missing or stale receipt.

`TRUEFORGE_BASE_URL` is read by the smoke check only. On `main` the live runners always use
`http://127.0.0.1:8790`.

## Validating run inputs without a live model

`executeJudgmentLoop` validates the corpus and prior before it calls the model, so a stub model
shows whether a corpus and prior are accepted, with no network:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { executeJudgmentLoop } from './scripts/judgment/run.mjs';
try {
  await executeJudgmentLoop({
    corpusRoot: 'docs/freezes/run-004-corpus',
    manifestBytes: readFileSync('docs/freezes/run-004-corpus/manifest.json'),
    priorBytes: readFileSync('docs/contracts/PRIOR_KNOWLEDGE_RUN_004.json'),
    runModel: async () => { throw new Error('STOP_BEFORE_MODEL'); },
  });
} catch (error) { console.log(error.message); }
"
```

Observed: `STOP_BEFORE_MODEL` (inputs accepted). With `docs/contracts/PRIOR_KNOWLEDGE.json`
instead, it prints `consumed predecessor prior cannot govern successor run`.

## Live runs

See [README: Running the loop](../README.md#running-the-loop). Live runs need configured providers
in TrueForge and `DAYTONA_API_KEY` exported for sandbox cleanup. They were not executed while
writing this document.

## Hash-pinned files: do not edit casually

| File | Pin | Effect of an edit |
|---|---|---|
| `package.json`, `package-lock.json` | `PACKAGE_SHA256`, `LOCK_SHA256` in `scripts/pr2/constants.mjs` | PR2 preflight reports `DEPENDENCY_MISMATCH` |
| `SYSTEM_INSTRUCTIONS`, `PROMPT_FRAME`, tool surfaces in `scripts/judgment/constants.mjs` | `instructions_sha256` and tool hashes inside every frozen prior | Every existing prior stops validating |
| `docs/contracts/**`, `docs/freezes/**` | Hashes in constants, priors, receipts, and tests | Frozen evidence no longer matches its published hash |
| `node_modules/@truefoundry/**` | `RUNTIME_SOURCE_RECEIPTS` | Judgment runtime preflight fails before any session |

`npm test` checks most of these. If it fails after an edit to one of these files, the edit is the
problem, not the test.
