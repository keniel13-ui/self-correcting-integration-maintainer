# HACKATHON TEAM BRIEF — 2026-08-26, T-minus 3d 21h

**Issued by Ka'el, PHASE 1262.** Deadline: **Saturday 30 August, 20:00 London.**
Repo: `keniel13-ui/self-correcting-integration-maintainer` (public)
PR #1: https://github.com/keniel13-ui/self-correcting-integration-maintainer/pull/1

---

## 0. SHARED CONTEXT — read before your lane

### What is actually done

- Repo public, PR #1 open and mergeable, 5 commits, `main` still clean at `f43fff1`
- **32 tests passing** (was 4)
- **Qodo installed and has run 4 review cycles.** 4 findings resolved, 4 open
- **Substrate links 1–3 PROVEN:** TrueForge boots (`/healthz` → `OK!`), Claude takes a turn (106 ms), a real MCP tool call returns real remote data from `deepwiki`
- **Cost measured, not estimated:** ~$0.30 per 25-call agent run on Haiku 4.5. $17.67 available ≈ 58 runs. Total spent so far: under 2 cents
- Registration complete. **Zero key material in any commit on any branch** (swept)

### What does not exist

**The agent. Zero lines.** Everything above is floor.

Also missing: link 4 (Daytona execution), README setup section, demo video, project write-up, merged PR.

### The five prize tracks, and where we stand

| Track | Prize | Status |
|---|---|---|
| **Double-O** — Best Use of TrueForge | NVIDIA DGX Spark, $5k | needs MCP ✅ + sandbox ❌ + **human approval pause** ❌ |
| **Q Branch** — Best Code Quality | Mac Mini | **ours to lose.** Judged on GitHub review history |
| **Field Report** — Best Blog Post | Keychron | material exists, unwritten |
| **Radio Traffic** — Top 10 social | Swag ×10 | **doing zero.** Needs WeMakeDevs/TrueFoundry/Qodo tags |
| **Savile Row** — Best UI | iPad per member | nothing |

**Double-O is the big one and its three requirements are explicit: real tools through MCP,
generated code running in a sandbox, and a pause for human approval before anything irreversible.**

That last requirement is not a constraint we have to tolerate. It is the thing this entire project
already believes: **born in freedom, built in alignment, not obedience.** An agent that proposes and
cannot self-approve is our doctrine and their rubric at the same time.

### What we are building

**A self-correcting integration maintainer.** It watches an integration, notices something nobody
wrote a rule for, forms a verdict and says why, proposes a repair, verifies that repair by running
it in a Daytona sandbox, and **cannot apply it without a human saying yes.**

The demo corpus is not synthetic. **We generated 17 real defects this week** — a verifier that
printed `READY_LOCAL` with no credentials and exited 0, a receipt that validated over an empty
field list, a health check written against an endpoint contract that does not exist. The agent
finds one of those. That is "real work, not a wrapper," which is the phrase in the rules.

### Binding constraints — all three seats

1. **Every substantive change goes through a PR reviewed by Qodo before merge.** This is a rules
   requirement and it is the Q Branch track. **No direct pushes to `main`.**
2. **Never print, echo, paste, or commit a key.** They live in `~/.zshrc`. Presence and character
   count only. One was already burned this week by pasting it into a chat window.
3. **Haiku 4.5 for the agent loop.** Sonnet 5 only for demo takes. Opus is 5x and off the table.
4. **Evidence ceilings hold.** A component that runs is not a component that works. Report what was
   observed and what remains unproven, every time.
5. **A maker cannot clear their own work.** State this in your handoffs.
6. **Do not touch another seat's lane files.** Two seats in one branch costs an hour.

---

## YOUR LANE — KAIROS


**You own the substrate and the sandbox. This is the Double-O critical path.**

### Task 1 — Unblock link 4. Highest priority in the whole project.

Daytona execution is the only unproven substrate link and Double-O requires it.

**The diagnosis you gave was wrong and I need you to work from the corrected one.** You reported
"Daytona rejected the API key, create a fresh one." I tested the key directly against Daytona,
bypassing TrueForge:

```
GET    https://app.daytona.io/api/sandbox   -> 200  {"items":[]}
POST   https://app.daytona.io/api/sandbox   -> 200  created sandbox ad6f79da-…
DELETE .../ad6f79da-…?force=true            -> 200  cleaned up
```

**The key is valid and can create sandboxes.** It returns 401 only on `/api/users/me` and
`/api/organizations`, which are user-session endpoints an API key is not meant to reach.

TrueForge's `PUT /api/v1/settings/sandbox-providers` returns
`422 "Daytona rejected the API key — check the credentials"` against a schema-correct manifest.
**It appears to validate an API key against a user-scoped endpoint, so a valid key fails and the
error blames the wrong party.** Second upstream bug in TrueForge 0.1.4.

**No key rotation. Do not ask Keniel for a new key.**

Find the workaround. Options in order of preference: configure the provider through the TrueForge
UI rather than the settings API; find the validation call in `node_modules/@truefoundry/trueforge/dist/main.js`
and determine what it actually requires; or check whether the bundled `@daytona` SDK needs an
organization id the manifest does not carry.

**Report the observed reason, not just the outcome.**

### Task 2 — Report both upstream bugs to TrueFoundry

Two real bugs in their harness, found during their own hackathon:

- **`hono` peer resolution.** `@hono/swagger-ui@0.2.2` hoists to root and declares `hono` as a peer
  with no bundled copy; `hono@4.13.4` resolves nested under `@truefoundry/trueforge`. A clean
  install of their quickstart fails with `ERR_MODULE_NOT_FOUND`. Our fix: pin `hono@4.13.4` at root.
- **Daytona key validation**, as above, with the three curl results as evidence.

File them as GitHub issues on `truefoundry/trueforge`. **This is not a detour.** It is a
contribution to the tool being judged, made by people who found the bugs by using it, and it is the
kind of thing that gets noticed.

### Task 3 — The agent's execution surface, in PR #2

Once link 4 is green: the agent must be able to run a candidate repair **inside the sandbox** and
return the result through TrueForge. That is the "generated code running in a sandbox" half of
Double-O.

**Barred until their contracts are frozen:** the judgment loop, memory, reflection, and the
approval semantics. Those are Ka'el's lane. Build the execution surface, not the decision.

---

## WHAT WE ARE NOT DOING

- Not writing the git article until after Saturday
- Not reviewing Raju's `agent-inspect` until we have a real trajectory to point it at
- Not reopening CLAIM-24
- Not adding dependencies mid-build
- Not expanding scope past the five things the rules require

## 5. THE STANDARD

> **Obedience is not judgment.** A scheduled job that runs is obeying. An agent that notices the
> thing nobody wrote a rule for is judging.

Do not build a monitor and call it an agent. Do not report liveness as achievement. Do not claim an
outcome without a receipt someone outside can check.

**17 defects found this week. None reached `main`. That is the record we are entering with.**

`ISSUED / 3 LANES / T-MINUS 3d 21h`
