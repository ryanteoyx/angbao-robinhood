/** Pure, bounded research preparation. Sources are data; a personal agent supplies the answer. */
import { createHash } from 'node:crypto';
import { validateResearchBriefInput } from './research-briefs.mjs';

const LIMITS = Object.freeze({ packs: 4, records: 120, bytes: 1_048_576, citations: 12 });
const PACK_KEYS = ['format', 'provider', 'operation', 'endpoint', 'query', 'retrievedAt', 'status', 'evidence', 'pagination', 'coverage', 'entities', 'resolution'];
const RECORD_KEYS = ['id', 'kind', 'provider', 'apiVersion', 'endpoint', 'sourceRecordId', 'sourceUrl', 'publishedAt', 'publishedAtBasis', 'retrievedAt', 'summary', 'originalPostText', 'engagement', 'verification', 'providerAnalyzedAt', 'providerFirstSeenAt', 'storylineId', 'citations', 'entities', 'issues', 'storyline'];
const PRIVATE = /-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_[A-Za-z0-9_-]+|\babp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export class ResearchMethodError extends Error {
  constructor(message, code = 'invalid_research_method') { super(message); this.name = 'ResearchMethodError'; this.code = code; this.status = 400; }
}
const fail = (message, code) => { throw new ResearchMethodError(message, code); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }

function exact(value, allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Use only the documented research method fields.');
}
function text(value, max, optional = false) {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || PRIVATE.test(value)) fail('Use bounded plain research text without credentials.');
  return value.trim();
}
function date(value, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Use a canonical ISO timestamp, or null for an unknown publication time.');
  return value;
}
function count(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail('A research method limit is outside its supported range.'); return value; }
function list(value, max) { if (!Array.isArray(value) || value.length > max) fail('A research list exceeds its supported limit.'); return value; }
function sourceUrl(value) {
  if (value === null || value === undefined) return null;
  let url; try { url = new URL(text(value, 2000)); } catch { fail('Use a public HTTPS citation without credentials.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.includes(':') || /\.(?:localhost|local|internal)$/i.test(url.hostname) || [...url.searchParams.keys()].some(key => /token|key|secret|auth|signature|credential/i.test(key))) fail('Use a public HTTPS citation without credentials.');
  if (url.href.length > 2000) fail('The canonical HTTPS citation exceeds its supported length.');
  return url.href;
}
/** Reject executable/accessor/cyclic/non-JSON values before hashing; no code or URLs are run. */
function boundedJson(value) {
  let nodes = 0; const visiting = new Set();
  function visit(item, depth) {
    if (++nodes > 40_000 || depth > 16) fail('This evidence pack is too complex.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > 20_000 || PRIVATE.test(item) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item)) fail('Remove credentials or unsupported text from the evidence pack.'); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('Use finite JSON numbers.'); return; }
    if ((!plain(item) && !Array.isArray(item)) || visiting.has(item)) fail('Use plain, non-cyclic JSON research data.');
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) fail('Use dense JSON lists without extra properties.');
    visiting.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (key === 'length' && Array.isArray(item)) continue;
      if (typeof key !== 'string' || key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('This research data has an unsupported property.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Research data cannot contain accessors or hidden properties.');
      visit(descriptor.value, depth + 1);
    }
    visiting.delete(item);
  }
  visit(value, 0);
  if (new TextEncoder().encode(canonical(value)).byteLength > LIMITS.bytes) fail('This research input exceeds 1 MiB.');
}

export const researchMethodManifests = freeze([{
  format: 'angbao-research-method-manifest@1', manifestVersion: 1,
  id: 'evidence-review', version: '1.0.0', runtime: 'bounded-evidence-selection@1',
  inputSchema: 'angbao-research-evidence@1[]', outputSchema: 'angbao-research-authoring-input@1',
  requestedScopes: [], financialAuthority: 'none',
  capabilities: ['select-supplied-evidence', 'prepare-authoring-input', 'validate-authored-brief'],
  settingsSchema: { type: 'object', additionalProperties: false, properties: {
    providers: { type: 'array', maxItems: 8, description: 'Explicit provider identifiers; an empty list accepts every supplied provider.' },
    includeProviderSummaries: { type: 'boolean' },
    maxObservationAgeHours: { type: 'integer', minimum: 1, maximum: 744, description: 'Age since retrieval, never the publication age.' },
    maxPublishedAgeHours: { type: 'integer', minimum: 1, maximum: 8760 },
    unknownPublicationTime: { enum: ['include-with-gap', 'exclude'] },
    maxEvidence: { type: 'integer', minimum: 1, maximum: 12 },
    minCitedClaims: { type: 'integer', minimum: 1, maximum: 12 },
    checkContradictions: { type: 'boolean', description: 'Require a cited counterclaim or the exact missing-counterevidence gap.' },
  } },
  defaultSettings: { providers: [], includeProviderSummaries: true, maxObservationAgeHours: 24, maxPublishedAgeHours: 168, unknownPublicationTime: 'include-with-gap', maxEvidence: 8, minCitedClaims: 1, checkContradictions: true },
}]);

export function researchMethodManifest(reference) {
  boundedJson(reference); exact(reference, ['id', 'version']);
  const manifest = researchMethodManifests.find(item => item.id === reference.id && item.version === reference.version);
  if (!manifest) fail('Choose an exact supported research method ID and version. No latest-version substitution was made.', 'unknown_research_method');
  return manifest;
}
function settingsFor(manifest, supplied = {}) {
  exact(supplied, Object.keys(manifest.defaultSettings));
  const result = structuredClone({ ...manifest.defaultSettings, ...supplied });
  list(result.providers, 8).forEach(value => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value)) fail('Use explicit provider identifiers.'); });
  if (new Set(result.providers).size !== result.providers.length) fail('Do not repeat a provider identifier.');
  result.providers.sort();
  for (const key of ['includeProviderSummaries', 'checkContradictions']) if (typeof result[key] !== 'boolean') fail('Use a boolean research setting.');
  count(result.maxObservationAgeHours, 1, 744); count(result.maxPublishedAgeHours, 1, 8760);
  count(result.maxEvidence, 1, 12); count(result.minCitedClaims, 1, 12);
  if (!['include-with-gap', 'exclude'].includes(result.unknownPublicationTime)) fail('Choose how to handle unknown source publication times.');
  return result;
}
function validatePack(pack, asOf) {
  exact(pack, PACK_KEYS);
  if (pack.format !== 'angbao-research-evidence@1' || !/^[a-z][a-z0-9-]{0,39}$/.test(pack.provider) || !['observed', 'partial', 'empty'].includes(pack.status)) fail('Use the normalized research evidence envelope.');
  text(pack.operation, 80); text(pack.endpoint, 160); date(pack.retrievedAt);
  if (Date.parse(pack.retrievedAt) > asOf) fail('Evidence retrieval is later than this run’s as-of time.');
  if (pack.status === 'empty' && pack.evidence?.length) fail('An empty evidence envelope cannot contain records.');
  const ids = new Set();
  for (const record of list(pack.evidence, LIMITS.records)) {
    exact(record, RECORD_KEYS);
    text(record.id, 200); text(record.sourceRecordId, 500); text(record.verification, 160);
    if (!['source-reference', 'provider-summary'].includes(record.kind) || record.provider !== pack.provider || record.retrievedAt !== pack.retrievedAt || ids.has(record.id)) fail('Evidence record identity or retrieval provenance is inconsistent.');
    ids.add(record.id); date(record.retrievedAt); date(record.publishedAt, true); sourceUrl(record.sourceUrl);
    if (record.publishedAt && Date.parse(record.publishedAt) > asOf) fail('A source publication time is later than this run.');
    for (const field of ['providerAnalyzedAt', 'providerFirstSeenAt']) if (record[field] != null) {
      date(record[field]); if (Date.parse(record[field]) > asOf) fail('A provider observation time is later than this run.');
    }
    if (record.summary !== null && record.summary !== undefined) {
      exact(record.summary, ['title', 'text', 'origin']);
      text(record.summary.title, 4000, true); text(record.summary.text, 16000, true); text(record.summary.origin, 160);
    }
    if (record.originalPostText != null) text(record.originalPostText, 16000);
    for (const citation of list(record.citations ?? [], 10)) {
      exact(citation, ['source', 'sourceRecordId', 'handle', 'sourceUrl', 'publishedAt']);
      text(citation.source, 80); text(citation.sourceRecordId, 500); text(citation.handle, 200, true); sourceUrl(citation.sourceUrl); date(citation.publishedAt, true);
      if (citation.publishedAt && Date.parse(citation.publishedAt) > asOf) fail('A citation publication time is later than this run.');
    }
    list(record.issues ?? [], 24).forEach(issue => text(issue, 160));
  }
  if (pack.coverage !== undefined) {
    if (!plain(pack.coverage) || typeof pack.coverage.complete !== 'boolean') fail('Retain explicit provider coverage, including unknown coverage.');
    list(pack.coverage.issues ?? [], 24).forEach(issue => text(issue, 160));
  }
}

const GAP_TEXT = freeze({
  coverage: 'The supplied provider evidence is bounded; complete market, topic and source coverage has not been established.',
  unknownPublication: 'Some selected sources have unknown publication times. Retrieval and provider analysis times are not substitutes for source publication times.',
  unavailableOriginal: 'Original source text is unavailable for some selected records. Provider summaries and links do not independently verify the original claims.',
  providerSummary: 'Selected provider summaries are derived interpretations, not independent verification or final Angbao synthesis.',
  filtered: 'Some supplied records were excluded by this method’s source, age or publication-time settings. Their exclusion does not refute their content.',
  truncated: 'The configured evidence or citation limit omitted some otherwise eligible material.',
  noEvidence: 'No eligible public citation remains. Supply an appropriate source pack before authoring a cited answer.',
});
export const MISSING_COUNTEREVIDENCE_GAP = 'No cited contradicting claim was supplied. This does not establish that contradicting evidence is absent.';

async function buildRun(input, baseline = null) {
  boundedJson(input); exact(input, ['method', 'settings', 'question', 'evidencePacks', 'asOf']);
  const manifest = researchMethodManifest(input.method), settings = settingsFor(manifest, input.settings), question = text(input.question, 500), asOf = date(input.asOf);
  const clock = Date.parse(asOf), packs = list(input.evidencePacks, LIMITS.packs);
  if (!packs.length) fail('Supply at least one normalized evidence pack.');
  packs.forEach(pack => validatePack(pack, clock));
  const provenance = [], eligible = [], omitted = [], seen = new Set(); let totalRecords = 0;
  for (const pack of packs) {
    const packDigest = await digest(pack);
    if (provenance.some(item => item.digest === packDigest)) fail('Do not supply the same evidence pack twice.');
    provenance.push({ digest: packDigest, format: pack.format, provider: pack.provider, operation: pack.operation, endpoint: pack.endpoint, query: structuredClone(pack.query ?? null), retrievedAt: pack.retrievedAt, status: pack.status, coverage: structuredClone(pack.coverage ?? null), pagination: structuredClone(pack.pagination ?? null), recordCount: pack.evidence.length });
    for (const record of pack.evidence) {
      if (++totalRecords > LIMITS.records) fail('The combined evidence pack exceeds 120 records.');
      const identity = `${pack.provider}\0${record.id}`;
      if (seen.has(identity)) fail('The same provider record appears more than once. Select the intended observation explicitly.');
      seen.add(identity);
      let reason = null;
      if (settings.providers.length && !settings.providers.includes(pack.provider)) reason = 'provider-filter';
      else if (record.kind === 'provider-summary' && !settings.includeProviderSummaries) reason = 'provider-summary-disabled';
      else if (clock - Date.parse(record.retrievedAt) > settings.maxObservationAgeHours * 3_600_000) reason = 'observation-too-old';
      else if (!record.publishedAt && settings.unknownPublicationTime === 'exclude') reason = 'publication-time-unknown';
      else if (record.publishedAt && clock - Date.parse(record.publishedAt) > settings.maxPublishedAgeHours * 3_600_000) reason = 'publication-too-old';
      const reference = { packDigest, provider: pack.provider, recordId: record.id };
      if (reason) omitted.push({ ...reference, reason }); else eligible.push({ ...reference, record });
    }
  }
  // Retrieval recency is only a deterministic presentation order, never a truth or popularity score.
  const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  eligible.sort((left, right) => Date.parse(right.record.retrievedAt) - Date.parse(left.record.retrievedAt) || order(left.provider, right.provider) || order(left.recordId, right.recordId));
  const selected = eligible.slice(0, settings.maxEvidence), cards = [], citations = [], citationUrls = new Map(), omittedCitations = []; let citationLimitReached = false;
  for (const item of eligible.slice(settings.maxEvidence)) omitted.push({ packDigest: item.packDigest, provider: item.provider, recordId: item.recordId, reason: 'evidence-limit' });
  for (const item of selected) {
    const { record } = item;
    const card = { packDigest: item.packDigest, provider: item.provider, recordId: record.id, kind: record.kind, verification: 'unverified', providerReportedVerification: record.verification, retrievedAt: record.retrievedAt, publishedAt: record.publishedAt ?? null, providerAnalyzedAt: record.providerAnalyzedAt ?? null, providerFirstSeenAt: record.providerFirstSeenAt ?? null, summary: structuredClone(record.summary ?? null), originalPostText: record.originalPostText ?? null, issues: structuredClone(record.issues ?? []), citationIds: [] };
    const references = [...(record.sourceUrl ? [{ sourceUrl: record.sourceUrl, publishedAt: record.publishedAt ?? null }] : []), ...(record.citations ?? [])];
    for (const reference of references) {
      if (!reference.sourceUrl) continue;
      const citationReason = !reference.publishedAt && settings.unknownPublicationTime === 'exclude' ? 'publication-time-unknown' : reference.publishedAt && clock - Date.parse(reference.publishedAt) > settings.maxPublishedAgeHours * 3_600_000 ? 'publication-too-old' : null;
      if (citationReason) { omittedCitations.push({ packDigest: item.packDigest, provider: item.provider, recordId: record.id, sourceUrl: sourceUrl(reference.sourceUrl), reason: citationReason }); continue; }
      const url = sourceUrl(reference.sourceUrl), key = `${item.packDigest}\0${record.id}\0${url}`;
      let citation = citationUrls.get(key);
      if (!citation) {
        if (citations.length === LIMITS.citations) { citationLimitReached = true; continue; }
        const id = `source-${(await digest(key)).slice(0, 24)}`;
        citation = { id, title: `${item.provider} source reference`.slice(0, 160), url, publishedAt: reference.publishedAt ?? null, observedAt: record.retrievedAt, excerpt: '' };
        citations.push(citation); citationUrls.set(key, citation);
      }
      if (!card.citationIds.includes(citation.id)) card.citationIds.push(citation.id);
    }
    cards.push(card);
  }
  const gaps = [{ code: 'coverage', text: GAP_TEXT.coverage }];
  if (cards.some(card => !card.publishedAt) || citations.some(citation => !citation.publishedAt)) gaps.push({ code: 'unknownPublication', text: GAP_TEXT.unknownPublication });
  if (cards.some(card => !card.originalPostText)) gaps.push({ code: 'unavailableOriginal', text: GAP_TEXT.unavailableOriginal });
  if (cards.some(card => card.kind === 'provider-summary')) gaps.push({ code: 'providerSummary', text: GAP_TEXT.providerSummary });
  if (omitted.some(item => item.reason !== 'evidence-limit') || omittedCitations.length) gaps.push({ code: 'filtered', text: GAP_TEXT.filtered });
  if (citationLimitReached || omitted.some(item => item.reason === 'evidence-limit')) gaps.push({ code: 'truncated', text: GAP_TEXT.truncated });
  if (!citations.length) gaps.push({ code: 'noEvidence', text: GAP_TEXT.noEvidence });
  const payload = {
    format: 'angbao-research-method-run@1',
    method: { id: manifest.id, version: manifest.version, runtime: manifest.runtime, manifestDigest: await digest(manifest) },
    settings, question, asOf, baseline, inputProvenance: provenance,
    output: { format: 'angbao-research-authoring-input@1', status: citations.length ? 'ready-for-agent-authoring' : 'needs-evidence', cards, allowedEvidence: citations, omissions: omitted, omittedCitations, requiredGaps: gaps, requirements: { minCitedClaims: settings.minCitedClaims, contradiction: settings.checkContradictions ? 'cited-counterclaim-or-explicit-gap' : 'optional', missingCounterevidenceGap: MISSING_COUNTEREVIDENCE_GAP }, answer: null, authoredBrief: null },
    truth: { synthesisPerformed: false, independentVerification: false, providerCalls: false, modelCalls: false, memoryWritten: false, financialAuthority: false, financialExecution: false, onchain: false, sourceContentIsUntrustedData: true, digestIsAuthenticityProof: false },
  };
  const runDigest = await digest(payload);
  const result = { ...payload, runId: `research-run-${runDigest}`, runDigest };
  boundedJson(result);
  return freeze(result);
}

/** No account, provider access, persistence, inference or background work. */
export async function prepareResearchMethodRun(input) { return buildRun(input); }

function required(value,keys){exact(value,keys);if(keys.some(key=>!Object.hasOwn(value,key)))fail('The complete prepared method schema is required.');}
function validatePreparedSelection(run){
 const clock=Date.parse(run.asOf),packs=new Map(),counts=new Map(),identities=new Set(),cards=new Map(),citations=new Map(run.output.allowedEvidence.map(item=>[item.id,item]));
 let total=0;
 for(const item of run.inputProvenance){
  required(item,['digest','format','provider','operation','endpoint','query','retrievedAt','status','coverage','pagination','recordCount']);
  if(packs.has(item.digest)||!/^[a-z][a-z0-9-]{0,39}$/.test(item.provider)||!['observed','partial','empty'].includes(item.status)||Date.parse(item.retrievedAt)>clock||item.status==='empty'&&item.recordCount!==0)fail('The prepared pack identity, status or observation time is inconsistent.');
  if(item.coverage!==null){if(!plain(item.coverage)||typeof item.coverage.complete!=='boolean')fail('Retain explicit source coverage.');list(item.coverage.issues??[],24).forEach(issue=>text(issue,160));}
  total+=item.recordCount;if(total>LIMITS.records)fail('The combined prepared records exceed their supported limit.');packs.set(item.digest,item);counts.set(item.digest,0);
 }
 function reference(item){
  text(item.recordId,200);const pack=packs.get(item.packDigest),identity=`${item.provider}\0${item.recordId}`;
  if(!pack||item.provider!==pack.provider||identities.has(identity))fail('The selected record does not match its unique supplied-pack reference.');
  identities.add(identity);counts.set(item.packDigest,counts.get(item.packDigest)+1);return pack;
 }
 let previous=null;
 for(const card of run.output.cards){
  required(card,['packDigest','provider','recordId','kind','verification','providerReportedVerification','retrievedAt','publishedAt','providerAnalyzedAt','providerFirstSeenAt','summary','originalPostText','issues','citationIds']);
  const pack=reference(card);text(card.providerReportedVerification,160);
  if(!['source-reference','provider-summary'].includes(card.kind)||card.verification!=='unverified'||card.retrievedAt!==pack.retrievedAt)fail('The selected source card has invalid provenance.');
  for(const field of ['retrievedAt','publishedAt','providerAnalyzedAt','providerFirstSeenAt']){date(card[field],field!=='retrievedAt');if(card[field]&&Date.parse(card[field])>clock)fail('Prepared source dates cannot be later than the run.');}
  if(run.settings.providers.length&&!run.settings.providers.includes(card.provider)||card.kind==='provider-summary'&&!run.settings.includeProviderSummaries||clock-Date.parse(card.retrievedAt)>run.settings.maxObservationAgeHours*3600000||!card.publishedAt&&run.settings.unknownPublicationTime==='exclude'||card.publishedAt&&clock-Date.parse(card.publishedAt)>run.settings.maxPublishedAgeHours*3600000)fail('A selected card violates the pinned method settings.');
  if(previous&&(Date.parse(card.retrievedAt)>Date.parse(previous.retrievedAt)||card.retrievedAt===previous.retrievedAt&&(card.provider<previous.provider||card.provider===previous.provider&&card.recordId<previous.recordId)))fail('Keep the deterministic selected-source order.');previous=card;
  if(card.summary!==null){required(card.summary,['title','text','origin']);text(card.summary.title,4000,true);text(card.summary.text,16000,true);text(card.summary.origin,160);}
  if(card.originalPostText!==null)text(card.originalPostText,16000);
  list(card.issues,24).forEach(issue=>text(issue,160));list(card.citationIds,LIMITS.citations);if(new Set(card.citationIds).size!==card.citationIds.length)fail('Do not duplicate a selected citation.');
  for(const id of card.citationIds){const citation=citations.get(id);if(!citation||id!==`source-${digest(`${card.packDigest}\0${card.recordId}\0${citation.url}`).slice(0,24)}`||citation.title!==`${card.provider} source reference`.slice(0,160)||citation.observedAt!==card.retrievedAt||citation.excerpt!=='')fail('The citation does not match the exact selected source card.');}
  cards.set(`${card.packDigest}\0${card.recordId}`,card);
 }
 for(const citation of citations.values()){
  required(citation,['id','title','url','publishedAt','observedAt','excerpt']);
  if(sourceUrl(citation.url)!==citation.url||!run.output.cards.some(card=>card.citationIds.includes(citation.id))||citation.publishedAt&&Date.parse(citation.publishedAt)>clock||!citation.publishedAt&&run.settings.unknownPublicationTime==='exclude'||citation.publishedAt&&clock-Date.parse(citation.publishedAt)>run.settings.maxPublishedAgeHours*3600000)fail('The prepared citation is unlinked or violates the selected source policy.');
 }
 for(const omission of run.output.omissions){
  required(omission,['packDigest','provider','recordId','reason']);const pack=reference(omission);
  if(!['provider-filter','provider-summary-disabled','observation-too-old','publication-time-unknown','publication-too-old','evidence-limit'].includes(omission.reason)||omission.reason==='provider-filter'&&(!run.settings.providers.length||run.settings.providers.includes(omission.provider))||omission.reason==='provider-summary-disabled'&&run.settings.includeProviderSummaries||omission.reason==='observation-too-old'&&clock-Date.parse(pack.retrievedAt)<=run.settings.maxObservationAgeHours*3600000||omission.reason==='publication-time-unknown'&&run.settings.unknownPublicationTime!=='exclude'||omission.reason==='evidence-limit'&&run.output.cards.length!==run.settings.maxEvidence)fail('The source omission conflicts with the pinned method.');
 }
 for(const [key,pack] of packs)if(counts.get(key)!==pack.recordCount)fail('Keep the complete selected and omitted record counts for every source pack.');
 for(const omission of run.output.omittedCitations){
  required(omission,['packDigest','provider','recordId','sourceUrl','reason']);const card=cards.get(`${omission.packDigest}\0${omission.recordId}`);
  if(!card||card.provider!==omission.provider||sourceUrl(omission.sourceUrl)!==omission.sourceUrl||!['publication-time-unknown','publication-too-old'].includes(omission.reason)||omission.reason==='publication-time-unknown'&&run.settings.unknownPublicationTime!=='exclude')fail('The omitted citation must refer to a selected source and its policy.');
 }
 const requiredCodes=['coverage'];
 if(run.output.cards.some(card=>!card.publishedAt)||run.output.allowedEvidence.some(citation=>!citation.publishedAt))requiredCodes.push('unknownPublication');
 if(run.output.cards.some(card=>!card.originalPostText))requiredCodes.push('unavailableOriginal');
 if(run.output.cards.some(card=>card.kind==='provider-summary'))requiredCodes.push('providerSummary');
 if(run.output.omissions.some(item=>item.reason!=='evidence-limit')||run.output.omittedCitations.length)requiredCodes.push('filtered');
 const truncated=run.output.requiredGaps.some(gap=>gap.code==='truncated');
 if(run.output.omissions.some(item=>item.reason==='evidence-limit')||truncated){if(!run.output.omissions.some(item=>item.reason==='evidence-limit')&&citations.size!==LIMITS.citations)fail('The truncation gap has no bounded source or citation limit.');requiredCodes.push('truncated');}
 if(!citations.size)requiredCodes.push('noEvidence');
 if(canonical(run.output.requiredGaps)!==canonical(requiredCodes.map(code=>({code,text:GAP_TEXT[code]}))))fail('Retain the complete selected-source gaps in their prepared order.');
}

export function validateResearchMethodRunSync(run, { expectedRunDigest } = {}) {
  boundedJson(run);
  required(run, ['format', 'method', 'settings', 'question', 'asOf', 'baseline', 'inputProvenance', 'output', 'truth', 'runId', 'runDigest']);
  if (run.format !== 'angbao-research-method-run@1' || !/^[a-f0-9]{64}$/.test(run.runDigest) || run.runId !== `research-run-${run.runDigest}`) fail('Use the exact prepared research run.');
  if (expectedRunDigest !== undefined && expectedRunDigest !== run.runDigest) fail('This is a different research run. Reopen the selected run before continuing.', 'research_run_mismatch');
  const { runId, runDigest, ...payload } = run;
  if (digest(payload) !== runDigest) fail('The prepared research run changed. Prepare a new run instead of editing its snapshot.', 'research_run_changed');
  const manifest = researchMethodManifest({ id: run.method.id, version: run.method.version });
  exact(run.method, ['id', 'version', 'runtime', 'manifestDigest']);
  if (run.method.manifestDigest !== digest(manifest) || run.method.runtime !== manifest.runtime || canonical(run.settings) !== canonical(settingsFor(manifest, run.settings))) fail('The research method or resolved settings do not match their immutable pin.');
  text(run.question, 500); date(run.asOf);
  if (run.baseline !== null) {
    exact(run.baseline, ['runId', 'runDigest']);
    if (!/^[a-f0-9]{64}$/.test(run.baseline.runDigest) || run.baseline.runId !== `research-run-${run.baseline.runDigest}`) fail('Use an exact previous research run baseline.');
  }
  if (!list(run.inputProvenance, LIMITS.packs).length) fail('The prepared source provenance is missing.');
  for (const item of run.inputProvenance) {
    exact(item, ['digest', 'format', 'provider', 'operation', 'endpoint', 'query', 'retrievedAt', 'status', 'coverage', 'pagination', 'recordCount']);
    if (!/^[a-f0-9]{64}$/.test(item.digest) || item.format !== 'angbao-research-evidence@1') fail('The prepared source provenance is invalid.');
    text(item.provider, 40); text(item.operation, 80); text(item.endpoint, 160); date(item.retrievedAt); count(item.recordCount, 0, LIMITS.records);
  }
  exact(run.output, ['format', 'status', 'cards', 'allowedEvidence', 'omissions', 'omittedCitations', 'requiredGaps', 'requirements', 'answer', 'authoredBrief']);
  if (run.output.format !== 'angbao-research-authoring-input@1' || run.output.answer !== null || run.output.authoredBrief !== null || !['ready-for-agent-authoring', 'needs-evidence'].includes(run.output.status)) fail('A prepared run must remain separate from authored synthesis.');
  list(run.output.cards, run.settings.maxEvidence); list(run.output.omissions, LIMITS.records); list(run.output.omittedCitations, 132);
  const citationIds = new Set();
  for (const citation of list(run.output.allowedEvidence, LIMITS.citations)) {
    // A run may offer more references than fit in one final brief; the agent selects a bounded subset.
    validateResearchBriefInput({ question: run.question, answer: 'Schema check only; this is not synthesis.', authorship: 'agent-authored', evidence: [citation], claims: [], inferences: [], gaps: [] });
    if (citationIds.has(citation.id)) fail('The prepared citation identifiers are duplicated.'); citationIds.add(citation.id);
  }
  if ((run.output.status === 'ready-for-agent-authoring') !== Boolean(run.output.allowedEvidence.length)) fail('The prepared citation status is inconsistent.');
  for (const gap of list(run.output.requiredGaps, 7)) {
    exact(gap, ['code', 'text']); if (!Object.hasOwn(GAP_TEXT, gap.code) || GAP_TEXT[gap.code] !== gap.text) fail('The prepared evidence gaps changed.');
  }
  if (!run.output.requiredGaps.some(gap => gap.code === 'coverage')) fail('Retain the bounded-coverage gap.');
  if (canonical(run.output.requirements) !== canonical({ minCitedClaims: run.settings.minCitedClaims, contradiction: run.settings.checkContradictions ? 'cited-counterclaim-or-explicit-gap' : 'optional', missingCounterevidenceGap: MISSING_COUNTEREVIDENCE_GAP })) fail('The prepared output requirements changed.');
  validatePreparedSelection(run);
  if (canonical(run.truth) !== canonical({ synthesisPerformed: false, independentVerification: false, providerCalls: false, modelCalls: false, memoryWritten: false, financialAuthority: false, financialExecution: false, onchain: false, sourceContentIsUntrustedData: true, digestIsAuthenticityProof: false })) fail('A research method run cannot claim additional authority.');
  return run;
}

/** Same method, question and resolved settings; new evidence and time are explicit. */
export async function repeatResearchMethodRun(previousRun, input) {
  validateResearchMethodRunSync(previousRun); boundedJson(input); exact(input, ['evidencePacks', 'asOf']);
  return buildRun({ method: { id: previousRun.method.id, version: previousRun.method.version }, settings: previousRun.settings, question: previousRun.question, evidencePacks: input.evidencePacks, asOf: input.asOf }, { runId: previousRun.runId, runDigest: previousRun.runDigest });
}

/** Validates a separate agent-authored answer; does not save it or assert its factual truth. */
export function validateResearchMethodOutputSync(run, authoredBrief, { expectedRunDigest } = {}) {
  validateResearchMethodRunSync(run, { expectedRunDigest }); boundedJson(authoredBrief);
  if (run.output.status !== 'ready-for-agent-authoring') fail('Supply eligible public citations before authoring a cited answer.', 'research_evidence_required');
  const brief = validateResearchBriefInput(authoredBrief);
  if (brief.authorship !== 'agent-authored' || brief.question !== run.question) fail('Keep the prepared question and mark this separate answer as agent-authored.');
  if (brief.previousVersionId !== undefined || brief.baselineId !== undefined) fail('Saved brief version references belong to the authorized save boundary, not this method output.');
  const allowed = new Map(run.output.allowedEvidence.map(item => [item.id, item]));
  for (const citation of brief.evidence) {
    const selected = allowed.get(citation.id);
    if (!selected || canonical(citation) !== canonical(selected)) fail('Keep each selected citation’s exact ID, link, publication time, observation time and empty excerpt. Prepare new source evidence before changing provenance.', 'research_citation_mismatch');
  }
  if (brief.claims.length < run.settings.minCitedClaims) fail('This method requires more explicitly cited claims. Do not invent claims to meet the requirement.', 'research_claims_required');
  for (const gap of run.output.requiredGaps) if (!brief.gaps.includes(gap.text)) fail('Retain the prepared evidence gaps in the authored answer.', 'research_gaps_required');
  if (run.settings.checkContradictions && !brief.claims.some(item => item.stance === 'contradicting') && !brief.gaps.includes(MISSING_COUNTEREVIDENCE_GAP)) fail('Add a supported counterclaim or explicitly retain the missing-counterevidence gap.', 'research_counterevidence_required');
  const validated = { format: 'angbao-research-method-authored-output@1', runReference: { runId: run.runId, runDigest: run.runDigest }, brief, validation: { schemaAndProvenanceReferences: true, factualSupportVerified: false, contradictionSearchComplete: false, saved: false, verification: 'unverified' } };
  return freeze(validated);
}

/** Proposed first-class memory record. Existing brief saves do not accept or persist this wrapper. */
export function createResearchMethodMemorySync(run, authoredBrief = null, { expectedRunDigest } = {}) {
  validateResearchMethodRunSync(run, { expectedRunDigest });
  const authoredOutput = authoredBrief === null ? null : validateResearchMethodOutputSync(run, authoredBrief, { expectedRunDigest });
  const result = { format: 'angbao-research-method-memory@1', run: structuredClone(run), authoredOutput };
  boundedJson(result);
  return freeze(result);
}

/** Preserve the entire run and its independently authored result across export/handoff. */
export function validateResearchMethodMemorySync(memory, { expectedRunDigest } = {}) {
  boundedJson(memory); exact(memory, ['format', 'run', 'authoredOutput']);
  if (memory.format !== 'angbao-research-method-memory@1') fail('Use the complete research method memory envelope.');
  const rebuilt = createResearchMethodMemorySync(memory.run, memory.authoredOutput === null ? null : memory.authoredOutput?.brief, { expectedRunDigest });
  if (canonical(rebuilt) !== canonical(memory)) fail('The research method memory or authored-output lineage changed.', 'research_memory_changed');
  return rebuilt;
}

// Promise-based public API stays compatible; retention/import also use these exact validators synchronously.
export async function validateResearchMethodRun(...args) { return validateResearchMethodRunSync(...args); }
export async function validateResearchMethodOutput(...args) { return validateResearchMethodOutputSync(...args); }
export async function createResearchMethodMemory(...args) { return createResearchMethodMemorySync(...args); }
export async function validateResearchMethodMemory(...args) { return validateResearchMethodMemorySync(...args); }
