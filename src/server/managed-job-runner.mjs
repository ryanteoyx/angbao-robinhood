/** Zero-network orchestration fixture. All dependencies are trusted host adapters. */
import { rejectJob, jobDigest } from '../domain/managed-job-ledger.mjs';

/** resolveExact(ref, {now, maxAgeMs}) is replaceable by Memory's canonical resolver adapter.
 * reservations.reserve/settle use the existing Elfa repository semantics via a
 * host binding. No independent provider quota ledger is created here.
 * validateResult returns a validated immutable reference, never writes workspace.
 * Atomic business result commit is store.command(commit), not a financial save.
 */
export function createManagedJobRunner({ store, resolveExact, referenceScope, reservations, executeTool, validateResult, clock = Date.now, checkpoint = async () => {}, completion = 'business-receipt' }) {
  if (!['business-receipt','pending-inbox'].includes(completion)) rejectJob('configuration');
  if (![resolveExact, referenceScope, executeTool, validateResult, clock, checkpoint].every(x => typeof x === 'function') || typeof reservations?.reserve !== 'function' || typeof reservations?.settle !== 'function') rejectJob('configuration');
  return Object.freeze({
    async run(jobId, workerId) {
      const proof = store.command({ type: 'claim', jobId, workerId });
      const guard = () => store.command({ type: 'guard', proof });
      let job = guard();
      if (job.state === 'uncertain') return job;
      const context = () => ({ ownerId: job.spec.ownerId, workspaceId: job.spec.workspaceId, now: clock() });
      const maxAgeMs = 300000;
      const isoTime = value => {
        if (typeof value !== 'string') rejectJob('memory_window');
        const parsed = Date.parse(value);
        if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) rejectJob('memory_window');
        return parsed;
      };
      const windowBounds = (window, evaluatedAt) => {
        if (!window || typeof window !== 'object' || Array.isArray(window) || Object.keys(window).sort().join(',') !== 'evaluatedAt,maxAgeMs,validFrom,validThrough' || window.maxAgeMs !== maxAgeMs || window.evaluatedAt !== evaluatedAt) rejectJob('memory_window');
        const evaluated = isoTime(window.evaluatedAt), from = isoTime(window.validFrom), through = isoTime(window.validThrough);
        if (from > evaluated || evaluated > through || through - from > maxAgeMs) rejectJob('memory_window');
        return { from, through };
      };
      // Memory supplies the timestamp interpretation. Jobs only validates its
      // finite interval and synchronously intersects all selected input windows.
      const requireCurrent = values => {
        const now = clock();
        if (!Number.isSafeInteger(now)) rejectJob('clock');
        for (const value of values) {
          const { from, through } = windowBounds(value.freshnessWindow, value.freshnessWindow?.evaluatedAt);
          if (now < from || now > through) rejectJob('memory_expired');
        }
      };
      const resolve = async () => {
        const values = [];
        for (const ref of job.spec.refs) {
          guard();
          const refScope = referenceScope(structuredClone(ref));
          if (refScope?.ownerId !== job.spec.ownerId || refScope?.workspaceId !== job.spec.workspaceId) rejectJob('memory_scope');
          const evaluatedAt = new Date(clock()).toISOString();
          const value = await resolveExact(structuredClone(ref), { now: evaluatedAt, maxAgeMs });
          guard();
          // Adapter must validate identity/digest/freshness, not merely return a body.
          if (!value || value.status !== 'resolved' || value.freshness !== 'fresh') rejectJob('memory_unresolved');
          if (!value.envelope?.reference || jobDigest(value.envelope.reference) !== jobDigest(ref)) rejectJob('memory_mismatch');
          windowBounds(value.freshnessWindow, evaluatedAt);
          values.push(structuredClone(value));
        }
        return values;
      };
      const inputs = await resolve(); guard(); requireCurrent(inputs);
      if (!job.inbox) {
        const intent = store.command({ type: 'dispatch', proof });
        await checkpoint('outbox'); guard();
        let reservation;
        try {
          requireCurrent(inputs);
          reservation = await reservations.reserve({ operationId: intent.operationId, requestDigest: intent.requestDigest, ownerId: job.spec.ownerId, units: job.spec.units, now: clock() });
          guard();
          if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation) || reservation.fresh !== true || typeof reservation.reservationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(reservation.reservationId)) {
            return store.command({ type: 'uncertain', proof });
          }
          store.command({ type: 'reserved', proof, reservationId: reservation.reservationId });
          await checkpoint('reservation'); guard();
          requireCurrent(inputs);
          const result = await executeTool({ inputs, operationId: intent.operationId, workflow: job.spec.workflow });
          guard();
          await checkpoint('tool-return'); guard();
          store.command({ type: 'inbox', proof, result });
          await checkpoint('inbox'); guard();
          // This never releases a hold. Failed settlement cannot trigger a refetch.
          await reservations.settle({ ...reservation, operationId: intent.operationId, requestDigest: intent.requestDigest, ownerId: job.spec.ownerId, state: 'completed', now: clock() });
          guard();
        } catch (error) {
          // Cancellation/revocation/fencing errors preserve already committed state.
          // An outstanding intent is sufficient for conservative restart recovery.
          try { const current = guard(); if (!current.inbox) store.command({ type: 'uncertain', proof }); } catch {}
          throw error;
        }
      }
      job = guard();
      if(completion==='pending-inbox')return {status:'pending-inbox',proof:structuredClone(proof),inboxId:job.inbox.id,inboxDigest:job.inbox.digest};
      // Re-resolve after external awaits. Changes never rewrite the selected refs.
      await resolve(); guard();
      const resultRef = await validateResult({ result: structuredClone(job.inbox.result), inputRefs: structuredClone(job.spec.refs), inboxDigest: job.inbox.digest, ...context() });
      guard();
      await checkpoint('before-commit'); guard();
      // Validation and test/supervisor checkpoints can outlast source freshness.
      // Re-resolve after both awaits; retain the inbox/hold if inputs are now stale.
      const finalInputs = await resolve(); guard();
      requireCurrent(finalInputs);
      return store.command({ type: 'commit', proof, inboxDigest: job.inbox.digest, resultRef });
    },
  });
}
