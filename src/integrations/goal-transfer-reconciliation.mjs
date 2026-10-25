/** Pure correlation of supplied ERC20/UserOperation evidence. No transport or wallet exists here. */
import { decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi } from '../vendor/goal-transfer-viem.mjs';
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash, toPackedUserOperation } from '../vendor/goal-transfer-viem.mjs';
import { validateGoalTransferIntent, encodeGoalTransferKernelCallData } from '../domain/goal-transfer.mjs';

if (typeof window !== 'undefined') throw new Error('Goal transfer reconciliation is server-only.');
const UINT256 = (1n << 256n) - 1n, UINT128 = (1n << 128n) - 1n;
const UINT120 = (1n << 120n) - 1n;
const TOP = ['format', 'sourceRole', 'chainId', 'observedAt', 'submission', 'transaction', 'receipt', 'canonicalBlock', 'latestBlockNumber', 'baseline', 'after', 'baselineCanonicalBlock', 'tokenTransferLogs'];
const UOP = ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymaster', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit', 'paymasterData'];
const GAS = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'];
const BALANCES = ['blockNumber', 'blockHash', 'tokenAccountAtomic', 'tokenRecipientAtomic', 'nativeAccountWei', 'entryPointDepositWei'];
const TRANSFER_ABI = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export class GoalTransferReconciliationError extends Error {
  constructor() { super('The supplied goal-transfer observation is invalid.'); this.name = 'GoalTransferReconciliationError'; this.code = 'invalid_goal_transfer_evidence'; }
}
const fail = () => { throw new GoalTransferReconciliationError(); };
function exact(value, keys) { if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(); }
function bounded(value) {
  let nodes = 0; const visiting = new Set();
  function visit(item, depth) {
    if (++nodes > 15000 || depth > 16) fail();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > 131072) fail(); return; }
    if (typeof item === 'number') { if (!Number.isSafeInteger(item)) fail(); return; }
    if ((!plain(item) && !Array.isArray(item)) || visiting.has(item)) fail();
    visiting.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail();
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
      visit(descriptor.value, depth + 1);
    }
    visiting.delete(item);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 131072) fail();
}
function hex(value, bytes) { if (typeof value !== 'string' || !(bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x(?:[0-9a-fA-F]{2})*$/).test(value)) fail(); return value.toLowerCase(); }
function address(value, zero = false) { const result = hex(value, 20); if (!zero && /^0x0{40}$/.test(result)) fail(); return result; }
function integer(value, max = UINT256) { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > max) fail(); return BigInt(value); }
function quantity(value) { if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) fail(); return BigInt(value); }
function timestamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(); return Date.parse(value); }
const equal = (left, right) => typeof left === 'bigint' ? left === right : typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
function typedUserOperation(input, intent) {
  exact(input, UOP);
  const result = { ...input, sender: address(input.sender), paymaster: address(input.paymaster), callData: hex(input.callData), paymasterData: hex(input.paymasterData) };
  for (const key of ['nonce', ...GAS, 'maxFeePerGas', 'maxPriorityFeePerGas']) result[key] = integer(input[key], ['nonce', 'preVerificationGas'].includes(key) ? UINT256 : UINT128);
  if (result.sender !== intent.account.toLowerCase() || result.callData !== encodeGoalTransferKernelCallData(intent).toLowerCase() || result.maxFeePerGas === 0n || result.maxPriorityFeePerGas > result.maxFeePerGas || GAS.some(key => result[key] === 0n) || [...GAS, 'maxFeePerGas', 'maxPriorityFeePerGas'].some(key => result[key] > UINT120)) fail();
  return result;
}
function logMetadata(log, receipt, index = null) {
  if (!plain(log) || log.removed !== false || hex(log.transactionHash, 32) !== hex(receipt.transactionHash, 32) || hex(log.blockHash, 32) !== hex(receipt.blockHash, 32) || quantity(log.blockNumber) !== quantity(receipt.blockNumber) || quantity(log.transactionIndex) !== quantity(receipt.transactionIndex)) fail();
  const position = quantity(log.logIndex); if (index !== null && position <= index) fail();
  address(log.address); if (!Array.isArray(log.topics) || log.topics.length > 4) fail(); log.topics.forEach(topic => hex(topic, 32)); hex(log.data);
  return position;
}
function entryEvent(log, entryPoint) {
  if (log.address.toLowerCase() !== entryPoint) return null;
  try {
    const event = decodeEventLog({ abi: entryPoint07Abi, data: log.data, topics: log.topics, strict: true });
    if (event.eventName === 'BeforeExecution' && (log.topics.length !== 1 || log.data !== '0x')) return null;
    if (event.eventName === 'UserOperationEvent') {
      const topics = encodeEventTopics({ abi: entryPoint07Abi, eventName: 'UserOperationEvent', args: event.args });
      const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [event.args.nonce, event.args.success, event.args.actualGasCost, event.args.actualGasUsed]);
      if (JSON.stringify(topics).toLowerCase() !== JSON.stringify(log.topics).toLowerCase() || data !== log.data.toLowerCase()) return null;
    }
    return event;
  } catch { return null; }
}
function transfer(log, token) {
  if (log.address.toLowerCase() !== token) return null;
  try {
    const event = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics, strict: true });
    const topics = encodeEventTopics({ abi: TRANSFER_ABI, eventName: 'Transfer', args: event.args });
    const data = encodeAbiParameters([{ type: 'uint256' }], [event.args.value]);
    return JSON.stringify(topics).toLowerCase() === JSON.stringify(log.topics).toLowerCase() && data === log.data.toLowerCase() ? event : null;
  } catch { return null; }
}

function balanceContext(intent, evidence, receipt, selectedLog) {
  const missing = { balanceContextStatus: 'missing', balanceContextReason: 'No usable before-and-after snapshots were supplied.', balanceEffects: null };
  if (evidence.baseline === null || evidence.after === null) return missing;
  let effects = null;
  try {
    const baseline = evidence.baseline, after = evidence.after;
    exact(baseline, BALANCES); exact(after, BALANCES);
    const beforeBlock = quantity(baseline.blockNumber), receiptBlock = quantity(receipt.blockNumber), amount = integer(intent.amountAtomic);
    const beforeAccount = integer(baseline.tokenAccountAtomic), beforeRecipient = integer(baseline.tokenRecipientAtomic), afterAccount = integer(after.tokenAccountAtomic), afterRecipient = integer(after.tokenRecipientAtomic);
    const nativeDelta = integer(after.nativeAccountWei) - integer(baseline.nativeAccountWei), depositDelta = integer(after.entryPointDepositWei) - integer(baseline.entryPointDepositWei);
    const deltaMatched = beforeAccount >= amount && afterAccount === beforeAccount - amount && afterRecipient === beforeRecipient + amount && nativeDelta === 0n && depositDelta === 0n;
    effects = { beforeCheckpoint: { blockNumber: baseline.blockNumber, blockHash: hex(baseline.blockHash, 32) }, afterCheckpoint: { blockNumber: after.blockNumber, blockHash: hex(after.blockHash, 32) }, tokenAccountBeforeAtomic: beforeAccount.toString(), tokenAccountAfterAtomic: afterAccount.toString(), tokenRecipientBeforeAtomic: beforeRecipient.toString(), tokenRecipientAfterAtomic: afterRecipient.toString(), tokenAccountDeltaAtomic: (afterAccount - beforeAccount).toString(), tokenRecipientDeltaAtomic: (afterRecipient - beforeRecipient).toString(), amountAtomic: amount.toString(), nativeAccountDeltaWei: nativeDelta.toString(), entryPointDepositDeltaWei: depositDelta.toString(), deltasMatchIntendedAmount: deltaMatched, assurance: 'Net block-snapshot context only. Concurrent activity or an unavailable baseline does not invalidate exact per-UserOperation transfer proof. No provider billing or individual fee-payer expense proof.' };
    const context = (status, reason) => ({ balanceContextStatus: status, balanceContextReason: reason, balanceEffects: effects });
    if (quantity(after.blockNumber) !== receiptBlock || hex(after.blockHash, 32) !== hex(receipt.blockHash, 32)) return context('reorg-uncertain-context', 'The after snapshot differs from the canonical receipt checkpoint.');
    const recheck = evidence.baselineCanonicalBlock;
    if (recheck !== null && (!plain(recheck) || quantity(recheck.number) !== beforeBlock || hex(recheck.hash, 32) !== hex(baseline.blockHash, 32))) return context('reorg-uncertain-context', 'The baseline checkpoint no longer matches its recheck; receipt proof remains separate.');
    if (beforeBlock + 1n !== receiptBlock || recheck === null || evidence.canonicalBlock.parentHash?.toLowerCase() !== baseline.blockHash.toLowerCase()) return context('unisolated-context', 'Snapshots do not isolate the receipt block. Their net changes may include other activity.');
    if (!Array.isArray(evidence.tokenTransferLogs) || evidence.tokenTransferLogs.length > 128) return context('unisolated-context', 'Bounded receipt-block token-log context is unavailable.');
    let selectedSeen = 0; const seen = new Set();
    for (const log of evidence.tokenTransferLogs) {
      if (!plain(log) || log.removed !== false || address(log.address) !== intent.token.address.toLowerCase() || quantity(log.blockNumber) !== receiptBlock || hex(log.blockHash, 32) !== hex(receipt.blockHash, 32)) return context('unisolated-context', 'Token-log context is malformed, incomplete or belongs to another checkpoint.');
      const key = `${hex(log.transactionHash, 32)}:${quantity(log.logIndex)}`;
      if (seen.has(key)) return context('unisolated-context', 'Token-log context contains duplicate positions.'); seen.add(key);
      const item = transfer(log, intent.token.address.toLowerCase())?.args;
      if (!item) return context('unisolated-context', 'Token-log context cannot be decoded canonically.');
      const selected = key === `${hex(receipt.transactionHash, 32)}:${quantity(selectedLog.logIndex)}`;
      if (selected) {
        logMetadata(log, receipt);
        if (JSON.stringify(log.topics).toLowerCase() !== JSON.stringify(selectedLog.topics).toLowerCase() || log.data.toLowerCase() !== selectedLog.data.toLowerCase()) return context('unisolated-context', 'The contextual selected log differs from the receipt log.');
        selectedSeen++;
      } else if ([item.from.toLowerCase(), item.to.toLowerCase()].some(value => [intent.account.toLowerCase(), intent.recipient.toLowerCase()].includes(value))) return context('unisolated-context', 'Other receipt-block token movements involve a selected account.');
    }
    return selectedSeen === 1 && deltaMatched ? context('isolated-delta-matched', 'Adjacent canonical snapshots and supplied receipt-block logs match the intended net delta under reviewed standard-token semantics.') : context('unisolated-context', 'Net deltas or receipt-block contextual logs do not isolate the intended amount.');
  } catch {
    return { balanceContextStatus: 'unisolated-context', balanceContextReason: 'Supplied optional balance context is malformed or unusable.', balanceEffects: effects };
  }
}

export const goalTransferReconciliationEvidenceSchema = freeze({ format: 'angbao-goal-transfer-chain-evidence@1', requiredKeys: TOP, submissionKeys: ['intentDigest', 'entryPoint', 'userOperationHash', 'userOperation'], unsignedUserOperationKeys: UOP, balanceSnapshotKeys: BALANCES, integerEncoding: 'UserOperation integers and balances are canonical unsigned decimal strings; block/log/RPC quantities are canonical hexadecimal quantities.', missingObservation: 'Use null. Missing primary receipt facts remain uncertain; missing balances/log context does not invalidate primary proof.', maxEvidenceBytes: 131072, tokenLogContext: 'Optional receipt-block-only context; no baseline-age or block-gap limit.', maxTokenLogs: 128, authority: 'No supplied evidence authenticates ownership, free provider billing or execution authority.' });

/** Integrity-only prerequisite for a separately approved transport; no approval or hash submission occurs. */
export function validateGoalTransferSubmission(intent, submission) {
  validateGoalTransferIntent(intent); bounded(submission);
  exact(submission, ['intentDigest', 'entryPoint', 'userOperationHash', 'userOperation']);
  const entryPoint = address(submission.entryPoint);
  if (submission.intentDigest !== intent.intentDigest || entryPoint !== entryPoint07Address.toLowerCase()) fail();
  const typed = typedUserOperation(submission.userOperation, intent);
  const hash = getUserOperationHash({ chainId: 46630, entryPointAddress: entryPoint, entryPointVersion: '0.7', userOperation: typed });
  if (hex(submission.userOperationHash, 32) !== hash) fail();
  return freeze({ intentDigest: intent.intentDigest, entryPoint, userOperationHash: hash, userOperation: Object.fromEntries(UOP.map(key => [key, typeof typed[key] === 'bigint' ? typed[key].toString() : typed[key]])) });
}

export const goalTransferReconciliationRequestPlan = freeze({ status: 'unapproved-planning-only', requestsPerformed: 0, maxRequests: 20, publicChainRequests: 19, bundlerReceiptRequests: 1, observationWithoutBaselineMaxRequests: 12, retries: 0, polling: false, packets: [
  { id: 'baseline-discovery', maxRequests: 2, approval: 'not-requested', methods: ['eth_chainId', 'eth_getBlockByNumber(latest)'] },
  { id: 'baseline-snapshot', maxRequests: 5, approval: 'not-requested', methods: ['eth_call token.balanceOf(account)', 'eth_call token.balanceOf(recipient)', 'eth_getBalance(account)', 'eth_call EntryPoint.balanceOf(account)', 'eth_getBlockByNumber(baseline-number)'] },
  { id: 'observation-discovery', maxRequests: 1, approval: 'not-requested', methods: ['eth_getUserOperationReceipt'] },
  { id: 'observation-transaction', maxRequests: 3, approval: 'not-requested', methods: ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'] },
  { id: 'observation-snapshot', maxRequests: 9, approval: 'not-requested', methods: ['eth_getBlockByNumber(receipt-number)', 'eth_blockNumber', 'eth_call token.balanceOf(account)', 'eth_call token.balanceOf(recipient)', 'eth_getBalance(account)', 'eth_call EntryPoint.balanceOf(account)', 'eth_getLogs token Transfer receipt-block-only', 'eth_getBlockByNumber(baseline-number) only if supplied', 'eth_getBlockByNumber(receipt-number)'] },
], readLimits: { perRequestTimeoutMs: 5000, perPacketTimeoutMs: 30000, maxResponseBytes: 131072, maxPacketResponseBytes: 1048576 }, currentAuthority: { rpcAllowed: false, bundlerAllowed: false, signingAllowed: false, deploymentAllowed: false, submissionAllowed: false }, scope: 'Optional original baseline7 plus observation13; restart observation without baseline12. No automatic rebaseline or restoration. Balance/deposit calls use reviewed canonical hash-pinned selectors. Exact parameters and each packet need separate approval. No identity/preparation/submission requests are included; exhausted or unsupported reads stop.' });

/** Only verifies consistency of supplied facts; a server transport must independently obtain and brand live observations. */
export function verifyGoalTransferReceipt(intent, evidence, options = {}) {
  validateGoalTransferIntent(intent); bounded(evidence); bounded(options);
  if (!plain(options) || Object.keys(options).some(key => !['minimumConfirmations', 'previous'].includes(key))) fail();
  const { minimumConfirmations = 1, previous = null } = options;
  if (!Number.isSafeInteger(minimumConfirmations) || minimumConfirmations < 1 || minimumConfirmations > 1024) fail();
  exact(evidence, TOP);
  if (evidence.format !== 'angbao-goal-transfer-chain-evidence@1' || evidence.sourceRole !== 'independent-chain-read' || evidence.chainId !== 46630) fail();
  const observed = timestamp(evidence.observedAt);
  const result = { format: 'angbao-goal-transfer-reconciliation@1', verificationSource: 'supplied-evidence', status: 'uncertain', transferStatus: 'not-established', intentDigest: intent.intentDigest, userOperationHash: null, transactionHash: null, blockHash: null, blockNumber: null, confirmations: 0, finality: 'not-established', billingAssurance: 'unverified-provider-billing', observedAt: evidence.observedAt, reason: 'missing-submission', fee: null, balanceEffects: null, balanceContextStatus: 'missing', balanceContextReason: 'Primary receipt evidence is not yet established.', executionAfterIntentExpiry: null, intentExpiryMeaning: 'Local preparation window only. This owner ERC20 call has no onchain deadline; second-resolution block time may leave expiry overlap unknown. Historical receipt reconciliation grants no fresh preparation or submission permission and time comparison does not establish replay protection.', authority: { ownerApprovalEstablished: false, signingAllowed: false, deploymentAllowed: false, submissionAllowed: false } };
  const finish = (reason, extra = {}) => freeze({ ...result, reason, ...extra });
  if (evidence.submission === null) return finish('missing-submission');
  const submission = validateGoalTransferSubmission(intent, evidence.submission), entryPoint = submission.entryPoint;
  const userOperation = typedUserOperation(submission.userOperation, intent);
  const userOperationHash = getUserOperationHash({ chainId: 46630, entryPointAddress: entryPoint, entryPointVersion: '0.7', userOperation });
  if (hex(submission.userOperationHash, 32) !== userOperationHash) fail();
  result.userOperationHash = userOperationHash;
  if (previous !== null && (!plain(previous) || previous.intentDigest !== intent.intentDigest || previous.userOperationHash !== userOperationHash || previous.blockHash !== null && hex(previous.blockHash, 32) !== previous.blockHash)) fail();
  if (evidence.transaction === null || evidence.receipt === null) return finish(previous?.blockHash ? 'reorg-uncertain' : 'receipt-not-observed');
  const tx = evidence.transaction, receipt = evidence.receipt;
  if (!plain(tx) || !plain(receipt)) fail();
  const txHash = hex(tx.hash, 32); result.transactionHash = txHash;
  if (hex(receipt.transactionHash, 32) !== txHash || address(tx.to) !== entryPoint || quantity(tx.value) !== 0n || !['0x0', '0x1'].includes(receipt.status)) fail();
  if (tx.blockHash === null || receipt.blockHash === null || evidence.canonicalBlock === null || evidence.latestBlockNumber === null) return finish('canonicality-not-established');
  const blockHash = hex(receipt.blockHash, 32), blockNumber = quantity(receipt.blockNumber), block = evidence.canonicalBlock;
  result.blockHash = blockHash; result.blockNumber = blockNumber.toString();
  if (hex(tx.blockHash, 32) !== blockHash || quantity(tx.blockNumber) !== blockNumber || quantity(tx.transactionIndex) !== quantity(receipt.transactionIndex)) fail();
  if (!plain(block) || quantity(block.number) !== blockNumber || !Array.isArray(block.transactions) || block.transactions.length > 2048) fail();
  const txIndex = quantity(receipt.transactionIndex);
  if (hex(block.hash, 32) !== blockHash || txIndex >= BigInt(block.transactions.length) || hex(block.transactions[Number(txIndex)], 32) !== txHash || previous?.blockHash && previous.blockHash !== blockHash) return finish('reorg-uncertain');
  const head = quantity(evidence.latestBlockNumber); if (head < blockNumber) return finish('reorg-uncertain');
  const confirmations = head - blockNumber + 1n; if (confirmations > BigInt(Number.MAX_SAFE_INTEGER)) fail(); result.confirmations = Number(confirmations);
  if (receipt.status === '0x0') return finish('bundle-reverted', { status: 'failed', transferStatus: 'failed' });
  let decoded;
  try { decoded = decodeFunctionData({ abi: entryPoint07Abi, data: hex(tx.input) }); } catch { return finish('unsupported-bundle-envelope'); }
  if (decoded.functionName !== 'handleOps' || decoded.args[0].length > 32 || encodeFunctionData({ abi: entryPoint07Abi, functionName: 'handleOps', args: decoded.args }).toLowerCase() !== tx.input.toLowerCase()) return finish('unsupported-bundle-envelope');
  const expectedPacked = toPackedUserOperation(userOperation), candidates = decoded.args[0].filter(op => equal(op.sender, userOperation.sender) && op.nonce === userOperation.nonce);
  if (candidates.length !== 1 || Object.keys(expectedPacked).some(key => key !== 'signature' && !equal(expectedPacked[key], candidates[0][key]))) return finish('user-operation-envelope-mismatch');
  if (!Array.isArray(receipt.logs) || receipt.logs.length > 256) fail();
  let priorIndex = -1n; const events = receipt.logs.map(log => { priorIndex = logMetadata(log, receipt, priorIndex); return entryEvent(log, entryPoint); });
  const opIndices = events.map((event, index) => event?.eventName === 'UserOperationEvent' && event.args.userOpHash.toLowerCase() === userOperationHash ? index : -1).filter(index => index >= 0);
  if (opIndices.length !== 1) return finish('user-operation-event-missing-or-ambiguous');
  const opIndex = opIndices[0], event = events[opIndex].args;
  if (events.some(item => item?.eventName === 'AccountDeployed' && item.args.userOpHash.toLowerCase() === userOperationHash)) return finish('unexpected-account-deployment');
  const operationEvents = events.filter(item => item?.eventName === 'UserOperationEvent');
  if (operationEvents.length !== decoded.args[0].length || operationEvents.some((item, index) => !equal(item.args.sender, decoded.args[0][index].sender) || item.args.nonce !== decoded.args[0][index].nonce) || operationEvents.indexOf(events[opIndex]) !== decoded.args[0].indexOf(candidates[0])) return finish('bundle-operation-order-mismatch');
  if (!equal(event.sender, userOperation.sender) || event.nonce !== userOperation.nonce || !equal(event.paymaster, userOperation.paymaster)) return finish('user-operation-event-mismatch');
  const declaredGas = GAS.reduce((sum, key) => sum + userOperation[key], 0n), declaredCost = declaredGas * userOperation.maxFeePerGas;
  const gasPrice = userOperation.maxFeePerGas < quantity(block.baseFeePerGas) + userOperation.maxPriorityFeePerGas ? userOperation.maxFeePerGas : quantity(block.baseFeePerGas) + userOperation.maxPriorityFeePerGas;
  result.fee = { paymaster: userOperation.paymaster, actualGasCostWei: event.actualGasCost.toString(), actualGasUsed: event.actualGasUsed.toString(), declaredGasUnits: declaredGas.toString(), declaredPrefundCeilingWei: declaredCost.toString(), userOperationGasPriceWei: gasPrice.toString(), gasCostMeaning: 'EntryPoint per-operation charge; not total provider billing or bundle gas allocation.' };
  if (!event.success) return finish('user-operation-failed', { status: 'failed', transferStatus: 'failed' });
  if (event.actualGasUsed === 0n || event.actualGasCost > declaredCost || event.actualGasUsed > declaredGas || event.actualGasCost !== event.actualGasUsed * gasPrice) return finish('gas-cost-mismatch-or-cap-exceeded');
  let boundary = -1;
  for (let index = 0; index < opIndex; index++) if (['BeforeExecution', 'UserOperationEvent'].includes(events[index]?.eventName)) boundary = index;
  if (boundary < 0 || !events.slice(0, boundary + 1).some(item => item?.eventName === 'BeforeExecution')) return finish('operation-log-boundary-missing');
  const relevant = receipt.logs.slice(boundary + 1, opIndex).filter(log => transfer(log, intent.token.address.toLowerCase()));
  const matches = relevant.filter(log => { const item = transfer(log, intent.token.address.toLowerCase()).args; return equal(item.from, intent.account) && equal(item.to, intent.recipient) && item.value === integer(intent.amountAtomic); });
  if (matches.length !== 1 || relevant.some(log => { const item = transfer(log, intent.token.address.toLowerCase()).args; return [item.from.toLowerCase(), item.to.toLowerCase()].some(value => [intent.account.toLowerCase(), intent.recipient.toLowerCase()].includes(value)) && log !== matches[0]; })) return finish('token-transfer-event-missing-or-ambiguous');
  Object.assign(result, balanceContext(intent, evidence, receipt, matches[0]));
  if (observed < timestamp(intent.createdAt)) return finish('observation-precedes-intent');
  if (BigInt(observed) < quantity(block.timestamp) * 1000n) return finish('observation-precedes-block');
  if (quantity(block.timestamp) * 1000n + 999n < BigInt(timestamp(intent.createdAt))) return finish('execution-precedes-intent');
  const blockStartMs = quantity(block.timestamp) * 1000n, expiryMs = BigInt(timestamp(intent.expiresAt));
  result.executionAfterIntentExpiry = blockStartMs >= expiryMs ? true : blockStartMs + 999n < expiryMs ? false : null;
  if (result.confirmations < minimumConfirmations) return finish('confirmation-threshold-not-met', { transferStatus: 'included-success' });
  return finish('exact-transfer-effects-correlated', { status: 'offline-verified', transferStatus: 'confirmation-threshold-met' });
}
