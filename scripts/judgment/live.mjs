import { Buffer } from 'node:buffer';
import { canonicalJsonBytes, parseStrictJson, assertClosedObject } from '../pr2/canonical.mjs';
import { cleanupSandboxes, createdSandboxIds } from '../pr2/cleanup.mjs';
import { sha256 } from '../pr2/inputs.mjs';
import { daytonaCleanupProvider } from '../pr2/run.mjs';
import { BoundedHttpError, TrueForgeClient } from '../pr2/trueforge-client.mjs';
import { MAX_MODEL_TURN_MS, MAX_SANDBOX_TURN_MS } from './constants.mjs';
import { parseCandidateResult } from './candidate.mjs';

const TERMINAL = new Set(['done', 'error', 'cancelled']);
const FAILURE_ORDER = [
  'TURN_NOT_DONE',
  'EVENTS_NOT_OBSERVED',
  'SANDBOX_EVENT_CARDINALITY_INVALID',
  'EXEC_CALL_INVALID',
  'EXEC_ARGUMENTS_MISMATCH',
  'TOOL_RESPONSE_INVALID',
  'CANDIDATE_RESULT_INVALID',
  'CANDIDATE_EXIT_NONZERO',
  'CLEANUP_UNCONFIRMED',
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
          config: { iteration_limit: 1, sandbox: { enabled: false } },
        },
      },
    });
    return requireId(body, 'SESSION_ID_ABSENT');
  }

  async createRelaySession(expectedArguments) {
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

  async createRelayTurn(sessionId, expectedArguments, relayFile, timeoutMs) {
    assertClosedObject(
      relayFile,
      ['name', 'mime', 'sandbox_path', 'sha256', 'size_bytes', 'data_uri'],
      'relay file',
    );
    const expectedCommand = `node ${relayFile.sandbox_path}`;
    const prefix = `data:${relayFile.mime};base64,`;
    if (relayFile.name !== 'candidate-verifier.cjs' ||
        relayFile.mime !== 'application/octet-stream' ||
        relayFile.sandbox_path !== `/opt/tf/uploads/${relayFile.name}` ||
        expectedArguments?.command !== expectedCommand ||
        typeof relayFile.data_uri !== 'string' || !relayFile.data_uri.startsWith(prefix)) {
      throw new TypeError('relay file transport invalid');
    }
    const encoded = relayFile.data_uri.slice(prefix.length);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length === 0 || bytes.toString('base64') !== encoded ||
        bytes.length !== relayFile.size_bytes || sha256(bytes) !== relayFile.sha256) {
      throw new TypeError('relay file bytes invalid');
    }
    const body = await this.request(
      'POST',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        input: [{
          type: 'user.message',
          content: [
            { type: 'file', name: relayFile.name, data: relayFile.data_uri },
            {
              type: 'text',
              text: `Call exec exactly once with ${JSON.stringify(expectedArguments)}.`,
            },
          ],
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

export async function runJudgmentModel({ prompt, instructions, client = new JudgmentTrueForgeClient() }) {
  const sessionId = await client.createJudgmentSession(instructions);
  let turnId = '';
  try {
    const deadline = Date.now() + MAX_MODEL_TURN_MS;
    turnId = await client.createMessageTurn(sessionId, prompt, Math.max(1, deadline - Date.now()));
    const turn = await pollTurn(client, sessionId, turnId, deadline);
    if (turn?.state?.status !== 'done' || typeof turn?.state?.output?.content !== 'string') {
      throw new BoundedHttpError('JUDGMENT_TURN_NOT_DONE');
    }
    return {
      sessionId,
      turnId,
      content: turn.state.output.content,
      usage: turn.state.output.usage ?? null,
    };
  } catch (error) {
    await client.cancelSession(sessionId);
    throw error;
  }
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
  sessionId = '',
  turnId = '',
}) {
  const failures = new Set();
  if (turnStatus !== 'done') failures.add('TURN_NOT_DONE');
  if (!Array.isArray(events)) {
    failures.add('EVENTS_NOT_OBSERVED');
    events = [];
  }
  const sandboxIds = createdSandboxIds(events);
  if (sandboxIds.length !== 1) failures.add('SANDBOX_EVENT_CARDINALITY_INVALID');
  const calls = events.flatMap(event => Array.isArray(event?.tool_calls) ? event.tool_calls : []);
  const call = calls.length === 1 ? calls[0] : null;
  if (!call || call?.function?.name !== 'exec' || call?.tool_info?.type !== 'truefoundry-system' ||
      call?.tool_info?.name !== 'exec' || typeof call.id !== 'string') {
    failures.add('EXEC_CALL_INVALID');
  }
  if (call) {
    try {
      const actual = parseStrictJson(call.function.arguments);
      if (!canonicalJsonBytes(actual).equals(canonicalJsonBytes(prepared.expectedExecArguments))) {
        failures.add('EXEC_ARGUMENTS_MISMATCH');
      }
    } catch {
      failures.add('EXEC_ARGUMENTS_MISMATCH');
    }
  }
  const responses = events.filter(event => event?.type === 'tool.response');
  const response = responses.length === 1 ? responses[0] : null;
  let result = null;
  if (!response || !call || response.tool_call_id !== call.id) {
    failures.add('TOOL_RESPONSE_INVALID');
  } else {
    try {
      result = parseCandidateResult(parseResponseContent(response.content), prepared);
    } catch {
      failures.add('CANDIDATE_RESULT_INVALID');
    }
  }
  if (result && result.exit_code !== 0) failures.add('CANDIDATE_EXIT_NONZERO');
  const expectedIds = sandboxIds;
  const attempted = cleanup?.attempted_ids ?? [];
  const absent = cleanup?.confirmed_absent_ids ?? [];
  const unconfirmed = cleanup?.unconfirmed_ids ?? [];
  if (expectedIds.length !== attempted.length || expectedIds.some((id, index) => id !== attempted[index]) ||
      expectedIds.length !== absent.length || expectedIds.some((id, index) => id !== absent[index]) ||
      unconfirmed.length !== 0) {
    failures.add('CLEANUP_UNCONFIRMED');
  }
  const failureReasons = FAILURE_ORDER.filter(reason => failures.has(reason));
  return {
    schema: 'candidate_verification_evidence/v1',
    session_id: sessionId,
    turn_id: turnId,
    command_manifest_sha256: prepared.commandManifestSha256,
    candidate_bundle_sha256: prepared.candidateBundleSha256,
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
  try {
    sessionId = await client.createRelaySession(prepared.expectedExecArguments);
    const deadline = Date.now() + MAX_SANDBOX_TURN_MS;
    turnId = await client.createRelayTurn(
      sessionId,
      prepared.expectedExecArguments,
      prepared.relayFile,
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
