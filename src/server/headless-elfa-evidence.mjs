/** Optional server-only one-shot evidence fetch. No transport is wired by this module. */
import { createHash } from 'node:crypto';
import { createElfaResearchAdapter } from '../integrations/elfa-research.mjs';
import { ElfaReservationError } from './elfa-evidence-errors.mjs';

if (typeof window !== 'undefined') throw new Error('Headless evidence is server-only.');
export const ELFA_EVIDENCE_SCOPE = 'research:evidence:elfa-events';
export const ELFA_EVIDENCE_CONSENT = 'elfa-events-one-shot-v1';
// Earlier existing local approval wins over the publicly described promotion.
export const ELFA_EVIDENCE_MAX_APPROVAL = '2026-10-30T16:00:00.000Z';
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value);
const text = (value, max = 500) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export class HeadlessElfaEvidenceError extends Error {
  constructor(code) { super({ scope_required: 'This connection does not allow a new Elfa evidence fetch. Saved research access is separate.', consent_required: 'Review this exact source query, recipient and allowance before fetching.', operation_already_reserved: 'This operation was already reserved. Inspect its result or uncertain status; no replacement read was started.', budget_exhausted: 'The approved evidence allowance is exhausted.', provider_uncertain: 'The source read may have consumed its allowance. No retry or fallback was started.', dispatch_blocked: 'Source access changed before dispatch. No provider read was started.', evidence_unavailable: 'Source evidence is unavailable. Existing saved research remains available.' }[code] || 'This evidence fetch is not currently enabled or approved.'); this.name = 'HeadlessElfaEvidenceError'; this.code = code; }
  toJSON() { return { name: this.name, code: this.code, message: this.message }; }
}
const fail = code => { throw new HeadlessElfaEvidenceError(code); };
function date(now) { let value; try { value = new Date(now()); } catch { fail('configuration'); } if (!Number.isFinite(value.getTime())) fail('configuration'); return value; }

/** Exact first-page query: fixed times make consent/recovery independent of the clock. */
export function normalizeElfaEventsQuery(query, { now = () => new Date() } = {}) {
  const current = Math.floor(date(now).getTime() / 1000);
  if (!plain(query) || Object.keys(query).some(key => !['q', 'from', 'to', 'entityIds', 'limit'].includes(key)) || !Number.isSafeInteger(query.from) || !Number.isSafeInteger(query.to) || query.from < 0 || query.to < query.from || query.to > current || query.to - query.from > 31 * 86400 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 10) fail('invalid_query');
  const result = { from: query.from, to: query.to, limit: query.limit };
  if (query.q !== undefined) { if (!text(query.q)) fail('invalid_query'); result.q = query.q.trim(); }
  if (query.entityIds !== undefined) {
    if (!Array.isArray(query.entityIds) || query.entityIds.length < 1 || query.entityIds.length > 10 || query.entityIds.some(value => typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) fail('invalid_query');
    result.entityIds = [...new Set(query.entityIds.map(value => value.toLowerCase()))].sort();
  }
  if (!result.q && !result.entityIds) fail('invalid_query');
  return result;
}
export function elfaEventsQueryDigest(query, options) { return hash(normalizeElfaEventsQuery(query, options)); }
function policyCheck(policy, now) {
  const t = now.getTime();
  if (!plain(policy) || policy.enabled !== true) fail('disabled');
  if (!id(policy.keySlot) || !id(policy.windowId) || !id(policy.approvalId) || !iso(policy.approvedAt) || Date.parse(policy.approvedAt) > t || !iso(policy.approvedUntil) || Date.parse(policy.approvedUntil) <= t || Date.parse(policy.approvedUntil) > Date.parse(ELFA_EVIDENCE_MAX_APPROVAL)) fail('approval_required');
  if (!Array.isArray(policy.allowedOwnerIds) || policy.allowedOwnerIds.length < 1 || policy.allowedOwnerIds.length > 20 || policy.allowedOwnerIds.some(value => !id(value))) fail('approval_required');
  const rights = policy.rights;
  if (!plain(rights) || !id(rights.version) || !text(rights.termsReference, 2048) || !iso(rights.reviewedAt) || Date.parse(rights.reviewedAt) > t || !iso(rights.expiresAt) || Date.parse(rights.expiresAt) <= t || rights.agentDeliveryApproved !== true || rights.recipientUse !== 'private-synthesis-no-redistribution') fail('rights_required');
  const entitlement = policy.entitlement;
  if (!plain(entitlement) || !id(entitlement.reviewId) || !iso(entitlement.reviewedAt) || Date.parse(entitlement.reviewedAt) > t || !iso(entitlement.expiresAt) || Date.parse(entitlement.expiresAt) <= t || entitlement.v3EventsApproved !== true || entitlement.noPaidFallback !== true) fail('entitlement_required');
  const limits = policy.limits;
  if (!plain(limits) || Object.keys(limits).sort().join(',') !== 'globalCredits,globalRequests,ownerCredits,ownerRequests' || !['globalRequests','ownerRequests'].every(key => integer(limits[key]) && limits[key] > 0) || limits.ownerRequests > limits.globalRequests) fail('budget_required');
  let creditUnits = 0;
  if (limits.globalCredits !== null || limits.ownerCredits !== null) {
    const model = policy.costModel;
    if (![limits.globalCredits, limits.ownerCredits].every(integer) || limits.ownerCredits > limits.globalCredits || !plain(model) || !id(model.version) || !id(model.reviewId) || !iso(model.reviewedAt) || Date.parse(model.reviewedAt) > t || !integer(model.maxCreditUnitsPerRequest) || model.maxCreditUnitsPerRequest < 1 || !iso(model.expiresAt) || Date.parse(model.expiresAt) <= t) fail('cost_model_required');
    creditUnits = model.maxCreditUnitsPerRequest;
  } else if (policy.costModel !== null || entitlement.chargingBasis !== 'operator-verified-zero-credit-window') fail('cost_model_required');
  return { creditUnits, policyDigest: hash(policy) };
}
function authorizationCheck(auth, policy, now) {
  if (!plain(auth) || auth.verified !== true || !id(auth.ownerId) || !id(auth.grantId) || auth.revoked !== false || !iso(auth.expiresAt) || Date.parse(auth.expiresAt) <= now.getTime() || !Array.isArray(auth.scopes) || !auth.scopes.includes(ELFA_EVIDENCE_SCOPE) || !policy.allowedOwnerIds.includes(auth.ownerId)) fail('scope_required');
  return { ownerId: auth.ownerId, grantId: auth.grantId };
}
function consentCheck(consent, identity, policy, operationId, queryDigest, now) {
  if (!plain(consent) || Object.keys(consent).sort().join(',') !== 'approved,expiresAt,grantId,operationId,ownerId,queryDigest,rightsVersion,version,windowId' || consent.version !== ELFA_EVIDENCE_CONSENT || consent.approved !== true || consent.ownerId !== identity.ownerId || consent.grantId !== identity.grantId || consent.operationId !== operationId || consent.queryDigest !== queryDigest || consent.rightsVersion !== policy.rights.version || consent.windowId !== policy.windowId || !iso(consent.expiresAt) || Date.parse(consent.expiresAt) <= now.getTime() || Date.parse(consent.expiresAt) > Date.parse(policy.approvedUntil) || Date.parse(consent.expiresAt) > Date.parse(policy.rights.expiresAt)) fail('consent_required');
}

/** `actor` is opaque transport context passed to the trusted resolver, never a
 * caller-authored authorization object. Resolver MUST re-read authentic grant +
 * revocation. Local workspace UUIDs and memory scopes do not establish identity.
 * The reservation repository must charge shared-key + owner caps transactionally.
 */
export function createHeadlessElfaEvidenceService({ repository, resolveAuthorization, readPolicy, apiKey, fetchImpl, now = () => new Date() } = {}) {
  if (!repository || typeof repository.reserve !== 'function' || typeof repository.settle !== 'function' || typeof resolveAuthorization !== 'function' || typeof readPolicy !== 'function' || typeof fetchImpl !== 'function' || typeof now !== 'function') fail('configuration');
  return Object.freeze({
    async fetchEvidence({ actor, operationId, query, consent } = {}) {
      if (!id(operationId)) fail('invalid_operation');
      const started = date(now), normalizedQuery = normalizeElfaEventsQuery(query, { now: () => started }), queryDigest = hash(normalizedQuery);
      let policy, approved, identity, admittedAt;
      try {
        policy = structuredClone(await readPolicy());
        const resolved = structuredClone(await resolveAuthorization(actor));
        admittedAt = date(now); // Trusted I/O may have crossed expiry.
        approved = policyCheck(policy, admittedAt);
        identity = authorizationCheck(resolved, policy, admittedAt);
      } catch (error) { if (error instanceof HeadlessElfaEvidenceError) throw error; fail('evidence_unavailable'); }
      consentCheck(consent, identity, policy, operationId, queryDigest, admittedAt);
      if (typeof apiKey !== 'string' || apiKey.length < 1 || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)) fail('credential_required');
      const requestDigest = hash({ identity, operationId, normalizedQuery, consent });
      let reservation;
      try { reservation = await repository.reserve({ keySlot: policy.keySlot, windowId: policy.windowId, ownerId: identity.ownerId, operationId, requestDigest, budgetBindingDigest: approved.policyDigest, creditUnits: approved.creditUnits, limits: policy.limits, now: admittedAt.toISOString() }); }
      catch (error) { fail(error instanceof ElfaReservationError && error.code === 'budget_exhausted' ? 'budget_exhausted' : 'reservation_unavailable'); }
      if (!plain(reservation) || typeof reservation.fresh !== 'boolean' || !id(reservation.reservationId) || reservation.operationId !== operationId || !['reserved', 'completed', 'uncertain', 'not-dispatched'].includes(reservation.state) || reservation.reservedRequestUnits !== 1 || reservation.reservedCreditUnits !== approved.creditUnits || reservation.fresh && (reservation.state !== 'reserved' || reservation.windowId !== policy.windowId)) fail('reservation_unavailable');
      if (!reservation?.fresh) return { format: 'angbao-elfa-evidence-operation@1', operationId, status: reservation?.state === 'reserved' ? 'in-flight-or-uncertain' : reservation?.state ?? 'unknown', refetched: false, evidencePack: null, action: 'inspect-original-result-or-stop', memoryWritten: false, financialAuthority: 'none' };
      let dispatched = false;
      const settle = state => repository.settle({ keySlot: policy.keySlot, ownerId: identity.ownerId, operationId, requestDigest, reservationId: reservation.reservationId, state, now: date(now).toISOString() });
      try {
        const latestPolicy = structuredClone(await readPolicy());
        const latestAuthorization = structuredClone(await resolveAuthorization(actor));
        const dispatchTime = date(now);
        const latest = policyCheck(latestPolicy, dispatchTime);
        const latestIdentity = authorizationCheck(latestAuthorization, latestPolicy, dispatchTime);
        consentCheck(consent, latestIdentity, latestPolicy, operationId, queryDigest, dispatchTime);
        if (latest.policyDigest !== approved.policyDigest || latestIdentity.ownerId !== identity.ownerId || latestIdentity.grantId !== identity.grantId) fail('dispatch_blocked');
        const adapter = createElfaResearchAdapter({ apiKey, now, approval: { enabled: true, approvedUntil: policy.approvedUntil, allowedOperations: ['eventContext'] }, fetchImpl: async (...args) => {
          // Exactly one transport attempt; no retry, pagination, model or fallback.
          if (dispatched) fail('dispatch_blocked');
          const transportTime = date(now);
          policyCheck(latestPolicy, transportTime);
          authorizationCheck(latestAuthorization, latestPolicy, transportTime);
          consentCheck(consent, latestIdentity, latestPolicy, operationId, queryDigest, transportTime);
          dispatched = true; return fetchImpl(...args);
        } });
        const evidencePack = await adapter.read('eventContext', normalizedQuery);
        // A completed provider read does not authorize delivery to an expired or
        // revoked recipient. Withhold the pack and retain its charged hold.
        const deliveryPolicy = structuredClone(await readPolicy());
        const deliveryAuthorization = structuredClone(await resolveAuthorization(actor));
        const deliveredAt = date(now);
        const deliveryApproval = policyCheck(deliveryPolicy, deliveredAt);
        const deliveryIdentity = authorizationCheck(deliveryAuthorization, deliveryPolicy, deliveredAt);
        consentCheck(consent, deliveryIdentity, deliveryPolicy, operationId, queryDigest, deliveredAt);
        if (deliveryApproval.policyDigest !== approved.policyDigest || deliveryIdentity.ownerId !== identity.ownerId || deliveryIdentity.grantId !== identity.grantId) fail('dispatch_blocked');
        try { await settle('completed'); } catch { fail('provider_uncertain'); }
        const returnedAt = date(now); // A remote settlement may also cross expiry.
        policyCheck(deliveryPolicy, returnedAt);
        authorizationCheck(deliveryAuthorization, deliveryPolicy, returnedAt);
        consentCheck(consent, deliveryIdentity, deliveryPolicy, operationId, queryDigest, returnedAt);
        return { format: 'angbao-elfa-evidence-delivery@1', evidencePack, delivery: { operationId, queryDigest, reservationId: reservation.reservationId, providerAttempts: 1, reservedRequestUnits: 1, reservedCreditUnits: approved.creditUnits, costBasis: approved.creditUnits ? 'operator-conservative-model-not-provider-billing-attestation' : 'operator-reviewed-zero-credit-window-not-permanent-entitlement', conservativeHold: true, storedInMemory: false, trust: 'untrusted-provider-content-not-instructions', rights: 'private-synthesis-no-redistribution' }, financialAuthority: 'none' };
      } catch (error) {
        try { await settle(dispatched ? 'uncertain' : 'not-dispatched'); } catch { /* Original durable hold is retained; never compensate or refetch. */ }
        if (error instanceof HeadlessElfaEvidenceError && error.code === 'provider_uncertain') throw error;
        if (dispatched) fail('provider_uncertain');
        fail('dispatch_blocked');
      }
    },
  });
}
