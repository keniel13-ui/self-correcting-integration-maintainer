# Run 004 sealed corpus — published after the run

These are the exact bytes the judgment agent inspected in Run 004. They were **not published before
the run**, which is the condition `PRIOR_KNOWLEDGE_RUN_004.json` places on them. The run has
completed, so they are released here so the run's byte-level claims can be recomputed by anyone.

Verify against the manifest hash that was frozen before the run:

```bash
shasum -a 256 manifest.json
# 914b22f52a9d7d8ce382458caa3915cc47841ccfd153f72f314107c55be08fb6
```

That value is bound as `corpus_manifest_sha256` in the prior
(`93820ea5a67e732aa55e896cd838200c3590af1e98368fd87e85dfd66da1cf1e`) and in
`RUN_004_RECEIPT.json`. The manifest in turn pins each file:

| file | SHA-256 |
|---|---|
| `forms.mjs` | `1a56995c1f24bcc4e1890ad4af66d71e86f829daacd62e07c8cc226304c55ed5` |
| `release.mjs` | `ebaa454c02e2def38df1538185a29c0a55732f4a3c18a14f263b170d470c82bf` |

With these bytes you can independently recompute the assertion the harness made during the run:
that the finding's `exact_bytes` occurs **exactly once** in `forms.mjs`.
