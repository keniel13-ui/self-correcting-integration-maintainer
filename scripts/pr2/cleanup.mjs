import { compareUtf8 } from './canonical.mjs';

function sortedUnique(values) {
  return [...new Set(values)].sort(compareUtf8);
}

export function validSandboxId(value) {
  return typeof value === 'string' && value.startsWith('v1:daytona:') &&
    value.length <= 512 && !/[\0\r\n*?]/.test(value);
}

export function createdSandboxIds(events) {
  return sortedUnique(
    events
      .filter(event => event?.type === 'sandbox.created' && validSandboxId(event.sandbox_id))
      .map(event => event.sandbox_id),
  );
}

export function assertExactCleanupTargets(createdIds, requestedIds) {
  if (!Array.isArray(createdIds) || !Array.isArray(requestedIds) ||
      createdIds.some(id => !validSandboxId(id)) || requestedIds.some(id => !validSandboxId(id))) {
    throw new TypeError('cleanup IDs must be exact Daytona sandbox IDs');
  }
  const expected = sortedUnique(createdIds);
  const actual = sortedUnique(requestedIds);
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new TypeError('cleanup targets differ from same-run sandbox IDs');
  }
  return actual;
}

export async function cleanupSandboxes({
  createdIds,
  requestedIds = createdIds,
  deleteSandbox,
  observeAbsent,
  checkedAtUtc = () => new Date().toISOString(),
}) {
  const attemptedIds = assertExactCleanupTargets(createdIds, requestedIds);
  const confirmedAbsentIds = [];
  const unconfirmedIds = [];
  for (const id of attemptedIds) {
    try {
      await deleteSandbox(id);
    } catch {
      // The delete response is never treated as confirmation. Re-observation controls.
    }
    let absent = false;
    try {
      absent = await observeAbsent(id) === true;
    } catch {
      absent = false;
    }
    (absent ? confirmedAbsentIds : unconfirmedIds).push(id);
  }
  return {
    attempted_ids: attemptedIds,
    confirmed_absent_ids: confirmedAbsentIds,
    unconfirmed_ids: unconfirmedIds,
    checked_at_utc: checkedAtUtc(),
  };
}
