/** Injected, signup-free local OS-user binding. No filesystem loader or transport route. */
import { researchDigest } from '../domain/research-work-record.mjs';
import { createHeadlessElfaEvidenceService, ELFA_EVIDENCE_SCOPE, ELFA_EVIDENCE_CONSENT, ELFA_EVIDENCE_MAX_APPROVAL, normalizeElfaEventsQuery, elfaEventsQueryDigest } from './headless-elfa-evidence.mjs';

if (typeof window !== 'undefined') throw new Error('Local Elfa operator binding is server-only.');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export class LocalElfaOperatorError extends Error {
  constructor(code) {
    super({ local_operator_disabled: 'Local Elfa access is not configured and enabled.', local_operator_binding: 'The private operator grant does not match this OS user and workspace.', local_operator_expired: 'The local operator approval is expired or revoked.', local_operator_changed: 'Local source access changed. Reopen its exact approval; no replacement read was started.', local_operator_input: 'Use only the documented operation, query and consent fields.' }[code] || 'The private local Elfa binding could not be verified.');
    this.name = 'LocalElfaOperatorError'; this.code = code;
  }
  toJSON() { return { name: this.name, code: this.code, message: this.message }; }
}
const fail = code => { throw new LocalElfaOperatorError(code); };
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail('local_operator_input');
}
function dataCopy(value) {
  const seen = new Set(); let count = 0;
  function check(item, depth) {
    if (++count > 10000 || depth > 14) fail('local_operator_input');
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') { if (item.length > 8192) fail('local_operator_input'); return; }
    if ((!plain(item) && !Array.isArray(item)) || seen.has(item)) fail('local_operator_input');
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) fail('local_operator_input');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('local_operator_input');
      check(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  check(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) fail('local_operator_input');
  return structuredClone(value);
}

/** Same sorted-key canonical SHA-256 used by the existing service for JSON policy. */
export function localElfaPolicyDigest(policy) { return researchDigest(dataCopy(policy)); }

/**
 * The three readers are trusted startup dependencies, never HTTP/model arguments.
 * Their later filesystem loader must verify private same-UID files and actual workspace
 * identity/location. This module does not authenticate a human, harness or hosted PAT.
 */
export function createLocalElfaEvidenceBinding({ readWorkspaceBinding, readOperatorGrant, readPolicy, repository, apiKey, fetchImpl, now = () => new Date() } = {}) {
  if (![readWorkspaceBinding, readOperatorGrant, readPolicy, fetchImpl, now].every(value => typeof value === 'function') || typeof repository?.reserve !== 'function' || typeof repository?.settle !== 'function' || typeof process.getuid !== 'function') fail('local_operator_configuration');
  const time = () => { let current; try { current = new Date(now()); } catch { fail('local_operator_configuration'); } if (!Number.isFinite(current.getTime())) fail('local_operator_configuration'); return current; };
  async function context() {
    let workspace, grant, policy;
    try {
      workspace = dataCopy(await readWorkspaceBinding());
      grant = dataCopy(await readOperatorGrant());
      policy = dataCopy(await readPolicy());
      // Reject an observable torn collection across awaited private-file readers.
      const confirm = { workspace: dataCopy(await readWorkspaceBinding()), grant: dataCopy(await readOperatorGrant()), policy: dataCopy(await readPolicy()) };
      if (researchDigest({ workspace, grant, policy }) !== researchDigest(confirm)) fail('local_operator_changed');
    } catch (error) { if (error instanceof LocalElfaOperatorError && error.code === 'local_operator_changed') throw error; fail('local_operator_unavailable'); }
    if (grant === null || policy === null || policy.enabled !== true) fail('local_operator_disabled');
    exact(workspace, ['installationId', 'dataLocationFingerprint']);
    exact(grant, ['format', 'authority', 'operatorUid', 'ownerId', 'grantId', 'installationId', 'dataLocationFingerprint', 'keySlot', 'windowId', 'policyDigest', 'scopes', 'approvedAt', 'expiresAt', 'revoked']);
    const current = time(), uid = process.getuid();
    if (!Number.isSafeInteger(uid) || grant.format !== 'angbao-local-elfa-operator-grant@1' || grant.authority !== 'same-os-user'
      || grant.operatorUid !== uid || grant.ownerId !== `local-os-user:${uid}` || !id(grant.grantId) || !grant.grantId.startsWith('local-elfa:')
      || !uuid(workspace.installationId) || !digest(workspace.dataLocationFingerprint)
      || grant.installationId !== workspace.installationId || grant.dataLocationFingerprint !== workspace.dataLocationFingerprint
      || !Array.isArray(grant.scopes) || grant.scopes.length !== 1 || grant.scopes[0] !== ELFA_EVIDENCE_SCOPE
      || !id(grant.keySlot) || !id(grant.windowId) || grant.keySlot !== policy.keySlot || grant.windowId !== policy.windowId
      || !digest(grant.policyDigest) || grant.policyDigest !== localElfaPolicyDigest(policy)) fail('local_operator_binding');
    const expiries = [policy.approvedUntil, policy.rights?.expiresAt, policy.entitlement?.expiresAt, ELFA_EVIDENCE_MAX_APPROVAL, ...(policy.costModel === null ? [] : [policy.costModel?.expiresAt])];
    if (grant.revoked !== false || !iso(grant.approvedAt) || Date.parse(grant.approvedAt) > current.getTime() || !iso(grant.expiresAt)
      || Date.parse(grant.expiresAt) <= current.getTime() || expiries.some(expiry => !iso(expiry) || Date.parse(grant.expiresAt) > Date.parse(expiry))) fail('local_operator_expired');
    return { workspace, grant, policy, fingerprint: researchDigest({ workspace, grant, policy }) };
  }
  const currentContext = async baseline => { const latest = await context(); if (latest.fingerprint !== baseline.fingerprint) fail('local_operator_changed'); return latest; };
  const noCredential = value => {
    if (typeof apiKey === 'string' && apiKey && JSON.stringify(value).includes(apiKey)) fail('local_operator_input');
    return value;
  };
  function input(args, fields) {
    const copy = noCredential(dataCopy(args)); exact(copy, fields);
    if (!id(copy.operationId)) fail('local_operator_input');
    return copy;
  }
  function authorization({ grant, fingerprint }) {
    // Non-secret local configuration-version ID, not a bearer credential or hosted
    // grant. Existing consent now binds policy/workspace changes between calls too.
    return { verified: true, ownerId: grant.ownerId, grantId: `local-elfa:${fingerprint}`, revoked: false, scopes: [...grant.scopes], expiresAt: grant.expiresAt };
  }
  return Object.freeze({
    async preview(args) {
      const { operationId, query } = input(args, ['operationId', 'query']);
      const baseline = await context(), current = time();
      const normalizedQuery = normalizeElfaEventsQuery(query, { now: () => current });
      const queryDigest = elfaEventsQueryDigest(normalizedQuery, { now: () => current });
      const { grant, policy } = baseline, identity = authorization(baseline);
      // This is disclosure, not a duplicate admission engine. The existing service
      // remains the arbiter of rights, entitlement, costs and exact fetch consent.
      if (!plain(policy.rights) || !plain(policy.entitlement) || !plain(policy.limits) || !iso(policy.approvedUntil) || !iso(policy.rights.expiresAt) || !iso(policy.entitlement.expiresAt)) fail('local_operator_unavailable');
      const expiresAt = new Date(Math.min(Date.parse(grant.expiresAt), Date.parse(policy.approvedUntil), Date.parse(policy.rights.expiresAt), Date.parse(policy.entitlement.expiresAt), Date.parse(ELFA_EVIDENCE_MAX_APPROVAL))).toISOString();
      if (Date.parse(expiresAt) <= current.getTime()) fail('local_operator_expired');
      const result = {
        format: 'angbao-local-elfa-preview@1', operationId, query: normalizedQuery, queryDigest,
        recipient: { authority: 'same-os-user', ownerId: identity.ownerId, operatorGrantId: grant.grantId, authorizationBindingId: identity.grantId, scope: ELFA_EVIDENCE_SCOPE, installationId: grant.installationId },
        policyDigest: grant.policyDigest, keySlot: grant.keySlot, windowId: grant.windowId,
        limits: pick(policy.limits, ['globalRequests', 'ownerRequests', 'globalCredits', 'ownerCredits']),
        rights: pick(policy.rights, ['version', 'termsReference', 'reviewedAt', 'expiresAt', 'agentDeliveryApproved', 'recipientUse']),
        entitlement: pick(policy.entitlement, ['reviewId', 'reviewedAt', 'expiresAt', 'v3EventsApproved', 'noPaidFallback', 'chargingBasis']),
        costModel: policy.costModel === null ? null : pick(policy.costModel, ['version', 'reviewId', 'reviewedAt', 'maxCreditUnitsPerRequest', 'expiresAt']),
        expiresAt, hardCutoff: ELFA_EVIDENCE_MAX_APPROVAL,
        consent: { version: ELFA_EVIDENCE_CONSENT, approved: false, ownerId: identity.ownerId, grantId: identity.grantId, operationId, queryDigest, rightsVersion: policy.rights.version, windowId: grant.windowId, expiresAt },
        admissionChecked: false, consentRecorded: false, providerCalls: 0, memoryWritten: false, financialAuthority: false,
      };
      await currentContext(baseline);
      return freeze(noCredential(dataCopy(result)));
    },
    async fetchEvidence(args) {
      const { operationId, query, consent } = input(args, ['operationId', 'query', 'consent']);
      const baseline = await context(), actor = Object.freeze({});
      const service = createHeadlessElfaEvidenceService({
        repository, apiKey, now,
        readPolicy: async () => (await currentContext(baseline)).policy,
        resolveAuthorization: async candidate => {
          if (candidate !== actor) fail('local_operator_binding');
          return authorization(await currentContext(baseline));
        },
        fetchImpl, // No extra await between the service's final admission checks and dispatch.
      });
      const result = await service.fetchEvidence({ actor, operationId, query, consent });
      // Withhold evidence if local authority changed after the service's final await.
      // The existing ledger's conservative hold is never compensated or recreated.
      await currentContext(baseline);
      // The exact consent may expire sooner than the grant while those reads await.
      // This final synchronous check withholds delivery without changing the hold.
      if (!iso(consent.expiresAt) || Date.parse(consent.expiresAt) <= time().getTime()) fail('local_operator_expired');
      return freeze(noCredential(result));
    },
  });
}
