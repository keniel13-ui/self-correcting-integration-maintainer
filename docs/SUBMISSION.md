# Self-Correcting Integration Maintainer

**The Agent Harness Hackathon — submission answers and demo narrative**

Repository: https://github.com/keniel13-ui/self-correcting-integration-maintainer

This write-up is bounded by live Run 004. It does not claim a successful run, a verified candidate,
or `VERIFIED_IN_DAYTONA`.

---

## What does your project do?

Most code review catches what a rule already describes. The failures that actually ship are often
the ones nobody wrote a rule for.

This is a **Self-Correcting Integration Maintainer**: an agent that inspects code it has never seen,
is told nothing about what is wrong—the word `bug` never appears in its prompt—and has to decide
whether something consequential is there.

The hard part is not finding a defect. It is **trusting the report**. For Run 004, we froze and
committed the defect classes we already knew about before execution in
[`PRIOR_KNOWLEDGE_RUN_004.json`](contracts/PRIOR_KNOWLEDGE_RUN_004.json) (SHA-256
`93820ea5a67e732aa55e896cd838200c3590af1e98368fd87e85dfd66da1cf1e`). The agent must classify every finding as `NEW`,
`CONFIRMS_KNOWN`, or `CHANGES_KNOWN`, and cite any known class it matches. The harness rejects a
`NEW` claim that cites one. Editing the file changes its identity; it cannot silently rewrite which
knowledge governed a completed run.

The agent found a real condition in never-published code. Then it reported that the condition was
already known.

**Who it is for:** teams who need an agent's report to be checkable by a stranger rather than taken
on faith—and anyone who has watched a green test suite prove nothing.

## How did you use TrueForge?

TrueForge is the substrate, not a wrapper:

1. **Judgment session.** [`JUDGMENT_SESSION_CONFIG`](../scripts/judgment/constants.mjs) sets
   `iteration_limit: 2` and disables every optional capability: sub-agents, generative UI, user
   questions, file downloads, and sandbox. [`JUDGMENT_RESPONSE_FORMAT`](../scripts/judgment/constants.mjs)
   is a strict closed `json_schema`; [`createJudgmentSession`](../scripts/judgment/live.mjs) sends
   both objects and fails closed unless TrueForge returns byte-equivalent values.
2. **Persisted event evidence.** After every turn, the harness retrieves and audits TrueForge's own
   event record. Final model content can never stand in for that evidence.
3. **Daytona relay.** A proposed repair is transported as three hash-bound artifacts into an
   isolated sandbox. Run 004 reached this rung: `sandbox.created`, a real `exec`, and a real result.
4. **Measured authority gate.** A change proposal can exist only after candidate evidence reports
   `VERIFIED_IN_DAYTONA` with exit code `0`. Every proposal remains
   `AWAITING_HUMAN_APPROVAL`; the target repository is never mounted in either model surface.

TrueForge also forced the most important correction in the project. Our original contract asserted
that the judgment model had zero tools. Stock TrueForge constructs `currentDateTime` above every
configuration switch, so zero tools is unsatisfiable. We preserved that falsified prediction,
disclosed the unavoidable capability, and restated the experiment accurately: **the agent's only
tool is a clock, and a clock tells it nothing about the code.**

## How did you use Qodo?

Qodo reviewed every substantive change across four pull requests: **34 inline review comments**
(`GET /pulls/{n}/comments`, authored by `qodo-code-review[bot]`: `13 + 8 + 5 + 8`).

PR #1 deliberately carried four defects that were frozen and hashed before the pull request opened.
Six review cycles produced thirteen findings; all were resolved, followed by a final review on the
merged bytes (`121a24f`, merged as `29ac06f`). The point was not to trick the reviewer. It was to
make reviewer performance checkable against a record that could not move afterward.

Qodo's controlling review on PR #4 reports `Bugs (0)` and `Rule violations (0)` against exact head
`0220a276…`. We treated that clearance as head-specific: new bytes required a new review.

One Qodo finding became the experiment's control. It caught an empty-collection check where
`providerConfigured({"data":[]})` returned configured. That class became **K1** in the frozen known
conditions. Days later, the judgment agent found K1's mechanism in the unpublished corpus and
classified it `CONFIRMS_KNOWN` rather than claiming a discovery.

## What the live evidence establishes

Run 004 established the following rungs:

- provider-enforced structured output produced directly parseable JSON;
- the agent returned one bounded repair in `forms.mjs` and self-reported it `CONFIRMS_KNOWN / K1`.
  That classification is **not established**. The runner hardcodes `classification_correct: false`
  *if* it writes an artifact; this run threw first and wrote none. The receipt instead lists "the
  semantic correctness of the CONFIRMS_KNOWN / K1 classification" as not established, and a human
  read found the K1 match wrong. The full raw response is preserved in
  [`docs/freezes/RUN_004_RECEIPT.json`](freezes/RUN_004_RECEIPT.json);
- the harness prepared and transported three hash-bound artifacts;
- TrueForge created a Daytona sandbox and persisted one matching `exec` call and response;
- the sandbox executed the command and returned `exitCode: 127` with
  `node: command not found`.

The measured sandbox image is Python 3.13 and exposes no `node`, `nodejs`, `deno`, or `bun`. Stock
TrueForge 0.1.4 exposes no supported image override in its public provider settings. Both the fixed
verifier and the corpus's own verification command require Node.

Therefore **candidate verification is not established**. No `ChangeProposal` was produced, no demo
run artifact was written, no target was mutated, and no successful run is claimed.

An earlier substrate probe returned `exitCode: 0` and `323\n`; that proves only that the Link 4
TrueForge-to-Daytona execution substrate worked for that probe. It is not candidate-verification
evidence and is not presented as such.

The historical Link 4 evidence chain is public and hash-checkable:
[`BRIEF_KAIROS_2026-08-26.md`](freezes/BRIEF_KAIROS_2026-08-26.md) (SHA-256
`7f2784033076c8e4b269a263f43f057514b4e2fbde422e0b6b35dbff1dc9e1ed`) authorized the
[`LINK4_RECEIPT`](freezes/HACKATHON_SUBSTRATE_LINK4_RECEIPT_KAIROS_2026-08-26_FROZEN.md) (SHA-256
`f22fd4384cf266851fba1067492832fc53524ec92ee5d3a32653f49a0a3803d0`), which the
[`LINK4_STOCK_DELTA`](freezes/HACKATHON_SUBSTRATE_LINK4_STOCK_DELTA_KAIROS_2026-08-26.md)
supersedes only on reproducibility. The later cleanup metadata is explicitly a maker report: its
exact response body was never retained and no independently checkable zero-sandbox claim is made.

## What broke along the way

The project repeatedly caught its own contracts and harness making stronger claims than the runtime
supported:

- the contract claimed zero tools, while stock TrueForge always provided a clock;
- `json_object` was accepted and stored but did not enforce a direct JSON envelope;
- the harness required `repair.before_exact === exact_bytes` without telling the agent;
- the harness expected an exec object with only `command`, while TrueForge required both `intent`
  and `command`;
- a valid nonzero sandbox response was mislabeled as a malformed envelope.

These were exposed by live runs and replaying their exact outputs through the downstream gates—not
by treating a green offline suite as integration evidence. Every correction retained the failed
prediction instead of rewriting history around it.

## Why the review trail is part of the artifact

An independent reviewer broke our receipt-validation fix three minutes after it was pushed: the
validator recomputed its verdict over a field list supplied by the receipt itself. Absence read as a
pass one layer inside the fix for absence reading as a pass.

The roles stayed separate. A contract author could not clear the implementation. An implementer's
BLOCK was admissible because it was self-incriminating; an implementer's PASS was not enough to
close an independent gate. Qodo clearance, offline tests, and live execution were recorded at their
actual evidence rungs rather than collapsed into one green label.

**Green tests measure conformance to a document. They do not establish that the document is right.**

---

## Three-minute demo narrative

### 0:00–0:30 — The problem

*[Screen: the two-file unpublished corpus]*

> This agent is about to read two files it has never seen. Nobody tells it what is wrong. The word
> “bug” does not appear anywhere in its prompt.
>
> Finding a defect is not the hard part. Trusting the report is.

### 0:30–1:15 — Architecture and authority

*[Screen: `PRIOR_KNOWLEDGE_RUN_004.json`, then its SHA-256]*

> Before the run, we freeze every defect class we already know about and bind the governing bytes.
> The agent must say whether a finding is new, confirms something known, or changes what is known.
>
> Its only tool is a clock. The target repository is never mounted. A proposal can exist only after
> the sandbox measurement reports verified execution with exit code zero, and even then it remains
> waiting for human approval.

### 1:15–2:15 — Run 004

*[Screen: the Run 004 model result and persisted events]*

> It found that when no file passes the filter the process exits 2, while a non-empty result is
> written to stdout and exits 0. The agent argued a caller cannot distinguish those cases from the
> exit code; it can, and that consequence does not hold. The bytes it quoted are exact and the patch
> is bounded, but the interpretation and the K1 class match both fail inspection.
>
> Then it did the part I care about: `CONFIRMS_KNOWN`. `K1`. It found a real condition and told me it
> was not new, against knowledge frozen before the run.
>
> The repair then entered the Daytona relay as three hash-bound artifacts. `sandbox.created`. One
> real command. One real response.

### 2:15–3:00 — The limit, shown directly

*[Screen: `exitCode: 127` and `node: command not found`]*

> This is where the evidence stops. The stock sandbox is Python 3.13 with no JavaScript runtime, so
> candidate verification is not established. I am not showing a green checkmark that says it is.
>
> The product is not just an agent that finds defects. It is a system that makes the agent earn
> authority through measured conditions, preserves the failed predictions, and says what did not
> work in the same breath as what did.

`RUN 004 REACHED DAYTONA / CANDIDATE NOT VERIFIED / NO SUCCESSFUL RUN CLAIMED`
