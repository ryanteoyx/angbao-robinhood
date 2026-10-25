#!/usr/bin/env node
/** Installable local client. No provider credentials, signing, model runtime or payment. */
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ANGBAO_LOCAL_VERSION } from './version.mjs';

const HELP = `Angbao — reviews and research with your agent

  angbao elfa guide [--topic setup|connection|research-memory|portfolio]
  angbao elfa provision|preview|approve|fetch|status|revoke|evidence read --operator-file PRIVATE_FILE ...
  angbao start [--port PORT] [--protected-local --access-dir PRIVATE_DIRECTORY]
  angbao clients issue|list|revoke --owner-file PRIVATE_FILE ...
  angbao browser-pair --owner-file PRIVATE_FILE --out NEW_PRIVATE_FILE
  angbao memory-reference --owner-file PRIVATE_FILE --kind KIND --id ID --out FILE
  angbao setup init|adopt --config /absolute/setup.json [--json]
  angbao setup status|resume --project /absolute/project --version VERSION [--json]
  angbao review (--demo | --manual) [--managed] [--goal ID]
    [--strategy ID@VERSION] [--settings JSON]
  angbao status
  angbao export [--claim] [--out PATH]
  angbao agent help
  angbao mcp [--hosted | --origin HTTPS_ORIGIN]
  angbao skill install --dest /explicit/parent/angbao

Start with angbao start. Local reviews and research need no Angbao account.
Data is saved in ANGBAO_DATA_DIR or ~/.angbao. Keep that folder when restarting.
The local address defaults to http://127.0.0.1:4317 (ANGBAO_API_URL).
Use --port or ANGBAO_PORT to change the server port (127.0.0.1 only).
For a different port, set client ANGBAO_API_URL to the matching address.

Choose --demo for sample values or --manual for your saved values.
For your own values, save Context in the GUI or use angbao agent setup --file.
Use angbao agent repeat to review confirmed current inputs with a saved strategy.
Your inputs stay unverified. No bank, broker or live source is connected.
Use --strategy ID@VERSION to choose a version; without it, cash-buffer@1.0.0 runs.
Manual reviews are free. --managed uses the plan simulation and collects no payment.
Default review/research tools do not fetch providers or call models.
Optional elfa commands need explicit owner-local setup and exact one-shot approval.
No model calls, trades or wallet signing are added by that evidence profile.

--claim exports settings and saved records for a one-time account import.
Your local workspace stays available. Review and confirm the import after signing in.
Hosted access is optional: choose --hosted with ANGBAO_REMOTE_ORIGIN, or --origin.
Only hosted access uses ANGBAO_AGENT_TOKEN from your agent's secret environment.
From source, use node cli/angbao.mjs with the same commands.
`;

async function start(args) {
  let port = Number(process.env.ANGBAO_PORT ?? 4317);
  let protectedMode=false,accessDirectory;const seen=new Set();
  while(args.length){const flag=args.shift();if(seen.has(flag))throw new Error('Use each start option once.');seen.add(flag);if(flag==='--protected-local')protectedMode=true;else if(['--port','--access-dir'].includes(flag)){const value=args.shift();if(!value||value.startsWith('--'))throw new Error('Provide a value for each start option.');if(flag==='--port')port=Number(value);else accessDirectory=value;}else throw new Error('Use start [--port PORT] [--protected-local --access-dir PRIVATE_DIRECTORY].');}
  if(protectedMode!==Boolean(accessDirectory)||accessDirectory&&!path.isAbsolute(accessDirectory))throw new Error('Protected mode needs an explicit absolute private --access-dir outside the workspace folder.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const directory = path.resolve(process.env.ANGBAO_DATA_DIR || path.join(os.homedir(), '.angbao'));
  if(protectedMode){if(!process.env.ANGBAO_DATA_DIR)throw new Error('Choose an explicit private workspace copy with ANGBAO_DATA_DIR for protected acceptance.');const{prepareProtectedStart}=await import('./protected-local.mjs');await prepareProtectedStart({directory,port});}
  const { createDemoServer } = await import('../server/server.mjs');
  const server = await createDemoServer({ dataFile: path.join(directory, 'workspace.json'),...(protectedMode?{protectedLocal:{registryFile:path.join(accessDirectory,'clients.sqlite'),ownerCredentialFile:path.join(accessDirectory,'owner.json')}}:{}) });
  server.on('error', () => { console.error('Angbao: could not start the local server. Check that the port is free and the data folder is writable.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Angbao local workspace: http://127.0.0.1:${server.address().port}\nSaved on this computer. No Angbao sign-in required. Financial actions are off.${protectedMode?'\nProtected read-only viewer. Use browser-pair to connect this browser.':''}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (['--version', 'version'].includes(command)) { if(args.length)throw new Error('Version takes no options.');console.log(ANGBAO_LOCAL_VERSION);return; }
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(HELP); return; }
  if(command==='elfa'){const{runLocalElfaCommand}=await import('./local-elfa.mjs');await runLocalElfaCommand(args);return;}
  if(['clients','browser-pair','memory-reference'].includes(command)){const{runProtectedOwner}=await import('./protected-local.mjs');await runProtectedOwner(command,args);return;}
  if (command === 'setup') { const { runSetupCommand } = await import('./setup.mjs'); await runSetupCommand(args); return; }
  if (command === 'agent') { const { runAgentCommand } = await import('./remote.mjs'); await runAgentCommand(args); return; }
  if (command === 'mcp') { const { startMcpBridge } = await import('./mcp-bridge.mjs'); await startMcpBridge(args); return; }
  if (command === 'skill') { const { installSkillCommand } = await import('./install-skill.mjs'); await installSkillCommand(args); return; }
  if (command === 'start') { await start(args); return; }
  if (!['review', 'status', 'export'].includes(command)) throw new Error('Unknown command. Use angbao help.');
  let managed = false, demo = false, manual = false, claim = false, goalId, out, strategyPin, settings;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--demo') demo = true;
    else if (flag === '--manual') manual = true;
    else if (flag === '--managed') managed = true;
    else if (flag === '--claim') claim = true;
    else if (['--goal', '--out', '--strategy', '--settings'].includes(flag)) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
      if (flag === '--goal') goalId = value;
      else if (flag === '--out') out = value;
      else if (flag === '--strategy') strategyPin = value;
      else {
        try { settings = JSON.parse(value); } catch { throw new Error('--settings requires a JSON object.'); }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('--settings requires a JSON object.');
      }
    } else throw new Error('Unknown option. Use angbao help.');
  }
  if (command === 'review' && demo === manual) throw new Error('Choose exactly one of review --demo or review --manual.');
  if (command !== 'review' && (managed || goalId || demo || manual || strategyPin !== undefined || settings !== undefined)) throw new Error('Review options are only valid with review.');
  if (command !== 'export' && out) throw new Error('--out is only valid with export.');
  if (command !== 'export' && claim) throw new Error('--claim is only valid with export.');
  if (settings !== undefined && strategyPin === undefined) throw new Error('--settings requires --strategy ID@VERSION.');
  let strategy;
  if (strategyPin !== undefined) {
    const match = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/.exec(strategyPin);
    if (!match) throw new Error('--strategy requires an exact ID@VERSION such as weekly-goals@1.2.0.');
    strategy = { id: match[1], version: match[2], ...(settings === undefined ? {} : { settings }) };
  }
  const { localOrigin } = await import('./local.mjs');
  const base = new URL(localOrigin(process.env.ANGBAO_API_URL));
  if (command === 'review') {
    const currentResponse = await fetch(new URL('/api/state', base), { signal: AbortSignal.timeout(10_000) });
    const current = await currentResponse.json();
    if (!currentResponse.ok) throw new Error('Could not load your saved inputs. Check the workspace connection and try again.');
    if ((current.inputMode ?? 'sample') !== (manual ? 'manual' : 'sample')) throw new Error('The selected input mode does not match your saved context. Use --demo for sample values or --manual for your own values.');
  }
  const endpoint = new URL(command === 'review' ? '/api/review' : command === 'status' ? '/api/state' : claim ? '/api/local/manifest' : '/api/export', base);
  const response = await fetch(endpoint, command === 'review' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ managed, goalId, strategy, demo, inputMode: manual ? 'manual' : 'sample', source: 'cli' }), signal: AbortSignal.timeout(10_000) } : { signal: AbortSignal.timeout(10_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `API request failed (${response.status}).`);
  if (command === 'status') console.log(JSON.stringify({ workspace: data.workspace, inputMode: data.inputMode ?? 'sample', demo: data.demo, goals: data.goals, plan: data.entitlements, schedule: data.schedule, financialPermissions: data.financialPermissions, savedReviews: data.reviewRuns.length }, null, 2));
  else if (command === 'export' && out) {
    await writeFile(out, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    console.log('Export saved. No existing file was overwritten.');
  } else console.log(JSON.stringify(command === 'review' ? data.review : data, null, 2));
}

main().catch(error => { console.error(`Angbao: ${error.cause?.code === 'ECONNREFUSED' ? 'The local workspace is not running. Start it with angbao start.' : error.code === 'EEXIST' ? 'That export file already exists. Choose a new file name.' : error.message}`); process.exitCode = 1; });
