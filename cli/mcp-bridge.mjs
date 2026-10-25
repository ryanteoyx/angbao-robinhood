/** Version-pinned, stateless Angbao stdio bridge. Not a general remote MCP proxy. */
import { once } from 'node:events';
import { createRemoteClient, parseRemoteOptions, RemoteError, MCP_VERSION } from './remote.mjs';
const METHODS = new Set(['initialize','notifications/initialized','ping','tools/list','tools/call']);
const TOOLS = new Set(['angbao_read_transfer_history','angbao_portfolio_source','angbao_portfolio_instrument','angbao_portfolio_sample','angbao_preview_portfolio','angbao_save_portfolio','angbao_read_portfolio','angbao_prepare_research_work','angbao_read_research_work','angbao_save_research_work','angbao_preview_research_work','angbao_complete_research_work','angbao_read_handoff','angbao_list_strategies','angbao_read_workspace','angbao_read_history','angbao_run_strategy','angbao_submit_feedback','angbao_list_research_briefs','angbao_read_research_brief','angbao_save_research_brief']);
export async function runMcpBridge({ client, input = process.stdin, output = process.stdout, local = false, protectedLocal = false, elfaOperator = false, maxLineBytes = local ? 256 * 1024 : 32768, maxRequests = 1000 } = {}) {
  const allowedTools = elfaOperator ? new Set(['angbao_preview_elfa_events','angbao_fetch_elfa_events','angbao_read_elfa_operation','angbao_read_elfa_evidence']) : protectedLocal ? new Set(['angbao_read_exact_memory']) : local ? new Set([...TOOLS, 'angbao_save_context','angbao_preview_research_portfolio','angbao_save_research_portfolio','angbao_read_archive','angbao_export_portfolio_history','angbao_preview_archive','angbao_save_archive','angbao_preview_history_import','angbao_import_portfolio_history']) : TOOLS;
  let pending = Buffer.alloc(0), count = 0, initialized = false, notified = false;
  async function emit(value) { if (!output.write(client.print(value) + '\n')) await once(output, 'drain'); }
  async function processLine(bytes) {
    if (++count > maxRequests) throw new RemoteError('This MCP session reached its request limit. Start a new session when you want to continue.');
    let message;
    try { message = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
    catch { await emit({jsonrpc:'2.0',id:null,error:{code:-32700,message:'The message is not valid JSON.'}}); return; }
    const hasId = Object.hasOwn(message || {}, 'id');
    const id = hasId && (typeof message.id === 'string' && message.id.length <= 100 || Number.isSafeInteger(message.id)) ? message.id : null;
    const reject = async (code, text) => { if (hasId || !message?.method) await emit({jsonrpc:'2.0',id,error:{code,message:text}}); };
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || (hasId && id === null) || !METHODS.has(message.method)) { await reject(-32600,'Unsupported Angbao MCP message.'); return; }
    if (message.method === 'initialize' && (initialized || !hasId) || message.method !== 'initialize' && !initialized || message.method === 'notifications/initialized' && (hasId || notified) || ['tools/list','tools/call'].includes(message.method) && !notified || message.method !== 'notifications/initialized' && !hasId || message.method === 'tools/call' && !allowedTools.has(message.params?.name)) { await reject(-32600,'Invalid lifecycle or unsupported Angbao tool.'); return; }
    try {
      const result = await client.mcp(message);
      if (message.method === 'tools/list' && Array.isArray(result?.result?.tools)) result.result.tools = result.result.tools.filter(tool => allowedTools.has(tool?.name));
      if (message.method === 'initialize') {
        if (!result.error && result.result?.protocolVersion !== MCP_VERSION) throw new RemoteError('The account server did not accept the expected MCP protocol version.');
        if (!result.error) initialized = true;
      }
      if (message.method === 'notifications/initialized') notified = true;
      if (hasId) await emit(result);
    } catch (error) {
      if (hasId) await emit({jsonrpc:'2.0',id,error:{code:-32001,message:error instanceof RemoteError ? error.message : 'The MCP connection failed. No retry was sent; a save may need recovery with its original request.'}});
      else throw new RemoteError('The MCP notification failed. It was not retried.');
    }
  }
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk); let offset = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 10) continue;
      const segment = bytes.subarray(offset,index);
      if (pending.length + segment.length > maxLineBytes) throw new RemoteError('The MCP message is too large. Send a smaller message.');
      const line = pending.length ? Buffer.concat([pending,segment]) : segment;
      pending = Buffer.alloc(0); offset = index + 1;
      await processLine(line);
    }
    pending = Buffer.concat([pending,bytes.subarray(offset)]);
    if (pending.length > maxLineBytes) throw new RemoteError('The MCP message is too large. Send a smaller message.');
  }
  if (pending.length) throw new RemoteError('The last MCP message is incomplete. End each message with a newline.');
}
export async function startMcpBridge(args, { env = process.env, input = process.stdin, output = process.stdout, fetchImpl } = {}) {
  if(args.includes('--local-elfa-operator')){
    const{selectLocalElfa,createLocalElfaClient}=await import('./local-elfa.mjs');selectLocalElfa(args,env);
    const client=createLocalElfaClient({operatorFile:env.ANGBAO_LOCAL_ELFA_OPERATOR_FILE,fetchImpl});
    try{await runMcpBridge({client,input,output,elfaOperator:true});}finally{client.close();}return;
  }
  if(args.includes('--protected-local-client')){
    const{protectedSelection,createProtectedLocalClient}=await import('./protected-local.mjs');
    const remaining=protectedSelection(args,env);if(remaining.length)throw new RemoteError('Use mcp --protected-local-client with ANGBAO_LOCAL_CLIENT_FILE.');
    const client=await createProtectedLocalClient({file:env.ANGBAO_LOCAL_CLIENT_FILE,origin:env.ANGBAO_API_URL,fetchImpl});
    await runMcpBridge({client,input,output,protectedLocal:true});return;
  }
  const {remaining,origin,hosted} = parseRemoteOptions(args);
  if (remaining.length) throw new RemoteError('Use angbao mcp [--hosted | --origin HTTPS_ORIGIN]. Local use needs no token.');
  const client = hosted ? createRemoteClient({ origin:origin ?? env.ANGBAO_REMOTE_ORIGIN,token:env.ANGBAO_AGENT_TOKEN,fetchImpl }) : (await import('./local.mjs')).createLocalClient({origin:env.ANGBAO_API_URL,fetchImpl});
  await runMcpBridge({client,input,output,local:!hosted});
}
