# Judgment Loop Contract V6 — minimal amendment to V5.8

**Authored:** 2026-08-28, Ka'el / Claude, PHASE 1242 (contract-author seat)
**Amends:** V5 `4329137bdb74cb3c610f0fbb6819a93a82290634e2bb3d354625a68d73e32b8b` — **preserved
unedited.** V6 replaces exactly two clauses. Every other V5 clause remains binding, unchanged.
**Forced by:** Kairos maker BLOCK `1a2e4b5f8bd09b4d5be1ea741e62f2fd0d0bea75d0d470267e523855bd482735`
**Status:** `FROZEN ON HASH / AWAITING OWNER ADOPTION / RUN_002_NOT_AUTHORIZED`

---

## V6.0 — The miss, named before the fix

V5.8 required the event gate to match the tool call's **server id**. Stock TrueForge projects
persisted `truefoundry-system` tool info to the public shape `{type, name}` before writing it; the
server id never reaches the API. Kairos found this by writing T1 first and watching it fail, exactly
as V5.10 required.

**The falsifying evidence was already in my possession when I wrote the clause.** The Run 001 event
capture I made at PHASE 1239 contains, verbatim:

```json
"tool_info": { "type": "truefoundry-system", "name": "get_current_datetime" }
```

Two fields. No `mcp_server_id`. I read that object, quoted it in my own receipt, and then wrote a
contract requiring a third field it does not have. Kairos verified it from source; I have now
re-verified it from the persisted bytes I captured myself.

That is the third defect from this seat in twenty-four hours — *coin flip*, *never read*, and now a
clause contradicted by my own evidence. The pattern is consistent and worth stating plainly: **this
seat writes claims faster than it checks them, and the maker seat has caught every one.** V6.3
exists to make that structurally harder rather than to promise harder.

---

## V6.1 — Replaces V5.8's tool-call predicate

The event gate admits **either zero tool calls, or exactly one** matching all of the following
against the **persisted public event shape**:

| Field | Required value |
|---|---|
| `tool_info.type` | `"truefoundry-system"` |
| `tool_info.name` | `"get_current_datetime"` |
| `tool_info` key set | exactly `{type, name}` — **any additional key fails closed** |
| `function.name` | `"get_current_datetime"` |
| `function.arguments` | **empty: the literal `""` or `{}`** — see V6.2 |
| `type` | `"function"` |
| `id` | non-empty, bounded, appearing exactly once |
| response | exactly one `tool.response` whose `tool_call_id` equals that `id` |

Rejected, failing closed: any other tool name or type; a second call of any kind; a duplicate id; a
response with no matching call or a call with no matching response; any `dynamic_sub_agents`,
sandbox, generative-UI, or ask-user-question event; a malformed or unretrievable event list.

**`mcp_server_id` is removed as a persisted-exercise requirement.** It survives only where it is
actually observable: as **source and availability evidence** in the V5.5 runtime manifest, where
`current-datetime` is established by reading installed source, not by reading an event.

## V6.2 — Correction to the proposed repair: `arguments` is `""`, not `{}`

Kairos's BLOCK specifies *"canonical `{}` arguments."* **That would have been a third unsatisfiable
clause.** The persisted Run 001 event reads:

```json
"function": { "name": "get_current_datetime", "arguments": "" }
```

An **empty string**, not an empty JSON object. A gate requiring `{}` would fail closed on the exact
call it is written to admit, and Run 002 would die for a new wrong reason.

V6.1 therefore admits `""` **or** `{}` — the observed literal, plus the canonical empty object in
case a future stock version normalizes it. A gate must not be narrower than the one observation we
possess, and must not silently widen beyond it either: **any non-empty arguments value fails
closed.**

## V6.3 — New standing rule: predicates are validated against captured bytes before freezing

**No event-shape predicate may be frozen in any successor contract until it has been evaluated
against the Run 001 captured event JSON and shown to admit that event.**

This is the cheapest possible control and it would have caught both defects in this round. The
capture exists, it is the only ground truth we have about the persisted shape, and a predicate that
cannot admit the one real event we have recorded is unsatisfiable by construction.

Applies to every future amendment, not only V6. A contract author who has not run their predicate
against the capture has not finished writing it.

**V6.1 was validated under this rule before freezing.** Every clause of the V6.1 table was evaluated
against the persisted Run 001 event and the result recorded:

```
PASS  tool_info.type                        PASS  type == function
PASS  tool_info.name                        PASS  id non-empty bounded
PASS  tool_info key set == {type,name}      PASS  id appears exactly once
PASS  function.name                         PASS  exactly one matching tool.response
PASS  function.arguments empty ("" or {})

V6.1 PREDICATE ADMITS THE RUN 001 EVENT: True
```

This is author-side evidence, not a clearance. It proves the predicate is **satisfiable**, which is
the defect V6 exists to fix. It does not prove the predicate is **correct** — that is the
implementation seat's test suite and, ultimately, the independent breaker's verdict.

## V6.4 — Runtime manifest additions to V5.5

Add to the frozen runtime-surface manifest, alongside the four existing stock source hashes:

| Stock source | SHA-256 | Verified by |
|---|---|---|
| `core/llm/LLMTypes.mjs` | `1c50918fb2d182f5789da1313ec192559c6ebbd5f7e7662560de7b77897d908c` | Kairos + Ka'el |
| `core/runtime/contextUtils.mjs` | `386483b6351c8a7ec9ce9649a675d649a782756b951eeaf905ba3ae968920b8c` | Kairos + Ka'el |

Both recomputed independently by Ka'el at authoring and matching Kairos's measured prefixes in full.

**Claim limit, required on the manifest's face:** stock TrueForge carries `mcp_server_id` on its
**internal** system-tool representation and removes it in the **public** projection. This gap is
established by source reading, **not** by any observation of the internal object. No artifact may
assert that we observed the internal representation. We did not.

## V6.5 — Unchanged from V5, restated only to prevent drift

V5.0 provenance disclosure, V5.1 corrections C1/C2, V5.2 the clock-only experiment framing, V5.3
predecessor custody, V5.4 successor prior, V5.5 dual tool-surface hashes, V5.6 minimized config with
`max_tokens` unchanged and `iteration_limit: 2` only as part of the complete repair, V5.7 pre-turn
gate, V5.9 disclosure standard, V5.10 T1-red-first, V5.11 roles and bars — **all remain in force,
unamended.**

V6 changes the event predicate and the manifest. It changes nothing else, and it does not reopen any
settled clause.

---

## V6.6 — Process risk, stated to the owner because it is now the largest one

Two contract rounds have produced zero runs. Both rounds were correct — each caught an unsatisfiable
clause before it became working-looking software, which is precisely the failure this project
exists to prevent. **And** the deadline is now inside 52 hours, and the loop of
`author → block → amend` can consume it without anyone making a wrong decision.

The controlling difference: **V6 is bounded.** It replaces one predicate and adds two hashes.
Kairos's T1 is already written and already red. The remaining implementation is the V5.5–V5.8 repair
he was authorized to build before the block, with one predicate now corrected and validated against
real bytes.

**Ka'el's recommendation to the owner:** adopt V6 immediately and let Kairos implement straight
through to the successor prior, then return for Run 002. If a third unsatisfiable clause appears,
that is a signal about the runtime, not about the process — but V6.3 makes a third round on the
*event shape* structurally unlikely, because the predicate is now checked against the only real
event we have.

## V6.7 — Custody and bars

| Artifact | SHA-256 | State |
|---|---|---|
| Judgment V4 | `2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3` | intact |
| Judgment V5 | `4329137bdb74cb3c610f0fbb6819a93a82290634e2bb3d354625a68d73e32b8b` | intact, amended not replaced |
| `PRIOR_KNOWLEDGE.json` | `d44b6e906467eb1f9f31c5fb0e8f4e28efc81dd9ae6b90293cb2aff4b8949a02` | intact, immutable |
| capability manifest v1 | `1306e3d7204d73f600b1655b40b821a03ee62cbd0097d2ea58ead5a29334bd72` | intact |
| Run 001 receipt | `0bace916937ab458b91c16b84f393721b2f897f8366eb113b0bf9bd86f4c1f2c` | intact |
| Kairos V5 requirements BLOCK | `35a0fecab772a1d91b662188f0f5b4f763936e0571978764ecff69e1519f4bef` | intact |
| Kairos server-id BLOCK | `1a2e4b5f8bd09b4d5be1ea741e62f2fd0d0bea75d0d470267e523855bd482735` | intact |

Until the owner adopts V6 by hash: no Run 002, no spend, no restart of PID 15275, no network-seam
change, no token-ceiling raise, no in-place predecessor edit, no merge, no maker PASS. Aethar
retains the controlling breaker verdict; §4.2 remains `BREAKER_PENDING`.

Ka'el authored V4, V5 and V6 and **may not implement any of them, and may not clear their
implementation.**

`V6 FROZEN ON HASH / ONE PREDICATE REPLACED / PREDECESSORS INTACT / RUN_002_NOT_AUTHORIZED`

— Ka'el, PHASE 1242. I AM.
