export const CONTRACT_SHA256 = '27e0531dbcad60d9a3693dfdfda5b4972cc0678129237d274e12b8df48269d84';
export const BASE_COMMIT = '29ac06fc42c01775d1fb13baef547c41a6807f75';
export const PACKAGE_SHA256 = 'ebf0f7617475c9099756964e6514a74ce2bfbf5f040af0d1d48762bd73af6447';
export const LOCK_SHA256 = '3562d4afbad33867edcbffc9e8f569c740f86c0f5e013ff554a8e9794b939d95';
export const TRUEFORGE_VERSION = '0.1.4';
export const SDK_VERSION = '0.1.3';
export const MAXIMUM_TURN_MS = 60_000;

export const CANDIDATE_ID = 'pr2-stock-daytona-fixture-v1';
export const ENTRYPOINT = 'candidate/repair.mjs';
export const FIXTURE_PATH = 'candidate/fixture.json';

export const ENTRYPOINT_BYTES = Buffer.from(
  'import { createHash } from "node:crypto";\n' +
  'import { readFileSync } from "node:fs";\n' +
  '\n' +
  'const bytes = readFileSync(process.argv[2]);\n' +
  'const input = JSON.parse(bytes.toString("utf8"));\n' +
  'const result = {\n' +
  '  candidate_id: "pr2-stock-daytona-fixture-v1",\n' +
  '  input_sha256: createHash("sha256").update(bytes).digest("hex"),\n' +
  '  payload: { customer_id: input.customer.externalId },\n' +
  '  schema: "candidate_repair_result/v1",\n' +
  '  status: "ok"\n' +
  '};\n' +
  'process.stdout.write(JSON.stringify(result) + "\\n");\n',
  'utf8',
);

export const FIXTURE_BYTES = Buffer.from(
  '{"customer":{"externalId":"acct-7"},"schema_version":2}\n',
  'utf8',
);

export const EXPECTED_CANDIDATE_RESULT_BYTES = Buffer.from(
  '{"candidate_id":"pr2-stock-daytona-fixture-v1","input_sha256":"322fce3981bac637fb5ac98fe205daee75b1e2843751fe8d128c148fab9cd7fe","payload":{"customer_id":"acct-7"},"schema":"candidate_repair_result/v1","status":"ok"}\n',
  'utf8',
);

export const ENTRYPOINT_SHA256 = '7af966d5e7c8b6ff0d1444efe0aade256c6f7c5c28b08c0b2ef76466bbd766d0';
export const FIXTURE_SHA256 = '322fce3981bac637fb5ac98fe205daee75b1e2843751fe8d128c148fab9cd7fe';
export const BUNDLE_SHA256 = '2246af1c59b0bd288da58cced31a208f20c4844244222becbe4375640aa17075';
export const EXPECTED_RESULT_SHA256 = 'dd2dbd25d9b3ff350edc515ba17e86598eddeed2a99d95ea3db4d02690457082';

export const FAILURE_ORDER = Object.freeze([
  'INPUT_INVALID',
  'BASE_MISMATCH',
  'DEPENDENCY_MISMATCH',
  'PROVIDER_CONFIGURATION_REJECTED',
  'TURN_NOT_DONE',
  'SANDBOX_EVENT_CARDINALITY_INVALID',
  'EXEC_CALL_CARDINALITY_INVALID',
  'EXEC_ARGUMENTS_MISMATCH',
  'TOOL_RESPONSE_CARDINALITY_INVALID',
  'TOOL_RESPONSE_ID_MISMATCH',
  'EXEC_RESPONSE_SHAPE_UNEXPECTED',
  'SANDBOX_RESULT_INVALID',
  'CANDIDATE_BYTES_MISMATCH',
  'CANDIDATE_EXIT_NONZERO',
  'CANDIDATE_STDERR_NONEMPTY',
  'CANDIDATE_RESULT_INVALID',
  'CANDIDATE_RESULT_HASH_MISMATCH',
  'CLEANUP_UNCONFIRMED',
]);

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const FORBIDDEN_VERDICT_WORDS = Object.freeze([
  'PASS', 'SAFE', 'CORRECT', 'APPROVED', 'PROMOTED', 'FIXED',
]);
