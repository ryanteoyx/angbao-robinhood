/** Offline selected-record commitments. No salt persistence, transport, signer or authority. */
import {reviewPolicyCommitment, COMMITMENT_FUNCTION, COMMITMENT_SELECTOR} from './chain-operation.mjs';
import {validatePortfolioWorkRecord, portfolioDigest, portfolioCanonical} from './portfolio-work-record.mjs';
import {kernelInitializationInternals as K} from './kernel-initialization.mjs';

export const DECISION_CHECKPOINT_PURPOSE = 'owner-attested-decision-checkpoint';
export const DECISION_CHECKPOINT_SCHEME = 'decision-checkpoint-scope@1/review-policy-commitment@1';
export const DECISION_CHECKPOINT_CONTRACT_SOURCE_SHA256 = '20af25cd73f46f497bbc398dd75664b1e0ff050ef6a7f4a0c9c68532c2b013b0';
const PURPOSE = DECISION_CHECKPOINT_PURPOSE;
const FORMATS = ['angbao-local-portfolio-work@1', 'angbao-local-portfolio-work@2'];
const ANCHOR_KEYS = ['format', 'purpose', 'chainId', 'owner', 'contract', 'operationRef', 'commitment', 'call', 'anchorDigest'];
const PLAN_KEYS = ['format', 'purpose', 'scheme', 'selection', 'createdAt', 'scopeDigest', 'anchor', 'saltHandling', 'selectionAuthentication', 'authority', 'checkpointDigest'];
const authority = () => ({ownerApprovalEstablished:false, signingAllowed:false, deploymentAllowed:false, submissionAllowed:false, financialAuthority:false});
const equal = (a, b) => portfolioCanonical(a) === portfolioCanonical(b);
const stamp = (domain, value) => portfolioDigest({domain, value});
export class DecisionCheckpointError extends Error {
  constructor(code) { super(`Decision checkpoint stopped: ${code}.`); this.name = 'DecisionCheckpointError'; this.code = code; }
}
const fail = code => { throw new DecisionCheckpointError(code); };
const guard = work => { try { return work(); } catch (error) { if (error instanceof DecisionCheckpointError) throw error; fail('invalid_checkpoint'); } };
const hash = value => { K.hex(value, 32); if (value === '0x' + '0'.repeat(64)) fail('empty_hash'); return value; };
function selection(value) {
  K.exact(value, ['kind', 'recordId', 'format', 'digest', 'decisionDigest', 'policy']);
  if (value.kind !== 'portfolio' || !FORMATS.includes(value.format)) fail('unsupported_record');
  K.uuid(value.recordId); K.sha(value.digest); K.sha(value.decisionDigest);
  K.exact(value.policy, ['id', 'version', 'digest']);
  if (typeof value.policy.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,99}$/.test(value.policy.id) || !Number.isSafeInteger(value.policy.version) || value.policy.version < 1) fail('invalid_policy_reference');
  K.sha(value.policy.digest);
  return structuredClone(value);
}
function scopeDigest(selected, anchor) {
  return stamp('angbao.decision-checkpoint-scope.v1', {selection:selected, chainId:anchor.chainId, owner:anchor.owner, contract:anchor.contract, operationRef:anchor.operationRef});
}
function anchorBody({chainId, owner, contract, operationRef, commitment}) {
  if (chainId !== 46630) fail('wrong_chain');
  K.address(owner); K.address(contract); if (owner === contract) fail('invalid_target');
  hash(operationRef); hash(commitment);
  return {format:'angbao-decision-checkpoint-anchor@1', purpose:PURPOSE, chainId, owner, contract, operationRef, commitment,
    call:{to:contract, function:COMMITMENT_FUNCTION, selector:COMMITMENT_SELECTOR, data:COMMITMENT_SELECTOR + operationRef.slice(2) + commitment.slice(2), valueWei:'0'}};
}
export function validateDecisionCheckpointAnchor(value) { return guard(() => {
  K.bounded(value, 8192); K.exact(value, ANCHOR_KEYS);
  const body = anchorBody(value), expected = {...body, anchorDigest:stamp('angbao.decision-checkpoint-anchor.v1', body)};
  if (!equal(value, expected)) fail('anchor_changed');
  return K.freeze(expected);
}); }
/** Local integrity only: an unkeyed digest or imported JSON is never owner authorization. */
export function validateDecisionCheckpoint(value) { return guard(() => {
  K.bounded(value, 16384); K.exact(value, PLAN_KEYS);
  if (value.format !== 'angbao-local-decision-checkpoint@1' || value.purpose !== PURPOSE || value.scheme !== DECISION_CHECKPOINT_SCHEME || value.saltHandling !== 'caller-retained-not-returned-or-stored' || value.selectionAuthentication !== 'caller-selected-native-record-unverified-owner') fail('checkpoint_scope');
  const selected = selection(value.selection), anchor = validateDecisionCheckpointAnchor(value.anchor); K.iso(value.createdAt);
  if (value.scopeDigest !== scopeDigest(selected, anchor) || !equal(value.authority, authority())) fail('checkpoint_changed');
  const {checkpointDigest, ...body} = value;
  if (checkpointDigest !== stamp('angbao.local-decision-checkpoint.v1', body)) fail('checkpoint_changed');
  return K.freeze(structuredClone(value));
}); }
/** Caller supplies a cryptographically random secret salt and opaque public reference; entropy is not inferred from syntax. */
export function prepareDecisionCheckpoint(input, options) { return guard(() => {
  K.bounded(input, 65536); K.exact(input, ['record', 'expectedRecord', 'chainId', 'owner', 'contract', 'operationRef', 'createdAt']);
  K.bounded(options, 1024); K.exact(options, ['privateSalt']); hash(options.privateSalt);
  K.exact(input.expectedRecord, ['kind', 'recordId', 'format', 'digest']);
  const record = validatePortfolioWorkRecord(input.record), ref = input.expectedRecord;
  if (ref.kind !== 'portfolio' || ref.recordId !== record.id || ref.format !== record.format || ref.digest !== record.digest) fail('selection_mismatch');
  K.iso(input.createdAt); if (input.createdAt < record.createdAt) fail('pre_record_checkpoint');
  const selected = selection({...ref, decisionDigest:record.decision.decisionDigest, policy:record.decision.references.policy});
  const scope = {chainId:input.chainId, owner:input.owner, contract:input.contract, operationRef:input.operationRef};
  // Validate public scope before invoking the unchanged legacy crypto helper.
  anchorBody({...scope, commitment:'0x' + '1'.repeat(64)});
  const scopedDigest = scopeDigest(selected, scope);
  let commitment;
  try {
    // Revision 1 is this immutable selection wrapper's revision, NOT a mutable native record revision.
    commitment = reviewPolicyCommitment({review:{id:record.id, revision:1, digest:'0x' + scopedDigest}, policy:{id:selected.policy.id, version:String(selected.policy.version), digest:'0x' + selected.policy.digest}}, options.privateSalt);
  } catch { fail('legacy_helper_incompatible'); }
  const a = anchorBody({...scope, commitment});
  const anchor = {...a, anchorDigest:stamp('angbao.decision-checkpoint-anchor.v1', a)};
  const body = {format:'angbao-local-decision-checkpoint@1', purpose:PURPOSE, scheme:DECISION_CHECKPOINT_SCHEME,
    selection:selected, createdAt:input.createdAt, scopeDigest:scopedDigest, anchor,
    saltHandling:'caller-retained-not-returned-or-stored', selectionAuthentication:'caller-selected-native-record-unverified-owner', authority:authority()};
  return validateDecisionCheckpoint({...body, checkpointDigest:stamp('angbao.local-decision-checkpoint.v1', body)});
}); }
/** Requires the original exact record, separately selected reference and original salt; missing proof material cannot be reconstructed. */
export function verifyDecisionCheckpointOpening(checkpoint, input) { return guard(() => {
  const saved = validateDecisionCheckpoint(checkpoint);
  K.bounded(input, 65536); K.exact(input, ['record', 'expectedRecord', 'privateSalt']);
  const rebuilt = prepareDecisionCheckpoint({record:input.record, expectedRecord:input.expectedRecord, chainId:saved.anchor.chainId, owner:saved.anchor.owner, contract:saved.anchor.contract, operationRef:saved.anchor.operationRef, createdAt:saved.createdAt}, {privateSalt:input.privateSalt});
  if (!equal(rebuilt, saved)) fail('opening_mismatch');
  return K.freeze({format:'angbao-decision-checkpoint-opening-result@1', status:'matches-selected-record', checkpointDigest:saved.checkpointDigest, anchorDigest:saved.anchor.anchorDigest,
    nativeRecordConsistencyEstablished:true, suppliedOpeningMatches:true, onchainAttestationEstablished:false, inputTruthEstablished:false, ...authority()});
}); }
/** Only these fields are suitable for a public receipt. Local selection references and salt never cross this projection. */
export function publicDecisionCheckpointAnchor(checkpoint) {
  return validateDecisionCheckpoint(checkpoint).anchor;
}
