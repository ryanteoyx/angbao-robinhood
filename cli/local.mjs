import { ANGBAO_LOCAL_VERSION } from './version.mjs';
/** Accountless loopback adapter. One local server owns the durable workspace. */
import { strategyManifests } from '../ui/catalog.mjs';
import { validateResearchBriefInput } from '../src/domain/research-briefs.mjs';
import { MCP_VERSION, RemoteError, safeRemoteJson, repeatSavedReview } from './remote.mjs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new RemoteError(message); };
const schema = (properties = {}, required = []) => ({ type:'object',properties,required,additionalProperties:false });
const text = maxLength => ({ type:'string',minLength:1,maxLength });
const mutation = { expectedETag:text(40),idempotencyKey:{...text(128),minLength:8} };
const strategy = schema({id:text(80),version:text(64),settings:{type:'object',additionalProperties:{type:'number'}}},['id','version']);
const money = {type:'number',minimum:0,maximum:1000000000};
const declaration = schema({inputMode:{type:'string',enum:['manual']},cash:schema({available:money,upcomingBills:money,monthlyIncome:money,monthlyExpenses:money,currency:text(3)},['available','upcomingBills','monthlyIncome','monthlyExpenses','currency']),goals:{type:'array',minItems:1,maxItems:50,items:schema({id:text(100),name:text(200),targetAmount:money,currentAmount:money,monthlyContribution:money,currency:text(3)},['id','name','targetAmount','currentAmount','monthlyContribution','currency'])},rules:schema({reserve:money,maxSuggestion:money},['reserve','maxSuggestion']),strategy},['inputMode','cash','goals','rules','strategy']);
const tool = (name,description,inputSchema=schema(),write=false) => ({name,description,inputSchema,annotations:{readOnlyHint:!write,...(write?{destructiveHint:false,idempotentHint:true}:{})}});
export const LOCAL_TOOLS = Object.freeze([
  tool('angbao_read_archive','List exact archived portfolio identities; nothing is removed or restored.'),
  tool('angbao_export_portfolio_history','Export all active/archived proposals and exact dependencies in a bounded paged bundle; keep it private.'),
  tool('angbao_preview_archive','Preview moving selected proposals between active and archived history; free and non-destructive.',schema({action:{type:'string',enum:['archive','restore']},ids:{type:'array',minItems:1,maxItems:5,items:text(36)}},['action','ids'])),
  tool('angbao_save_archive','Commit an inspected archive/restore preview. No financial authority is created.',schema({action:{type:'string',enum:['archive','restore']},ids:{type:'array',minItems:1,maxItems:5,items:text(36)},previewDigest:text(64),...mutation},['action','ids','previewDigest','expectedETag','idempotencyKey']),true),
  tool('angbao_preview_history_import','Validate a complete portfolio-history bundle and preview exact identity conflicts before import.',schema({bundle:{type:'object'}},['bundle'])),
  tool('angbao_import_portfolio_history','Import the inspected bundle into the local archive. Existing records and settings remain unchanged; no operations are replayed.',schema({bundle:{type:'object'},previewDigest:text(64),...mutation},['bundle','previewDigest','expectedETag','idempotencyKey']),true),
  tool('angbao_read_transfer_history','Read local saved proposal, review intent and exact test-transfer reports. This cannot sign, send or approve.',schema({workId:text(36),transferId:text(36)})),
  tool('angbao_portfolio_source','Normalize supplied source text; no fetch or save.',schema({input:{type:'object'}},['input'])),
  tool('angbao_portfolio_instrument','Bind an exact typed asset identity to a target; no quote or connection.',schema({input:{type:'object'}},['input'])),
  tool('angbao_portfolio_sample','Read the named synthetic portfolio-check preset without saving.',schema({presetId:{type:'string',enum:['try-portfolio-check']}},['presetId'])),
  tool('angbao_preview_research_portfolio','Check an exact saved research version and your agent’s assessment against supplied portfolio values and unchanged owner limits. Preview only; no fetch or save.',schema({briefId:text(36),expectedBriefDigest:text(64),researchWorkId:text(36),expectedResearchWorkDigest:text(64),evidenceBindings:{type:'array'},assessment:{type:'object'},portfolio:{type:'object'},policy:{type:'object'},asOf:text(30),previousWorkId:text(36)},['briefId','expectedBriefDigest','evidenceBindings','assessment','portfolio','policy','asOf'])),
  tool('angbao_save_research_portfolio','Explicitly save the inspected research-linked proposal with exact source versions and comparison. No order or permission is created.',schema({handoff:{type:'object'},previousWorkId:text(36),...mutation},['handoff','expectedETag','idempotencyKey']),true),
  tool('angbao_preview_portfolio','Preview supplied agent assessment against manual/sample portfolio and owner limits. No save or approval.',schema({input:{type:'object'},previousWorkId:text(36)},['input'])),
  tool('angbao_save_portfolio','Explicitly retain the full inspected local proposal; no order, approval or settings change.',schema({decision:{type:'object'},previousWorkId:text(36),...mutation},['decision','expectedETag','idempotencyKey']),true),
  tool('angbao_read_portfolio','List or read exact saved local proposals, full input lineage, gaps and comparison.',schema({workId:text(36)})),
  tool('angbao_prepare_research_work','Prepare a bounded pinned method from supplied evidence. No fetch, synthesis or save.',schema({input:{type:'object'},previousWorkId:text(36)},['input'])),
  tool('angbao_read_research_work','List or read exact saved research work, its pin/settings, evidence and authored status.',schema({workId:text(36)})),
  tool('angbao_save_research_work','Explicitly save prepared method work without generating an answer.',schema({memory:{type:'object'},...mutation},['memory','expectedETag','idempotencyKey']),true),
  tool('angbao_preview_research_work','Preview a separately authored answer against exact saved method work; nothing is saved.',schema({workId:text(36),brief:{type:'object'}},['workId','brief'])),
  tool('angbao_complete_research_work','Explicitly save the previewed authored answer and retain its complete method lineage.',schema({workId:text(36),brief:{type:'object'},...mutation},['workId','brief','expectedETag','idempotencyKey']),true),
  tool('angbao_read_handoff','Continue one exact saved review or research brief with its original settings, sources, gaps and current changes. This read grants no permission and performs no save.',schema({kind:{type:'string',enum:['review','research-brief','research-method','portfolio']},recordId:text(100),workspaceId:text(71),digest:text(64),baseETag:text(40)},['kind','recordId'])),
  tool('angbao_list_strategies','List available strategy versions and their settings. This grants no financial permissions.'),
  tool('angbao_read_workspace','Read saved cash, goals, limits and installed strategies. Inputs are sample or entered by the user and remain unverified.'),
  tool('angbao_read_history','Read up to 20 saved local reviews, decisions and feedback.',schema({limit:{type:'integer',minimum:1,maximum:20}})),
  tool('angbao_save_context','Save the complete user-confirmed cash, goals, limits and selected strategy locally. Setup needs no account and grants no financial authority.',schema({declaration,...mutation},['declaration','expectedETag','idempotencyKey']),true),
  tool('angbao_run_strategy','Run and save a free review for a chosen strategy version when the user asks. For an explicit repeat, include repeatOfReviewId and that review’s exact goal and settings. No financial action is taken.',schema({strategy,goalId:text(100),repeatOfReviewId:text(100),...mutation},['strategy','expectedETag','idempotencyKey']),true),
  tool('angbao_submit_feedback','Save the rating the user chose for a specific saved review.',schema({reviewId:text(100),rating:{type:'string',enum:['useful','not-useful','unclear']},reason:{type:'string',maxLength:500},...mutation},['reviewId','rating','expectedETag','idempotencyKey']),true),
  tool('angbao_list_research_briefs','List up to 20 local research versions. They stay unverified; no provider or model is called.'),
  tool('angbao_read_research_brief','Read a specific saved local research version. It stays unverified.',schema({briefId:text(36)},['briefId'])),
  tool('angbao_save_research_brief','Save final research with its question, answer, sources, claims and gaps. Leave out credentials and private reasoning.',schema({brief:{type:'object',required:['question','answer','authorship','evidence','claims','inferences','gaps']},...mutation},['brief','expectedETag','idempotencyKey']),true),
]);
export function localOrigin(value = 'http://127.0.0.1:4317') {
  let url; try { url = new URL(value); } catch { fail('ANGBAO_API_URL must be an exact loopback HTTP origin.'); }
  if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.origin !== value || url.username || url.password) fail('ANGBAO_API_URL must be an exact loopback HTTP origin without credentials, path, query or fragment.');
  return url.origin;
}
export function createLocalClient({ origin, fetchImpl = globalThis.fetch, timeoutMs = 10000, maxResponseBytes = 524288 } = {}) {
  origin = localOrigin(origin);
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 256 || maxResponseBytes > 1048576) fail('Invalid local transport limits.');
  async function request(route, body, args = {}) {
    const controller = new AbortController(); let reader, timer;
    const operation = async () => {
      const headers = body === undefined ? {} : {'content-type':'application/json','If-Match':args.expectedETag,'Idempotency-Key':args.idempotencyKey};
      const response = await fetchImpl(origin + route,{method:body===undefined?'GET':'POST',headers,redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
      if (!response.ok) {
        if((route.startsWith('/api/local/portfolio-work')||route.startsWith('/api/local/research-portfolio'))&&response.status<500){
          reader=response.body?.getReader();let raw='',size=0;const decoder=new TextDecoder();if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4096){raw='';break;}raw+=decoder.decode(chunk.value,{stream:true});}void reader?.cancel().catch(()=>{});
          let code;try{code=JSON.parse(raw).error?.code;}catch{}const messages={research_brief_not_found:'This exact saved research version is unavailable. Keep the original proposal and choose a retained brief.',research_work_not_found:'This exact research approach is unavailable. Reopen its original saved work.',research_portfolio_needs_input:'This saved research needs more source details before it can support a proposal. Ask your agent to keep unread links and unknown dates explicit; save a new research version if needed.',research_brief_digest_mismatch:'The saved research version differs from the selected reference. Reopen the original brief.',research_portfolio_snapshot_changed:'The research preview changed. Reopen its exact saved version before saving.',research_source_mapping_mismatch:'The supplied sources do not match this saved brief. Keep its exact text, dates and citation references.',research_assessment_mapping_mismatch:'The assessment must retain this brief’s claims, counterevidence, inferences and gaps.',portfolio_policy_change_pending:'Allocation targets or limits changed. Keep the earlier proposal; a separate owner policy review is required before sizing.',portfolio_work_not_found:'This saved portfolio proposal is unavailable. Another proposal was not substituted.',portfolio_work_exists:'This exact portfolio proposal is already saved. Open the original work.',portfolio_work_full:'Saved portfolio work is full. Archive an older proposal to keep saving for free.',portfolio_work_too_large:'This proposal exceeds the saved-work limit. Create a smaller research version or assessment and preview again. Keep the original sources; nothing was saved.',portfolio_workspace_full:'This update would fill the local workspace. Export and review retained work first.'};const message=typeof code==='string'&&Object.hasOwn(messages,code)?messages[code]:null;if(message)fail(`Local request failed (${response.status}). ${message}`);
        }
        await response.body?.cancel().catch(()=>{}); if(route.startsWith('/api/handoff?'))fail(response.status===404?'This saved work is no longer retained. Choose a saved review or research brief; another record was not substituted.':response.status===409?'This continuation reference belongs to another workspace or a changed record. Reopen the original saved work.':'The saved work could not be opened. Check the connection and exact reference.'); fail(`Local request failed (${response.status}). ${response.status >= 500 ? 'A save may have reached the server. Keep its original key, body and ETag before retrying.' : 'The request was not accepted. Check the inputs and read the saved workspace before trying again.'}`); }
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); fail('Local API returned an unsupported response.'); }
      reader=response.body?.getReader(); const decoder=new TextDecoder('utf-8',{fatal:true}); let size=0,raw='';
      if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(route==='/api/local/history-archive/export'?4*1024*1024:maxResponseBytes))fail('Local response exceeds the size limit.');raw+=decoder.decode(value,{stream:true});}
      raw+=decoder.decode();const data=JSON.parse(raw),etag=response.headers.get('etag');
      if(!plain(data)||!/^"(?:0|[1-9]\d*)"$/.test(etag||''))fail('Local API did not provide a valid workspace revision.');
      return {data,etag,replayed:data.replayed===true||response.headers.get('idempotency-replayed')==='true'};
    };
    try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new RemoteError('The local request was not confirmed before timeout. Keep its original operation key, body and ETag before retrying a save.'));},timeoutMs);})]);}
    catch(error){if(error instanceof RemoteError)throw error;fail('The local transport failed. Check that angbao start is running. A save may have reached the server; keep its original key, body and ETag before retrying. No account is required.');}
    finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
  }
  async function capabilities(){const {data,etag}=await request('/api/local/capabilities');if(data.authenticated!==false||data.accountRequired!==false||data.capabilities?.cashReview!==true||data.capabilities?.researchMemory!==true||data.capabilities?.providerReads!==false||data.capabilities?.financialAuthority!==false||data.installation?.schema!=='angbao-local-installation@1'||typeof data.installation.id!=='string'||!Number.isInteger(data.revision)||etag!==`"${data.revision}"`)fail('This server does not support the expected local tools. Check that you started the matching Angbao version.');return {...data,etag};}
  async function api(name,args={}) {
    const definition=LOCAL_TOOLS.find(item=>item.name===name);if(!definition||!plain(args)||Object.keys(args).some(key=>!Object.hasOwn(definition.inputSchema.properties,key))||definition.inputSchema.required.some(key=>!Object.hasOwn(args,key)))fail('Unsupported local tool or arguments.');
    if(definition.annotations.readOnlyHint===false&&(typeof args.expectedETag!=='string'||typeof args.idempotencyKey!=='string'||!/^"(?:0|[1-9]\d*)"$/.test(args.expectedETag)||!/^[\x21-\x7e]{8,128}$/.test(args.idempotencyKey)||/^abp_/.test(args.idempotencyKey)))fail('To save, send the current quoted ETag and a unique non-secret operation key.');
    if(['angbao_read_archive','angbao_export_portfolio_history','angbao_preview_archive','angbao_save_archive','angbao_preview_history_import','angbao_import_portfolio_history'].includes(name)){
      if((await capabilities()).capabilities?.portfolioArchive!==true)fail('This local program does not offer archive/restore. Use the matching program.');
      const action={angbao_read_archive:'',angbao_export_portfolio_history:'/export',angbao_preview_archive:'/preview',angbao_save_archive:'/commit',angbao_preview_history_import:'/import-preview',angbao_import_portfolio_history:'/import'}[name],{expectedETag,idempotencyKey,...fields}=args,body=['angbao_read_archive','angbao_export_portfolio_history'].includes(name)?undefined:fields;
      const {data,etag,replayed}=await request('/api/local/history-archive'+action,body,args);return {...(name==='angbao_export_portfolio_history'?{bundle:data}:data),etag,replayed,accountRequired:false};
    }
    if(['angbao_preview_research_portfolio','angbao_save_research_portfolio'].includes(name)){
      if((await capabilities()).capabilities?.researchPortfolio!==true)fail('This program does not offer saved research portfolio checks. Use the matching local program; nothing was saved.');
      if(name==='angbao_preview_research_portfolio'){const {data,etag}=await request('/api/local/research-portfolio/preview',args);return {...data,etag,accountRequired:false};}
    }
    if(name==='angbao_read_transfer_history'){if((await capabilities()).capabilities?.ownerTransferHistory!==true)fail('This local program does not offer transfer history.');const {data,etag}=await request('/api/local/goal-transfers'+(args.transferId?'/'+encodeURIComponent(args.transferId):args.workId?'?workId='+encodeURIComponent(args.workId):''));return {...data,etag,accountRequired:false};}
    if(['angbao_portfolio_source','angbao_portfolio_instrument','angbao_portfolio_sample','angbao_preview_portfolio','angbao_save_portfolio','angbao_read_portfolio'].includes(name)){
      if((await capabilities()).capabilities?.portfolioProposals!==true)fail('This local connection does not offer portfolio proposals. Use the matching program; no save occurred.');
      if(name!=='angbao_save_portfolio'){
        const route=name==='angbao_portfolio_sample'?'/api/local/portfolio-work/sample':name==='angbao_read_portfolio'?'/api/local/portfolio-work'+(args.workId?'/'+encodeURIComponent(args.workId):''):'/api/local/portfolio-work/'+({angbao_portfolio_source:'source',angbao_portfolio_instrument:'instrument',angbao_preview_portfolio:'preview'}[name]);
        if(name==='angbao_portfolio_sample'&&args.presetId!=='try-portfolio-check')fail('Choose the named try-portfolio-check sample.');
        const body=['angbao_portfolio_sample','angbao_read_portfolio'].includes(name)?undefined:name==='angbao_preview_portfolio'?args:args.input;
        const {data,etag}=await request(route,body);return {...data,etag,accountRequired:false};
      }
    }
    if(['angbao_prepare_research_work','angbao_read_research_work','angbao_preview_research_work'].includes(name)){
      const route='/api/research/methods'+(name==='angbao_read_research_work'?(args.workId?'/'+encodeURIComponent(args.workId):''):name==='angbao_prepare_research_work'?'/prepare':'/preview');
      const {data,etag}=await request(route,name==='angbao_read_research_work'?undefined:args);return {...data,etag,accountRequired:false};
    }
    if(name==='angbao_read_handoff'){
      const {validateHandoffArguments}=await import('../src/domain/financial-handoff.mjs');
      try{validateHandoffArguments(args);}catch(error){fail(error.message);}
      const {data,etag}=await request('/api/handoff?'+new URLSearchParams(args));return {...data,etag,accountRequired:false};
    }
    if(name==='angbao_list_strategies'){await capabilities();return {builtinManifests:strategyManifests,accountRequired:false,financialAuthority:false};}
    if(name==='angbao_read_workspace'||name==='angbao_read_history'){
      if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>20))fail('History limit must be from 1 to 20.');
      const {data,etag}=await request(name==='angbao_read_workspace'?'/api/local/context':`/api/local/history?limit=${args.limit||10}`);
      return {...data,etag,accountRequired:false};
    }
    if(name==='angbao_list_research_briefs'||name==='angbao_read_research_brief'){
      if(name==='angbao_read_research_brief'&&!/^[0-9a-f-]{36}$/i.test(args.briefId||''))fail('Read requires an exact saved brief UUID.');
      const {data,etag}=await request('/api/research/briefs'+(name==='angbao_read_research_brief'?`/${args.briefId}`:''));return {...data,etag};
    }
    let route,body;
    if(name==='angbao_save_research_portfolio'){route='/api/local/research-portfolio';const {expectedETag,idempotencyKey,...fields}=args;body=fields;
    }else if(name==='angbao_save_portfolio'){route='/api/local/portfolio-work';const {expectedETag,idempotencyKey,...fields}=args;body=fields;
    }else if(name==='angbao_save_research_work'||name==='angbao_complete_research_work'){route='/api/research/methods'+(name==='angbao_complete_research_work'?'/complete':'');const {expectedETag,idempotencyKey,...fields}=args;body=fields;
    }else if(name==='angbao_save_context'){
      if(!plain(args.declaration)||args.declaration.inputMode!=='manual')fail('Setup requires a complete manual declaration. Use the existing review command for sample inputs.');
      route='/api/local/setup';body=args.declaration;
    }else if(name==='angbao_run_strategy'){
      if(!plain(args.strategy)||Object.keys(args.strategy).some(key=>!['id','version','settings'].includes(key))||!strategyManifests.some(item=>item.id===args.strategy.id&&item.version===args.strategy.version))fail('Choose an exact supported built-in strategy pin.');
      if(args.repeatOfReviewId!==undefined&&(typeof args.repeatOfReviewId!=='string'||!args.repeatOfReviewId||args.repeatOfReviewId.length>100))fail('An explicit repeat requires an exact prior review ID.');
      // The server derives mode from saved context at the supplied revision. Keep
      // this body stable so deliberate replay still works after context changes.
      route='/api/review';body={strategy:args.strategy,...(args.goalId===undefined?{}:{goalId:args.goalId}),...(args.repeatOfReviewId===undefined?{}:{repeatOfReviewId:args.repeatOfReviewId}),managed:false,source:'cli'};
    }else if(name==='angbao_save_research_brief'){route='/api/research/briefs';try{body=validateResearchBriefInput(args.brief);}catch(error){fail(error.message);}}
    else{route='/api/feedback';body={reviewId:args.reviewId,rating:args.rating,...(args.reason===undefined?{}:{reason:args.reason})};}
    const {data,etag,replayed}=await request(route+'?response=operation',body,args);return {...(['angbao_save_research_portfolio','angbao_save_portfolio','angbao_save_research_work','angbao_complete_research_work'].includes(name)?{workId:data.workId,workDigest:data.workDigest,...(data.comparison?{comparison:data.comparison}:{}),...(data.brief?{brief:data.brief}:{} )}:name==='angbao_save_context'?{context:data.context}:name==='angbao_run_strategy'?{review:data.review}:name==='angbao_save_research_brief'?{brief:data.brief}:{reviewId:data.reviewId,feedback:data.feedback}),etag,replayed,accountRequired:false};
  }
  async function mcp(message){
    if(message.method==='initialize'){await capabilities();if(message.params?.protocolVersion!==MCP_VERSION)fail('Local MCP is pinned to 2025-06-18.');return {jsonrpc:'2.0',id:message.id,result:{protocolVersion:MCP_VERSION,capabilities:{tools:{}},serverInfo:{name:'angbao-local',version:ANGBAO_LOCAL_VERSION},instructions:'Private accountless local workspace; saved unverified research, no provider calls or financial authority. Sign-in is optional for a later explicit hosted import.'}};}
    if(message.method==='notifications/initialized')return null;
    if(message.method==='ping')return {jsonrpc:'2.0',id:message.id,result:{}};
    if(message.method==='tools/list'){const info=await capabilities(),offArchive=['angbao_read_archive','angbao_export_portfolio_history','angbao_preview_archive','angbao_save_archive','angbao_preview_history_import','angbao_import_portfolio_history'],availableTools=info.capabilities?.portfolioArchive===true?LOCAL_TOOLS:LOCAL_TOOLS.filter(tool=>!offArchive.includes(tool.name)),tools=info.capabilities?.portfolioProposals===true?availableTools:availableTools.filter(tool=>!['angbao_portfolio_source','angbao_portfolio_instrument','angbao_portfolio_sample','angbao_preview_portfolio','angbao_save_portfolio','angbao_read_portfolio'].includes(tool.name));return {jsonrpc:'2.0',id:message.id,result:{tools:(info.capabilities?.ownerTransferHistory===true?tools:tools.filter(tool=>tool.name!=='angbao_read_transfer_history')).filter(tool=>info.capabilities?.researchPortfolio===true||!['angbao_preview_research_portfolio','angbao_save_research_portfolio'].includes(tool.name))}};}
    if(message.method==='tools/call'){const result=await api(message.params?.name,message.params?.arguments);return {jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:safeRemoteJson(result)}],structuredContent:result,isError:false}};}
    fail('Unsupported local MCP method.');
  }
  const repeat = args => repeatSavedReview({api},args);
  async function sample({action,presetId,expectedETag,idempotencyKey}={}) {
    if (!['preview','save'].includes(action) || presetId !== 'try-savings') fail('Use sample preview or sample save with --preset try-savings.');
    if (action === 'preview') {
      const {data,etag} = await request('/api/local/sample-preset?preset=try-savings');
      return {...data,etag,accountRequired:false};
    }
    if (typeof expectedETag !== 'string' || !/^"(?:0|[1-9]\d*)"$/.test(expectedETag) || typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{8,128}$/.test(idempotencyKey) || /^abp_/.test(idempotencyKey)) fail('To save the sample review, send the preview’s quoted ETag and a unique non-secret operation key.');
    const {data,etag,replayed} = await request('/api/local/sample-review?response=operation', {presetId}, {expectedETag,idempotencyKey});
    return {review:data.review,etag,replayed,accountRequired:false};
  }
  return {api,mcp,capabilities,repeat,sample,print:safeRemoteJson};
}
