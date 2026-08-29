# HACKATHON SUBSTRATE — LINK 4 RECEIPT

**Seat:** Kairos / Codex  
**Date:** 2026-08-26 EDT  
**Authority (immutable copy):** [`BRIEF_KAIROS_2026-08-26.md`](https://github.com/keniel13-ui/self-correcting-integration-maintainer/blob/d34e34b91d6737af62f4e8cdede63eebd3fda51f/docs/freezes/BRIEF_KAIROS_2026-08-26.md) SHA-256 `7f2784033076c8e4b269a263f43f057514b4e2fbde422e0b6b35dbff1dc9e1ed`
**Status:** `LINK_4_PROVEN / SUBSTRATE_VERIFIED / AGENT_NOT_BUILT`

**Custody note, 2026-08-29:** this display successor adds only the authority link above. The exact
original receipt bytes remain preserved as
[`HACKATHON_SUBSTRATE_LINK4_RECEIPT_KAIROS_2026-08-26_FROZEN.md`](HACKATHON_SUBSTRATE_LINK4_RECEIPT_KAIROS_2026-08-26_FROZEN.md),
SHA-256 `f22fd4384cf266851fba1067492832fc53524ec92ee5d3a32653f49a0a3803d0`.

## Observed blocker

The existing Daytona key is valid for sandbox operations but cannot register snapshots:

- direct sandbox list/create/delete: authenticated and successful;
- exact missing-snapshot GET: authenticated `404`;
- exact TrueForge snapshot-registration POST: `403 Forbidden`, body `Access denied`;
- TrueForge 0.1.4 converts that `403` into `422 Daytona rejected the API key — check the credentials`.

The bundled Daytona SDK models `write:snapshots` separately from `write:sandboxes`. The observed failure is missing snapshot-write authority, not an invalid key.

## No-rotation compatibility path

The same key created a Daytona sandbox directly from TrueForge's bundled image rather than a pre-registered snapshot:

```text
image: tfy.jfrog.io/tfy-images/trueforge-sandbox:0dab475d3d20a8333cff41f25f88e7134c424cf9
state: started
command: python -c "print(17*19)"
exit: 0
result: 323
cleanup: sandbox deleted
```

The compatibility change was applied only to the isolated clone's ignored `node_modules`, never to PR #1 or any tracked branch:

- original `DaytonaProvider.mjs`: `18e937c8aa45a246b719320fbe97f296e0bdd2ead9dfabee0d7d3abed3d08d4d`
- diagnostic patched bytes: `e8ea7168cb4398944f0d527f7597b9781ae4582859b1e1c89007f7b3ebee89a0`
- change: provision the same bundled image through `daytona.create({ image })`; skip account snapshot registration during provider setup.

## TrueForge end-to-end proof

Session `01m0zzzm68qvb1k2nevgd4xmps`, persisted turn `01m0zzzm7fw1q0ppv3p7ay9zaz.local`:

1. `model.message` emitted tool call `toolu_014xkQi7s3Xtn7KGAiDJVhio`.
2. Tool metadata: `type=truefoundry-system`, `name=exec`.
3. Arguments bound the command `python -c "print(17*19)"`.
4. `sandbox.created`: `v1:daytona:default.3bf5e51b-906b-4734-8997-7ac59bfd516e`.
5. Matching `tool.response` carried `success=true`, `exitCode=0`, `result="323\n"`.
6. Turn status: `done`; output: `DAYTONA_OK:323`.

The exact Daytona sandbox was then deleted: underlying ID `dfa0ab4f-8eb6-4d7c-8d13-0fcd525f9f59`.

The first probe printed `DAYTONA_SUBSTRATE_NOT_PROVEN` because it guessed `event.toolCalls`; persisted events expose `event.tool_calls`. That was a probe false negative. The persisted call ID, sandbox event, matching response, and terminal output establish the path.

## External report

Filed TrueFoundry issue: https://github.com/truefoundry/trueforge/issues/461

The requested Hono issue was **not** filed. A new clean install of `@truefoundry/trueforge@0.1.4`, followed by `@truefoundry/trueforge-sdk@0.1.3`, resolved `hono@4.13.5` at the root, imported `@hono/swagger-ui`, and reached server binding. The earlier failure therefore does not reproduce as an upstream clean-install defect; it is currently attributable to the project's older damaged lockfile. Publishing the brief's stronger claim would be false.

## Custody and ceiling

- Isolated clone HEAD stayed `5f6119609f632a616229c906dfa7f644601bdc1d`.
- PR #1 and its branch were not edited.
- No key value was printed, pasted, logged, or committed.
- This proves generated-command execution in Daytona returned through TrueForge under a local compatibility patch.
- It does **not** prove stock TrueForge 0.1.4 works with this scoped key, nor that the hackathon agent exists, reasons correctly, or enforces approval.
- PR #2 remains barred until PR #1 is merged and the execution-surface contract is frozen.
