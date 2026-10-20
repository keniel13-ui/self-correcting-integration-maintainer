# Contributing

All substantive work follows this sequence:

1. branch from the integration branch (`dev` once it exists, otherwise `main`)
2. open a pull request against that branch
3. obtain a Qodo review
4. fix every valid High-severity finding, or dismiss it in-thread with a recorded reason
5. request a follow-up Qodo review
6. merge manually

Do not push substantive changes directly to `main`.

Never commit credentials, personal data, generated TrueForge state, or sandbox contents.

## Branches

- `main` holds reviewed, merged work.
- `dev` (optional) is an integration branch. If it exists, feature branches target `dev`, and
  `dev` is merged into `main` through its own reviewed pull request. To create it once:

  ```bash
  gh api repos/keniel13-ui/self-correcting-integration-maintainer/git/refs \
    -f ref=refs/heads/dev \
    -f sha=$(gh api repos/keniel13-ui/self-correcting-integration-maintainer/commits/main -q .sha)
  ```

- Name feature branches by intent, for example `fix/...`, `docs/...`, `test/...`.

## Before opening a pull request

```bash
npm ci
npm test
```

`npm test` is offline and must pass. If your change touches the live path, say in the pull request
which live run (if any) exercised it, and what the evidence does not prove. The pull request
template asks for this.

## Things a change must not do

- Edit frozen evidence (`docs/freezes/`, `docs/contracts/`, published priors, receipts, or the
  Run 004 corpus). Supersede it with a new dated document instead.
- Change `package.json` or `package-lock.json` without updating the `PACKAGE_SHA256` /
  `LOCK_SHA256` pins in `scripts/pr2/constants.mjs` and saying why in the pull request.
- Change `SYSTEM_INSTRUCTIONS`, `PROMPT_FRAME`, `JUDGMENT_SESSION_CONFIG`, or the judgment response
  schema without a new contract and prior. Existing priors are bound to their hashes.
- Give any model a capability to apply, commit, push, or approve a change.

See `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md` for the reasons behind these rules.
