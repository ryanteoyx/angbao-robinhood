#!/usr/bin/env node
import {previewSavedResearchPortfolio,saveResearchPortfolio} from '../src/domain/research-portfolio-work.mjs';
import {ResearchPortfolioBridgeError} from '../src/domain/research-portfolio-bridge.mjs';
import {createLocalHistoryStore} from '../src/server/local-history-store.mjs';
import {archiveIndex,previewArchiveChange,applyArchiveChange,exportPortfolioHistory,previewHistoryImport,importPortfolioHistory,validateArchiveGraph,ARCHIVE_BUNDLE_BYTES} from '../src/domain/local-history-archive.mjs';
import {copyPortfolioArchive,allPortfolioWork} from '../src/domain/portfolio-work-record.mjs';
import {createLocalKernelFlow} from '../src/server/local-kernel-flow.mjs';
import {previewLocalKernelInitialization,saveLocalKernelInitializationReview,retainedLocalKernelInitializations} from '../src/domain/local-kernel-initialization.mjs';
import {createLocalOwnerFlow} from '../src/server/local-owner-flow.mjs';
import {prepareLocalGoalTransfer,reportLocalGoalTransfer,readLocalGoalTransfer,retainedLocalGoalTransfers} from '../src/domain/local-goal-transfer.mjs';
import {encodeGoalTransferKernelCallData,GoalTransferError} from '../src/domain/goal-transfer.mjs';
import {saveSubmissionReview,readSubmissionReview,retainedSubmissionReviews} from '../src/domain/submission-review.mjs';
import {previewPortfolioWork,savePortfolioWork,readPortfolioWorkResult,intakePortfolioSource,identifyPortfolioInstrument,LOCAL_PORTFOLIO_FACTS} from '../src/domain/portfolio-work.mjs';
import {PortfolioWorkError,portfolioCanonical,portfolioExact,readPortfolioWork} from '../src/domain/portfolio-work-record.mjs';
import {PortfolioDecisionError} from '../src/domain/portfolio-decision.mjs';
import {composePortfolioDraft,portfolioDraftFromInput} from '../src/domain/portfolio-authoring.mjs';
import {prepareResearchWork,savePreparedResearchWork,previewResearchWorkBrief,completeResearchWork} from '../src/domain/research-work.mjs';
import {readResearchWork,retainedResearchWork,ResearchWorkError} from '../src/domain/research-work-record.mjs';
import {validateResearchMethodMemory,ResearchMethodError} from '../src/domain/research-method.mjs';
/** Local, single-workspace demo. No authentication, bank access, payment or signing. */
import http from 'node:http';
import { readFinancialHandoff, financialWorkspaceId, assertRepeatReview, linkRepeatReview } from '../src/domain/financial-handoff.mjs';
import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { ANGBAO_LOCAL_VERSION } from '../cli/version.mjs';
import { ensureLocalContinuity, localCapabilities, createLocalManifest, localDigest } from '../src/domain/local-continuity.mjs';
import { listResearchBriefs, readResearchBrief, saveResearchBrief, ResearchBriefError, RESEARCH_MEMORY_FACTS } from '../src/domain/research-briefs.mjs';
import { recipes } from '../ui/catalog.mjs';
import { previewSamplePreset, createSampleReview } from '../src/domain/sample-preset.mjs';
import { ApiError, assertSafeJson, createDefaultState, updateClientState, createReview, submitReviewFeedback, simulateBilling, exportWorkspace, validateFinanceInputs, clone, normalizeWorkspaceDrafts } from '../src/domain/angbao.mjs';
export { ApiError, assertSafeJson, createDefaultState, updateClientState, calculateSavingsReview, createReview, simulateBilling, exportWorkspace } from '../src/domain/angbao.mjs';

const PROTECTED_EGRESS=Symbol.for('angbao.protected.egress');
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODY_LIMIT = 256 * 1024;
const FREE_PERMISSIONS = Object.freeze({ readOnly: true, executionEnabled: false, delegationEnabled: false, tradingEnabled: false, authorizedSpend: 0 });
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };

async function loadState(dataFile,hydrate=async s=>s) {
  try {
    const stored = await hydrate(JSON.parse(await readFile(dataFile, 'utf8')));
    assertSafeJson(stored);
    validateFinanceInputs(stored);
    if (!plainObject(stored.entitlements) || !Array.isArray(stored.reviewRuns)) throw new Error('The saved workspace is incomplete.');
    // This field is the bundled sample catalogue, not user-created or installed content.
    // Upgrading it must leave installedStrategies, private inputs and decision history intact.
    return copyPortfolioArchive(stored,{ ...normalizeWorkspaceDrafts(stored), strategies: clone(recipes), financialPermissions: clone(FREE_PERMISSIONS) });
  } catch (error) {
    if (error.code === 'ENOENT') return createDefaultState();
    throw new Error(`Could not open the local workspace at ${dataFile}. Keep this file and repair or restore it before restarting. ${error.message}`);
  }
}

async function persistState(dataFile, state) {
  await mkdir(path.dirname(dataFile), { recursive: true, mode: 0o700 });
  const temporary = `${dataFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, dataFile);
}

async function parseBody(request,limit=BODY_LIMIT) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError(415, 'json_required', 'Use Content-Type: application/json.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'body_too_large', 'This request exceeds its documented size limit. Send less data and try again.');
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); assertSafeJson(value); return value; }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'invalid_json', 'The request contains invalid JSON. Check its format and try again.'); }
}

function localHostname(hostname) { return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname); }
function enforceLocalRequest(request, writes) {
  let host;
  try { host = new URL(`http://${request.headers.host ?? ''}`); } catch { throw new ApiError(400, 'invalid_host', 'Connect through localhost or 127.0.0.1 with a valid Host header.'); }
  if (!localHostname(host.hostname)) throw new ApiError(403, 'local_only', 'This workspace is available only on this computer. Open its localhost or 127.0.0.1 address.');
  if (writes && request.headers.origin) {
    let origin;
    try { origin = new URL(request.headers.origin); } catch { throw new ApiError(403, 'origin_rejected', 'Open the local Angbao address before saving changes.'); }
    if (!localHostname(origin.hostname) || origin.protocol !== 'http:' || origin.port !== host.port) throw new ApiError(403, 'origin_rejected', 'Open Angbao at the same local address and port before saving changes.');
  }
}

function sendJson(response, status, body, extra = {}) {
  const serialized=JSON.stringify(body);
  response[PROTECTED_EGRESS]?.(serialized);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  response.end(serialized);
}

function setupDeclaration(input) {
  const exact = (value, fields) => {
    if (!plainObject(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) throw new ApiError(400, 'invalid_local_setup', 'Provide the complete cash, goals, limits and strategy declaration without extra fields.');
  };
  exact(input, ['inputMode', 'cash', 'goals', 'rules', 'strategy']);
  if (input.inputMode !== 'manual') throw new ApiError(400, 'invalid_local_setup', 'Setup saves your own inputs. Use inputMode manual, or run a sample review without setup.');
  exact(input.cash, ['available', 'upcomingBills', 'monthlyIncome', 'monthlyExpenses', 'currency']);
  exact(input.rules, ['reserve', 'maxSuggestion']);
  if (!Array.isArray(input.goals)) throw new ApiError(400, 'invalid_local_setup', 'Provide your complete goals as an array.');
  for (const goal of input.goals) exact(goal, ['id', 'name', 'targetAmount', 'currentAmount', 'monthlyContribution', 'currency']);
  if (!plainObject(input.strategy) || Object.keys(input.strategy).some(key => !['id', 'version', 'settings'].includes(key)) || typeof input.strategy.id !== 'string' || typeof input.strategy.version !== 'string') throw new ApiError(400, 'invalid_local_setup', 'Choose a strategy by its exact id and version, with optional settings.');
  return input;
}

export async function createDemoServer({ dataFile = path.join(PROJECT_DIR, '.data', 'workspace.json'), distDir = path.join(PROJECT_DIR, 'ui'), ownerBridgeFactory = null, goalTransferReaderFactory = null, authorizeGoalReadPlan = async()=>false, kernelBridgeFactory=null, kernelReaderFactory=null, authorizeKernelReadPlan=async()=>false, kernelRouteEvidenceDigest=null, directTransferRuntime=null, historyStoreFactory=createLocalHistoryStore, managedJobHost=null, protectedLocal=null, checkpointOwnerFactory=null } = {}) {
  if(checkpointOwnerFactory!==null&&(typeof checkpointOwnerFactory!=='function'||protectedLocal!==null||managedJobHost!==null||directTransferRuntime!==null||ownerBridgeFactory!==null||kernelBridgeFactory!==null))throw new ApiError(503,'checkpoint_profile_conflict','Choose one explicit owner profile.');
  if(checkpointOwnerFactory!==null){const original=JSON.parse(await readFile(dataFile,'utf8'));if(!original.localInstallation?.id)throw new ApiError(503,'checkpoint_existing_workspace_required','Use the existing saved workspace.');}
  const LocalClientAccessError=protectedLocal===null?null:(await import('../src/server/local-client-access.mjs')).LocalClientAccessError;
  if(kernelRouteEvidenceDigest!==null&&(typeof kernelRouteEvidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(kernelRouteEvidenceDigest)))throw new ApiError(503,'kernel_route_unavailable','The supported account route is not configured.');
  if(directTransferRuntime&&(ownerBridgeFactory!==null||kernelBridgeFactory!==null||['available','prepare','read','beginWallet','report','recordReference','observe','close'].some(k=>typeof directTransferRuntime[k]!=='function')))throw new ApiError(503,'direct_configuration','Choose one explicit local execution route.');
  if(protectedLocal!==null){
    if(managedJobHost!==null||directTransferRuntime!==null||ownerBridgeFactory!==null||kernelBridgeFactory!==null)throw new LocalClientAccessError('local_read_only',503);
    const original=JSON.parse(await readFile(dataFile,'utf8'));
    if(!original.localInstallation?.id)throw new LocalClientAccessError('local_existing_workspace_required',503);
  }
  const historyStore=await historyStoreFactory({dataFile});
  let state = ensureLocalContinuity(await loadState(dataFile,historyStore.hydrate));
  // Persist a private identity immediately, before any first-result or optional signup action.
  if(protectedLocal===null&&checkpointOwnerFactory===null)await historyStore.persist(state);
  const dataLocationFingerprint=createHash('sha256').update(await realpath(dataFile)).digest('hex');
  let mutations = Promise.resolve();
  const localHeaders = () => ({ etag: `"${state.localRevision}"`, 'x-workspace-revision': String(state.localRevision) });
  async function mutate(request, body, operation, beforeCommit=null, managedJobCommit=null) {
    const run = mutations.then(async () => {
      if(historyStore.isUncertain())throw new ApiError(503,'archive_commit_uncertain','Restart this same workspace and inspect the original save before retrying.');
      if(beforeCommit!==null){if(typeof beforeCommit!=='function'||beforeCommit()!==undefined)throw new ApiError(503,'invalid_service_guard','The local job authority is unavailable.');}
      const key=request.headers['idempotency-key'];
      if(managedJobHost!==null&&typeof key==='string'&&key.startsWith('job-save:')&&beforeCommit===null)throw new ApiError(403,'service_authority_required','This operation belongs to the private job host. Use your own operation key for manual work.');
      if(key!==undefined && (typeof key!=='string'||!/^[\x21-\x7e]{8,128}$/.test(key))) throw new ApiError(400,'invalid_idempotency_key','Use an Idempotency-Key of 8 to 128 printable characters.');
      const signature=localDigest({method:request.method,route:new URL(request.url,'http://localhost').pathname,body});
      const previous=key===undefined?null:state.localReplayReceipts.find(receipt=>receipt.key===key);
      if(previous){if(previous.fingerprint!==signature)throw new ApiError(409,'idempotency_conflict','This operation ID was used for a different request. Reuse the original request or choose a new ID for new work.');return {...clone(previous.result),state:{...clone(state),...(directTransferRuntime?{ownerFundedTransfers:await directTransferRuntime.read()}: {})},replayed:true};}
      const expected=request.headers['if-match'];
      if(expected!==undefined){if(!/^"(?:0|[1-9]\d*)"$/.test(expected))throw new ApiError(400,'invalid_revision','If-Match must contain the exact local workspace ETag.');if(expected!==`"${state.localRevision}"`)throw new ApiError(412,'revision_conflict','Your local workspace changed. Refresh it before saving these changes.');}
      const result = await operation(state);
      if(beforeCommit!==null&&beforeCommit()!==undefined)throw new ApiError(503,'invalid_service_guard','The local job authority is unavailable.');
      const next = copyPortfolioArchive(result.state, result.state);
      if(!Object.hasOwn(next,'portfolioArchive')&&state.portfolioArchive)throw new ApiError(409,'archive_index_missing','Keep the saved archive index with this workspace.');
      if(!next.portfolioArchive||JSON.stringify(next.portfolioArchive)===JSON.stringify(state.portfolioArchive))copyPortfolioArchive(state,next);
      next.localInstallation=clone(state.localInstallation);next.localRevision=state.localRevision+1;
      next.localReplayReceipts=clone(state.localReplayReceipts);
      if(key!==undefined){const {state:_state,...receipt}=result;next.localReplayReceipts.unshift({key,fingerprint:signature,result:{...receipt,...(managedJobCommit?{managedJobCommit:clone(managedJobCommit)}:{})}});next.localReplayReceipts.length=Math.min(next.localReplayReceipts.length,64);}
      if(next.portfolioWorks!==undefined||next.kernelInitializations!==undefined){assertSafeJson(next);if(next.portfolioArchive?.entries.length){validateArchiveGraph(allPortfolioWork(next));retainedSubmissionReviews(next);retainedLocalGoalTransfers(next);retainedLocalKernelInitializations(next);}else createLocalManifest(next);if(Buffer.byteLength(JSON.stringify(next))>1900*1024)throw new ApiError(413,'portfolio_workspace_full','This update would fill the local workspace. Export and review retained work before adding more. Nothing was saved.');}
      await historyStore.persist(next,beforeCommit===null?undefined:{beforeCommit});
      state = next;
      return {...result,state:{...clone(next),...(directTransferRuntime?{ownerFundedTransfers:await directTransferRuntime.read()}: {})}};
    });
    mutations = run.catch(() => {});
    return run;
  }
  if(managedJobHost!==null){
    portfolioExact(managedJobHost,['jobs','scope','clock','checkpoint','runner','onReady'],['jobs','scope','onReady']);
    if(typeof managedJobHost.onReady!=='function')throw new ApiError(503,'managed_job_configuration','The private job host is unavailable.');
    // Source-only explicit trusted composition. Default server/CLI start never
    // loads this adapter or starts a worker; HTTP input cannot install it.
    const {createLocalManagedJobBinding}=await import('../src/server/local-managed-job-binding.mjs');
    const binding=createLocalManagedJobBinding({jobs:managedJobHost.jobs,trustedScope:managedJobHost.scope,clock:managedJobHost.clock,checkpoint:managedJobHost.checkpoint,runner:managedJobHost.runner??null,historyStore,
      readHydratedState:()=>copyPortfolioArchive(state,clone(state)),
      enqueueNativeMutation:({route,body,expectedETag,idempotencyKey,beforeCommit,managedJobCommit})=>{
        if(!['/api/local/portfolio-work','/api/research/methods/complete'].includes(route)||typeof beforeCommit!=='function')throw new ApiError(403,'service_authority_required','Use the private native result binding.');
        return mutate({method:'POST',url:route,headers:{'if-match':expectedETag,'idempotency-key':idempotencyKey}},body,async current=>{const result=await (route==='/api/local/portfolio-work'?savePortfolioWork(current,body,new Date(),{transport:'headless-cli'}):completeResearchWork(current,body,new Date(),{transport:'headless-cli'}));await managedJobHost.checkpoint?.('native-validated');return result;},beforeCommit,managedJobCommit);
      }});
    await managedJobHost.onReady(binding);
  }
  const ownerFlow=createLocalOwnerFlow({readState:()=>clone(state),bridgeFactory:ownerBridgeFactory,readerFactory:goalTransferReaderFactory,authorizeReadPlan:authorizeGoalReadPlan,
    write:(key,body,operation)=>mutate({method:'POST',url:'/internal/owner-flow',headers:{'idempotency-key':key}},body,operation)});
  const kernelFlow=createLocalKernelFlow({readState:()=>clone(state),bridgeFactory:kernelBridgeFactory,readerFactory:kernelReaderFactory,authorizeReadPlan:authorizeKernelReadPlan,write:(key,body,operation)=>mutate({method:'POST',url:'/internal/kernel-flow',headers:{'idempotency-key':key}},body,operation)});
  const publicState=async()=>({...clone(state),...(directTransferRuntime?{ownerFundedTransfers:await directTransferRuntime.read()}:{} )});
  const protectedRuntime=protectedLocal===null?null:await (await import('../src/server/protected-local-runtime.mjs')).createProtectedLocalRuntime({...protectedLocal,dataFile,installationId:state.localInstallation.id,readState:()=>copyPortfolioArchive(state,clone(state)),historyStore});
  const checkpointOwner=checkpointOwnerFactory===null?null:checkpointOwnerFactory({readWorkspaceBinding:()=>({installationId:state.localInstallation.id,dataLocationFingerprint}),readSelectedRecord:ref=>{const record=allPortfolioWork(state).find(r=>r.id===ref.recordId);if(!record||record.format!==ref.format||record.digest!==ref.digest)throw new ApiError(409,'checkpoint_selection_changed','The selected saved proposal changed.');return record;}});
  const server=http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const writes = !['GET', 'HEAD'].includes(request.method);
      if(checkpointOwner){
        response.setHeader('x-frame-options','DENY');response.setHeader('referrer-policy','no-referrer');
        const address=server.address(),expected=new URL(checkpointOwner.origin);
        if(!address||typeof address==='string'||address.address!=='127.0.0.1'||address.port!==Number(expected.port)||request.headers.host!==expected.host||!['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress))throw new ApiError(403,'checkpoint_origin_denied','Open the exact private owner address on this computer.');
      }
      if(protectedRuntime){
        const address=server.address();
        if(!address||typeof address==='string'||!['127.0.0.1','::1'].includes(address.address))throw new LocalClientAccessError('local_listen_address_denied');
        const origin=`http://${address.address==='::1'?'[::1]':address.address}:${address.port}`;
        const shellAsset=['/checkpoint-review.mjs','/src/vendor/kernel-identity-codecs.mjs'].includes(url.pathname);
        const shellRequest=shellAsset?Object.assign(Object.create(request),{url:'/wallet-provider.mjs'+url.search}):request;
        if(await protectedRuntime.handle(shellRequest,response,origin))return;
      }else enforceLocalRequest(request, writes);
      if(url.pathname.startsWith('/api/local/checkpoint-owner/')){
        if(!checkpointOwner)throw new ApiError(503,'checkpoint_unavailable','The private owner profile is not configured.');
        const action=url.pathname.slice('/api/local/checkpoint-owner/'.length);
        try{
          checkpointOwner.guard(request,server,{bootstrap:action==='bootstrap'});
          if(action==='bootstrap')return sendJson(response,200,checkpointOwner.bootstrap(),{'cache-control':'no-store'});
          if(!['list','read','prepare','refresh-review','begin-wallet','report','recover-reference','observe','public-receipt'].includes(action))throw new ApiError(404,'checkpoint_route_unavailable','This checkpoint action is unavailable.');
          return sendJson(response,200,await checkpointOwner.action(action,await parseBody(request)),{'cache-control':'no-store'});
        }catch(error){return sendJson(response,Number.isInteger(error.status)?error.status:409,{error:{code:/^[a-z_]{1,80}$/.test(error.code??'')?error.code:'checkpoint_action_stopped',message:({already_reserved:'This operation already has a wallet reservation. Check wallet activity and save its original transaction reference; do not resend.',checkpoint_session_expired:'This browser connection expired. Reload saved progress to reconnect.',checkpoint_grant_expired:'The owner review expired or was revoked. Open saved progress before arranging a new review. Existing reservations remain.',expired:'This review expired. Inspect saved progress before arranging a new review.',dependency_recheck_required:'Check the contract’s saved receipt again before continuing with this proposal.',read_attempt_uncertain:'The previous check may be incomplete. Its allowance remains reserved. Inspect the same operation before another check.',storage_uncertain:'A save may have reached disk. Preserve the original files and inspect this operation before retrying.',checkpoint_selection_changed:'The selected proposal changed. Open the original saved proposal before continuing.',checkpoint_recovery_denied:'Local recovery access is unavailable. Keep the original transaction reference and ask the owner to reopen recovery access.'})[error.code]??'This checkpoint action stopped. Inspect the saved operation before continuing.'}},{'cache-control':'no-store'});}
      }
      if (url.pathname.startsWith('/api/')) {
        if(historyStore.isUncertain())throw new ApiError(503,'archive_commit_uncertain','The last save may have reached disk. Restart this same workspace, then inspect its original operation before retrying. This runtime cannot read or write further data.');
        // Only the returned representation changes. Operation identity and saved effects stay the same.
        const operationResponse = result => {
          if (url.searchParams.get('response') !== 'operation') return result;
          const { state:ignored, ...operation } = result;
          return operation;
        };
        if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true, service: 'angbao-local-demo', demo: true, authenticated: false, accountRequired: false, researchPortfolio:true, singleWorkspace: true, externalIntegrations: false, directOwnerTestnet:directTransferRuntime?.available()===true, checkpointOwner:checkpointOwner!==null }, localHeaders());
        if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, await publicState(), localHeaders());
        if (request.method === 'GET' && url.pathname === '/api/handoff') {
          const args = Object.fromEntries(url.searchParams), snapshot = state, headers = {etag:`"${snapshot.localRevision}"`,'x-workspace-revision':String(snapshot.localRevision)};
          const handoff = await readFinancialHandoff(snapshot, args, {workspaceId:await financialWorkspaceId('local',snapshot.localInstallation.id),etag:headers.etag});
          return sendJson(response,200,handoff,headers);
        }
        if (request.method === 'GET' && url.pathname === '/api/local/capabilities') return sendJson(response, 200, { ...localCapabilities(state), programVersion:ANGBAO_LOCAL_VERSION, dataLocationFingerprint, ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(process.env.ANGBAO_SETUP_LAUNCH_ID || '') ? {setupLaunchId:process.env.ANGBAO_SETUP_LAUNCH_ID} : {}) }, localHeaders());
        if (request.method === 'GET' && url.pathname === '/api/local/context') return sendJson(response, 200, {
          context: { inputMode:state.inputMode, goals:clone(state.goals.slice(0,10)), cash:clone(state.cash), rules:clone(state.rules), installedStrategies:clone(state.installedStrategies.slice(0,20)) },
          truncated:{ goals:state.goals.length>10, installedStrategies:state.installedStrategies.length>20 }
        }, localHeaders());
        if (request.method === 'GET' && url.pathname === '/api/local/history') {
          const raw=url.searchParams.get('limit')??'20';
          if(!/^(?:[1-9]|1[0-9]|20)$/.test(raw))throw new ApiError(400,'invalid_limit','Choose between 1 and 20 reviews to read from history.');
          const reviews=clone(state.reviewRuns.slice(0,Number(raw)));
          const history=()=>{const ids=new Set(reviews.map(review=>review.id));return {reviews,decisions:Object.fromEntries(Object.entries(state.reviewDecisions??{}).filter(([id])=>ids.has(id))),feedback:Object.fromEntries(Object.entries(state.reviewFeedback??{}).filter(([id])=>ids.has(id))),truncated:state.reviewRuns.length>reviews.length};};
          while(reviews.length&&Buffer.byteLength(JSON.stringify(history()))>65536)reviews.pop();
          return sendJson(response,200,history(),localHeaders());
        }
        if (request.method === 'GET' && url.pathname === '/api/local/manifest') return sendJson(response, 200, createLocalManifest(state), { ...localHeaders(), 'content-disposition':'attachment; filename="angbao-local-claim.json"' });
        if (request.method === 'GET' && url.pathname === '/api/local/sample-preset') return sendJson(response, 200, previewSamplePreset(url.searchParams.get('preset') ?? 'try-savings'), localHeaders());
        if (request.method === 'POST' && url.pathname === '/api/local/sample-review') {
          const body = await parseBody(request);
          if (!plainObject(body) || Object.keys(body).length !== 1 || body.presetId !== 'try-savings') throw new ApiError(400, 'invalid_sample_review', 'Save the named sample with only presetId: try-savings. Your saved inputs have not changed.');
          if (!request.headers['if-match'] || !request.headers['idempotency-key']) throw new ApiError(428, 'sample_review_identity_required', 'Preview the sample, then provide If-Match and a non-secret Idempotency-Key to save its review.');
          const result = await mutate(request, body, current => createSampleReview(current, { presetId:body.presetId, source:url.searchParams.get('response') === 'operation' ? 'cli' : undefined }));
          return sendJson(response, 200, operationResponse(result), localHeaders());
        }
        if (request.method === 'POST' && url.pathname === '/api/local/setup') {
          const body = setupDeclaration(await parseBody(request));
          if (!request.headers['if-match'] || !request.headers['idempotency-key']) throw new ApiError(428, 'local_setup_identity_required', 'Read the local workspace version, then provide If-Match and a non-secret Idempotency-Key to save setup.');
          const result = await mutate(request, body, current => {
            const next = updateClientState(current, { inputMode:body.inputMode, cash:body.cash, goals:body.goals, rules:body.rules, installedStrategies:[...current.installedStrategies.filter(item=>item.id!==body.strategy.id),body.strategy] });
            return { state:next, context:{inputMode:next.inputMode,cash:clone(next.cash),goals:clone(next.goals),rules:clone(next.rules),installedStrategies:clone(next.installedStrategies)} };
          });
          const {state:ignored,...operation}=result;
          return sendJson(response, 200, operation, localHeaders());
        }
        if (request.method === 'PUT' && url.pathname === '/api/state') {
          const body = await parseBody(request);
          const result = await mutate(request, body, current => { const {localReplayReceipts:ignored,...input}=body;return {state:updateClientState(current,input)}; });
          return sendJson(response, 200, result.state, localHeaders());
        }
        if (request.method === 'POST' && url.pathname === '/api/review') {
          const body = await parseBody(request);
          return sendJson(response, 200, operationResponse(await mutate(request, body, current => {
            assertRepeatReview(current, body);
            const result=linkRepeatReview(createReview(current,body),body);result.state.onboardingDone=true;return result;
          })), localHeaders());
        }
        if (request.method === 'POST' && url.pathname === '/api/feedback') {
          const body = await parseBody(request);
          return sendJson(response, 200, operationResponse(await mutate(request, body, current => submitReviewFeedback(current, body))), localHeaders());
        }
        if(url.pathname==='/api/local/direct-transfer'||url.pathname.startsWith('/api/local/direct-transfer/')){
          try{
            if(request.method==='GET'&&url.pathname==='/api/local/direct-transfer')return sendJson(response,200,{purpose:'robinhood-eoa-goal-transfer',available:directTransferRuntime?.available()===true,records:directTransferRuntime?await directTransferRuntime.read():[],state:await publicState()},localHeaders());
            if(!directTransferRuntime?.available())throw new ApiError(503,'direct_unavailable','The explicit owner-funded testnet route is not configured. Nothing was sent.');
            const action=url.pathname.slice('/api/local/direct-transfer/'.length);if(request.method!=='POST'||!['prepare','begin-wallet','report','recover-reference','observe'].includes(action))throw new ApiError(404,'not_found','This test-transfer action is unavailable.');
            const body=await parseBody(request);let result;if(action==='observe'&&(typeof request.headers['idempotency-key']!=='string'||!/^[-A-Za-z0-9_.:]{8,128}$/.test(request.headers['idempotency-key'])))throw new ApiError(428,'direct_observation_key_required','Use the original operation key when retrying this receipt check.');
            if(action==='prepare'){
              portfolioExact(body,['transferId','transferDigest','caps','route']);if(body.route!=='direct-owner-eoa')throw new ApiError(400,'direct_route_choice','Choose the explicit owner-wallet testnet route.');
              if(request.headers['if-match']!==`"${state.localRevision}"`)throw new ApiError(412,'revision_conflict','Refresh the saved transfer review before preparing it.');
              const selected=readLocalGoalTransfer(state,body.transferId);if(selected.digest!==body.transferDigest||selected.imported||selected.state!=='awaiting-wallet'||selected.ownerOperation||selected.submission||selected.preparationStatus)throw new ApiError(409,'direct_selection','This transfer already has another execution path or changed. Inspect its existing history.');
              result=await directTransferRuntime.prepare({intent:selected.intent,caps:body.caps});
            }else{
              const keys=action==='begin-wallet'?['id','reviewDigest']:action==='report'?['id','challengeId','transactionHash']:action==='recover-reference'?['id','reviewDigest','transactionHash']:['id','recheck'];portfolioExact(body,keys);
              if(action==='begin-wallet'){const record=await directTransferRuntime.read(body.id),selected=readLocalGoalTransfer(state,body.id);if(selected.imported||selected.intent.intentDigest!==record.intent.intentDigest||selected.state!=='awaiting-wallet'||selected.ownerOperation||selected.submission||selected.preparationStatus)throw new ApiError(409,'direct_selection','The original saved transfer changed. Inspect its history.');}
              result=await directTransferRuntime[action==='begin-wallet'?'beginWallet':action==='recover-reference'?'recordReference':action](action==='observe'?{...body,operationKey:request.headers['idempotency-key']}:body);
            }
            return sendJson(response,200,{purpose:'robinhood-eoa-goal-transfer',result,state:await publicState(),ownerApprovalObtained:false,submissionAllowed:false},localHeaders());
          }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(409,'direct_action_stopped','The test transfer could not be confirmed. Read its saved status; do not send another transfer.');}
        }
        if(url.pathname==='/api/local/kernel-initializations'||url.pathname==='/api/local/kernel-initializations/preview'){
          if(request.method==='GET'&&url.pathname==='/api/local/kernel-initializations')return sendJson(response,200,{state:clone(state),purpose:'kernel-account-initialization',initializations:retainedLocalKernelInitializations(state),routeAvailable:kernelRouteEvidenceDigest!==null,runtimeAvailable:kernelFlow.available()},localHeaders());
          if(request.method==='POST'){
            if(!kernelRouteEvidenceDigest)throw new ApiError(503,'kernel_route_unavailable','Test-account setup needs a verified supported route and gas coverage. Your reviews and research remain available without signup.');
            const body=await parseBody(request),preview=url.pathname.endsWith('/preview');portfolioExact(body,preview?['owner']:['owner','workspaceId','workspaceETag']);
            if(!request.headers['if-match']||preview&&request.headers['if-match']!==`"${state.localRevision}"`)throw new ApiError(412,'kernel_preview_changed','Refresh and preview the account setup again.');
            if(preview)return sendJson(response,200,{preview:await previewLocalKernelInitialization(state,{owner:body.owner,routeEvidenceDigest:kernelRouteEvidenceDigest})},localHeaders());
            if(!request.headers['idempotency-key'])throw new ApiError(428,'kernel_identity_required','Preview this account setup before saving.');
            const result=await mutate(request,body,current=>saveLocalKernelInitializationReview(current,{...body,routeEvidenceDigest:kernelRouteEvidenceDigest}));return sendJson(response,200,operationResponse(result),localHeaders());
          }
        }
        if(url.pathname==='/api/local/kernel-flow'||url.pathname.startsWith('/api/local/kernel-flow/')){
          try{
            if(request.method==='GET'&&url.pathname==='/api/local/kernel-flow'){
              if([...url.searchParams.keys()].some(key=>key!=='initializationId')||url.searchParams.getAll('initializationId').length>1)throw new ApiError(400,'kernel_selection','Choose one saved account setup.');
              const id=url.searchParams.get('initializationId');return sendJson(response,200,id?{...await kernelFlow.read({initializationId:id}),state:clone(state)}:{purpose:'kernel-account-initialization',available:kernelFlow.available(),routeAvailable:kernelRouteEvidenceDigest!==null},localHeaders());
            }
            if(request.method==='POST'&&['/api/local/kernel-flow/wallet/respond','/api/local/kernel-flow/wallet/cancel'].includes(url.pathname)){
              const body=await parseBody(request),respond=url.pathname.endsWith('/respond');portfolioExact(body,respond?['challengeId','response']:['challengeId']);return sendJson(response,200,{walletChallenge:respond?await kernelFlow.respondWallet(body.challengeId,body.response):kernelFlow.cancelWallet(body.challengeId)},localHeaders());
            }
            const action=url.pathname.slice('/api/local/kernel-flow/'.length);if(request.method!=='POST'||!['prepare','begin-wallet','submit','observe'].includes(action))throw new ApiError(404,'kernel_route_unavailable','This account setup action is unavailable.');
            const body=await parseBody(request);portfolioExact(body,['initializationId','initializationDigest',...(['begin-wallet','submit'].includes(action)?['initializationReviewDigest']:[])]);
            if(typeof body.initializationId!=='string'||!/^[a-f0-9-]{36}$/.test(body.initializationId)||!Object.keys(body).filter(key=>key!=='initializationId').every(key=>typeof body[key]==='string'&&/^[a-f0-9]{64}$/.test(body[key])))throw new ApiError(400,'kernel_selection','Reopen the exact saved account setup.');
            if(!kernelFlow.available())throw new ApiError(503,'kernel_flow_unavailable','Test-account preparation is not configured. Verified factory support and gas coverage are still required. Nothing was sent.');
            if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'kernel_identity_required','Refresh the saved account setup before continuing.');
            const reserved=await mutate(request,body,current=>({state:clone(current),initializationId:body.initializationId,kernelAction:action}));if(!reserved.replayed){if(action==='begin-wallet')await kernelFlow.beginWallet(body);else await kernelFlow[action](body);}
            const current=await kernelFlow.read({initializationId:body.initializationId});return sendJson(response,200,{state:clone(state),initializationId:body.initializationId,initializationDigest:current.initialization.digest,kernelFlow:current,replayed:reserved.replayed===true},localHeaders());
          }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'kernel_action_refused','This account setup action could not be confirmed. Read saved status before continuing.');}
        }
        if(url.pathname==='/api/local/owner-flow'||url.pathname.startsWith('/api/local/owner-flow/')){
          // Wallet responses never enter durable mutation receipts or request fingerprints.
          try{
            if(request.method==='GET'&&url.pathname==='/api/local/owner-flow'){
              if([...url.searchParams.keys()].some(key=>key!=='transferId')||url.searchParams.getAll('transferId').length>1)throw new ApiError(400,'owner_selection','Choose one saved transfer.');
              const id=url.searchParams.get('transferId');
              return sendJson(response,200,id?{...await ownerFlow.read({transferId:id}),state:clone(state)}:{available:ownerFlow.available(),message:'Wallet preparation requires a verified existing account, test token and gas route. Signup is optional.'},localHeaders());
            }
            if(request.method==='POST'&&['/api/local/owner-flow/wallet/respond','/api/local/owner-flow/wallet/cancel'].includes(url.pathname)){
              const body=await parseBody(request),respond=url.pathname.endsWith('/respond');
              portfolioExact(body,respond?['challengeId','response']:['challengeId']);
              const result=respond?await ownerFlow.respondWallet(body.challengeId,body.response):ownerFlow.cancelWallet(body.challengeId);
              return sendJson(response,200,{walletChallenge:result},localHeaders());
            }
            const action=url.pathname.slice('/api/local/owner-flow/'.length);
            if(request.method!=='POST'||!['prepare','begin-wallet','submit','observe'].includes(action))throw new ApiError(404,'owner_route_unavailable','This wallet action is unavailable.');
            const body=await parseBody(request),keys=['transferId','transferDigest',...(['begin-wallet','submit'].includes(action)?['ownerReviewDigest']:[])];
            portfolioExact(body,keys);
            if(!/^[a-f0-9-]{36}$/.test(body.transferId)||!keys.filter(key=>key!=='transferId').every(key=>typeof body[key]==='string'&&/^[a-f0-9]{64}$/.test(body[key])))throw new ApiError(400,'owner_selection','Reopen the exact saved transfer.');
            if(!ownerFlow.available())throw new ApiError(503,'owner_flow_unavailable','Wallet preparation is not available yet. A verified existing account, test token and gas route are still required. Nothing was sent.');
            if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'owner_identity_required','Refresh the saved transfer before continuing.');
            // Reserve the user's exact request before external work. A replay reads status only.
            const reserved=await mutate(request,body,current=>({state:clone(current),transferId:body.transferId,ownerAction:action}));
            if(!reserved.replayed){if(action==='begin-wallet')await ownerFlow.beginWallet(body);else await ownerFlow[action](body);}
            const current=await ownerFlow.read({transferId:body.transferId});
            return sendJson(response,200,{state:clone(state),transferId:body.transferId,transferDigest:current.transfer.digest,ownerFlow:current,replayed:reserved.replayed===true},localHeaders());
          }catch(error){
            if(error instanceof ApiError)throw error;
            throw new ApiError(400,'owner_action_refused','This wallet action could not be confirmed. Read saved status before continuing.');
          }
        }
        if(request.method==='GET'&&url.pathname.startsWith('/api/local/goal-transfers/')){const record=readLocalGoalTransfer(state,url.pathname.slice('/api/local/goal-transfers/'.length));return sendJson(response,200,{transfer:record,review:readSubmissionReview(state,record.localReviewId),work:readPortfolioWork(state,record.localWorkId),unsigned:{callData:encodeGoalTransferKernelCallData(record.intent),call:record.intent.call,userOperation:null,provenance:'canonical-offline-encoding',expiresAt:record.intent.expiresAt},capabilityTruth:{localOnly:true,financialAuthority:false,signingAllowed:false,submissionAllowed:false}},localHeaders());}
        if(request.method==='POST'&&['/api/local/goal-transfers','/api/local/goal-transfers/report'].includes(url.pathname)){const body=await parseBody(request);if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'transfer_identity_required','Reopen this transfer before changing its history.');let result;try{result=await mutate(request,body,current=>url.pathname.endsWith('/report')?reportLocalGoalTransfer(current,body):prepareLocalGoalTransfer(current,body));}catch(error){if(error instanceof GoalTransferError)throw new ApiError(400,error.code,'The test transfer could not be prepared. Recheck the selected token, account, recipient, amount and expiry. Nothing was sent.');throw error;}return sendJson(response,200,operationResponse(result),localHeaders());}
        if(request.method==='GET'&&url.pathname==='/api/local/goal-transfers'){
          if([...url.searchParams.keys()].some(key=>key!=='workId')||url.searchParams.getAll('workId').length>1)throw new ApiError(400,'invalid_transfer_selection','Choose one exact proposal.');
          const workId=url.searchParams.get('workId'),work=workId?readPortfolioWork(state,workId):null;
          const reviews=retainedSubmissionReviews(state).filter(record=>!workId||record.localWorkId===workId);
          return sendJson(response,200,{...(work?{work}:{}),reviews,transfers:retainedLocalGoalTransfers(state).filter(record=>!workId||record.localWorkId===workId).map(record=>({id:record.id,localWorkId:record.localWorkId,localReviewId:record.localReviewId,state:record.state,createdAt:record.createdAt,updatedAt:record.updatedAt,imported:record.imported,userOperationHash:record.userOperationHash,transactionHash:record.transactionHash,digest:record.digest})),capabilityTruth:{localOnly:true,financialAuthority:false,signingAllowed:false,submissionAllowed:false}},localHeaders());
        }
        if(url.pathname==='/api/local/submission-reviews'||url.pathname.startsWith('/api/local/submission-reviews/')){
          if(request.method==='GET'){const id=url.pathname.slice('/api/local/submission-reviews/'.length);return sendJson(response,200,url.pathname==='/api/local/submission-reviews'?{reviews:retainedSubmissionReviews(state)}:{review:readSubmissionReview(state,id)},localHeaders());}
          if(request.method==='POST'&&url.pathname==='/api/local/submission-reviews'){
            const body=await parseBody(request);if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'review_identity_required','Reopen this proposal before saving your review.');
            const result=await mutate(request,body,current=>saveSubmissionReview(current,body));return sendJson(response,200,operationResponse(result),localHeaders());
          }
        }
        if(url.pathname==='/api/local/research-portfolio/preview'&&request.method==='POST')return sendJson(response,200,previewSavedResearchPortfolio(state,await parseBody(request)),localHeaders());
        if(url.pathname==='/api/local/research-portfolio'&&request.method==='POST'){
          const body=await parseBody(request);if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'research_portfolio_identity_required','Preview first, then keep the same revision and original operation key.');
          const result=await mutate(request,body,current=>saveResearchPortfolio(current,body,new Date(),{transport:url.searchParams.get('response')==='operation'?'headless-cli':'browser'}));return sendJson(response,200,operationResponse(result),localHeaders());
        }
        if(url.pathname==='/api/local/history-archive'||url.pathname.startsWith('/api/local/history-archive/')){
          const action=url.pathname.slice('/api/local/history-archive/'.length);
          if(request.method==='GET'&&url.pathname==='/api/local/history-archive')return sendJson(response,200,{archive:archiveIndex(state),activeIds:(state.portfolioWorks??[]).map(r=>r.id),signupRequired:false},localHeaders());
          if(request.method==='GET'&&action==='export')return sendJson(response,200,exportPortfolioHistory(state),{...localHeaders(),'content-disposition':'attachment; filename="angbao-portfolio-history.json"'});
          if(request.method!=='POST')throw new ApiError(404,'not_found','This history action is unavailable.');
          const body=await parseBody(request,action.startsWith('import')?ARCHIVE_BUNDLE_BYTES:BODY_LIMIT);
          if(action==='preview'){portfolioExact(body,['action','ids']);return sendJson(response,200,previewArchiveChange(state,body),localHeaders());}
          if(action==='import-preview'){portfolioExact(body,['bundle']);return sendJson(response,200,previewHistoryImport(state,body.bundle),localHeaders());}
          if(!['commit','import'].includes(action))throw new ApiError(404,'not_found','This history action is unavailable.');
          if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'archive_identity_required','Preview first, then keep the same revision and operation key when saving.');
          if(action==='import')portfolioExact(body,['bundle','previewDigest']);
          const result=await mutate(request,body,current=>action==='commit'?applyArchiveChange(current,body):importPortfolioHistory(current,body));return sendJson(response,200,operationResponse(result),localHeaders());
        }
        if(url.pathname==='/api/local/portfolio-work'||url.pathname.startsWith('/api/local/portfolio-work/')){
          const snapshot=state,headers={etag:`"${snapshot.localRevision}"`,'x-workspace-revision':String(snapshot.localRevision)};
          if(request.method==='GET'){
            if(url.pathname==='/api/local/portfolio-work/sample'){const input=JSON.parse(await readFile(path.join(PROJECT_DIR,'examples/portfolio-decision/input.json'),'utf8'));return sendJson(response,200,{input,draft:portfolioDraftFromInput(input),presetId:'try-portfolio-check',saved:false,capabilityTruth:LOCAL_PORTFOLIO_FACTS},headers);}
            return sendJson(response,200,readPortfolioWorkResult(snapshot,url.pathname==='/api/local/portfolio-work'?null:url.pathname.slice('/api/local/portfolio-work/'.length)),headers);
          }
          if(request.method==='POST'){
            const body=await parseBody(request);
            if(url.pathname.endsWith('/source'))return sendJson(response,200,intakePortfolioSource(body),headers);
            if(url.pathname.endsWith('/instrument'))return sendJson(response,200,identifyPortfolioInstrument(body),headers);
            if(url.pathname.endsWith('/form')){portfolioExact(body,['input']);previewPortfolioWork(snapshot,body);let draft=null;try{const candidate=portfolioDraftFromInput(body.input);if(portfolioCanonical(composePortfolioDraft(candidate).input)===portfolioCanonical(body.input))draft=candidate;}catch{/* Full domain validation above remains mandatory. The optional form converter may not represent every valid blocked/partial snapshot; preserve the complete input in JSON. */}return sendJson(response,200,{draft,saved:false,capabilityTruth:LOCAL_PORTFOLIO_FACTS},headers);}
            if(url.pathname.endsWith('/compose'))return sendJson(response,200,{...composePortfolioDraft(body),capabilityTruth:LOCAL_PORTFOLIO_FACTS},headers);
            if(url.pathname.endsWith('/preview'))return sendJson(response,200,previewPortfolioWork(snapshot,body),headers);
            if(url.pathname!=='/api/local/portfolio-work')throw new ApiError(404,'not_found','This portfolio action is unavailable.');
            if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'portfolio_identity_required','Preview the proposal, then save with its current revision and original request identity.');
            const result=await mutate(request,body,current=>savePortfolioWork(current,body,new Date(),{transport:url.searchParams.get('response')==='operation'?'headless-cli':'browser'}));return sendJson(response,200,operationResponse(result),localHeaders());
          }
        }
        if (url.pathname === '/api/research/methods' || url.pathname.startsWith('/api/research/methods/')) {
          const snapshot=state,headers={etag:`"${snapshot.localRevision}"`,'x-workspace-revision':String(snapshot.localRevision)};
          if(request.method==='GET'){
            if(url.pathname==='/api/research/methods')return sendJson(response,200,{works:retainedResearchWork(snapshot).map(work=>({id:work.id,question:work.memory.run.question,method:work.memory.run.method,createdAt:work.createdAt,completedAt:work.completedAt,briefId:work.briefId})),capabilityTruth:RESEARCH_MEMORY_FACTS},headers);
            const work=readResearchWork(snapshot,url.pathname.slice('/api/research/methods/'.length));await validateResearchMethodMemory(work.memory);return sendJson(response,200,{work,capabilityTruth:RESEARCH_MEMORY_FACTS},headers);
          }
          if(request.method==='POST'){
            const body=await parseBody(request);
            if(url.pathname.endsWith('/prepare'))return sendJson(response,200,{...await prepareResearchWork(snapshot,body),capabilityTruth:RESEARCH_MEMORY_FACTS},headers);
            if(url.pathname.endsWith('/preview'))return sendJson(response,200,{...await previewResearchWorkBrief(snapshot,body),capabilityTruth:RESEARCH_MEMORY_FACTS},headers);
            if(!request.headers['if-match']||!request.headers['idempotency-key'])throw new ApiError(428,'research_work_identity_required','Preview the selected work, then save with its current revision and original operation key.');
            const context={transport:url.searchParams.get('response')==='operation'?'headless-cli':'browser'};
            const result=await mutate(request,body,current=>url.pathname==='/api/research/methods'?savePreparedResearchWork(current,body,new Date(),context):url.pathname.endsWith('/complete')?completeResearchWork(current,body,new Date(),context):Promise.reject(new ApiError(404,'not_found','This research action is unavailable.')));
            return sendJson(response,200,operationResponse(result),localHeaders());
          }
        }
        if (request.method === 'GET' && url.pathname === '/api/research/briefs') return sendJson(response,200,{briefs:listResearchBriefs(state),capabilityTruth:RESEARCH_MEMORY_FACTS,retention:{maxVersions:20,completeHistory:false}},localHeaders());
        if (request.method === 'GET' && url.pathname.startsWith('/api/research/briefs/')) return sendJson(response,200,{brief:readResearchBrief(state,url.pathname.slice('/api/research/briefs/'.length)),capabilityTruth:RESEARCH_MEMORY_FACTS},localHeaders());
        if (request.method === 'POST' && url.pathname === '/api/research/briefs') {
          const body=await parseBody(request);
          return sendJson(response,200,operationResponse(await mutate(request,body,current=>saveResearchBrief(current,body,new Date(),{transport:url.searchParams.get('response')==='operation'?'headless-cli':'browser'}))),localHeaders());
        }
        if (request.method === 'POST' && url.pathname === '/api/billing/simulate') {
          const body = await parseBody(request);
          return sendJson(response, 200, await mutate(request, body, current => simulateBilling(current, body)), localHeaders());
        }
        if (request.method === 'GET' && url.pathname === '/api/export') return sendJson(response, 200, {...exportWorkspace(state),...(state.portfolioArchive?.entries.length?{portfolioHistory:exportPortfolioHistory(state)}:{}),state:await publicState()}, { ...localHeaders(), 'content-disposition': 'attachment; filename="angbao-demo-workspace.json"' });
        throw new ApiError(404, 'not_found', 'This request address is unavailable. Check the Angbao endpoint and try again.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError(405, 'method_not_allowed', 'This address only supports GET or HEAD requests.');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new ApiError(400, 'invalid_path', 'This address is invalid. Check the URL and try again.'); }
      if(pathname==='/src/vendor/kernel-identity-codecs.mjs'){
        const content=await readFile(path.join(PROJECT_DIR,'src/vendor/kernel-identity-codecs.mjs'));
        response[PROTECTED_EGRESS]?.();
        response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','x-content-type-options':'nosniff','cache-control':protectedRuntime?'no-store':'no-cache'});return response.end(request.method==='HEAD'?undefined:content);
      }
      const requested = path.resolve(distDir, `.${pathname}`);
      if (requested !== path.resolve(distDir) && !requested.startsWith(`${path.resolve(distDir)}${path.sep}`)) throw new ApiError(403, 'path_rejected', 'This file is outside Angbao and cannot be opened here.');
      let file = requested;
      try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
      catch (error) { if (error.code === 'ENOENT' && !path.extname(pathname)) file = path.join(distDir, 'index.html'); else throw error; }
      const content = await readFile(file);
      response[PROTECTED_EGRESS]?.();
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': protectedRuntime?'no-store':'no-cache', 'referrer-policy': protectedRuntime?'no-referrer':'same-origin' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      delete response[PROTECTED_EGRESS];
      if(protectedRuntime)return sendJson(response,error instanceof LocalClientAccessError?error.status:400,{error:{code:error instanceof LocalClientAccessError?error.code:'local_request_failed',message:'This local request was not confirmed. Your saved workspace is unchanged. For access changes, inspect the owner client list before trying again.'},protectedLocal:true});
      if (error instanceof ApiError || error instanceof ResearchBriefError || error instanceof ResearchWorkError || error instanceof ResearchMethodError || error instanceof PortfolioWorkError || error instanceof PortfolioDecisionError || error instanceof ResearchPortfolioBridgeError) return sendJson(response, error.status, { error: { code: error.code, message: error.message }, demo: true });
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return sendJson(response, 404, { error: { code: 'not_found', message: 'This Angbao page or file is missing. Check the address or restore the app files.' } });
      console.error('[Angbao local]', error.message);
      if (!response.headersSent) sendJson(response, 500, { error: { code: 'internal_error', message: 'Angbao could not finish this request. Check the local server, then inspect saved data before retrying.' } });
      else response.end();
    }
  });
  server.on('close',()=>{checkpointOwner?.close();protectedRuntime?.close();ownerFlow.close();kernelFlow.close();directTransferRuntime?.close();});
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ANGBAO_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ANGBAO_PORT must be a port between 1 and 65535.');
  const server = await createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`Angbao local workspace: http://127.0.0.1:${port}\nLocal use needs no account. Sample data and simulated billing; no financial accounts are connected and no money will move.\nCLI: node cli/angbao.mjs review --demo`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
