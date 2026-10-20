# CLAUDE.md

Guidance for coding agents working in this repository.

## What this is

A research harness, not a product. It runs a model over an unfamiliar code corpus inside
TrueForge 0.1.4, validates the model's findings against frozen prior knowledge, verifies at most
one exact-byte repair inside a Daytona sandbox, and produces a change proposal that is always
`AWAITING_HUMAN_APPROVAL`. The point is that the agent never gains authority to apply anything.

Read `docs/ARCHITECTURE.md` before changing code, and `docs/DEVELOPMENT.md` for commands.

## Commands

```bash
npm ci
npm test                  # offline, ~5 s; run from the repo root
npm run verify:prereqs    # Node + package resolution only
npm run trueforge         # local harness on localhost:8790
npm run smoke:trueforge   # needs the harness running and a fresh prereq receipt
```

Live runs (`node scripts/judgment/run.mjs ...`, `node scripts/pr2/run.mjs`) spend model tokens
and Daytona time. Do not start one unless the user asks.

## Rules that are easy to break

- **Frozen evidence is immutable.** Never edit anything under `docs/freezes/` or
  `docs/contracts/`, the frozen priors, receipts, or `run-004-corpus/`. A correction is a new
  document that supersedes the old one, never an edit. Tests hash many of these files.
- **Hash-pinned code and config.** `package.json` and `package-lock.json` are pinned by
  `PACKAGE_SHA256` / `LOCK_SHA256`, so adding any dependency (including a linter) breaks the PR2
  preflight. `SYSTEM_INSTRUCTIONS`, `PROMPT_FRAME`, `JUDGMENT_SESSION_CONFIG`, and the response
  schema are bound into frozen priors and contracts; changing them needs a new contract and prior.
- **Absence never reads as a pass.** This is the repo's recurring defect class (README, Qodo
  findings #4, #12, #13). A verdict comes from counted observations. Empty lists, missing fields,
  unreadable event logs, and 404s must fail closed or be reported as unobserved.
- **Failures are reduced, not thrown.** Live stages return evidence with an ordered
  `failure_reasons` list (`FAILURE_ORDER` constants). A new reason is appended to the right list
  and must describe what was observed. Do not reword or reorder existing reasons.
- **No model output is trusted as evidence.** Line numbers, occurrence counts, hashes, and exec
  results are computed by the harness or read from TrueForge's persisted events, never from the
  model's prose.
- **No authority for the agent.** Do not add any tool, capability, or code path that lets a model
  apply, commit, push, or approve. `AGENT_CAPABILITIES.denied` and `validateChangeProposal` enforce
  this; keep it that way.
- **Model-authored code never runs on the host.** Candidate bytes are only hashed and encoded on
  the host and executed inside Daytona.
- **Credentials.** Provider keys live in TrueForge settings. The only key read from the
  environment is `DAYTONA_API_KEY`, for sandbox cleanup. Never log, serialize, or commit a key;
  `BoundedHttpError` messages carry codes and status numbers only.

## Style

Stdlib-only ESM (`.mjs`), Node >= 22.14, `node:test` and `node:assert/strict`. Two-space indent,
single quotes, semicolons. Strict canonical JSON goes through `scripts/pr2/canonical.mjs`
(`parseStrictJson`, `canonicalJsonBytes`, `assertClosedObject`); do not use plain `JSON.parse`
for anything that is hashed or compared. Tests that touch the filesystem use `mkdtempSync` in the
OS temp dir and never write into the repo.

## Workflow

Branch from `main` (or `dev` once it exists), open a PR, get a Qodo review, resolve or dismiss
every High finding with a reason, get a follow-up review, and a human merges. See
`CONTRIBUTING.md`.
