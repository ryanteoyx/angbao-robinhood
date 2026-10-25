/** Pure retained-research to portfolio handoff. No fetch, reasoning, save or authority. */
import { retainedResearchBriefs, saveResearchBrief } from './research-briefs.mjs';
import { researchCanonical, researchDigest, validateResearchWorkRecord, researchWorkReference } from './research-work-record.mjs';
import { createPortfolioSourceSync, validatePortfolioSourceSync, preparePortfolioDecisionSync } from './portfolio-decision.mjs';

export class ResearchPortfolioBridgeError extends Error {
  constructor(message, code = 'invalid_research_portfolio_handoff', status = 400) {
    super(message);
    this.name = 'ResearchPortfolioBridgeError';
    this.code = code;
    this.status = status;
  }
}
const fail = (message, code, status) => { throw new ResearchPortfolioBridgeError(message, code, status); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const same = (left, right) => researchCanonical(left) === researchCanonical(right);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail('Supply exactly the documented handoff fields; missing classifications and observations are not inferred.');
  }
}
function safeJson(value) {
  let count = 0;
  const visiting = new Set();
  function visit(item, depth) {
    if (++count > 30000 || depth > 20) fail('The handoff exceeds its supported complexity.');
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') {
      if (item.length > 20000) fail('Handoff text is too long; nothing was truncated.');
      return;
    }
    if ((!plain(item) && !Array.isArray(item)) || visiting.has(item)) fail('Supply plain non-cyclic handoff JSON.');
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) {
      fail('Use dense handoff lists without additional properties.');
    }
    visiting.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail('Handoff JSON cannot contain executable, hidden or prototype properties.');
      }
      visit(descriptor.value, depth + 1);
    }
    visiting.delete(item);
  }
  visit(value, 0);
  if (Buffer.byteLength(researchCanonical(value)) > 262144) fail('The handoff exceeds 256 KiB; nothing was truncated.');
}
const sourceFields = ['sourceId', 'version', 'channel', 'capture', 'contentKind', 'url', 'text', 'publishedAt', 'observedAt'];

function validateLinkedWork(brief, work, expectedDigest) {
  const retained = validateResearchWorkRecord(work);
  if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest) || researchDigest(retained) !== expectedDigest) {
    fail('The complete research-work record differs from its expected digest.', 'research_work_digest_mismatch', 409);
  }
  if (retained.briefId !== brief.id || retained.completedAt === null || retained.memory.authoredOutput === null
    || !brief.methodRunRef || !same(researchWorkReference(retained), brief.methodRunRef)) {
    fail('Use the exact completed research work linked from this saved brief.', 'research_work_link_mismatch', 409);
  }
  // Reuse the native constructor's content normalization, as local-continuity does.
  // Only compare content; its detached state and generated IDs are discarded, never saved.
  const normalized = saveResearchBrief({ researchBriefs: [] }, retained.memory.authoredOutput.brief, new Date(brief.createdAt)).brief;
  const fields = ['question', 'answer', 'authorship', 'evidence', 'claims', 'inferences', 'gaps'];
  if (fields.some(key => !same(normalized[key], brief[key]))) {
    fail('The saved brief content differs from its completed method output.', 'research_work_link_mismatch', 409);
  }
  return retained;
}

function selectedCard(work, reference, evidence) {
  if (!work) fail('A selected-card binding requires its exact retained research work.', 'research_portfolio_needs_input');
  exact(reference, ['packDigest', 'provider', 'recordId']);
  const run = work.memory.run;
  const card = run.output.cards.find(item => item.packDigest === reference.packDigest && item.provider === reference.provider && item.recordId === reference.recordId);
  const citation = run.output.allowedEvidence.find(item => item.id === evidence.id);
  const { provenance, ...retainedCitation } = evidence;
  if (!card || !card.citationIds.includes(evidence.id) || !citation || !same(citation, retainedCitation)) {
    fail('This citation is not bound to that exact selected research card.', 'research_card_mapping_mismatch');
  }
  return { card, provenance: run.inputProvenance.find(item => item.digest === card.packDigest) };
}

function bindEvidence(brief, bindings, work) {
  if (!Array.isArray(bindings) || bindings.length !== brief.evidence.length) {
    fail('Map every retained evidence item exactly once; omitted or additional evidence needs a new brief.');
  }
  const evidenceById = new Map(brief.evidence.map(item => [item.id, item]));
  const byEvidence = new Map(), sourceIds = new Set(), sources = [], sourceMapping = [];
  for (const binding of bindings) {
    if (!plain(binding)) fail('Each evidence binding must be a plain object.');
    const hasCard = Object.hasOwn(binding, 'workCardRef');
    exact(binding, ['evidenceId', 'source', ...(hasCard ? ['workCardRef'] : [])]);
    exact(binding.source, sourceFields);
    const evidence = evidenceById.get(binding.evidenceId), sourceInput = binding.source;
    if (!evidence || byEvidence.has(binding.evidenceId) || sourceIds.has(sourceInput.sourceId)) {
      fail('Evidence and source IDs must be known, unique and mapped one-to-one.', 'research_source_mapping_mismatch');
    }
    if (!Object.hasOwn(evidence, 'observedAt') || evidence.observedAt === null || !Object.hasOwn(evidence, 'publishedAt')) {
      fail('This saved evidence needs an explicit observation time and an explicit publication time or null. Save a new version; now is not substituted.', 'research_portfolio_needs_input');
    }
    const selected = hasCard ? selectedCard(work, binding.workCardRef, evidence) : null;
    const card = selected?.card;
    // Native source-reference cards retain citation membership, not which URL owns
    // originalPostText. Neither citation order nor a sole citation proves that origin.
    if (card?.kind === 'source-reference' && (sourceInput.text !== null || sourceInput.contentKind !== 'link-only')) {
      fail('The selected source-reference card does not retain original body-to-URL provenance. Keep this citation link-only; supply separately retained source evidence before sizing.', 'research_portfolio_needs_input');
    }
    const summaryCard = card?.kind === 'provider-summary';
    const retainedText = card ? summaryCard ? card.summary?.text : null : evidence.excerpt === '' ? null : evidence.excerpt;
    const publishedAt = summaryCard ? card.publishedAt : evidence.publishedAt;
    const observedAt = summaryCard ? card.retrievedAt : evidence.observedAt;
    if (card?.kind === 'provider-summary' && (typeof retainedText !== 'string' || !retainedText.trim())) {
      fail('The selected provider summary has no retained body; do not reconstruct it from an answer or title.', 'research_portfolio_needs_input');
    }
    if (card?.kind === 'provider-summary' && (sourceInput.contentKind !== 'derived-summary'
      || card.provider === 'elfa' && sourceInput.capture !== 'elfa-derived')) {
      fail('Selected provider summaries must stay derived; an Elfa summary must retain elfa-derived capture.', 'research_card_mapping_mismatch');
    }
    if (sourceInput.url !== evidence.url || sourceInput.text !== retainedText
      || sourceInput.publishedAt !== publishedAt || sourceInput.observedAt !== observedAt) {
      fail('Keep the retained evidence URL, complete excerpt and exact timestamps. New text requires a new research version.', 'research_source_mapping_mismatch');
    }
    if (retainedText === null && sourceInput.contentKind !== 'link-only') {
      fail('This retained citation has no source text. Keep it link-only; do not manufacture an article or provider summary.', 'research_portfolio_needs_input');
    }
    const source = validatePortfolioSourceSync(createPortfolioSourceSync(sourceInput));
    // Normalization must not quietly rewrite a retained URL or any supplied source field.
    if (sourceFields.some(key => !same(source[key], sourceInput[key]))) {
      fail('Source normalization would change retained content; explicitly save canonical evidence first.', 'research_source_mapping_mismatch');
    }
    byEvidence.set(evidence.id, source);
    sourceIds.add(source.sourceId);
    sources.push(source);
    sourceMapping.push({
      evidenceId: evidence.id,
      evidenceDigest: researchDigest(evidence),
      sourceRef: { sourceId: source.sourceId, version: source.version, digest: source.digest },
      classification: { channel: source.channel, capture: source.capture, contentKind: source.contentKind, verification: 'caller-declared-unverified' },
      publishedAt: source.publishedAt, observedAt: source.observedAt,
      ...(selected ? {
        workCardRef: { ...binding.workCardRef, digest: researchDigest(card) },
        retainedCard: card,
        packProvenance: selected.provenance,
        citation: { url: evidence.url, publishedAt: evidence.publishedAt, observedAt: evidence.observedAt },
      } : {}),
    });
  }
  return { byEvidence, sources, sourceMapping };
}

function checkAssessment(brief, assessment, sources, byEvidence, portfolio) {
  if (!plain(assessment) || assessment.format !== 'angbao-portfolio-assessment@1' || assessment.authorship !== 'agent-authored') {
    fail('A personal agent must supply a separate typed portfolio assessment. Research prose does not select an action.', 'research_portfolio_needs_input');
  }
  if (!Array.isArray(assessment.sourceRefs) || assessment.sourceRefs.length !== sources.length
    || new Set(assessment.sourceRefs.map(ref => ref?.sourceId)).size !== sources.length
    || assessment.sourceRefs.some(ref => !sources.some(source => same(ref, { sourceId: source.sourceId, digest: source.digest })))) {
    fail('The assessment must explicitly reference every exact constructed source digest.', 'research_assessment_mapping_mismatch');
  }
  if (!Array.isArray(assessment.claims) || assessment.claims.length !== brief.claims.length
    || new Set(assessment.claims.map(claim => claim?.id)).size !== brief.claims.length) {
    fail('Preserve every saved supporting and contradicting claim exactly once.', 'research_assessment_mapping_mismatch');
  }
  for (const retained of brief.claims) {
    const claim = assessment.claims.find(item => item?.id === retained.id);
    const expected = { id: retained.id, stance: retained.stance, text: retained.text, sourceIds: retained.evidenceIds.map(id => byEvidence.get(id).sourceId) };
    if (!same(claim, expected)) fail('Claims must keep their text, stance and explicit evidence-to-source mapping.', 'research_assessment_mapping_mismatch');
  }
  if (!Array.isArray(assessment.inferences) || brief.inferences.some(inference => !assessment.inferences.some(item => same(item, inference)))
    || !Array.isArray(assessment.gaps) || brief.gaps.some(gap => !assessment.gaps.includes(gap))) {
    fail('Preserve the saved inferences and gaps; separately authored portfolio reasoning may add to them, not remove them.', 'research_assessment_mapping_mismatch');
  }
  const claimIds = new Set(brief.claims.map(claim => claim.id));
  const counters = brief.claims.filter(claim => claim.stance === 'contradicting').map(claim => claim.id);
  if (!plain(assessment.counterevidence) || !Array.isArray(assessment.counterevidence.claimIds)
    || counters.some(id => !assessment.counterevidence.claimIds.includes(id))) {
    fail('Carry every retained counterclaim into the explicit counterevidence assessment.', 'research_assessment_mapping_mismatch');
  }
  if (!Array.isArray(assessment.relevance) || !Array.isArray(assessment.focusInstrumentIds) || !Array.isArray(portfolio?.positions)) {
    fail('Supply explicit claim-to-instrument relationships and a dated portfolio; display tickers are not mappings.', 'research_portfolio_needs_input');
  }
  const instruments = new Set(portfolio.positions.map(position => position?.instrument?.id));
  const relevant = new Set();
  for (const item of assessment.relevance) {
    if (!plain(item) || !instruments.has(item.instrumentId) || relevant.has(item.instrumentId)
      || !Array.isArray(item.claimIds) || !item.claimIds.length || new Set(item.claimIds).size !== item.claimIds.length
      || item.claimIds.some(id => !claimIds.has(id))) {
      fail('Instrument relevance must name one exact portfolio instrument and retained claims; no asset alias is substituted.', 'research_instrument_mapping_mismatch');
    }
    relevant.add(item.instrumentId);
  }
  if (assessment.focusInstrumentIds.some(id => !instruments.has(id) || !relevant.has(id))) {
    fail('Every selected instrument needs an explicit retained-claim relationship.', 'research_instrument_mapping_mismatch');
  }
}

/** Transport must resolve the retained brief/digest from authorized memory; hashes grant no access. */
export function prepareResearchPortfolioHandoff(args) {
  safeJson(args);
  if (!plain(args)) fail('Supply the documented handoff object.');
  const hasWork = Object.hasOwn(args, 'researchWork') || Object.hasOwn(args, 'expectedResearchWorkDigest');
  exact(args, ['brief', 'expectedBriefDigest', 'evidenceBindings', 'assessment', 'portfolio', 'policy', 'asOf', ...(hasWork ? ['researchWork', 'expectedResearchWorkDigest'] : [])]);
  const { brief, expectedBriefDigest, evidenceBindings, assessment, portfolio, policy, asOf, researchWork, expectedResearchWorkDigest } = structuredClone(args);
  const [retained] = retainedResearchBriefs({ researchBriefs: [brief] });
  if (typeof expectedBriefDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedBriefDigest)
    || researchDigest(retained) !== expectedBriefDigest) {
    fail('The complete saved research record differs from its expected handoff digest. Reopen the exact version.', 'research_brief_digest_mismatch', 409);
  }
  const work = hasWork ? validateLinkedWork(retained, researchWork, expectedResearchWorkDigest) : null;
  const { byEvidence, sources, sourceMapping } = bindEvidence(retained, evidenceBindings, work);
  checkAssessment(retained, assessment, sources, byEvidence, portfolio);
  const input = { method: { id: 'portfolio-contribution', version: '1.0.0' }, asOf, sources, assessment, portfolio, policy };
  // This is the sole calculation boundary. All monetary, freshness and policy checks stay there.
  const decision = preparePortfolioDecisionSync(input);
  const payload = {
    format: 'angbao-research-portfolio-handoff@1',
    researchRef: {
      kind: 'research-brief', recordId: retained.id, seriesId: retained.seriesId, version: retained.version,
      digest: expectedBriefDigest, createdAt: retained.createdAt, verification: retained.verification,
      methodRunRef: retained.methodRunRef ?? null,
    },
    ...(work ? { researchWorkRef: { kind: 'research-method', recordId: work.id, digest: expectedResearchWorkDigest, ...researchWorkReference(work) } } : {}),
    sourceMapping, input, decision,
    gaps: [...decision.gaps, ...retained.gaps.map(detail => ({ code: 'retained-research-gap', detail, blocking: false }))],
    saved: false, financialAuthority: false,
  };
  safeJson(payload);
  return freeze({ ...payload, digest: researchDigest(payload) });
}
