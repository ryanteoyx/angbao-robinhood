/** Privacy projection after a trusted read. These records are historical facts, never live reader brands. */
import { createHash } from 'node:crypto';
import { validateGoalTransferIntent } from './goal-transfer.mjs';
import { validateGoalTransferSubmission, verifyGoalTransferReceipt } from '../integrations/goal-transfer-reconciliation.mjs';
import { decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeEventTopics, entryPoint07Abi, parseAbi, toPackedUserOperation } from '../vendor/goal-transfer-viem.mjs';

if (typeof window !== 'undefined') throw new Error('Goal transfer retention is server-only.');
const FORMAT = 'angbao-retained-goal-transfer-observation@1';
const DOMAIN = 'angbao.retained-goal-transfer-observation.v1';
const TRANSFER = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const TOP = ['format','intentDigest','observedAt','recordedStatus','submission','transaction','receipt','canonicalBlock','latestBlockNumber','bundle','summary','redaction','retainedDigest'];
const TX = ['hash','to','value','blockHash','blockNumber','transactionIndex'];
const RECEIPT = ['transactionHash','blockHash','blockNumber','transactionIndex','status','gasUsed','effectiveGasPrice','events'];
const BLOCK = ['number','hash','parentHash','timestamp','baseFeePerGas','transactions'];
const META = ['address','transactionHash','blockHash','blockNumber','transactionIndex','logIndex','removed'];
const SUMMARY = ['status','reason','transferStatus','userOperationHash','transactionHash','blockHash','blockNumber','confirmations','fee','executionAfterIntentExpiry'];
const FEE = ['paymaster','actualGasCostWei','actualGasUsed','declaredGasUnits','declaredPrefundCeilingWei','userOperationGasPriceWei'];
const REDACTION = ['scheme','rawInputRetained','rawTransactionRetained','originalInputSha256','inputByteLength','packedSignatureCountRemoved','unselectedPayloadsRetained'];
const GAS = ['callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit'];
const REASONS = new Set(['missing-submission','receipt-not-observed','canonicality-not-established','reorg-uncertain','bundle-reverted','unsupported-bundle-envelope','user-operation-envelope-mismatch','user-operation-event-missing-or-ambiguous','unexpected-account-deployment','bundle-operation-order-mismatch','user-operation-event-mismatch','user-operation-failed','gas-cost-mismatch-or-cap-exceeded','operation-log-boundary-missing','token-transfer-event-missing-or-ambiguous','observation-precedes-intent','observation-precedes-block','execution-precedes-intent','confirmation-threshold-not-met','exact-transfer-effects-correlated']);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const same = (a,b) => canonical(a) === canonical(b);
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export class GoalTransferRetentionError extends Error {
  constructor() { super('The retained goal-transfer observation is invalid.'); this.name = 'GoalTransferRetentionError'; this.code = 'invalid_goal_transfer_retention'; }
}
const fail = () => { throw new GoalTransferRetentionError(); };
function bounded(value, bytes) {
  let nodes = 0; const visiting = new Set();
  function visit(v, depth) {
    if (++nodes > 15000 || depth > 18) fail();
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { if (v.length > bytes) fail(); return; }
    if (typeof v === 'number') { if (!Number.isSafeInteger(v)) fail(); return; }
    if ((!plain(v) && !Array.isArray(v)) || visiting.has(v)) fail();
    const descriptors = Object.getOwnPropertyDescriptors(v); visiting.add(v);
    if (Array.isArray(v) && Object.keys(v).length !== v.length) fail();
    for (const k of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(v) && k === 'length') continue;
      const d = descriptors[k];
      if (typeof k !== 'string' || ['__proto__','constructor','prototype'].includes(k) || !d.enumerable || !Object.hasOwn(d,'value')) fail();
      visit(d.value,depth+1);
    }
    visiting.delete(v);
  }
  visit(value,0); if (Buffer.byteLength(JSON.stringify(value)) > bytes) fail();
}
function exact(v, keys) { if (!plain(v) || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v,k))) fail(); }
const pick = (v, keys) => Object.fromEntries(keys.map(k => [k,v[k]]));
function hex(v, bytes) { if (typeof v !== 'string' || !(bytes ? new RegExp(`^0x[0-9a-f]{${bytes*2}}$`) : /^0x(?:[0-9a-f]{2})*$/).test(v)) fail(); return v; }
function q(v) { if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v)) fail(); return BigInt(v); }
function n(v) { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 1n<<256n) fail(); return BigInt(v); }
function iso(v) { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(); return Date.parse(v); }
const lower = v => typeof v === 'string' ? v.toLowerCase() : null;
const nullable = (v, check) => { if (v !== null) check(v); };
const digest = body => createHash('sha256').update(canonical({domain:DOMAIN,observation:body})).digest('hex');
const typed = operation => Object.fromEntries(Object.entries(operation).map(([k,v]) => [k,['nonce',...GAS,'maxFeePerGas','maxPriorityFeePerGas'].includes(k) ? BigInt(v) : v]));
const normalized = v => typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? v.toLowerCase() : v;

function safeEvent(log, intent) {
  const entryPoint = intent.entryPoint ?? '0x0000000071727de22e5e9d8baf0edac6f37da032';
  const emitter = lower(log.address), abi = emitter === entryPoint ? entryPoint07Abi : emitter === intent.token.address ? TRANSFER : null;
  if (!abi) return null;
  try {
    const decoded = decodeEventLog({abi,topics:log.topics,data:log.data,strict:true});
    if (!['BeforeExecution','UserOperationEvent','Transfer'].includes(decoded.eventName)) return null;
    const topics = encodeEventTopics({abi,eventName:decoded.eventName,args:decoded.args});
    const args = decoded.args ?? {};
    const data = decoded.eventName === 'BeforeExecution' ? '0x' : decoded.eventName === 'Transfer'
      ? encodeAbiParameters([{type:'uint256'}],[args.value])
      : encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[args.nonce,args.success,args.actualGasCost,args.actualGasUsed]);
    if (!same(topics.map(lower),log.topics.map(lower)) || data !== lower(log.data)) return null;
    const names = decoded.eventName === 'BeforeExecution' ? [] : decoded.eventName === 'Transfer' ? ['from','to','value'] : ['userOpHash','sender','paymaster','nonce','success','actualGasCost','actualGasUsed'];
    return {type:decoded.eventName === 'BeforeExecution' ? 'EntryPointBeforeExecution' : decoded.eventName,...Object.fromEntries(META.map(k => [k,k === 'removed' ? log[k] : lower(log[k])])),args:Object.fromEntries(names.map(k => [k,normalized(args[k])]))};
  } catch { return null; }
}
function summarize(original) { return {...pick(original,SUMMARY),fee:original.fee === null ? null : pick(original.fee,FEE)}; }
function recorded(summary, tx, receipt) { return summary.status === 'confirmed' ? 'confirmed-at-observation' : summary.status === 'failed' ? 'failed-at-observation' : summary.reason === 'receipt-not-observed' && tx === null && receipt === null ? 'pending-at-observation' : 'uncertain-at-observation'; }

/** Only a WeakSet-branded ORIGINAL provider result can enter this projection. The reader is a server-owned dependency. */
export function retainVerifiedGoalTransferObservation(intent, observation, reader) {
  try {
    bounded(observation,262144);
    const checker = reader && Object.getOwnPropertyDescriptor(reader,'isTrustedResult');
    if (!checker || !Object.hasOwn(checker,'value') || typeof checker.value !== 'function' || checker.value.call(reader,observation) !== true || observation.verificationSource !== 'fixed-server-provider-read') fail();
    const evidence = observation.evidence;
    const verified = verifyGoalTransferReceipt(intent,evidence);
    for (const [key,value] of Object.entries(verified)) {
      const expected = key === 'status' && value === 'offline-verified' ? 'confirmed' : key === 'verificationSource' ? 'fixed-server-provider-read' : value;
      if (!same(observation[key],expected)) fail();
    }
    const submission = evidence.submission === null ? null : validateGoalTransferSubmission(intent,evidence.submission);
    if (observation.intentDigest !== intent.intentDigest || (submission && observation.userOperationHash !== submission.userOperationHash)) fail();
    const tx = evidence.transaction === null ? null : Object.fromEntries(TX.map(k => [k,lower(evidence.transaction[k])]));
    const receipt = evidence.receipt === null ? null : {...Object.fromEntries(RECEIPT.filter(k => k !== 'events').map(k => [k,lower(evidence.receipt[k])])),events:Array.isArray(evidence.receipt.logs) ? evidence.receipt.logs.map(log => safeEvent(log,intent)).filter(Boolean) : []};
    const block = evidence.canonicalBlock === null ? null : {...Object.fromEntries(BLOCK.filter(k => k !== 'transactions').map(k => [k,lower(evidence.canonicalBlock[k])])),transactions:Array.isArray(evidence.canonicalBlock.transactions) ? evidence.canonicalBlock.transactions.map(lower) : []};
    let bundle = null, signatureCount = 0;
    const input = evidence.transaction?.input;
    const isHexInput = typeof input === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(input);
    if (isHexInput) {
      try {
        const decoded = decodeFunctionData({abi:entryPoint07Abi,data:input});
        if (decoded.functionName === 'handleOps' && decoded.args[0].length <= 32) {
          const ops = decoded.args[0], events = receipt?.events.filter(e => e.type === 'UserOperationEvent') ?? [];
          signatureCount = ops.length;
          const expected = submission && toPackedUserOperation(typed(submission.userOperation));
          const selected = expected ? ops.map((op,index) => Object.keys(expected).every(k => k === 'signature' || normalized(expected[k]) === normalized(op[k])) ? index : -1).filter(index => index >= 0) : [];
          const selectedOperationIndex = selected.length === 1 ? selected[0] : null;
          const selectedEvent = events.find(e => e.args.userOpHash === submission?.userOperationHash);
          const prior = selectedEvent ? receipt.events.filter(e => ['EntryPointBeforeExecution','UserOperationEvent'].includes(e.type) && q(e.logIndex) < q(selectedEvent.logIndex)).at(-1) : null;
          bundle = {function:'handleOps',selectedOperationIndex,operations:ops.map((op,index) => ({sender:lower(op.sender),nonce:op.nonce.toString(),userOperationHash:index === selectedOperationIndex ? submission.userOperationHash : events[index]?.args.userOpHash ?? null})),previousBoundaryLogIndex:prior?.logIndex ?? null,userOperationEventLogIndex:selectedEvent?.logIndex ?? null};
        }
      } catch { /* Unsupported envelopes retain no opaque payload. */ }
    }
    const summary = summarize(observation);
    const body = {format:FORMAT,intentDigest:intent.intentDigest,observedAt:evidence.observedAt,recordedStatus:recorded(summary,tx,receipt),submission,transaction:tx,receipt,canonicalBlock:block,latestBlockNumber:lower(evidence.latestBlockNumber),bundle,summary,redaction:{scheme:'unsigned-selected-operation-projection@1',rawInputRetained:false,rawTransactionRetained:false,originalInputSha256:isHexInput ? createHash('sha256').update(Buffer.from(input.slice(2),'hex')).digest('hex') : null,inputByteLength:isHexInput ? (input.length-2)/2 : null,packedSignatureCountRemoved:signatureCount,unselectedPayloadsRetained:false}};
    const retained = {...body,retainedDigest:digest(body)};
    verifyRetainedGoalTransferObservation(intent,retained);
    return freeze(retained);
  } catch { fail(); }
}

/** Internal consistency of a recorded snapshot only. Discarded transaction input is never reconstructed or authenticated. */
export function verifyRetainedGoalTransferObservation(intent, retained) {
  try { return verifyHistorical(intent,retained); } catch { fail(); }
}
function verifyHistorical(intent,r) {
  validateGoalTransferIntent(intent); bounded(r,65536); exact(r,TOP);
  if (r.format !== FORMAT || r.intentDigest !== intent.intentDigest || !/^[a-f0-9]{64}$/.test(r.retainedDigest)) fail();
  const {retainedDigest,...body} = r; if (digest(body) !== retainedDigest) fail();
  const observed = iso(r.observedAt);
  const submission = r.submission === null ? null : validateGoalTransferSubmission(intent,r.submission);
  if (submission && !same(submission,r.submission)) fail();
  exact(r.redaction,REDACTION);
  const red = r.redaction;
  if (red.scheme !== 'unsigned-selected-operation-projection@1' || red.rawInputRetained !== false || red.rawTransactionRetained !== false || red.unselectedPayloadsRetained !== false || !Number.isSafeInteger(red.packedSignatureCountRemoved) || red.packedSignatureCountRemoved < 0 || red.packedSignatureCountRemoved > 32) fail();
  if ((red.originalInputSha256 === null) !== (red.inputByteLength === null)) fail();
  if (red.originalInputSha256 !== null && (!/^[a-f0-9]{64}$/.test(red.originalInputSha256) || !Number.isSafeInteger(red.inputByteLength) || red.inputByteLength < 0 || red.inputByteLength > 65536)) fail();
  const tx = r.transaction, receipt = r.receipt, block = r.canonicalBlock, s = r.summary;
  exact(s,SUMMARY);
  if (!['confirmed','failed','uncertain'].includes(s.status) || !REASONS.has(s.reason) || !['not-established','failed','included-success','confirmation-threshold-met'].includes(s.transferStatus) || !Number.isSafeInteger(s.confirmations) || s.confirmations < 0 || ![null,true,false].includes(s.executionAfterIntentExpiry)) fail();
  if (recorded(s,tx,receipt) !== r.recordedStatus || s.userOperationHash !== (submission?.userOperationHash ?? null)) fail();
  ['transactionHash','blockHash'].forEach(k => nullable(s[k],v => hex(v,32))); nullable(s.blockNumber,n);
  nullable(r.latestBlockNumber,q);
  if (tx !== null) {
    exact(tx,TX); hex(tx.hash,32); hex(tx.to,20); q(tx.value);
    if (tx.to !== submission?.entryPoint || q(tx.value) !== 0n) fail();
    nullable(tx.blockHash,v => hex(v,32)); nullable(tx.blockNumber,q); nullable(tx.transactionIndex,q);
  }
  let events = [], operationEvents = [];
  if (receipt !== null) {
    exact(receipt,RECEIPT); hex(receipt.transactionHash,32); nullable(receipt.blockHash,v => hex(v,32));
    ['blockNumber','transactionIndex','gasUsed','effectiveGasPrice'].forEach(k => nullable(receipt[k],q));
    if (!['0x0','0x1'].includes(receipt.status) || !Array.isArray(receipt.events) || receipt.events.length > 256 || tx === null || receipt.transactionHash !== tx.hash) fail();
    let previous = -1n;
    events = receipt.events;
    for (const event of events) {
      exact(event,['type',...META,'args']);
      if (event.removed !== false || event.transactionHash !== receipt.transactionHash || event.blockHash !== receipt.blockHash || event.blockNumber !== receipt.blockNumber || event.transactionIndex !== receipt.transactionIndex || q(event.logIndex) <= previous) fail();
      previous = q(event.logIndex); hex(event.address,20); hex(event.transactionHash,32); hex(event.blockHash,32); q(event.blockNumber); q(event.transactionIndex);
      if (event.type === 'EntryPointBeforeExecution') { exact(event.args,[]); if (event.address !== submission?.entryPoint) fail(); }
      else if (event.type === 'UserOperationEvent') {
        exact(event.args,['userOpHash','sender','paymaster','nonce','success','actualGasCost','actualGasUsed']);
        if (event.address !== submission?.entryPoint || typeof event.args.success !== 'boolean') fail();
        hex(event.args.userOpHash,32); hex(event.args.sender,20); hex(event.args.paymaster,20); ['nonce','actualGasCost','actualGasUsed'].forEach(k => n(event.args[k])); operationEvents.push(event);
      } else if (event.type === 'Transfer') { exact(event.args,['from','to','value']); if (event.address !== intent.token.address) fail(); hex(event.args.from,20); hex(event.args.to,20); n(event.args.value); }
      else fail();
    }
  }
  if (block !== null) {
    exact(block,BLOCK); ['number','timestamp','baseFeePerGas'].forEach(k => nullable(block[k],q)); ['hash','parentHash'].forEach(k => nullable(block[k],v => hex(v,32)));
    if (!Array.isArray(block.transactions) || block.transactions.length > 2048) fail(); block.transactions.forEach(v => hex(v,32));
  }
  const canonical = tx && receipt && tx.blockHash !== null && receipt.blockHash !== null && block && r.latestBlockNumber !== null;
  let canonicalMatched = false;
  if (canonical) {
    if (tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex || block.number !== receipt.blockNumber) fail();
    canonicalMatched = block.hash === receipt.blockHash && q(receipt.transactionIndex) < BigInt(block.transactions.length) && block.transactions[Number(q(receipt.transactionIndex))] === tx.hash && q(r.latestBlockNumber) >= q(block.number);
    if (s.transactionHash !== tx.hash || s.blockHash !== receipt.blockHash || s.blockNumber !== q(receipt.blockNumber).toString()) fail();
    const confirmations = canonicalMatched ? q(r.latestBlockNumber)-q(block.number)+1n : 0n;
    if (confirmations > BigInt(Number.MAX_SAFE_INTEGER) || s.confirmations !== Number(confirmations)) fail();
  } else if (s.confirmations !== 0 || s.blockHash !== null || s.blockNumber !== null || s.transactionHash !== (tx && receipt ? tx.hash : null)) fail();
  const b = r.bundle;
  let selected = null, event = null;
  if (b !== null) {
    exact(b,['function','selectedOperationIndex','operations','previousBoundaryLogIndex','userOperationEventLogIndex']);
    if (b.function !== 'handleOps' || !Array.isArray(b.operations) || b.operations.length > 32 || red.packedSignatureCountRemoved !== b.operations.length) fail();
    for (const op of b.operations) { exact(op,['sender','nonce','userOperationHash']); hex(op.sender,20); n(op.nonce); nullable(op.userOperationHash,v => hex(v,32)); }
    nullable(b.previousBoundaryLogIndex,q); nullable(b.userOperationEventLogIndex,q);
    if (b.selectedOperationIndex !== null) {
      if (!Number.isSafeInteger(b.selectedOperationIndex) || b.selectedOperationIndex < 0 || b.selectedOperationIndex >= b.operations.length || !submission) fail();
      selected = b.operations[b.selectedOperationIndex];
      if (selected.sender !== submission.userOperation.sender || selected.nonce !== submission.userOperation.nonce || selected.userOperationHash !== submission.userOperationHash || b.operations.filter(op => op.sender === selected.sender && op.nonce === selected.nonce).length !== 1) fail();
    }
    const matches = operationEvents.filter(e => e.args.userOpHash === submission?.userOperationHash);
    if (matches.length === 1) event = matches[0];
    if (b.userOperationEventLogIndex !== (event?.logIndex ?? null)) fail();
    const previous = event ? events.filter(e => ['EntryPointBeforeExecution','UserOperationEvent'].includes(e.type) && q(e.logIndex) < q(event.logIndex)).at(-1) : null;
    if (b.previousBoundaryLogIndex !== (previous?.logIndex ?? null)) fail();
  } else if (red.packedSignatureCountRemoved !== 0) fail();
  const ordered = b && selected && operationEvents.length === b.operations.length && operationEvents.every((e,i) => e.args.sender === b.operations[i].sender && e.args.nonce === b.operations[i].nonce && e.args.userOpHash === b.operations[i].userOperationHash) && operationEvents[b.selectedOperationIndex] === event;
  const eventMatched = event && submission && event.args.sender === submission.userOperation.sender && event.args.nonce === submission.userOperation.nonce && event.args.paymaster === submission.userOperation.paymaster;
  if (s.fee !== null) {
    exact(s.fee,FEE); if (!eventMatched || !ordered || !canonicalMatched || block.baseFeePerGas === null) fail();
    const op = submission.userOperation, declaredGas = GAS.reduce((sum,k) => sum+n(op[k]),0n), ceiling = declaredGas*n(op.maxFeePerGas), market = q(block.baseFeePerGas)+n(op.maxPriorityFeePerGas), price = n(op.maxFeePerGas) < market ? n(op.maxFeePerGas) : market;
    const expected = {paymaster:op.paymaster,actualGasCostWei:event.args.actualGasCost,actualGasUsed:event.args.actualGasUsed,declaredGasUnits:declaredGas.toString(),declaredPrefundCeilingWei:ceiling.toString(),userOperationGasPriceWei:price.toString()};
    if (!same(s.fee,expected)) fail();
  }
  const primary = s.status === 'confirmed' || s.reason === 'user-operation-failed' || s.transferStatus === 'included-success';
  if (primary) {
    if (!canonicalMatched || receipt.status !== '0x1' || !ordered || !eventMatched || s.fee === null) fail();
    if (s.reason === 'user-operation-failed') { if (event.args.success !== false || s.status !== 'failed' || s.transferStatus !== 'failed') fail(); }
    else {
      if (!event.args.success || n(event.args.actualGasUsed) === 0n || n(event.args.actualGasUsed) > n(s.fee.declaredGasUnits) || n(event.args.actualGasCost) > n(s.fee.declaredPrefundCeilingWei) || n(event.args.actualGasCost) !== n(event.args.actualGasUsed)*n(s.fee.userOperationGasPriceWei)) fail();
      const boundary = b.previousBoundaryLogIndex;
      if (boundary === null || !events.some(e => e.type === 'EntryPointBeforeExecution' && q(e.logIndex) <= q(boundary))) fail();
      const relevant = events.filter(e => e.type === 'Transfer' && q(e.logIndex) > q(boundary) && q(e.logIndex) < q(event.logIndex));
      const matches = relevant.filter(e => e.args.from === intent.account && e.args.to === intent.recipient && e.args.value === intent.amountAtomic);
      if (matches.length !== 1 || relevant.some(e => [e.args.from,e.args.to].some(a => [intent.account,intent.recipient].includes(a)) && e !== matches[0])) fail();
      if (block.timestamp === null || observed < iso(intent.createdAt) || BigInt(observed) < q(block.timestamp)*1000n || q(block.timestamp)*1000n+999n < BigInt(iso(intent.createdAt))) fail();
      const start = q(block.timestamp)*1000n, expiry = BigInt(iso(intent.expiresAt));
      if (s.executionAfterIntentExpiry !== (start >= expiry ? true : start+999n < expiry ? false : null)) fail();
      if (s.status === 'confirmed' && (s.reason !== 'exact-transfer-effects-correlated' || s.transferStatus !== 'confirmation-threshold-met' || s.confirmations < 1)) fail();
    }
  }
  if (s.reason === 'bundle-reverted' && (!canonicalMatched || receipt.status !== '0x0' || s.status !== 'failed' || s.transferStatus !== 'failed' || s.fee !== null)) fail();
  if (s.status === 'failed' && !['bundle-reverted','user-operation-failed'].includes(s.reason)) fail();
  if (s.reason === 'receipt-not-observed' && (!submission || tx !== null && receipt !== null || s.status !== 'uncertain' || s.fee !== null)) fail();
  if (s.reason === 'missing-submission' && submission !== null) fail();
  // This digest and audit lookup hash provide integrity, not provenance or current confirmation.
  return freeze({...structuredClone(r),verification:'historical-consistency-only',transactionInputAuthentication:'discarded-not-reconstructed',currentConfirmationEstablished:false,ownerApprovalEstablished:false,signingAllowed:false,submissionAllowed:false});
}
