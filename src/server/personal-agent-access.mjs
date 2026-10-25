import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { assertSafeJson } from '../domain/angbao.mjs';
import { AgentAccessError } from './personal-agent-store.mjs';
export const AGENT_SCOPES = Object.freeze(['workspace:read','history:read','reviews:create','feedback:write','research:read','research:write']);
export const AGENT_CONSENT_VERSION = 'personal-agent-v1';
export const AGENT_RESEARCH_CONSENT_VERSION = 'personal-agent-v2';
// Stored grants are lifetime-capped until an audited retention/cleanup path exists.
// Per-grant budgets do not replace deployment-level invalid-token ingress limits.
export const AGENT_LIMITS = Object.freeze({ maxActiveGrants:10, maxStoredGrants:100, maxExpiryHours:720, maxReviews:100, maxRequests:1000, requestsPerMinute:30, historyLimit:20 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code,status=400) => { throw new AgentAccessError(code,status); };
export const tokenDigest = token => createHash('sha256').update(token).digest('hex');
export function agentAccessConfig(env={}) {
  return { enabled:env.ANGBAO_PERSONAL_AGENT_ACCESS_ENABLED==='true', origin:env.ANGBAO_APP_ORIGIN };
}
export function agentOrigin(config) {
  let url; try { url=new URL(config.origin); } catch { fail('access_unconfigured',503); }
  if (url.protocol!=='https:'||url.origin!==config.origin||url.username||url.password) fail('access_unconfigured',503);
  return url.origin;
}
export function agentJson(data,status=200,headers={}) { return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...headers}}); }
export async function readAgentJson(request,limit=32768) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail('json_required',415);
  const reader=request.body?.getReader();let size=0;const parts=[];
  if(reader)while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('body_too_large',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const value of parts){bytes.set(value,offset);offset+=value.byteLength;}
  try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));assertSafeJson(value);return value;}catch{fail('invalid_json');}
}
export function exactAgentObject(value,keys) {if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('invalid_input');}
export function agentAccessMessage(code) {
  const messages = {
    authentication_required: 'Sign in to manage access to your private hosted workspace. Local use does not require an account.',
    access_unconfigured: 'Hosted agent access is not ready on this site. You can still use Angbao locally.',
    access_unavailable: 'Hosted agent access is unavailable. Check saved results before retrying the same request. Local use is still available.',
    invalid_token: 'This access key is invalid, expired or revoked. Ask the account owner to check agent access.',
    insufficient_scope: 'This key does not allow that action. Ask the account owner to review its permissions.',
    grant_not_found: 'This key is not available in this account. Refresh agent access to check its status.',
    request_limit: 'This key has used its request allowance. Ask the account owner to review its limits.',
    rate_limit: 'Too many agent requests. Wait a minute before trying again.',
    review_limit: 'This key has used its review allowance. Ask the account owner to review its limits.',
    grant_limit: 'The account has reached its access-key limit. Review existing keys before adding another.',
    workspace_required: 'Open your signed-in hosted workspace once before connecting this agent.',
    idempotency_conflict: 'This request key was used with different data. Review the intended action before sending a new request.',
    invalid_grant: 'Enter a name and choose the data this agent may access.',
    review_requires_context_consent: 'Allow saved context access before allowing this agent to create reviews.',
    research_requires_read_consent: 'Allow saved research access before allowing this agent to save new research.',
    invalid_expiry: 'Choose an expiry between 1 and 720 hours.',
    invalid_budget: 'Check the review and request limits. A key allows at most 100 reviews and 1,000 requests; requests must cover the review allowance.',
    explicit_consent_required: 'Review the selected data access and confirm it before creating a key.',
    write_context_rejected: 'The account or page changed. Refresh agent access before saving.',
    origin_rejected: 'Use this site directly for agent access.',
    invalid_input: 'The request has missing or unsupported fields. Check the required inputs.',
    invalid_arguments: 'The tool inputs are incomplete or invalid. Check its required fields.',
    invalid_json: 'Send the agent request as valid JSON.',
    json_required: 'Send the agent request with Content-Type: application/json.',
    body_too_large: 'This agent request is too large. Send a smaller request.',
    unknown_tool: 'This agent tool is not available. Check the supported tool list.',
    unknown_strategy: 'Choose a supported built-in strategy and its exact version.',
    unsupported_protocol: 'This MCP version is not supported. Use protocol version 2025-06-18.',
    invalid_rpc: 'The MCP request is invalid. Check the JSON-RPC fields.',
    method_not_found: 'This MCP action is not available. Check the supported methods.',
    revision_conflict: 'The workspace changed. Read its latest version and review your changes before saving.',
    invalid_handoff: 'Choose the exact saved review or research brief to continue, using its complete continuation reference.',
    handoff_workspace_mismatch: 'This continuation belongs to a different workspace. Open the original workspace.',
    handoff_record_changed: 'The saved record differs from the continuation reference. Inspect the original before continuing.',
    handoff_record_missing: 'The selected saved review is no longer retained. Another review was not substituted.',
    handoff_too_large: 'Open these saved records separately; this continuation exceeds the size limit.',
    repeat_snapshot_mismatch: 'Keep the original review’s goal, strategy version and settings when repeating.',
    repeat_context_mismatch: 'The input type or currency changed. Resolve that change before repeating.',
    research_brief_not_found: 'This research version is no longer saved in the workspace. Choose a retained version.',
  };
  return Object.hasOwn(messages, code) ? messages[code] : 'We could not confirm the agent request. Check saved results before sending it again.';
}
export function agentFailure(error, ownerId = null) {
  const status=error instanceof AgentAccessError?error.status:503,code=error instanceof AgentAccessError?error.code:'access_unavailable';
  return agentJson({available:status<500&&status!==401,...(UUID.test(ownerId||'')?{requestIdentity:{userId:ownerId}}:{}),error:{code,message:agentAccessMessage(code)},financialAuthorityGranted:false},status,status===401?{'www-authenticate':'Bearer realm="angbao-personal-agent"'}:{});
}
export const AGENT_ACCESS_FACTS = Object.freeze({ authentication:'personal-access-token',oauthDiscovery:false,clientRegistration:false,harnessIdentity:'unverified',financialAuthority:false,financialExecution:false,realBilling:false,unattendedJobs:false,localCliAutomaticallyConnected:false,researchMemory:'Opt-in private authored/imported unverified briefs; no provider/model calls or spend.',inputs:'sample-or-user-entered-unverified',revocation:'New requests and atomic write commits reject revoked/expired grants. Reads already authorized may finish; committed writes are not undone.',budget:'Requests include discovery/reads/retries and research saves; review budget counts unique committed reviews only. No money or provider-spend budget is granted.' });
function grantInput(body) {
  exactAgentObject(body,['name','scopes','expiresInHours','maxReviewRuns','maxRequests','consent']);
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name)||!Array.isArray(body.scopes)||body.scopes.length<1||new Set(body.scopes).size!==body.scopes.length||body.scopes.some(scope=>!AGENT_SCOPES.includes(scope)))fail('invalid_grant');
  if(body.scopes.includes('reviews:create')&&!body.scopes.includes('workspace:read'))fail('review_requires_context_consent');
  if(body.scopes.includes('research:write')&&!body.scopes.includes('research:read'))fail('research_requires_read_consent');
  if(!Number.isInteger(body.expiresInHours)||body.expiresInHours<1||body.expiresInHours>720)fail('invalid_expiry');
  const maxReviewRuns=body.maxReviewRuns??(body.scopes.includes('reviews:create')?20:0),maxRequests=body.maxRequests??200;
  if(!Number.isInteger(maxReviewRuns)||maxReviewRuns<0||maxReviewRuns>100||(body.scopes.includes('reviews:create')?maxReviewRuns===0:maxReviewRuns!==0)||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>1000||maxRequests<maxReviewRuns)fail('invalid_budget');
  const research=body.scopes.some(scope=>scope.startsWith('research:'));
  exactAgentObject(body.consent,research?['version','dataAccess','reviewOnly','researchMemory']:['version','dataAccess','reviewOnly']);
  if(body.consent.version!==(research?AGENT_RESEARCH_CONSENT_VERSION:AGENT_CONSENT_VERSION)||body.consent.dataAccess!==true||body.consent.reviewOnly!==true||research&&body.consent.researchMemory!==true)fail('explicit_consent_required');
  return {name,scopes:body.scopes,expiresInHours:body.expiresInHours,maxReviewRuns,maxRequests,consent:{version:research?AGENT_RESEARCH_CONSENT_VERSION:AGENT_CONSENT_VERSION,dataAccess:true,reviewOnly:true,...(research?{researchMemory:true}:{})}};
}
/** ownerId is supplied only by the verified browser-auth wrapper, never read from request headers/body.
 * @param {Request} request
 * @param {{ownerId?:string|null,store?:any,config?:any}} options
 */
export async function handleAgentGrantRequest(request,{ownerId,store,config={}}={}) {
  try {
    if(!UUID.test(ownerId||''))fail('authentication_required',401);
    const respond=(data,status=200)=>agentJson({requestIdentity:{userId:ownerId},...data},status);
    if(!config.enabled){if(request.method!=='GET')fail('access_unavailable',503);return respond({available:false,grants:[],scopes:AGENT_SCOPES,limits:AGENT_LIMITS,capabilityTruth:AGENT_ACCESS_FACTS});}
    const origin=agentOrigin(config);if(!store)fail('access_unavailable',503);
    const url=new URL(request.url),base='/api/agent/grants',id=url.pathname.startsWith(base+'/')?url.pathname.slice(base.length+1):null;
    if(request.method==='GET'&&url.pathname===base)return respond({available:true,grants:await store.list(ownerId),scopes:AGENT_SCOPES,limits:AGENT_LIMITS,capabilityTruth:AGENT_ACCESS_FACTS});
    if(request.headers.get('origin')!==origin||request.headers.get('x-workspace-user')!==ownerId||request.headers.get('sec-fetch-site')==='cross-site')fail('write_context_rejected',403);
    if(request.method==='POST'&&url.pathname===base){
      const input=grantInput(await readAgentJson(request,8192)),grantId=randomUUID(),token=`abp_${grantId}_${randomBytes(32).toString('base64url')}`;
      const grant=await store.create(ownerId,{...input,grantId,digest:tokenDigest(token)});
      return respond({available:true,grant,token,tokenReturnedOnce:true,agentApiUrl:origin+'/api/agent',mcpUrl:origin+'/mcp',capabilityTruth:AGENT_ACCESS_FACTS},201);
    }
    if(request.method==='DELETE'&&UUID.test(id||''))return respond({available:true,grant:await store.revoke(ownerId,id),capabilityTruth:AGENT_ACCESS_FACTS});
    fail('not_found',404);
  }catch(error){return agentFailure(error,ownerId);}
}
export function bearerDigest(request,config) {
  if(!config.enabled)fail('access_unavailable',503);
  const origin=agentOrigin(config),requestOrigin=request.headers.get('origin');
  if((requestOrigin!==null&&requestOrigin!==origin)||request.headers.get('sec-fetch-site')==='cross-site')fail('origin_rejected',403);
  const match=/^Bearer (abp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization')||'');
  if(!match)fail('invalid_token',401);
  return tokenDigest(match[1]);
}
