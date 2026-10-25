import {canonicalLocalJson} from './local-continuity.mjs';
import {FinancialMemoryError, validateFinancialMemoryScope, validateFinancialMemoryReference, validateFinancialMemoryEnvelope} from './financial-memory-contract.mjs';
export {adaptFinancialRecord} from './financial-memory-contract.mjs';

/** Lookup must be authorized by the runtime. No storage, fallback or mutation. */
export function createFinancialMemoryResolver({scope, lookup}) {
  const trustedScope = validateFinancialMemoryScope(scope);
  if (typeof lookup !== 'function') throw new FinancialMemoryError('Supply a read-only lookup.');
  return Object.freeze({async resolveExact(reference, options = {}) {
    const ref = validateFinancialMemoryReference(reference);
    if (Object.keys(options).some(key=>!['now','maxAgeMs'].includes(key)) || (options.now === undefined) !== (options.maxAgeMs === undefined) || options.now !== undefined && (typeof options.now !== 'string' || !Number.isFinite(Date.parse(options.now)) || new Date(options.now).toISOString() !== options.now || !Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0)) throw new FinancialMemoryError('Freshness requires an explicit ISO clock and nonnegative integer age.');
    const {now,maxAgeMs} = options;
    if (ref.ownerId !== trustedScope.ownerId || ref.workspaceId !== trustedScope.workspaceId) return {status:'mismatch',reason:'scope'};
    const found = await lookup(structuredClone(ref));
    if (!Array.isArray(found)) return {status:'conflict',reason:'invalid-lookup-result'};
    if (!found.length) return {status:'missing',reason:'record-not-retained'};
    let candidates;
    try { candidates = Array.from(found, validateFinancialMemoryEnvelope); }
    catch { return {status:'conflict',reason:'invalid-retained-record'}; }
    // A record ID may retain several immutable revisions (e.g. prepared/completed).
    // Narrow by every reference field, never choose the newest or first revision.
    for (const field of ['ownerId','workspaceId','kind','recordId','version','digest']) {
      candidates = candidates.filter(item=>item.reference[field] === ref[field]);
      if (!candidates.length) return {status:'mismatch',reason:field};
    }
    const first = candidates[0];
    if (candidates.some(item=>canonicalLocalJson(item)!==canonicalLocalJson(first))) return {status:'conflict',reason:'ambiguous-retained-record'};
    let freshness = 'unverified';
    let freshnessWindow;
    if (now !== undefined) {
      const times = [first.freshness.asOf, ...first.bindings.filter(binding=>binding.role === 'source' || binding.role === 'context' && binding.data?.observedAt !== undefined).map(binding=>binding.observedAt)];
      // Portfolio observation is required even when the historical field is absent.
      if (ref.kind === 'portfolio') times.push(first.record.decision.snapshots.portfolio?.observedAt);
      const validTime = time => typeof time === 'string' && Number.isFinite(Date.parse(time)) && new Date(time).toISOString() === time;
      freshness = times.some(time=>!validTime(time)) ? 'unknown' : times.some(time=>Date.parse(time) > Date.parse(now)) ? 'future' : times.some(time=>Date.parse(now) - Date.parse(time) > maxAgeMs) ? 'stale' : 'fresh';
      if (freshness !== 'fresh') return {status:'mismatch',reason:`freshness-${freshness}`};
      const timestamps = times.map(time=>Date.parse(time));
      const validFrom = Math.max(...timestamps);
      const validThrough = Math.min(...timestamps) + maxAgeMs;
      if (!Number.isSafeInteger(validThrough) || !Number.isFinite(new Date(validThrough).getTime()) || validFrom > validThrough) return {status:'mismatch',reason:'freshness-window-invalid'};
      freshnessWindow = {evaluatedAt:now,validFrom:new Date(validFrom).toISOString(),validThrough:new Date(validThrough).toISOString(),maxAgeMs};
    }
    return {status:'resolved',envelope:first,freshness,...(freshnessWindow ? {freshnessWindow} : {})};
  }});
}
