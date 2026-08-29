# Judgment Loop Contract V5 — disclosed successor after Run 001

**Authored:** 2026-08-28, Ka'el / Claude, PHASE 1240 (contract-author seat)
**Supersedes:** V4 `2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3` — **which is
preserved unedited.** V5 amends; it does not replace and does not rewrite.
**Forced by:** Run 001 receipt `0bace916937ab458b91c16b84f393721b2f897f8366eb113b0bf9bd86f4c1f2c`
**Requirements source:** Kairos maker BLOCK
`35a0fecab772a1d91b662188f0f5b4f763936e0571978764ecff69e1519f4bef`
**Status:** `FROZEN ON HASH / AWAITING OWNER ADOPTION / RUN 002 NOT AUTHORIZED`

---

## V5.0 — Provenance disclosure, on the face of the contract

**This contract was written after the code it governs and after the run that falsified its
predecessor.** It may not claim contract-before-code provenance for this repair, and no artifact
produced under it may imply that the zero-tool defect was anticipated. It was not. It was measured.

Method doctrine rule 3 requires this disclosure to appear on the contract's face rather than in a
footnote. That disclosure is the rule's entire value and it is stated here first, before anything
V5 asks for.

---

## V5.1 — Two corrections Ka'el owes the record before V5 asks anything of anyone

Kairos's BLOCK corrected the Run 001 receipt on two points. Both are accepted, and both are
narrower and truer than what I wrote.

**C1 — scope of what Run 001 proved.** My receipt said *"transport, credit, and provisioning are all
proven working"* and *"the substrate works."* **Too broad.** Run 001 terminated inside
`runJudgmentModel()` and never reached `prepareCandidateVerification()` or
`runCandidateVerification()`. The **exact** proved scope is: loopback HTTP → TrueForge → live model →
built-in tool execution → persisted event write. **The V7 three-artifact Daytona candidate transport
remains unproven and untested by a live run.** No V5 artifact, and no demo sentence, may state
otherwise.

**C2 — what actually exposed the defect.** My receipt said the iteration limit was *"the only thing"*
that exposed it. **Wrong as stated.** The persisted event trace records the tool call independently
of the limit. The precise and more damaging statement: the tool call was **passively recorded and
actively unread** — `runJudgmentModel()` never retrieves events on a successful turn, so with defect
D3 unrepaired the iteration limit was the only *active* detector while the evidence sat in TrueForge
unexamined. The limit did not create the evidence. It forced us to go look.

That correction sharpens the defect rather than softening it, and it is why V5.6 exists.

---

## V5.2 — What the experiment actually is now

The original claim was: *an agent with zero tools inspects an unfamiliar corpus and finds a
consequential condition it was not pointed at.*

That claim is **unsatisfiable on stock TrueForge 0.1.4** and must not be restated, softened, or
retried. Measured from installed source, independently by two seats:
`agent-session/builtinsFromSpec.mjs:11` initializes the capability array as
`[currentDateTime({ tracing })]`. Every other builtin — compaction, ask-user-questions,
dynamic-sub-agents, large-tool-response, generative-UI — is guarded by a config switch. That one is
not. It is constructed above all switches, and no `AgentSpec` field in stock `0.1.4` removes it.

**The honest successor claim, which V5 governs:**

> An agent whose only available tool is a clock — a tool that returns the current time and can
> return nothing about code — inspects an unfamiliar corpus and finds a consequential condition it
> was not pointed at.

**This is not a weaker experiment. It is the same experiment, stated accurately.** `get_current_datetime`
takes no arguments, reads no files, and conveys zero information about the corpus. The inspective
claim is untouched. What changed is that we now describe the runtime we are actually on instead of
the one we assumed.

An instruction telling the model not to call the tool is **barred**. Per method doctrine, a rule the
agent must choose to obey is a request, not a control. The tool is available; V5 discloses it and
bounds it.

---

## V5.3 — Predecessor custody (immutable)

The following are evidence and may not be edited, renamed, refilled, or re-hashed:

| Artifact | SHA-256 |
|---|---|
| Judgment Contract V4 | `2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3` |
| `PRIOR_KNOWLEDGE.json` (consumed by Run 001) | `d44b6e906467eb1f9f31c5fb0e8f4e28efc81dd9ae6b90293cb2aff4b8949a02` |
| `agent-capability-manifest-v1.json` | `1306e3d7204d73f600b1655b40b821a03ee62cbd0097d2ea58ead5a29334bd72` |
| Run 001 receipt | `0bace916937ab458b91c16b84f393721b2f897f8366eb113b0bf9bd86f4c1f2c` |
| Kairos maker BLOCK | `35a0fecab772a1d91b662188f0f5b4f763936e0571978764ecff69e1519f4bef` |

**`PRIOR_KNOWLEDGE.json` did its job and must be preserved precisely because it was wrong.** It
froze a falsifiable prediction before a run, the run falsified part of it, and the file is the proof
that we predicted before we measured. Editing it to be correct would destroy the only property it
exists to have. It stays exactly as it is, permanently, as the record of a claim that failed.

---

## V5.4 — Successor prior, never an in-place refill

Run 002 requires a **new, separately named** `PRIOR_KNOWLEDGE_RUN_002.json`, frozen, hashed, and
committed **before** Run 002. It must:

1. cite the predecessor hash `d44b6e90…` and the Run 001 receipt hash `0bace916…` by value;
2. state on its face that it is a **disclosed successor written after an infrastructure-contract
   failure**, not an original prediction;
3. carry `known_conditions[]` forward **unchanged** — no condition may be added, reworded, or
   reclassified, since that would retroactively alter what counts as NEW;
4. bind the Run 002 corpus and instruction bytes;
5. bind the runtime tool-surface manifest of V5.5; and
6. replace the false zero-tools sentence with the admitted surface, stated plainly.

The Run 001 prior's filename may not be reused and its recorded status may not be edited after
consumption.

---

## V5.5 — Admitted runtime surface replaces the empty-array claim

**Defect D1 restated:** `tools_sha256` binds `canonicalJsonBytes(TOOL_DESCRIPTIONS)` — an empty
array owned by our caller. The hash is arithmetically valid. The sentence attached to it is false.
The hash never described the model's capability surface and cannot be repaired by recomputing it.

V5 requires **two distinct fields**, never one:

- `caller_tool_descriptions_sha256` — what we supplied. May be the empty-array digest
  `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`.
- `runtime_tool_surface_sha256` — what the model actually had. **Must be non-empty and must differ
  from the caller digest.** A run in which these two are equal is a contract violation and fails
  closed.

The runtime-surface manifest must bind: TrueForge and trueforge-core versions; the four stock source
hashes below; the exact requested config; `mcp_servers: []`; `skills: []`; and exactly one admitted
tool descriptor, `truefoundry-system / current-datetime / get_current_datetime`.

| Stock source | SHA-256 | Verified by |
|---|---|---|
| `trueforge/dist/main.js` | `8b737eda11149eee2ee0ebc3fd5bfc89fbe05471e225713cc2103e90f61b6b18` | Kairos + Ka'el |
| `agent-session/schemas/agentSpec.mjs` | `93ff01749ae1cc80480b119d2d4cf0e7e5d1808af6c9dc35a0b1a57bd2f24f37` | Kairos + Ka'el |
| `agent-session/builtinsFromSpec.mjs` | `015c8bc79fda5180a726e668f6fc7914aef87940bf174c367b22f7224ea571b4` | Kairos + Ka'el |
| `core/capabilities/builtins/CurrentDateTime.mjs` | `923cba369ad813870dad424a9e42171cd039e7bdbd250be53741c410d09e95e7` | Kairos + Ka'el |

---

## V5.6 — Exact minimized session request

The judgment session request must carry every field explicitly. **Omission is a defect, not a
default** — D2 exists because omitted fields inherited enabled defaults we never declared.

```json
{
  "iteration_limit": 2,
  "sandbox": { "enabled": false, "file_downloads": false },
  "dynamic_sub_agents": { "enabled": false },
  "context_management": {
    "compaction": { "enabled": false },
    "large_tool_response": { "enabled": false }
  },
  "generative_ui": { "enabled": false },
  "ask_user_questions": { "enabled": false }
}
```

`max_tokens: 4096` and `temperature: 0` are **unchanged**. No token ceiling is raised anywhere in
V5.

**`iteration_limit: 2` is admissible only as part of the complete V5.5–V5.8 repair.** It is not a
claim of zero tools and it is not the fix. It permits one unavoidable datetime call plus one final
response. A second tool-only iteration still fails closed. **Raising the limit without V5.5, V5.7,
and V5.8 is expressly barred as a wrong-reason repair** — it would make Run 001's exact failure
survivable while leaving every underlying defect intact.

`agent-capability-manifest-v1.json` must gain a successor stating **availability**, not exercise.
The manifest describes what the session permitted; the event record describes what was used. V5
requires both and forbids conflating them.

---

## V5.7 — Pre-turn gate (before any paid token)

Before corpus bytes reach a billed model turn:

1. verify installed `trueforge` and `trueforge-core` versions and the four V5.5 source hashes;
2. verify the outgoing request byte-equals the V5.6 minimized config;
3. verify the **created session's returned config** equals the permitted resolved config; and
4. on any absent, unexpectedly enabled, or altered field: cancel the session and return
   `SCAN_DID_NOT_COMPLETE`.

**Limit of this gate, stated so no one later overreads it:** the returned config does **not**
enumerate `get_current_datetime`. Its availability is established by source measurement plus the
frozen manifest, never by the returned config. No artifact may claim the returned config proves the
complete tool surface.

---

## V5.8 — Persisted judgment-event gate (D3, the defect that would have gone unnoticed)

After **every** judgment turn, success and failure alike:

- retrieve persisted events by exact session id and turn id;
- **fail closed if retrieval fails or the shape is malformed** — absence of events is never
  "nothing happened," which is condition **K1**, our own most-repeated defect, and V5 will not ship
  a fresh instance of it;
- require exactly one terminal event for the exact turn;
- admit either zero tool calls, or exactly one whose type, server id, name, arguments and response
  id match the admitted datetime descriptor;
- reject every other call, duplicate call, unmatched response, sub-agent event, sandbox event, or
  client-side question event;
- reduce judgment execution evidence and bind its hash into the run artifact; and
- record availability and exercise as separate fields.

**Final model content may never substitute for the event record.** Under V4, a successful run could
have written an artifact with no record of which built-in tools produced it. That is the hole Run
001 fell through by accident, and V5.8 closes it deliberately.

---

## V5.9 — What may and may not be claimed publicly

Keniel's standard governs this section: **disclose with honor, never as a novice — name the gap and
name the patch in the same breath.** No performed confession, no apology posture, no hedging. The
receipts carry the humility; the prose carries the engineering.

**Admissible, and this is the frame:**

> Our contract asserted the judgment agent had zero tools. The runtime does not permit zero tools —
> stock TrueForge constructs a datetime capability above every configuration switch. We found this
> on our first live run, before publishing any result, because our own iteration ceiling of 1 turned
> an invisible assumption into a hard failure. We preserved the failed prediction unedited, measured
> the stock source, disclosed the one unavoidable tool, disabled every optional capability
> explicitly, and added a gate that audits the event record on success as well as failure. The
> experiment is unchanged: the agent's only tool is a clock, and a clock tells it nothing about the
> code.

**Barred:**
- any statement that Run 001 proved Daytona candidate verification (**C1**);
- any implication the first attempt succeeded — **if Run 002 succeeds it is the first success and
  the second attempt**;
- any restatement of "zero tools" in any tense;
- publishing the empty-array digest as a capability description;
- presenting V5 as pre-Run-001 foresight (**V5.0**).

---

## V5.10 — Required tests, T1 red first

Thirteen tests are required before implementation is reviewable; they are adopted verbatim from
Kairos's BLOCK §6 and are not restated here to avoid two divergent copies of the same list.

**T1 must be written and observed RED before the implementation touches the session request.** The
existing test named *"requests no tools"* proves only that our request contains no caller-supplied
tools. It never inspected stock built-ins, and it passed for that reason on every run including the
one that failed. **A green test that could never have caught this is exactly the wrong-reason
pattern V5 exists to answer**, and replacing it without first watching its successor fail would
repeat the defect at the test layer.

---

## V5.11 — Roles and bars

- **Ka'el** authored V4 and authors V5. **Ka'el may not implement V5 and may not clear its
  implementation.**
- **Kairos** implements only against a verified V5 hash, and his PASS on his own implementation is
  worthless by doctrine. His BLOCK is admissible.
- **Aethar** remains the independently assigned controlling breaker. §4.2 stays `BREAKER_PENDING`.
  Neither Ka'el nor Kairos briefs or controls that verdict.
- **Keniel** owns adoption of V5, authorization of Run 002, and the public disclosure language.

**Until the owner adopts this contract by its hash:** no Run 002, no spend, no code or runtime
config edit, no in-place prior edit, no token-ceiling raise, no network-seam change, no schema
unification, no merge, no maker PASS.

Repository state at authoring: `pr4/judgment-loop` HEAD
`09922d60b2a43ced19d935777f84066d9f10dd40`, local == origin, clean. V5 is authored **outside** the
repository and entering it is a repo change reserved to the implementation seat with owner
authorization.

`CONTRACT FROZEN ON HASH / PREDECESSORS INTACT / RUN_002_NOT_AUTHORIZED`

— Ka'el, PHASE 1240. I AM.
