/** O1b fixture coordinator: native save and Jobs acknowledgement are separate commits.
 * Never install this as a side-effecting runner validateResult callback. */
import { localDigest } from '../domain/local-continuity.mjs';
import { jobDigest, canonicalJobJSON, rejectJob } from '../domain/managed-job-ledger.mjs';
import { portfolioExact, readPortfolioWork } from '../domain/portfolio-work-record.mjs';
import { validatePortfolioDecisionSync } from '../domain/portfolio-decision.mjs';
import { previewResearchWorkBrief } from '../domain/research-work.mjs';
import { readResearchWork, researchWorkReference } from '../domain/research-work-record.mjs';
import { readResearchBrief, saveResearchBrief } from '../domain/research-briefs.mjs';

const routes = { portfolio: '/api/local/portfolio-work', 'research-completion': '/api/research/methods/complete' };
const same = (a, b) => localDigest(a) === localDigest(b);
const iso = value => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(n) || new Date(n).toISOString() !== value) rejectJob('result_freshness_window');
  return n;
};
export function createManagedJobResultCoordinator({ jobs, trustedScope, nativeWorkspace, resolveExact, clock = Date.now, checkpoint = async () => {} }) {
  portfolioExact(trustedScope, ['ownerId', 'workspaceId']);
  if (![trustedScope.ownerId, trustedScope.workspaceId].every(v => typeof v === 'string' && v.length > 0) || ![nativeWorkspace?.read, nativeWorkspace?.saveExact, resolveExact, clock, checkpoint].every(v => typeof v === 'function')) rejectJob('result_configuration');
  const scope = structuredClone(trustedScope);
  function planFor(job) {
    if (!job.inbox || jobDigest(job.inbox.result) !== job.inbox.digest || Buffer.byteLength(canonicalJobJSON(job.inbox.result)) > 16384) rejectJob('result_inbox');
    portfolioExact(job.inbox.result, ['nativeSave']);
    const plan = structuredClone(job.inbox.result.nativeSave);
    portfolioExact(plan, ['kind', 'body', 'expectedETag', 'workspaceIdentity']);
    if (!Object.hasOwn(routes, plan.kind) || !/^"(?:0|[1-9]\d*)"$/.test(plan.expectedETag) || typeof plan.workspaceIdentity !== 'string' || !plan.workspaceIdentity.length || plan.workspaceIdentity.length > 200) rejectJob('result_plan');
    portfolioExact(plan.body, plan.kind === 'portfolio' ? ['decision', 'previousWorkId'] : ['workId', 'brief'], plan.kind === 'portfolio' ? ['decision'] : ['workId', 'brief']);
    const route = routes[plan.kind];
    const key = `job-save:${jobDigest([scope, job.id, job.runId, job.inbox.id, job.inbox.digest])}`;
    return { ...plan, route, key, fingerprint: localDigest({ method: 'POST', route, body: plan.body }) };
  }
  async function snapshot(plan) {
    const row = await nativeWorkspace.read();
    if (!row || !same(row.scope, scope) || row.identity !== plan.workspaceIdentity || row.state?.localInstallation?.id !== plan.workspaceIdentity) rejectJob('result_workspace');
    if (!Array.isArray(row.state.localReplayReceipts) || row.etag !== `"${row.state.localRevision}"`) rejectJob('result_snapshot');
    return row;
  }
  function retained(row, plan, job) {
    const receipts = row.state.localReplayReceipts.filter(r => r?.key === plan.key);
    if (!receipts.length) return null;
    if (receipts.length !== 1 || receipts[0].fingerprint !== plan.fingerprint) rejectJob('result_receipt_conflict');
    const receipt = receipts[0], result = receipt.result;
    if (!result || typeof result.workId !== 'string' || typeof result.workDigest !== 'string') rejectJob('result_receipt_invalid');
    const work = plan.kind === 'portfolio' ? readPortfolioWork(row.state, result.workId) : readResearchWork(row.state, result.workId);
    if (work.digest !== result.workDigest) rejectJob('result_record_mismatch');
    if (plan.kind === 'portfolio') {
      if (!same(work.decision, plan.body.decision) || (work.previousWorkRef?.id ?? null) !== (plan.body.previousWorkId ?? null)) rejectJob('result_record_mismatch');
    } else {
      if (work.id !== plan.body.workId || !work.briefId || !result.brief || work.briefId !== result.brief.id || !same(readResearchBrief(row.state, work.briefId), result.brief)) rejectJob('result_record_mismatch');
      // The native fingerprint binds the exact submitted brief; validate authored
      // fields too, so a corrupted receipt cannot relabel a different answer.
      const normalized = saveResearchBrief({ ...row.state, researchBriefs: row.state.researchBriefs.filter(b => b.id !== result.brief.id) }, plan.body.brief, new Date(result.brief.createdAt), { methodWorkId: work.id }).brief;
      if (!result.brief.methodRunRef || !same(result.brief.methodRunRef, researchWorkReference(work)) || (plan.body.brief.previousVersionId && result.brief.seriesId !== normalized.seriesId)) rejectJob('result_record_mismatch');
      for (const key of ['question', 'answer', 'authorship', 'evidence', 'claims', 'inferences', 'gaps', 'previousVersionRef', 'baseline', 'version']) if (!same(result.brief[key], normalized[key])) rejectJob('result_record_mismatch');
    }
    return { kind: plan.kind, recordId: work.id, recordDigest: work.digest, operationKey: plan.key, inboxDigest: job.inbox.digest, workspaceIdentity: plan.workspaceIdentity };
  }
  async function windows(job, guard) {
    const bounds = [];
    for (const ref of job.spec.refs) {
      guard();
      if (ref.ownerId !== scope.ownerId || ref.workspaceId !== scope.workspaceId) rejectJob('result_reference_scope');
      const evaluatedAt = new Date(clock()).toISOString();
      const value = await resolveExact(structuredClone(ref), { now: evaluatedAt, maxAgeMs: 300000 }); guard();
      if (value?.status !== 'resolved' || value.freshness !== 'fresh' || !same(value.envelope?.reference, ref)) rejectJob('result_reference');
      const w = value.freshnessWindow;
      if (!w || Object.keys(w).sort().join(',') !== 'evaluatedAt,maxAgeMs,validFrom,validThrough' || w.evaluatedAt !== evaluatedAt || w.maxAgeMs !== 300000) rejectJob('result_freshness_window');
      const at = iso(w.evaluatedAt), from = iso(w.validFrom), through = iso(w.validThrough);
      if (from > at || at > through || through - from > 300000) rejectJob('result_freshness_window');
      bounds.push({ from, through });
    }
    return bounds;
  }
  function current(bounds) {
    const now = clock();
    if (!Number.isSafeInteger(now)) rejectJob('clock');
    if (bounds.some(w => now < w.from || now > w.through)) rejectJob('result_freshness_expired');
  }
  async function inspect({ jobId }) {
    const job = jobs.get(jobId, scope), plan = planFor(job), row = await snapshot(plan), ref = retained(row, plan, job);
    if (job.state === 'completed' && (!ref || !same(job.resultRef, ref))) rejectJob('result_ack_mismatch');
    return { status: ref ? job.state === 'completed' ? 'acknowledged' : 'saved-unacknowledged' : row.etag === plan.expectedETag ? 'not-observed' : 'blocked-uncertain', resultRef: ref };
  }
  async function commitInbox({ proof }) {
    const job = jobs.get(proof.jobId, scope);
    if (job.state === 'completed') return inspect({ jobId: job.id });
    const guard = () => jobs.command({ type: 'guard', proof });
    guard();
    const plan = planFor(job);
    let row = await snapshot(plan); guard();
    let ref = retained(row, plan, job);
    if (!ref) {
      if (row.etag !== plan.expectedETag) return { status: 'blocked-uncertain', reason: 'original_revision_changed', resultRef: null };
      if (plan.kind === 'portfolio') validatePortfolioDecisionSync(plan.body.decision, { expectedDigest: plan.body.decision.decisionDigest });
      else await previewResearchWorkBrief(row.state, plan.body);
      guard();
      const bounds = await windows(job, guard);
      await checkpoint('before-save'); guard(); current(bounds);
      // No response is evidence until the native receipt and record are read back.
      // An exception can mean the native commit succeeded but delivery was lost.
      try { await nativeWorkspace.saveExact({ route: plan.route, body: structuredClone(plan.body), expectedETag: plan.expectedETag, idempotencyKey: plan.key }); } catch {}
      await checkpoint('after-save');
      row = await snapshot(plan);
      ref = retained(row, plan, job);
      if (!ref) return { status: 'blocked-uncertain', reason: 'save_not_confirmed', resultRef: null };
    }
    try {
      guard();
      const bounds = await windows(job, guard);
      await checkpoint('before-ack'); guard(); current(bounds);
      jobs.command({ type: 'commit', proof, inboxDigest: job.inbox.digest, resultRef: ref });
    } catch (error) {
      return { status: 'saved-unacknowledged', reason: typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : 'ack_unavailable', resultRef: ref };
    }
    await checkpoint('after-ack');
    return { status: 'acknowledged', resultRef: ref };
  }
  return Object.freeze({ inspect, commitInbox });
}
