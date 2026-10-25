/** Built-in, data-only strategy manifests. Published tuples are retained, never replaced. */
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

const moneySetting = { type: 'number', minimum: 0, maximum: 1_000_000_000, unit: 'workspace-currency' };
function manifest(id, version, runtime, defaults = {}, properties = {}) {
  return {
    format: 'angbao-builtin-strategy', manifestVersion: 1, id, version, runtime,
    inputSchema: 'angbao-cash-context@1', outputSchema: 'angbao-savings-review@1',
    requestedScopes: ['cash:read', 'goals:read', 'review:create'], financialAuthority: 'none',
    settingsSchema: { type: 'object', additionalProperties: false, properties: { extraReserve: { ...moneySetting, description: 'Additional protected cash, above your personal reserve.' }, contributionCap: { ...moneySetting, description: 'Optional stricter per-review cap; never raises your personal cap.' }, ...properties } },
    defaultSettings: { extraReserve: 0, ...defaults },
  };
}

export const DEFAULT_STRATEGY = freeze({ id: 'cash-buffer', version: '1.0.0' });
export const strategyManifests = freeze([
  manifest('cash-buffer', '1.0.0', 'cash-headroom@1'),
  manifest('cash-buffer', '1.1.0', 'positive-cashflow@1'),
  manifest('weekly-goals', '1.2.0', 'periodic-goal@1', { periodsPerMonth: 4 }, { periodsPerMonth: { type: 'integer', minimum: 1, maximum: 31, description: 'Split the stated monthly goal contribution into this many review periods; not a scheduler.' } }),
  manifest('keep-or-change', '0.1.0', 'observe-only@1'),
]);

/** The discoverable catalogue shows current versions; older manifests remain runnable by exact pin. */
export const recipes = freeze([
  {
    id: 'cash-buffer', name: 'Reserve before saving', creator: 'Alice · demo creator', version: '1.1.0',
    tag: 'Cashflow-aware buffer', description: 'Protect bills and a cash reserve, then cap an optional contribution by positive monthly cash flow.',
    scopes: ['Read cash snapshot', 'Read savings goals', 'Create a review'], requestedScopes: ['cash:read', 'goals:read', 'review:create'],
    requiredInputs: ['availableCash', 'upcomingBills', 'reserve', 'maximumSuggestion', 'remainingGoal', 'monthlyIncome', 'monthlyExpenses'],
    rules: 'Uses your reserve, contribution cap and positive monthly cash flow.', licence: 'free-demo', financialAuthority: 'none', demo: true,
  },
  {
    id: 'weekly-goals', name: 'Small steps, every week', creator: 'Mei · demo creator', version: '1.2.0',
    tag: 'Weekly rhythm', description: 'Split your stated monthly goal contribution into smaller review periods, within your cash and reserve limits.',
    scopes: ['Read savings goals', 'Read cash snapshot', 'Create a review'], requestedScopes: ['goals:read', 'cash:read', 'review:create'],
    requiredInputs: ['currentGoalAmount', 'targetAmount', 'monthlyContribution', 'availableCash'],
    rules: 'Defaults to one quarter of your monthly goal contribution; no automatic schedule.', licence: 'free-demo', financialAuthority: 'none', demo: true,
  },
  {
    id: 'keep-or-change', name: 'Review before you change', creator: 'Angbao · demo recipe', version: '0.1.0',
    tag: 'No action is an outcome', description: 'Use keep, watch or prepare to record a deliberate decision instead of rushing into an action.',
    scopes: ['Read cash snapshot', 'Read savings goals', 'Create a review'], requestedScopes: ['cash:read', 'goals:read', 'review:create'],
    requiredInputs: ['availableCash', 'upcomingBills', 'reserve', 'currentGoalAmount', 'targetAmount'],
    rules: 'Observe the plan without suggesting a new contribution; no signing or spending authority.', licence: 'free-demo', financialAuthority: 'none', demo: true,
  },
].map(recipe => ({ ...recipe, manifest: strategyManifests.find(item => item.id === recipe.id && item.version === recipe.version) })));
