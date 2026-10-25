/** Server-only bounded Elfa reads. Official endpoint contract checked 2026-10-24. */
if (typeof window !== 'undefined') throw new Error('Elfa research is server-only.');

const ORIGIN = 'https://api.elfa.ai';
const MAX_BYTES = 262144;
const PATHS = Object.freeze({ topMentions: '/v2/data/top-mentions', eventContext: '/v3/events', resolveEntities: '/v3/entities', storylineContext: '/v3/events/storylines' });
const ENTITY_TYPES = ['token', 'equity', 'project', 'person', 'organisation'];
const RELATIONS = ['origin', 'update', 'confirmation', 'contradiction', 'mitigation', 'consequence', 'reaction', 'context'];
const METRICS = ['likeCount', 'repostCount', 'viewCount', 'quoteCount', 'replyCount', 'bookmarkCount'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const messages = Object.freeze({
  unconfigured: 'Elfa research is not configured.', reads_disabled: 'Elfa research reads are disabled by the server.', reads_unapproved: 'Elfa research has no current operator-approved read window.', operation_unapproved: 'This Elfa operation is not approved by the server.', configuration: 'Elfa research configuration is invalid.',
  operation_not_allowed: 'This Elfa operation is not allowed.', invalid_input: 'The Elfa research query is invalid.',
  auth_failed: 'Elfa did not authenticate the configured key.', access_denied: 'This Elfa key does not have access to the requested read.',
  rate_limited: 'Elfa rate limited this read.', payment_required: 'Elfa requires additional provider access or credits.',
  provider_unavailable: 'Elfa research is temporarily unavailable.', http_error: 'Elfa returned an unsuccessful response.',
  transport: 'The Elfa read could not be completed.', timeout: 'The Elfa read timed out.',
  response_too_large: 'The Elfa response exceeded the read limit.', non_json: 'Elfa did not return valid JSON.',
  malformed_response: 'Elfa returned an incomplete or invalid response.', provider_refused: 'Elfa did not complete the requested read.',
});
export class ElfaResearchError extends Error {
  constructor(code, details = {}) {
    super(messages[code] || messages.transport); this.name = 'ElfaResearchError'; this.code = code;
    if (Number.isInteger(details.httpStatus)) this.httpStatus = details.httpStatus;
    if (Number.isInteger(details.retryAfterSeconds)) this.retryAfterSeconds = details.retryAfterSeconds;
  }
  toJSON() { return { name: this.name, code: this.code, message: this.message, ...(this.httpStatus ? { httpStatus: this.httpStatus } : {}), ...(this.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: this.retryAfterSeconds }) }; }
}
const fail = (code, details) => { throw new ElfaResearchError(code, details); };
function keys(value, allowed, code = 'invalid_input') {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}
function text(value, max, code = 'invalid_input', nullable = false, multiline = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail(code);
  return value.trim();
}
function integer(value, min, max, code = 'invalid_input') {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code); return value;
}
function cursor(value, code = 'invalid_input') { return value == null ? null : text(value, 2048, code); }
function epoch(value, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  return new Date(integer(value, 0, 253402300799, 'malformed_response') * 1000).toISOString();
}
function postUrl(value, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  let url; try { url = new URL(text(value, 2048, 'malformed_response')); } catch { fail('malformed_response'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) || !/^\/[A-Za-z0-9_]+\/status\/\d+\/?$/.test(url.pathname) || url.search || url.hash) fail('malformed_response');
  return value;
}
function citationUrl(value, source) {
  if (source !== 'telegram') return postUrl(value, true);
  if (value === null || value === undefined) return null;
  const raw = text(value, 2048, 'malformed_response');
  // Public message references only; never follow links or accept Telegram invite/private routes.
  const match = /^https:\/\/t\.me\/([A-Za-z0-9_]+)\/[1-9]\d*\/?$/.exec(raw);
  if (!match || ['c', 'joinchat', 'addlist', 'share', 'proxy', 'socks', 'login', 'confirmphone'].includes(match[1].toLowerCase())) fail('malformed_response');
  let url; try { url = new URL(raw); } catch { fail('malformed_response'); }
  if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password || url.port || url.search || url.hash) fail('malformed_response');
  return url.href;
}
function timestamp(value) {
  const result = text(value, 64, 'malformed_response');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) fail('malformed_response');
  return new Date(result).toISOString();
}
function topQuery(input) {
  keys(input, ['ticker', 'timeWindow', 'page', 'pageSize']);
  const ticker = text(input.ticker, 40); if (!/^\$?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ticker)) fail('invalid_input');
  const timeWindow = input.timeWindow ?? '24h'; if (!['1h', '24h', '7d'].includes(timeWindow)) fail('invalid_input');
  return { ticker, timeWindow, page: integer(input.page ?? 1, 1, 10), pageSize: integer(input.pageSize ?? 10, 1, 30) };
}
function eventQuery(input, nowSeconds) {
  keys(input, ['q', 'from', 'to', 'entityIds', 'limit', 'cursor']);
  const q = input.q === undefined ? null : text(input.q, 500), to = integer(input.to ?? nowSeconds, 0, nowSeconds), from = integer(input.from ?? Math.max(0, to - 7 * 86400), 0, to);
  if (to - from > 31 * 86400) fail('invalid_input');
  const result = { ...(q ? { q } : {}), from, to, limit: integer(input.limit ?? 10, 1, 30) };
  if (input.entityIds !== undefined) {
    if (!Array.isArray(input.entityIds) || !input.entityIds.length || input.entityIds.length > 30 || input.entityIds.some(id => typeof id !== 'string' || !UUID.test(id))) fail('invalid_input');
    result.entityIds = [...new Set(input.entityIds)].join(',');
  }
  if (!q && !result.entityIds) fail('invalid_input');
  const next = cursor(input.cursor); if (next) result.cursor = next;
  return result;
}
function uuid(value, code = 'malformed_response', nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) fail(code); return value.toLowerCase();
}
function entityQuery(input) {
  keys(input, ['q', 'entityType', 'limit', 'cursor']);
  const result = { q: text(input.q, 128), limit: integer(input.limit ?? 5, 1, 10) };
  if (input.entityType !== undefined) { if (!ENTITY_TYPES.includes(input.entityType)) fail('invalid_input'); result.entityType = input.entityType; }
  const next = cursor(input.cursor); if (next) result.cursor = next; return result;
}
function storylineQuery(input) { keys(input, ['storylineId']); return { storylineId: uuid(input.storylineId, 'invalid_input') }; }
function page(payload) {
  if (!plain(payload) || typeof payload.hasMore !== 'boolean') fail('malformed_response');
  const nextCursor = cursor(payload.nextCursor, 'malformed_response');
  if (payload.hasMore && !nextCursor) fail('malformed_response');
  return { nextCursor, hasMore: payload.hasMore };
}
function mentions(payload, query, retrievedAt) {
  if (!plain(payload) || payload.success !== true) fail(payload?.success === false ? 'provider_refused' : 'malformed_response');
  if (!Array.isArray(payload.data) || payload.data.length > query.pageSize || !plain(payload.metadata)) fail('malformed_response');
  const metadata = payload.metadata;
  const pagination = { total: integer(metadata.total, 0, Number.MAX_SAFE_INTEGER, 'malformed_response'), page: integer(metadata.page, 1, 10, 'malformed_response'), pageSize: integer(metadata.pageSize, 1, 30, 'malformed_response') };
  if (pagination.page !== query.page || pagination.pageSize !== query.pageSize) fail('malformed_response');
  const evidence = payload.data.map(item => {
    if (!plain(item) || typeof item.tweetId !== 'string' || !/^\d{1,30}$/.test(item.tweetId)) fail('malformed_response');
    const engagement = Object.fromEntries(METRICS.map(key => [key, item[key] == null ? null : integer(item[key], 0, Number.MAX_SAFE_INTEGER, 'malformed_response')]));
    return { id: `elfa:v2:post:${item.tweetId}`, kind: 'source-reference', provider: 'elfa', apiVersion: 2, endpoint: PATHS.topMentions, sourceRecordId: item.tweetId, sourceUrl: postUrl(item.link), publishedAt: timestamp(item.mentionedAt), publishedAtBasis: 'provider-mentionedAt', retrievedAt, summary: null, originalPostText: null, engagement, verification: 'provider-reference-not-independent-verification' };
  });
  return { status: evidence.length ? 'observed' : 'empty', evidence, pagination };
}
function entities(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) fail('malformed_response');
  return value.map(entity => {
    if (!plain(entity) || typeof entity.id !== 'string' || !UUID.test(entity.id) || !ENTITY_TYPES.includes(entity.entityType)) fail('malformed_response');
    return { id: entity.id, entityType: entity.entityType, name: text(entity.name, 500, 'malformed_response', true), symbol: text(entity.symbol, 100, 'malformed_response', true) };
  });
}
function events(payload, query, retrievedAt) {
  if (!plain(payload) || !Array.isArray(payload.events) || payload.events.length > query.limit || typeof payload.hasMore !== 'boolean') fail('malformed_response');
  const pagination = page(payload), nextCursor = pagination.nextCursor;
  const evidence = payload.events.map(item => {
    if (!plain(item) || typeof item.id !== 'string' || !UUID.test(item.id)) fail('malformed_response');
    const title = text(item.alertTitle, 4000, 'malformed_response', true), summaryText = text(item.summary, 16000, 'malformed_response', true, true);
    if (!Array.isArray(item.citedSources) || item.citedSources.length > 10) fail('malformed_response');
    const citations = item.citedSources.map(source => {
      if (!plain(source) || !['twitter', 'telegram', ''].includes(source.source)) fail('malformed_response');
      return { source: source.source || 'unknown', sourceRecordId: text(source.sourceRecordId, 500, 'malformed_response'), handle: text(source.handle, 200, 'malformed_response', true), sourceUrl: citationUrl(source.link, source.source), publishedAt: null };
    });
    const issues = ['original-post-text-unavailable', 'source-publication-times-unavailable'];
    if (!title && !summaryText) issues.push('summary-unavailable'); if (!citations.length) issues.push('citations-unavailable');
    return { id: `elfa:v3:event:${item.id}`, kind: 'provider-summary', provider: 'elfa', apiVersion: 3, endpoint: PATHS.eventContext, sourceRecordId: item.id, sourceUrl: null, publishedAt: null, retrievedAt, providerAnalyzedAt: epoch(item.analyzedAt), providerFirstSeenAt: epoch(item.firstSeenAt, true), storylineId: uuid(item.storylineId, 'malformed_response', true), summary: { title, text: summaryText, origin: 'elfa-derived-summary' }, originalPostText: null, citations, entities: entities(item.primaryEntities), verification: 'provider-summary-not-independent-verification', issues };
  });
  return { status: !evidence.length ? 'empty' : evidence.some(item => item.issues.includes('summary-unavailable') || item.issues.includes('citations-unavailable')) ? 'partial' : 'observed', evidence, pagination: { nextCursor, hasMore: payload.hasMore, servedFrom: epoch(payload.servedFrom, true) }, coverage: { complete: false, historyClipped: payload.servedFrom != null && payload.servedFrom > query.from, topicMatchLimit: query.q ? 100 : null, issues: ['provider-history-and-selection-limits', ...(payload.hasMore ? ['more-pages-not-fetched'] : []), ...(payload.servedFrom != null && payload.servedFrom > query.from ? ['requested-history-clipped'] : [])] } };
}
function resolveEntities(payload, query) {
  const pagination = page(payload);
  if (!Array.isArray(payload.entities) || payload.entities.length > query.limit) fail('malformed_response');
  const candidates = payload.entities.map(item => {
    const entity = entities([item])[0];
    if (query.entityType && entity.entityType !== query.entityType) fail('malformed_response');
    if (!['symbol', 'cashtag', 'name', 'alias', 'tickerRoot', 'exchangeSymbol', 'handle', 'contractAddress', 'externalId'].includes(item.matchedOn) || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) fail('malformed_response');
    if (item.externalIds != null && !plain(item.externalIds)) fail('malformed_response');
    return { ...entity, handle: text(item.handle, 200, 'malformed_response', true), matchedOn: item.matchedOn, score: item.score, externalIds: Object.fromEntries(['coingeckoId', 'figi', 'cik'].map(key => [key, text(item.externalIds?.[key], 200, 'malformed_response', true)])) };
  });
  if (new Set(candidates.map(item => item.id)).size !== candidates.length) fail('malformed_response');
  return { status: !candidates.length ? 'empty' : candidates.some(item => !item.name) ? 'partial' : 'observed', evidence: [], entities: candidates, resolution: { selectionRequired: true, ambiguous: candidates.length > 1 || pagination.hasMore, scoreIsConfidence: false }, pagination, coverage: { complete: false, issues: ['registry-matches-not-instrument-rights', ...(pagination.hasMore ? ['more-candidates-not-fetched'] : [])] } };
}
function storylines(payload, query, retrievedAt) {
  const pagination = page(payload);
  if (!Array.isArray(payload.storylines) || payload.storylines.length > 1) fail('malformed_response');
  const evidence = payload.storylines.map(item => {
    if (!plain(item) || uuid(item.id) !== query.storylineId || !['open', 'dormant'].includes(item.status) || !Array.isArray(item.events) || item.events.length > 2000) fail('malformed_response');
    const title = text(item.title, 4000, 'malformed_response', true), summaryText = text(item.summary, 16000, 'malformed_response', true, true);
    const startedAt = epoch(item.startedAt), lastEventAt = epoch(item.lastEventAt), lastMaterialAt = epoch(item.lastMaterialAt, true);
    if (Date.parse(startedAt) > Date.parse(lastEventAt) || (lastMaterialAt && (Date.parse(lastMaterialAt) < Date.parse(startedAt) || Date.parse(lastMaterialAt) > Date.parse(lastEventAt)))) fail('malformed_response');
    const references = item.events.slice(0, 30).map(ref => {
      if (!plain(ref) || !RELATIONS.includes(ref.relation) || typeof ref.material !== 'boolean') fail('malformed_response');
      const occurredAt = epoch(ref.occurredAt);
      if (Date.parse(occurredAt) < Date.parse(startedAt) || Date.parse(occurredAt) > Date.parse(lastEventAt)) fail('malformed_response');
      return { eventId: uuid(ref.eventId), relation: ref.relation, material: ref.material, occurredAt, occurredAtBasis: 'provider-event-analyzedAt' };
    });
    if (new Set(references.map(ref => ref.eventId)).size !== references.length) fail('malformed_response');
    const issues = ['original-post-text-unavailable', 'source-publication-times-unavailable', 'event-details-not-fetched', 'storyline-history-may-be-incomplete'];
    if (!title && !summaryText) issues.push('summary-unavailable');
    if (!lastMaterialAt) issues.push('summary-time-unavailable');
    if (!references.length) issues.push('event-references-unavailable');
    if (item.events.length > 30) issues.push('event-references-truncated');
    return { id: `elfa:v3:storyline:${item.id}`, kind: 'provider-summary', provider: 'elfa', apiVersion: 3, endpoint: PATHS.storylineContext, sourceRecordId: item.id, sourceUrl: null, publishedAt: null, retrievedAt, providerAnalyzedAt: null, providerFirstSeenAt: null, summary: { title, text: summaryText, origin: 'elfa-derived-summary' }, originalPostText: null, citations: [], entities: entities(item.entities), storylineId: query.storylineId, storyline: { id: query.storylineId, status: item.status, arcId: uuid(item.arcId, 'malformed_response', true), startedAt, lastEventAt, lastMaterialAt, events: references, eventReferenceCount: item.events.length, eventReferencesTruncated: item.events.length > 30 }, verification: 'provider-summary-not-independent-verification', issues };
  });
  return { status: !evidence.length ? 'empty' : evidence.some(item => ['summary-unavailable', 'summary-time-unavailable', 'event-references-truncated', 'event-references-unavailable'].some(issue => item.issues.includes(issue))) ? 'partial' : 'observed', evidence, pagination: { ...pagination, servedFrom: epoch(payload.servedFrom, true) }, coverage: { complete: false, issues: ['event-details-not-fetched', 'provider-history-and-duplicate-events-not-listed', ...(pagination.hasMore ? ['more-pages-not-fetched'] : [])] } };
}
async function cancel(response, controller) {
  controller.abort(); try { await response?.body?.cancel(); } catch { /* Never expose a provider error body. */ }
}
async function boundedJson(response, controller) {
  if (!/\bapplication\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type') || '')) { await cancel(response, controller); fail('non_json'); }
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) { await cancel(response, controller); fail('response_too_large'); }
  let body = '', bytes = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const abortRead = () => { reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', abortRead, { once: true });
    try { while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { controller.abort(); try { await reader.cancel(); } catch {} fail('response_too_large'); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    } finally { controller.signal.removeEventListener('abort', abortRead); }
    if (controller.signal.aborted) fail('timeout');
  } else {
    body = await response.text(); if (new TextEncoder().encode(body).byteLength > MAX_BYTES) fail('response_too_large');
  }
  try { return JSON.parse(body); } catch { fail('non_json'); }
}
function configuredKey(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 4096 || /[^\x21-\x7e]/.test(value)) fail('configuration');
  return value;
}
/** Operator approval only: no provider entitlement, billing meter or spend cap is inferred. */
export function elfaResearchReadApproval(env = {}) {
  const raw = env.ANGBAO_ELFA_ALLOWED_OPERATIONS;
  const operations = typeof raw === 'string' && raw.length <= 200 ? raw.split(',').map(value => value.trim()) : [];
  return { enabled: env.ANGBAO_ELFA_READS_ENABLED === 'true', approvedUntil: env.ANGBAO_ELFA_READS_APPROVED_UNTIL ?? null, allowedOperations: operations.length && operations.length <= 4 && new Set(operations).size === operations.length && operations.every(value => own(PATHS, value)) ? operations : [] };
}
function approvalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 19) === value.slice(0, 19) ? milliseconds : null;
}
function approvalGates(approval, nowDate) {
  const expires = approvalTime(approval?.approvedUntil), problems = [];
  if (!Number.isFinite(nowDate.getTime())) problems.push('read-window-clock-invalid');
  if (approval?.enabled !== true) problems.push('reads-not-enabled');
  if (expires === null) problems.push('read-window-missing-or-invalid');
  else if (expires <= nowDate.getTime()) problems.push('read-window-expired');
  if (!Array.isArray(approval?.allowedOperations) || !approval.allowedOperations.length || approval.allowedOperations.length > 4 || new Set(approval.allowedOperations).size !== approval.allowedOperations.length || approval.allowedOperations.some(value => !own(PATHS, value))) problems.push('operations-not-approved');
  return problems;
}
function approveRead(approval, operation, nowDate) {
  const problems = approvalGates(approval, nowDate);
  if (problems.includes('reads-not-enabled')) fail('reads_disabled');
  if (problems.some(value => value.startsWith('read-window-'))) fail('reads_unapproved');
  if (problems.includes('operations-not-approved') || !approval.allowedOperations.includes(operation)) fail('operation_unapproved');
}
/** Safe capability metadata. A present key does not prove authentication or commercial rights. */
export function elfaResearchReadiness(env = {}, { now = () => new Date() } = {}) {
  let credential = 'missing'; try { if (configuredKey(env.ANGBAO_ELFA_API_KEY)) credential = 'configured-not-verified'; } catch { credential = 'invalid'; }
  return { provider: 'elfa', credential, readApproval: { enabled: env.ANGBAO_ELFA_READS_ENABLED === 'true', unmetGates: approvalGates(elfaResearchReadApproval(env), new Date(now())), approvedOperations: elfaResearchReadApproval(env).allowedOperations, providerCostVerified: false, durableSpendCap: false }, adapter: 'implemented-fixture-tested', liveVerification: 'not-performed', operations: Object.keys(PATHS), accountPlan: 'not-verified', v2Unlimited: 'owner-reported-not-measured', v3ScopesAndCredits: 'not-verified', commercialRights: 'not-verified', originalPostText: 'not-provided', persistence: 'not-wired' };
}
export function createElfaResearchAdapter(options = {}) {
  keys(options, ['apiKey', 'timeoutMs', 'fetchImpl', 'now', 'approval'], 'configuration');
  const apiKey = configuredKey(options.apiKey), timeoutMs = integer(options.timeoutMs ?? 5000, 100, 15000, 'configuration');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch, now = options.now ?? (() => new Date());
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') fail('configuration');
  return Object.freeze({
    async read(operation, input = {}) {
      if (typeof operation !== 'string' || !own(PATHS, operation)) fail('operation_not_allowed');
      let nowDate; try { nowDate = new Date(now()); } catch { fail('configuration'); } if (!Number.isFinite(nowDate.getTime())) fail('configuration');
      const query = operation === 'topMentions' ? topQuery(input) : operation === 'resolveEntities' ? entityQuery(input) : operation === 'storylineContext' ? storylineQuery(input) : eventQuery(input, Math.floor(nowDate.getTime() / 1000));
      if (!apiKey) fail('unconfigured');
      approveRead(options.approval, operation, nowDate);
      const params = operation === 'storylineContext' ? { storylineIds: query.storylineId } : query;
      const url = new URL(PATHS[operation], ORIGIN); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const controller = new AbortController(); let timer;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ElfaResearchError('timeout')); }, timeoutMs); });
      const read = async () => {
        const response = await fetchImpl(url.href, { method: 'GET', headers: { accept: 'application/json', 'x-elfa-api-key': apiKey }, signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit' });
        if (controller.signal.aborted) { await cancel(response, controller); fail('timeout'); }
        if (response?.redirected) { await cancel(response, controller); fail('transport'); }
        if (!response?.ok) {
          const status = Number.isInteger(response?.status) ? response.status : undefined;
          let retryAfterSeconds; const rawRetry = response?.headers?.get('retry-after'); if (status === 429 && /^\d{1,4}$/.test(rawRetry || '')) retryAfterSeconds = Math.min(3600, Number(rawRetry));
          await cancel(response, controller);
          fail(({ 401: 'auth_failed', 403: 'access_denied', 402: 'payment_required', 429: 'rate_limited', 503: 'provider_unavailable' })[status] || 'http_error', { httpStatus: status, retryAfterSeconds });
        }
        const payload = await boundedJson(response, controller);
        const retrievedAt = new Date(now()).toISOString();
        return { format: 'angbao-research-evidence@1', provider: 'elfa', operation, endpoint: PATHS[operation], query, retrievedAt, ...(operation === 'topMentions' ? mentions(payload, query, retrievedAt) : operation === 'resolveEntities' ? resolveEntities(payload, query) : operation === 'storylineContext' ? storylines(payload, query, retrievedAt) : events(payload, query, retrievedAt)) };
      };
      try { return await Promise.race([read(), deadline]); }
      catch (error) { const wasAborted=controller.signal.aborted; controller.abort(); if (error instanceof ElfaResearchError) throw error; fail(wasAborted ? 'timeout' : 'transport'); }
      finally { clearTimeout(timer); }
    },
  });
}
