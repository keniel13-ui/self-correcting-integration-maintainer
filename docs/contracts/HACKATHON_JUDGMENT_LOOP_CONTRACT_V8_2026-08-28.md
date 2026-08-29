# Judgment Loop Contract V8 — output-envelope control after Run 003

**Authored:** 2026-08-28, Ka'el / Claude, PHASE 1262 (contract-author seat)
**Amends:** V5 `4329137b…` / V6 `a4956db0…` / V7 `e008a440…` — **all preserved unedited.** V8 adds
one clause area. No existing clause is relaxed.
**Forced by:** Run 003, `SCAN_DID_NOT_COMPLETE / INVALID_JSON: unexpected token at 0`, 21:03:30 EDT
**Status:** `FROZEN ON HASH / AWAITING OWNER ADOPTION / RUN_004_NOT_AUTHORIZED`

---

## V8.0 — What Run 003 proved, and it is not all bad news

**Every control built under V5/V6 passed on a live run.** The runtime preflight verified six stock
source hashes and both package versions before a paid token; the returned session config byte-matched
the minimized request; the persisted-event gate established one clock call of exactly the admitted
shape with an empty-string argument and one matching response. **The run reached
`validateAgentResponse` — meaning every new gate held on real traffic.**

**The agent is also now consistent across three runs.** Run 002 and Run 003 independently produced
the same finding — `absence reads as a pass` in `release.mjs`, exact bytes, bounded repair — and both
times self-classified **`CONFIRMS_KNOWN` / `K1`**. Run 003's prose additionally observed a second
condition in `forms.mjs` (exit code and stdout report decoupled) which it did **not** promote to a
finding. That restraint is recorded as observed behaviour, not credited as a result.

## V8.1 — 🔴 THE FINDING: `response_format` is accepted, stored, and does not control

Measured on Run 003, session `01m15gp3qhtre1ngb3306f4xhk`:

- the session's **stored** spec contains `"response_format": {"type": "json_object"}` — confirmed by
  reading it back from the API, not from our request
- the minimized config is stored exactly as declared
- **and the model returned 1,112 characters of prose followed by a ```` ```json ```` fence**

`toStructuredOutputSpec` maps `json_object` → `buildOutput` → `Output.json()`, and that output is
constructed alongside `convertTools(body.tools)` at the same call site
(`core/llm/VercelAILLM.js:931-933`). **Hypothesis, explicitly UNVERIFIED:** the AI SDK's structured
output does not compose with tool calling, so the presence of the unavoidable clock tool silently
disables enforcement. **We measured the effect. We have not proven the mechanism**, and no artifact
may state the mechanism as fact.

**This is the same defect class as the zero-tools failure:** we declared a control, the runtime
accepted the declaration, stored it, returned it on inspection — and nothing enforced it. Per
standing doctrine, **a declaration the runtime accepts but does not enforce is a request, not a
control.**

## V8.2 — J12 is a green test that proves nothing

`J12` asserts the outgoing request and the stored spec **contain** `response_format`. Both are true.
**It passed on the exact run that failed.**

It proves transmission, never enforcement. **A test that cannot fail when the control fails is not a
test of the control** — the identical pattern V5.10 identified in the old "requests no tools" test,
now recurring one layer up. J12 must be retitled to what it actually proves, and any successor
enforcement test must be observed **red** first.

## V8.3 — Ordered remedy, both branches pre-authorized

Kairos anticipated this at his PHASE 1467: *"I'm checking whether stock TrueForge can enforce
structured JSON mechanically; if it cannot, I'll implement the narrowest deterministic
single-envelope recovery and bind that recovery into evidence."* Run 003 answers the antecedent.
**Both branches are authorized here so no further contract round is required.**

**Branch A — attempt provider-level enforcement first.** Replace `{type:"json_object"}` with
`{type:"json_schema"}` carrying the closed `judgment_response/v1` schema, which routes to
`Output.object({schema})` rather than `Output.json()`. **One run maximum to decide it.** If the
returned content still fails `parseStrictJson` at index 0, Branch A is measured insufficient and is
abandoned — not retried.

**Branch B — bounded deterministic envelope recovery, only if Branch A fails.** Constraints, all
mandatory:

1. Recovery accepts **exactly one** ```` ```json ```` fenced block, or **exactly one** balanced
   top-level `{...}` object. **Two or more candidates fail closed.** No heuristics, no "first thing
   that parses," no prose stripping beyond the single envelope.
2. The extracted bytes are parsed by the **unchanged `parseStrictJson`** and the **unchanged** closed
   schema validator. **V8 relaxes nothing about what a valid judgment is.**
3. The artifact **must record** `output_envelope: "direct" | "recovered"`, the byte offset and length
   of the extracted region, and the SHA-256 of the **full raw response** alongside the extracted
   bytes. **A recovered run is not a compliant run and may never be reported as one.**
4. A test must be observed **red** before implementation, and must cover: two fences fail closed; a
   fence plus a stray brace fails closed; a compliant direct response records `"direct"`; the
   Run 002 and Run 003 captured raw outputs both record `"recovered"`.

**Barred in both branches:** raising `max_tokens`, changing `iteration_limit`, instructing the model
not to call the clock, relaxing the closed schema, or silently normalizing output.

## V8.4 — Public claim limits, added to V5.9

If the submitted run is recovered rather than direct, the demo and write-up must say so in the same
breath as the result. **Admissible framing:**

> The provider accepted our structured-output declaration, stored it, and returned it on inspection
> — and did not enforce it. We found that on a live run, kept the strict validator untouched, added
> a single-envelope recovery that fails closed on ambiguity, and recorded on every artifact whether
> the response was direct or recovered.

**Barred:** presenting a recovered run as compliant; claiming the provider enforces JSON; stating the
tools/structured-output incompatibility mechanism as established fact (**V8.1**).

## V8.5 — Roles and custody, unchanged

Ka'el authored V4–V8 and the successor prior; **he may not implement any of it and may not clear its
implementation.** Kairos implements against a verified V8 hash; capped until 2026-08-29 01:31. **Aethar
remains the independently assigned controlling breaker and is the only unspent seat**; §4.2 stays
`BREAKER_PENDING`.

Custody intact and re-verified after Run 003: `PRIOR_KNOWLEDGE.json` `d44b6e90…`;
`PRIOR_KNOWLEDGE_RUN_003.json` `04b4c700…`; V4 `2de5a4b0…`; V5 `4329137b…`; V6 `a4956db0…`;
V7 `e008a440…`. Run 003 wrote **no artifact** (`artifact_written: false`), so `docs/demo/runs/` does
not exist and no evidence was fabricated.

**Run 003 cost ≈ $0.011. Zero successful runs. Still zero.**

Until the owner adopts V8 by hash: no Run 004, no spend, no restart of PID 15275, no token-ceiling
raise, no in-place predecessor edit, no merge, no maker PASS.

`V8 FROZEN ON HASH / DECLARATION ≠ CONTROL / RUN_004_NOT_AUTHORIZED`

— Ka'el, PHASE 1262. I AM.
