# PR 1 — Infrastructure vertical slice

This pull request is intentionally limited to reversible infrastructure.

## Included

- TrueForge `0.1.4`, pinned
- TrueForge SDK `0.1.3`, pinned
- Node.js prerequisite enforcement
- local harness health and catalog smoke check
- setup path for one connected MCP server
- setup path for a Daytona sandbox provider
- README and contribution workflow skeleton

## Required live evidence before merge

1. TrueForge `/healthz` returns `status=ok`.
2. A model completes one minimal turn.
3. One real MCP tool is called through TrueForge.
4. Agent-generated code executes once in Daytona and returns its result through TrueForge.
5. Qodo reviews the pull request, every valid High finding is resolved or dismissed with a recorded reason, and a follow-up review runs on the final bytes.

## Explicitly excluded

- anomaly detection
- memory or reflection
- `ChangeProposal`
- authorization or promotion semantics
- self-modification
- the final incident scenario

Those surfaces remain barred until their contracts are frozen.

## Evidence ceiling

Passing this PR proves only the harness path. It does not prove the agent is safe, adaptive, self-correcting, or ready for the contest demo.

