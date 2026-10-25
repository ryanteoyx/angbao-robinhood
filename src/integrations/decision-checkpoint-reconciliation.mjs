/** Pure supplied-facts anchor validation. No transport, branded observation, deployment or wallet API. */
import {createHash} from 'node:crypto';
import {validateDecisionCheckpointAnchor, DECISION_CHECKPOINT_PURPOSE as PURPOSE, DECISION_CHECKPOINT_CONTRACT_SOURCE_SHA256 as SOURCE_SHA} from '../domain/decision-checkpoint.mjs';
import {COMMITTED_EVENT_TOPIC} from '../domain/chain-operation.mjs';
import {portfolioCanonical, portfolioDigest} from '../domain/portfolio-work-record.mjs';
import {kernelInitializationInternals as K} from '../domain/kernel-initialization.mjs';
import {ROBINHOOD_TESTNET_FEE_POLICY} from './robinhood-eoa-transfer-reconciliation.mjs';

if (typeof window !== 'undefined') throw Error('Checkpoint reconciliation is server-only.');
const TX_KEYS = ['from','to','chainId','type','nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas','data'];
const same = (a,b) => portfolioCanonical(a) === portfolioCanonical(b);
const shaBytes = value => createHash('sha256').update(Buffer.from(value.slice(2), 'hex')).digest('hex');
export class DecisionCheckpointReconciliationError extends Error {
  constructor(code) { super(`Checkpoint observation stopped: ${code}.`); this.name='DecisionCheckpointReconciliationError'; this.code=code; }
}
const fail = code => { throw new DecisionCheckpointReconciliationError(code); };
const guard = work => { try { return work(); } catch (error) { if (error instanceof DecisionCheckpointReconciliationError) throw error; fail('invalid_evidence'); } };
const hash = value => { K.hex(value,32); if (value === '0x'+'0'.repeat(64)) fail('invalid_hash'); return value; };
const q = value => K.quantity(value);
function unsigned(anchor, value) {
  K.exact(value, TX_KEYS);
  if (value.from!==anchor.owner || value.to!==anchor.contract || value.chainId!=='0xb626' || value.type!=='0x2' || value.value!=='0x0' || value.data!==anchor.call.data) fail('transaction_scope');
  for (const key of ['nonce','gas','maxFeePerGas','maxPriorityFeePerGas']) q(value[key]);
  if (q(value.nonce)>(1n<<64n)-2n || q(value.gas)<21000n || q(value.gas)>500000n || q(value.maxFeePerGas)===0n || q(value.maxFeePerGas)>1000000000n || q(value.maxPriorityFeePerGas)>q(value.maxFeePerGas)) fail('transaction_caps');
  return structuredClone(value);
}
/** A hash report binds public fields only; it does not establish actual submission or wallet approval. */
export function validateDecisionCheckpointSubmission(anchorValue, value) { return guard(() => {
  const anchor=validateDecisionCheckpointAnchor(anchorValue);
  K.bounded(value,8192); K.exact(value,['format','purpose','anchorDigest','transactionHash','transaction']);
  if (value.format!=='angbao-decision-checkpoint-submission@1' || value.purpose!==PURPOSE || value.anchorDigest!==anchor.anchorDigest) fail('submission_scope');
  hash(value.transactionHash);
  return K.freeze({...value,transaction:unsigned(anchor,value.transaction)});
}); }
/** Exact bytes and events can be checked offline; JSON never establishes provider/source provenance or current finality. */
export function verifyDecisionCheckpointObservation(anchorValue, submissionValue, evidence, options) { return guard(() => {
  const anchor=validateDecisionCheckpointAnchor(anchorValue), submission=validateDecisionCheckpointSubmission(anchor,submissionValue), expected=submission.transaction;
  K.bounded(options,4096); K.exact(options,['runtimeReference','minimumConfirmations','previousBlockHash']);
  const ref=options.runtimeReference;
  K.exact(ref,['chainId','contract','sourceSha256','runtimeSha256']); K.sha(ref.runtimeSha256);
  if (ref.chainId!==46630 || ref.contract!==anchor.contract || ref.sourceSha256!==SOURCE_SHA || ref.runtimeSha256===shaBytes('0x')) fail('runtime_reference_scope');
  if (!Number.isSafeInteger(options.minimumConfirmations) || options.minimumConfirmations<1 || options.minimumConfirmations>1024) fail('confirmation_limit');
  if (options.previousBlockHash!==null) hash(options.previousBlockHash);
  K.bounded(evidence,262144); K.exact(evidence,['format','chainId','observedAt','transaction','receipt','canonicalBlock','latestBlockNumber','contractCodeAtReceipt']);
  if (evidence.format!=='angbao-decision-checkpoint-chain-evidence@1' || evidence.chainId!==46630) fail('evidence_scope');
  K.iso(evidence.observedAt);
  const result={format:'angbao-decision-checkpoint-observation@1',purpose:PURPOSE,anchorDigest:anchor.anchorDigest,
    submissionDigest:portfolioDigest(submission),transactionHash:submission.transactionHash,observedAt:evidence.observedAt,
    verificationSource:'supplied-evidence-only',status:'uncertain',reason:'receipt-not-observed',blockHash:null,blockNumber:null,confirmations:0,fee:null,
    feePolicy:ROBINHOOD_TESTNET_FEE_POLICY,exactEnvelopeMatched:false,exactEventMatched:false,runtimeMatchesSuppliedReference:false,
    privateOpeningVerified:false,sourceCompilationEstablished:false,providerProvenanceEstablished:false,currentConfirmationEstablished:false,
    ownerApprovalEstablished:false,onchainAttestationEstablished:false,inputTruthEstablished:false,finality:'not-established',
    signingAllowed:false,deploymentAllowed:false,submissionAllowed:false,financialAuthority:false};
  const finish=reason=>K.freeze({...result,reason});
  if (evidence.transaction===null) return finish('transaction-not-observed');
  const tx=evidence.transaction;
  hash(tx.hash); K.address(tx.from); K.address(tx.to); K.hex(tx.input);
  const actual=Object.fromEntries(TX_KEYS.map(key=>[key,key==='data'?tx.input:tx[key]]));
  if (tx.hash!==submission.transactionHash || !same(actual,expected) || Object.hasOwn(tx,'accessList')&&(!Array.isArray(tx.accessList)||tx.accessList.length!==0) || Object.hasOwn(tx,'authorizationList')) return finish('transaction-envelope-mismatch');
  result.exactEnvelopeMatched=true;
  if (evidence.receipt===null) return finish('receipt-not-observed');
  const receipt=evidence.receipt;
  if (receipt.from!==anchor.owner || receipt.to!==anchor.contract || receipt.contractAddress!==null) return finish('receipt-scope-mismatch');
  for (const item of [tx,receipt]) {
    hash(item.blockHash); q(item.blockNumber); q(item.transactionIndex);
  }
  hash(receipt.transactionHash); q(receipt.gasUsed); q(receipt.effectiveGasPrice);
  if (!['0x0','0x1'].includes(receipt.status)) fail('invalid_receipt_status');
  if (receipt.transactionHash!==submission.transactionHash || tx.blockHash!==receipt.blockHash || tx.blockNumber!==receipt.blockNumber || tx.transactionIndex!==receipt.transactionIndex) return finish('receipt-transaction-mismatch');
  if (evidence.canonicalBlock===null || evidence.latestBlockNumber===null) return finish('canonicality-not-established');
  const block=evidence.canonicalBlock;
  K.exact(block,['number','hash','parentHash','timestamp','baseFeePerGas','transactions']);
  hash(block.hash); hash(block.parentHash); for (const key of ['number','timestamp','baseFeePerGas']) q(block[key]);
  if (!Array.isArray(block.transactions)||block.transactions.length>1024) fail('block_bounds'); block.transactions.forEach(hash);
  const head=q(evidence.latestBlockNumber),number=q(block.number),index=q(receipt.transactionIndex);
  if (block.hash!==receipt.blockHash || block.number!==receipt.blockNumber || index>=BigInt(block.transactions.length) || block.transactions[Number(index)]!==submission.transactionHash || head<number || options.previousBlockHash!==null&&options.previousBlockHash!==block.hash) return finish('reorg-uncertain');
  const confirmations=head-number+1n; if (confirmations>BigInt(Number.MAX_SAFE_INTEGER)) fail('head_bounds');
  result.blockHash=block.hash; result.blockNumber=number.toString(); result.confirmations=Number(confirmations);
  if (BigInt(Date.parse(evidence.observedAt))<q(block.timestamp)*1000n) return finish('observation-time-mismatch');
  const base=q(block.baseFeePerGas),cap=q(expected.maxFeePerGas),market=base+q(expected.maxPriorityFeePerGas),tip=market<cap?market:cap,price=q(receipt.effectiveGasPrice),used=q(receipt.gasUsed),gas=q(expected.gas);
  if (base>cap || used<21000n || used>gas || price!==base&&price!==tip) return finish('gas-cost-mismatch-or-cap-exceeded');
  result.fee={payer:anchor.owner,gasUsed:used.toString(),effectiveGasPriceWei:price.toString(),gasCostWei:(used*price).toString(),maximumGasCostWei:(gas*cap).toString(),nativeValueWei:'0',gasCoverage:'owner-funded-testnet',providerBilling:'unverified'};
  if (receipt.status==='0x0') { result.status='reverted-in-supplied-evidence'; return finish('transaction-reverted'); }
  const code=evidence.contractCodeAtReceipt;
  if (code===null) return finish('runtime-not-observed');
  K.exact(code,['chainId','address','blockHash','code']); K.hex(code.code);
  if (code.code.length>131074) fail('code_bounds');
  if (code.chainId!==46630 || code.address!==anchor.contract || code.blockHash!==block.hash || code.code==='0x' || shaBytes(code.code)!==ref.runtimeSha256) return finish('runtime-reference-mismatch');
  result.runtimeMatchesSuppliedReference=true;
  if (!Array.isArray(receipt.logs)||receipt.logs.length>128) fail('log_bounds');
  let previous=-1n, targetEvents=0, matches=0;
  for (const log of receipt.logs) {
    K.address(log.address); hash(log.transactionHash); hash(log.blockHash); q(log.blockNumber); q(log.transactionIndex); q(log.logIndex); K.hex(log.data);
    if (log.removed!==false || log.transactionHash!==submission.transactionHash || log.blockHash!==block.hash || log.blockNumber!==block.number || log.transactionIndex!==receipt.transactionIndex || q(log.logIndex)<=previous) return finish('log-metadata-mismatch');
    previous=q(log.logIndex);
    if (!Array.isArray(log.topics)||log.topics.length>4) fail('log_bounds'); log.topics.forEach(value=>K.hex(value,32));
    if (log.address===anchor.contract && log.topics[0]===COMMITTED_EVENT_TOPIC) {
      targetEvents++;
      if (log.topics.length===3 && log.topics[1]==='0x'+'0'.repeat(24)+anchor.owner.slice(2) && log.topics[2]===anchor.operationRef && log.data===anchor.commitment) matches++;
    }
  }
  if (targetEvents!==1 || matches!==1) return finish('commitment-event-missing-or-ambiguous');
  result.exactEventMatched=true;
  if (result.confirmations<options.minimumConfirmations) return finish('confirmation-threshold-not-met');
  result.status='offline-correlated';
  return finish('exact-checkpoint-correlated-in-supplied-evidence');
}); }
