/** O1a single-run fixture protocol. No financial memory or provider quota authority. */
import { createHash } from 'node:crypto';
export class ManagedJobError extends Error {
  constructor(code) { super(code); this.name = 'ManagedJobError'; this.code = code; }
}
export const rejectJob = code => { throw new ManagedJobError(code); };
export function canonicalJobJSON(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJobJSON).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJobJSON(value[k])}`).join(',')}}`;
  rejectJob('invalid_json');
}
export const jobDigest = value => createHash('sha256').update(canonicalJobJSON(value)).digest('hex');
const ident = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(x);
const exactKeys = (x, keys) => x && Object.keys(x).sort().join(',') === keys.split(',').sort().join(',');
const integer = x => Number.isSafeInteger(x) && x >= 0;
const terminal = j => ['completed', 'cancelled', 'expired', 'revoked', 'failed'].includes(j.state);
export const newJobLedger = () => ({ version: 1, jobs: {}, mandates: {} });
export const jobInputDigest = spec => jobDigest({ ownerId: spec.ownerId, workspaceId: spec.workspaceId, key: spec.key, refs: spec.refs, deadline: spec.deadline, units: spec.units, workflow: spec.workflow });
const event = (j, type, now) => {
  j.revision++;
  j.events.push({ id: `${j.runId}:event:${j.revision}`, type, at: now, fence: j.fence });
};
function get(state, id) { return state.jobs[id] ?? rejectJob('missing_job'); }
function scope(j, actor) {
  if (!actor || actor.ownerId !== j.spec.ownerId || actor.workspaceId !== j.spec.workspaceId) rejectJob('scope');
}
function authority(state, j, now) {
  const m = state.mandates[j.mandateId];
  if (!m || m.revoked || m.kind !== 'service-mandate' || m.inputDigest !== jobInputDigest(j.spec) || m.ownerId !== j.spec.ownerId || m.workspaceId !== j.spec.workspaceId) rejectJob('mandate_revoked');
  if (now >= j.spec.deadline) rejectJob('deadline');
  if (now >= m.expiresAt || now >= m.approvalExpiresAt) rejectJob('approval_expired');
  if (j.spec.units > m.maxUnits) rejectJob('budget');
  if (terminal(j)) rejectJob('terminal');
}
function fenced(state, proof, now) {
  const j = get(state, proof.jobId);
  if (proof.fence !== j.fence || proof.workerId !== j.lease?.workerId || now >= j.lease.until) rejectJob('stale_fence');
  authority(state, j, now);
  return j;
}
/** Called only by a trusted host, never directly with an unauthenticated client body.
 * A client PAT is deliberately not accepted as a mandate. All times are host-clock ms. */
export function applyJobCommand(state, command, now) {
  if (!integer(now)) rejectJob('clock');
  const { type } = command;
  if (type === 'mandate') {
    const m = command.mandate;
    if (!exactKeys(m, 'id,ownerId,workspaceId,kind,inputDigest,expiresAt,approvalExpiresAt,maxUnits,revoked') || m.kind !== 'service-mandate' || ![m.id, m.ownerId, m.workspaceId].every(ident) || !/^[a-f0-9]{64}$/.test(m.inputDigest) || ![m.expiresAt, m.approvalExpiresAt, m.maxUnits].every(integer) || m.expiresAt <= now || m.approvalExpiresAt <= now || m.revoked !== false) rejectJob('invalid_mandate');
    if (state.mandates[m.id]) {
      if (jobDigest(state.mandates[m.id]) !== jobDigest(m)) rejectJob('mandate_conflict');
      return m;
    }
    if (Object.keys(state.mandates).length >= 100) rejectJob('capacity');
    state.mandates[m.id] = structuredClone(m); return m;
  }
  if (type === 'admit') {
    const s = command.spec;
    if (!exactKeys(s, 'ownerId,workspaceId,key,mandateId,workflow,refs,deadline,units') || ![s.ownerId, s.workspaceId, s.key, s.mandateId].every(ident) || s.workflow !== 'research-to-portfolio-fixture-v1' || !integer(s.deadline) || s.deadline <= now || s.deadline > now + 86400000 || !integer(s.units) || s.units > 1000000 || !Array.isArray(s.refs) || s.refs.length < 1 || s.refs.length > 8 || canonicalJobJSON(s).length > 16384) rejectJob('invalid_spec');
    const id = `job:${jobDigest([s.ownerId, s.workspaceId, s.key])}`;
    const old = state.jobs[id];
    if (old) { if (jobDigest(old.spec) !== jobDigest(s)) rejectJob('idempotency_conflict'); return old; }
    if (Object.keys(state.jobs).length >= 100 || Object.values(state.jobs).filter(j => j.spec.ownerId === s.ownerId && !terminal(j)).length >= 3) rejectJob('admission_limit');
    const j = { id, runId: `${id}:run:1`, stepId: `${id}:run:1:assessment`, attemptId: `${id}:run:1:assessment:attempt:1`, mandateId: s.mandateId, spec: structuredClone(s), state: 'queued', revision: 0, fence: 0, lease: null, outbox: null, inbox: null, resultRef: null, heldUnits: 0, events: [] };
    authority(state, j, now); event(j, 'admitted', now); state.jobs[id] = j; return j;
  }
  if (type === 'revoke') {
    const m = state.mandates[command.id] ?? rejectJob('missing_mandate');
    if (command.actor?.ownerId !== m.ownerId || command.actor?.workspaceId !== m.workspaceId) rejectJob('scope');
    m.revoked = true;
    for (const j of Object.values(state.jobs)) if (j.mandateId === m.id && !terminal(j)) { j.state = 'revoked'; event(j, 'revoked', now); }
    return m;
  }
  if (type === 'cancel') {
    const j = get(state, command.jobId); scope(j, command.actor);
    if (command.expectedRevision !== j.revision) rejectJob('revision_conflict');
    if (!terminal(j)) { j.state = 'cancelled'; event(j, 'cancelled', now); } return j;
  }
  if (type === 'expire') {
    const j = get(state, command.jobId), m = state.mandates[j.mandateId];
    if (!terminal(j) && (now >= j.spec.deadline || now >= m.expiresAt || now >= m.approvalExpiresAt)) { j.state = 'expired'; event(j, 'expired', now); }
    return j;
  }
  if (type === 'claim') {
    const j = get(state, command.jobId);
    if (!ident(command.workerId)) rejectJob('invalid_worker');
    authority(state, j, now);
    if (j.lease && now < j.lease.until) rejectJob('leased');
    if (Object.values(state.jobs).some(other => other.id !== j.id && other.spec.ownerId === j.spec.ownerId && other.lease && now < other.lease.until && !terminal(other))) rejectJob('active_limit');
    if (j.fence >= 2) rejectJob('attempt_limit');
    j.fence++; j.lease = { workerId: command.workerId, until: now + 60000 };
    // Any durable dispatch intent without an inbox is unobservable after interruption.
    j.state = j.outbox && !j.inbox ? 'uncertain' : 'running';
    event(j, 'claimed', now); return { jobId: j.id, workerId: command.workerId, fence: j.fence };
  }
  const j = fenced(state, command.proof, now);
  if (type === 'guard') return j;
  if (type === 'renew') { if (j.events.length >= 240) rejectJob('event_limit'); j.lease.until = now + 60000; event(j, 'renewed', now); return j; }
  if (type === 'dispatch') {
    if (j.state !== 'running' || j.outbox) rejectJob('dispatch_forbidden');
    j.heldUnits = j.spec.units;
    j.outbox = { id: `${j.attemptId}:dispatch`, operationId: j.attemptId, requestDigest: jobInputDigest(j.spec), state: 'intent', reservationId: null };
    event(j, 'dispatch_intent', now); return j.outbox;
  }
  if (type === 'reserved') {
    if (!j.outbox || j.state !== 'running' || j.outbox.reservationId || !ident(command.reservationId)) rejectJob('reservation_conflict');
    j.outbox.reservationId = command.reservationId; event(j, 'reserved', now); return j;
  }
  if (type === 'uncertain') {
    if (!j.outbox || j.inbox) rejectJob('uncertainty_conflict');
    if (j.state !== 'uncertain') { j.state = 'uncertain'; event(j, 'uncertain', now); } return j;
  }
  if (type === 'inbox') {
    if (!j.outbox || !j.outbox.reservationId || j.state !== 'running' || canonicalJobJSON(command.result).length > 16384) rejectJob('inbox_forbidden');
    const digest = jobDigest(command.result);
    if (j.inbox) { if (j.inbox.digest !== digest) rejectJob('inbox_conflict'); return j; }
    j.inbox = { id: `${j.attemptId}:result`, digest, result: structuredClone(command.result) };
    j.outbox.state = 'received'; event(j, 'result_received', now); return j;
  }
  if (type === 'commit') {
    if (!j.inbox || j.state !== 'running' || command.inboxDigest !== j.inbox.digest || !command.resultRef || canonicalJobJSON(command.resultRef).length > 4096) rejectJob('commit_conflict');
    j.resultRef = structuredClone(command.resultRef); j.state = 'completed'; j.lease = null;
    event(j, 'completed', now); return j;
  }
  rejectJob('unknown_command');
}
