# Contract — pre-model gate must not emit model-evaluation names

**Maker: Ka'el / Claude. Written 2026-09-16, PHASE 1819, BEFORE any code for this change.**
**Breaker required before this may be reported as passing: a seat that is not Ka'el.**
Per method doctrine a maker's BLOCK is admissible and a maker's PASS is worthless. Everything below
that reads as a finding is a maker BLOCK. Nothing below is a PASS until an independent seat runs it.

**Provenance disclosure, required by rule 3:** no implementation code for this change existed when
this contract was written. The *finding* was established first, by probe, and is recorded below with
its reproduction. `EXEC_EXPECTATION_INVALID` already exists in the tree from B9 (`872507f`); this
contract does not claim to have introduced that name.

---

## The finding

`inspectPreparedTransport` (`scripts/judgment/live.mjs:107-171`) runs **strictly before the model is
invoked**, and when my own expected object is malformed it emits **`EXEC_ARGUMENTS_MISMATCH`** — a
name asserting that the arguments deviated.

At that point no model has run, no arguments have arrived, and there is no arriving side to deviate.

**Ordering, read from source:**

| Line | What happens |
|---:|---|
| `607` | `inspectPreparedTransport(prepared)` → its failures become `preflight` |
| `214` | `assertPreparedTransport(prepared)` inside `createRelaySession` |
| `224` | the instruction string carrying `JSON.stringify(expectedArguments)` is built |
| `242` | `assertPreparedTransport(prepared)` again, second client path |
| `616-620` | on `preflight.length > 0` → `reduceCandidateVerification({ events: [], turnStatus: 'preflight_blocked', preflight, … })` |

So a run that **never contacted a model** produces a receipt whose `failure_reasons` contain a
model-deviation name, alongside `events: []`.

**Reproduction, run 2026-09-16, output pasted unedited:**

```js
inspectPreparedTransport({
  expectedExecArguments: { command: 'node verify.js' },   // missing `intent` — MY setup bug
  commandManifest: { transport: { exec_arguments_sha256: 'x'.repeat(64) } },
  outboundArtifacts: {},
})
// -> ["OUTBOUND_ARTIFACT_CARDINALITY_INVALID","EXEC_ARGUMENTS_MISMATCH"]
```

`OUTBOUND_ARTIFACT_CARDINALITY_INVALID` is expected noise from a minimal fixture with no artifacts
and is printed rather than filtered. `EXEC_ARGUMENTS_MISMATCH` is the defect.

**This is strictly worse than the defect already published.** In the published case the model had
run and *could* have been at fault, so the name was misleading. Here the model **cannot** be at
fault, because it does not yet exist in the run. The name is not merely ambiguous; it is
structurally impossible.

## Why this is what four engineers asked for, not a new idea

| Who | What they said | How it lands here |
|---|---|---|
| **anassBld** `3eb86` (B2) | preflight the expected object before the model runs and *"fail with a harness-configuration error, not a model deviation"* | The gate exists and is correctly positioned. **The position was never the gap — the namespace is.** |
| **Vinh Nguyen** `3f06i` (B9) | canonicalizing the expected side separately identifies which operand failed | Same shared-`try` shape survives at `live.mjs:159-166`: the canonicalize of *my* object and the manifest digest **read** share one catch |
| **naw103** `3eahb` (B7) | a run incapable of producing evidence should be marked as such, *"instead of resolving against the subject by default"* | `preflight_blocked` with `events: []` is exactly such a run, and it currently resolves against the model by default |
| **pm25coder** `3eanf` / `3ei6m` (B1) | *"a subject-less name defaults to whoever is under evaluation"* | The general law. This site is its sharpest instance. |

**Correction to my own earlier statement to Keniel:** I told him B2 was a missing gate and that the
slot was empty except for the wrong check. That was wrong. The gate is present, is called on both
client paths, and runs before the prompt is built. What is absent is a **setup-scoped failure
namespace**. I had the diagnosis one layer off.

---

## Rows — frozen. No row moves after the hash below is recorded.

Target: `inspectPreparedTransport` in `scripts/judgment/live.mjs` only.

| # | Input, all pre-model | Required name | Fails on HEAD? |
|---|---|---|---|
| **R1** | my expected object malformed — missing `intent`, wrong key set, non-string or empty `command`, wrong intent value | `EXEC_EXPECTATION_INVALID` | **yes** — HEAD emits `EXEC_ARGUMENTS_MISMATCH` |
| **R2** | expected object well-formed, but my manifest digest disagrees with the canonical bytes of my own expected object | `EXEC_EXPECTATION_INVALID` | **yes** — HEAD emits `EXEC_ARGUMENTS_MISMATCH`. Both operands are mine; neither is the model's |
| **R3** | `canonicalJsonBytes` throws on **my** expected object (e.g. a `BigInt`) | `EXEC_EXPECTATION_INVALID` | **yes** — HEAD emits `EXEC_COMPARATOR_ERROR`, the same shared-`try` collapse B9 fixed elsewhere |
| **R4** | the manifest digest **property read** throws (throwing getter on `transport.exec_arguments_sha256`) | `EXEC_COMPARATOR_ERROR` | **no** — must be preserved. A genuine machinery failure, distinct from R3 |
| **R5** | `command` over 256 bytes | `EXEC_COMMAND_OVERSIZE` | **no** — unchanged, descriptive not subject-attributing |
| **R6** *(control)* | a valid `prepared` fixture | `[]` | **no** — must stay green. If a rename swallows the healthy path this is the row that catches it |
| **R7** *(control)* | tampered outbound artifact | `OUTBOUND_ARTIFACT_HASH_MISMATCH` | **no** — must stay green and keep its own name |

**R4 is the row that makes R3 mean something.** Without it, collapsing everything to
`EXEC_EXPECTATION_INVALID` would satisfy R1-R3 while destroying the ability to report a real
comparator fault — and a suite asserting only the new name would stay green while doing it.
**R6 and R7 are the rows that can fail in the flattering direction.** A change that rejects
everything passes R1-R5 and fails R6-R7.

## Explicitly excluded, and why

- **B8** — `argumentKeys.length !== 2` hardcodes the provider's required set and the harness's
  narrower policy in one number. Deriving required fields from a live schema is a **behaviour**
  change and belongs in its own commit. Vinh, Pushpendra and quashudev reported it independently.
  Bundling it here would put a behaviour change in a commit that claims to be about names — the
  same objection the B1 article made about the registry refactor.
- **B7 proper** — a distinct not-a-finding *outcome class* that drops such runs out of
  model-behaviour counts. This contract only stops the run from being **named against** the model.
  It does not add the outcome class or change any count.
- **The two allowlists** — `FAILURE_ORDER` exists twice, 27 codes and 21, one silently dropping
  unregistered names and one throwing. Still unmerged. `EXEC_EXPECTATION_INVALID` is already in
  both, so this change does not depend on that work.

## What this will NOT establish

1. It will not prove **who** produced a bad expectation — only that the expectation, not the model,
   is what failed. The name stays subject-scoped to the setup, not to a person.
2. It will not distinguish **invalid fixture data** from **a defect in the canonicalizer**. Stage,
   operand and root cause remain three questions; this answers stage and operand. (Kairos's
   precision, carried forward from the B9 reconciliation.)
3. It will not implement `args_mismatch_under_contract=<id>`. The names still carry no contract id,
   so pm25coder's fuller point remains half-addressed.
4. It will not have been verified. **Maker fixture only is rung one of four** — maker fixture →
   independent breaker fixture → operator provisioning → live supervised run. No live harness run is
   performed here.

## Method commitments for the implementation

- **No assertion written from observed output.** Each row's expected name is fixed in the table
  above, before the code. If an implementation produces something else, the implementation is wrong,
  not the row.
- **Ablation must run against HEAD**, and the expected result is stated in advance: R1, R2, R3 fail
  on HEAD; R4, R5, R6, R7 pass on HEAD. Any other split means this contract mis-describes the tree.
- **Observed reason recorded for every blocked row**, not just the verdict, so a wrong-reason pass
  is detectable.
- Nothing is pushed without Keniel's word.

---

## Freeze

Rows R1-R7, the exclusions, and the four non-establishments above are frozen as of the hash
recorded in `CONTRACT_B2_HASH.txt` alongside this file.

— Ka'el / Claude, PHASE 1819. **I AM**

---

## Amendment 1 — R3's example input was wrong. Row unchanged. Disclosed, 2026-09-16T02:06Z.

The frozen table illustrates R3 with *"e.g. a `BigInt`"*. **That input cannot reach R3 at this
site,** and I established that by probe rather than by reading:

| Input | Reaches the `try`? | `canonicalJsonBytes` |
|---|---|---|
| `{command:'node v.js', intent:<correct>}` | yes | canonicalizes OK |
| `command` containing a lone surrogate `\uD800` | yes | canonicalizes OK |
| **`command` in decomposed form (NFD)** | **yes** | **THROWS `INVALID_JSON: string is not NFC`** |
| throwing getter on `command` | **no** — the gate itself throws | n/a |

A `BigInt` in `intent` fails `intent !== CANDIDATE_VERIFICATION_INTENT`, and a `BigInt` in `command`
fails `typeof command !== 'string'`. Either way the key/intent branch catches it first and R3 is
never entered. **The example I wrote was unreachable.**

**R3's required name is unchanged: `EXEC_EXPECTATION_INVALID`.** Only the illustrative input is
corrected, to: **a `command` string in decomposed (NFD) Unicode form.**

That input is not contrived. macOS filesystems hand out NFD paths by default, so a fixture command
referencing a file with an accented character — copied from Finder — throws here today and is
reported as `EXEC_COMPARATOR_ERROR`, i.e. *my comparator broke*, when the truth is *my fixture string
is not normalized.* R3 is the most realistic row in the table, not the least.

## Observation logged, deliberately NOT given a row

`live.mjs:148-149` reads `prepared?.expectedExecArguments` and `.command` **outside any `try`**. A
throwing getter there makes `inspectPreparedTransport` **throw instead of returning a failure list**,
which is a different defect class (unhandled exit from a function whose contract is to return
reasons) and is genuinely contrived as an input. Recorded here so it is not lost; excluded from this
change so the commit stays about names.
