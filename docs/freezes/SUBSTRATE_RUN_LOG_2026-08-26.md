# SUBSTRATE RUN LOG — 2026-08-25/26

**Frozen 2026-08-26. Immutable.** Session PHASE 1241–1256.
Repo: `keniel13-ui/self-correcting-integration-maintainer` (public)
PR #1: https://github.com/keniel13-ui/self-correcting-integration-maintainer/pull/1

---

## 1. Where the night started

Nothing existed on GitHub. No repo, no PR, no review, no substrate. Four blockers were open, all
human-only: registration, Qodo, a Daytona key, a model key.

## 2. Credentials

| Item | Result |
|---|---|
| Anthropic Console balance | **$17.67 already funded.** No purchase was needed. Ka'el inferred a purchase from an absent key instead of asking Keniel to read the balance. Corrected. |
| Model key, first attempt | **BURNED.** Pasted into the chat window, therefore into the session transcript on disk and into every subsequent API request. Revoked and replaced. |
| Model key, second attempt | Set via `read -s` into `~/.zshrc`. **Never on screen, never in `~/.zsh_history`, never in this transcript.** Verified: 108 chars, `sk-ant-` prefix. |
| Daytona key | 68 chars, `dtn_` prefix. $200 free compute. |
| Storage | `~/.zshrc`, plaintext. Kairos's correction stands: outside the repo prevents Git leakage, one path only. It is not a vault. Acceptable for a bounded week. |

## 3. Repo and PR

Repo created public by Kairos. `main` initialised twice — two root commits, **identical tree hash
`afc575d4`** — so the scaffold branch had no shared history and GitHub refused the PR. Resolved by
replaying the scaffold commit onto `main` as `pr1/infrastructure-vertical-slice`. The orphan branch
`infra/trueforge-vertical-slice` remains on the remote, content fully preserved elsewhere, left
undeleted because another seat was live in the repo.

## 4. Defects found, in order

### Pre-review, by Ka'el — frozen at `9e0fb801` before PR #1 opened

- **D1** `verify-prereqs.mjs:38` computed the verdict from two of three reported fields. With every
  key stripped it printed `status: READY_LOCAL` alongside `daytona: "missing"` and **exited 0.**
- **D2** `'missing_or_configured_in_trueforge_ui'` — a disjunction with no false case.
- **D3** `Boolean(catalogs[i])` true for `[]` and `{}`.
- **D4** 4 tests passed; none imported the file containing D1.

### Qodo, first review of `35e3a82` — 6 findings

Four corroborated D1–D4 independently. Two were new:
- **Q3** `require.resolve()` threw before the package check could report.
- **Q6** `fetch()` had no deadline.

### Ka'el, escalating Q3 — **D5**

`require.resolve` throws on absence, so `packageIsInstalled()` was always handed a path that
existed. **Its false branch was unreachable**, making `Object.values(report.packages).every(Boolean)`
a tautology and leaving the Node version as the only field able to block. A wrong-reason pass.

### Qodo, second review of `01de9f4` — 4 findings

- **R1** credentials still excluded from every verdict
- **R2** the deciding scripts still had no end-to-end coverage
- **R3** `AbortSignal.timeout(NaN)` throws `RangeError`
- **R4** **introduced by Ka'el's own repair.** The artifact gate replaced a status someone reads
  with a receipt nothing re-derived: no timestamp, no binding. Confirmed by hand-editing the
  receipt to claim Node `v0.0.1` and watching the next stage accept it. **The D1 disease, one
  level over, created while fixing D1.**

### Live substrate — found by running, not reading

- **S1** TrueForge would not boot. `@hono/swagger-ui@0.2.2` hoists to root and declares `hono` as a
  peer with no bundled copy; `hono@4.13.4` resolved nested under `@truefoundry/trueforge`.
  **Upstream packaging bug in TrueForge 0.1.4.** Fixed by pinning `hono@4.13.4` at root.
- **S2** The smoke check had never been run against a live harness and **encoded a contract that
  does not exist**. It called `response.json()` on `/healthz` and asserted `status === 'ok'`.
  The real endpoint returns plain text `OK!`. That assertion could never have passed.

**Total: 7 defects pre-registered or escalated by Ka'el, 8 by Qodo, 2 found only by execution.
None reached `main`.**

## 5. Substrate result

| Link | Result | Evidence |
|---|---|---|
| 1. TrueForge boots | **PROVEN** | `/healthz` → `OK!` in ~18–30s cold. 9 model providers, 14 MCP servers, 1 sandbox provider. |
| 2. Claude turn | **PROVEN** | `state.status: done`, output `"SUBSTRATE OK"`, 106 ms. |
| 3. Real MCP tool call | **PROVEN** | `tool_calls[0].tool_info.type === "mcp"`, server `deepwiki`, tool `read_wiki_structure`, call id `toolu_01Cadky…`, matching `tool.response` carrying 1195 bytes of real remote content. |
| 4. Daytona execution | **BLOCKED — cause corrected below** | |

### Measured cost, not estimated

| | link 2 | link 3 |
|---|---|---|
| harness tokens | 1,289 | 1,844 |
| tool_definitions | 0 | **85** |
| input / output | 1,842 / 6 | 2,611 / 65 |
| cost | $0.0019 | $0.006 |

**`cache_read: 0, cache_write: 0` — prompt caching is NOT active.** Ka'el flagged this as the
biggest unverified lever in the $10–14 estimate. It is now verified as false, and the estimate
survives anyway because real context is far smaller than modelled. **~$0.30 per 25-call agent run
on Haiku 4.5; $17.67 buys roughly 58 runs.**

**Total spend across all three proven links: under 2 cents.**

## 6. Link 4 — the corrected diagnosis

Kairos reported: *"Daytona rejected the API key. Your only action: create a fresh Daytona API key."*

**That diagnosis is wrong and the action would not have fixed anything.** Verified directly against
Daytona, bypassing TrueForge:

```
GET  https://app.daytona.io/api/sandbox   -> 200  {"items":[],"nextCursor":null}
POST https://app.daytona.io/api/sandbox   -> 200  sandbox ad6f79da-… created
DELETE .../ad6f79da-…?force=true          -> 200  cleaned up, 0 remaining
```

**The key is valid and can create sandboxes — the actual capability.** It fails only on:

```
GET /api/users/me      -> 401 Invalid credentials
GET /api/organizations -> 401 Invalid credentials
```

Those are **user-session endpoints that an API key is not supposed to reach.**

TrueForge's `PUT /api/v1/settings/sandbox-providers` returns
`422 "Daytona rejected the API key — check the credentials"`. Reproduced with a schema-correct
manifest, so it is not a request-shape problem.

**Conclusion: TrueForge validates a Daytona API key against a user-scoped endpoint, so a valid key
fails validation, and the error message names the wrong party.** Second upstream bug in TrueForge
0.1.4, and thematically the same defect this whole project studies: **a check that reports a
failure for a reason unrelated to the thing being checked.**

**Keniel does not need a new Daytona key.**

## 7. State at freeze

- PR #1 open, three repair rounds committed, `main` still clean
- Qodo installed and reviewing; two reviews delivered, third triggered on `5f61196`
- 32 tests passing, up from 4
- Links 1–3 proven, link 4 blocked upstream
- Registration complete
- Zero keys in the repo, zero in the video path, zero sandboxes accruing

## 8. Open

1. Link 4 — needs a TrueForge-side workaround, not a key rotation.
2. Both upstream bugs (S1 `hono` peer, the Daytona validation) are worth reporting to TrueFoundry.
3. **The agent itself does not exist.** Everything above is floor.

`SUBSTRATE 3/4 PROVEN / LINK 4 BLOCKED UPSTREAM / AGENT NOT STARTED`
