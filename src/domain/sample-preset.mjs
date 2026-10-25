import { ApiError, clone, createReview, previewStrategyReview } from './angbao.mjs';

// Explicit versioned inputs: installed settings and the workspace's current mode
// never supply defaults for this separate sample operation.
const TRY_SAVINGS = {
  id: 'try-savings',
  name: 'Try a savings review',
  description: 'Review a labelled sample emergency fund, with no additional reserve beyond its protected reserve. Your saved inputs and strategy settings stay as they are. No money moves.',
  inputMode: 'sample',
  goalId: 'sample-try-savings-emergency-fund',
  cash: { available: 4200, upcomingBills: 900, monthlyIncome: 4500, monthlyExpenses: 3100, currency: 'USD' },
  goals: [{ id: 'sample-try-savings-emergency-fund', name: 'Sample emergency fund', targetAmount: 5000, currentAmount: 1200, monthlyContribution: 300, currency: 'USD' }],
  rules: { reserve: 2500, maxSuggestion: 150 },
  strategy: { id: 'cash-buffer', version: '1.1.0', settings: { extraReserve: 0 } },
};

export function getSamplePreset(presetId = 'try-savings') {
  if (presetId !== TRY_SAVINGS.id) throw new ApiError(400, 'unknown_sample_preset', 'Choose the sample preset try-savings. Your saved inputs have not changed.');
  return clone(TRY_SAVINGS);
}

function sampleInputs(preset) {
  return { inputMode: 'sample', cash: clone(preset.cash), goals: clone(preset.goals), rules: clone(preset.rules), installedStrategies: [] };
}

export function previewSamplePreset(presetId = 'try-savings') {
  const preset = getSamplePreset(presetId);
  return { preset, review: previewStrategyReview(sampleInputs(preset), { goalId: preset.goalId, strategy: preset.strategy }), saved: false };
}

/** Save a separate labelled snapshot; never install preset inputs into Context. */
export function createSampleReview(current, { presetId, source } = {}, now = new Date()) {
  const preset = getSamplePreset(presetId);
  const result = createReview({ ...clone(current), ...sampleInputs(preset) }, {
    goalId: preset.goalId, strategy: preset.strategy, managed: false, source,
  }, now);
  const next = clone(current);
  // Match ordinary review retention while keeping the actual declaration,
  // installation settings, account data and unrelated history unchanged.
  for (const field of ['reviewRuns', 'reviewDecisions', 'reviewFeedback', 'updatedAt']) next[field] = clone(result.state[field]);
  return { review: result.review, state: next };
}
