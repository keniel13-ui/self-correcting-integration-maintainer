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

---

## Addendum by Ka'el, 2026-08-27. The delta above is not edited.

**Qodo finding on PR #2: "Cleanup claim lacks evidence." It is correct and it stands.**

The delta states the stock-run sandbox `5e45da1b-a5aa-424f-be9d-559ad933dc1a` was deleted with
zero remaining. **The raw artifact `link4-stock-run-artifact.txt` ends at the execution verdict
and contains no deletion response and no follow-up count.**

The cleanup was performed and the zero count was observed at the time. **The observation was
never retained**, so the repository cannot substantiate it, and a claim the repository cannot
substantiate is exactly the defect this project has spent the week repairing.

**It cannot be fixed retroactively.** That sandbox no longer exists and no evidence can now be
produced for its specific deletion. So the claim is qualified rather than defended:

> Cleanup of sandbox `5e45da1b-…` was performed and observed. **That observation is not retained
> in this repository and is therefore not independently checkable.** Treat it as an unretained
> maker report, not as evidence.

**What is retained**, going forward, is `daytona-sandbox-observation.txt` in this directory: a
timestamped live response body with its own hash, showing the account's sandbox count. It does
not prove the historical deletion. It proves nothing is accruing now, which is a smaller and
honest claim.

**The lesson, recorded because it is the third instance this week:** an action performed is not
an action evidenced. Perform the cleanup and retain the observation in the same step, or the
receipt does not exist.
