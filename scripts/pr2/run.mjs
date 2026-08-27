import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { canonicalJsonBytes } from './canonical.mjs';
import { cleanupSandboxes, createdSandboxIds } from './cleanup.mjs';
import { createRunInputs, verifyRunInputs } from './inputs.mjs';
import { observePreflight, preflightFailures } from './preflight.mjs';
import { reduceExecution } from './reducer.mjs';
import { BoundedHttpError, TrueForgeClient } from './trueforge-client.mjs';

const TERMINAL = new Set(['done', 'error', 'cancelled']);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function daytonaCleanupProvider({
  apiKey = process.env.DAYTONA_API_KEY,
  baseUrl = 'https://app.daytona.io',
  fetchImpl = fetch,
} = {}) {
  const rawId = id => {
    const match = /^v1:daytona:default\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
    if (!match) throw new BoundedHttpError('DAYTONA_SANDBOX_ID_SHAPE_REJECTED');
    return match[1];
  };
  const request = async (method, id) => {
    if (typeof apiKey !== 'string' || apiKey.length === 0) throw new BoundedHttpError('DAYTONA_KEY_ABSENT');
    let response;
    try {
      const path = `/api/sandbox/${encodeURIComponent(rawId(id))}${method === 'DELETE' ? '?force=true' : ''}`;
      response = await fetchImpl(new URL(path, baseUrl), {
        method,
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BoundedHttpError('DAYTONA_CLEANUP_UNAVAILABLE');
    }
    return response.status;
  };
  return {
    async deleteSandbox(id) {
      const status = await request('DELETE', id);
      if (status !== 200 && status !== 202 && status !== 204 && status !== 404) {
        throw new BoundedHttpError('DAYTONA_DELETE_REJECTED', status);
      }
    },
    async observeAbsent(id) {
      const status = await request('GET', id);
      if (status === 404) return true;
      if (status === 200) return false;
      throw new BoundedHttpError('DAYTONA_OBSERVE_REJECTED', status);
    },
  };
}

export async function executePreparedSurface({
  repoRoot,
  prepared,
  client = new TrueForgeClient(),
  cleanupProvider = daytonaCleanupProvider(),
  observations = observePreflight(repoRoot),
  now = () => new Date().toISOString(),
  sleep = wait,
  clock = Date.now,
}) {
  let inputFailures = [];
  try {
    verifyRunInputs(prepared.runDir);
  } catch {
    inputFailures = ['INPUT_INVALID'];
  }
  const preflight = [...inputFailures, ...preflightFailures(observations)];
  let providerRejected = false;
  let sessionId = '';
  let turnId = '';
  let turnStatus = 'error';
  let events = [];
  let eventsObserved = false;
  let cleanup = { attempted_ids: [], confirmed_absent_ids: [], unconfirmed_ids: [], checked_at_utc: now() };

  if (preflight.length === 0) {
    try {
      if (!await client.providersConfigured()) throw new BoundedHttpError('PROVIDER_NOT_CONFIGURED', 422);
      sessionId = await client.createSession(prepared.expectedExecArguments);
      turnId = await client.createTurn(sessionId, prepared.executionRequest, prepared.expectedExecArguments);
      const deadline = clock() + prepared.manifest.maximum_turn_ms;
      while (clock() < deadline) {
        const turn = await client.getTurn(sessionId, turnId);
        const status = turn?.state?.status;
        if (TERMINAL.has(status)) {
          turnStatus = status;
          break;
        }
        await sleep(250);
      }
      if (!TERMINAL.has(turnStatus)) {
        turnStatus = 'timeout';
        await client.cancelSession(sessionId);
      }
      events = await client.listEvents(sessionId, turnId);
      eventsObserved = true;
    } catch (error) {
      if (error instanceof BoundedHttpError &&
          ([0, 401, 403, 422].includes(error.status) ||
           ['TIMEOUT', 'UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED'].includes(error.code))) {
        providerRejected = true;
      }
      if (sessionId && turnId) {
        try {
          events = await client.listEvents(sessionId, turnId);
          eventsObserved = true;
        } catch {
          events = [];
        }
      }
    } finally {
      const ownedIds = createdSandboxIds(events);
      cleanup = await cleanupSandboxes({
        createdIds: ownedIds,
        deleteSandbox: cleanupProvider.deleteSandbox,
        observeAbsent: cleanupProvider.observeAbsent,
        checkedAtUtc: now,
      });
    }
  }

  if (sessionId && turnId && !eventsObserved) preflight.push('CLEANUP_UNCONFIRMED');

  const evidence = reduceExecution({
    manifest: prepared.manifest,
    expectedExecArguments: prepared.expectedExecArguments,
    requestSha256: prepared.requestSha256,
    sessionId,
    turnId,
    turnStatus,
    events,
    cleanup,
    preflight,
    providerRejected,
    versions: observations,
    observedAtUtc: now(),
  });
  writeFileSync(join(prepared.runDir, 'sandbox_execution_evidence.json'), canonicalJsonBytes(evidence), { flag: 'wx' });
  return evidence;
}

export async function runSurface({ repoRoot }) {
  const prepared = createRunInputs({ repoRoot });
  return executePreparedSurface({ repoRoot, prepared });
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(thisFile).href) {
  const repoRoot = dirname(dirname(dirname(thisFile)));
  const evidence = await runSurface({ repoRoot });
  process.stdout.write(canonicalJsonBytes(evidence));
  process.exitCode = evidence.status === 'EXECUTED_IN_DAYTONA' ? 0 : 1;
}
