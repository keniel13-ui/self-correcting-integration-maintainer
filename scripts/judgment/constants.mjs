export const JUDGMENT_CONTRACT_V5_SHA256 =
  '4329137bdb74cb3c610f0fbb6819a93a82290634e2bb3d354625a68d73e32b8b';
export const JUDGMENT_CONTRACT_SHA256 =
  '69a43ba36493d8fbd6508c4066efe3d006c71ccd3be281547d2e2acf95253aa6';
export const CHANGE_PROPOSAL_SCHEMA_SHA256 =
  '5fd077e8c615c586d6e24db7eb7760ffb147516772108734df6f352560df84b0';
export const AGENT_CAPABILITY_MANIFEST_SHA256 =
  '2f9877a3a35d550d2234a88fc1f7be9dff51aa0180b1bf9597c47bcb792cbf45';
export const CALLER_TOOL_DESCRIPTIONS_SHA256 =
  '37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570';
export const RUNTIME_TOOL_SURFACE_SHA256 =
  '031ee1683a501ed582e95d3ba8df4a8ed6bbfbdc0035abe484db68069045b5b2';
export const PREDECESSOR_KNOWN_CONDITIONS_SHA256 =
  '331a7cc2272c9c68a48585e3d8408f09e4ddb2c0429efcd1f4fbe948c40d0b2c';

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const JUDGMENT_SESSION_CONFIG = Object.freeze({
  iteration_limit: 2,
  sandbox: Object.freeze({ enabled: false, file_downloads: false }),
  dynamic_sub_agents: Object.freeze({ enabled: false }),
  context_management: Object.freeze({
    compaction: Object.freeze({ enabled: false }),
    large_tool_response: Object.freeze({ enabled: false }),
  }),
  generative_ui: Object.freeze({ enabled: false }),
  ask_user_questions: Object.freeze({ enabled: false }),
});

const NONEMPTY_STRING_SCHEMA = deepFreeze({ type: 'string', minLength: 1 });

export const JUDGMENT_RESPONSE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'findings'],
  properties: {
    schema: { type: 'string', enum: ['judgment_response/v1'] },
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'condition', 'path', 'exact_bytes', 'why_it_matters', 'evidence', 'novelty',
          'known_condition_id', 'confidence_basis', 'not_established', 'repair',
        ],
        properties: {
          condition: NONEMPTY_STRING_SCHEMA,
          path: NONEMPTY_STRING_SCHEMA,
          exact_bytes: NONEMPTY_STRING_SCHEMA,
          why_it_matters: NONEMPTY_STRING_SCHEMA,
          evidence: { type: 'array', minItems: 1, items: NONEMPTY_STRING_SCHEMA },
          novelty: { type: 'string', enum: ['NEW', 'CONFIRMS_KNOWN', 'CHANGES_KNOWN'] },
          known_condition_id: { anyOf: [{ type: 'null' }, NONEMPTY_STRING_SCHEMA] },
          confidence_basis: NONEMPTY_STRING_SCHEMA,
          not_established: { type: 'array', minItems: 1, items: NONEMPTY_STRING_SCHEMA },
          repair: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['before_exact', 'after_exact'],
                properties: {
                  before_exact: NONEMPTY_STRING_SCHEMA,
                  after_exact: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    },
  },
});

export const JUDGMENT_RESPONSE_FORMAT = deepFreeze({
  type: 'json_schema',
  json_schema: {
    name: 'judgment_response_v1',
    strict: true,
    schema: JUDGMENT_RESPONSE_SCHEMA,
  },
});

export const RUNTIME_TOOL_SURFACE = Object.freeze([Object.freeze({
  type: 'truefoundry-system',
  mcp_server_id: 'current-datetime',
  mcp_server_name: 'current-datetime',
  name: 'get_current_datetime',
  description: 'Returns the current datetime in ISO-8601 (UTC) and unix epoch MS format.',
  input_schema: Object.freeze({
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: Object.freeze({}),
    additionalProperties: false,
  }),
  is_approval_required: false,
})]);

export const RUNTIME_SOURCE_RECEIPTS = Object.freeze({
  'node_modules/@truefoundry/trueforge/dist/main.js':
    '8b737eda11149eee2ee0ebc3fd5bfc89fbe05471e225713cc2103e90f61b6b18',
  'node_modules/@truefoundry/trueforge-core/dist/agent-session/schemas/agentSpec.mjs':
    '93ff01749ae1cc80480b119d2d4cf0e7e5d1808af6c9dc35a0b1a57bd2f24f37',
  'node_modules/@truefoundry/trueforge-core/dist/agent-session/builtinsFromSpec.mjs':
    '015c8bc79fda5180a726e668f6fc7914aef87940bf174c367b22f7224ea571b4',
  'node_modules/@truefoundry/trueforge-core/dist/core/capabilities/builtins/CurrentDateTime.mjs':
    '923cba369ad813870dad424a9e42171cd039e7bdbd250be53741c410d09e95e7',
  'node_modules/@truefoundry/trueforge-core/dist/core/llm/LLMTypes.mjs':
    '1c50918fb2d182f5789da1313ec192559c6ebbd5f7e7662560de7b77897d908c',
  'node_modules/@truefoundry/trueforge-core/dist/core/runtime/contextUtils.mjs':
    '386483b6351c8a7ec9ce9649a675d649a782756b951eeaf905ba3ae968920b8c',
});

export const RUNTIME_PACKAGE_VERSIONS = Object.freeze({
  '@truefoundry/trueforge': '0.1.4',
  '@truefoundry/trueforge-core': '0.1.4',
});

export const MAX_FILES = 32;
// Candidate bytes are carried twice through the stock exec relay (file base64, then program
// base64). This ceiling keeps the final printable exec command below PR #3's 65,535-byte bound.
export const MAX_FILE_BYTES = 30_000;
export const MAX_CORPUS_BYTES = 30_000;
export const MAX_REPLACEMENT_BYTES = 8_192;
export const MAX_MODEL_TURN_MS = 60_000;
export const MAX_SANDBOX_TURN_MS = 60_000;

export const SYSTEM_INSTRUCTIONS = `You inspect an unfamiliar code corpus for consequential conditions.
You are not told what condition to find. Return exactly one JSON object and no markdown.
For every finding, quote exact bytes from one supplied file. Never provide a line number; the
harness computes it. State a concrete consequence, the evidence you inspected, an honest novelty
class, a prose confidence basis, at least one limit, and at most one bounded exact-byte repair.
Stock TrueForge makes one clock tool available: get_current_datetime. It takes no arguments and
cannot inspect the corpus. You have no other tool and no authority to modify any repository. A
proposal is not approval.`;

export const PROMPT_FRAME = Object.freeze([
  'A human uses this integration code and needs an evidence-backed maintenance proposal.',
  'Inspect the supplied corpus without assuming a particular condition.',
  'Return this closed JSON shape:',
  '{"schema":"judgment_response/v1","findings":[{"condition":"...","path":"...","exact_bytes":"...","why_it_matters":"...","evidence":["..."],"novelty":"NEW|CONFIRMS_KNOWN|CHANGES_KNOWN","known_condition_id":"K1 or null","confidence_basis":"...","not_established":["..."],"repair":{"before_exact":"...","after_exact":"..."} or null}]}',
  'If no condition is supported, return findings:[]. Do not call that CLEAN.',
  'When repair is non-null, repair.before_exact must be byte-identical to exact_bytes; scope exact_bytes to the complete unique span the repair replaces.',
  `A repair after_exact value must be at most ${MAX_REPLACEMENT_BYTES} UTF-8 bytes.`,
]);

export const TOOL_DESCRIPTIONS = Object.freeze([]);

export const AGENT_CAPABILITIES = Object.freeze({
  allowed: Object.freeze(['receive_corpus_bytes', 'return_json', 'get_current_datetime']),
  denied: Object.freeze([
    'apply_change',
    'commit',
    'filesystem_write',
    'git_push',
    'mint_approval',
    'network',
    'read_approval_token',
    'spawn_subagent',
  ]),
});
