import {
  BASE_COMMIT,
  EMPTY_SHA256,
  ENTRYPOINT_SHA256,
  EXPECTED_RESULT_SHA256,
  FAILURE_ORDER,
  FIXTURE_SHA256,
  FORBIDDEN_VERDICT_WORDS,
  SDK_VERSION,
  TRUEFORGE_VERSION,
  CONTRACT_SHA256,
} from './constants.mjs';
import {
  assertClosedObject,
  canonicalJsonBytes,
  compareUtf8,
  parseStrictJson,
} from './canonical.mjs';
import { sha256, validateExecArguments } from './inputs.mjs';
import { validSandboxId } from './cleanup.mjs';

const SANDBOX_RESULT_KEYS = [
  'schema', 'run_id', 'candidate_bundle_sha256', 'entrypoint_sha256', 'fixture_sha256',
  'candidate_exit_code', 'candidate_stdout_sha256', 'candidate_stdout_length',
  'candidate_stderr_sha256', 'candidate_stderr_length', 'candidate_result',
];
const CANDIDATE_RESULT_KEYS = ['schema', 'candidate_id', 'input_sha256', 'status', 'payload'];
const FORBIDDEN_PAYLOAD_KEY = /credential|secret|token|timestamp|(?:^|_)path(?:$|_)|(?:^|_)log(?:$|_)/i;

function sortedUnique(values) {
  return [...new Set(values.filter(value => typeof value === 'string'))].sort(compareUtf8);
}

function parseContent(content) {
  if (typeof content === 'string') return parseStrictJson(content);
  if (content !== null && typeof content === 'object') return content;
  throw new TypeError('content is not JSON');
}

function payloadIsAllowed(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && !Object.is(value, -0);
  if (Array.isArray(value)) return value.every(payloadIsAllowed);
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, child]) => !FORBIDDEN_PAYLOAD_KEY.test(key) && payloadIsAllowed(child));
}

function validateSandboxResult(value, manifest) {
  assertClosedObject(value, SANDBOX_RESULT_KEYS, 'sandbox result');
  if (value.schema !== 'sandbox_execution_result/v1' || value.run_id !== manifest.run_id ||
      !Number.isSafeInteger(value.candidate_exit_code) ||
      !Number.isSafeInteger(value.candidate_stdout_length) || value.candidate_stdout_length < 0 ||
      !Number.isSafeInteger(value.candidate_stderr_length) || value.candidate_stderr_length < 0 ||
      !/^[0-9a-f]{64}$/.test(value.candidate_stdout_sha256) ||
      !/^[0-9a-f]{64}$/.test(value.candidate_stderr_sha256)) {
    throw new TypeError('sandbox result fields invalid');
  }
  return value;
}

function validateCandidateResult(value, manifest, sandboxResult) {
  assertClosedObject(value, CANDIDATE_RESULT_KEYS, 'candidate result');
  if (value.schema !== 'candidate_repair_result/v1' || value.candidate_id !== manifest.candidate_id ||
      value.input_sha256 !== FIXTURE_SHA256 || value.status !== 'ok' ||
      value.payload === null || typeof value.payload !== 'object' || Array.isArray(value.payload) ||
      !payloadIsAllowed(value.payload)) {
    throw new TypeError('candidate result fields invalid');
  }
  const bytes = canonicalJsonBytes(value);
  if (bytes.length !== sandboxResult.candidate_stdout_length) throw new TypeError('candidate stdout length mismatch');
  return bytes;
}

function responseEnvelope(responseEvent) {
  const content = parseContent(responseEvent.content);
  assertClosedObject(content, ['success', 'response'], 'exec tool response');
  assertClosedObject(content.response, ['exitCode', 'result'], 'exec response');
  if (content.success !== true || content.response.exitCode !== 0 || typeof content.response.result !== 'string') {
    throw new TypeError('exec response fields invalid');
  }
  return content.response.result;
}

function makeFailureList(found) {
  for (const reason of found) {
    if (!FAILURE_ORDER.includes(reason)) throw new TypeError(`unknown failure reason: ${reason}`);
  }
  return FAILURE_ORDER.filter(reason => found.has(reason));
}

export function reduceExecution({
  manifest,
  expectedExecArguments,
  requestSha256,
  sessionId = '',
  turnId = '',
  turnStatus,
  events = [],
  cleanup = { attempted_ids: [], confirmed_absent_ids: [], unconfirmed_ids: [], checked_at_utc: '' },
  preflight = [],
  providerRejected = false,
  versions = {},
  observedAtUtc = new Date().toISOString(),
}) {
  const failures = new Set(preflight);
  if (providerRejected) failures.add('PROVIDER_CONFIGURATION_REJECTED');
  if (turnStatus !== 'done') failures.add('TURN_NOT_DONE');

  const sandboxEvents = events.filter(event => event?.type === 'sandbox.created');
  const sandboxIds = sortedUnique(
    sandboxEvents.map(event => event?.sandbox_id).filter(validSandboxId),
  );
  if (sandboxEvents.length !== 1 || sandboxIds.length !== 1) failures.add('SANDBOX_EVENT_CARDINALITY_INVALID');

  const calls = events.flatMap(event => Array.isArray(event?.tool_calls) ? event.tool_calls : []);
  const call = calls.length === 1 ? calls[0] : null;
  if (!call || call?.function?.name !== 'exec' || call?.tool_info?.type !== 'truefoundry-system' ||
      call?.tool_info?.name !== 'exec' || typeof call.id !== 'string') {
    failures.add('EXEC_CALL_CARDINALITY_INVALID');
  }
  const execToolCallIds = sortedUnique(calls.map(item => item?.id));
  if (call) {
    try {
      const parsed = validateExecArguments(parseStrictJson(call.function.arguments));
      if (!canonicalJsonBytes(parsed).equals(canonicalJsonBytes(expectedExecArguments)) ||
          sha256(canonicalJsonBytes(parsed)) !== manifest.exec_arguments_sha256) {
        failures.add('EXEC_ARGUMENTS_MISMATCH');
      }
    } catch {
      failures.add('EXEC_ARGUMENTS_MISMATCH');
    }
  }

  const responses = events.filter(event => event?.type === 'tool.response');
  const response = responses.length === 1 ? responses[0] : null;
  if (!response) failures.add('TOOL_RESPONSE_CARDINALITY_INVALID');
  const matchedResponseIds = response && call && response.tool_call_id === call.id
    ? [response.tool_call_id]
    : [];
  if (response && (!call || response.tool_call_id !== call.id)) failures.add('TOOL_RESPONSE_ID_MISMATCH');

  let sandboxResult = null;
  if (response) {
    let resultLine;
    try {
      resultLine = responseEnvelope(response);
    } catch {
      failures.add('EXEC_RESPONSE_SHAPE_UNEXPECTED');
    }
    if (resultLine !== undefined) {
      try {
        const parsed = parseStrictJson(resultLine);
        if (!canonicalJsonBytes(parsed).equals(Buffer.from(resultLine, 'utf8'))) {
          throw new TypeError('sandbox result is not canonical');
        }
        sandboxResult = validateSandboxResult(parsed, manifest);
      } catch {
        failures.add('SANDBOX_RESULT_INVALID');
      }
    }
  }

  let evidenceSandboxResult = sandboxResult;
  if (sandboxResult) {
    if (sandboxResult.candidate_bundle_sha256 !== manifest.candidate_bundle_sha256 ||
        sandboxResult.entrypoint_sha256 !== ENTRYPOINT_SHA256 ||
        sandboxResult.fixture_sha256 !== FIXTURE_SHA256) {
      failures.add('CANDIDATE_BYTES_MISMATCH');
    }
    if (sandboxResult.candidate_exit_code !== 0) failures.add('CANDIDATE_EXIT_NONZERO');
    if (sandboxResult.candidate_stderr_length !== 0 || sandboxResult.candidate_stderr_sha256 !== EMPTY_SHA256) {
      failures.add('CANDIDATE_STDERR_NONEMPTY');
    }
    let candidateBytes = null;
    try {
      candidateBytes = validateCandidateResult(sandboxResult.candidate_result, manifest, sandboxResult);
    } catch {
      failures.add('CANDIDATE_RESULT_INVALID');
    }
    const resultHashMatches = candidateBytes && sha256(candidateBytes) === EXPECTED_RESULT_SHA256 &&
      sandboxResult.candidate_stdout_sha256 === sha256(candidateBytes) &&
      sandboxResult.candidate_stdout_sha256 === manifest.expected_candidate_result_sha256;
    if (candidateBytes && !resultHashMatches) {
      failures.add('CANDIDATE_RESULT_HASH_MISMATCH');
    }
    if (!resultHashMatches) {
      evidenceSandboxResult = { ...sandboxResult, candidate_result: null };
    }
  }

  const attemptedIds = sortedUnique(cleanup.attempted_ids ?? []);
  const confirmedAbsentIds = sortedUnique(cleanup.confirmed_absent_ids ?? []);
  const unconfirmedIds = sortedUnique(cleanup.unconfirmed_ids ?? []);
  const cleanupMatches = sandboxIds.length === attemptedIds.length &&
    sandboxIds.every((id, index) => id === attemptedIds[index]) &&
    sandboxIds.length === confirmedAbsentIds.length &&
    sandboxIds.every((id, index) => id === confirmedAbsentIds[index]) &&
    unconfirmedIds.length === 0;
  if (!cleanupMatches && sandboxIds.length > 0) failures.add('CLEANUP_UNCONFIRMED');

  const failureReasons = makeFailureList(failures);
  const evidence = {
    schema: 'sandbox_execution_evidence/v1',
    contract_sha256: CONTRACT_SHA256,
    base_commit: BASE_COMMIT,
    trueforge_version: versions.trueforgeVersion ?? TRUEFORGE_VERSION,
    sdk_version: versions.sdkVersion ?? SDK_VERSION,
    node_version: versions.nodeVersion ?? process.version,
    npm_version: versions.npmVersion ?? '',
    run_id: manifest.run_id,
    request_sha256: requestSha256,
    candidate_bundle_sha256: manifest.candidate_bundle_sha256,
    session_id: sessionId,
    turn_id: turnId,
    sandbox_ids: sandboxIds,
    exec_tool_call_ids: execToolCallIds,
    matched_tool_response_ids: matchedResponseIds,
    turn_status: ['done', 'error', 'cancelled', 'timeout'].includes(turnStatus) ? turnStatus : 'error',
    sandbox_result: evidenceSandboxResult,
    cleanup: {
      attempted_ids: attemptedIds,
      confirmed_absent_ids: confirmedAbsentIds,
      unconfirmed_ids: unconfirmedIds,
      checked_at_utc: cleanup.checked_at_utc ?? '',
    },
    status: failureReasons.length === 0 ? 'EXECUTED_IN_DAYTONA' : 'NOT_ESTABLISHED',
    failure_reasons: failureReasons,
    observed_at_utc: observedAtUtc,
  };
  const serialized = JSON.stringify(evidence);
  if (FORBIDDEN_VERDICT_WORDS.some(word => new RegExp(`\\b${word}\\b`).test(serialized))) {
    throw new TypeError('evidence contains a forbidden verdict word');
  }
  return evidence;
}
