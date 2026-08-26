# HACKATHON SCAFFOLD — PREREQ VERIFIER DEFECT, FROZEN BEFORE REPAIR

**Frozen 2026-08-25. Immutable. Do not rewrite retroactively.**

Purpose: preserve the scaffold's defects exactly as they exist at the moment of finding, so that
repairing them later cannot make the failure hypothetical.

**Found by:** Ka'el, during pre-PR review of the hackathon scaffold, before PR #1 was opened.
**Status:** `MAKER-SIDE BLOCK / NOT A BREAKER VERDICT / REPAIR NOT YET AUTHORED`

**Role disclosure, on the face of this document as the method doctrine requires:**
The code being frozen here **already existed** when this document was written. This is *not* a
contract-before-code artifact and does not claim that provenance. It is a finding record.
The seat that authored the scaffold cannot be determined from git alone — the single commit
`chore: initialize hackathon repository` carries Keniel's git identity, which every agent seat in
this workspace commits under. If Ka'el authored it, this is a maker's BLOCK, which is admissible
because it is self-incriminating. It is not, and may not become, a PASS.

---

## 1. State at time of finding

Repo: `keniel13-ui/self-correcting-integration-maintainer` (public)
Branch: `infra/trueforge-vertical-slice`
`origin/main` at time of finding: three files only (`.gitignore`, `.nvmrc`, `LICENSE`)
**None of the defective code was on `origin/main`.** All of it was uncommitted and staged for PR #1.

| File | SHA-256 (first 16) |
|---|---|
| `scripts/verify-prereqs.mjs` | `1988fa56f804bee0` |
| `scripts/prerequisites.mjs` | `fca5eb6939147ec5` |
| `scripts/smoke-trueforge.mjs` | `cb01e7cc09428de2` |
| `test/prerequisites.test.mjs` | `1ee4a28ddf26ab26` |
| `package.json` | `6070ef5cb5a8deaf` |

**Test state at time of finding: 4 passed, 0 failed** (`node --test`). Recorded as evidence about
**test adequacy**, not about implementation correctness.

---

## 2. D1 — CONFIRMED BY EXECUTION. The verdict excludes the field it prints.

`scripts/verify-prereqs.mjs:38`

```js
const ok = report.node.ok && Object.values(report.packages).every(Boolean);
```

`report.external_configuration` is computed, serialized, printed — and **never enters `ok`**.

Reproduction, run with every model and sandbox key removed from the environment:

```
$ env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GOOGLE_API_KEY \
      -u GEMINI_API_KEY -u DAYTONA_API_KEY node scripts/verify-prereqs.mjs
{
  "status": "READY_LOCAL",
  ...
  "external_configuration": {
    "model": "missing_or_configured_in_trueforge_ui",
    "daytona": "missing"
  }
}
EXIT CODE: 0
```

**The verdict and the report contradict each other in the same output.** `status: READY_LOCAL`
sits four lines above `daytona: "missing"`. The process exits 0. Any caller that consumes the exit
code — a CI step, a Makefile, a pre-flight guard — is told the environment is ready when the
sandbox credential does not exist.

This is the identical defect published on 2026-08-24 in *The Tests Passed. The Contract Was Wrong.*
and identified in `claim_24/evaluator.py`: **a classification computed, displayed, and excluded
from the verdict, in a run that exits 0.** Different language, different repo, same disease,
found before it shipped rather than three months after.

## 3. D2 — A value with no false case.

`scripts/verify-prereqs.mjs:26–33`

```js
model: [...].some(name => presence(process.env[name]) === 'present')
  ? 'present'
  : 'missing_or_configured_in_trueforge_ui',
```

`'missing_or_configured_in_trueforge_ui'` is a **disjunction whose second branch is unfalsifiable
from inside the script.** "Either the key is absent, or it is configured somewhere I cannot see."
No observation available to this program can distinguish those two states, so the value can never
indicate failure.

**A check that cannot fail is not a check.** It is a request, in the sense the method doctrine
already defines: enforcement that depends on a reader choosing to interpret an ambiguous string.

## 4. D3 — `catalogs_reached` cannot distinguish content from emptiness.

`scripts/smoke-trueforge.mjs:27–31`

```js
catalogs_reached: {
  model_providers: Boolean(catalogs[0]),
  mcp_servers: Boolean(catalogs[1]),
  sandbox_providers: Boolean(catalogs[2]),
},
```

`readJson` already throws on any non-2xx response, so reaching this line means each fetch
succeeded. `Boolean()` applied to an already-successful parsed body is therefore true for `[]`,
for `{}`, and for a catalog containing twelve providers alike.

A catalog that returns an empty array reports `model_providers: true`. **Absence reads as
presence**, which is the failure mode under active discussion with pm25coder on DEV thread
`3dgpd` at the time of this finding.

**Mitigating, and it should be said:** this file carries an explicit `ceiling` field stating that
reachability does not prove a model call, MCP tool call, or sandbox execution. That is correct
K5 evidence-ladder discipline and it is the strongest thing in the scaffold. D3 is a defect in the
field's *name and construction*, not in the honesty of the file's stated scope.

## 5. D4 — The passing tests do not touch the defective file.

`test/prerequisites.test.mjs` — 4 tests, all passing.

They exercise `parseNodeVersion`, `nodeMeetsMinimum`, and `presence`: three pure functions in
`prerequisites.mjs`. **No test imports, invokes, or asserts anything about `verify-prereqs.mjs`,**
where D1 and D2 live. The `ok` computation on line 38 has zero coverage.

And the fourth test:

```js
test('reports configuration presence without exposing values', () => {
  assert.equal(presence('secret'), 'present');
```

certifies that the derived label is produced correctly. It does not ask whether a derived label
should be the thing the verdict consumes. **It locks in the pattern ANP2's June constraint exists
to prevent** — a conclusion stored in place of the raw, recomputable evidence.

---

## 6. The finding, stated at the right level

The scaffold's checks **report**. None of them **control**.

| | Where the verdict comes from |
|---|---|
| `verify-prereqs.mjs` | two of three computed fields; the third is printed and ignored |
| `smoke-trueforge.mjs` | a boolean that is true whenever the fetch did not throw |
| `test/` | three pure functions, none of them the ones that decide |

A green `READY_LOCAL` with no sandbox key is not a bug in a helper script. It is the project's
own central claim failing on its own first artifact: **liveness is not usefulness**, and a
component that reports success while producing nothing is the exact failure this work exists to
catch.

## 7. Required invariant for the repair

> Every field the verifier computes MUST either enter the verdict or be removed. A field that is
> printed and excluded from `ok` is prohibited. Where a required credential cannot be observed
> from inside the script, the verifier MUST report that it could not observe it and MUST NOT emit
> a ready status — ambiguity resolves to BLOCKED, never to READY.

And, following the pm25coder exchange:

> The verifier's readiness signal MUST be consumed by whatever runs next, such that an absent or
> blocked verdict makes the next stage impossible rather than merely observable. A nonzero exit
> that nothing reads relocates the silence; it does not end it.

## 8. Disposition

- **Ka'el found these. Ka'el does not repair them and does not clear them.**
- Repair goes to the implementer seat (Kairos / Codex).
- The controlling verdict goes to a seat that neither wrote the scaffold nor wrote the repair.
- **Qodo's review of PR #1 is a third record neither seat controls** and is the reason PR #1
  should carry this code *with the defects intact and disclosed*, rather than silently fixed
  first. A repair pushed before Qodo ever sees the original erases the evidence that the review
  trail found anything.

**Recommended PR #1 shape:** ship the scaffold as-is, link this freeze in the PR body, and let
Qodo review code we have already publicly documented as defective. If Qodo finds D1 independently,
that is a real receipt. If it does not, that is also information, and it is better learned on a
scaffold than on the agent.

`FOUND BEFORE FIRST PR / FROZEN BEFORE REPAIR / BREAKER PENDING`
