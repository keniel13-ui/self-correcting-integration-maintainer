# ChangeProposal v2 — pre-implementation freeze

Frozen before authority implementation on 2026-08-27. V1 is preserved at schema hash
`2ac73e094a6fab92ce2fb324d5d39356f91653037a083b64cb7adda232ecebe8`.

- Governing judgment contract: `2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3`
- Controlling schema: `change-proposal-v2.schema.json`
- Schema SHA-256: `5fd077e8c615c586d6e24db7eb7760ffb147516772108734df6f352560df84b0`
- Author: Kairos
- Status: `FROZEN / AUTHORITY_IMPLEMENTATION_NOT_STARTED / BREAKER_PENDING`

## Maker-side defect in v1

V1 used `replacement_sha256` without defining whether it hashed the replacement fragment or the
complete resulting target file. Its `result_sha256` likewise failed to name which result it bound.
Two faithful implementations could produce incompatible receipts.

V2 names the first value `resulting_file_sha256` and defines it as the complete target file after
the exact replacement. It names the second `candidate_stdout_sha256` and defines it as stdout from
the sandbox verification command. No other field or authority state changed.

This is maker-authored. Kairos may BLOCK but may not clear it; Aethar retains the controlling
authority-boundary verdict.
