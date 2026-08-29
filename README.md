# Self-Correcting Integration Maintainer

> **Current state:** infrastructure slice only. No self-improvement, safety, or contest-result claim has been established yet.

A TrueForge agent that keeps one integration working when an upstream contract changes unexpectedly. It may revise its understanding, hypotheses, strategy, skills, and candidate code when evidence demands it. It may not revise the evidence required to authorize the consequences of those revisions.

## The job

The final system will:

1. detect a structural mismatch between an expected and observed integration contract;
2. investigate competing explanations using tools, a sandbox, and a challenger subagent;
3. produce and verify a candidate repair;
4. stop before the consequential state change;
5. bind human authorization to the exact proposed transition;
6. preserve only evidence-supported learning for the next incident.

The contest build narrows the task surface, not the cognitive depth.

## Why TrueForge is central

- the agent loop and persistent session run in TrueForge;
- external systems are reached through MCP;
- generated diagnostics and repair candidates execute in Daytona;
- the challenger uses TrueForge subagents;
- the consequential action pauses at TrueForge's human checkpoint;
- the demo exposes the harness state rather than hiding it behind a model wrapper.

## Setup

**Requirements**

- Node.js 22.14 or newer (24.x tested)
- an Anthropic API key, or any provider in the TrueForge catalog
- a Daytona API key with **`write:sandboxes`, `delete:sandboxes`, and `write:snapshots`**

> **`write:snapshots` is not optional.** A Daytona key that can create and delete sandboxes but
> lacks it will be reported by TrueForge 0.1.4 as an invalid key, which is a misleading error we
> filed upstream as [truefoundry/trueforge#461](https://github.com/truefoundry/trueforge/issues/461).
> Check yours with `GET https://app.daytona.io/api/api-keys/current`.

**1. Install and verify the machine**

```bash
npm ci
npm test                 # no network required
npm run verify:prereqs   # Node + package resolution only; writes local-prereqs.json on pass
```

`verify:prereqs` deliberately makes **no claim about credentials.** It runs before the harness is
up, so it cannot see providers configured inside TrueForge, and absence in the environment is not
evidence of absence. Credential authority belongs to the next step.

**2. Start the harness**

```bash
npm run trueforge        # http://127.0.0.1:8790, ~25s cold start
```

**3. Configure providers**

In the TrueForge UI at `http://127.0.0.1:8790`, add a model provider and a Daytona sandbox
provider. Keys entered here live in TrueForge, not in this repository. **No key is ever read from,
written to, or committed by this project.**

**4. Prove the harness end to end**

```bash
npm run smoke:trueforge
```

Passes only when the catalogs are populated **and** both providers are configured, reported as
`TRUEFORGE_READY`. It asks TrueForge's own settings API rather than guessing from environment
variables, which is the only surface that sees credentials entered through the UI.

### What the smoke check does not prove

It establishes that stored configuration exists. **It does not establish that any credential
works.** Only a live model turn and a live sandbox execution do that. Both are proven separately:

| Link | Evidence | Record |
|---|---|---|
| TrueForge boots | `/healthz` returns the plain-text body `OK!` | [`SUBSTRATE_RUN_LOG`](docs/freezes/SUBSTRATE_RUN_LOG_2026-08-26.md) |
| A model completes a turn | `state.status: done`, 106 ms, Haiku 4.5 | same |
| A real MCP tool executes | `tool_info.type: mcp`, server `deepwiki`, matching `tool.response` | same |
| Code runs in Daytona | `sandbox.created`, `truefoundry-system/exec`, `exitCode: 0`, `result: "323\n"` | [`LINK4_STOCK_DELTA`](docs/freezes/HACKATHON_SUBSTRATE_LINK4_STOCK_DELTA_KAIROS_2026-08-26.md) + [raw run](docs/freezes/link4-stock-run-artifact.txt) |

All four were measured against **unmodified TrueForge 0.1.4**. No compatibility patch is shipped
or required.

> **Read the Daytona row against the run log, because they disagree and the disagreement is the
> point.** [`SUBSTRATE_RUN_LOG_2026-08-26.md`](docs/freezes/SUBSTRATE_RUN_LOG_2026-08-26.md)
> records link 4 as **BLOCKED**, and it was, at the time it was written: TrueForge returned
> `422 "Daytona rejected the API key"` against a key that could create and delete sandboxes.
>
> The cause was that the key lacked Daytona's separate `write:snapshots` permission, which
> TrueForge 0.1.4 reports as an invalid key. Filed upstream as
> [#461](https://github.com/truefoundry/trueforge/issues/461). A correctly scoped key was issued
> and the link was proven on stock TrueForge afterwards.
>
> **The earlier log is not edited.** It is a frozen record of what was true when it was written,
> superseded by a later delta rather than rewritten. The raw run output is committed verbatim at
> `docs/freezes/link4-stock-run-artifact.txt`, SHA-256 `c2e535fa…`, and carries the session id,
> turn id, sandbox id, tool call, and `exitCode: 0`.

## Build discipline

The project follows:

`rubric → threat model → invariants → frozen interfaces → smallest vertical slice → adversarial break → correction → Qodo trail → integration → demo → story`

Every substantive change is developed on a branch and reviewed in a GitHub pull request before a human merge.

## Qodo Code Review Evidence

**Merged pull request:** [#1 — Infrastructure vertical slice](https://github.com/keniel13-ui/self-correcting-integration-maintainer/pull/1), merged as `29ac06f`.

**Six review cycles. Thirteen findings. All resolved, with a final review on the merged bytes (`121a24f`).**

The pull request shipped **defective on purpose and said so on its face.** Four defects were frozen and hashed in [`docs/freezes/`](docs/freezes/) *before* the PR opened, and the PR body documented them with a reproduction command. The reasoning is in the PR: a review trail that runs against code we had already quietly fixed proves nothing about the reviewer.

### What Qodo found, and what we did

| # | Finding | Response |
|---|---|---|
| 1 | Configuration bypasses readiness verdict | Verdict is now an enumerated deciding-field list. Confirmed our frozen D1 |
| 2 | Model check cannot fail | Removed a disjunction with no false case; raw observations replace a derived label |
| 3 | Missing packages crash verifier | `resolvePackage` makes resolution itself the checked operation |
| 4 | Empty catalogs report success | `Boolean([])` replaced with counted entries |
| 5 | Verdict paths remain untested | The deciding scripts now run in-process under test |
| 6 | Smoke requests lack timeout | `AbortSignal.timeout` on every request |
| 7 | Stale receipt bypasses verification | Receipt is re-derived and the world re-observed; status is never read |
| 8 | Invalid timeout crashes smoke | `parseTimeout` falls back instead of throwing `RangeError` |
| 9 | Health contract matched loosely | Exact match on the measured contract |
| 10 | Tests delete real receipt | Artifact path overridable; tests run in a temp dir |
| 11 | UI configuration is rejected | Credentials left the local verdict; authority moved to TrueForge's settings API |
| 12 | Mutable fields bypass receipt gate | Canonical field list is a frozen constant; a receipt cannot supply the terms of its own validation |
| 13 | Empty provider list passes | Counted verdict extracted to its own module with its own tests |

**Four of these corroborated defects we had already frozen. Nine were ours to learn.**

Three of them — #4, #12, #13 — are the same defect: **absence reading as a pass.** The third was written while repairing the second. That is recorded in the commit history rather than smoothed over, because it is the most useful thing in this repository.

One commit also **withdraws a false claim we published** about an upstream dependency. See [`docs/freezes/CORRECTION_HONO_DIAGNOSIS_2026-08-26.md`](docs/freezes/). It was found by a teammate who had been assigned to file the upstream issue, ran the check, and refused.

**Tests: 4 → 47** across the pull request.

## Evidence ceiling

Green local tests are maker evidence. They do not prove an intelligent recovery, a secure authority boundary, a safe promotion pipeline, or an independently verified result.

## License

MIT

