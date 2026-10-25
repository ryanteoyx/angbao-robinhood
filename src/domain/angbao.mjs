/** Portable sample-money domain. No account access, signing, payment or scheduler. */
import { recipes, strategyManifests, DEFAULT_STRATEGY } from "../../ui/catalog.mjs";
import { normalizeCompositionDrafts, CompositionDraftError } from './composition-drafts.mjs';
import { recordReviewFeedback, retainedReviewFeedback, ReviewFeedbackError } from './review-feedback.mjs';
import {retainedLocalKernelInitializations} from './local-kernel-initialization.mjs';
import {retainedLocalGoalTransfers} from './local-goal-transfer.mjs';
import {retainedSubmissionReviews} from './submission-review.mjs';
import {retainedPortfolioWork,copyPortfolioArchive} from './portfolio-work-record.mjs';
import { retainedResearchBriefs, ResearchBriefError } from './research-briefs.mjs';

const PROTECTED = new Set(["entitlements", "financialPermissions", "reviewRuns", "reviewFeedback", "researchBriefs", "researchMethodWorks", "portfolioWorks", "portfolioArchive", "submissionReviews", "goalTransfers", "kernelInitializations", "strategies", "demo", "updatedAt", "localInstallation", "localRevision", "localReplayReceipts", "localClaims"]);
const CLIENT_FIELDS = new Set(['workspace', 'inputMode', 'goals', 'cash', 'rules', 'agentConnected', 'onboardingDone', 'installedStrategies', 'strategyDrafts', 'schedule', 'reviewDecisions']);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const FREE_PERMISSIONS = Object.freeze({ readOnly: true, executionEnabled: false, delegationEnabled: false, tradingEnabled: false, authorizedSpend: 0 });

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function isoNow(now = new Date()) { return now.toISOString(); }
export function clone(value) { const result=structuredClone(value);return value&&typeof value==='object'&&!Array.isArray(value)?copyPortfolioArchive(value,result):result; }
function cents(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new ApiError(400, 'invalid_money', `Enter a number from 0 to 1 billion for ${field}.`);
  return Math.round((value + Number.EPSILON) * 100);
}
function dollars(value) { return Number((value / 100).toFixed(2)); }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function strategyManifest(reference) {
  if (!plainObject(reference) || typeof reference.id !== 'string' || typeof reference.version !== 'string') throw new ApiError(400, 'invalid_strategy', 'Choose a built-in strategy and its exact version.');
  const manifest = strategyManifests.find(item => item.id === reference.id && item.version === reference.version);
  if (!manifest) throw new ApiError(400, 'unknown_strategy_version', 'This strategy version is unavailable. Choose one from the strategy list.');
  return manifest;
}

/** Settings can only tighten the personal reserve/cap; authority is not a setting. */
function strategySettings(manifest, input = {}) {
  if (!plainObject(input)) throw new ApiError(400, 'invalid_strategy_settings', 'Strategy settings must be a JSON object.');
  assertSafeJson(input);
  const settings = clone(manifest.defaultSettings);
  for (const [key, value] of Object.entries(input)) {
    const schema = manifest.settingsSchema.properties[key];
    if (!schema || !Object.hasOwn(manifest.settingsSchema.properties, key)) throw new ApiError(400, 'unsupported_strategy_setting', `This strategy version does not support ${key}. Remove that setting and try again.`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum || (schema.type === 'integer' && !Number.isInteger(value))) throw new ApiError(400, 'invalid_strategy_settings', `Use ${schema.type} values from ${schema.minimum} to ${schema.maximum} for ${key}.`);
    settings[key] = schema.unit === 'workspace-currency' ? dollars(cents(value, `settings.${key}`)) : value;
  }
  return settings;
}

function draftStrategies(input, options = {}) {
  try {
    return normalizeCompositionDrafts(input, { ...options, validateStrategy(reference) {
      const manifest = strategyManifest(reference);
      return { id: manifest.id, version: manifest.version, settings: strategySettings(manifest, reference.settings) };
    } });
  } catch (error) {
    if (error instanceof CompositionDraftError) throw new ApiError(400, error.code, error.message);
    throw error;
  }
}

/** Legacy missing drafts are [], while corrupt present drafts fail rather than disappear. */
export function normalizeWorkspaceDrafts(state) {
  const inputMode = financeInputMode(state);
  let researchBriefs;try{researchBriefs=retainedResearchBriefs(state);}catch(error){if(error instanceof ResearchBriefError)throw new ApiError(error.status,error.code,error.message);throw error;}
  return copyPortfolioArchive(state,{ ...state, ...(state.kernelInitializations!==undefined?{kernelInitializations:retainedLocalKernelInitializations(state)}:{}), ...(state.goalTransfers!==undefined?{goalTransfers:retainedLocalGoalTransfers(state)}:{}), ...(state.submissionReviews!==undefined?{submissionReviews:retainedSubmissionReviews(state)}:{}), ...(state.portfolioWorks!==undefined?{portfolioWorks:retainedPortfolioWork(state)}:{}), researchBriefs, inputMode, demo: inputMode === 'manual' ? { ...state.demo, fixtureData: false, realPayments: false, realTransfers: false, message: 'Your financial inputs are unverified. No financial accounts are connected and no money will move.' } : state.demo, strategyDrafts: draftStrategies(state.strategyDrafts, { stored: true }), reviewFeedback: feedbackRecords(state) });
}

function financeInputMode(state) {
  const mode = state.inputMode === undefined ? 'sample' : state.inputMode;
  if (!['sample', 'manual'].includes(mode)) throw new ApiError(400, 'invalid_input_mode', 'Choose sample data or your own inputs (manual).');
  return mode;
}

function feedbackRecords(state) {
  try { return retainedReviewFeedback(state); }
  catch (error) { if (error instanceof ReviewFeedbackError) throw new ApiError(400, error.code, error.message); throw error; }
}

export function submitReviewFeedback(current, input, now = new Date()) {
  assertSafeJson(input);
  let recorded;
  try { recorded = recordReviewFeedback(current, input, now); }
  catch (error) { if (error instanceof ReviewFeedbackError) throw new ApiError(400, error.code, error.message); throw error; }
  const next = clone(current);
  next.reviewFeedback = recorded.reviewFeedback;
  next.financialPermissions = clone(FREE_PERMISSIONS);
  next.updatedAt = isoNow(now);
  return { reviewId: recorded.reviewId, feedback: recorded.feedback, state: next };
}

function selectedStrategy(state, input) {
  const reference = input === undefined ? DEFAULT_STRATEGY : input;
  const manifest = strategyManifest(reference);
  if (input !== undefined && Object.keys(input).some(key => !['id', 'version', 'settings'].includes(key))) throw new ApiError(400, 'invalid_strategy', 'Send only id, version and settings for the chosen strategy.');
  const installation = input === undefined ? null : state.installedStrategies?.find(item => item.id === manifest.id && item.version === manifest.version);
  const settings = strategySettings(manifest, Object.hasOwn(reference, 'settings') ? reference.settings : installation?.settings ?? {});
  return { manifest, settings, installationId: installation?.installationId ?? null };
}

export function assertSafeJson(value, depth = 0) {
  if (depth > 14) throw new ApiError(400, 'invalid_state', 'This JSON has too many nested levels. Simplify it and try again.');
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new ApiError(400, 'invalid_state', 'A list contains more than 1,000 items. Shorten it and try again.');
    value.forEach(item => assertSafeJson(item, depth + 1));
  } else if (plainObject(value)) {
    if (Object.keys(value).length > 250) throw new ApiError(400, 'invalid_state', 'A JSON object contains more than 250 fields. Remove extra fields and try again.');
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new ApiError(400, 'unsafe_key', `The field ${key} is not accepted.`);
      assertSafeJson(item, depth + 1);
    }
  } else if (typeof value === 'string' && value.length > 40_000) throw new ApiError(400, 'invalid_state', 'A text field exceeds 40,000 characters. Shorten it and try again.');
  else if (typeof value === 'number' && !Number.isFinite(value)) throw new ApiError(400, 'invalid_state', 'Enter ordinary numbers; Infinity and NaN are not accepted.');
}

export function createDefaultState(now = new Date()) {
  return {
    workspace: { id: 'demo-personal', name: 'Your workspace', mode: 'single' },
    inputMode: 'sample',
    demo: { enabled: true, fixtureData: true, singleWorkspace: true, realPayments: false, realTransfers: false, message: 'Sample financial data. No financial accounts are connected and no money will move.' },
    goals: [{ id: 'emergency-fund', name: 'Emergency fund', targetAmount: 5000, currentAmount: 1200, monthlyContribution: 300, currency: 'USD' }],
    cash: { available: 4200, upcomingBills: 900, monthlyIncome: 4500, monthlyExpenses: 3100, currency: 'USD' },
    rules: { reserve: 2500, maxSuggestion: 150 },
    agentConnected: false,
    onboardingDone: false,
    installedStrategies: [],
    strategyDrafts: [],
    strategies: clone(recipes),
    schedule: { enabled: false, cadence: 'weekly' },
    entitlements: { plan: 'free', status: 'free', billingMode: 'unavailable' },
    financialPermissions: clone(FREE_PERMISSIONS),
    reviewRuns: [],
    reviewDecisions: {},
    reviewFeedback: {},
    researchBriefs: [],
    updatedAt: isoNow(now),
  };
}

export function validateFinanceInputs(state) {
  if (!Array.isArray(state.goals) || !state.goals.length || state.goals.length > 50) throw new ApiError(400, 'invalid_goals', 'Add between 1 and 50 savings goals.');
  const seen = new Set();
  for (const goal of state.goals) {
    if (!plainObject(goal) || typeof goal.id !== 'string' || !goal.id || goal.id.length > 100 || seen.has(goal.id)) throw new ApiError(400, 'invalid_goal', 'Each goal needs a different text ID of 1 to 100 characters.');
    seen.add(goal.id);
    for (const key of ['targetAmount', 'currentAmount', 'monthlyContribution']) cents(goal[key], `goals.${key}`);
    if (typeof goal.name !== 'string' || !goal.name || goal.name.length > 200) throw new ApiError(400, 'invalid_goal', 'Give each goal a name of 1 to 200 characters.');
    if (goal.currency !== state.cash?.currency) throw new ApiError(400, 'currency_mismatch', 'Use the same currency for cash and every goal. Convert amounts before importing them.');
  }
  if (!plainObject(state.cash) || !/^[A-Z]{3}$/.test(state.cash.currency ?? '')) throw new ApiError(400, 'invalid_cash', 'Enter your cash amounts and a three-letter currency code, such as USD.');
  for (const key of ['available', 'upcomingBills', 'monthlyIncome', 'monthlyExpenses']) cents(state.cash[key], `cash.${key}`);
  if (!plainObject(state.rules)) throw new ApiError(400, 'invalid_rules', 'Enter a cash reserve and a maximum suggested contribution.');
  cents(state.rules.reserve, 'rules.reserve');
  cents(state.rules.maxSuggestion, 'rules.maxSuggestion');
}

/** Client preferences and sample data may change; commercial and finance authority are server-owned. */
export function updateClientState(current, input, now = new Date()) {
  if (!plainObject(input)) throw new ApiError(400, 'invalid_state', 'Send a JSON object with the fields for this request.');
  assertSafeJson(input);
  const next = clone(current);
  for (const [key, value] of Object.entries(input)) {
    if (PROTECTED.has(key)) continue;
    if (!CLIENT_FIELDS.has(key)) throw new ApiError(400, 'unsupported_field', `This request cannot change ${key}. Remove that field and try again.`);
    next[key] = clone(value);
  }
  next.inputMode = financeInputMode(next);
  if (next.inputMode !== financeInputMode(current) && !['cash', 'goals', 'rules'].every(key => Object.hasOwn(input, key))) throw new ApiError(400, 'complete_inputs_required', 'To switch between sample data and your own inputs, include all cash, goals and rules in one request.');
  // Identity here is a demo label, never authentication or a second person.
  if (!plainObject(next.workspace) || typeof next.workspace.name !== 'string' || !next.workspace.name.trim() || next.workspace.name.length > 120) throw new ApiError(400, 'invalid_workspace', 'Enter a workspace name of 1 to 120 characters.');
  next.workspace = { id: current.workspace.id, name: next.workspace.name.trim(), mode: 'single' };
  for (const field of ['agentConnected', 'onboardingDone']) if (typeof next[field] !== 'boolean') throw new ApiError(400, 'invalid_preference', `${field} must be true or false.`);
  if (!plainObject(next.schedule) || typeof next.schedule.enabled !== 'boolean') throw new ApiError(400, 'invalid_schedule', 'Set schedule.enabled to true or false.');
  if (!['weekly', 'daily', 'monthly'].includes(next.schedule.cadence)) throw new ApiError(400, 'invalid_schedule', 'Choose daily, weekly or monthly for the review schedule.');
  next.schedule = { enabled: next.schedule.enabled, cadence: next.schedule.cadence };
  validateFinanceInputs(next);
  // Accept only known input fields, never arbitrary nested authority or commercial data.
  next.goals = next.goals.map(goal => Object.fromEntries(['id', 'name', 'targetAmount', 'currentAmount', 'monthlyContribution', 'currency'].map(key => [key, goal[key]])));
  next.cash = Object.fromEntries(['available', 'upcomingBills', 'monthlyIncome', 'monthlyExpenses', 'currency'].map(key => [key, next.cash[key]]));
  next.rules = { reserve: next.rules.reserve, maxSuggestion: next.rules.maxSuggestion };
  if (!Array.isArray(next.installedStrategies) || next.installedStrategies.length > 50) throw new ApiError(400, 'invalid_strategy', 'Save up to 50 installed strategies.');
  const installed = new Set();
  next.installedStrategies = next.installedStrategies.map(item => {
    if (!plainObject(item)) throw new ApiError(400, 'invalid_strategy', 'Choose an ID and version for each installed strategy.');
    const manifest = strategyManifest(item);
    const recipe = recipes.find(recipe => recipe.id === manifest.id);
    if (installed.has(manifest.id)) throw new ApiError(400, 'invalid_strategy', 'Install each built-in strategy only once.');
    installed.add(manifest.id);
    const previous = current.installedStrategies?.find(previous => previous.id === manifest.id && previous.version === manifest.version);
    const settings = strategySettings(manifest, Object.hasOwn(item, 'settings') ? item.settings : previous?.settings ?? {});
    return { id: manifest.id, name: recipe.name, version: manifest.version, manifestVersion: manifest.manifestVersion, installationId: previous?.installationId || crypto.randomUUID(), installedAt: previous?.installedAt || isoNow(now), settings, licence: recipe.licence, requestedScopes: [...manifest.requestedScopes], financialAuthority: 'none' };
  });
  next.reviewDecisions = validateReviewDecisions(current, next.reviewDecisions ?? {}, now);
  next.strategyDrafts = draftStrategies(next.strategyDrafts, { previous: current.strategyDrafts ?? [], now });
  next.reviewFeedback = feedbackRecords(next);
  next.financialPermissions = clone(FREE_PERMISSIONS);
  next.demo = { ...current.demo, fixtureData: next.inputMode === 'sample', realPayments: false, realTransfers: false, ...(next.inputMode === 'manual' ? { message: 'Your financial inputs are unverified. No financial accounts are connected and no money will move.' } : financeInputMode(current) === 'manual' ? { message: 'Sample financial data. No financial accounts are connected and no money will move.' } : {}) };
  next.updatedAt = isoNow(now);
  return next;
}

function validateReviewDecisions(current, decisions, now) {
  if (!plainObject(decisions) || Object.keys(decisions).length > 100) throw new ApiError(400, 'invalid_decision', 'Add decisions only for reviews saved in this workspace (up to 100).');
  const result = {};
  for (const [reviewId, value] of Object.entries(decisions)) {
    if (!current.reviewRuns.some(review => review.id === reviewId)) throw new ApiError(400, 'review_not_found', 'This review is no longer saved in your workspace. Choose a saved review before adding a decision.');
    if (!plainObject(value) || !['keep', 'watch', 'prepare'].includes(value.decision)) throw new ApiError(400, 'invalid_decision', 'Choose Keep, Watch or Prepare (keep, watch or prepare in JSON).');
    if (typeof value.nextCheck !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.nextCheck) || Number.isNaN(Date.parse(`${value.nextCheck}T00:00:00Z`)) || new Date(`${value.nextCheck}T00:00:00Z`).toISOString().slice(0, 10) !== value.nextCheck) throw new ApiError(400, 'invalid_decision_date', 'Enter a valid next-check date in YYYY-MM-DD format.');
    const previous = current.reviewDecisions?.[reviewId];
    const unchanged = previous?.decision === value.decision && previous?.nextCheck === value.nextCheck;
    if (!unchanged && value.nextCheck < isoNow(now).slice(0, 10)) throw new ApiError(400, 'invalid_decision_date', 'Choose today or a future date for the next check.');
    result[reviewId] = { decision: value.decision, nextCheck: value.nextCheck, savedAt: unchanged ? previous.savedAt : isoNow(now) };
  }
  return result;
}

/** Pure calculation in integer cents. A suggestion is an explanation, never a transfer instruction. */
export function calculateSavingsReview(state, goalId = state.goals?.[0]?.id) {
  return calculateCashReview(state, goalId);
}

function calculateCashReview(state, goalId, limits = {}) {
  const inputMode = financeInputMode(state);
  validateFinanceInputs(state);
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal) throw new ApiError(404, 'goal_not_found', 'This savings goal is unavailable. Refresh your goals and choose one again.');
  const available = cents(state.cash.available, 'cash.available');
  const bills = cents(state.cash.upcomingBills, 'cash.upcomingBills');
  const reserve = cents(state.rules.reserve, 'rules.reserve') + (limits.extraReserve ?? 0);
  const maxSuggestion = cents(state.rules.maxSuggestion, 'rules.maxSuggestion');
  const current = cents(goal.currentAmount, 'goal.currentAmount');
  const target = cents(goal.targetAmount, 'goal.targetAmount');
  const remaining = Math.max(0, target - current);
  const safeSurplus = Math.max(0, available - bills - reserve);
  const suggested = Math.min(maxSuggestion, safeSurplus, remaining, limits.contributionCap ?? Infinity);
  const monthly = cents(goal.monthlyContribution, 'goal.monthlyContribution');
  const monthsToGoal = remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const status = remaining === 0 ? 'goal_met' : suggested > 0 ? 'optional_saving' : 'keep_cash';
  return {
    kind: 'savings', goalId: goal.id, goalName: goal.name, currency: goal.currency,
    outcome: status, decision: suggested > 0 ? 'Consider saving' : 'Keep your plan',
    suggestedContribution: dollars(suggested), safeSurplus: dollars(safeSurplus),
    availableCash: dollars(available), upcomingBills: dollars(bills), protectedReserve: dollars(reserve),
    cashAfterSuggestion: dollars(available - suggested), currentAmount: dollars(current), targetAmount: dollars(target),
    remainingToGoal: dollars(remaining), monthlyContribution: dollars(monthly), estimatedMonthsToGoal: monthsToGoal,
    monthlyCashFlow: dollars(cents(state.cash.monthlyIncome, 'cash.monthlyIncome') - cents(state.cash.monthlyExpenses, 'cash.monthlyExpenses')),
    formula: limits.formula ?? 'min(maximum suggestion, max(0, available cash − upcoming bills − reserve), remaining goal)',
    explanation: status === 'goal_met' ? `This ${inputMode === 'sample' ? 'sample ' : ''}goal is already funded. Keep your cash; no contribution is needed.` : suggested > 0 ? `An optional ${goal.currency} ${dollars(suggested).toFixed(2)} contribution fits your stated reserve, bills and suggestion limit. Nothing has moved.` : limits.observeOnly ? 'This strategy observes your plan without suggesting a new contribution. Keep, watch or prepare a later review; nothing has moved.' : 'Your reserve, upcoming bills, personal cap or selected strategy limit leave no room for a new contribution. Keeping cash is a complete review outcome.',
    assumptions: [inputMode === 'sample' ? 'Sample values supplied by the user; no live bank or broker feed.' : 'Your complete user-entered declaration is not independently verified; no live bank or broker feed.', 'Known bills are included; unknown liabilities and future expenses are not inferred.', 'Goal timing uses the stated monthly contribution and assumes no investment return.', 'Suggestion only. No transfer, trade, wallet signing or tax advice.'],
    actionExecuted: false, financialAuthorityGranted: false, inputMode, fixtureData: inputMode === 'sample', demo: inputMode === 'sample',
  };
}

function executeStrategy(state, goalId, selection) {
  const { manifest, settings } = selection;
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal) throw new ApiError(404, 'goal_not_found', 'This savings goal is unavailable. Refresh your goals and choose one again.');
  const limits = { extraReserve: cents(settings.extraReserve, 'settings.extraReserve') };
  if (settings.contributionCap !== undefined) limits.contributionCap = cents(settings.contributionCap, 'settings.contributionCap');
  let strategyCap;
  switch (manifest.runtime) {
    case 'cash-headroom@1': break;
    case 'positive-cashflow@1':
      strategyCap = Math.max(0, cents(state.cash.monthlyIncome, 'cash.monthlyIncome') - cents(state.cash.monthlyExpenses, 'cash.monthlyExpenses'));
      break;
    case 'periodic-goal@1':
      strategyCap = Math.floor(cents(goal.monthlyContribution, 'goal.monthlyContribution') / settings.periodsPerMonth);
      break;
    case 'observe-only@1': strategyCap = 0; limits.observeOnly = true; break;
    default: throw new ApiError(400, 'unsupported_strategy_runtime', 'This strategy cannot run here. Choose a supported built-in strategy.');
  }
  if (strategyCap !== undefined) limits.contributionCap = Math.min(limits.contributionCap ?? Infinity, strategyCap);
  if (limits.contributionCap !== undefined || limits.extraReserve) limits.formula = `min(personal suggestion cap, max(0, cash − bills − personal reserve − extra reserve), remaining goal${limits.contributionCap !== undefined ? ', strategy limit' : ''})`;
  const result = calculateCashReview(state, goalId, limits);
  if (limits.contributionCap !== undefined) result.strategyLimit = dollars(limits.contributionCap);
  if (manifest.runtime === 'periodic-goal@1') result.assumptions.push(`The stated monthly goal contribution is divided into ${settings.periodsPerMonth} periods, rounded down to cents. This is not a live schedule.`);
  if (manifest.runtime === 'positive-cashflow@1') result.assumptions.push('Positive stated monthly income minus expenses is an additional cap; it is not a forecast or a verified income source.');
  return result;
}

function reviewRecords(state, goalId, selection, reviewId) {
  const { manifest, settings, installationId } = selection;
  const goal = state.goals.find(item => item.id === goalId);
  return {
    recordVersion: 1,
    recordRefs: {
      strategy: { type: 'builtin-strategy', id: manifest.id, version: manifest.version, manifestVersion: manifest.manifestVersion },
      context: { type: 'cash-context', id: `${reviewId}:context` },
      policy: { type: 'cash-policy', id: `${reviewId}:policy` },
    },
    strategy: { id: manifest.id, version: manifest.version, manifestVersion: manifest.manifestVersion, runtime: manifest.runtime, settings: clone(settings), installationId },
    contextSnapshot: {
      schemaVersion: 1,
      goal: Object.fromEntries(['id', 'name', 'targetAmount', 'currentAmount', 'monthlyContribution', 'currency'].map(key => [key, goal[key]])),
      cash: Object.fromEntries(['available', 'upcomingBills', 'monthlyIncome', 'monthlyExpenses', 'currency'].map(key => [key, state.cash[key]])),
      provenance: { kind: financeInputMode(state) === 'sample' ? 'user-entered-sample' : 'user-entered-unverified', observedAt: null, freshness: 'unverified' },
    },
    policySnapshot: { schemaVersion: 1, rules: { reserve: state.rules.reserve, maxSuggestion: state.rules.maxSuggestion }, financialAuthority: 'none' },
  };
}

/** Calculate from declared inputs without creating an ID, saving history or changing settings. */
export function previewStrategyReview(state, { goalId = state.goals?.[0]?.id, strategy } = {}) {
  validateFinanceInputs(state);
  const selection = selectedStrategy(state, strategy);
  const calculation = executeStrategy(state, goalId, selection);
  const { recordRefs: ignored, ...snapshots } = reviewRecords(state, goalId, selection, 'preview');
  return { ...calculation, ...snapshots };
}

export function createReview(current, options = {}, now = new Date(), serverContext = {}) {
  if (!plainObject(options)) throw new ApiError(400, 'invalid_review', 'Send a JSON object with the fields for this request.');
  assertSafeJson(options);
  const inputMode = financeInputMode(current);
  if (options.inputMode !== undefined && options.inputMode !== inputMode || options.demo !== undefined && (typeof options.demo !== 'boolean' || options.demo !== (inputMode === 'sample'))) throw new ApiError(400, 'input_mode_mismatch', 'Your saved inputs use a different data mode. Refresh Context before running this review.');
  if (['draftId', 'compositionId', 'strategyDraft', 'strategyDrafts', 'blocks'].some(key => Object.hasOwn(options, key))) throw new ApiError(400, 'draft_not_runnable', 'This strategy is still a draft and cannot run. Choose a supported built-in strategy and version.');
  if (options.managed !== undefined && typeof options.managed !== 'boolean') throw new ApiError(400, 'invalid_review', 'managed must be true or false.');
  validateFinanceInputs(current);
  const selection = selectedStrategy(current, options.strategy);
  const next = clone(current);
  const managed = options.managed === true;
  if(managed)throw new ApiError(410,'managed_simulation_retired','The old managed-review simulation has ended. Run a free manual review; automatic duties are not operating.');
  const goalId = options.goalId === undefined ? next.goals[0].id : options.goalId;
  const id = crypto.randomUUID();
  const personalAgent = !managed && options.source === 'personal-agent' && typeof serverContext.personalAgentGrantId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serverContext.personalAgentGrantId);
  const review = { id, createdAt: isoNow(now), source: managed ? 'managed-demo' : options.source === 'cli' ? 'headless-cli' : options.source === 'site-mcp' ? 'site-mcp-owner' : personalAgent ? 'personal-agent-token' : 'manual-gui', managed, ...executeStrategy(next, goalId, selection), ...reviewRecords(next, goalId, selection, id), ...(personalAgent ? { agentAccess: { format: 'angbao-personal-agent-access@1', grantId: serverContext.personalAgentGrantId, harnessIdentity: 'unverified' } } : {}) };
  if(next.reviewRuns.length>=100)throw new ApiError(409,'review_history_full','This workspace reached its 100-review safety bound. Export a copy and keep this workspace before choosing another private workspace. No history was removed and no paid plan is required.');
  next.reviewRuns = [review, ...next.reviewRuns];
  next.reviewDecisions = Object.fromEntries(Object.entries(next.reviewDecisions ?? {}).filter(([id]) => next.reviewRuns.some(review => review.id === id)));
  next.reviewFeedback = feedbackRecords(next);
  next.financialPermissions = clone(FREE_PERMISSIONS);
  next.updatedAt = isoNow(now);
  return { review, state: next };
}

export function simulateBilling(current, input, now = new Date()) {
  if (!plainObject(input)) throw new ApiError(400, 'invalid_billing', 'Send a JSON object with the fields for this request.');
  throw new ApiError(410,'billing_simulation_retired','The old billing simulation has ended. Local reviews, history, archive, restore and saved schedule preferences remain free. No paid service is activated.');
}

export function exportWorkspace(state, now = new Date()) {
  return { format: 'angbao-demo-workspace', version: 1, exportedAt: isoNow(now), warning: 'Keep this export private: it may contain your financial inputs and research. Archived proposals use the separate portfolio-history bundle. Never add passwords, access tokens or signing keys.', state: clone(normalizeWorkspaceDrafts(state)) };
}

