/** Portable data only. Trusted runtime scope is a precondition, not conferred here. */
import {localDigest, canonicalLocalJson} from './local-continuity.mjs';
import {validateResearchWorkRecord} from './research-work-record.mjs';
import {validatePortfolioWorkRecord} from './portfolio-work-record.mjs';
import {retainedResearchBriefs} from './research-briefs.mjs';
export class FinancialMemoryError extends Error {
  constructor(message) { super(message); this.name = 'FinancialMemoryError'; this.code = 'invalid_financial_memory'; }
}
const fail = message => { throw new FinancialMemoryError(message); };
const kinds = ['research-method', 'research-brief', 'portfolio'];
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
// Check descriptors before reading values: no getters, toJSON, cycles or lossy JSON.
function portable(value, seen = new Set(), depth = 0) {
  if (depth > 24) fail('Memory exceeds the nesting limit.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (/-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\babp_[0-9a-f-]{36}_|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i.test(value)) fail('Credentials are not portable memory.');
    return;
  }
  if (!value || typeof value !== 'object' || !(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value))) || seen.has(value)) fail('Use plain acyclic JSON.');
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && (keys.length !== value.length + 1 || Array.from({length:value.length}, (_,i)=>String(i)).some(k=>!Object.hasOwn(value,k)))) fail('Use dense JSON arrays.');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d,'value') || ['__proto__','constructor','prototype','toJSON'].includes(key)) fail('Hidden or executable fields are prohibited.');
    const normalized = key.replace(/[-_]/g,'').toLowerCase();
    if (/^(agentaccess|grantid|grants|credentials|password|apikey|accesstoken|refreshtoken|privatekey|seedphrase|mnemonic|signature|rawsignature|approval|approvals|privatereasoning|chainofthought)$/.test(normalized)) fail('Authority or private reasoning is not portable.');
    if (/^(financialauthority|ownerapprovalobtained|submissionallowed|grantstransferred)$/.test(normalized) && d.value !== false) fail('Memory cannot assert authority.');
    portable(d.value, seen, depth + 1);
  }
  seen.delete(value);
}
function checked(value) { portable(value); if (Buffer.byteLength(JSON.stringify(value)) > 262144) fail('Memory exceeds 256 KiB.'); }
function exact(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('Use exact memory fields.');
}
export function validateFinancialMemoryScope(scope) {
  checked(scope); exact(scope,['ownerId','workspaceId']);
  if (!text(scope.ownerId) || typeof scope.workspaceId !== 'string' || !/^(local|hosted):[a-f0-9]{64}$/.test(scope.workspaceId)) fail('Supply explicit trusted owner/workspace scope.');
  return structuredClone(scope);
}
export function validateFinancialMemoryReference(ref) {
  checked(ref); exact(ref,['format','ownerId','workspaceId','kind','recordId','version','digest']);
  validateFinancialMemoryScope({ownerId:ref.ownerId,workspaceId:ref.workspaceId});
  if (ref.format !== 'angbao-financial-memory-reference@1' || !kinds.includes(ref.kind) || !text(ref.recordId) || !text(ref.version) || !hash(ref.digest)) fail('Invalid immutable reference.');
  return structuredClone(ref);
}
function binding(role, id, version, data, observedAt = null, nativeDigest = null) {
  return {role,id,version,digest:localDigest(data),nativeDigest,observedAt,data:structuredClone(data)};
}
export function adaptFinancialRecord(kind, record, scope) {
  checked(record); validateFinancialMemoryScope(scope);
  let retained, asOf, bindings;
  if (kind === 'research-method') {
    retained = validateResearchWorkRecord(record);
    const run = retained.memory.run;
    asOf = run.asOf;
    bindings = [binding('method',run.method.id,run.method.version,{method:run.method,settings:run.settings},null,run.method.manifestDigest),
      binding('context',run.runId,run.format,{question:run.question,asOf:run.asOf,baseline:run.baseline},asOf,run.runDigest),
      ...run.inputProvenance.map(source=>binding('source',source.digest,source.format,source,source.retrievedAt,source.digest))];
  } else if (kind === 'portfolio') {
    retained = validatePortfolioWorkRecord(record);
    const decision = retained.decision;
    asOf = decision.asOf;
    bindings = [binding('method',decision.method.id,decision.method.version,decision.method,null,decision.method.manifestDigest),
      ...decision.snapshots.sources.map(source=>binding('source',source.sourceId,String(source.version),source,source.observedAt,source.digest)),
      ...Object.entries(decision.snapshots).filter(([key])=>key !== 'sources').map(([key,data])=>binding('context',data?.id ?? `${record.id}:${key}`,data?.version === undefined ? decision.format : String(data.version),data,data?.observedAt ?? null))];
  } else if (kind === 'research-brief') {
    retained = retainedResearchBriefs({researchBriefs:[record]})[0];
    asOf = null; // createdAt is not an evidence observation time.
    bindings = retained.evidence.map(source=>binding('source',`${record.id}:${source.id}`,'research-brief-evidence@1',source,source.observedAt));
    bindings.push(binding('context',`${record.id}:lineage`,String(record.version),{seriesId:record.seriesId,previousVersionRef:record.previousVersionRef,baseline:record.baseline}));
    if (record.methodRunRef) bindings.push(binding('method',record.methodRunRef.runId,'angbao-research-method-run@1',record.methodRunRef,null,record.methodRunRef.runDigest));
  } else fail('Unsupported record kind.');
  const envelope = {format:'angbao-financial-memory-envelope@1',reference:{format:'angbao-financial-memory-reference@1',...scope,kind,recordId:retained.id,version:kind === 'research-brief' ? String(retained.version) : retained.format,digest:localDigest(retained)},record:retained,bindings,freshness:{asOf,verification:'unverified'}};
  checked(envelope); validateFinancialMemoryReference(envelope.reference);
  if (asOf !== null && !date(asOf)) fail('Invalid historical as-of time.');
  return envelope;
}
export function validateFinancialMemoryEnvelope(envelope) {
  checked(envelope); exact(envelope,['format','reference','record','bindings','freshness']);
  const ref = validateFinancialMemoryReference(envelope.reference);
  const rebuilt = adaptFinancialRecord(ref.kind,envelope.record,{ownerId:ref.ownerId,workspaceId:ref.workspaceId});
  if (canonicalLocalJson(rebuilt) !== canonicalLocalJson(envelope)) fail('Envelope identity, bindings or digest changed.');
  return rebuilt;
}
