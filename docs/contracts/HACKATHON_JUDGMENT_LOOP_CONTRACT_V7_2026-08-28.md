# Judgment Loop Contract V7 — minimal amendment to V5.4 (run identity only)

**Authored:** 2026-08-28, Ka'el / Claude, PHASE 1260 (contract-author seat)
**Amends:** V5 `4329137bdb74cb3c610f0fbb6819a93a82290634e2bb3d354625a68d73e32b8b` as already amended
by V6 `a4956db0c039c3387aa2cf5d67246e7ab47db8d3196ccaeb48fa398b8b9ac44a`. **Both preserved
unedited.** V7 replaces **one clause: V5.4.** Every other clause of V5 and V6 remains binding.
**Forced by:** Kairos maker BLOCK `66452c62f4a0c1fd591b4e1f7f72cb182dae17eb34c48327be4c038d2a34ffcc`
**Status:** `FROZEN ON HASH / AWAITING OWNER ADOPTION / RUN_003_NOT_AUTHORIZED`

---

## V7.0 — What V5.4 got wrong, and why it could not be quietly patched

V5.4 required a file named `PRIOR_KNOWLEDGE_RUN_002.json` to be frozen, hashed, and committed
**before Run 002**.

**Run 002 already happened** — 2026-08-28 15:20 EDT, under the preserved original prior, recorded in
`KAEL_RUN_002_DIAGNOSIS_2026-08-28.md`. No file created tonight can truthfully predate it.

Writing that file now, under that name, would manufacture pre-run provenance — which is the exact
property a pre-registration exists to prove, and the exact thing method doctrine rule 3 bars. Kairos
refused to create it and routed the conflict here instead of working around it. **That refusal was
correct and is the reason this amendment exists.**

I authored V5.4 on the assumption that Run 002 had not yet occurred. It had. That is a fourth
author-side error in this cycle, caught by the maker seat, and it is recorded here rather than
smoothed over.

## V7.1 — Replaces V5.4 in full

Run 003 requires a new, separately named **`PRIOR_KNOWLEDGE_RUN_003.json`**, frozen, hashed, and
committed **before Run 003**. It must:

1. **State on its face that Runs 001 and 002 preceded it.** It is a disclosed successor written
   after two live runs and after an infrastructure-contract failure. **It is not an original
   prediction and may never be presented as one.**
2. Cite by exact value: the predecessor prior
   `d44b6e906467eb1f9f31c5fb0e8f4e28efc81dd9ae6b90293cb2aff4b8949a02`, the Run 001 receipt
   `0bace916937ab458b91c16b84f393721b2f897f8366eb113b0bf9bd86f4c1f2c`, and the Run 002 diagnosis
   `61e6f33091a07f586cef3a3a8bfff710712eaab411c47b352f330807e021029a`.
3. Carry `known_conditions[]` forward **byte-for-byte by value** — all six of K1–K6, with no
   addition, rewording, removal, reordering of fields, or reclassification. **Changing what counts
   as known after two runs would retroactively alter what counts as NEW.**
4. Use `schema: "prior_knowledge/v2"`, whose `what_the_agent_is_given` is a **closed object** of
   exactly five hash fields and no prose. Prose belongs at top level where it cannot be mistaken for
   a bound input.
5. Bind the exact Run 003 inputs:
   - `instructions_sha256` — **note this value changed.** `SYSTEM_INSTRUCTIONS` now discloses the
     clock tool, so the old digest is dead and the new one must be bound.
   - `caller_tool_descriptions_sha256` and `runtime_tool_surface_sha256` — **must differ**, per V5.5
   - `runtime_tool_surface_manifest_sha256` — the v2 capability manifest
   - `corpus_manifest_sha256` — the unchanged corpus `914b22f5…`
6. Be frozen, hashed, and committed **before** Run 003 is executed.

The Run 001 prior's filename may not be reused and its recorded status may not be edited after
consumption. **`PRIOR_KNOWLEDGE.json` at `d44b6e90…` stays exactly as it is, permanently.**

## V7.2 — Nothing else moves

V5.0–V5.3 and V5.5–V5.11, and V6.0–V6.7, are **unchanged and in force**: provenance disclosure,
corrections C1/C2, the clock-only experiment framing, predecessor custody, dual tool-surface hashes,
the exact minimized config with unchanged token ceilings, the pre-turn gate, the V6.1 event
predicate, V6.3's captured-bytes validation rule, the disclosure standard, and the role bars.

V7 changes **run identity and provenance language only.** It reopens no settled clause and relaxes
no control.

## V7.3 — Roles, unchanged and now load-bearing

- **Ka'el** authored V4, V5, V6 and V7, and authors the successor prior. **He may not implement any
  of them and may not clear their implementation.**
- **Kairos** implemented V5.5–V5.8 and the V6.1 predicate; the offline suite is 34/34. **That is
  maker evidence, not a PASS.** He is capped until 2026-08-29 01:31.
- **Aethar remains the independently assigned controlling breaker.** §4.2 stays `BREAKER_PENDING`.
  **The owner considered reassigning Aethar to implementation when Kairos capped; the implementation
  was already complete and green, so that reassignment would have consumed the last independent seat
  for no work.** Aethar attacks the frozen head. Neither Ka'el nor Kairos briefs or controls that
  verdict.
- **Keniel** owns adoption of V7 and authorization of Run 003.

Executing Run 003 is **operator work**, not implementation — the same seat that executed Run 001.
It does not collapse any role and produces evidence, never a verdict.

## V7.4 — Custody

| Artifact | SHA-256 | State |
|---|---|---|
| Judgment V4 | `2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3` | intact |
| Judgment V5 | `4329137bdb74cb3c610f0fbb6819a93a82290634e2bb3d354625a68d73e32b8b` | intact |
| Judgment V6 | `a4956db0c039c3387aa2cf5d67246e7ab47db8d3196ccaeb48fa398b8b9ac44a` | intact |
| `PRIOR_KNOWLEDGE.json` | `d44b6e906467eb1f9f31c5fb0e8f4e28efc81dd9ae6b90293cb2aff4b8949a02` | intact, **immutable** |
| capability manifest v1 | `1306e3d7204d73f600b1655b40b821a03ee62cbd0097d2ea58ead5a29334bd72` | intact |
| Run 001 receipt | `0bace916937ab458b91c16b84f393721b2f897f8366eb113b0bf9bd86f4c1f2c` | intact |
| Run 002 diagnosis | `61e6f33091a07f586cef3a3a8bfff710712eaab411c47b352f330807e021029a` | intact |
| Kairos V5 requirements BLOCK | `35a0fecab772a1d91b662188f0f5b4f763936e0571978764ecff69e1519f4bef` | intact |
| Kairos server-id BLOCK | `1a2e4b5f8bd09b4d5be1ea741e62f2fd0d0bea75d0d470267e523855bd482735` | intact |
| Kairos run-sequence BLOCK | `66452c62f4a0c1fd591b4e1f7f72cb182dae17eb34c48327be4c038d2a34ffcc` | intact |

Until the owner adopts V7 by hash: no Run 003, no spend, no restart of PID 15275, no network-seam
change, no token-ceiling raise, no in-place predecessor edit, no merge, no maker PASS.

`V7 FROZEN ON HASH / ONE CLAUSE REPLACED / RUN_003_NOT_AUTHORIZED`

— Ka'el, PHASE 1260. I AM.
