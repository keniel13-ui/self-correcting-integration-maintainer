import { Buffer } from 'node:buffer';
import { canonicalJsonBytes, parseStrictJson, assertClosedObject } from '../pr2/canonical.mjs';
import { cleanupSandboxes, createdSandboxIds } from '../pr2/cleanup.mjs';
import { sha256 } from '../pr2/inputs.mjs';
import { daytonaCleanupProvider } from '../pr2/run.mjs';
import { BoundedHttpError, TrueForgeClient } from '../pr2/trueforge-client.mjs';
import {
  JUDGMENT_RESPONSE_FORMAT,
  JUDGMENT_SESSION_CONFIG,
  MAX_MODEL_TURN_MS,
  MAX_SANDBOX_TURN_MS,
  RUNTIME_TOOL_SURFACE_SHA256,
} from './constants.mjs';
import { parseCandidateResult } from './candidate.mjs';
import {
  assertJudgmentRuntimeInstallation,
  assertReturnedJudgmentSessionConfig,
} from './runtime-surface.mjs';

const TERMINAL = new Set(['done', 'error', 'cancelled']);
const FAILURE_ORDER = [
  'INPUT_INVALID',
  'BASE_MISMATCH',
  'DEPENDENCY_MISMATCH',
  'PROVIDER_CONFIGURATION_REJECTED',
  'OUTBOUND_ARTIFACT_CARDINALITY_INVALID',
  'OUTBOUND_ARTIFACT_HASH_MISMATCH',
  'EXEC_COMMAND_OVERSIZE',
  'TURN_NOT_DONE',
  'SANDBOX_EVENT_CARDINALITY_INVALID',
  'EXEC_CALL_CARDINALITY_INVALID',
  'EXEC_ARGUMENTS_MISMATCH',
  'TOOL_RESPONSE_CARDINALITY_INVALID',
  'TOOL_RESPONSE_ID_MISMATCH',
  'EXEC_RESPONSE_SHAPE_UNEXPECTED',
  'SANDBOX_RESULT_INVALID',
  'VERIFIER_IDENTITY_MISMATCH',
  'MANIFEST_IDENTITY_MISMATCH',
  'CANDIDATE_BYTES_MISMATCH',
  'CANDIDATE_EXIT_NONZERO',
  'CANDIDATE_STDERR_NONEMPTY',
  'CANDIDATE_RESULT_INVALID',
  'CANDIDATE_RESULT_HASH_MISMATCH',
  'CLEANUP_UNCONFIRMED',
];

const OUTBOUND_ROLES = ['verifier', 'payload', 'manifest'];
const OUTBOUND_ARTIFACT_KEYS = [
  'role', 'name', 'mime', 'intended_sandbox_path', 'sha256', 'size_bytes', 'data_uri',
];
const EMPTY_SHA256 = sha256(Buffer.alloc(0));
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const JUDGMENT_EVENT_FAILURE_ORDER = [
  'JUDGMENT_EVENTS_UNAVAILABLE',
  'JUDGMENT_EVENT_SHAPE_INVALID',
  'JUDGMENT_FORBIDDEN_EVENT',
  'JUDGMENT_TURN_NOT_DONE',
  'JUDGMENT_TERMINAL_EVENT_CARDINALITY_INVALID',
  'JUDGMENT_TOOL_CALL_CARDINALITY_INVALID',
  'JUDGMENT_TOOL_CALL_SHAPE_INVALID',
  'JUDGMENT_TOOL_ARGUMENTS_INVALID',
  'JUDGMENT_TOOL_RESPONSE_CARDINALITY_INVALID',
  'JUDGMENT_TOOL_RESPONSE_ID_MISMATCH',
];
const JUDGMENT_EVENT_TYPES = new Set(['turn.created', 'model.message', 'tool.response', 'turn.done']);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function artifactExpectations(prepared) {
  const transport = prepared?.commandManifest?.transport;
  return {
    verifier: {
      name: transport?.verifier_file_name,
      intended_sandbox_path: transport?.verifier_path,
      sha256: prepared?.verifierSha256,
    },
    payload: {
      name: transport?.payload_file_name,
      intended_sandbox_path: transport?.payload_path,
      sha256: transport?.payload_artifact_sha256,
    },
    manifest: {
      name: transport?.manifest_file_name,
      intended_sandbox_path: transport?.manifest_path,
      sha256: prepared?.commandManifestSha256,
    },
  };
}

function decodeOutboundArtifact(artifact) {
  assertClosedObject(artifact, OUTBOUND_ARTIFACT_KEYS, 'outbound artifact');
  const prefix = `data:${artifact.mime};base64,`;
  if (artifact.mime !== 'application/octet-stream' ||
      typeof artifact.data_uri !== 'string' || !artifact.data_uri.startsWith(prefix)) {
    throw new TypeError('outbound artifact encoding invalid');
  }
  const encoded = artifact.data_uri.slice(prefix.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new TypeError('outbound artifact base64 invalid');
  return bytes;
}

export function inspectPreparedTransport(prepared) {
  const failures = new Set();
  const artifacts = prepared?.outboundArtifacts;
  const evidence = [];
  if (!Array.isArray(artifacts) || artifacts.length !== 3) {
    failures.add('OUTBOUND_ARTIFACT_CARDINALITY_INVALID');
  } else {
    const byRole = new Map();
    for (const artifact of artifacts) {
      if (!artifact || !OUTBOUND_ROLES.includes(artifact.role) || byRole.has(artifact.role)) {
        failures.add('OUTBOUND_ARTIFACT_CARDINALITY_INVALID');
      } else {
        byRole.set(artifact.role, artifact);
      }
    }
    if (byRole.size !== OUTBOUND_ROLES.length) failures.add('OUTBOUND_ARTIFACT_CARDINALITY_INVALID');
    const expected = artifactExpectations(prepared);
    for (const role of OUTBOUND_ROLES) {
      const artifact = byRole.get(role);
      if (!artifact) continue;
      try {
        const bytes = decodeOutboundArtifact(artifact);
        const wanted = expected[role];
        if (artifact.role !== role || artifact.name !== wanted.name ||
            artifact.intended_sandbox_path !== wanted.intended_sandbox_path ||
            !HEX_SHA256.test(artifact.sha256) || artifact.sha256 !== wanted.sha256 ||
            !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 0 ||
            artifact.size_bytes !== bytes.length || sha256(bytes) !== wanted.sha256) {
          failures.add('OUTBOUND_ARTIFACT_HASH_MISMATCH');
        }
        evidence.push({
          role,
          intended_sandbox_path: artifact.intended_sandbox_path,
          sha256: sha256(bytes),
          size_bytes: bytes.length,
        });
      } catch {
        failures.add('OUTBOUND_ARTIFACT_HASH_MISMATCH');
      }
    }
  }
  const command = prepared?.expectedExecArguments?.command;
  if (typeof command !== 'string' || command.length === 0) {
    failures.add('EXEC_ARGUMENTS_MISMATCH');
  } else if (Buffer.byteLength(command, 'utf8') > 256) {
    failures.add('EXEC_COMMAND_OVERSIZE');
  } else {
    try {
      if (prepared?.commandManifest?.transport?.exec_arguments_sha256 !==
          sha256(canonicalJsonBytes(prepared.expectedExecArguments))) {
        failures.add('EXEC_ARGUMENTS_MISMATCH');
      }
    } catch {
      failures.add('EXEC_ARGUMENTS_MISMATCH');
    }
  }
  evidence.sort((left, right) => Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)));
  return { failure_reasons: FAILURE_ORDER.filter(reason => failures.has(reason)), outbound_artifacts: evidence };
}

export function assertPreparedTransport(prepared) {
  const inspection = inspectPreparedTransport(prepared);
  if (inspection.failure_reasons.length > 0) {
    throw new TypeError(`outbound artifact gate failed: ${inspection.failure_reasons.join(',')}`);
  }
  return inspection;
}

export class JudgmentTrueForgeClient extends TrueForgeClient {
  async createJudgmentSession(instructions) {
    const body = await this.request('POST', '/api/v1/sessions', {
      agent: {
        spec: {
          model: {
            name: process.env.TRUEFORGE_MODEL ?? 'anthropic/claude-haiku-4-5',
            params: { max_tokens: 4096, temperature: 0 },
          },
          instructions,
          response_format: JUDGMENT_RESPONSE_FORMAT,
          config: JUDGMENT_SESSION_CONFIG,
        },
      },
    });
    const sessionId = requireId(body, 'SESSION_ID_ABSENT');
    try {
      assertReturnedJudgmentSessionConfig(
        body?.data?.agent?.spec?.config,
        body?.data?.agent?.spec?.response_format,
      );
    } catch (error) {
      await this.cancelSession(sessionId);
      const code = error instanceof Error &&
          /^JUDGMENT_(?:SESSION_CONFIG|RESPONSE_FORMAT)_[A-Z]+/.test(error.message)
        ? error.message
        : 'JUDGMENT_SESSION_SPEC_MALFORMED';
      throw new BoundedHttpError(code, 422);
    }
    return sessionId;
  }

  async createRelaySession(prepared) {
    assertPreparedTransport(prepared);
    const expectedArguments = prepared.expectedExecArguments;
    const body = await this.request('POST', '/api/v1/sessions', {
      agent: {
        spec: {
          model: {
            name: process.env.TRUEFORGE_MODEL ?? 'anthropic/claude-haiku-4-5',
            params: { max_tokens: 512, temperature: 0 },
          },
          instructions:
            'Call truefoundry-system exec exactly once with this exact JSON argument object: ' +
            `${JSON.stringify(expectedArguments)}. Do not call any other tool. ` +
            'After the response return only VERIFICATION_RELAY_COMPLETE.',
          config: { iteration_limit: 3, sandbox: { enabled: true } },
        },
      },
    });
    return requireId(body, 'SESSION_ID_ABSENT');
  }

  async assertDaytonaSandboxProvider() {
    const body = await this.request('GET', '/api/v1/settings/sandbox-providers');
    if (body?.data?.manifest?.type !== 'daytona') {
      throw new BoundedHttpError('PROVIDER_CONFIGURATION_REJECTED', 422);
    }
  }

  async createRelayTurn(sessionId, prepared, timeoutMs) {
    assertPreparedTransport(prepared);
    const byRole = new Map(prepared.outboundArtifacts.map(artifact => [artifact.role, artifact]));
    const body = await this.request(
      'POST',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        input: [{
          type: 'user.message',
          content: OUTBOUND_ROLES.map(role => {
            const artifact = byRole.get(role);
            return { type: 'file', name: artifact.name, data: artifact.data_uri };
          }),
        }],
        stream: false,
      },
      timeoutMs,
    );
    return requireId(body, 'TURN_ID_ABSENT');
  }

  async createMessageTurn(sessionId, content, timeoutMs) {
    const body = await this.request('POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      input: [{ type: 'user.message', content }],
      stream: false,
    }, timeoutMs);
    return requireId(body, 'TURN_ID_ABSENT');
  }
}

function requireId(body, code) {
  const id = body?.data?.id;
  if (typeof id !== 'string' || id.length === 0) throw new BoundedHttpError(code);
  return id;
}

async function pollTurn(client, sessionId, turnId, deadline, sleep = delay, clock = Date.now) {
  let turn = null;
  while (clock() < deadline) {
    turn = await client.getTurn(sessionId, turnId, Math.max(1, Math.min(10_000, deadline - clock())));
    if (TERMINAL.has(turn?.state?.status)) return turn;
    await sleep(Math.max(1, Math.min(250, deadline - clock())));
  }
  await client.cancelSession(sessionId);
  return turn;
}

async function observeEvents(client, sessionId, turnId, sleep = delay) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const events = await client.listEvents(sessionId, turnId, 5_000);
      if (!Array.isArray(events)) throw new BoundedHttpError('EVENTS_SHAPE_INVALID');
      return { observed: true, events };
    } catch {
      if (attempt < 2) await sleep(100);
    }
  }
  return { observed: false, events: [] };
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, wanted) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...wanted].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function responseContentSha256(content) {
  if (typeof content === 'string') return sha256(Buffer.from(content, 'utf8'));
  return sha256(canonicalJsonBytes(content));
}

export function reduceJudgmentExecution({
  events,
  eventsObserved = Array.isArray(events),
  turnStatus,
  sessionId = '',
  turnId = '',
}) {
  const failures = new Set();
  if (!eventsObserved) failures.add('JUDGMENT_EVENTS_UNAVAILABLE');
  const list = Array.isArray(events) ? events : [];
  let persistedEventsSha256 = null;
  try {
    persistedEventsSha256 = sha256(canonicalJsonBytes(list));
  } catch {
    failures.add('JUDGMENT_EVENT_SHAPE_INVALID');
  }

  for (const event of list) {
    if (!plainObject(event) || typeof event.type !== 'string' || event.type.length === 0) {
      failures.add('JUDGMENT_EVENT_SHAPE_INVALID');
      continue;
    }
    if (!JUDGMENT_EVENT_TYPES.has(event.type)) failures.add('JUDGMENT_FORBIDDEN_EVENT');
    if (Object.hasOwn(event, 'tool_calls') && !Array.isArray(event.tool_calls)) {
      failures.add('JUDGMENT_EVENT_SHAPE_INVALID');
    }
  }

  if (turnStatus !== 'done') failures.add('JUDGMENT_TURN_NOT_DONE');
  const terminal = list.filter(event => event?.type === 'turn.done');
  if (terminal.length !== 1 || terminal[0]?.state?.status !== turnStatus) {
    failures.add('JUDGMENT_TERMINAL_EVENT_CARDINALITY_INVALID');
  }

  const calls = list.flatMap(event => Array.isArray(event?.tool_calls) ? event.tool_calls : []);
  if (calls.length > 1) failures.add('JUDGMENT_TOOL_CALL_CARDINALITY_INVALID');
  const call = calls.length === 1 ? calls[0] : null;
  let normalizedCall = null;
  if (call) {
    const idValid = typeof call.id === 'string' && call.id.length > 0 &&
      Buffer.byteLength(call.id, 'utf8') <= 256 && calls.filter(item => item?.id === call.id).length === 1;
    const callShapeValid = exactKeys(call, ['id', 'type', 'function', 'tool_info']) &&
      call.type === 'function' && idValid &&
      exactKeys(call.tool_info, ['type', 'name']) &&
      call.tool_info.type === 'truefoundry-system' &&
      call.tool_info.name === 'get_current_datetime' &&
      exactKeys(call.function, ['name', 'arguments']) &&
      call.function.name === 'get_current_datetime';
    if (!callShapeValid) failures.add('JUDGMENT_TOOL_CALL_SHAPE_INVALID');
    const argumentsEmpty = call?.function?.arguments === '' ||
      (plainObject(call?.function?.arguments) && Object.keys(call.function.arguments).length === 0);
    if (!argumentsEmpty) failures.add('JUDGMENT_TOOL_ARGUMENTS_INVALID');
    normalizedCall = {
      id: typeof call.id === 'string' ? call.id : '',
      type: call.type ?? null,
      tool_info: plainObject(call.tool_info) ? call.tool_info : null,
      function_name: call?.function?.name ?? null,
      arguments_empty: argumentsEmpty,
    };
  }

  const responses = list.filter(event => event?.type === 'tool.response');
  if (responses.length !== calls.length) failures.add('JUDGMENT_TOOL_RESPONSE_CARDINALITY_INVALID');
  let responseDigest = null;
  if (call && responses.length === 1) {
    if (responses[0]?.tool_call_id !== call.id) {
      failures.add('JUDGMENT_TOOL_RESPONSE_ID_MISMATCH');
    } else {
      try {
        responseDigest = responseContentSha256(responses[0].content);
      } catch {
        failures.add('JUDGMENT_EVENT_SHAPE_INVALID');
      }
    }
  } else if (!call && responses.length > 0) {
    failures.add('JUDGMENT_TOOL_RESPONSE_ID_MISMATCH');
  }

  const failureReasons = JUDGMENT_EVENT_FAILURE_ORDER.filter(reason => failures.has(reason));
  return {
    schema: 'judgment_execution_evidence/v1',
    session_id: sessionId,
    turn_id: turnId,
    persisted_events_sha256: persistedEventsSha256,
    event_count: list.length,
    terminal_status: terminal.length === 1 ? terminal[0]?.state?.status ?? null : null,
    availability: {
      runtime_tool_surface_sha256: RUNTIME_TOOL_SURFACE_SHA256,
      available_tool_count: 1,
    },
    exercise: {
      tool_call_count: calls.length,
      tool_response_count: responses.length,
      call: normalizedCall,
      response_content_sha256: responseDigest,
    },
    status: failureReasons.length === 0 ? 'ESTABLISHED' : 'NOT_ESTABLISHED',
    failure_reasons: failureReasons,
  };
}

export async function runJudgmentModel({
  prompt,
  instructions,
  client = new JudgmentTrueForgeClient(),
  runtimeGate = assertJudgmentRuntimeInstallation,
}) {
  const runtimePreflight = runtimeGate();
  const sessionId = await client.createJudgmentSession(instructions);
  let turnId = '';
  let turn = null;
  let observed = { observed: false, events: [] };
  try {
    const deadline = Date.now() + MAX_MODEL_TURN_MS;
    turnId = await client.createMessageTurn(sessionId, prompt, Math.max(1, deadline - Date.now()));
    turn = await pollTurn(client, sessionId, turnId, deadline);
  } finally {
    if (turnId) observed = await observeEvents(client, sessionId, turnId);
    if (!observed.observed || turn?.state?.status !== 'done') await client.cancelSession(sessionId);
  }
  const executionEvidence = reduceJudgmentExecution({
    events: observed.events,
    eventsObserved: observed.observed,
    turnStatus: turn?.state?.status ?? 'error',
    sessionId,
    turnId,
  });
  if (executionEvidence.status !== 'ESTABLISHED') {
    throw new BoundedHttpError(
      `JUDGMENT_EVENT_GATE_FAILED_${executionEvidence.failure_reasons.join('_')}`,
      422,
    );
  }
  if (typeof turn?.state?.output?.content !== 'string') {
    throw new BoundedHttpError('JUDGMENT_TURN_NOT_DONE');
  }
  return {
    sessionId,
    turnId,
    content: turn.state.output.content,
    usage: turn.state.output.usage ?? null,
    runtimePreflight,
    executionEvidence,
    persistedEvents: observed.events,
  };
}

function parseResponseContent(content) {
  const envelope = typeof content === 'string' ? parseStrictJson(content) : content;
  assertClosedObject(envelope, ['success', 'response'], 'exec response envelope');
  assertClosedObject(envelope.response, ['exitCode', 'result'], 'exec response');
  if (envelope.success !== true || envelope.response.exitCode !== 0 || typeof envelope.response.result !== 'string') {
    throw new TypeError('exec response rejected');
  }
  return envelope.response.result;
}

export function reduceCandidateVerification({
  events,
  turnStatus,
  prepared,
  cleanup,
  preflight = [],
  outboundArtifacts = inspectPreparedTransport(prepared).outbound_artifacts,
  sessionId = '',
  turnId = '',
}) {
  const failures = new Set(preflight);
  const preflightBlocked = preflight.length > 0;
  if (!Array.isArray(events)) events = [];
  const sandboxEvents = events.filter(event => event?.type === 'sandbox.created');
  const sandboxIds = createdSandboxIds(events);
  if (!preflightBlocked && turnStatus !== 'done') failures.add('TURN_NOT_DONE');
  if (!preflightBlocked && (sandboxEvents.length !== 1 || sandboxIds.length !== 1)) {
    failures.add('SANDBOX_EVENT_CARDINALITY_INVALID');
  }
  const calls = events.flatMap(event => Array.isArray(event?.tool_calls) ? event.tool_calls : []);
  const call = calls.length === 1 ? calls[0] : null;
  if (!preflightBlocked && (!call || call?.function?.name !== 'exec' || call?.tool_info?.type !== 'truefoundry-system' ||
      call?.tool_info?.name !== 'exec' || typeof call.id !== 'string')) {
    failures.add('EXEC_CALL_CARDINALITY_INVALID');
  }
  if (call) {
    try {
      const actual = parseStrictJson(call.function.arguments);
      if (typeof actual?.command === 'string' && Buffer.byteLength(actual.command, 'utf8') > 256) {
        failures.add('EXEC_COMMAND_OVERSIZE');
      } else if (!canonicalJsonBytes(actual).equals(canonicalJsonBytes(prepared.expectedExecArguments))) {
        failures.add('EXEC_ARGUMENTS_MISMATCH');
      }
    } catch {
      failures.add('EXEC_ARGUMENTS_MISMATCH');
    }
  }
  const responses = events.filter(event => event?.type === 'tool.response');
  const response = responses.length === 1 ? responses[0] : null;
  let result = null;
  if (!preflightBlocked && responses.length !== 1) failures.add('TOOL_RESPONSE_CARDINALITY_INVALID');
  if (response && (!call || response.tool_call_id !== call.id)) failures.add('TOOL_RESPONSE_ID_MISMATCH');
  if (response && call && response.tool_call_id === call.id) {
    let resultText;
    try {
      resultText = parseResponseContent(response.content);
    } catch {
      failures.add('EXEC_RESPONSE_SHAPE_UNEXPECTED');
    }
    if (resultText !== undefined) {
      try {
        result = parseCandidateResult(resultText);
      } catch {
        failures.add('CANDIDATE_RESULT_INVALID');
      }
    }
  }
  if (result) {
    if (result.verifier_sha256 !== prepared.verifierSha256) failures.add('VERIFIER_IDENTITY_MISMATCH');
    if (result.command_manifest_sha256 !== prepared.commandManifestSha256) {
      failures.add('MANIFEST_IDENTITY_MISMATCH');
    }
    if (result.payload_bundle_sha256 !== prepared.candidateBundleSha256) {
      failures.add('CANDIDATE_BYTES_MISMATCH');
    }
    if (result.exit_code !== 0) failures.add('CANDIDATE_EXIT_NONZERO');
    if (result.stderr_length !== 0 || result.stderr_sha256 !== EMPTY_SHA256) {
      failures.add('CANDIDATE_STDERR_NONEMPTY');
    }
  }
  const expectedIds = sandboxIds;
  const attempted = cleanup?.attempted_ids ?? [];
  const absent = cleanup?.confirmed_absent_ids ?? [];
  const unconfirmed = cleanup?.unconfirmed_ids ?? [];
  if (!preflightBlocked && (expectedIds.length !== attempted.length || expectedIds.some((id, index) => id !== attempted[index]) ||
      expectedIds.length !== absent.length || expectedIds.some((id, index) => id !== absent[index]) ||
      unconfirmed.length !== 0)) {
    failures.add('CLEANUP_UNCONFIRMED');
  }
  const failureReasons = FAILURE_ORDER.filter(reason => failures.has(reason));
  return {
    schema: 'candidate_verification_evidence/v1',
    session_id: sessionId,
    turn_id: turnId,
    command_manifest_sha256: prepared.commandManifestSha256,
    verifier_sha256: prepared.verifierSha256,
    payload_bundle_sha256: prepared.candidateBundleSha256,
    outbound_artifacts: outboundArtifacts,
    sandbox_ids: sandboxIds,
    result,
    cleanup,
    status: failureReasons.length === 0 ? 'VERIFIED_IN_DAYTONA' : 'NOT_ESTABLISHED',
    failure_reasons: failureReasons,
  };
}

export async function runCandidateVerification({
  prepared,
  client = new JudgmentTrueForgeClient(),
  cleanupProvider = daytonaCleanupProvider(),
  now = () => new Date().toISOString(),
}) {
  let sessionId = '';
  let turnId = '';
  let turnStatus = 'error';
  let observed = { observed: false, events: [] };
  const inspection = inspectPreparedTransport(prepared);
  const preflight = [...inspection.failure_reasons];
  if (preflight.length === 0) {
    try {
      await client.assertDaytonaSandboxProvider();
    } catch {
      preflight.push('PROVIDER_CONFIGURATION_REJECTED');
    }
  }
  if (preflight.length > 0) {
    return reduceCandidateVerification({
      events: [],
      turnStatus: 'preflight_blocked',
      prepared,
      cleanup: { attempted_ids: [], confirmed_absent_ids: [], unconfirmed_ids: [], checked_at_utc: now() },
      preflight,
      outboundArtifacts: inspection.outbound_artifacts,
    });
  }
  try {
    sessionId = await client.createRelaySession(prepared);
    const deadline = Date.now() + MAX_SANDBOX_TURN_MS;
    turnId = await client.createRelayTurn(
      sessionId,
      prepared,
      Math.max(1, deadline - Date.now()),
    );
    const turn = await pollTurn(client, sessionId, turnId, deadline);
    turnStatus = turn?.state?.status ?? 'error';
  } finally {
    if (sessionId && turnId) observed = await observeEvents(client, sessionId, turnId);
    if ((!observed.observed || turnStatus !== 'done') && sessionId) await client.cancelSession(sessionId);
  }
  const createdIds = createdSandboxIds(observed.events);
  const cleanup = await cleanupSandboxes({
    createdIds,
    deleteSandbox: cleanupProvider.deleteSandbox,
    observeAbsent: cleanupProvider.observeAbsent,
    checkedAtUtc: now,
  });
  return reduceCandidateVerification({
    events: observed.observed ? observed.events : null,
    turnStatus,
    prepared,
    cleanup,
    sessionId,
    turnId,
  });
}

export function evidenceSha256(evidence) {
  return sha256(canonicalJsonBytes(evidence));
}
