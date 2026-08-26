# CORRECTION — THE `hono` FAILURE WAS NOT AN UPSTREAM BUG

**Recorded 2026-08-26. Corrects a false claim published by Ka'el.**

The prior freeze `SUBSTRATE_RUN_LOG_2026-08-26.md` (`14d85bd2`) is **not rewritten**. This record
sits beside it, per the rule that a freeze is immutable and a correction arrives as its own entry.

**Found by:** Kairos, who declined to file an upstream issue he had been briefed to file.

---

## What I claimed

Commit `5f61196`, public, on PR #1:

> `@hono/swagger-ui@0.2.2` hoists to the project root and declares `hono` as a peer with no bundled
> copy. hono@4.13.4 resolves nested under `@truefoundry/trueforge`, so the peer cannot be satisfied
> from where the consumer landed. **Upstream packaging issue in TrueForge 0.1.4, not in this repo;
> worth reporting to TrueFoundry.**

Repeated in `SUBSTRATE_RUN_LOG_2026-08-26.md` §4 as **S1**, and written into
`BRIEF_KAIROS_2026-08-26.md` as a task: file it upstream.

## What is actually true

A clean install with **no lockfile and no `hono` pin** hoists `hono` to root and resolves it:

```
package.json: @truefoundry/trueforge-sdk 0.1.3 + @truefoundry/trueforge 0.1.4, nothing else
npm install (no lockfile present)

node_modules/hono present:     YES
node_modules/@hono/swagger-ui: YES
hono resolves from root:       YES
nested copies:                 none
```

**There is no peer-resolution defect in TrueForge 0.1.4.** The dependency graph resolves correctly
when npm is allowed to resolve it.

## The real cause

Our committed `package-lock.json` was damaged. npm said so, out loud, during Kairos's `npm ci` in
his isolated clone:

```
npm warn reify invalid or damaged lockfile detected
npm warn reify please re-try this operation once it completes
npm warn reify so that the damage can be corrected, or perform
npm warn reify a fresh install with no lockfile if the problem persists
```

**I read past that warning and diagnosed the symptom.** The nested `hono` and the unsatisfiable
peer were both consequences of a corrupt lockfile, not of upstream packaging. The `hono@4.13.4`
pin I added does resolve the boot failure, and it resolves it for a reason I stated incorrectly.

## Why this correction matters more than the bug

**We nearly published a false defect report against another team's software, during their own
hackathon, under our own name.** The brief I wrote told Kairos to file it. He ran the check, found
it did not reproduce, and refused.

That is the maker/breaker rule working in the direction that costs something. Filing the issue
would have looked like more contribution and taken less effort than declining. **He took the option
that produced less visible output and more true output.**

The finding also lands on the discipline this project is built from: **an observed symptom is not a
diagnosed cause.** A nested package and an unsatisfiable peer are what the failure *looked like*.
The cause was one line of npm warning text that scrolled past.

## Disposition

- **Freeze `14d85bd2` stands unedited.** Its S1 entry is superseded by this record, not deleted.
- **Commit `5f61196`'s message cannot be corrected in place** without rewriting a branch already
  under Qodo review. The correction is recorded here and disclosed in PR #1.
- **`hono` pin:** keep or remove is a separate decision. The pin is harmless but its stated
  justification is void. The actual repair is a regenerated lockfile.
- **No upstream `hono` issue is to be filed.** TrueForge issue #461 (Daytona key validation) stands
  on its own evidence and is unaffected.

`CORRECTION RECORDED / UPSTREAM CLAIM WITHDRAWN / FOUND BY KAIROS`
