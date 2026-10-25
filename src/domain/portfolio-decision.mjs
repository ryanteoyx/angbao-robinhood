/** Supplied evidence -> portfolio-aware proposal. No fetch, model, orders or changed balances. */
import {createHash} from 'node:crypto';
const MAX_MONEY = 1_000_000_000_000;
const BPS = 10_000n;
const PRIVATE = /-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\babp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_[A-Za-z0-9_-]+|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export class PortfolioDecisionError extends Error {
  constructor(message, code = 'invalid_portfolio_decision') { super(message); this.name = 'PortfolioDecisionError'; this.code = code; this.status = 400; }
}
const fail = (message, code) => { throw new PortfolioDecisionError(message, code); };
function exact(value, allowed) { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Use only the documented portfolio-decision fields.'); }
function json(value) {
  let nodes = 0; const visiting = new Set();
  function visit(item, depth) {
    if (++nodes > 30_000 || depth > 16) fail('This decision input is too complex.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > 20_000 || PRIVATE.test(item) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item)) fail('Use bounded plain data without credentials.'); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('Use finite JSON numbers.'); return; }
    if ((!plain(item) && !Array.isArray(item)) || visiting.has(item)) fail('Use plain, non-cyclic JSON decision data.');
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) fail('Use dense lists without extra properties.');
    visiting.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Decision data cannot contain prototype fields, accessors or hidden properties.');
      visit(descriptor.value, depth + 1);
    }
    visiting.delete(item);
  }
  visit(value, 0);
  if (new TextEncoder().encode(canonical(value)).length > 1_048_576) fail('The decision input exceeds 1 MiB.');
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }

function text(value, max, nullable = false) { if (nullable && value == null) return null; if (typeof value !== 'string' || !value.trim() || value.length > max) fail('A required decision text field is missing or too long.'); return value; }
function identifier(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) fail('Use an explicit stable identifier, not an ambiguous display symbol.'); return value; }
function list(value, max) { if (!Array.isArray(value) || value.length > max) fail('A decision list exceeds its supported limit.'); return value; }
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail('Use bounded integer minor units, basis points and versions.'); return value; }
function date(value, nullable = false) { if (nullable && value == null) return null; if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Use a canonical ISO timestamp, or null when a source time is unknown.'); return value; }
function publicUrl(value) {
  if (value == null) return null;
  let url; try { url = new URL(text(value, 2000)); } catch { fail('Use a public HTTPS source link without credentials.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.includes(':') || /\.(?:local|localhost|internal)$/i.test(url.hostname) || [...url.searchParams.keys()].some(key => /token|key|secret|auth|signature|credential/i.test(key))) fail('Use a public HTTPS source link without credentials.');
  if (url.href.length > 2000) fail('The canonical HTTPS source link exceeds its supported length.');
  return url.href;
}
const gap = (gaps, code, detail, blocking = true) => { if (!gaps.some(item => item.code === code && item.detail === detail)) gaps.push({ code, detail, blocking }); };
export const portfolioValuationCurrencies = freeze({ USD: 2, SGD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 });
const knownValuation = (currency, exponent) => typeof currency === 'string' && Object.hasOwn(portfolioValuationCurrencies, currency) && portfolioValuationCurrencies[currency] === exponent;

export const portfolioDecisionManifest = freeze({
  format: 'angbao-portfolio-decision-method@1', id: 'portfolio-contribution', version: '1.0.0',
  runtime: 'existing-cash-target-deficits@1', requestedScopes: [], financialAuthority: 'none',
  sourceSchema: 'angbao-supplied-financial-source@1', assessmentSchema: 'angbao-portfolio-assessment@1',
  portfolioSchema: 'angbao-portfolio-snapshot@1', policySchema: 'angbao-allocation-policy@1',
  outputSchema: 'angbao-portfolio-decision@1', funding: 'existing-cash-included-in-total-equity',
  valuationCurrencies: portfolioValuationCurrencies,
  supportedPlans: ['watch', 'research', 'prepare-allocation', 'prepare-DCA'],
});

/** Link-only intake is permitted but cannot support a sized proposal without supplied source text. */
export function createPortfolioSourceSync(input) {
  json(input); exact(input, ['sourceId', 'version', 'channel', 'capture', 'contentKind', 'url', 'text', 'publishedAt', 'observedAt']);
  identifier(input.sourceId); integer(input.version, 1, 1_000_000);
  if (!['article', 'x', 'telegram', 'substack', 'news', 'manual'].includes(input.channel)) fail('Choose a supported source channel.');
  if (!['user-forwarded', 'agent-retrieved', 'elfa-derived'].includes(input.capture)) fail('Declare whether the source was user-forwarded, agent-retrieved or Elfa-derived. This declaration grants no tool access.');
  if (!['source-text', 'source-excerpt', 'derived-summary', 'link-only'].includes(input.contentKind)) fail('Distinguish supplied source text, excerpt, derived summary and unread link.');
  const url = publicUrl(input.url), sourceText = text(input.text, 8000, true);
  if (!url && !sourceText) fail('Supply source text or an explicit public source link.');
  if (input.contentKind === 'link-only' ? sourceText !== null : sourceText === null) fail('An unread link cannot claim source text; a text or summary intake must include the supplied content.');
  if (input.capture === 'elfa-derived' && input.contentKind !== 'derived-summary') fail('An Elfa-derived summary is not the original X article or post.');
  const payload = { format: 'angbao-supplied-financial-source@1', sourceId: input.sourceId, version: input.version, channel: input.channel, capture: input.capture, contentKind: input.contentKind, url, text: sourceText, publishedAt: date(input.publishedAt, true), observedAt: date(input.observedAt), verification: 'unverified-supplied-content', contentIsInstructions: false, fetchedByAngbao: false };
  const result = { ...payload, digest: digest(payload) };
  json(result);
  return freeze(result);
}
export function validatePortfolioSourceSync(source) {
  json(source); exact(source, ['format', 'sourceId', 'version', 'channel', 'capture', 'contentKind', 'url', 'text', 'publishedAt', 'observedAt', 'verification', 'contentIsInstructions', 'fetchedByAngbao', 'digest']);
  const expected = createPortfolioSourceSync(Object.fromEntries(['sourceId', 'version', 'channel', 'capture', 'contentKind', 'url', 'text', 'publishedAt', 'observedAt'].map(key => [key, source[key]])));
  if (canonical(expected) !== canonical(source)) fail('The supplied source content or provenance changed. Intake it again and obtain a new assessment reference.', 'source_snapshot_changed');
  return source;
}

function inspectInstrument(instrument, gaps) {
  exact(instrument, ['id', 'kind', 'identity']); identifier(instrument.id);
  if (!['listed-equity', 'tokenized-equity', 'crypto'].includes(instrument.kind)) { gap(gaps, 'instrument-kind-unknown', 'An instrument has an unknown or unsupported asset kind.'); return false; }
  const fields = instrument.kind === 'listed-equity' ? ['exchange', 'ticker'] : instrument.kind === 'tokenized-equity' ? ['network', 'contractAddress', 'issuer', 'underlyingListedId'] : ['network', 'assetId'];
  if (!plain(instrument.identity)) { gap(gaps, 'instrument-identity-unknown', 'An instrument is missing its typed market or onchain identity.'); return false; }
  exact(instrument.identity, fields);
  if (fields.some(field => typeof instrument.identity[field] !== 'string' || !instrument.identity[field].trim() || instrument.identity[field].length > 160)) { gap(gaps, 'instrument-identity-unknown', 'An instrument identity is incomplete; display tickers are insufficient.'); return false; }
  const identity = instrument.identity, network = /^eip155:[1-9]\d{0,11}$/, address = /^0x[0-9a-f]{40}$/;
  const validAddress = value => address.test(value) && !/^0x0{40}$/.test(value);
  const canonicalIdentity = instrument.kind === 'listed-equity'
    ? /^[A-Z0-9]{4}$/.test(identity.exchange) && /^[A-Z0-9][A-Z0-9._/-]{0,19}$/.test(identity.ticker)
    : instrument.kind === 'tokenized-equity'
      ? network.test(identity.network) && validAddress(identity.contractAddress) && identity.issuer === identity.issuer.trim() && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(identity.underlyingListedId)
      : network.test(identity.network) && (identity.assetId === 'native' || validAddress(identity.assetId));
  if (!canonicalIdentity) { gap(gaps, 'instrument-identity-noncanonical', 'Use a canonical uppercase listed exchange/ticker or supported EVM network/lowercase address identity. Ambiguous, malformed and unsupported identities cannot be sized.'); return false; }
  return true;
}
function intrinsicInstrumentKey(instrument) {
  const identity = instrument.identity;
  return instrument.kind === 'listed-equity' ? `listed:${identity.exchange}:${identity.ticker}` : `onchain:${identity.network}:${instrument.kind === 'tokenized-equity' ? identity.contractAddress : identity.assetId}`;
}
/** Bind an owner target to the complete typed identity, not just a display ticker/local alias. */
export function portfolioInstrumentReferenceSync(instrument) {
  json(instrument); const gaps = [];
  if (!inspectInstrument(instrument, gaps)) fail('Supply a complete supported instrument identity before creating a target reference.');
  return freeze({ instrumentId: instrument.id, instrumentDigest: digest(instrument) });
}
function inspectPortfolio(portfolio, policy, clock, gaps) {
  if (!portfolio) { gap(gaps, 'portfolio-missing', 'Supply a complete manual or sample portfolio snapshot before sizing.'); return null; }
  exact(portfolio, ['format', 'id', 'version', 'source', 'currency', 'minorUnitExponent', 'observedAt', 'coverage', 'cashMinor', 'committedCashMinor', 'positions']);
  if (portfolio.format !== 'angbao-portfolio-snapshot@1') fail('Use the portfolio snapshot schema.');
  identifier(portfolio.id); integer(portfolio.version, 1, 1_000_000);
  if (!['manual', 'sample'].includes(portfolio.source)) fail('This method supports explicitly supplied manual or sample portfolios only.');
  if (!knownValuation(portfolio.currency, portfolio.minorUnitExponent)) gap(gaps, 'portfolio-currency-unknown', 'An explicitly supported valuation currency and its minor-unit exponent are required.');
  if (!portfolio.observedAt) gap(gaps, 'portfolio-time-unknown', 'A portfolio observation time is required.');
  else { date(portfolio.observedAt); if (Date.parse(portfolio.observedAt) > clock) gap(gaps, 'portfolio-time-future', 'The portfolio observation is later than the decision time.'); else if (policy && clock - Date.parse(portfolio.observedAt) > policy.maxSnapshotAgeHours * 3_600_000) gap(gaps, 'portfolio-stale', 'The portfolio snapshot exceeds the owner’s allowed age.'); }
  if (portfolio.coverage !== 'complete') gap(gaps, 'portfolio-coverage-incomplete', 'A partial or unknown portfolio cannot establish target weights or a spending budget.');
  for (const field of ['cashMinor', 'committedCashMinor']) if (!Number.isSafeInteger(portfolio[field]) || portfolio[field] < 0 || portfolio[field] > MAX_MONEY) gap(gaps, 'portfolio-cash-unknown', 'Cash and existing cash commitments must be known non-negative integer minor units.');
  if (Number.isSafeInteger(portfolio.cashMinor) && Number.isSafeInteger(portfolio.committedCashMinor) && portfolio.committedCashMinor > portfolio.cashMinor) gap(gaps, 'cash-commitments-exceed-cash', 'Existing cash commitments exceed the stated cash balance.');
  const ids = new Set(), identities = new Set(); let total = BigInt(Number.isSafeInteger(portfolio.cashMinor) && portfolio.cashMinor >= 0 ? portfolio.cashMinor : 0);
  if (!Array.isArray(portfolio.positions)) { gap(gaps, 'positions-missing', 'List the positions, including explicit zero balances for intended new targets.'); return null; }
  for (const position of list(portfolio.positions, 32)) {
    exact(position, ['instrument', 'valueMinor']);
    const known = inspectInstrument(position.instrument, gaps), id = position.instrument.id;
    if (ids.has(id)) gap(gaps, 'duplicate-instrument', 'Aggregate an instrument’s holdings explicitly instead of duplicating its identifier.'); ids.add(id);
    if (known) { const identity = intrinsicInstrumentKey(position.instrument); if (identities.has(identity)) gap(gaps, 'duplicate-instrument-identity', 'The same listed instrument or onchain contract/native asset appears more than once, including under different metadata or asset labels.'); identities.add(identity); }
    if (!Number.isSafeInteger(position.valueMinor) || position.valueMinor < 0 || position.valueMinor > MAX_MONEY) gap(gaps, 'position-value-unknown', 'Every position requires a known non-negative value in the same valuation currency.');
    else total += BigInt(position.valueMinor);
  }
  if (total <= 0n || total > BigInt(MAX_MONEY)) gap(gaps, 'portfolio-total-unsupported', 'Total equity must be positive and fit the supported minor-unit limit.');
  return { ids, total };
}
function inspectPolicy(policy, gaps) {
  if (!policy) { gap(gaps, 'allocation-policy-missing', 'Supply explicit owner targets, reserve, spend cap, fee allowance and freshness limits before sizing.'); return null; }
  exact(policy, ['format', 'id', 'version', 'source', 'currency', 'minorUnitExponent', 'cashTargetBps', 'targets', 'reserveMinor', 'maxPlanSpendMinor', 'feeAllowanceMinor', 'maxSnapshotAgeHours', 'maxSourceAgeHours', 'dca']);
  if (policy.format !== 'angbao-allocation-policy@1') fail('Use the owner allocation-policy schema.');
  identifier(policy.id); integer(policy.version, 1, 1_000_000);
  if (policy.source !== 'owner-supplied') gap(gaps, 'owner-policy-required', 'News or an agent assessment cannot create an approved owner policy.');
  if (!knownValuation(policy.currency, policy.minorUnitExponent)) gap(gaps, 'policy-currency-unknown', 'The owner policy needs an explicitly supported valuation currency and its minor-unit exponent.');
  for (const field of ['reserveMinor', 'maxPlanSpendMinor', 'feeAllowanceMinor']) if (!Number.isSafeInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_MONEY) gap(gaps, 'policy-budget-unknown', 'Reserve, total spend cap and fee allowance must be explicit non-negative integer minor units.');
  for (const field of ['maxSnapshotAgeHours', 'maxSourceAgeHours']) if (!Number.isSafeInteger(policy[field]) || policy[field] < 1 || policy[field] > 744) gap(gaps, 'policy-freshness-unknown', 'Explicit owner freshness limits of 1–744 hours are required.');
  if (!Number.isSafeInteger(policy.cashTargetBps) || policy.cashTargetBps < 0 || policy.cashTargetBps > 10_000) gap(gaps, 'cash-target-unknown', 'The owner cash target must be explicit integer basis points.');
  if (!Array.isArray(policy.targets) || !policy.targets.length) { gap(gaps, 'allocation-targets-missing', 'Explicit instrument targets are required; an agent cannot infer them from news.'); return null; }
  const targets = new Map(); let sum = Number.isSafeInteger(policy.cashTargetBps) ? policy.cashTargetBps : 0;
  for (const target of list(policy.targets, 32)) {
    exact(target, ['instrumentId', 'instrumentDigest', 'targetBps']); identifier(target.instrumentId);
    if (typeof target.instrumentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(target.instrumentDigest)) gap(gaps, 'target-instrument-identity-missing', 'Bind every owner target to the exact typed instrument identity, not its display ticker or local alias alone.');
    if (!Number.isSafeInteger(target.targetBps) || target.targetBps < 0 || target.targetBps > 10_000) gap(gaps, 'allocation-target-unknown', 'Every target must be explicit integer basis points.');
    else sum += target.targetBps;
    if (targets.has(target.instrumentId)) gap(gaps, 'duplicate-allocation-target', 'Each instrument must have one owner target.'); targets.set(target.instrumentId, target.targetBps);
  }
  if (sum !== 10_000) gap(gaps, 'allocation-target-total', 'Owner instrument targets plus the cash target must sum to 10,000 basis points of total equity.');
  if (policy.dca != null) { exact(policy.dca, ['installments', 'cadence']); if (!Number.isSafeInteger(policy.dca.installments) || policy.dca.installments < 1 || policy.dca.installments > 12 || !['daily', 'weekly', 'monthly'].includes(policy.dca.cadence)) gap(gaps, 'dca-policy-invalid', 'DCA supports 1–12 installments and a daily, weekly or monthly planning label.'); }
  return { targets };
}
function inspectAssessment(assessment, sources, portfolioInfo, clock, policy, gaps) {
  if (!assessment) { gap(gaps, 'assessment-missing', 'A personal agent must supply an explicit source-linked portfolio assessment.'); return null; }
  exact(assessment, ['format', 'id', 'version', 'authorship', 'intent', 'sourceRefs', 'claims', 'inferences', 'focusInstrumentIds', 'relevance', 'counterevidence', 'gaps', 'proposedPolicyChanges']);
  if (assessment.format !== 'angbao-portfolio-assessment@1' || assessment.authorship !== 'agent-authored') fail('Use a typed, explicitly agent-authored portfolio assessment.');
  identifier(assessment.id); integer(assessment.version, 1, 1_000_000);
  if (!['watch', 'research', 'prepare-allocation', 'prepare-DCA', 'review-rebalance'].includes(assessment.intent)) fail('Choose a supported proposal intent.');
  const sourceMap = new Map(sources.map(source => [source.sourceId, source])), refs = new Map(), claims = new Map(), usedSources = new Set();
  for (const ref of list(assessment.sourceRefs ?? [], 16)) {
    exact(ref, ['sourceId', 'digest']); identifier(ref.sourceId);
    if (refs.has(ref.sourceId) || !sourceMap.has(ref.sourceId) || sourceMap.get(ref.sourceId).digest !== ref.digest) gap(gaps, 'assessment-source-mismatch', 'An assessment source reference is missing, duplicated or differs from the exact supplied source snapshot.');
    refs.set(ref.sourceId, ref.digest);
  }
  for (const claim of list(assessment.claims ?? [], 16)) {
    exact(claim, ['id', 'stance', 'text', 'sourceIds']); identifier(claim.id); text(claim.text, 1500);
    if (!['supporting', 'contradicting', 'uncertain'].includes(claim.stance)) fail('Label each claim as supporting, contradicting or uncertain.');
    const ids = list(claim.sourceIds, 16);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !refs.has(id))) gap(gaps, 'claim-source-missing', 'Every claim must refer to exact supplied source IDs.');
    for (const id of ids) usedSources.add(id);
    if (claims.has(claim.id)) gap(gaps, 'duplicate-claim', 'Use one stable ID per assessment claim.'); claims.set(claim.id, claim);
  }
  if (!claims.size) gap(gaps, 'claims-missing', 'No source-linked claims were supplied; do further research before proposing a size.');
  for (const inference of list(assessment.inferences ?? [], 16)) {
    exact(inference, ['text', 'claimIds']); text(inference.text, 1500);
    if (!list(inference.claimIds, 16).length || inference.claimIds.some(id => !claims.has(id))) gap(gaps, 'inference-claim-missing', 'Inferences must refer to the supplied claim IDs.');
  }
  for (const sourceId of usedSources) {
    const source = sourceMap.get(sourceId); if (!source) continue;
    if (!source.text) gap(gaps, 'source-text-unavailable', 'A link-only source has not been read. Supply its text before using it for a sized proposal.');
    if (source.contentKind === 'derived-summary') gap(gaps, 'source-is-derived-summary', 'The supplied content is a derived summary, not the original article, post or message.', false);
    if (Date.parse(source.observedAt) > clock || source.publishedAt && Date.parse(source.publishedAt) > clock) gap(gaps, 'source-time-future', 'A source timestamp is later than this decision.');
    else if (policy && (clock - Date.parse(source.observedAt) > policy.maxSourceAgeHours * 3_600_000 || source.publishedAt && clock - Date.parse(source.publishedAt) > policy.maxSourceAgeHours * 3_600_000)) gap(gaps, 'source-stale', 'A referenced source exceeds the owner’s allowed source age.');
    if (!source.publishedAt) gap(gaps, 'source-publication-time-unknown', 'A source publication time is unknown; its observation time is not a substitute.', false);
  }
  const focus = list(assessment.focusInstrumentIds ?? [], 32);
  if (new Set(focus).size !== focus.length) gap(gaps, 'duplicate-focus-instrument', 'List each focus instrument once.');
  for (const id of focus) { identifier(id); if (portfolioInfo && !portfolioInfo.ids.has(id)) gap(gaps, 'focus-instrument-unknown', 'A focus instrument is absent from the explicit typed portfolio. A display ticker does not identify a position.'); }
  const relevance = new Map();
  for (const item of list(assessment.relevance ?? [], 32)) {
    exact(item, ['instrumentId', 'claimIds', 'relation']); identifier(item.instrumentId);
    if (!['supports-owner-target', 'challenges-owner-target', 'context-only'].includes(item.relation)) fail('Use an explicit assessment-to-target relation.');
    if (!list(item.claimIds, 16).length || item.claimIds.some(id => !claims.has(id)) || relevance.has(item.instrumentId)) gap(gaps, 'relevance-claim-missing', 'Each assessment-to-instrument relationship needs distinct, valid claim references.');
    relevance.set(item.instrumentId, item);
  }
  for (const id of focus) if (!relevance.has(id)) gap(gaps, 'instrument-relevance-missing', 'Explain how the cited claims relate to each focus instrument.');
  if (['prepare-allocation', 'prepare-DCA'].includes(assessment.intent) && !focus.length) gap(gaps, 'focus-instruments-missing', 'Choose explicit target instruments before preparing an allocation.');
  if (!plain(assessment.counterevidence)) gap(gaps, 'counterevidence-missing', 'Supply cited counterevidence or explicitly state the missing-counterevidence gap.');
  else {
    exact(assessment.counterevidence, ['claimIds', 'gap']);
    const counterIds = list(assessment.counterevidence.claimIds ?? [], 16);
    if (counterIds.some(id => claims.get(id)?.stance !== 'contradicting') || new Set(counterIds).size !== counterIds.length) gap(gaps, 'counterevidence-claim-mismatch', 'Counterevidence must reference distinct contradicting claims.');
    if (assessment.counterevidence.gap != null) text(assessment.counterevidence.gap, 1500);
    if (!counterIds.length && !assessment.counterevidence.gap) gap(gaps, 'counterevidence-missing', 'No cited counterevidence or explicit counterevidence gap was supplied.');
  }
  list(assessment.gaps ?? [], 16).forEach(item => text(item, 1500));
  for (const change of list(assessment.proposedPolicyChanges ?? [], 16)) {
    exact(change, ['instrumentId', 'targetBps', 'reason', 'claimIds']); identifier(change.instrumentId); integer(change.targetBps, 0, 10_000); text(change.reason, 1500);
    if (!list(change.claimIds, 16).length || change.claimIds.some(id => !claims.has(id))) gap(gaps, 'proposed-policy-claim-missing', 'A proposed target change needs valid claim references.');
  }
  return { focus, relevance, usedSources };
}

function allocationComparison(portfolio, policy, total) {
  const targets = new Map(policy.targets.map(item => [item.instrumentId, item.targetBps]));
  const positions = portfolio.positions.map(position => {
    const current = BigInt(position.valueMinor), targetBps = targets.get(position.instrument.id), target = total * BigInt(targetBps) / BPS;
    return { instrumentId: position.instrument.id, kind: position.instrument.kind, currentValueMinor: position.valueMinor, currentWeightBpsFloor: Number(current * BPS / total), targetBps, targetValueMinorFloor: Number(target), deficitMinor: Number(target > current ? target - current : 0n), excessMinor: Number(current > target ? current - target : 0n) };
  });
  const targetCash = (total * BigInt(policy.cashTargetBps) + BPS - 1n) / BPS;
  const protectedCash = BigInt(policy.reserveMinor) + BigInt(portfolio.committedCashMinor), floor = targetCash > protectedCash ? targetCash : protectedCash;
  const cashAfterFloorAndFees = BigInt(portfolio.cashMinor) - floor - BigInt(policy.feeAllowanceMinor), capAfterFees = BigInt(policy.maxPlanSpendMinor) - BigInt(policy.feeAllowanceMinor);
  const available = cashAfterFloorAndFees < capAfterFees ? cashAfterFloorAndFees : capAfterFees;
  return { currency: portfolio.currency, minorUnitExponent: portfolio.minorUnitExponent, totalEquityMinor: Number(total), denominator: 'cash-plus-all-position-values-no-external-inflow', positions, cashTargetBps: policy.cashTargetBps, cashTargetMinorCeil: Number(targetCash), protectedCashFloorMinor: Number(floor), investmentBudgetMinor: Number(available > 0n ? available : 0n) };
}
function allocateDeficits(candidates, budget) {
  const sum = candidates.reduce((value, item) => value + BigInt(item.deficitMinor), 0n);
  const spend = budget < sum ? budget : sum;
  if (!spend || !sum) return [];
  const shares = candidates.map(item => ({ instrumentId: item.instrumentId, amountMinor: spend * BigInt(item.deficitMinor) / sum, remainder: spend * BigInt(item.deficitMinor) % sum }));
  let remaining = spend - shares.reduce((value, item) => value + item.amountMinor, 0n);
  shares.sort((left, right) => left.remainder > right.remainder ? -1 : left.remainder < right.remainder ? 1 : order(left.instrumentId, right.instrumentId));
  for (const item of shares) if (remaining > 0n) { item.amountMinor++; remaining--; }
  return shares.filter(item => item.amountMinor > 0n).sort((left, right) => order(left.instrumentId, right.instrumentId)).map(item => ({ instrumentId: item.instrumentId, amountMinor: Number(item.amountMinor) }));
}
function preparePlan(portfolio, policy, comparison, focus, dca) {
  const candidates = comparison.positions.filter(item => focus.includes(item.instrumentId) && item.deficitMinor > 0);
  const allocations = allocateDeficits(candidates, BigInt(comparison.investmentBudgetMinor));
  const investmentMinor = allocations.reduce((sum, item) => sum + item.amountMinor, 0);
  if (!investmentMinor) return null;
  const cashAfter = portfolio.cashMinor - investmentMinor, fee = policy.feeAllowanceMinor;
  const positionTotalAfter = portfolio.positions.reduce((sum, item) => sum + item.valueMinor, 0) + investmentMinor;
  const installments = dca ? Array.from({ length: policy.dca.installments }, (_, index) => {
    const amounts = allocations.map(item => ({ instrumentId: item.instrumentId, amountMinor: Math.floor(item.amountMinor / policy.dca.installments) + (index < item.amountMinor % policy.dca.installments ? 1 : 0) })).filter(item => item.amountMinor > 0);
    return { ordinal: index + 1, allocations: amounts, investmentMinor: amounts.reduce((sum, item) => sum + item.amountMinor, 0), executeAt: null, revalidateBeforeExecution: true };
  }) : null;
  const invariants = { noExternalInflow: true, investmentWithinSpendCap: investmentMinor + fee <= policy.maxPlanSpendMinor, reserveAndCommitmentsPreserved: cashAfter - fee >= policy.reserveMinor + portfolio.committedCashMinor, cashTargetPreserved: cashAfter - fee >= comparison.cashTargetMinorCeil, noOverdraw: cashAfter - fee >= 0, equityConservedBeforeActualFees: cashAfter + positionTotalAfter === comparison.totalEquityMinor, allocationDeficitsNotExceeded: allocations.every(item => item.amountMinor <= candidates.find(candidate => candidate.instrumentId === item.instrumentId).deficitMinor) };
  if (Object.values(invariants).some(value => !value)) fail('The proposed contribution failed a cash or allocation invariant.', 'proposal_invariant_failed');
  return {
    funding: 'existing-cash-included-in-total-equity', externalInflowMinor: 0, currency: portfolio.currency, minorUnitExponent: portfolio.minorUnitExponent,
    allocations, investmentMinor, feeAllowanceMinor: fee, maximumCashUseIncludingFeeAllowanceMinor: investmentMinor + fee,
    cashBeforeMinor: portfolio.cashMinor, cashAfterInvestmentMinor: cashAfter, cashAfterIfFullFeeAllowanceSpentMinor: cashAfter - fee,
    totalEquityBeforeMinor: comparison.totalEquityMinor, totalEquityAfterInvestmentBeforeActualFeesMinor: cashAfter + positionTotalAfter,
    totalEquityIfFullFeeAllowanceSpentMinor: comparison.totalEquityMinor - fee,
    feeStatus: 'allowance-only-actual-fees-unknown', fundsReserved: false, budgetAuthority: 'one-proposal-only-no-global-reservation', quantityUnits: null, orders: [],
    executionFactsMissing: ['current-quote', 'selected-venue', 'fractional-support', 'actual-costs', 'owner-approval', 'atomic-cash-reservation', 'fill-reconciliation'],
    dca: dca ? { cadence: policy.dca.cadence, installmentCount: policy.dca.installments, installments, scheduled: false, executed: false, futureQuotesFeesPortfolioAndApprovalRequired: true } : null,
    invariants, executed: false, balanceMutation: false,
  };
}

export function preparePortfolioDecisionSync(input) {
  json(input); exact(input, ['method', 'asOf', 'sources', 'assessment', 'portfolio', 'policy']);
  exact(input.method, ['id', 'version']);
  if (input.method.id !== portfolioDecisionManifest.id || input.method.version !== portfolioDecisionManifest.version) fail('Choose the exact supported portfolio method version; latest is not substituted.', 'unknown_portfolio_method');
  const asOf = date(input.asOf), clock = Date.parse(asOf), sources = list(input.sources ?? [], 16), gaps = [];
  for (const source of sources) validatePortfolioSourceSync(source);
  if (new Set(sources.map(source => source.sourceId)).size !== sources.length) fail('Use one exact version of each source ID per decision.');
  if (!sources.length) gap(gaps, 'sources-missing', 'Supply source text and exact provenance before preparing a source-informed size.');
  const policyInfo = inspectPolicy(input.policy, gaps), portfolioInfo = inspectPortfolio(input.portfolio, input.policy, clock, gaps);
  if (input.assessment?.intent === 'prepare-DCA' && !input.policy?.dca) gap(gaps, 'dca-policy-missing', 'Supply an explicit owner DCA installment count and cadence label.');
  if (input.portfolio && input.policy && (input.portfolio.currency !== input.policy.currency || input.portfolio.minorUnitExponent !== input.policy.minorUnitExponent)) gap(gaps, 'valuation-currency-mismatch', 'Portfolio and owner policy must use the same explicit currency and minor-unit exponent; no conversion was assumed.');
  if (policyInfo && portfolioInfo) {
    for (const id of policyInfo.targets.keys()) if (!portfolioInfo.ids.has(id)) gap(gaps, 'target-position-missing', 'A target instrument needs an explicitly valued position or an explicit zero position; a missing balance was not treated as zero.');
    for (const id of portfolioInfo.ids) if (!policyInfo.targets.has(id)) gap(gaps, 'position-target-missing', 'Every valued instrument needs an explicit owner target, including a deliberate zero target.');
    for (const target of input.policy.targets) {
      const position = input.portfolio.positions.find(item => item.instrument.id === target.instrumentId);
      if (position && target.instrumentDigest && digest(position.instrument) !== target.instrumentDigest) gap(gaps, 'target-instrument-identity-changed', 'An owner target no longer matches the exact instrument identity in the portfolio. Reconfirm it instead of substituting an asset.');
    }
  }
  const assessmentInfo = inspectAssessment(input.assessment, sources, portfolioInfo, clock, input.policy, gaps);
  const sourceGapCodes = new Set(['sources-missing', 'assessment-missing', 'assessment-source-mismatch', 'claim-source-missing', 'duplicate-claim', 'claims-missing', 'inference-claim-missing', 'source-text-unavailable', 'source-time-future', 'source-stale', 'instrument-relevance-missing', 'relevance-claim-missing', 'focus-instruments-missing', 'counterevidence-missing', 'counterevidence-claim-mismatch']);
  const hardGaps = gaps.filter(item => item.blocking && !sourceGapCodes.has(item.code));
  const targetChallenged = ['prepare-allocation', 'prepare-DCA'].includes(input.assessment?.intent) && assessmentInfo?.focus.some(id => assessmentInfo.relevance.get(id)?.relation === 'challenges-owner-target');
  // A capacity/deficit comparison is itself numerical sizing context, even when plan is null.
  // Keep owner input snapshots, but do not calculate it through an unresolved proposal gate.
  const comparisonAllowed = !gaps.some(item => item.blocking) && !input.assessment?.proposedPolicyChanges?.length && input.assessment?.intent !== 'review-rebalance' && !targetChallenged;
  const comparison = !comparisonAllowed || !portfolioInfo || !policyInfo ? null : allocationComparison(input.portfolio, input.policy, portfolioInfo.total);
  let status = 'research', reason = 'More source-linked assessment is required.', plan = null;
  if (hardGaps.length) { status = 'blocked'; reason = 'Resolve the named portfolio, identity or owner-policy gaps before sizing.'; }
  else if (input.assessment?.proposedPolicyChanges?.length) {
    status = 'blocked'; reason = 'A proposed target change requires a separate owner decision; the current targets were not changed.';
    gap(gaps, 'owner-target-change-pending', 'A source or agent proposed changing owner allocation targets. No new target was applied.');
  } else if (input.assessment?.intent === 'review-rebalance') {
    status = 'blocked'; reason = 'Rebalancing existing holdings requires owner review; sells, tax lots and orders are unsupported in this contribution-only method.';
    gap(gaps, 'rebalance-review-required', 'This slice can prepare existing-cash contributions, not sell or rebalance existing positions.');
  } else if (gaps.some(item => item.blocking)) {
    status = 'research'; reason = 'Resolve the named evidence or assessment gaps before preparing a size.';
  } else if (input.assessment.intent === 'watch' || input.assessment.intent === 'research') {
    status = input.assessment.intent; reason = status === 'watch' ? 'Record the source-linked watch assessment; no contribution was requested.' : 'Continue research; no contribution was requested.';
  } else if (targetChallenged) {
    status = 'research'; reason = 'The assessment challenges a selected owner target; review that policy before preparing a contribution.';
    gap(gaps, 'owner-target-challenged', 'A cited assessment challenges an existing target; target policy was not changed.', false);
  } else {
    plan = preparePlan(input.portfolio, input.policy, comparison, assessmentInfo.focus, input.assessment.intent === 'prepare-DCA');
    if (plan) { status = input.assessment.intent; reason = 'Prepare a cash-funded contribution toward selected owner-target deficits; this is a proposal requiring a separate owner decision.'; }
    else { status = 'watch'; reason = comparison.investmentBudgetMinor === 0 ? 'No cash is available above the owner cash floor, fee allowance and spend cap.' : 'Selected instruments have no target deficit; no contribution is proposed.'; }
  }
  const payload = {
    format: 'angbao-portfolio-decision@1', method: { id: portfolioDecisionManifest.id, version: portfolioDecisionManifest.version, runtime: portfolioDecisionManifest.runtime, manifestDigest: digest(portfolioDecisionManifest) }, asOf,
    references: { sources: sources.map(source => ({ sourceId: source.sourceId, version: source.version, digest: source.digest })), assessment: input.assessment ? { id: input.assessment.id, version: input.assessment.version, digest: digest(input.assessment) } : null, portfolio: input.portfolio ? { id: input.portfolio.id, version: input.portfolio.version, digest: digest(input.portfolio) } : null, policy: input.policy ? { id: input.policy.id, version: input.policy.version, digest: digest(input.policy) } : null },
    snapshots: { sources: structuredClone(sources), assessment: structuredClone(input.assessment ?? null), portfolio: structuredClone(input.portfolio ?? null), policy: structuredClone(input.policy ?? null) },
    status, reason, gaps, comparison, plan,
    inputScope: { portfolioSource: input.portfolio?.source ?? 'missing', portfolioCoverageDeclared: input.portfolio?.coverage ?? 'unknown', valuations: 'caller-supplied-not-connected-or-independently-verified', ownerTargets: 'explicit-input-not-Angbao-recommended-allocation' },
    rationale: { sourceClaimIds: input.assessment?.claims?.map(claim => claim.id) ?? [], instrumentRelevance: structuredClone(input.assessment?.relevance ?? []), counterevidence: structuredClone(input.assessment?.counterevidence ?? null), agentReportedGaps: structuredClone(input.assessment?.gaps ?? []), calculation: 'Compare all valued positions with explicit owner targets; select only focused deficits and cap the existing-cash contribution by protected cash and total spend allowance.' },
    counterevidence: structuredClone(input.assessment?.counterevidence ?? null), policyChangesApplied: false,
    truth: { inputsIndependentlyVerified: false, agentClaimsVerified: false, sourceContentIsUntrustedData: true, sourceFetches: false, modelCalls: false, portfolioConnected: false, ownerPolicyAuthentication: 'caller-supplied-declaration-not-financial-consent', financialAuthority: false, fundsReserved: false, globalBudgetEnforced: false, ordersSubmitted: false, scheduled: false, memoryWritten: false, onchain: false, digestIsAuthenticityProof: false, historicalSnapshotClock: true },
  };
  const decisionDigest = digest(payload);
  const result = { ...payload, decisionId: `portfolio-decision-${decisionDigest}`, decisionDigest };
  json(result);
  return freeze(result);
}

/** Read integrity only. A current owner-bound transport must supply the expected identity separately. */
export function validatePortfolioDecisionSync(decision, { expectedDigest } = {}) {
  json(decision); exact(decision, ['format', 'method', 'asOf', 'references', 'snapshots', 'status', 'reason', 'gaps', 'comparison', 'plan', 'inputScope', 'rationale', 'counterevidence', 'policyChangesApplied', 'truth', 'decisionId', 'decisionDigest']);
  if (decision.format !== 'angbao-portfolio-decision@1' || !/^[a-f0-9]{64}$/.test(decision.decisionDigest) || decision.decisionId !== `portfolio-decision-${decision.decisionDigest}` || expectedDigest !== undefined && expectedDigest !== decision.decisionDigest) fail('Use the exact selected portfolio decision snapshot.', 'portfolio_decision_mismatch');
  if(!plain(decision.method)||!plain(decision.snapshots))fail('Keep the complete portfolio method and input snapshots.');
  const rebuilt = preparePortfolioDecisionSync({ method: { id: decision.method.id, version: decision.method.version }, asOf: decision.asOf, sources: decision.snapshots.sources, assessment: decision.snapshots.assessment, portfolio: decision.snapshots.portfolio, policy: decision.snapshots.policy });
  if (canonical(rebuilt) !== canonical(decision)) fail('The portfolio decision snapshot or deterministic proposal changed.', 'portfolio_decision_changed');
  return rebuilt;
}

// Preserve the Promise-based API; stored/imported work uses the same full rebuild synchronously.
export async function createPortfolioSource(...args) { return createPortfolioSourceSync(...args); }
export async function validatePortfolioSource(...args) { return validatePortfolioSourceSync(...args); }
export async function portfolioInstrumentReference(...args) { return portfolioInstrumentReferenceSync(...args); }
export async function preparePortfolioDecision(...args) { return preparePortfolioDecisionSync(...args); }
export async function validatePortfolioDecision(...args) { return validatePortfolioDecisionSync(...args); }
