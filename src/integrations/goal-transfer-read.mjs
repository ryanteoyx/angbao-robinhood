import { validateGoalTransferIntent } from '../domain/goal-transfer.mjs';
import { validateGoalTransferSubmission, verifyGoalTransferReceipt } from './goal-transfer-reconciliation.mjs';

if (typeof window !== 'undefined') throw new Error('Goal transfer observations are server-only.');

const CHAIN_ID = 46630;
const ENTRY_POINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const LIMITS = Object.freeze({ responseBytes: 131072, packetBytes: 1048576, requestTimeoutMs: 5000, packetTimeoutMs: 30000, packetRequests: 12, baselineRequests: 7, observationRequests: 13, receiptOnlyRecoveryRequests: 12, baselineRestoreRequests: 6, freshWorkflowRequests: 20, restoredContextRecoveryRequests: 19, logBlockSpan: 1 });
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => {
  if (!plain(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => own(descriptors, key) && descriptors[key].enumerable && own(descriptors[key], 'value'));
};
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const clone = value => structuredClone(value);
const messages = {
  configuration: 'The fixed server observation configuration is invalid.',
  invalid_input: 'The selected transfer observation input is invalid.',
  untrusted_baseline: 'A baseline from this server adapter is required.',
  read_budget_used: 'This intent already attempted its bounded observation scope.',
  intent_not_current: 'Prepare a current intent before taking its transfer baseline.',
  authorization_denied: 'The exact server read packet was not authorized.',
  timeout: 'The bounded provider observation timed out.',
  transport: 'The bounded provider observation could not be completed.',
  http: 'The provider refused the bounded observation.',
  response_too_large: 'The provider observation exceeded its size limit.',
  malformed_rpc: 'The provider returned invalid JSON-RPC evidence.',
  rpc_error: 'The provider refused a required observation read.',
  malformed_result: 'The provider returned malformed observation evidence.',
  wrong_chain: 'The observation endpoint is not on the selected testnet.',
  snapshot_changed: 'The pinned observation block changed.',
};
export class GoalTransferReadError extends Error {
  constructor(code) { super(messages[code] ?? messages.transport); this.name = 'GoalTransferReadError'; this.code = code; }
  toJSON() { return { name: this.name, code: this.code, message: this.message }; }
}
const fail = code => { throw new GoalTransferReadError(code); };
function endpoint(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 2048) fail('configuration');
  let url;
  try { url = new URL(value); } catch { fail('configuration'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || /^(?:0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === '::1' || host === '::' || /^(?:fc|fd|fe80):/i.test(host) || host.startsWith('::ffff:');
  if (url.protocol !== 'https:' || !host || local || url.username || url.password || url.hash) fail('configuration');
  return url.href;
}
const quantity = value => { if (typeof value !== 'string' || !QUANTITY.test(value)) fail('malformed_result'); return value.toLowerCase(); };
const hash = value => { if (typeof value !== 'string' || !HASH.test(value)) fail('malformed_result'); return value.toLowerCase(); };
function header(value, expectedNumber) {
  if (!plain(value)) fail('malformed_result');
  const result = { number: quantity(value.number), hash: hash(value.hash), timestamp: quantity(value.timestamp) };
  if (expectedNumber !== undefined && BigInt(result.number) !== BigInt(expectedNumber)) fail('malformed_result');
  return result;
}
function word(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('malformed_result');
  return BigInt(value).toString();
}
const balanceOf = address => `0x70a08231${address.slice(2).padStart(64, '0')}`;
const req = (service, method, params, optionalContext = false) => ({ service, method, params, ...(optionalContext ? { optionalContext: true } : {}) });
function balanceRequests(intent, block) {
  return [
    req('chain', 'eth_call', [{ to: intent.token.address, data: balanceOf(intent.account) }, block]),
    req('chain', 'eth_call', [{ to: intent.token.address, data: balanceOf(intent.recipient) }, block]),
    req('chain', 'eth_getBalance', [intent.account, block]),
    req('chain', 'eth_call', [{ to: ENTRY_POINT, data: balanceOf(intent.account) }, block]),
  ];
}
function balances(values) {
  return { tokenAccountAtomic: word(values[0]), tokenRecipientAtomic: word(values[1]), nativeAccountWei: BigInt(quantity(values[2])).toString(), entryPointDepositWei: word(values[3]) };
}
function selectedIntent(intent) {
  try { return freeze(clone(validateGoalTransferIntent(intent))); } catch { fail('invalid_input'); }
}
function selectedSubmission(intent, submission) {
  try { return freeze(clone(validateGoalTransferSubmission(intent, submission))); } catch { fail('invalid_input'); }
}
function packet(intent, phase, requests, scope = 'fresh-baseline-and-observation', alreadyAttemptedRequests = 0) {
  if (!requests.length || requests.length > LIMITS.packetRequests) fail('invalid_input');
  const maximumScopeRequests = scope === 'restored-context-recovery' ? 19 : scope === 'receipt-only-recovery' ? 12 : 20;
  return freeze({ format: 'angbao-goal-transfer-read-plan@1', phase, scope, maximumScopeRequests, alreadyAttemptedRequests, intentDigest: intent.intentDigest, chainId: CHAIN_ID, requests, limits: LIMITS, authority: 'read-only-exact-packet', signingAllowed: false, deploymentAllowed: false, submissionAllowed: false });
}

/** Fixed server-owned endpoints and authorization only; no method/URL comes from HTTP action arguments. */
export function createGoalTransferReadAdapter(options) {
  if (!plain(options)) fail('configuration');
  const descriptors = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(descriptors);
  if (!keys.includes('chainRpcUrl') || !keys.includes('bundlerRpcUrl') || keys.some(key => typeof key !== 'string' || !['chainRpcUrl', 'bundlerRpcUrl', 'fetchImpl', 'authorizePlan'].includes(key) || !descriptors[key].enumerable || !own(descriptors[key], 'value'))) fail('configuration');
  const chainUrl = endpoint(options.chainRpcUrl), bundlerUrl = endpoint(options.bundlerRpcUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch, authorizePlan = options.authorizePlan ?? (async () => false);
  if (typeof fetchImpl !== 'function' || typeof authorizePlan !== 'function') fail('configuration');
  const trusted = new WeakSet(), baselines = new WeakSet(), workflows = new Map();
  let sequence = 0;
  function workflow(intent, preferred, action) {
    let current = workflows.get(intent.intentDigest);
    if (!current) { current = { scope: preferred, used: 0, baseline: false, restore: false, observation: false }; workflows.set(intent.intentDigest, current); }
    if (current[action] || action !== 'observation' && (current.scope !== preferred || current.observation)) fail('read_budget_used');
    current[action] = true;
    return current;
  }
  function makePacket(intent, phase, requests, preferred = 'fresh-baseline-and-observation') {
    const current = workflows.get(intent.intentDigest);
    return packet(intent, phase, requests, current?.scope ?? preferred, current?.used ?? 0);
  }
  async function execute(plan, warnings = []) {
    let authorized;
    try { authorized = await authorizePlan(plan); } catch { fail('authorization_denied'); }
    if (authorized !== true) fail('authorization_denied');
    const start = Date.now();
    let packetBytes = 0;
    const results = [];
    for (const request of plan.requests) {
      const current = workflows.get(plan.intentDigest);
      if (!current || current.scope !== plan.scope || current.used >= plan.maximumScopeRequests) fail('read_budget_used');
      const remaining = LIMITS.packetTimeoutMs - (Date.now() - start);
      if (remaining <= 0) fail('timeout');
      current.used++;
      const id = ++sequence, controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GoalTransferReadError('timeout')); }, Math.min(LIMITS.requestTimeoutMs, remaining)); });
      const observe = async () => {
        let response;
        try {
          response = await fetchImpl(request.service === 'chain' ? chainUrl : bundlerUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: request.method, params: request.params }), signal: controller.signal, redirect: 'error', cache: 'no-store' });
        } catch { fail(controller.signal.aborted ? 'timeout' : 'transport'); }
        if (!response?.ok) { controller.abort(); try { await response?.body?.cancel(); } catch { /* Redacted. */ } fail('http'); }
        let text = '', size = 0;
        try {
          if (response.body?.getReader) {
            const reader = response.body.getReader(), decoder = new TextDecoder();
            while (true) {
              const part = await reader.read(); if (part.done) break;
              size += part.value.byteLength;
              if (size > LIMITS.responseBytes || packetBytes + size > LIMITS.packetBytes) { controller.abort(); await reader.cancel(); fail('response_too_large'); }
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } else {
            text = await response.text(); size = new TextEncoder().encode(text).byteLength;
            if (size > LIMITS.responseBytes || packetBytes + size > LIMITS.packetBytes) fail('response_too_large');
          }
        } catch (error) { if (error instanceof GoalTransferReadError) throw error; fail(controller.signal.aborted ? 'timeout' : 'transport'); }
        packetBytes += size;
        let payload; try { payload = JSON.parse(text); } catch { fail('malformed_rpc'); }
        if (!plain(payload) || payload.jsonrpc !== '2.0' || payload.id !== id || own(payload, 'result') === own(payload, 'error')) fail('malformed_rpc');
        if (own(payload, 'error')) fail('rpc_error');
        return payload.result;
      };
      try { results.push(await Promise.race([observe(), timeout])); }
      catch (error) {
        if (!request.optionalContext || !(error instanceof GoalTransferReadError) || ['timeout', 'response_too_large', 'read_budget_used'].includes(error.code)) throw error;
        warnings.push({ phase: plan.phase, method: request.method, code: 'optional-context-unavailable' }); results.push(null);
      } finally { clearTimeout(timer); }
    }
    return results;
  }
  const planBaseline = intent => {
    const selected = selectedIntent(intent);
    return makePacket(selected, 'baseline-discovery', [req('chain', 'eth_chainId', []), req('chain', 'eth_getBlockByNumber', ['latest', false])]);
  };
  function checkedBaseline(intent, baseline) {
    if (!baselines.has(baseline) || baseline.intentDigest !== intent.intentDigest) fail('untrusted_baseline');
    return baseline;
  }
  const planObservation = (intent, submission, baseline = null) => {
    const selected = selectedIntent(intent), submitted = selectedSubmission(selected, submission);
    if (baseline !== null) checkedBaseline(selected, baseline);
    return makePacket(selected, 'observation-discovery', [req('bundler', 'eth_getUserOperationReceipt', [submitted.userOperationHash])], baseline === null ? 'receipt-only-recovery' : baseline.recoveryScope ? 'restored-context-recovery' : 'fresh-baseline-and-observation');
  };
  async function readBaseline(intent) {
    const selected = selectedIntent(intent);
    workflow(selected, 'fresh-baseline-and-observation', 'baseline');
    if (Date.now() < Date.parse(selected.createdAt) || Date.now() >= Date.parse(selected.expiresAt)) fail('intent_not_current');
    const discovery = await execute(planBaseline(selected));
    if (BigInt(quantity(discovery[0])) !== BigInt(CHAIN_ID)) fail('wrong_chain');
    const block = header(discovery[1]);
    const values = await execute(makePacket(selected, 'baseline-snapshot', [...balanceRequests(selected, { blockHash: block.hash, requireCanonical: true }), req('chain', 'eth_getBlockByNumber', [block.number, false])]));
    if (header(values[4], block.number).hash !== block.hash) fail('snapshot_changed');
    const result = freeze({ format: 'angbao-goal-transfer-baseline@1', verificationSource: 'fixed-server-provider-read', intentDigest: selected.intentDigest, chainId: CHAIN_ID, snapshot: { blockNumber: block.number, blockHash: block.hash, ...balances(values) }, observedAt: new Date().toISOString(), readCount: 7, billingAssurance: 'unverified-provider-billing' });
    trusted.add(result); baselines.add(result); return result;
  }
  async function restoreBaseline(intent, descriptor) {
    const selected = selectedIntent(intent);
    if (!exact(descriptor, ['intentDigest', 'blockNumber', 'blockHash']) || descriptor.intentDigest !== selected.intentDigest) fail('invalid_input');
    let number, expectedHash;
    try { number = quantity(descriptor.blockNumber); expectedHash = hash(descriptor.blockHash); } catch { fail('invalid_input'); }
    workflow(selected, 'restored-context-recovery', 'restore');
    const [observed] = await execute(makePacket(selected, 'restore-baseline-header', [req('chain', 'eth_getBlockByNumber', [number, false])], 'restored-context-recovery'));
    const block = header(observed, number);
    if (block.hash !== expectedHash) fail('snapshot_changed');
    const values = await execute(makePacket(selected, 'restore-baseline-snapshot', [...balanceRequests(selected, { blockHash: expectedHash, requireCanonical: true }), req('chain', 'eth_getBlockByNumber', [number, false])], 'restored-context-recovery'));
    if (header(values[4], number).hash !== expectedHash) fail('snapshot_changed');
    const result = freeze({ format: 'angbao-goal-transfer-baseline@1', verificationSource: 'fixed-server-provider-read', intentDigest: selected.intentDigest, chainId: CHAIN_ID, snapshot: { blockNumber: number, blockHash: expectedHash, ...balances(values) }, observedAt: new Date().toISOString(), readCount: 6, recoveryScope: 'separately-authorized-context-only', billingAssurance: 'unverified-provider-billing' });
    trusted.add(result); baselines.add(result); return result;
  }
  async function observe(intent, submission, baseline = null) {
    const selected = selectedIntent(intent), submitted = selectedSubmission(selected, submission);
    const before = baseline === null ? null : checkedBaseline(selected, baseline);
    const current = workflow(selected, before ? before.recoveryScope ? 'restored-context-recovery' : 'fresh-baseline-and-observation' : 'receipt-only-recovery', 'observation');
    const scope = current.scope, contextWarnings = [];
    const [bundlerReceipt] = await execute(planObservation(selected, submitted, before));
    if (bundlerReceipt === null) {
      const evidence = { format: 'angbao-goal-transfer-chain-evidence@1', sourceRole: 'independent-chain-read', chainId: CHAIN_ID, observedAt: new Date().toISOString(), submission: submitted, transaction: null, receipt: null, canonicalBlock: null, latestBlockNumber: null, baseline: before?.snapshot ?? null, after: null, baselineCanonicalBlock: null, tokenTransferLogs: null };
      const result = freeze({ ...verifyGoalTransferReceipt(selected, evidence), verificationSource: 'fixed-server-provider-read', readCount: 1, workflowScope: scope, workflowAttemptedRequests: current.used, contextWarnings, evidence });
      trusted.add(result); return result;
    }
    if (!plain(bundlerReceipt) || !plain(bundlerReceipt.receipt) || hash(bundlerReceipt.userOpHash) !== submitted.userOperationHash) fail('malformed_result');
    const transactionHash = hash(bundlerReceipt.receipt.transactionHash);
    const core = await execute(makePacket(selected, 'observation-transaction', [req('chain', 'eth_chainId', []), req('chain', 'eth_getTransactionByHash', [transactionHash]), req('chain', 'eth_getTransactionReceipt', [transactionHash])], scope));
    if (BigInt(quantity(core[0])) !== BigInt(CHAIN_ID)) fail('wrong_chain');
    const receipt = core[2];
    if (!plain(receipt) || hash(receipt.transactionHash) !== transactionHash) fail('malformed_result');
    const receiptNumber = quantity(receipt.blockNumber), receiptHash = hash(receipt.blockHash);
    const values = await execute(makePacket(selected, 'observation-snapshot', [req('chain', 'eth_getBlockByNumber', [receiptNumber, false]), req('chain', 'eth_blockNumber', []), ...balanceRequests(selected, { blockHash: receiptHash, requireCanonical: true }).map(request => ({ ...request, optionalContext: true })), req('chain', 'eth_getLogs', [{ address: selected.token.address, fromBlock: receiptNumber, toBlock: receiptNumber, topics: [TRANSFER_TOPIC] }], true), ...(before ? [req('chain', 'eth_getBlockByNumber', [before.snapshot.blockNumber, false], true)] : []), req('chain', 'eth_getBlockByNumber', [receiptNumber, false])], scope), contextWarnings);
    const canonicalBlock = header(values[0], receiptNumber), latestBlockNumber = quantity(values[1]);
    if (canonicalBlock.hash !== receiptHash || header(values[before ? 8 : 7], receiptNumber).hash !== receiptHash) fail('snapshot_changed');
    let after = null, baselineCanonicalBlock = null, tokenTransferLogs = null;
    try { after = { blockNumber: receiptNumber, blockHash: receiptHash, ...balances(values.slice(2, 6)) }; }
    catch { contextWarnings.push({ phase: 'observation-snapshot', code: 'balance-context-unavailable' }); }
    if (before && values[7] !== null) {
      try { baselineCanonicalBlock = header(values[7], before.snapshot.blockNumber); }
      catch { contextWarnings.push({ phase: 'observation-snapshot', code: 'baseline-context-unavailable' }); }
    }
    if (Array.isArray(values[6]) && values[6].length <= 128) {
      tokenTransferLogs = values[6].map(log => plain(log) ? Object.fromEntries(['address', 'topics', 'data', 'blockNumber', 'blockHash', 'transactionHash', 'transactionIndex', 'logIndex', 'removed'].map(key => [key, key === 'topics' ? Array.isArray(log.topics) && log.topics.length <= 4 ? log.topics.map(topic => typeof topic === 'string' ? topic : null) : null : key === 'removed' ? typeof log.removed === 'boolean' ? log.removed : null : typeof log[key] === 'string' ? log[key] : null])) : null);
    } else contextWarnings.push({ phase: 'observation-snapshot', code: 'token-log-context-unavailable' });
    const evidence = { format: 'angbao-goal-transfer-chain-evidence@1', sourceRole: 'independent-chain-read', chainId: CHAIN_ID, observedAt: new Date().toISOString(), submission: submitted, transaction: core[1], receipt, canonicalBlock: clone(values[0]), latestBlockNumber, baseline: before?.snapshot ?? null, after, baselineCanonicalBlock, tokenTransferLogs };
    if (Buffer.byteLength(JSON.stringify(evidence)) > LIMITS.responseBytes) {
      evidence.baseline = null; evidence.after = null; evidence.baselineCanonicalBlock = null; evidence.tokenTransferLogs = null;
      contextWarnings.push({ phase: 'observation-snapshot', code: 'optional-context-size-limit' });
    }
    let verified;
    try { verified = verifyGoalTransferReceipt(selected, evidence); } catch { fail('malformed_result'); }
    const result = freeze({ ...verified, ...(verified.status === 'offline-verified' ? { status: 'confirmed' } : {}), verificationSource: 'fixed-server-provider-read', billingAssurance: 'unverified-provider-billing', readCount: before ? 13 : 12, workflowScope: scope, workflowAttemptedRequests: current.used, contextWarnings, evidence });
    trusted.add(result); return result;
  }
  return Object.freeze({ planBaseline, readBaseline, restoreBaseline, planObservation, observe, isTrustedResult: value => trusted.has(value) });
}
