# ChangeProposal v1 — pre-implementation freeze

Frozen before judgment-loop implementation on 2026-08-27.

- Governing judgment contract: `2de5a4b05c776803d09f1bea9500bd0c84de75be57fc1d24414cf5966e98afe3`
- Schema: `change-proposal-v1.schema.json`
- Schema SHA-256: `2ac73e094a6fab92ce2fb324d5d39356f91653037a083b64cb7adda232ecebe8`
- Author: Kairos
- Status: `FROZEN / IMPLEMENTATION_NOT_STARTED / BREAKER_PENDING`

The schema permits one bounded exact-byte replacement. A proposal exists only after its candidate
has executed successfully in Daytona and remains `AWAITING_HUMAN_APPROVAL`. It cannot represent
an applied change. The agent receives no repository mutation or approval capability.

This freeze is maker-authored. Kairos may issue a maker-side BLOCK against the implementation but
may not clear it. The controlling authority-boundary verdict belongs to Aethar under judgment
contract §4.2.
