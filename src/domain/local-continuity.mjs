import {retainedLocalKernelInitializations,stampLocalKernelInitialization} from './local-kernel-initialization.mjs';
import {retainedLocalGoalTransfers,stampLocalGoalTransfer} from './local-goal-transfer.mjs';
import {retainedSubmissionReviews,stampSubmissionReview} from './submission-review.mjs';
import {retainedPortfolioWork,stampPortfolioWork} from './portfolio-work-record.mjs';
import {retainedResearchWork,stampResearchWork} from './research-work-record.mjs';
import {saveResearchBrief} from './research-briefs.mjs';
/** Local installation continuity. Import is unverified data, never authentication or financial authority. */
import { createHash, randomUUID } from 'node:crypto';
import { ApiError, assertSafeJson, createDefaultState, createReview, updateClientState, normalizeWorkspaceDrafts, clone } from './angbao.mjs';
import { retainedResearchBriefs } from './research-briefs.mjs';
import { retainedReviewFeedback } from './review-feedback.mjs';
export const LOCAL_MANIFEST_LIMIT = 1024 * 1024;
export const LOCAL_CLAIM_LIMIT = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_FIELDS = ['workspace', 'inputMode', 'goals', 'cash', 'rules', 'agentConnected', 'onboardingDone', 'installedStrategies', 'strategyDrafts', 'schedule'];
const HISTORY_FIELDS = ['reviewRuns', 'reviewDecisions', 'reviewFeedback', 'researchBriefs'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (message, code = 'invalid_local_manifest', status = 400) => {
    throw new ApiError(status, code, message);
};
function exact(value, keys) {
    if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
        fail('This local export has missing or unsupported fields. Download a fresh export from Angbao.');
    }
}
function uuid(value) {
    if (typeof value !== 'string' || !UUID.test(value) || value !== value.toLowerCase()) {
        fail('Local IDs must be lowercase UUIDs. Download a fresh export rather than editing its IDs.');
    }
    return value;
}
function date(value) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
        fail('The export contains an invalid timestamp. Restore the original export or download a fresh one.');
    }
    return value;
}
function safeId(value, max = 100) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value.length > max || ['constructor', 'prototype', '__proto__'].includes(value)) {
        fail('Record IDs must start with a letter or number and contain only letters, numbers, hyphens or underscores. Reserved names are not allowed.');
    }
    return value;
}
function goalId(value) {
    if(typeof value!=='string'||!value||value.length>100||['constructor','prototype','__proto__'].includes(value)) {
        fail('Goal IDs must contain 1 to 100 characters and cannot use reserved names.');
    }
    return value;
}
function list(value, max) {
    if (!Array.isArray(value) || value.length > max) {
        fail('A list in this export exceeds the import limit. Keep the original file; this copy cannot be imported.');
    }
    return value;
}
function noSecrets(value) {
    if (typeof value === 'string' && /-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_[A-Za-z0-9_-]+|\babp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i.test(value)) {
        fail('Remove passwords, access tokens and keys from the local data before exporting it again.');
    }
    if (value && typeof value === 'object') {
        for (const item of Object.values(value))
            noSecrets(item);
    }
}
export function canonicalLocalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalLocalJson).join(',')}]`;
    }
    if (plain(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalLocalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
export function localDigest(value) {
    return createHash('sha256').update(canonicalLocalJson(value)).digest('hex');
}
export function mappedLocalId(installationId, kind, id) {
    const h = localDigest([installationId, kind, id]).slice(0, 32).split('');
    h[12] = '5';
    h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
    const s = h.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function ensureLocalContinuity(state, now = new Date()) {
    const next = clone(state);
    if (next.localInstallation === undefined) {
        next.localInstallation = {
            schema: 'angbao-local-installation@1', id: randomUUID(), createdAt: now.toISOString()
        };
    }
    exact(next.localInstallation, ['schema', 'id', 'createdAt']);
    if (next.localInstallation.schema !== 'angbao-local-installation@1') {
        fail('This installation record uses an unsupported format. Update Angbao before opening it.');
    }
    uuid(next.localInstallation.id);
    date(next.localInstallation.createdAt);
    if (next.localRevision === undefined) {
        next.localRevision = 0;
    }
    if (!Number.isSafeInteger(next.localRevision) || next.localRevision < 0) {
        fail('The local workspace version is invalid. Keep the original file and restore a valid copy.');
    }
    if (next.localReplayReceipts === undefined) {
        next.localReplayReceipts = [];
    }
    if (!Array.isArray(next.localReplayReceipts) || next.localReplayReceipts.length > 64) {
        fail('Saved request history is invalid. Keep the original local file and restore a valid copy.');
    }
    return next;
}
export function localCapabilities(state) {
    return {
        installation: clone(state.localInstallation), revision: state.localRevision, etag: `"${state.localRevision}"`, authenticated: false, accountRequired: false, capabilities: {
            cashReview: true, researchMemory: true, portfolioProposals:true, ownerTransferHistory:true, portfolioArchive:true, researchPortfolio:true, providerReads: false, financialAuthority: false
        }, sync: false
    };
}
function pick(value, keys) {
    return Object.fromEntries(keys.map(key => [key, clone(value[key])]));
}
function stripGrant(record) {
    const { agentAccess, ...result } = record;
    return result;
}
export function createLocalManifest(state, now = new Date()) {
    if(state.portfolioArchive?.entries.length)throw new ApiError(409,'archive_export_required','This workspace includes archived proposals. Export the workspace and its portfolio-history bundle; the older setup-import format cannot include this archive.');
    const local = ensureLocalContinuity(state, now), normalized = normalizeWorkspaceDrafts(local);
    const manifest = {
        format: 'angbao-local-claim', version: local.kernelInitializations!==undefined?5:local.submissionReviews!==undefined?4:local.portfolioWorks!==undefined?3:local.researchMethodWorks!==undefined||local.researchBriefs?.some(item=>item.methodRunRef)?2:1, installation: pick(local.localInstallation, ['id', 'createdAt']), exportedAt: now.toISOString(), sourceRevision: local.localRevision, workspace: pick(normalized, WORKSPACE_FIELDS), history: pick(normalized, HISTORY_FIELDS)
    };
    if(manifest.version>=2)manifest.history.researchMethodWorks=retainedResearchWork(local);
    if(manifest.version>=3)manifest.history.portfolioWorks=retainedPortfolioWork(local);
    if(manifest.version>=5)manifest.history.kernelInitializations=retainedLocalKernelInitializations(local);
    if(manifest.version>=4){manifest.history.submissionReviews=retainedSubmissionReviews(local);manifest.history.goalTransfers=retainedLocalGoalTransfers(local);}
    // Recurrence is not a portable permission; the chosen cadence remains useful.
    manifest.workspace.schedule.enabled = false;
    manifest.history.reviewRuns = manifest.history.reviewRuns.map(stripGrant);
    manifest.history.researchBriefs = manifest.history.researchBriefs.map(brief => ({
        ...stripGrant(brief), source: brief.source === 'personal-agent-token' ? 'headless-cli' : brief.source
    }));
    manifest.digest = manifestDigest(manifest);
    return validateLocalManifest(manifest);
}
function manifestDigest(manifest) {
    const { digest, exportedAt, ...content } = manifest;
    return localDigest(content);
}
function checkedWorkspace(input) {
    exact(input, WORKSPACE_FIELDS);
    exact(input.workspace, ['id', 'name', 'mode']);
    safeId(input.workspace.id);
    if (input.workspace.mode !== 'single') {
        fail('Import one personal workspace at a time.');
    }
    exact(input.cash, ['available', 'upcomingBills', 'monthlyIncome', 'monthlyExpenses', 'currency']);
    exact(input.rules, ['reserve', 'maxSuggestion']);
    exact(input.schedule, ['enabled', 'cadence']);
    if (input.schedule.enabled !== false) {
        fail('Imports cannot enable scheduled reviews. Download a fresh local export.');
    }
    for (const goal of list(input.goals, 50)) {
        exact(goal, ['id', 'name', 'targetAmount', 'currentAmount', 'monthlyContribution', 'currency']);
        goalId(goal.id);
    }
    const base = createDefaultState();
    const result = updateClientState(base, input);
    result.installedStrategies = result.installedStrategies.map((normalized, index) => {
        const original = input.installedStrategies[index];
        exact(original, ['id', 'name', 'version', 'manifestVersion', 'installationId', 'installedAt', 'settings', 'licence', 'requestedScopes', 'financialAuthority']);
        uuid(original.installationId);
        date(original.installedAt);
        const expected = {
            ...normalized, installationId: original.installationId, installedAt: original.installedAt
        };
        if (canonicalLocalJson(original) !== canonicalLocalJson(expected)) {
            fail('An installed strategy does not match its built-in version. Download an unchanged export with a supported strategy version.');
        }
        return expected;
    });
    if (new Set(result.installedStrategies.map(item => item.installationId)).size !== result.installedStrategies.length) {
        fail('Two installed strategies share an ID. Restore their original IDs before importing.');
    }
    result.workspace.id = input.workspace.id;
    // Stored drafts validate and preserve original timestamps rather than recreating onboarding.
    result.strategyDrafts = normalizeWorkspaceDrafts({
        ...base, strategyDrafts: input.strategyDrafts
    }).strategyDrafts;
    for (const draft of result.strategyDrafts) {
        safeId(draft.id);
        for (const block of draft.blocks)
            safeId(block.id);
    }
    const checked=pick(result,WORKSPACE_FIELDS);
    if(canonicalLocalJson(checked)!==canonicalLocalJson(input))fail('These settings differ from their saved format. Download a fresh local export without editing it.');
    return checked;
}
function checkedReview(review) {
    if (!plain(review)) {
        fail('The export contains an invalid review. Restore the original saved review before importing.');
    }
    safeId(review.id);
    date(review.createdAt);
    if (!['headless-cli', 'manual-gui', 'managed-demo', 'site-mcp-owner', 'personal-agent-token'].includes(review.source) || typeof review.managed !== 'boolean') {
        fail('A review has invalid source details. Restore its original saved version.');
    }
    const snapshot = review.contextSnapshot, policy = review.policySnapshot;
    if (!plain(snapshot) || !plain(policy) || !plain(review.strategy)) {
        fail('This review is missing the saved inputs or rules needed for import. Keep the original local copy.');
    }
    exact(snapshot, ['schemaVersion', 'goal', 'cash', 'provenance']);
    exact(policy, ['schemaVersion', 'rules', 'financialAuthority']);
    exact(snapshot.goal, ['id', 'name', 'targetAmount', 'currentAmount', 'monthlyContribution', 'currency']);
    goalId(snapshot.goal.id);
    exact(snapshot.cash, ['available', 'upcomingBills', 'monthlyIncome', 'monthlyExpenses', 'currency']);
    exact(policy.rules, ['reserve', 'maxSuggestion']);
    exact(review.strategy, ['id', 'version', 'manifestVersion', 'runtime', 'settings', 'installationId']);
    if (review.strategy.installationId !== null) {
        uuid(review.strategy.installationId);
    }
    const context = updateClientState(createDefaultState(new Date(review.createdAt)), {
        inputMode: review.inputMode, goals: [snapshot.goal], cash: snapshot.cash, rules: policy.rules
    });
    const generated = createReview(context, {
        strategy: pick(review.strategy, ['id', 'version', 'settings'])
    }, new Date(review.createdAt)).review;
    generated.id = review.id;
    generated.source = review.source;
    generated.managed = review.managed;
    generated.strategy.installationId = review.strategy.installationId;
    generated.recordRefs.context.id = `${review.id}:context`;
    generated.recordRefs.policy.id = `${review.id}:policy`;
    if (review.repeatOfReviewId !== undefined) {safeId(review.repeatOfReviewId);if(review.repeatOfReviewId===review.id)fail('A review cannot repeat itself. Restore the original export.');generated.repeatOfReviewId=review.repeatOfReviewId;}
    // Regeneration verifies every field, known pin, snapshot, value and reference; no arbitrary history objects.
    if (canonicalLocalJson(generated) !== canonicalLocalJson(review)) {
        fail('A review no longer matches its saved inputs and rules. Restore an unchanged export before importing.');
    }
    return clone(review);
}
export function validateLocalManifest(manifest) {
    assertSafeJson(manifest);
    noSecrets(manifest);
    exact(manifest, ['format', 'version', 'installation', 'exportedAt', 'sourceRevision', 'workspace', 'history', 'digest']);
    if (manifest.format !== 'angbao-local-claim' || ![1,2,3,4,5].includes(manifest.version)) {
        fail('This export uses an unsupported format. Update Angbao and download a fresh export.');
    }
    exact(manifest.installation, ['id', 'createdAt']);
    uuid(manifest.installation.id);
    date(manifest.installation.createdAt);
    date(manifest.exportedAt);
    if (!Number.isSafeInteger(manifest.sourceRevision) || manifest.sourceRevision < 0) {
        fail('The export has an invalid workspace version. Download a fresh local export.');
    }
    if (typeof manifest.digest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.digest) || manifest.digest !== manifestDigest(manifest)) {
        fail('This export has changed since it was created. Download a fresh copy before importing.');
    }
    if (Buffer.byteLength(JSON.stringify(manifest)) > LOCAL_MANIFEST_LIMIT) {
        fail('This export exceeds the 1 MiB import limit. Keep the original copy; it has not been imported.', 'local_manifest_too_large', 413);
    }
    const workspace = checkedWorkspace(manifest.workspace);
    exact(manifest.history, [...HISTORY_FIELDS,...(manifest.version>=2?['researchMethodWorks']:[]),...(manifest.version>=3?['portfolioWorks']:[]),...(manifest.version>=4?['submissionReviews','goalTransfers']:[]),...(manifest.version>=5?['kernelInitializations']:[])]);
    const reviews = list(manifest.history.reviewRuns, 100).map(checkedReview), ids = new Set(reviews.map(review => review.id));
    if (ids.size !== reviews.length) {
        fail('Two reviews share an ID. Restore their original IDs before importing.');
    }
    for(const [index,review] of reviews.entries()){
        if(review.repeatOfReviewId===undefined)continue;
        const position=reviews.findIndex(item=>item.id===review.repeatOfReviewId);
        if(position<0)continue; // Pruned baselines remain explicitly unavailable.
        const previous=reviews[position];
        if(position<=index||review.goalId!==previous.goalId||review.inputMode!==previous.inputMode||review.currency!==previous.currency||review.strategy.id!==previous.strategy.id||review.strategy.version!==previous.strategy.version||canonicalLocalJson(review.strategy.settings)!==canonicalLocalJson(previous.strategy.settings))fail('A repeat refers to an incompatible or later review. Restore its original comparison reference.');
    }
    if (!plain(manifest.history.reviewDecisions) || Object.keys(manifest.history.reviewDecisions).length > 100) {
        fail('The saved review decisions are invalid. Restore the original export before importing.');
    }
    for (const [id, value] of Object.entries(manifest.history.reviewDecisions)) {
        if (!ids.has(id)) {
            fail('A decision refers to a review missing from this export. Include that saved review before importing.');
        }
        exact(value, ['decision', 'nextCheck', 'savedAt']);
        date(value.savedAt);
        if (!['keep', 'watch', 'prepare'].includes(value.decision) || typeof value.nextCheck !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.nextCheck) || !Number.isFinite(Date.parse(value.nextCheck)) || new Date(value.nextCheck).toISOString().slice(0, 10) !== value.nextCheck) {
            fail('A saved review decision has an invalid choice or date. Restore the original export before importing.');
        }
    }
    const feedback = retainedReviewFeedback({
        reviewRuns: reviews, reviewFeedback: manifest.history.reviewFeedback
    });
    if (Object.keys(feedback).length !== Object.keys(manifest.history.reviewFeedback).length) {
        fail('Feedback refers to a review missing from this export. Include that saved review before importing.');
    }
    const briefs = retainedResearchBriefs({
        researchBriefs: manifest.history.researchBriefs
    });
    const retainedById = new Map(briefs.map(brief => [brief.id, brief]));
    const seriesVersions = new Set();
    for (const brief of briefs) {
        const seriesVersion = `${brief.seriesId}:${brief.version}`;
        if (seriesVersions.has(seriesVersion)) {
            fail('Two research briefs claim the same series/version. Restore their original saved versions before importing.');
        }
        seriesVersions.add(seriesVersion);
        for (const ref of [brief.previousVersionRef, brief.baseline?.reference].filter(Boolean)) {
            const target = retainedById.get(ref.id);
            if (target && (target.seriesId !== ref.seriesId || target.version !== ref.version)) {
                fail('A research reference does not match the saved version it names. Restore the original export.');
            }
        }
        const baselineTarget = brief.baseline && retainedById.get(brief.baseline.reference.id);
        if (baselineTarget) {
            const expectedSnapshot = {
                question: baselineTarget.question,
                answerPreview: baselineTarget.answer.slice(0, 500),
                createdAt: baselineTarget.createdAt,
                verification: 'unverified',
            };
            if (canonicalLocalJson(brief.baseline.snapshot) !== canonicalLocalJson(expectedSnapshot)) {
                fail('The research baseline snapshot differs from the saved version it refers to. Restore the original export.');
            }
        }
        const previous = brief.previousVersionRef;
        if (previous && (previous.id === brief.id || previous.seriesId !== brief.seriesId || previous.version !== brief.version - 1)) {
            fail('The previous-version reference must name the immediately preceding version in the same research series.');
        }
    }
    if(manifest.version===1&&briefs.some(item=>item.methodRunRef))fail('This method-linked export requires the supported version2 format. Keep the original work.');
    const works=manifest.version>=2?retainedResearchWork({researchMethodWorks:manifest.history.researchMethodWorks}):[];
    for(const brief of briefs){if(!brief.methodRunRef)continue;const work=works.find(item=>item.id===brief.methodRunRef.workId);if(work&&(work.briefId!==brief.id||work.completedAt===null||work.memory.authoredOutput===null||brief.methodRunRef.runId!==work.memory.run.runId||brief.methodRunRef.runDigest!==work.memory.run.runDigest))fail('The saved answer must link to its exact completed method work.');}
    for(const work of works){if(work.briefId===null)continue;const brief=briefs.find(item=>item.id===work.briefId);if(!brief)continue;
      if(brief.methodRunRef?.workId!==work.id||brief.methodRunRef.runId!==work.memory.run.runId||brief.methodRunRef.runDigest!==work.memory.run.runDigest)fail('The imported method and answer references differ.');
      const normalized=saveResearchBrief(createDefaultState(),work.memory.authoredOutput.brief).brief;
      // Imported records keep their import label; the original authored output remains provenance.
      if(brief.authorship!=='imported'&&normalized.authorship!==brief.authorship)fail('The imported method authorship differs from its linked saved answer.');
      for(const key of ['question','answer','evidence','claims','inferences','gaps'])if(canonicalLocalJson(normalized[key])!==canonicalLocalJson(brief[key]))fail('The imported method output differs from its linked saved answer.');
    }
    const portfolioWorks=manifest.version>=3?retainedPortfolioWork({portfolioWorks:manifest.history.portfolioWorks}):[];
    const submissionReviews=manifest.version>=4?retainedSubmissionReviews({portfolioWorks,submissionReviews:manifest.history.submissionReviews}):[];
    const goalTransfers=manifest.version>=4?retainedLocalGoalTransfers({portfolioWorks,submissionReviews,goalTransfers:manifest.history.goalTransfers}):[];
    const kernelInitializations=manifest.version>=5?retainedLocalKernelInitializations({kernelInitializations:manifest.history.kernelInitializations}):[];
    return {
        ...clone(manifest), workspace, history: {
            reviewRuns: reviews, reviewDecisions: clone(manifest.history.reviewDecisions), reviewFeedback: feedback, researchBriefs: briefs, ...(manifest.version>=2?{researchMethodWorks:works}:{}), ...(manifest.version>=3?{portfolioWorks}:{}), ...(manifest.version>=4?{submissionReviews,goalTransfers}:{}), ...(manifest.version>=5?{kernelInitializations}:{})
        }
    };
}
function claimLedger(state) {
    if (state.localClaims === undefined) {
        return {
            schema: 'angbao-local-claims@1', records: []
        };
    }
    if (!plain(state.localClaims) || state.localClaims.schema !== 'angbao-local-claims@1' || !Array.isArray(state.localClaims.records) || state.localClaims.records.length > LOCAL_CLAIM_LIMIT) {
        fail('Your saved import history is unavailable. Try again later and keep the local copy.', 'local_claim_ledger_invalid', 503);
    }
    return clone(state.localClaims);
}
function appendUnique(existing, incoming, limit, label) {
    const merged = clone(existing ?? []);
    let added = 0, duplicates = 0;
    for (const record of incoming) {
        const previous = merged.find(item => item.id === record.id);
        if (previous) {
            if (canonicalLocalJson(previous) !== canonicalLocalJson(record)) {
                fail(`An imported ${label} ID already contains different data. Keep both copies and resolve the conflict before importing.`, 'local_claim_collision', 409);
            }
            duplicates++;
        }
        else {
            merged.push(record);
            added++;
        }
    }
    if (merged.length > limit) {
        fail(`This import would exceed the saved ${label} limit. Keep the local export and resolve the history limit before trying again. Nothing was imported.`, 'local_claim_capacity', 409);
    }
    return {
        records: merged, added, duplicates
    };
}
/** Pure, deterministic merge. Caller performs owner-bound atomic CAS and persists returned ledger. */
export function mergeLocalManifest(current, input, { ownerId, settingsPolicy, now = new Date() } = {}) {
    if (typeof ownerId !== 'string' || !UUID.test(ownerId)) {
        fail('Sign in to the account where you want to import this setup.', 'authentication_required', 401);
    }
    if (!['replace-settings', 'keep-hosted'].includes(settingsPolicy)) {
        fail('Choose whether to use local settings (replace-settings) or keep account settings (keep-hosted).');
    }
    const manifest = validateLocalManifest(input), source = manifest.installation.id, map = (kind, id) => mappedLocalId(source, kind, id), claimId = map('claim', manifest.digest), ledger = claimLedger(current);
    const previous = ledger.records.find(record => record.id === claimId);
    if (previous) {
        if (previous.ownerId !== ownerId || previous.manifestDigest !== manifest.digest || previous.settingsPolicy !== settingsPolicy) {
            fail('This import was confirmed for another account or settings choice. Preview it again in the intended account.', 'local_claim_conflict', 409);
        }
        return {
            state: clone(current), claim: clone(previous), replayed: true
        };
    }
    if (ledger.records.length >= LOCAL_CLAIM_LIMIT) {
        fail('Your saved import history is full. Keep the local copy and resolve earlier imports before adding another.', 'local_claim_capacity', 409);
    }
    const mapping = {
        reviews: {}, researchBriefs: {}, researchSeries: {}, goals: {}, installations: {}, drafts: {}, blocks: {}, ...(manifest.version>=2?{researchMethodWorks:{}}:{}), ...(manifest.version>=3?{portfolioWorks:{}}:{}), ...(manifest.version>=4?{submissionReviews:{},goalTransfers:{}}:{}), ...(manifest.version>=5?{kernelInitializations:{}}:{})
    };
    const mapped = (kind, id) => {
        const bucket = mapping[kind];
        return Object.hasOwn(bucket, id) ? bucket[id] : (bucket[id] = map(kind, id));
    };
    const workspace = clone(manifest.workspace);
    workspace.goals = workspace.goals.map(goal => ({
        ...goal, id: mapped('goals', goal.id)
    }));
    workspace.installedStrategies = workspace.installedStrategies.map(item => ({
        ...item, installationId: mapped('installations', item.installationId)
    }));
    workspace.strategyDrafts = workspace.strategyDrafts.map(draft => {
        const blocks = {};
        mapping.blocks[draft.id] = blocks;
        return {
            ...draft, id: mapped('drafts', draft.id), blocks: draft.blocks.map(block => {
                const id = map('blocks', `${draft.id}:${block.id}`);
                blocks[block.id] = id;
                return {
                    ...block, id
                };
            })
        };
    });
    const reviews = manifest.history.reviewRuns.map(record => {
        const review = clone(record);
        review.id = mapped('reviews', record.id);
        if(record.repeatOfReviewId!==undefined)review.repeatOfReviewId=mapped('reviews',record.repeatOfReviewId);
        review.goalId = mapped('goals', record.goalId);
        review.contextSnapshot.goal.id = mapped('goals', record.contextSnapshot.goal.id);
        review.strategy.installationId = record.strategy.installationId === null ? null : mapped('installations', record.strategy.installationId);
        review.recordRefs.context.id = `${review.id}:context`;
        review.recordRefs.policy.id = `${review.id}:policy`;
        review.source = 'headless-cli';
        review.managed = false;
        return review;
    });
    const reference = ref => ref === null ? null : {
        ...ref, id: mapped('researchBriefs', ref.id), seriesId: mapped('researchSeries', ref.seriesId)
    };
    const briefs = manifest.history.researchBriefs.map(record => ({
        ...clone(record), ...(record.methodRunRef?{methodRunRef:{...record.methodRunRef,workId:mapped('researchMethodWorks',record.methodRunRef.workId)}}:{}), id: mapped('researchBriefs', record.id), seriesId: mapped('researchSeries', record.seriesId), authorship: 'imported', source: 'headless-cli', verification: 'unverified', previousVersionRef: reference(record.previousVersionRef), baseline: record.baseline ? {
            ...clone(record.baseline), reference: reference(record.baseline.reference)
        } : null
    }));
    const mergedReviews = appendUnique(current.reviewRuns, reviews, 100, 'review'), mergedBriefs = appendUnique(current.researchBriefs, briefs, 20, 'research brief');
    let state = clone(current);
    if (settingsPolicy === 'replace-settings') {
        // Validate through the usual client boundary, then preserve portable IDs/timestamps and prior history.
        state = updateClientState(state, {
            ...workspace, workspace: {
                ...workspace.workspace, id: state.workspace.id
            }
        }, now);
        state.installedStrategies = workspace.installedStrategies;
        state.strategyDrafts = workspace.strategyDrafts;
    }
    state.reviewRuns = mergedReviews.records;
    state.researchBriefs = mergedBriefs.records;
    if(manifest.version>=2){const works=manifest.history.researchMethodWorks.map(work=>stampResearchWork({...clone(work),id:mapped('researchMethodWorks',work.id),briefId:work.briefId===null?null:mapped('researchBriefs',work.briefId),source:'headless-cli'}));state.researchMethodWorks=appendUnique(current.researchMethodWorks,works,8,'research method work').records;}
    if(manifest.version>=3){const works=manifest.history.portfolioWorks.map(work=>stampPortfolioWork({...clone(work),id:mapped('portfolioWorks',work.id),previousWorkRef:work.previousWorkRef?{...work.previousWorkRef,id:mapped('portfolioWorks',work.previousWorkRef.id)}:null,source:'headless-cli'}));state.portfolioWorks=appendUnique(current.portfolioWorks,works,5,'portfolio proposal').records;retainedPortfolioWork(state);}
    if(manifest.version>=4){const records=manifest.history.submissionReviews.map(record=>stampSubmissionReview({...clone(record),id:mapped('submissionReviews',record.id),localWorkId:mapped('portfolioWorks',record.localWorkId),imported:true}));state.submissionReviews=appendUnique(current.submissionReviews,records,10,'submission review').records;retainedSubmissionReviews(state);}
    if(manifest.version>=4){const records=manifest.history.goalTransfers.map(record=>stampLocalGoalTransfer({...clone(record),id:mapped('goalTransfers',record.id),localWorkId:mapped('portfolioWorks',record.localWorkId),localReviewId:mapped('submissionReviews',record.localReviewId),imported:true}));state.goalTransfers=appendUnique(current.goalTransfers,records,10,'test transfer').records;retainedLocalGoalTransfers(state);}
    if(manifest.version>=5){const records=manifest.history.kernelInitializations.map(record=>stampLocalKernelInitialization({...clone(record),id:mapped('kernelInitializations',record.id),imported:true}));state.kernelInitializations=appendUnique(current.kernelInitializations,records,5,'test account setup').records;retainedLocalKernelInitializations(state);}
    for (const kind of ['reviewDecisions', 'reviewFeedback']) {
        state[kind] = {
            ...(state[kind] ?? {})
        };
        for (const [id, value] of Object.entries(manifest.history[kind])) {
            const key = mapped('reviews', id);
            if (state[kind][key] && canonicalLocalJson(state[kind][key]) !== canonicalLocalJson(value)) {
                fail('A review decision or feedback entry already contains different data. Keep both copies and resolve the conflict before importing.', 'local_claim_collision', 409);
            }
            state[kind][key] = clone(value);
        }
    }
    const claim = {
        id: claimId, ownerId, manifestDigest: manifest.digest, sourceInstallationId: source, sourceRevision: manifest.sourceRevision, sourceCreatedAt: manifest.installation.createdAt, claimedAt: now.toISOString(), settingsPolicy, verification: 'imported-unverified', financialAuthority: false, oneTimeImport: true, sync: false, mapping, counts: {
            reviews: {
                added: mergedReviews.added, duplicates: mergedReviews.duplicates
            }, researchBriefs: {
                added: mergedBriefs.added, duplicates: mergedBriefs.duplicates
            }, ...(manifest.version>=3?{portfolioWorks:{retained:state.portfolioWorks.length,imported:manifest.history.portfolioWorks.length}}:{})
        }, provenance: {
            reviewSources: Object.fromEntries(manifest.history.reviewRuns.map(record => [record.id, {
                    source: record.source, managed: record.managed, createdAt: record.createdAt
                }])), researchSources: Object.fromEntries(manifest.history.researchBriefs.map(record => [record.id, {
                    source: record.source, authorship: record.authorship, createdAt: record.createdAt
                }]))
        }
    };
    ledger.records.push(claim);
    state.localClaims = ledger;
    state.updatedAt = now.toISOString();
    if(manifest.version>=3)createLocalManifest(state,now);
    if (Buffer.byteLength(JSON.stringify(state)) > 1900 * 1024) {
        fail('This import would fill your account\'s storage. Keep the local copy and resolve the storage limit before importing.', 'local_claim_capacity', 409);
    }
    return {
        state, claim, replayed: false
    };
}
export function findLocalClaim(state, id, ownerId) {
    uuid(id);
    const record = claimLedger(state).records.find(value => value.id === id && value.ownerId === ownerId);
    if (!record) {
        fail('This import was not found in your account. Check the account and preview the local export again.', 'local_claim_not_found', 404);
    }
    return record;
}
