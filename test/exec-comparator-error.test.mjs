import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceCandidateVerification, inspectPreparedTransport } from '../scripts/judgment/live.mjs';
import { reduceExecution } from '../scripts/pr2/reducer.mjs';

// One catch used to wrap three outcomes that need different names:
//
//   parseStrictJson / validateExecArguments throw -> the arguments that ARRIVED
//                                                    are not usable
//   the comparison itself throws                  -> the comparison did not
//                                                    complete, and the cause is
//                                                    on our side of the wire
//   a clean comparison differs                    -> the call disagrees with the
//                                                    frozen expectation
//
// All three reported EXEC_ARGUMENTS_MISMATCH, so a reader could not tell which
// party the finding was about.
//
// Found by pm25coder (DEV 3eanf, 3ei6m): "a subject-less name defaults to
// whoever is under evaluation." Kairos caught the first repair re-collapsing
// arriving-argument faults into the harness bucket, and caught this file
// claiming more than it proves.
//
// TWO THINGS THIS DOES NOT ESTABLISH, deliberately:
//   1. EXEC_ARGUMENTS_INVALID does not identify WHO produced bad arguments.
//      The receipt shows what arrived, not whether the model, the relay, or
//      transport corrupted it. The name is subject-neutral on purpose.
//   2. EXEC_COMPARATOR_ERROR names the STAGE that failed, not the cause. An
//      un-canonicalizable expectation and a genuine comparator bug are both
//      harness-side and are not distinguishable from here. Splitting them would
//      invent a distinction the code cannot detect.
//
// This does NOT implement args_mismatch_under_contract=<id>. The names still
// carry no contract id, so pm25coder's point is only half addressed.

const EXPECTED = { command: 'node verify.js', intent: 'Run candidate verification' };

const execCall = args => ({
  id: 'call_1',
  function: { name: 'exec', arguments: args },
  tool_info: { type: 'truefoundry-system', name: 'exec' },
});

const reduce = (args, expected = EXPECTED) => reduceCandidateVerification({
  events: [{ type: 'model.message', tool_calls: [execCall(args)] }],
  turnStatus: 'done',
  prepared: { expectedExecArguments: expected },
  cleanup: null,
  outboundArtifacts: [],
}).failure_reasons;

test('arguments that arrive unusable are EXEC_ARGUMENTS_INVALID', () => {
  const r = reduce('{ not json');
  assert.ok(r.includes('EXEC_ARGUMENTS_INVALID'), `got ${r.join(',')}`);
  assert.ok(!r.includes('EXEC_COMPARATOR_ERROR'), 'unusable input must not read as our machinery failing');
  assert.ok(!r.includes('EXEC_ARGUMENTS_MISMATCH'), 'nothing was compared, so nothing mismatched');
});

test('a usable call that differs is EXEC_ARGUMENTS_MISMATCH', () => {
  const r = reduce('{"command":"node other.js","intent":"Run candidate verification"}');
  assert.ok(r.includes('EXEC_ARGUMENTS_MISMATCH'), `got ${r.join(',')}`);
  assert.ok(!r.includes('EXEC_COMPARATOR_ERROR'));
  assert.ok(!r.includes('EXEC_ARGUMENTS_INVALID'));
});

test('a comparison that cannot complete is EXEC_COMPARATOR_ERROR', () => {
  // The arriving call is usable. Our own expected object carries a BigInt,
  // which canonicalJson rejects, so the comparison throws. Harness side.
  const r = reduce('{"command":"node verify.js","intent":"Run candidate verification"}',
                   { command: 'node verify.js', intent: 1n });
  assert.ok(r.includes('EXEC_COMPARATOR_ERROR'), `got ${r.join(',')}`);
  assert.ok(!r.includes('EXEC_ARGUMENTS_INVALID'), 'what arrived was usable');
  assert.ok(!r.includes('EXEC_ARGUMENTS_MISMATCH'), 'no comparison completed, so nothing mismatched');
});

// The two paths below had no coverage at all. Kairos exercised them by hand;
// preserving them here so a future edit cannot silently drop a reason.

test('pr2 reducer: unusable arguments are EXEC_ARGUMENTS_INVALID, not a mismatch', () => {
  const { failure_reasons: r } = reduceExecution({
    manifest: { exec_arguments_sha256: 'x'.repeat(64) },
    expectedExecArguments: { command: 'node verify.js' },
    requestSha256: 'y'.repeat(64),
    turnStatus: 'done',
    events: [{ type: 'model.message', tool_calls: [execCall('{"command":42}')] }],
  });
  assert.ok(r.includes('EXEC_ARGUMENTS_INVALID'), `got ${r.join(',')}`);
  assert.ok(!r.includes('EXEC_COMPARATOR_ERROR'), 'a rejected argument shape is not our machinery failing');
});

test('prepared transport preserves a digest-read failure as EXEC_COMPARATOR_ERROR', () => {
  let digestReads = 0;
  const { failure_reasons: r } = inspectPreparedTransport({
    outboundArtifacts: [],
    expectedExecArguments: EXPECTED,
    commandManifest: {
      transport: {
        // The argument gate succeeds. This property is read inside the try,
        // unlike expectedExecArguments.command, which is read before it.
        get exec_arguments_sha256() {
          digestReads += 1;
          throw new Error('injected prepared digest-read failure');
        },
      },
    },
  });
  assert.equal(digestReads, 1, 'the intended fault site must be reached');
  // This focused fixture deliberately omits outbound files; it is not a live
  // transport success. Assert every reason so the unrelated omission is visible.
  assert.deepEqual(r, ['OUTBOUND_ARTIFACT_CARDINALITY_INVALID', 'EXEC_COMPARATOR_ERROR']);
});

test('pr2 reducer preserves a comparison-stage digest-read failure', () => {
  let digestReads = 0;
  const { failure_reasons: r } = reduceExecution({
    manifest: {
      get exec_arguments_sha256() {
        digestReads += 1;
        throw new Error('injected comparison digest-read failure');
      },
    },
    expectedExecArguments: { command: 'node verify.js' },
    requestSha256: 'y'.repeat(64),
    turnStatus: 'done',
    events: [{
      type: 'model.message',
      tool_calls: [execCall('{"command":"node verify.js"}')],
    }],
  });
  assert.equal(digestReads, 1, 'equal valid arguments must reach the digest check');
  // Missing events are intentional in this reducer-only fixture, not evidence
  // of a successful run. The comparison reason must survive final filtering.
  assert.deepEqual(r, [
    'SANDBOX_EVENT_CARDINALITY_INVALID',
    'EXEC_COMPARATOR_ERROR',
    'TOOL_RESPONSE_CARDINALITY_INVALID',
  ]);
});
