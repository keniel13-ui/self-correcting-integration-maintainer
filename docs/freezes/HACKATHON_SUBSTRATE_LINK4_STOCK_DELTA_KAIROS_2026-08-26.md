# HACKATHON SUBSTRATE — LINK 4 STOCK DELTA

**Seat:** Kairos / Codex  
**Date:** 2026-08-26 EDT  
**Status:** `LINK4_PROVEN_ON_STOCK / COMPATIBILITY_PATCH_RETIRED`

This supersedes only the reproducibility ceiling in `HACKATHON_SUBSTRATE_LINK4_RECEIPT_KAIROS_2026-08-26.md` (`f22fd438…`). The earlier locally patched run remains historical evidence and is not rewritten.

## Permission receipt

Read directly from `GET /api/api-keys/current`; no key value was printed or stored:

```json
{
  "permissions": [
    "delete:sandboxes",
    "write:sandboxes",
    "write:snapshots"
  ]
}
```

The original key's recorded permission array omitted `write:snapshots`. The replacement scope makes the upstream requirement explicit rather than inferred from the earlier `403`.

## Stock TrueForge proof

Ka'el stock-run artifact:

- path: `/private/tmp/claude-501/-Users-kenielmaldonado/976733ad-5c28-431f-9808-ca8ac8d8317c/tasks/bolsrqrzs.output`
- SHA-256: `c2e535fae036a9a475e7daa8d2307200a5bd067b513a1cc67462c52f987b453d`
- TrueForge: unmodified 0.1.4
- session: `01m104fvgy5tme1tpdjmy5p0fg`
- turn: `01m104fvmb4jx1mhvdjepcks36.local`
- sandbox: `v1:daytona:default.5e45da1b-a5aa-424f-be9d-559ad933dc1a`
- tool: `truefoundry-system / exec`
- command: `python3 -c "print(17*19)"`
- response: `success=true`, `exitCode=0`, `result="323\n"`
- terminal status: `done`; final output: `323`
- artifact verdict: `LINK4_PROVEN_ON_STOCK`
- sandbox cleanup: reported deleted; zero remaining.

## Public correction

Issue #461 evidence update:

https://github.com/truefoundry/trueforge/issues/461#issuecomment-5432119371

The comment records both permission arrays and the stock end-to-end result. The requested upstream fix is now narrow: distinguish invalid authentication from an authenticated key missing `write:snapshots`, and document/name the required permission.

## Resulting boundary

- Do not build or ship the local compatibility patch.
- PR #2 targets the stock sandbox execution surface after PR #1 merges.
- This proves the substrate path. It still does not prove the hackathon agent's judgment, repair quality, or approval invariant.
