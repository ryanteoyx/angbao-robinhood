/** Compare saved review inputs and results. No inference about causation or performance. */
const FORMAT = 'angbao-review-comparison@1';
const CASH_FIELDS = [
  ['available', 'Available cash'],
  ['upcomingBills', 'Upcoming bills'],
  ['monthlyIncome', 'Monthly income'],
  ['monthlyExpenses', 'Monthly expenses'],
];
const GOAL_FIELDS = [
  ['targetAmount', 'Goal target'],
  ['currentAmount', 'Saved toward goal'],
  ['monthlyContribution', 'Monthly contribution'],
];
const RULE_FIELDS = [['reserve', 'Protected reserve'], ['maxSuggestion', 'Suggestion cap']];
const SETTING_LABELS = {
  extraReserve: 'Strategy extra reserve',
  contributionCap: 'Strategy contribution cap',
  periodsPerMonth: 'Review periods per month',
};
const MONEY_SETTINGS = new Set(['extraReserve', 'contributionCap']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
const cents = value => Math.round((value + Number.EPSILON) * 100);
const amount = value => cents(value) / 100;
const delta = (before, after) => (cents(after) - cents(before)) / 100;
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const recordId = review => text(review?.id) ? review.id : null;

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function completeSnapshot(review) {
  if (!plain(review) || !recordId(review) || !validTimestamp(review.createdAt) || review.recordVersion !== 1
    || !['sample', 'manual'].includes(review.inputMode) || !money(review.suggestedContribution)
    || !text(review.goalId) || !currency(review.currency)) return false;
  const context = review.contextSnapshot, policy = review.policySnapshot, strategy = review.strategy;
  if (!plain(context) || context.schemaVersion !== 1 || !plain(policy) || policy.schemaVersion !== 1
    || policy.financialAuthority !== 'none' || !plain(strategy) || !text(strategy.id)
    || !text(strategy.version) || !plain(strategy.settings)) return false;
  if (Object.keys(strategy.settings).length > 50
    || Object.entries(strategy.settings).some(([key, value]) => !text(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !Number.isFinite(value) || typeof value !== 'number')) return false;
  const { goal, cash, provenance } = context;
  if (!plain(goal) || !text(goal.id) || goal.id !== review.goalId || !text(goal.name)
    || !currency(goal.currency) || !plain(cash) || !currency(cash.currency)
    || goal.currency !== cash.currency || review.currency !== cash.currency || !plain(policy.rules)) return false;
  if (CASH_FIELDS.some(([key]) => !money(cash[key])) || GOAL_FIELDS.some(([key]) => !money(goal[key]))
    || RULE_FIELDS.some(([key]) => !money(policy.rules[key]))) return false;
  const expectedSource = review.inputMode === 'sample' ? 'user-entered-sample' : 'user-entered-unverified';
  return plain(provenance) && provenance.kind === expectedSource && provenance.freshness === 'unverified'
    && provenance.observedAt === null;
}

/** Values come from each review's saved copies, never the currently edited workspace. */
export function compareReviews(previous, current) {
  const previousValid = completeSnapshot(previous), currentValid = completeSnapshot(current);
  const comparison = {
    format: FORMAT,
    status: 'unavailable',
    previousReviewId: recordId(previous),
    currentReviewId: recordId(current),
    reasons: [],
    changes: [],
    unchanged: false,
    result: {
      before: previousValid ? amount(previous.suggestedContribution) : null,
      after: currentValid ? amount(current.suggestedContribution) : null,
    },
  };
  if (!previousValid) comparison.reasons.push(previous == null
    ? 'No earlier matching review is saved.'
    : 'The earlier review has no complete saved inputs and rules.');
  if (!currentValid) comparison.reasons.push(current == null
    ? 'This review is unavailable.'
    : 'This review has no complete saved inputs and rules.');
  if (!previousValid || !currentValid) return comparison;

  const before = previous.contextSnapshot, after = current.contextSnapshot;
  const sameCurrency = previous.currency === current.currency;
  if (!sameCurrency) comparison.reasons.push('The reviews use different currencies. Amount changes are not calculated.');
  if (previous.inputMode !== current.inputMode) comparison.reasons.push('One review uses sample data and the other uses personal inputs.');
  if (previous.goalId !== current.goalId) comparison.reasons.push('The reviews refer to different goals.');
  if (previous.strategy.id !== current.strategy.id || previous.strategy.version !== current.strategy.version)
    comparison.reasons.push('Different strategies or versions were used.');
  comparison.status = comparison.reasons.length ? 'not-comparable' : 'comparable';
  const comparable = comparison.status === 'comparable';

  function changed(key, label, kind, left, right) {
    const oldValue = kind === 'money' && left !== null ? amount(left) : left;
    const newValue = kind === 'money' && right !== null ? amount(right) : right;
    if (Object.is(oldValue, newValue)) return;
    const change = { key, label, kind, before: oldValue, after: newValue };
    if (kind === 'money') {
      if (sameCurrency) change.currency = current.currency;
      if (comparable && left !== null && right !== null) change.delta = delta(left, right);
    } else if (kind === 'number' && left !== null && right !== null) {
      change.delta = right - left;
    }
    comparison.changes.push(change);
  }

  changed('inputMode', 'Input mode', 'text', previous.inputMode, current.inputMode);
  changed('currency', 'Currency', 'text', previous.currency, current.currency);
  changed('goal.id', 'Goal ID', 'text', before.goal.id, after.goal.id);
  changed('goal.name', 'Goal name', 'text', before.goal.name, after.goal.name);
  for (const [key, label] of CASH_FIELDS) changed(`cash.${key}`, label, 'money', before.cash[key], after.cash[key]);
  for (const [key, label] of GOAL_FIELDS) changed(`goal.${key}`, label, 'money', before.goal[key], after.goal[key]);
  for (const [key, label] of RULE_FIELDS)
    changed(`rules.${key}`, label, 'money', previous.policySnapshot.rules[key], current.policySnapshot.rules[key]);
  changed('strategy.id', 'Strategy', 'text', previous.strategy.id, current.strategy.id);
  changed('strategy.version', 'Strategy version', 'text', previous.strategy.version, current.strategy.version);
  const settingKeys = [...new Set([...Object.keys(previous.strategy.settings), ...Object.keys(current.strategy.settings)])].sort();
  for (const key of settingKeys) {
    changed(`strategy.settings.${key}`, Object.hasOwn(SETTING_LABELS, key) ? SETTING_LABELS[key] : `Strategy setting: ${key}`,
      MONEY_SETTINGS.has(key) ? 'money' : 'number',
      Object.hasOwn(previous.strategy.settings, key) ? previous.strategy.settings[key] : null,
      Object.hasOwn(current.strategy.settings, key) ? current.strategy.settings[key] : null);
  }
  for (const [key, label] of [['kind', 'Input source'], ['observedAt', 'Input source date'], ['freshness', 'Input freshness']])
    changed(`provenance.${key}`, label, 'text', before.provenance[key], after.provenance[key]);
  if (comparable) comparison.result.delta = delta(previous.suggestedContribution, current.suggestedContribution);
  comparison.unchanged = comparable && comparison.changes.length === 0 && comparison.result.delta === 0;
  return comparison;
}

/** Retained history is newest first. Never substitute a newer review or guess by date. */
export function findPreviousReview(current, history) {
  if (!recordId(current) || !text(current?.goalId) || !text(current?.strategy?.id) || !Array.isArray(history)) return null;
  if (current.repeatOfReviewId !== undefined) return history.find(review => review?.id === current.repeatOfReviewId) ?? null;
  const index = history.findIndex(review => review?.id === current.id);
  if (index < 0) return null;
  for (let next = index + 1; next < history.length; next++) {
    const review = history[next];
    if (review?.id !== current.id && review?.goalId === current.goalId && review?.strategy?.id === current.strategy.id) return review;
  }
  return null;
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A next-check date is a saved reminder only; this does not schedule or run work. */
export function reviewDueStatus(reviewId, decisions, todayYYYYMMDD) {
  const unscheduled = { status: 'unscheduled', nextCheck: null };
  if (!text(reviewId) || !plain(decisions) || !Object.hasOwn(decisions, reviewId) || !validCalendarDate(todayYYYYMMDD)) return unscheduled;
  const decision = decisions[reviewId];
  if (!plain(decision) || !validCalendarDate(decision.nextCheck)) return unscheduled;
  const nextCheck = decision.nextCheck;
  return { status: nextCheck === todayYYYYMMDD ? 'due' : nextCheck < todayYYYYMMDD ? 'overdue' : 'upcoming', nextCheck };
}
