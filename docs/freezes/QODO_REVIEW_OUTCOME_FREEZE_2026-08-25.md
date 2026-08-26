# QODO REVIEW OUTCOME — PR #1, FROZEN BEFORE REPAIR

**Frozen 2026-08-25. Immutable. Do not rewrite retroactively.**

Companion to `HACKATHON_PREREQ_VERIFIER_DEFECT_FREEZE_2026-08-25.md` (`9e0fb801`), which was
written and committed **before** this review ran. That prior freeze is not edited by this
document. This one records what an independent reader found against it.

**Reviewed commit:** `35e3a82`, branch `pr1/infrastructure-vertical-slice`
**Reviewer:** `qodo-code-review[bot]`, triggered by `/agentic_review` on PR #1
**Result:** 6 bugs, 0 rule violations, 0 skill insights

---

## 1. Why this review is admissible

Qodo wrote none of this code and read none of our internal artifacts. It is the first verdict in
this project's history issued by something that is neither maker, briefer, nor breaker-by-
arrangement. Its findings are admissible in a way no seat here can currently produce:

- Ka'el found D1–D4 and is disqualified from certifying their repair.
- The implementer seat is disqualified by authorship.
- Aethar is at his weekly limit.

**Qodo is not a substitute for a breaker verdict on the repair.** It reviewed the *defective*
version. A follow-up review on the final bytes is required and has not run.

## 2. Corroboration — four of six

| Qodo finding | Pre-registered as | Status |
|---|---|---|
| #1 Configuration bypasses readiness verdict | D1 | corroborated |
| #2 Model check cannot fail | D2 | corroborated |
| #4 Empty catalogs report success | D3 | corroborated |
| #5 Verdict paths remain untested | D4 | corroborated |

Per the known-before-new gate these are `CONFIRMS_KNOWN`, not news. They are recorded because
corroboration by a reader who could not see the freeze establishes that the freeze described the
code accurately — which is a claim about our record, and worth having.

## 3. Novel — two of six

**#3 — Missing packages crash the verifier.** `require.resolve()` at lines 12–13 executes before
`packageIsInstalled()`. An absent dependency throws `MODULE_NOT_FOUND` instead of producing the
intended `BLOCKED_LOCAL` report. **Not in the freeze. Genuinely new.**

**#6 — Smoke requests lack a deadline.** `readJson()` calls `fetch()` with no `AbortSignal`. A
server that accepts a connection and never completes its response stalls the check indefinitely.
Affects the health request and all three concurrent catalog requests. **Not in the freeze.
Genuinely new.**

## 4. D5 — escalation of #3, found by Ka'el while verifying it

Qodo frames #3 as reliability. The consequence is correctness, and it is larger.

Confirmed by execution:

```
$ node -e "createRequire('file:///tmp/').resolve('@truefoundry/trueforge/package.json')"
THREW: MODULE_NOT_FOUND
```

Because `require.resolve` throws on absence, line 22 can never receive a nonexistent path.
`packageIsInstalled()` is handed a path whose existence was already proven. **Its false branch is
unreachable in this call graph.**

Therefore line 38:

```js
const ok = report.node.ok && Object.values(report.packages).every(Boolean);
```

has a second conjunct that is a **tautology**. The effective verdict is `ok = report.node.ok`.

With D1 also removing `external_configuration` from the verdict, a script reporting on three
domains has exactly **one** field able to produce `BLOCKED_LOCAL`: the Node version.

**This is a wrong-reason pass in the doctrine's exact sense.** The package check returns the
expected answer for a reason unrelated to whether packages are installed. It looks correct because
its failure path cannot be reached. Method doctrine rule 1 applies: record the observed reason,
not the verdict.

## 5. Consequence for the repair

A verdict assembled from conjuncts where one is structurally unfalsifiable **cannot report which
conjunct did the work.** Patching six comments individually preserves that property.

The repair must split the single claim along the evidence ladder so each stage has exactly one
falsifiable source:

- `LOCAL_PREREQS_OK` — Node version and package resolution, bounded to what this process can
  observe. **Resolution becomes the checked operation, never a precondition of the check.**
- `LIVE_CONFIGURATION` — interrogates the running harness; reports `endpoint_reached`,
  `response_shape`, and `entry_count` as separate observations rather than one boolean.
- `LIVE_VERTICAL_SLICE_VERIFIED` — model turn, real MCP tool call, Daytona execution, result
  returned through TrueForge. **Emitted as an artifact the next stage structurally requires**, not
  a status a reader must consult.

The third bullet carries the constraint from the pm25coder exchange on DEV thread `3dgpd`: a
verdict nobody consumes is as quiet as a field nobody reads. Making failure louder relocates the
silence; requiring the receipt ends it.

## 6. Status

`6 QODO THREADS OPEN / NONE RESOLVED / REPAIR NOT AUTHORED / NOT MERGEABLE`

Threads stay open until the repair lands in this same PR and a follow-up review runs on the final
bytes. The chronology — defective version, review, findings, repair, re-review — is itself the
evidence and must not be squashed.

**Tally at freeze time: 4 pre-registered defects independently corroborated, 2 novel defects found
by third-party review, 1 escalation found while verifying one of the novel two.**
