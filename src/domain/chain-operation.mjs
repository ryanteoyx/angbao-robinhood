import { createHash } from 'node:crypto';

// These constants are ABI identifiers, not configurable authority or a deployed address.
export const CHAIN_OPERATION_VERSION = 1;
export const RH_CONTROL_CHAIN_ID = 46630;
export const COMMITMENT_FUNCTION = 'commit(bytes32,bytes32)';
export const COMMITMENT_SELECTOR = '0xe3ce094d';
export const COMMITTED_EVENT_TOPIC = '0xd4cebf902bc5a93f89fc70c15dca1327ca93c452fecfcdf8756a39ffbb61c04e';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const zeroHash = `0x${'0'.repeat(64)}`;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const states = new Set(['prepared', 'permission-validated', 'submission-uncertain', 'submitted', 'included-success', 'included-reverted', 'confirmation-threshold-met', 'reorg-uncertain', 'replacement-uncertain', 'rejected', 'revoked']);
export class ChainOperationError extends Error {
  constructor(code = 'invalid_operation') {
    super({ invalid_operation: 'The chain operation is invalid.', binding_mismatch: 'The immutable operation binding does not match.', stale_revision: 'Reload the current operation revision.', invalid_transition: 'This operation transition is not allowed.', invalid_evidence: 'The operation evidence is invalid.' }[code] ?? 'The chain operation is invalid.');
    this.name = 'ChainOperationError'; this.code = code;
  }
}
function fail(code) { throw new ChainOperationError(code); }
function exact(value, fields) { if (!plain(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !own(value, key))) fail(); }
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,99}$/.test(value)) fail(); return value; }
function positive(value) { if (!Number.isSafeInteger(value) || value < 1) fail(); return value; }
function hash(value) { if (typeof value !== 'string' || !hashPattern.test(value) || value.toLowerCase() === zeroHash) fail(); return value.toLowerCase(); }
function address(value) { if (typeof value !== 'string' || !addressPattern.test(value) || /^0x0{40}$/i.test(value)) fail(); return value.toLowerCase(); }
function timestamp(now) { if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail(); return now.toISOString(); }
function digest(value) { return `0x${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function references(review, policy) {
  exact(review, ['id', 'revision', 'digest']); exact(policy, ['id', 'version', 'digest']);
  return { review: { id: id(review.id), revision: positive(review.revision), digest: hash(review.digest) }, policy: { id: id(policy.id), version: id(policy.version), digest: hash(policy.digest) } };
}
/** Salt stays with the caller; it is never returned in a record or calldata. SHA-256 is an opaque consistency commitment, not a proof. */
export function reviewPolicyCommitment({ review, policy }, privateSalt) {
  const refs = references(review, policy);
  return digest({ domain: 'angbao.review-policy-commitment.v1', ...refs, privateSalt: hash(privateSalt) });
}
function normalizedBinding(input) {
  exact(input, ['operationId', 'review', 'policy', 'chainId', 'account', 'target', 'operationRef', 'commitment', 'function', 'calldata', 'valueWei']);
  const refs = references(input.review, input.policy);
  if (input.chainId !== RH_CONTROL_CHAIN_ID || input.valueWei !== '0' || input.function !== COMMITMENT_FUNCTION) fail();
  const operationRef = hash(input.operationRef), commitment = hash(input.commitment);
  const calldata = `${COMMITMENT_SELECTOR}${operationRef.slice(2)}${commitment.slice(2)}`;
  if (input.calldata !== calldata) fail('binding_mismatch');
  return { operationId: id(input.operationId), ...refs, chainId: RH_CONTROL_CHAIN_ID, account: address(input.account), target: address(input.target), operationRef, commitment, function: COMMITMENT_FUNCTION, calldata, valueWei: '0' };
}
/** Preparing intent neither approves a wallet permission nor submits an action. */
export function createChainOperation(input, { privateSalt, now = new Date() } = {}) {
  exact(input, ['operationId', 'review', 'policy', 'chainId', 'account', 'target', 'operationRef', 'valueWei']);
  const commitment = reviewPolicyCommitment(input, privateSalt);
  const operationRef = hash(input.operationRef);
  const binding = normalizedBinding({ ...input, operationRef, commitment, function: COMMITMENT_FUNCTION, calldata: `${COMMITMENT_SELECTOR}${operationRef.slice(2)}${commitment.slice(2)}` });
  const at = timestamp(now);
  return freeze({ schemaVersion: CHAIN_OPERATION_VERSION, revision: 0, state: 'prepared', binding, bindingDigest: digest({ domain: 'angbao.chain-operation.v1', binding }), createdAt: at, updatedAt: at, transactionHash: null, observations: [] });
}
function validateRecordShape(record) {
  exact(record, ['schemaVersion', 'revision', 'state', 'binding', 'bindingDigest', 'createdAt', 'updatedAt', 'transactionHash', 'observations']);
  if (record.schemaVersion !== CHAIN_OPERATION_VERSION || !Number.isSafeInteger(record.revision) || record.revision < 0 || !states.has(record.state) || !Array.isArray(record.observations) || record.observations.length > 64) fail();
  const binding = normalizedBinding(record.binding);
  if (record.bindingDigest !== digest({ domain: 'angbao.chain-operation.v1', binding })) fail('binding_mismatch');
  for (const at of [record.createdAt, record.updatedAt]) if (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || new Date(at).toISOString() !== at) fail();
  if (record.transactionHash !== null) hash(record.transactionHash);
  return record;
}
/** Validate the transition history as well as the binding; sourceRole labels are still assertions, not authentication. */
export function validateChainOperation(record) {
  validateRecordShape(record);
  if (record.revision !== record.observations.length) fail('invalid_evidence');
  let replay = { ...record, binding: normalizedBinding(record.binding), revision: 0, state: 'prepared', updatedAt: record.createdAt, transactionHash: null, observations: [] };
  for (const observation of record.observations) {
    exact(observation, ['type', 'at', 'evidence']);
    if (typeof observation.at !== 'string' || Number.isNaN(Date.parse(observation.at)) || new Date(observation.at).toISOString() !== observation.at) fail('invalid_evidence');
    replay = applyTransition(replay, { expectedRevision: replay.revision, bindingDigest: replay.bindingDigest, type: observation.type, evidence: observation.evidence }, new Date(observation.at));
  }
  if (replay.state !== record.state || replay.transactionHash !== record.transactionHash || replay.updatedAt !== record.updatedAt) fail('invalid_evidence');
  return record;
}
function applyTransition(record, command, now) {
  exact(command, ['expectedRevision', 'bindingDigest', 'type', 'evidence']);
  if (command.expectedRevision !== record.revision) fail('stale_revision');
  if (command.bindingDigest !== record.bindingDigest) fail('binding_mismatch');
  if (!plain(command.evidence)) fail('invalid_evidence');
  const evidence = command.evidence;
  let state, transactionHash = record.transactionHash, retained;
  if (command.type === 'fixture-permission-accepted') {
    exact(evidence, ['sourceRole', 'allowed', 'permissionId', 'permissionRevision', 'nonce', 'bindingDigest', 'code']);
    if (record.state !== 'prepared' || evidence.sourceRole !== 'fixture-only' || evidence.allowed !== true || evidence.code !== 'permitted' || evidence.bindingDigest !== record.bindingDigest || !Number.isSafeInteger(evidence.permissionRevision) || evidence.permissionRevision < 0 || typeof evidence.nonce !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(evidence.nonce)) fail('invalid_evidence');
    id(evidence.permissionId); state = 'permission-validated'; retained = { ...evidence };
  } else if (command.type === 'submission-started') {
    exact(evidence, ['submissionRef']); hash(evidence.submissionRef);
    if (record.state !== 'permission-validated') fail('invalid_transition');
    state = 'submission-uncertain'; retained = { submissionRef: evidence.submissionRef };
  } else if (command.type === 'transaction-observed') {
    exact(evidence, ['transactionHash']);
    if (!['permission-validated', 'submission-uncertain'].includes(record.state)) fail('invalid_transition');
    transactionHash = hash(evidence.transactionHash); state = 'submitted'; retained = { transactionHash };
  } else if (command.type === 'replacement-reported') {
    exact(evidence, ['sourceRole', 'originalTransactionHash', 'candidateTransactionHash']);
    if (!['submitted', 'reorg-uncertain', 'replacement-uncertain'].includes(record.state) || evidence.sourceRole !== 'unverified-replacement-report' || evidence.originalTransactionHash !== transactionHash || hash(evidence.candidateTransactionHash) === transactionHash) fail('invalid_evidence');
    state = 'replacement-uncertain'; retained = { ...evidence };
  } else if (command.type === 'reconciled') {
    exact(evidence, ['sourceRole', 'bindingDigest', 'transactionHash', 'status', 'observedAt', 'blockHash', 'blockNumber', 'confirmations', 'finality', 'correlation']);
    if (!['submitted', 'included-success', 'included-reverted', 'confirmation-threshold-met', 'reorg-uncertain', 'replacement-uncertain'].includes(record.state) || evidence.sourceRole !== 'independent-chain-read' || evidence.bindingDigest !== record.bindingDigest || evidence.transactionHash !== transactionHash || !['not-established'].includes(evidence.finality) || !['pending', 'not-observed', 'included-success', 'included-reverted', 'confirmation-threshold-met', 'reorg-uncertain'].includes(evidence.status)) fail('invalid_evidence');
    if (!Number.isSafeInteger(evidence.confirmations) || evidence.confirmations < 0 || !['not-observed', 'exact-direct-call', 'exact-commitment-event', 'not-established'].includes(evidence.correlation)) fail('invalid_evidence');
    if (evidence.blockHash !== null) hash(evidence.blockHash);
    if (evidence.blockNumber !== null && !/^(0|[1-9][0-9]{0,77})$/.test(evidence.blockNumber)) fail('invalid_evidence');
    if (typeof evidence.observedAt !== 'string' || Number.isNaN(Date.parse(evidence.observedAt)) || new Date(evidence.observedAt).toISOString() !== evidence.observedAt) fail('invalid_evidence');
    const included = ['included-success', 'included-reverted', 'confirmation-threshold-met'].includes(evidence.status);
    if (included && (evidence.blockHash === null || evidence.blockNumber === null || evidence.confirmations < 1)) fail('invalid_evidence');
    if (['included-success', 'confirmation-threshold-met'].includes(evidence.status) && !['exact-direct-call', 'exact-commitment-event'].includes(evidence.correlation)) fail('invalid_evidence');
    if (evidence.status === 'included-reverted' && evidence.correlation !== 'not-established') fail('invalid_evidence');
    if (!included && (evidence.blockHash !== null || evidence.blockNumber !== null || evidence.confirmations !== 0 || evidence.correlation !== 'not-observed')) fail('invalid_evidence');
    state = ['pending', 'not-observed'].includes(evidence.status) ? record.state === 'replacement-uncertain' ? 'replacement-uncertain' : 'submitted' : evidence.status; retained = { ...evidence };
  } else if (command.type === 'rejected') {
    exact(evidence, ['boundary', 'code']);
    if (!['prepared', 'permission-validated', 'submission-uncertain'].includes(record.state) || !['local-validation', 'fixture-permission', 'bundler'].includes(evidence.boundary) || !['target', 'function', 'value', 'account', 'chain', 'expired', 'quota', 'nonce_used', 'revoked', 'binding', 'gas', 'provider-rejected'].includes(evidence.code)) fail('invalid_evidence');
    state = 'rejected'; retained = { ...evidence };
  } else if (command.type === 'revoked') {
    exact(evidence, ['sourceRole', 'ownerConfirmed', 'permissionId']); id(evidence.permissionId);
    if (!['prepared', 'permission-validated'].includes(record.state) || evidence.sourceRole !== 'fixture-only' || evidence.ownerConfirmed !== true) fail('invalid_evidence');
    state = 'revoked'; retained = { ...evidence };
  } else fail('invalid_transition');
  if (record.observations.length === 64) fail('invalid_transition');
  const at = timestamp(now);
  if (at < record.updatedAt) fail('invalid_evidence');
  return freeze({ ...record, revision: record.revision + 1, state, transactionHash, updatedAt: at, observations: [...record.observations, { type: command.type, at, evidence: retained }] });
}
/** CAS is a pure precondition here; a future owner-bound store must persist it atomically. */
export function transitionChainOperation(record, command, now = new Date()) {
  validateChainOperation(record);
  return applyTransition(record, command, now);
}
