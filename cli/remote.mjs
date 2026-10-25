import { ANGBAO_LOCAL_VERSION } from './version.mjs';
/** Thin remote transport. No local state, planner, financial math or credential files. */
import { lstat, readFile } from 'node:fs/promises';
import { validateResearchBriefInput } from '../src/domain/research-briefs.mjs';
export const MCP_VERSION = '2025-06-18';
export class RemoteError extends Error {
  constructor(message) { super(message); this.name = 'RemoteError'; }
}
const fail = message => { throw new RemoteError(message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const TOKEN = /^abp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;
export function remoteOrigin(value) {
  let url; try { url = new URL(value); } catch { fail('Set ANGBAO_REMOTE_ORIGIN or --origin to your account workspace’s HTTPS address, without a path.'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) fail('Remote origin must be an HTTPS address without a path, query, fragment or embedded credentials.');
  return url.origin;
}
export function safeRemoteJson(value, token = '') {
  let json = JSON.stringify(value);
  if (token) json = json.replaceAll(token, '[REDACTED]');
  return json.replace(/abp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}/gi, '[REDACTED]');
}
function failure(status) {
  const hint = status === 401 ? 'The access key is missing, expired, revoked or invalid. Check your agent’s secret settings.' : status === 403 ? 'This key cannot access the requested data, or this deployment is restricted. Check the key’s permissions.' : status === 409 || status === 412 ? 'The workspace or request has changed. Read the saved version before deciding whether to retry.' : status === 429 ? 'This key has reached a request or review limit. Wait or check its allowance.' : status >= 500 ? 'Account access is unavailable. A save may have reached the server; keep its original key, body and revision before retrying.' : 'The request was not accepted. Check the command and its inputs.';
  return `Remote request failed (${status}). ${hint} No retry was sent and the local workspace was not used.`;
}
export function createRemoteClient({ origin, token, fetchImpl = globalThis.fetch, timeoutMs = 10000, maxResponseBytes = 524288 } = {}) {
  origin = remoteOrigin(origin);
  if (typeof token !== 'string' || !TOKEN.test(token)) fail('Set ANGBAO_AGENT_TOKEN in your agent’s secret environment. Do not pass an access key as a command argument.');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 256 || maxResponseBytes > 1048576) fail('Invalid remote transport limits.');
  async function send(endpoint, payload, notification = false) {
    if (!['/api/agent', '/mcp'].includes(endpoint)) fail('Unsupported remote endpoint.');
    const body = JSON.stringify(payload);
    if (body.includes(token) || new TextEncoder().encode(body).length > 32768) fail('Request exceeds limits or contains a credential in its payload.');
    const controller = new AbortController(); let timer, reader;
    const operation = async () => {
      const response = await fetchImpl(origin + endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: endpoint === '/mcp' ? 'application/json, text/event-stream' : 'application/json', ...(endpoint === '/mcp' ? { 'mcp-protocol-version': MCP_VERSION } : {}) }, body, redirect: 'error', cache: 'no-store', signal: controller.signal });
      if (!response.ok) { await response.body?.cancel(); fail(failure(response.status)); }
      if (response.redirected || response.headers.has('mcp-session-id')) { await response.body?.cancel(); fail('Only the configured stateless Angbao endpoint is supported.'); }
      if (notification && response.status !== 202) { await response.body?.cancel(); fail('Notification was not accepted as an empty 202 response.'); }
      const type = response.headers.get('content-type') || '';
      const sse = !notification && endpoint === '/mcp' && /^text\/event-stream(?:\s*;|$)/i.test(type);
      if (!(notification && response.status === 202) && !sse && !/^application\/json(?:\s*;|$)/i.test(type)) { await response.body?.cancel(); fail('Hosted endpoint returned an unsupported response type.'); }
      reader = response.body?.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '', events = 0;
      if (reader) while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > maxResponseBytes) fail('Hosted response exceeds the size limit.');
        text += decoder.decode(value, { stream: true });
        if (sse) {
          let match;
          while ((match = /\r?\n\r?\n/.exec(text))) {
            const event = text.slice(0, match.index); text = text.slice(match.index + match[0].length);
            const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (!data) continue; if (++events > 16) fail('Hosted event limit exceeded.');
            const parsed = JSON.parse(data);
            if (parsed?.jsonrpc !== '2.0' || parsed.id !== payload.id || !(Object.hasOwn(parsed, 'result') || Object.hasOwn(parsed, 'error'))) fail('Unexpected server-initiated or mismatched MCP message.');
            await reader.cancel(); return parsed;
          }
        }
      }
      text += decoder.decode();
      if (notification) { if (response.status !== 202 || text.length) fail('Notification was not accepted as an empty 202 response.'); return null; }
      if (sse) fail('Hosted MCP event stream ended without a matching response.');
      const parsed = JSON.parse(text);
      if (!plain(parsed)) fail('Hosted endpoint returned an invalid response.');
      if (endpoint === '/mcp' && (parsed.jsonrpc !== '2.0' || parsed.id !== payload.id || !(Object.hasOwn(parsed, 'result') || Object.hasOwn(parsed, 'error')))) fail('Hosted MCP response did not match the request.');
      return parsed;
    };
    try {
      return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new RemoteError('The remote request was not confirmed before timeout. If this was a save, retry only with its original operation key, body and revision.')); }, timeoutMs); })]);
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      fail('The remote transport failed. A save may have reached the server. Keep the original operation key, body and revision before retrying. The local workspace was not used.');
    } finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
  }
  return { api: (tool, args = {}) => send('/api/agent', { tool, arguments: args }), mcp: message => send('/mcp', message, message.id === undefined), print: value => safeRemoteJson(value, token) };
}
export function parseRemoteOptions(args) {
  const remaining = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--origin') { if (options.origin !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) fail('--origin requires one exact HTTPS origin.'); options.origin = args[++i]; }
    else if (args[i] === '--hosted') { if (options.hosted) fail('--hosted may be supplied once.'); options.hosted = true; }
    else remaining.push(args[i]);
  }
  return { remaining, origin: options.origin, hosted: options.hosted === true || options.origin !== undefined };
}
export const AGENT_HELP = `Angbao agent commands — local by default, no account required
  angbao agent doctor | capabilities
  angbao agent strategies
  angbao agent context
  angbao agent history [--limit 1..20]
  angbao agent handoff (--review ID | --brief ID | --work ID | --portfolio ID)
    [--workspace WORKSPACE_REF --digest RECORD_DIGEST] [--etag '"N"']
  angbao agent setup --file declaration.json --etag '"N"' --key OPERATION_ID
  angbao agent sample preview --preset try-savings
  angbao agent sample save --preset try-savings --etag '"N"' --key OPERATION_ID
  angbao agent review --strategy ID@VERSION [--settings JSON] [--goal ID]
    --etag '"N"' --key OPERATION_ID
  angbao agent repeat --review ID --inputs-confirmed yes --etag '"N"' --key OPERATION_ID
  angbao agent feedback --review ID --rating useful|not-useful|unclear
    [--reason TEXT] --etag '"N"' --key OPERATION_ID
  angbao agent research-portfolio preview|save --file FILE [--etag ETAG --key KEY]
  angbao agent portfolio sample|source|instrument|preview|save|read [--file FILE] [--id ID] [--previous ID]
  angbao agent method prepare --file INPUT.json [--previous WORK_ID]
  angbao agent method save --file PREPARED.json --etag '"N"' --key OPERATION_ID
  angbao agent method read [--id WORK_ID]
  angbao agent method preview --id WORK_ID --file ANSWER.json
  angbao agent method complete --id WORK_ID --file ANSWER.json --etag '"N"' --key OPERATION_ID
  angbao agent briefs list
  angbao agent briefs read --id VERSION_UUID
  angbao agent briefs save --file INPUT.json --etag '"N"' --key OPERATION_ID
Start the local workspace with angbao start. Its address is ANGBAO_API_URL or http://127.0.0.1:4317.
No Angbao account or token is needed for local reviews and research memory.
setup and sample are local only. Setup declares manual cash, goals, limits and a strategy.
Sample preview saves nothing. Sample save adds a labelled review without replacing your saved inputs or strategy settings.
Before repeat, check your saved inputs and explicitly confirm them. It reuses the retained review's exact strategy/settings with current inputs.
Hosted access is optional: add --hosted (ANGBAO_REMOTE_ORIGIN) or --origin HTTPS_ORIGIN.
Only hosted commands use ANGBAO_AGENT_TOKEN from your agent’s secret environment.
--key identifies one save request. Use a unique non-secret value, NEVER the bearer token.
doctor checks the connection without reading your financial context or history.
Hosted reads need the key’s permission. Save reviews or feedback only when the user asks.
Archive: angbao agent archive list|export|preview|save|import-preview|import. Preview/save use explicit JSON files; mutations require --etag and --key.
Briefs contain final authored or imported research and stay unverified. Hosted research needs separate permission.
These commands do not call providers or models, retry automatically, merge data, collect payment, schedule work or trade.
MCP bridge: angbao mcp (local); angbao mcp --hosted (optional hosted).
MCP stateless version pinned to 2025-06-18. Local and hosted storage stay separate
until an explicit owner-confirmed claim. You can keep working locally if you stop or cannot sign in.
`;
export async function runAgentCommand(args, { env = process.env, write = value => console.log(value), fetchImpl } = {}) {
  if(args.includes('--protected-local-client')){const{runProtectedAgent}=await import('./protected-local.mjs');await runProtectedAgent(args,{env,write,fetchImpl});return;}
  const { remaining, origin, hosted } = parseRemoteOptions(args); const command = remaining.shift();
  if (!command || ['help', '--help', '-h'].includes(command)) { write(AGENT_HELP); return; }
  if (!['doctor', 'capabilities', 'strategies', 'context', 'history', 'setup', 'sample', 'review', 'repeat', 'feedback', 'briefs', 'handoff', 'method','portfolio','research-portfolio','transfers','archive'].includes(command)) fail('Unknown agent command. Use angbao agent help.');
  if (hosted && ['setup','sample','portfolio','research-portfolio','transfers','archive'].includes(command)) fail(command==='transfers'?'Transfer history is available only on the computer holding this workspace. No hosted connection was opened.':['portfolio','research-portfolio'].includes(command)?'Portfolio proposals are local-only. Hosted access was not read and local work was not used.':'Setup and sample are local-only commands. Hosted access was not read and the local workspace was not used.');
  const researchPortfolioCommand=command==='research-portfolio'?remaining.shift():null;
  if(command==='research-portfolio'&&!['preview','save'].includes(researchPortfolioCommand))fail('Use agent research-portfolio preview|save --file FILE.');
  const archiveCommand=command==='archive'?remaining.shift():null;
  if(command==='archive'&&!['list','export','preview','save','import-preview','import'].includes(archiveCommand))fail('Use archive list|export|preview|save|import-preview|import.');
  const portfolioCommand=command==='portfolio'?remaining.shift():null;
  if(command==='portfolio'&&!['source','instrument','sample','preview','save','read'].includes(portfolioCommand))fail('Use agent portfolio source|instrument|sample|preview|save|read.');
  const methodCommand=command==='method'?remaining.shift():null;
  if(command==='method'&&!['prepare','save','read','preview','complete'].includes(methodCommand))fail('Use agent method prepare|save|read|preview|complete.');
  const briefCommand = command === 'briefs' ? remaining.shift() : null;
  if (command === 'briefs' && !['list','read','save'].includes(briefCommand)) fail('Use angbao agent briefs list|read|save.');
  const sampleCommand = command === 'sample' ? remaining.shift() : null;
  if (command === 'sample' && !['preview','save'].includes(sampleCommand)) fail('Use angbao agent sample preview|save --preset try-savings.');
  const options = {};
  while (remaining.length) {
    const flag = remaining.shift(), value = remaining.shift();
    if (!['--limit','--strategy','--settings','--goal','--etag','--key','--review','--rating','--reason','--id','--file','--inputs-confirmed','--preset','--brief','--workspace','--digest','--previous','--work','--portfolio'].includes(flag) || !value || value.startsWith('--') || Object.hasOwn(options, flag)) fail('Unknown, repeated or incomplete agent option. Tokens are environment-only.');
    options[flag] = value;
  }
  const allowed = command==='research-portfolio'?{preview:['--file'],save:['--file','--etag','--key']}[researchPortfolioCommand]:command==='archive'?{list:[],export:[],preview:['--file'],save:['--file','--etag','--key'],'import-preview':['--file'],import:['--file','--etag','--key']}[archiveCommand]:command==='transfers'?['--id','--work']:command==='portfolio'?{source:['--file'],instrument:['--file'],sample:[],preview:['--file','--previous'],save:['--file','--previous','--etag','--key'],read:['--id']}[portfolioCommand]:command==='method'?{prepare:['--file','--previous'],save:['--file','--etag','--key'],read:['--id'],preview:['--id','--file'],complete:['--id','--file','--etag','--key']}[methodCommand]:command === 'briefs' ? {list:[],read:['--id'],save:['--file','--etag','--key']}[briefCommand] : command === 'sample' ? {preview:['--preset'],save:['--preset','--etag','--key']}[sampleCommand] : { doctor:[],capabilities:[],strategies:[],context:[],history:['--limit'],handoff:['--review','--brief','--work','--portfolio','--workspace','--digest','--etag'],setup:['--file','--etag','--key'],review:['--strategy','--settings','--goal','--etag','--key'],repeat:['--review','--inputs-confirmed','--etag','--key'],feedback:['--review','--rating','--reason','--etag','--key'] }[command];
  if (Object.keys(options).some(key => !allowed.includes(key))) fail('Option is not valid for this agent command.');
  if(hosted&&options['--portfolio'])fail('Portfolio proposals are local-only. No hosted connection was read.');
  const client = hosted ? createRemoteClient({ origin: origin ?? env.ANGBAO_REMOTE_ORIGIN, token: env.ANGBAO_AGENT_TOKEN, fetchImpl }) : (await import('./local.mjs')).createLocalClient({origin:env.ANGBAO_API_URL,fetchImpl}); let result;
  if(command==='research-portfolio'){
    if(!options['--file'])fail('Choose the assessment or inspected preview file from your agent.');
    const {readFile,lstat}=await import('node:fs/promises');let value;try{const info=await lstat(options['--file']);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)throw Error();value=JSON.parse(await readFile(options['--file'],'utf8'));}catch{fail('Use a regular research portfolio JSON file within256KiB.');}
    const fields=researchPortfolioCommand==='preview'?value:{handoff:value.handoff??value,...(value.previousWorkId?{previousWorkId:value.previousWorkId}:{}),expectedETag:options['--etag'],idempotencyKey:options['--key']};
    result=await client.api(researchPortfolioCommand==='preview'?'angbao_preview_research_portfolio':'angbao_save_research_portfolio',fields);write(client.print(result));return result;
  }else if(command==='archive'){
    let fields={};if(!['list','export'].includes(archiveCommand)){if(!options['--file'])fail('Choose the original archive/preview JSON file.');const {readFile,lstat}=await import('node:fs/promises');const info=await lstat(options['--file']);if(!info.isFile()||info.isSymbolicLink()||info.size>4*1024*1024)fail('Use a physical history JSON file within4MiB.');const value=JSON.parse(await readFile(options['--file'],'utf8'));fields=archiveCommand==='import-preview'?{bundle:value.bundle??value}:archiveCommand==='save'?{action:value.action,ids:value.ids,previewDigest:value.previewDigest}:value;if(['save','import'].includes(archiveCommand)){fields={...fields,expectedETag:options['--etag'],idempotencyKey:options['--key']};}}
    result=await client.api({list:'angbao_read_archive',export:'angbao_export_portfolio_history',preview:'angbao_preview_archive',save:'angbao_save_archive','import-preview':'angbao_preview_history_import',import:'angbao_import_portfolio_history'}[archiveCommand],fields);write(client.print(result));return result;
  }else if(command==='transfers'){if(options['--id']&&options['--work'])fail('Choose one transfer or one portfolio proposal.');result=await client.api('angbao_read_transfer_history',{...(options['--id']?{transferId:options['--id']}:{}),...(options['--work']?{workId:options['--work']}:{})});write(client.print(result));return result;
  }else if(command==='portfolio'){
    let fields={};
    if(portfolioCommand==='read')fields=options['--id']?{workId:options['--id']}:{};
    else if(portfolioCommand==='sample')fields={presetId:'try-portfolio-check'};
    else{if(!options['--file'])fail('Select an explicit portfolio JSON file.');const {readFile,lstat}=await import('node:fs/promises');let value;try{const stat=await lstat(options['--file']);if(!stat.isFile()||stat.size>65536)throw Error();value=JSON.parse(await readFile(options['--file'],'utf8'));}catch{fail('Use a regular portfolio JSON file within64KiB.');}
      fields=portfolioCommand==='save'?{decision:value.decision??value}:{input:value.input??value};const wrappedPrevious=portfolioCommand==='save'&&value.decision?value.previousWorkId:undefined;if(wrappedPrevious!==undefined&&(typeof wrappedPrevious!=='string'||options['--previous']&&options['--previous']!==wrappedPrevious))fail('The preview and explicit previous proposal do not match. Keep the selected baseline.');if(options['--previous']||wrappedPrevious)fields.previousWorkId=options['--previous']||wrappedPrevious;
      if(portfolioCommand==='save'){if(!/^"(?:0|[1-9]\d*)"$/.test(options['--etag']||'')||!/^[\x21-\x7e]{8,128}$/.test(options['--key']||'')||TOKEN.test(options['--key']))fail('Save requires the current quoted revision and a non-secret operation key.');fields.expectedETag=options['--etag'];fields.idempotencyKey=options['--key'];}
    }
    result=await client.api({source:'angbao_portfolio_source',instrument:'angbao_portfolio_instrument',sample:'angbao_portfolio_sample',preview:'angbao_preview_portfolio',save:'angbao_save_portfolio',read:'angbao_read_portfolio'}[portfolioCommand],fields);write(client.print(result));return result;
  }
  if(command==='method'){
    let fields;if(methodCommand==='read')fields=options['--id']?{workId:options['--id']}:{};else{let value;try{const file=options['--file'];const info=await lstat(file);if(!info.isFile()||info.size>32768)fail('Method input must be a regular JSON file within32KiB.');value=JSON.parse(await readFile(file,'utf8'));}catch{fail('Choose a valid method input JSON file within32KiB.');}
    fields=methodCommand==='prepare'?{input:value,...(options['--previous']?{previousWorkId:options['--previous']}:{})}:methodCommand==='save'?{memory:value.memory??value}:{workId:options['--id'],brief:value};
    if(['save','complete'].includes(methodCommand)){if(!/^"(?:0|[1-9]\d*)"$/.test(options['--etag']||'')||!/^[\x21-\x7e]{8,128}$/.test(options['--key']||'')||TOKEN.test(options['--key']))fail('Save requires the current quoted revision and a non-secret operation key.');fields.expectedETag=options['--etag'];fields.idempotencyKey=options['--key'];}}
    result=await client.api({prepare:'angbao_prepare_research_work',save:'angbao_save_research_work',read:'angbao_read_research_work',preview:'angbao_preview_research_work',complete:'angbao_complete_research_work'}[methodCommand],fields);write(client.print(result));return result;
  }
  if (['doctor','capabilities'].includes(command)) {
    const initialized = await client.mcp({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{ name:'angbao-personal-cli',version:ANGBAO_LOCAL_VERSION } } });
    if (initialized.error || initialized.result?.protocolVersion !== MCP_VERSION) fail('Hosted MCP protocol negotiation failed. This client is pinned to 2025-06-18.');
    await client.mcp({ jsonrpc:'2.0',method:'notifications/initialized' });
    const listed = await client.mcp({ jsonrpc:'2.0',id:2,method:'tools/list',params:{} });
    if (listed.error || !Array.isArray(listed.result?.tools)) fail('Hosted MCP tool discovery failed.');
    const local = hosted ? null : await client.capabilities();
    result = { connected:true,protocolVersion:MCP_VERSION,authentication:hosted?'manual-personal-access-token':'none-loopback-local',accountRequired:hosted,tools:listed.result.tools,financialReadsPerformed:false,localWorkspaceConnected:!hosted,...(local?{installation:local.installation,programVersion:local.programVersion}:{}),oauthDiscovery:false,harnessCompatibility:'requires-client-smoke-test' };
  } else if (command === 'handoff') {
    if(['--review','--brief','--work','--portfolio'].filter(key=>options[key]).length!==1)fail('Choose one saved review, research brief or method work to continue.');
    const input={kind:options['--portfolio']?'portfolio':options['--review']?'review':options['--brief']?'research-brief':'research-method',recordId:options['--portfolio']||options['--review']||options['--brief']||options['--work'],...(options['--workspace']?{workspaceId:options['--workspace']} : {}),...(options['--digest']?{digest:options['--digest']} : {}),...(options['--etag']?{baseETag:options['--etag']} : {})};
    const {validateHandoffArguments}=await import('../src/domain/financial-handoff.mjs');try{validateHandoffArguments(input);}catch(error){fail(error.message);}
    result=await client.api('angbao_read_handoff',input);
  } else if (command === 'briefs' && briefCommand === 'list') result = await client.api('angbao_list_research_briefs');
  else if (command === 'briefs' && briefCommand === 'read') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options['--id'] || '')) fail('Brief read requires --id with an exact saved version UUID.');
    result = await client.api('angbao_read_research_brief', { briefId: options['--id'] });
  } else if (command === 'strategies') result = await client.api('angbao_list_strategies');
  else if (command === 'sample' && sampleCommand === 'preview') result = await client.sample({action:'preview',presetId:options['--preset']});
  else if (command === 'context') result = await client.api('angbao_read_workspace');
  else if (command === 'history') {
    const limit = options['--limit'] === undefined ? 10 : Number(options['--limit']); if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail('History limit must be an integer from 1 to 20.');
    result = await client.api('angbao_read_history', { limit });
  } else {
    const expectedETag = options['--etag'], idempotencyKey = options['--key'];
    if (!/^"(?:0|[1-9]\d*)"$/.test(expectedETag || '') || !/^[\x21-\x7e]{8,128}$/.test(idempotencyKey || '') || TOKEN.test(idempotencyKey)) fail('Writes require --etag with the exact quoted revision and --key with a non-secret 8–128 character operation identifier.');
    let input;
    if (command === 'sample') {
      result=await client.sample({action:'save',presetId:options['--preset'],expectedETag,idempotencyKey});
      write(client.print(result));return result;
    } else if (command === 'repeat') {
      result=await (hosted?repeatSavedReview(client,{reviewId:options['--review'],inputsConfirmed:options['--inputs-confirmed'],expectedETag,idempotencyKey}):client.repeat({reviewId:options['--review'],inputsConfirmed:options['--inputs-confirmed'],expectedETag,idempotencyKey}));
      write(client.print(result));return result;
    } else if (command === 'setup') {
      let declaration;
      try { const file=options['--file'];if(!file)fail('Setup requires --file declaration.json.');const entry=await lstat(file);if(!entry.isFile()||entry.size>32768)fail('Setup input must be a regular JSON file of at most 32 KiB.');declaration=JSON.parse(await readFile(file,'utf8')); }
      catch { fail('Setup requires a regular JSON file of at most 32 KiB with your complete manual declaration. No inputs were saved.'); }
      input={declaration,expectedETag,idempotencyKey};
    } else if (command === 'briefs') {
      let brief;
      try { const file = options['--file']; if (!file) fail('Brief save requires --file INPUT.json.'); const entry = await lstat(file); if (!entry.isFile() || entry.size > 32768) fail('Brief input must be a regular JSON file of at most 32 KiB.'); brief = validateResearchBriefInput(JSON.parse(await readFile(file, 'utf8'))); }
      catch { fail('Brief input must be valid bounded authoring JSON without credentials, server metadata or unsupported references.'); }
      input = { brief, expectedETag, idempotencyKey };
    } else if (command === 'review') {
      const match = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/.exec(options['--strategy'] || ''); if (!match) fail('Review requires an exact --strategy ID@VERSION.');
      let settings; if (options['--settings'] !== undefined) { try { settings = JSON.parse(options['--settings']); } catch { fail('Settings must be a JSON object.'); } if (!plain(settings) || Object.values(settings).some(value => typeof value !== 'number' || !Number.isFinite(value))) fail('Settings must contain finite numeric values; the server validates supported settings.'); }
      input = { strategy:{ id:match[1],version:match[2],...(settings === undefined ? {} : { settings }) },...(options['--goal'] ? { goalId:options['--goal'] } : {}),expectedETag,idempotencyKey };
    } else {
      if (!options['--review'] || !['useful','not-useful','unclear'].includes(options['--rating'])) fail('Feedback requires an explicit review ID and user-selected rating.');
      input = { reviewId:options['--review'],rating:options['--rating'],...(options['--reason'] === undefined ? {} : { reason:options['--reason'] }),expectedETag,idempotencyKey };
    }
    result = await client.api(command === 'setup' ? 'angbao_save_context' : command === 'briefs' ? 'angbao_save_research_brief' : command === 'review' ? 'angbao_run_strategy' : 'angbao_submit_feedback', input);
  }
  write(client.print(result)); return result;
}

export async function repeatSavedReview(client,{reviewId,inputsConfirmed,expectedETag,idempotencyKey}) {
  if(inputsConfirmed!=='yes')fail('Check current inputs and confirm them before repeating. No review was sent.');
  const handoff=await client.api('angbao_read_handoff',{kind:'review',recordId:reviewId});
  if(!handoff.continuation?.strategy)fail('This review has no complete supported strategy snapshot. Create a new review with explicit settings; no defaults were used.');
  const {repeatOfReviewId,goalId,strategy}=handoff.continuation;
  const result=await client.api('angbao_run_strategy',{repeatOfReviewId,goalId,strategy,expectedETag,idempotencyKey});
  const {compareReviews}=await import('../ui/review-comparison.mjs');
  return {...result,comparison:compareReviews(handoff.record,result.review)};
}
