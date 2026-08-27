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

async function observeEvents(client, sessionId, turnId, sleep, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const events = await client.listEvents(sessionId, turnId, 5_000);
      if (!Array.isArray(events)) throw new BoundedHttpError('EVENTS_SHAPE_INVALID');
      return { observed: true, events };
    } catch {
      if (attempt + 1 < attempts) await sleep(100);
    }
  }
  return { observed: false, events: [] };
}

async function observeSessionEventsForCleanup(client, sessionId, turnId, sleep, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const events = await client.listSessionEventsForTurn(sessionId, turnId, 5_000);
      if (!Array.isArray(events)) throw new BoundedHttpError('SESSION_EVENTS_SHAPE_INVALID');
      return { observed: true, events };
    } catch {
      if (attempt + 1 < attempts) await sleep(100);
    }
  }
  return { observed: false, events: [] };
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
  let cleanupOwnershipObserved = false;
  let turnMayExistWithoutId = false;
  let turnRequestStarted = false;
  let phase = 'provider';
  let cleanup = { attempted_ids: [], confirmed_absent_ids: [], unconfirmed_ids: [], checked_at_utc: now() };

  if (preflight.length === 0) {
    try {
      if (!await client.providersConfigured()) throw new BoundedHttpError('PROVIDER_NOT_CONFIGURED', 422);
      phase = 'session';
      sessionId = await client.createSession(prepared.expectedExecArguments);
      const deadline = clock() + prepared.manifest.maximum_turn_ms;
      const remaining = () => Math.max(0, deadline - clock());
      phase = 'turn';
      const createTurnBudget = remaining();
      if (createTurnBudget === 0) throw new BoundedHttpError('TIMEOUT');
      turnRequestStarted = true;
      turnId = await client.createTurn(
        sessionId,
        prepared.executionRequest,
        prepared.expectedExecArguments,
        createTurnBudget,
      );
      turnStatus = 'running';
      phase = 'poll';
      while (clock() < deadline) {
        const pollBudget = remaining();
        if (pollBudget === 0) break;
        const turn = await client.getTurn(sessionId, turnId, Math.min(10_000, pollBudget));
        const status = turn?.state?.status;
        if (TERMINAL.has(status)) {
          turnStatus = status;
          break;
        }
        await sleep(Math.min(250, remaining()));
      }
      if (!TERMINAL.has(turnStatus)) {
        turnStatus = 'timeout';
        await client.cancelSession(sessionId);
      }
    } catch (error) {
      turnMayExistWithoutId = turnRequestStarted && turnId === '';
      if (error instanceof BoundedHttpError && error.code === 'TIMEOUT' && ['turn', 'poll'].includes(phase)) {
        turnStatus = 'timeout';
      } else if (turnRequestStarted) {
        turnStatus = 'error';
      }
      if (error instanceof BoundedHttpError &&
          ([401, 403, 422].includes(error.status) ||
           (['provider', 'session'].includes(phase) &&
            ([0].includes(error.status) || ['TIMEOUT', 'UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED'].includes(error.code))))) {
        providerRejected = true;
      }
      if (sessionId && turnStatus !== 'done') await client.cancelSession(sessionId);
    } finally {
      if (sessionId && turnId) {
        let observation = await observeEvents(client, sessionId, turnId, sleep, 3);
        if (!observation.observed) {
          await client.cancelSession(sessionId);
          observation = await observeEvents(client, sessionId, turnId, sleep, 2);
        }
        events = observation.events;
        eventsObserved = observation.observed;
        let cleanupEvents = events;
        cleanupOwnershipObserved = eventsObserved;
        if (!cleanupOwnershipObserved) {
          const fallback = await observeSessionEventsForCleanup(
            client,
            sessionId,
            turnId,
            sleep,
            2,
          );
          cleanupEvents = fallback.events;
          cleanupOwnershipObserved = fallback.observed;
        }
        const ownedIds = createdSandboxIds(cleanupEvents);
        cleanup = await cleanupSandboxes({
          createdIds: ownedIds,
          deleteSandbox: cleanupProvider.deleteSandbox,
          observeAbsent: cleanupProvider.observeAbsent,
          checkedAtUtc: now,
        });
      }
    }
  }

  if ((sessionId && turnId && (!cleanupOwnershipObserved || cleanup.unconfirmed_ids.length > 0)) ||
      turnMayExistWithoutId) {
    preflight.push('CLEANUP_UNCONFIRMED');
  }

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
