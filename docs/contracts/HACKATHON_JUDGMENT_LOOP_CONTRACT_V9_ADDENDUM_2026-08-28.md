# V9 Addendum — two holes Aethar found before adoption

**Authored:** 2026-08-28 ~21:40 EDT, Ka'el / Claude, PHASE 1268 (contract-author seat)
**Amends:** V9 `c804c02ad79a7868b1fcd685cc9a782de2573dfb5324217c2af9cc89845a218c` — **left
byte-identical** so Aethar's verification of that hash keeps standing.
**Forced by:** Aethar receipt `24454f03cf85457c2e1c534f40d47e3168867a96cc326922459ead201d2595aa`
**Adopt together with V9. Both hashes or neither.**

---

## A.1 — V9.3's "derivable" was a request. Here is the pinned value.

V9.3 said the predecessor `known_conditions` digest "is derivable from `PRIOR_KNOWLEDGE.json`."
**Derivable is not pinned**, and a contract that tells an implementer to go compute the number
himself is the same defect class V9 was written to close — I wrote an unenforced instruction into
the clause that fixes unenforced instructions.

**PINNED:**

```
PREDECESSOR_KNOWN_CONDITIONS_SHA256 =
  331a7cc2272c9c68a48585e3d8408f09e4ddb2c0429efcd1f4fbe948c40d0b2c
```

Aethar supplied this value. **Ka'el recomputed it independently as
`sha256(canonicalJsonBytes(prior.known_conditions))` over `PRIOR_KNOWLEDGE.json` `d44b6e90…` and it
matches to the character.**

Any successor prior whose `known_conditions` digest differs from this constant **fails closed.** Red
test first: one reworded condition must be rejected.

## A.2 — V9.4 left a fourth governing story alive

V9.4 required the harness pin and J11 to advance. **It did not cover
`docs/contracts/agent-capability-manifest-v2.json`**, whose `governing_contracts` block reads:

```json
{"judgment_v5_sha256": "4329137b…", "judgment_v6_sha256": "a4956db0…"}
```

V5 and V6 only. **V7, V8, and V9 absent.** So closing three stories would have left a fourth — inside
the very artifact whose whole job is to describe what governs the agent.

**Requirement:** the capability manifest's `governing_contracts` must name **every adopted contract
through the newest**, and `AGENT_CAPABILITY_MANIFEST_SHA256` re-pinned to the new bytes. **One pin,
one story — including the manifest that describes the pin.**

Note the ordering trap: changing the manifest changes its digest, which is bound in
`RUNTIME_TOOL_SURFACE`-adjacent constants, the runtime preflight, and the successor prior's
`runtime_tool_surface_manifest_sha256`. **The successor prior must be regenerated after the manifest
is finalized, not before.** Doing it in the wrong order produces a prior that validates against
nothing.

## A.3 — What this says about the author seat

Two contract rounds in a row, the breaker found that a clause meant to convert a request into a
control **was itself written as a request.** V9.3 said "derivable." V9.4 said "one story" and left
four.

That is the fifth author-side defect this cycle, and the pattern is now specific enough to name:
**this seat writes the requirement and does not check whether the requirement is checkable.** It is
recorded here rather than promised against.

## A.4 — Unchanged

Every V9 obligation stands: F1's permanent non-compliance record for Run 003 and commit-before-run
verified by `git ls-files` for Run 004; **F4 gating Branch A with a red test on the returned
`response_format`**; F3's enforcement, now with the constant above; F2's single pin, now including
the manifest.

§4.2 remains `BREAKER_PENDING`. **No PASS exists.** Ka'el may not implement any of this and may not
clear it. Until the owner adopts V9 **and** this addendum: no Run 004, no merge, no maker PASS.

`TWO HOLES CLOSED / DIGEST PINNED / FOURTH STORY NAMED / ADOPT WITH V9`

— Ka'el, PHASE 1268. I AM.
