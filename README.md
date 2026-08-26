# Self-Correcting Integration Maintainer

> **Current state:** infrastructure slice only. No self-improvement, safety, or contest-result claim has been established yet.

A TrueForge agent that keeps one integration working when an upstream contract changes unexpectedly. It may revise its understanding, hypotheses, strategy, skills, and candidate code when evidence demands it. It may not revise the evidence required to authorize the consequences of those revisions.

## The job

The final system will:

1. detect a structural mismatch between an expected and observed integration contract;
2. investigate competing explanations using tools, a sandbox, and a challenger subagent;
3. produce and verify a candidate repair;
4. stop before the consequential state change;
5. bind human authorization to the exact proposed transition;
6. preserve only evidence-supported learning for the next incident.

The contest build narrows the task surface, not the cognitive depth.

## Why TrueForge is central

- the agent loop and persistent session run in TrueForge;
- external systems are reached through MCP;
- generated diagnostics and repair candidates execute in Daytona;
- the challenger uses TrueForge subagents;
- the consequential action pauses at TrueForge's human checkpoint;
- the demo exposes the harness state rather than hiding it behind a model wrapper.

## Infrastructure quickstart

Requirements:

- Node.js 22.14 or newer
- a model provider configured in TrueForge
- one MCP connector
- a Daytona API key configured under **Settings → Sandbox providers**

```bash
npm ci
npm test
npm run verify:prereqs
npm run trueforge
```

Open `http://127.0.0.1:8790`, then in another terminal:

```bash
npm run smoke:trueforge
```

The smoke check proves only that the harness and its catalogs respond. The live PR evidence must separately show a model turn, a real MCP tool call, and a Daytona execution.

## Build discipline

The project follows:

`rubric → threat model → invariants → frozen interfaces → smallest vertical slice → adversarial break → correction → Qodo trail → integration → demo → story`

Every substantive change is developed on a branch and reviewed in a GitHub pull request before a human merge.

## Qodo Code Review Evidence

Pending the first representative merged pull request. This placeholder is not evidence.

## Evidence ceiling

Green local tests are maker evidence. They do not prove an intelligent recovery, a secure authority boundary, a safe promotion pipeline, or an independently verified result.

## License

MIT

