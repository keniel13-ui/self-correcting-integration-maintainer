> **V4 AMENDMENT, 2026-08-27.** This supersedes V3 only for one reducer consistency defect:
> §4 requires `EXEC_RESPONSE_SHAPE_UNEXPECTED`, while §5 omitted it from the exhaustive list and
> T11 did not name the nested-response attack.
>
> Preserved, unedited predecessors: V1
> `8ba343557a4d2d76f28748cc606cc378ff55a4ec0fa88017d17ec04ecbd2172a`; V2
> `9a1ac72040ee9dc3d37fd05cd078c60c22c5ad2a0331e0c282273a557a709f91`; V3
> `e9c854e2f01c19846d254108b5358532c9d87446d83489322e17f3fe0a42f829`.
>
> **Status:** `FROZEN V4 / CONTRACT ONLY / NO CODE / BREAKER_PENDING`
>
> **V3 AMENDMENT, 2026-08-26.** This supersedes V2 (`9a1ac720`) in **§4 only**. V2 is preserved
> and not rewritten. The amendment corrects a frozen wire shape that did not match the harness.
>
> **Found by Kairos, before implementation, by reading the contract against the stock link-4
> receipt rather than against the contract's own prose.** V2 §4 froze the exec tool response as a
> flat `{success, exitCode, result}` object. Stock TrueForge 0.1.4 persists
> `{"success":true,"response":{"exitCode":0,"result":"..."}}` — the fields are nested. Implementing
> the written shape would have produced a false negative on every live run.
>
> This is the third contract in eight days that described an API that does not exist. The first
> (`/healthz` returning JSON with `status: "ok"`) shipped, went green in tests, and failed the
> first time it met a real harness. This one never reached code. **Nothing but a breaker reading
> the contract against a measurement catches this class**, because the implementation is faithful
> and the tests pass either way.
>
> Ka'el authored V1, V2, and this amendment and is disqualified from clearing any of them.

# TrueForge hackathon — PR #2 sandbox execution-surface contract v2

**Status:** `FROZEN V2 / CONTRACT ONLY / NO CODE / BREAKER_PENDING`  
**Supersedes:** v1 SHA-256 `8ba343557a4d2d76f28748cc606cc378ff55a4ec0fa88017d17ec04ecbd2172a`, preserved unedited; v2 repairs only B1–B3  
**Contract author:** Ka’el — disqualified from implementation and controlling PASS  
**Implementer:** Kairos  
**Independently assigned breaker:** Aethar  
**Authority:** the exact whole-file SHA-256 reported with this frozen artifact

## 1. Purpose and boundary

PR #2 may implement one narrow surface: move an already-authored candidate repair through stock
TrueForge `0.1.4`, execute it only inside one Daytona sandbox, and reduce persisted harness events
into structured execution evidence.

This surface does **not** detect an anomaly, choose a repair, judge correctness, remember a lesson,
reflect, request or grant approval, promote code, merge code, or perform an external domain action.
It creates no memory, judgment, reflection, approval, authority, or self-improvement logic. The
candidate is fixed before the turn. Model prose is never a verdict.

The only deletion allowed is cleanup of an ephemeral Daytona sandbox whose exact ID was created by
the same run. No repository mutation, deployment, message, purchase, account change, credential
rotation, or other irreversible action is in scope.

## 2. Frozen base and pre-existing disclosure

Implementation must branch from the merged public base:

| Input | Frozen value |
|---|---|
| repository | `keniel13-ui/self-correcting-integration-maintainer` |
| merged base commit | `29ac06fc42c01775d1fb13baef547c41a6807f75` |
| PR #1 final reviewed head | `121a24ffcf5012208c77cc5a54143fea3f1113b0` |
| `package.json` SHA-256 | `ebf0f7617475c9099756964e6514a74ce2bfbf5f040af0d1d48762bd73af6447` |
| `package-lock.json` SHA-256 | `3562d4afbad33867edcbffc9e8f569c740f86c0f5e013ff554a8e9794b939d95` |
| TrueForge | `@truefoundry/trueforge@0.1.4` |
| SDK | `@truefoundry/trueforge-sdk@0.1.3` |

Direct `GET /api/api-keys/current` receipts established the permission boundary. The original
key’s returned permission array omitted `write:snapshots`. The replacement key’s returned array
was exactly `["delete:sandboxes","write:sandboxes","write:snapshots"]`; no key value was printed
or stored. This is observed scope evidence, not an inference from the earlier `403`.

Stock, unmodified TrueForge `0.1.4` then completed Link 4 end to end. The stock-run artifact is
SHA-256 `c2e535fae036a9a475e7daa8d2307200a5bd067b513a1cc67462c52f987b453d`.
The delta receipt
`HACKATHON_SUBSTRATE_LINK4_STOCK_DELTA_KAIROS_2026-08-26.md` is SHA-256
`3e17169b4d1039839df1a5755a6be47047ac8eeac2f24970089d2105b782004d`: one stock
`truefoundry-system/exec` call returned exit `0`, result `323\n`, terminal `done`, and the
sandbox was deleted with zero remaining. This proves the stock substrate path only.

The ignored local compatibility patch is retired and is not a PR #2 source or fallback. PR #2 must
not patch `node_modules`, monkey-patch package internals, register a replacement snapshot, rotate
a key, or bypass a stock provider rejection. A clean install must use the frozen lock. Any future
stock provider rejection remains a blocked integration receipt, not a code workaround and not a
PASS. Issue `truefoundry/trueforge#461` remains the public record of the earlier error-message and
permission-documentation defect.

## 3. Candidate input interface

Before any model turn, the implementation creates these local, ignored artifacts under one fresh
run directory. None contains a credential.

### 3.1 `candidate_manifest.json`

Closed schema `candidate_execution_manifest/v1`:

```text
schema: const candidate_execution_manifest/v1
contract_sha256: 64 lowercase hex; this frozen whole-file hash
base_commit: const 29ac06fc42c01775d1fb13baef547c41a6807f75
run_id: string matching ^pr2-[0-9a-f]{32}$
candidate_id: nonempty ASCII [a-z0-9._-], maximum 80 bytes
entrypoint: safe relative POSIX path ending .mjs
fixture_path: safe relative POSIX path ending .json
files: array length 2..32 of closed records:
  path: safe relative POSIX path
  size_bytes: integer 0..1048576
  sha256: 64 lowercase hex over exact raw bytes
candidate_bundle_sha256: 64 lowercase hex, derived below
expected_candidate_result_sha256: 64 lowercase hex
exec_arguments_sha256: 64 lowercase hex over canonical expected_exec_arguments.json
maximum_turn_ms: const 60000
network_required: const false
credentials_required: const false
irreversible_actions_allowed: const false
```

Safe paths are nonempty UTF-8, use `/`, are already normalized, contain no empty, `.` or `..`
segment, do not begin `/`, contain no NUL or backslash, and are unique. `entrypoint` and
`fixture_path` must each name one listed file. `files` is sorted by raw UTF-8 path bytes and has no
extra fields.

For each file, recompute size and SHA-256 from disk before a turn. Derive the bundle digest as
SHA-256 over:

```text
UTF8("candidate-bundle/v1\0")
then, for each sorted file:
  U64BE(path byte length) || UTF8(path) || U64BE(content byte length) || raw content bytes
```

Any mismatch is `INPUT_INVALID`; no session or turn may be created.

### 3.2 Canonical JSON

Every contract-owned JSON object is serialized as UTF-8 with recursively lexicographically sorted
keys by raw UTF-8 bytes, arrays retained in stated order, no insignificant whitespace, no ASCII
escaping, and one final LF. Integers only; `NaN`, infinity, negative zero, duplicate keys, unknown
keys, and non-NFC strings are invalid. A `*_sha256` for a JSON artifact covers these exact bytes.

### 3.3 Candidate result

The candidate receives only the named fixture and must write exactly one canonical JSON line to
stdout with closed schema:

```text
schema: const candidate_repair_result/v1
candidate_id: exact manifest candidate_id
input_sha256: exact fixture file sha256
status: const ok
payload: JSON object with no credential, timestamp, path, or free-form log
```

The SHA-256 of those exact stdout bytes must equal `expected_candidate_result_sha256`. Stderr must
be empty. Candidate exit must be `0`. The contract does not interpret `payload`; equality to the
precommitted bytes is the ceiling.

### 3.4 Closed exec arguments and request hash

`expected_exec_arguments.json` is a closed JSON object with exactly one key:

```text
command: nonempty printable ASCII string, 1..65535 bytes, with no NUL, CR or LF
```

No `cwd`, `env`, timeout, shell, user, network, approval, or unknown key is permitted. Its
canonical bytes are produced by §3.2. Define:

```text
exec_arguments_sha256 = SHA256(canonical expected_exec_arguments.json bytes)
```

The runtime `function.arguments` string must parse as JSON, satisfy that exact closed schema, and
canonicalize to the same bytes and digest. String comparison before parsing is not sufficient; a
second key, duplicate key, alternate command byte, or invalid encoding is
`EXEC_ARGUMENTS_MISMATCH`.

Before a turn, write `execution_request.json` with closed schema
`candidate_execution_request/v1`:

```text
schema: const candidate_execution_request/v1
contract_sha256: 64 lowercase hex; this v2 whole-file hash
base_commit: const 29ac06fc42c01775d1fb13baef547c41a6807f75
run_id: exact candidate_manifest.json run_id
candidate_manifest_sha256: SHA-256 of canonical candidate_manifest.json bytes
candidate_bundle_sha256: exact manifest value
expected_candidate_result_sha256: exact manifest value
exec_arguments_sha256: exact expected_exec_arguments.json digest
maximum_turn_ms: const 60000
```

It has no `request_sha256` member. Define
`request_sha256 = SHA256(canonical execution_request.json bytes)`. Recompute the manifest,
arguments and request digests immediately before session creation; any disagreement is
`INPUT_INVALID` and creates no session or paid turn.

### 3.5 Frozen maker-integration candidate

The required maker integration may use only the following two exact files, both ending with one LF.
This pins the candidate before any turn rather than letting the live manifest choose it.

`candidate/repair.mjs` — 475 bytes; SHA-256
`7af966d5e7c8b6ff0d1444efe0aade256c6f7c5c28b08c0b2ef76466bbd766d0`:

```js
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const bytes = readFileSync(process.argv[2]);
const input = JSON.parse(bytes.toString("utf8"));
const result = {
  candidate_id: "pr2-stock-daytona-fixture-v1",
  input_sha256: createHash("sha256").update(bytes).digest("hex"),
  payload: { customer_id: input.customer.externalId },
  schema: "candidate_repair_result/v1",
  status: "ok"
};
process.stdout.write(JSON.stringify(result) + "\n");
```

`candidate/fixture.json` — 56 bytes; SHA-256
`322fce3981bac637fb5ac98fe205daee75b1e2843751fe8d128c148fab9cd7fe`:

```json
{"customer":{"externalId":"acct-7"},"schema_version":2}
```

For the §3.1 length framing and raw UTF-8 path order
`candidate/fixture.json`, `candidate/repair.mjs`, the exact
`candidate_bundle_sha256` is
`2246af1c59b0bd288da58cced31a208f20c4844244222becbe4375640aa17075`.
The manifest values are fixed to candidate ID `pr2-stock-daytona-fixture-v1`, entrypoint
`candidate/repair.mjs`, fixture path `candidate/fixture.json`, and those two file records only.

Expected candidate stdout is exactly 217 bytes including its final LF:

```json
{"candidate_id":"pr2-stock-daytona-fixture-v1","input_sha256":"322fce3981bac637fb5ac98fe205daee75b1e2843751fe8d128c148fab9cd7fe","payload":{"customer_id":"acct-7"},"schema":"candidate_repair_result/v1","status":"ok"}
```

Its `expected_candidate_result_sha256` is
`dd2dbd25d9b3ff350edc515ba17e86598eddeed2a99d95ea3db4d02690457082`.
Any other candidate, fixture, output, file count or bundle digest is outside this maker integration
and requires a later contract; it cannot be substituted by changing the manifest.

## 4. TrueForge-to-Daytona execution path

The implementation may read candidate bytes as data and hash or encode them. It may not
`import`, `require`, `eval`, execute, or spawn the candidate on the host.

One run uses exactly one inline TrueForge session and one turn:

1. Recompute the base, dependency, manifest, bundle, and expected-exec-argument hashes.
2. Use unmodified stock TrueForge `0.1.4` and SDK `0.1.3` from the clean lock install.
3. Configure one model and the stock Daytona sandbox provider through TrueForge. Secrets arrive
   from the operator environment or existing TrueForge storage and are never serialized.
4. Create an inline agent with sandbox enabled; MCP servers, skills, subagents, file downloads,
   approval tools, and persistent agent registration are disabled or absent.
5. Give the model the closed request and require one `truefoundry-system` tool call named `exec`.
   The parsed call arguments must be exactly the closed object stored as
   `expected_exec_arguments.json`; its canonical hash must match `exec_arguments_sha256`.
6. That one command creates the listed bytes inside the sandbox, recomputes their hashes, invokes
   exactly `node <entrypoint> <fixture_path>`, captures candidate stdout/stderr/exit, and emits one
   canonical `sandbox_execution_result/v1` JSON line. No shell token may be interpolated from an
   unvalidated path or candidate output.
7. Persisted TrueForge events—not streaming deltas and not the assistant’s summary—are reduced.

Closed sandbox result schema:

```text
schema: const sandbox_execution_result/v1
run_id: exact manifest run_id
candidate_bundle_sha256: exact manifest value
entrypoint_sha256: exact manifest file value
fixture_sha256: exact manifest file value
candidate_exit_code: integer
candidate_stdout_sha256: 64 lowercase hex
candidate_stdout_length: integer >= 0
candidate_stderr_sha256: 64 lowercase hex
candidate_stderr_length: integer >= 0
candidate_result: parsed candidate_repair_result/v1 object or null
```

The outer matching `tool.response.content` must parse as a closed object of shape
`exec_tool_response/v1`, **measured against stock TrueForge 0.1.4 on 2026-08-26**, not assumed:

```json
{"success": true, "response": {"exitCode": 0, "result": "323\n"}}
```

`exitCode` and `result` are **nested under `response`**, not top level. The matcher MUST read
`content.success === true`, `content.response.exitCode === 0`, and `content.response.result`
equal to the exact sandbox-result line. A matcher written against a flat
`{success, exitCode, result}` object returns a false negative on every real run.

If `content.response` is absent, the row is `NOT_ESTABLISHED` with reason
`EXEC_RESPONSE_SHAPE_UNEXPECTED` and the observed top-level keys recorded. **A shape change is a
contract change and must fail loudly, never be coerced.** A model statement such as "it worked"
cannot fill any missing field.

## 5. Structured execution evidence

The deterministic reducer writes one ignored local artifact
`sandbox_execution_evidence.json`, closed schema `sandbox_execution_evidence/v1`:

```text
schema
contract_sha256
base_commit
trueforge_version
sdk_version
node_version
npm_version
run_id
request_sha256
candidate_bundle_sha256
session_id
turn_id
sandbox_ids[]
exec_tool_call_ids[]
matched_tool_response_ids[]
turn_status: done|error|cancelled|timeout
sandbox_result: sandbox_execution_result/v1|null
cleanup:
  attempted_ids[]
  confirmed_absent_ids[]
  unconfirmed_ids[]
  checked_at_utc
status: EXECUTED_IN_DAYTONA|NOT_ESTABLISHED
failure_reasons[]
observed_at_utc
```

IDs and timestamps are provenance and do not enter any correctness judgment. Arrays are sorted
unique. `failure_reasons` contains every applicable reason in this exact order:

1. `INPUT_INVALID`
2. `BASE_MISMATCH`
3. `DEPENDENCY_MISMATCH`
4. `PROVIDER_CONFIGURATION_REJECTED`
5. `TURN_NOT_DONE`
6. `SANDBOX_EVENT_CARDINALITY_INVALID`
7. `EXEC_CALL_CARDINALITY_INVALID`
8. `EXEC_ARGUMENTS_MISMATCH`
9. `TOOL_RESPONSE_CARDINALITY_INVALID`
10. `TOOL_RESPONSE_ID_MISMATCH`
11. `EXEC_RESPONSE_SHAPE_UNEXPECTED`
12. `SANDBOX_RESULT_INVALID`
13. `CANDIDATE_BYTES_MISMATCH`
14. `CANDIDATE_EXIT_NONZERO`
15. `CANDIDATE_STDERR_NONEMPTY`
16. `CANDIDATE_RESULT_INVALID`
17. `CANDIDATE_RESULT_HASH_MISMATCH`
18. `CLEANUP_UNCONFIRMED`

`EXECUTED_IN_DAYTONA` requires an empty failure list, terminal turn `done`, exactly one
`sandbox.created`, exactly one matching `exec` call and response, all byte/result checks, and
confirmed absence of every created sandbox after cleanup. Otherwise status is `NOT_ESTABLISHED`.
The reducer never emits PASS, SAFE, CORRECT, APPROVED, PROMOTED, or FIXED.

## 6. Failure, timeout, and cleanup semantics

- Preflight failures create no TrueForge session or paid turn.
- Provider `401`, `403`, `422`, timeout, or unavailable state maps to
  `PROVIDER_CONFIGURATION_REJECTED`; do not reinterpret the provider or credential cause.
- A turn deadline cancels the exact turn/session if possible and records `TURN_NOT_DONE`.
- Missing or duplicate events never default to zero or success.
- An assistant output cannot substitute for a persisted call, response, or sandbox event.
- A nonzero candidate exit, any stderr byte, malformed JSON, or any hash mismatch is failure.
- Cleanup runs in `finally`, on success and failure. It targets only exact unique sandbox IDs from
  this run. No wildcard, prefix, account-wide list deletion, snapshot deletion, or unrelated ID.
- Cleanup is confirmed only when every exact run-owned sandbox is absent. A delete response alone
  is insufficient; absence must be re-observed. Timeout or uncertainty is
  `CLEANUP_UNCONFIRMED` and blocks `EXECUTED_IN_DAYTONA`.
- Raw credentials, environment dumps, model keys, Daytona keys, provider manifests containing
  keys, or complete process environments never enter prompts, logs, events, evidence, fixtures,
  test snapshots, exceptions, or committed files.

## 7. Exact required tests

All tests are deterministic and offline unless marked `MAKER_INTEGRATION`.

| ID | Required test and expected result |
|---|---|
| T01 | Canonical JSON key order, LF, Unicode NFC, integer rules; malformed/duplicate/unknown fields reject. |
| T02 | Safe-path table rejects absolute, `..`, `.`, empty segment, backslash, NUL, duplicate and unsorted paths. |
| T03 | Bundle derivation changes on path, length, order, or one content byte; exact fixture recomputes identically. |
| T04 | Missing file, size/hash mismatch, bad entrypoint/fixture reference blocks before session creation. |
| T05 | Wrong contract hash, base commit, package versions, package or lock hash returns the exact preflight reason. |
| T06 | Host-execution inversion: candidate bytes that throw if imported are never imported/spawned locally; mocked sandbox receives data only. |
| T07 | Reducer success fixture requires one `sandbox.created`, one stock-system `exec`, one ID-matched response and terminal `done`. |
| T08 | Assistant success prose with no tool evidence returns `EXEC_CALL_CARDINALITY_INVALID`. |
| T09 | Zero or two sandbox events/calls/responses return the corresponding cardinality reason; no first/last selection. |
| T10 | Changed exec argument, call ID or response ID returns the exact mismatch reason. |
| T11 | Nested-response attack: flat `{success,exitCode,result}`, missing/non-object/extra-key `response`, `response.exitCode!=0`, or missing/non-string `response.result` yields `EXEC_RESPONSE_SHAPE_UNEXPECTED`; a valid nested envelope with malformed inner sandbox result yields `SANDBOX_RESULT_INVALID`. |
| T12 | Entry, fixture or bundle hash disagreement inside the sandbox result returns `CANDIDATE_BYTES_MISMATCH`. |
| T13 | Candidate nonzero, stderr byte, malformed result, or stdout hash mismatch each returns its exact reason. |
| T14 | Turn error/cancel/timeout never reduces to success and always enters cleanup. |
| T15 | Cleanup targets only exact same-run IDs; duplicate IDs dedupe; unrelated-ID and wildcard attacks reject. |
| T16 | Delete success without re-observed absence returns `CLEANUP_UNCONFIRMED`. |
| T17 | Sentinel model/Daytona secrets never appear in serialized requests, logs, evidence or thrown errors. |
| T18 | Stock-provider rejection is preserved as `PROVIDER_CONFIGURATION_REJECTED`; no fallback mutates dependencies or calls Daytona execution directly. |
| T19 | Fresh-clone integrity: `npm ci` has no damaged-lock warning; `npm ls --all` has no invalid/extraneous packages; installed versions match the pins; repository diff remains empty. |
| T20 | Full offline reducer suite recomputes `failure_reasons` as a sorted exhaustive list and never emits a safety/correctness/approval word. |

After implementation and offline tests, this contract requires exactly one bounded
`MAKER_INTEGRATION` attempt: fresh clone of the implementation head, one model session, one turn,
one Daytona sandbox, maximum 60 seconds, and mandatory cleanup. It may incur the minimal model and
Daytona cost needed to establish the real path. Its receipt must include the request/evidence
hashes, persisted event IDs, observed token/cost metrics when exposed, and cleanup confirmation.
If stock configuration blocks before execution, record that result and stop; a retry or credential
change requires a new owner go.

## 8. Evidence ceiling and custody

`EXECUTED_IN_DAYTONA` proves only that the manifest-bound candidate bytes were observed executing
once in a Daytona sandbox through the pinned TrueForge path, returned the precommitted structured
result, and the run-owned sandbox was cleaned up.

It does **not** prove the candidate is a correct repair, the incident is diagnosed, the integration
is healthy, the agent is intelligent or self-correcting, the sandbox has no egress, the provider
works generally, an irreversible action is safe, or anything is authorized to merge/deploy.

Kairos may implement and issue maker-side BLOCK or a noncontrolling integration receipt. Ka’el may
issue BLOCK on this contract but cannot implement or clear it. Aethar is the independently assigned
breaker and alone may issue the controlling execution-surface verdict after receiving the frozen
contract hash and stable implementation hash. Qodo review is required for the PR workflow but does
not substitute for Aethar’s breaker verdict. Keniel alone owns live credentials, any retry, and the
human merge.

`FROZEN / IMPLEMENTATION_NOT_STARTED_BY_THIS_ARTIFACT / MAKER_INTEGRATION_REQUIRED / BREAKER_PENDING`

