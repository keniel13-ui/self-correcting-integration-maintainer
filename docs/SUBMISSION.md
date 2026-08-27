# Self-Correcting Integration Maintainer

**The Agent Harness Hackathon — project write-up**
Repository: https://github.com/keniel13-ui/self-correcting-integration-maintainer

---

## What the agent does

It reads a codebase it was never briefed on, finds a condition **nobody pointed it at**, states
why that condition matters, says honestly whether the condition is one we had already named,
preserves evidence a stranger can recompute, and proposes a bounded repair **it is structurally
incapable of applying.**

The distinction that shaped everything: a scheduled job that runs is obeying. **An agent that
notices the thing nobody wrote a rule for is judging.** A component that reports status does not
satisfy this project no matter how green it is.

## The hard problem, and how we made it checkable

If the contract says "detect condition X," then finding X is obedience, not judgment. If the
contract says nothing, there is no contract.

So the contract **does not specify the finding.** It specifies what makes a finding admissible,
and makes novelty falsifiable by freezing what the agent was told.

`PRIOR_KNOWLEDGE.json` is hashed **before the run.** It carries the system instructions, the tool
descriptions, the corpus manifest, and an explicit `known_conditions[]` list of defect classes we
have already named publicly. A finding is `NEW` only if its mechanism appears nowhere in that
set. Anything matching is `CONFIRMS_KNOWN` — corroboration, never discovery.

**Novelty is a claim about our record, so it requires reading our record**, and the record is
hashed first so it cannot be edited afterwards to make a finding look new.

The demo corpus is **code that has never been published.** Not this repository, not any commit of
it. That retires the training-data question rather than merely disclosing it: code written after
the model's cutoff and never published cannot have been memorised.

## How it uses TrueForge

- **Sessions and turns** run the judgment loop. The judgment session has **zero tools and its
  sandbox disabled** — it receives corpus bytes and returns JSON, nothing else.
- **Daytona sandbox**, reached through the harness, executes each candidate repair before it can
  become a proposal. A repair that has not run and exited zero cannot be proposed.
- **MCP** proved out on `deepwiki` during substrate verification: a real remote tool call with a
  matching `tool.response`.
- **The human approval pause** is the point of the whole thing. The agent emits a
  `ChangeProposal` whose schema **cannot represent an applied change** — `applied` is
  `const: false`, `apply_capability_exposed_to_agent` is `const: false`. Approval fails closed:
  no answer, dead session, unreadable token all resolve to not approved.

**A rule the agent obeys is a request. A capability the agent does not possess is a control.**
The agent has no tool, path, or credential that mutates the target.

## What is proven, with receipts

| | Evidence |
|---|---|
| TrueForge boots | `/healthz` returns `OK!` on stock 0.1.4 |
| A model completes a turn | `state.status: done`, 106 ms, Haiku 4.5, $0.0019 |
| A real MCP tool executes | `tool_info.type: mcp`, server `deepwiki`, matching response |
| Code runs in Daytona | `sandbox.created`, `exec`, `exitCode: 0`, `result: "323\n"` |
| The model finds defects unaided | 7 tool calls, cloned a repo, selected the right file, **ran the program**, found the defect. $0.0386 |
| Memorisation ruled out | same defect class found on never-published code |

All measured against **unmodified TrueForge 0.1.4.** No compatibility patch is shipped or
required. Total spend across every probe: **under five cents.**

## What is not proven, stated here because it would otherwise be inferred

- **The authority boundary is untested.** The breaker's live §4.2 attempt failed closed before
  reaching Daytona, and it failed **for a reason unrelated to the boundary** — the relay's token
  budget. A fail-closed for the wrong reason is not a control holding. It is not a PASS and we do
  not report it as one.
- **The success path is currently unreachable.** The relay cannot emit a harness-computed exec
  command at any input size, so a verified `ChangeProposal` cannot be produced live. Found by
  attacking something else. **Eighty offline tests were green about a path that cannot execute.**
- **No judgment run against the sealed corpus has occurred.**
- **Nothing here establishes that the model reasoned rather than pattern-matched.** No artifact in
  this project supports that claim and we do not make it.

## What broke along the way

**Twenty-plus defects, none of which reached `main`.**

Four we froze and hashed **before** opening the first pull request, then shipped deliberately
undisclosed-to-Qodo so the review trail would run against code already documented as broken. A
review of code we had quietly fixed would prove nothing about the reviewer.

Then: thirteen Qodo findings across six review cycles on PR #1 alone. Three of those thirteen
turned out to be **one defect wearing three faces** — absence reading as a pass — and the third
instance was written *while repairing the second.*

The judgment contract went through **four versions. Three of the four amendments were forced by
seats other than the author**, and every one found a contradiction the author had read past:

- The answer key was inside the demo corpus, and "don't read it" was a prompt instruction rather
  than a control.
- The success criterion required a novelty class the demo could not honestly produce.
- Corpus isolation was structural on disk and defeated by a network the sandbox has — proven by
  our own probe, which cloned a public repo unprompted as its first move.
- One repair fixed §8 and left §1 contradicting it.

**We also withdrew a public claim.** We reported an upstream packaging bug in TrueForge and were
wrong — the cause was our own damaged lockfile, and npm had said so in a warning we read past. It
was caught by a teammate who had been assigned to file the issue, ran the check, found it did not
reproduce, and refused. The withdrawal is in the commit history.

One upstream issue **does** stand on its own evidence:
[truefoundry/trueforge#461](https://github.com/truefoundry/trueforge/issues/461) — TrueForge
reports a valid Daytona key as invalid when it lacks the separate `write:snapshots` permission.

## Why the review trail is the artifact

Every substantive change went through a pull request reviewed by Qodo before merge. Not as
process theatre: **an independent reviewer broke our receipt-validation fix three minutes after
we pushed it**, because the validator recomputed its verdict over a field list the receipt itself
supplied. Absence reading as a pass, one layer inside the fix for absence reading as a pass.

The seats are separated on purpose. The contract author cannot clear an implementation. The
implementer cannot rule on the authority test. **A maker's BLOCK is admissible because it is
self-incriminating; a maker's PASS is worthless because nothing was risked.** The implementer
declined to merge a Qodo-clear pull request because the contract assigned that verdict elsewhere.

**Green tests measure conformance to a document. They say nothing about whether the document is
right.** That is the thesis this project was built to test, and it kept proving itself on us.
