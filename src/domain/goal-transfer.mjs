import { createHash } from 'node:crypto';

export const GOAL_TRANSFER_CHAIN_ID = 46630;
export const GOAL_TRANSFER_ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
export const GOAL_TRANSFER_WINDOW_MS = 15 * 60 * 1000;
const UINT256 = (1n << 256n) - 1n;
const INPUT_FIELDS = ['id', 'goalId', 'source', 'review', 'chainId', 'account', 'token', 'recipient', 'amountAtomic', 'createdAt', 'expiresAt'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export class GoalTransferError extends Error {
  constructor(code) { super(`Goal transfer refused: ${code}.`); this.name = 'GoalTransferError'; this.code = code; }
}
function fail(code = 'invalid_goal_transfer') { throw new GoalTransferError(code); }
function exact(value, fields) {
  if (!plain(value)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length || !fields.every(key => own(descriptors, key) && descriptors[key].enumerable && own(descriptors[key], 'value'))) fail();
}
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,99}$/.test(value)) fail(); return value; }
function uuid(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) fail(); return value; }
function digest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(); return value; }
function address(value) { if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value) || /^0x0{40}$/i.test(value)) fail(); return value.toLowerCase(); }
function iso(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_time'); return value; }
function amount(value) { if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) > UINT256) fail('invalid_amount'); return value; }

function contents(input) {
  exact(input, INPUT_FIELDS);
  exact(input.source, ['workId', 'workDigest', 'decisionDigest', 'workspaceId', 'workspaceETag']);
  exact(input.review, ['id', 'digest']);
  exact(input.token, ['address', 'decimals', 'symbol']);
  const source = { workId: uuid(input.source.workId), workDigest: digest(input.source.workDigest), decisionDigest: digest(input.source.decisionDigest), workspaceId: input.source.workspaceId, workspaceETag: input.source.workspaceETag };
  if (typeof source.workspaceId !== 'string' || !/^local:[a-f0-9]{64}$/.test(source.workspaceId) || typeof source.workspaceETag !== 'string' || !/^"(?:0|[1-9][0-9]{0,15})"$/.test(source.workspaceETag)) fail('invalid_source_reference');
  if (input.chainId !== GOAL_TRANSFER_CHAIN_ID) fail('wrong_chain');
  const account = address(input.account), recipient = address(input.recipient);
  const token = { address: address(input.token.address), decimals: input.token.decimals, symbol: input.token.symbol };
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18 || typeof token.symbol !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(token.symbol)) fail('invalid_token');
  if (account === recipient || token.address === account || token.address === recipient) fail('invalid_recipient');
  const amountAtomic = amount(input.amountAtomic), createdAt = iso(input.createdAt), expiresAt = iso(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt) || Date.parse(expiresAt) - Date.parse(createdAt) > GOAL_TRANSFER_WINDOW_MS) fail('invalid_time');
  const data = `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${BigInt(amountAtomic).toString(16).padStart(64, '0')}`;
  return {
    format: 'angbao-goal-transfer-intent@1', kind: 'erc20-test-token-goal-transfer',
    id: id(input.id), goalId: id(input.goalId), source,
    review: { id: uuid(input.review.id), digest: digest(input.review.digest) },
    chainId: GOAL_TRANSFER_CHAIN_ID, account, token, recipient, amountAtomic, createdAt, expiresAt,
    call: { to: token.address, data, valueWei: '0' },
  };
}
function stamped(body) { return freeze({ ...body, intentDigest: createHash('sha256').update(canonical({ domain: 'angbao.goal-transfer-intent.v1', intent: body })).digest('hex') }); }

/** Exact local declaration only. Caller must independently resolve saved work/review. */
export function createGoalTransferIntent(input, options = {}) {
  if (!plain(options)) fail();
  exact(options, own(options, 'now') ? ['now'] : []);
  const now = own(options, 'now') ? options.now : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('invalid_time');
  const body = contents(input), clock = now.getTime();
  if (Date.parse(body.createdAt) > clock) fail('invalid_time');
  if (Date.parse(body.expiresAt) <= clock) fail('expired');
  return stamped(body);
}

/** Integrity only: historical/expired pending intents can reconcile existing hashes. */
export function validateGoalTransferIntent(intent) {
  exact(intent, [...INPUT_FIELDS, 'format', 'kind', 'call', 'intentDigest']);
  exact(intent.call, ['to', 'data', 'valueWei']);
  digest(intent.intentDigest);
  const input = Object.fromEntries(INPUT_FIELDS.map(key => [key, intent[key]]));
  const expected = stamped(contents(input));
  // Compare typed primitives before canonicalizing any caller-provided derived field.
  if (intent.format !== expected.format || intent.kind !== expected.kind || intent.call.to !== expected.call.to || intent.call.data !== expected.call.data || intent.call.valueWei !== '0' || intent.intentDigest !== expected.intentDigest) fail('intent_changed');
  if (canonical(intent) !== canonical(expected)) fail('intent_changed');
  return expected;
}

/** Kernel 0.3.1 EntryPoint 0.7 ordinary CALL/default encoding; no SDK/client needed. */
export function encodeGoalTransferKernelCallData(intent) {
  const checked = validateGoalTransferIntent(intent);
  const payload = `${checked.token.address.slice(2)}${'0'.repeat(64)}${checked.call.data.slice(2)}`;
  return `0xe9ae5c53${'0'.repeat(64)}${'40'.padStart(64, '0')}${(payload.length / 2).toString(16).padStart(64, '0')}${payload.padEnd(Math.ceil(payload.length / 64) * 64, '0')}`;
}
