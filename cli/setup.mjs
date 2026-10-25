/** Explicit, resumable local installation. No signup, financial analysis, downloads or process termination. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile, rename } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SKILL_FILES } from './install-skill.mjs';
import { absolute, digest, exists, locations, ownedDirectory, physical, readSetup, SETUP_FORMAT, withSetupLock, writeSetup } from './setup-state.mjs';

const execute = promisify(execFile), SHA = /^[a-f0-9]{64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wait = (code, message) => ({ code, message });
const cleanEnv = () => Object.fromEntries(['PATH','TMPDIR','TMP','TEMP','LANG','LC_ALL','SystemRoot','WINDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('The setup configuration includes unsupported fields.'); }
function origin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Choose an exact loopback HTTP origin.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== value || !url.port || url.port === '0') throw new Error('Choose an exact http://127.0.0.1 origin and nonzero port for this local server.');
  return value;
}
export function setupConfig(input, mode) {
  exact(input, ['project','program','connection','hostReady']); exact(input.program, ['prefix','version','archive','sha256','nodePath','nodeSha256','npmPath','skillPath']); exact(input.connection, ['origin','installationId']);
  const project = absolute(input.project), p = input.program, version = p.version;
  locations(project, version);
  const prefix = absolute(p.prefix), nodePath = absolute(p.nodePath);
  if (!prefix.startsWith(project + path.sep) || prefix === path.join(project, 'data')) throw new Error('Use a separate program prefix inside the confirmed project.');
  if (mode === 'init' && prefix !== path.join(project, 'programs', version)) throw new Error('New setup uses project/programs/VERSION, leaving older programs unchanged.');
  if (!SHA.test(p.nodeSha256 || '')) throw new Error('Supply the trusted SHA-256 of the selected Node executable.');
  if (mode === 'init' && (!p.archive || !SHA.test(p.sha256 || ''))) throw new Error('Supply the private archive path and operator-provided SHA-256.');
  if (p.sha256 !== undefined && !SHA.test(p.sha256)) throw new Error('Supply a complete archive SHA-256.');
  if (input.connection.installationId !== undefined && !UUID.test(input.connection.installationId) || mode === 'adopt' && !UUID.test(input.connection.installationId || '')) throw new Error('Adoption requires the known workspace installation ID.');
  const skillPath = absolute(p.skillPath || path.join(prefix, 'skills', 'angbao'));
  if (!skillPath.startsWith(project + path.sep) || path.basename(skillPath) !== 'angbao' || skillPath.startsWith(path.join(project, 'data') + path.sep)) throw new Error('Choose a separate project skill directory ending in /angbao.');
  if (input.hostReady !== undefined && typeof input.hostReady !== 'boolean') throw new Error('hostReady must be true or false.');
  return { project, program: { prefix, version, nodePath, nodeSha256: p.nodeSha256, skillPath, ...(p.archive ? { archive: absolute(p.archive) } : {}), ...(p.sha256 ? { sha256: p.sha256 } : {}), ...(p.npmPath ? { npmPath: absolute(p.npmPath) } : {}) }, connection: { origin: origin(input.connection.origin), ...(input.connection.installationId ? { installationId: input.connection.installationId } : {}) } };
}
async function fileHash(file) { const info = await physical(file); if (!info.isFile() || info.size > 256 * 1024 * 1024) throw new Error('A setup artifact is not a bounded regular file.'); const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex'); }
async function capabilities(base) {
  let response;
  try { response = await fetch(base + '/api/local/capabilities', { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(1500) }); }
  catch (error) { if (['ECONNREFUSED','EHOSTUNREACH'].includes(error.cause?.code)) return null; throw new Error('The local connection could not be verified. No server was replaced.'); }
  if (!response.ok || !/^application\/json/.test(response.headers.get('content-type') || '')) throw new Error('This port is occupied by an unverified service.');
  const reader = response.body.getReader(); let text = '', size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16384) throw new Error('The capability reply is too large.'); text += new TextDecoder().decode(value); } } finally { await reader.cancel().catch(() => {}); }
  const value = JSON.parse(text);
  if (value.installation?.schema !== 'angbao-local-installation@1' || !UUID.test(value.installation?.id || '') || value.accountRequired !== false || value.authenticated !== false || value.capabilities?.financialAuthority !== false || value.capabilities?.cashReview !== true || value.capabilities?.researchMemory !== true) throw new Error('This connection is not the expected accountless workspace.');
  return { installationId: value.installation.id, programVersion: value.programVersion || null, setupLaunchId: UUID.test(value.setupLaunchId||'')?value.setupLaunchId:null, dataLocationFingerprint: SHA.test(value.dataLocationFingerprint||'')?value.dataLocationFingerprint:null };
}
function expectedDataFingerprint(config) { return digest(path.join(config.project, 'data', 'workspace.json')); }
async function verifyDataLocation(config, observed, { legacy = false } = {}) {
  const file = path.join(config.project, 'data', 'workspace.json');
  const info = await physical(file, { missing: true });
  if (!info || !info.isFile() || info.uid !== process.getuid() || info.mode & 0o077) throw new Error('The chosen workspace data file is missing or is not private.');
  if (observed.dataLocationFingerprint) {
    if (observed.dataLocationFingerprint !== digest(await realpath(file))) throw new Error('The running connection uses a different data location. Existing files were left unchanged.');
    return;
  }
  if (!legacy) throw new Error('The running program has not verified the chosen data location.');
  // Legacy migration only: inspect the chosen file's installation identity. No
  // financial fields are returned, logged, analyzed or copied to the checkpoint.
  if (info.size > 8 * 1024 * 1024) throw new Error('The existing workspace is too large for bounded identity verification.');
  const installation = JSON.parse(await readFile(file, 'utf8')).localInstallation;
  if (installation?.schema !== 'angbao-local-installation@1' || installation.id !== config.connection.installationId || installation.id !== observed.installationId) throw new Error('The chosen data file and running workspace do not have the same installation identity.');
}
async function runtime(config) {
  const p = config.program;
  if (!await physical(p.nodePath, { missing: true })) return { waiting: wait('runtime_missing', 'The selected Node runtime is missing. Supply the verified runtime at its recorded path, then resume.') };
  if (await fileHash(p.nodePath) !== p.nodeSha256) return { waiting: wait('verification_failed', 'The selected runtime checksum changed. Keep the existing installation and check the supplied runtime.') };
  let output; try { output = await execute(p.nodePath, ['--version'], { env: cleanEnv(), timeout: 3000, maxBuffer: 256 }); } catch { return { waiting: wait('runtime_missing', 'The selected runtime could not execute. A verified Node.js 22.13 or newer runtime is needed.') }; }
  const version = /^v(\d+)\.(\d+)\.(\d+)\s*$/.exec(output.stdout);
  if (!version || Number(version[1]) < 22 || Number(version[1]) === 22 && Number(version[2]) < 13) return { waiting: wait('runtime_missing', 'Node.js 22.13 or newer is required. Use a verified private runtime; no global settings were changed.') };
  return { version: version[0].trim(), sha256: p.nodeSha256 };
}
async function program(config) {
  const prefix = config.program.prefix, binary = path.join(prefix, 'bin', 'angbao');
  if (!await exists(binary)) return null;
  await physical(prefix, { directory: true });
  const entry = await realpath(binary), root = path.join(prefix, 'lib', 'node_modules', 'angbao-personal-local');
  await physical(root, { directory: true });
  if (entry !== path.join(root, 'cli', 'angbao.mjs')) throw new Error('The selected binary does not belong to the selected Angbao program.');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'angbao-personal-local' || metadata.version !== config.program.version || metadata.private !== true || !Array.isArray(metadata.files) || metadata.files.length > 256 || Object.keys(metadata.dependencies || {}).length) throw new Error('The installed program does not match the chosen version.');
  const files = [...new Set(['package.json', ...metadata.files])].sort(), hashes = [];
  for (const file of files) { if (typeof file !== 'string' || file.length > 300 || path.isAbsolute(file) || file.split('/').some(part => ['..','.',''].includes(part))) throw new Error('The installed file manifest is invalid.'); hashes.push([file, await fileHash(path.join(root, file))]); }
  return { root, entry, digest: digest(JSON.stringify(hashes)) };
}
async function skillMatches(config, installed) {
  const target = config.program.skillPath;
  if (!await exists(target)) return false;
  await ownedDirectory(target);
  for (const file of SKILL_FILES) if (!await physical(path.join(target, file), { missing: true }) || await fileHash(path.join(target, file)) !== await fileHash(path.join(installed.root, 'integrations', 'angbao', file))) return false;
  return true;
}
async function ensureSkill(state, installed) {
  if (await skillMatches(state.config, installed)) return;
  const target = state.config.program.skillPath, source = path.join(installed.root, 'integrations', 'angbao');
  // This prefix belongs to this init attempt. Existing partial copies may only
  // contain matching known skill files; unrelated content is preserved/refused.
  async function inspect(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) { const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || !SKILL_FILES.some(allowed => allowed === file || allowed.startsWith(file + '/'))) throw new Error('The skill directory contains unrelated files. Keep it for explicit recovery.');
      if (entry.isDirectory()) await inspect(path.join(directory, entry.name), file);
      else if (!SKILL_FILES.includes(file) || await fileHash(path.join(target, file)) !== await fileHash(path.join(source, file))) throw new Error('The partial skill copy changed. Keep it for explicit recovery.');
    }
  }
  if (await exists(target)) { await ownedDirectory(target); await inspect(target); }
  else { await mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await physical(path.dirname(target), { directory: true }); await mkdir(target, { mode: 0o700 }); }
  for (const file of SKILL_FILES) if (!await exists(path.join(target, file))) { const to = path.join(target, file); await mkdir(path.dirname(to), { recursive: true, mode: 0o700 }); await physical(path.dirname(to), { directory: true }); await copyFile(path.join(source, file), to, 1); await chmod(to, 0o600); }
}
async function checkpoint(state, stage, waiting = null) {
  state.stage = stage; state.waiting = waiting; state.events = [...state.events, { stage, at: new Date().toISOString() }].slice(-16); await writeSetup(state);
}
function humanWaiting(code){return {artifact_missing:'Waiting for the setup file. Your location is saved.',runtime_missing:'Your computer needs a compatible runtime. Your agent can prepare it, then continue.',host_unavailable:'This computer is unavailable. Open its platform controls, then continue.',verification_failed:'Setup could not be verified. Your existing setup has been kept.',manual_action_needed:'Setup paused safely. Ask your agent to check the saved step, then continue.'}[code]||'Checking your saved connection.';}
function report(state, observed, waiting = state.waiting) {
  const workspaceVerified = Boolean(observed && observed.installationId === state.installationId), programVersionVerified = Boolean(workspaceVerified && observed.programVersion === state.config.program.version);
  const dataLocationVerified = Boolean(workspaceVerified && observed.dataLocationFingerprint === expectedDataFingerprint(state.config));
  const ready = !waiting && state.stage === 'ready' && programVersionVerified && dataLocationVerified;
  return { format: 'angbao-setup-status@1', setupId: state.setupId, version: state.config.program.version, stage: state.stage, ready, workspaceVerified, programVersionVerified, dataLocationVerified, waiting, message: (waiting?humanWaiting(waiting.code):null) || (ready ? 'Angbao is ready here. No review was run by setup.' : 'Setup can resume from its saved checkpoint.'), dataLocation: path.join(state.config.project, 'data', 'workspace.json'), details: { config: state.config, runtime: state.runtime, programDigest: state.program?.digest || null, serverPid: state.server?.pid || null, sameUserAccess: 'Other processes using this system user may be able to read the private folder.' } };
}
async function installCandidate(state){
  const c=state.config,control=locations(c.project,c.program.version).directory;
  const staging=()=>path.join(control,`install-${state.setupId}-${state.installAttempts}`);
  let complete=null;
  if(state.installAttempts){
    try{complete=await program({...c,program:{...c.program,prefix:staging()}});}catch{ /* Preserve incomplete staging, then try a fresh owned directory. */ }
  }
  if(!complete){
    if((state.installAttempts||0)>=3){await checkpoint(state,state.stage,wait('manual_action_needed','Three interrupted install attempts were preserved. Inspect the private staging folders before explicit recovery.'));return null;}
    if(!await physical(c.program.archive,{missing:true})||await fileHash(c.program.archive)!==c.program.sha256){await checkpoint(state,state.stage,wait('verification_failed','The verified package is missing or changed before installation.'));return null;}
    const npmPath=c.program.npmPath||path.resolve(path.dirname(c.program.nodePath),'../lib/node_modules/npm/bin/npm-cli.js');
    if(!await physical(npmPath,{missing:true})){await checkpoint(state,state.stage,wait('runtime_missing','The supplied runtime needs its npm CLI for offline installation.'));return null;}
    if(await exists(c.program.prefix))throw new Error('The candidate prefix already exists. Preserve it and use explicit adoption or recovery.');
    state.installAttempts=(state.installAttempts||0)+1;await checkpoint(state,'artifact_verified');
    await mkdir(staging(),{mode:0o700});
    for(const file of ['npm-user.conf','npm-global.conf'])if(!await exists(path.join(control,file)))await writeFile(path.join(control,file),'',{flag:'wx',mode:0o600});
    try{await execute(c.program.nodePath,[npmPath,'install','--global','--prefix',staging(),c.program.archive,'--offline','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(control,'npm-cache'),'--userconfig',path.join(control,'npm-user.conf'),'--globalconfig',path.join(control,'npm-global.conf')],{env:cleanEnv(),timeout:30000,maxBuffer:65536});}
    catch{await checkpoint(state,state.stage,wait('manual_action_needed','Installation was interrupted or rejected. Its staging files were preserved; resume to reconcile or start a fresh bounded attempt.'));return null;}
    complete=await program({...c,program:{...c.program,prefix:staging()}});
    if(!complete)throw new Error('The installation did not produce a complete selected program.');
  }
  const parent=path.dirname(c.program.prefix);await ownedDirectory(parent,{create:true});
  if(await exists(c.program.prefix))throw new Error('The candidate prefix already exists. It was not overwritten.');
  state.promotionDigest=complete.digest;await checkpoint(state,'artifact_verified');
  await rename(staging(),c.program.prefix);
  return program(c);
}
function launchBound(state,installed){const s=state.server,c=state.config;return Boolean(s&&UUID.test(s.launchId||'')&&s.configDigest===state.configDigest&&s.programDigest===installed.digest&&s.entry===installed.entry&&s.nodePath===c.program.nodePath&&s.nodeSha256===c.program.nodeSha256&&s.dataDir===path.join(c.project,'data')&&s.origin===c.connection.origin);}
async function advance(state) {
  const c = state.config;
  if (!state.hostReady) { await checkpoint(state, state.stage, wait('host_unavailable', 'This computer is not ready. Wake it with its platform control, then resume; the CLI cannot wake it.')); return report(state, null); }
  await ownedDirectory(path.join(c.project,'data'),{create:true});await chmod(path.join(c.project,'data'),0o700);
  const node = await runtime(c);
  if (node.waiting) { await checkpoint(state, state.stage, node.waiting); return report(state, null); }
  state.runtime = node; await checkpoint(state, 'runtime_ready');
  if(state.mode==='init'&&!state.artifact){
    if(!await physical(c.program.archive,{missing:true})){await checkpoint(state,state.stage,wait('artifact_missing','Your folder choice is saved. Waiting for the private package at its recorded path.'));return report(state,null);}
    if(await fileHash(c.program.archive)!==c.program.sha256){await checkpoint(state,state.stage,wait('verification_failed','The private package checksum does not match. Do not install it.'));return report(state,null);}
    state.artifact={sha256:c.program.sha256};await checkpoint(state,'artifact_verified');
  }
  let installed = await program(c);
  if(state.mode==='init'&&installed&&!state.program&&state.promotionDigest!==installed.digest)throw new Error('The new version prefix already contains a program. Use explicit adoption; it will not be overwritten.');
  if (state.program && (!installed || installed.digest !== state.program.digest)) throw new Error('The recorded program changed. Keep the installation for explicit recovery.');
  if (state.mode === 'init' && !installed) {
    installed=await installCandidate(state);if(!installed)return report(state,null);
  }
  if (!installed) { await checkpoint(state, state.stage, wait('manual_action_needed', 'The selected installed program is unavailable. Preserve the existing connection and check its recorded prefix.')); return report(state, null); }
  state.program = installed;
  if (state.mode === 'init') await ensureSkill(state, installed);
  else if (!await skillMatches(c, installed)) { await checkpoint(state, state.stage, wait('manual_action_needed', 'The selected project skill copy could not be verified. Existing files were left unchanged.')); return report(state, null); }
  await checkpoint(state, 'installed');
  let observed = await capabilities(c.connection.origin);
  if(observed&&!state.installationId&&(!launchBound(state,installed)||observed.setupLaunchId!==state.server.launchId)){await checkpoint(state,'installed',wait('manual_action_needed','This port already serves an unbound workspace. Preserve it; choose its explicit verified adoption or a different confirmed connection.'));return report(state,observed);}
  if (observed && state.installationId && observed.installationId !== state.installationId) throw new Error('This port belongs to a different workspace. No process or data was replaced.');
  if (observed && observed.programVersion !== c.program.version) { await checkpoint(state, 'server_ready', wait('manual_action_needed', 'The saved workspace is reachable, but the running program version is different or unavailable. Keep it running until the operator explicitly switches its own server, then resume.')); return report(state, observed); }
  if (!observed) {
    if (state.mode === 'adopt') { await checkpoint(state, state.stage, wait('manual_action_needed', 'The known connection is not running. Adoption does not start or replace an existing program.')); return report(state, null); }
    if(state.server&&!state.server.pid){await checkpoint(state,state.stage,wait('manual_action_needed','A previous start has no confirmed process receipt. Resolve that start explicitly before another is attempted.'));return report(state,null);}
    if (state.server?.pid) { try { process.kill(state.server.pid, 0); await checkpoint(state, state.stage, wait('manual_action_needed', 'The previously started process is still present but its connection is unconfirmed. Check only that recorded process before resuming.')); return report(state, null); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    state.server={launchId:randomUUID(),pid:null,configDigest:state.configDigest,programDigest:installed.digest,entry:installed.entry,nodePath:c.program.nodePath,nodeSha256:c.program.nodeSha256,dataDir:path.join(c.project,'data'),origin:c.connection.origin};await checkpoint(state,'installed');
    const child = spawn(c.program.nodePath, [installed.entry, 'start', '--port', new URL(c.connection.origin).port], { env: { ...cleanEnv(), ANGBAO_DATA_DIR: path.join(c.project, 'data'), ANGBAO_API_URL: c.connection.origin,ANGBAO_SETUP_LAUNCH_ID:state.server.launchId }, detached: true, stdio: 'ignore' });
    let launchError = false; child.once('error', () => { launchError = true; }); child.unref(); state.server.pid=child.pid||null;await checkpoint(state,'installed');
    const readyDeadline=performance.now()+15000;
    while(performance.now()<readyDeadline&&!launchError){await new Promise(resolve=>setTimeout(resolve,100));observed=await capabilities(c.connection.origin);if(observed)break;}
    if (!observed) { await checkpoint(state, state.stage, wait('manual_action_needed', 'The server start is not confirmed. Check its recorded process and resume; do not start another server.')); return report(state, null); }
  }
  if(!state.installationId&&(!launchBound(state,installed)||observed.setupLaunchId!==state.server.launchId)){await checkpoint(state,'server_ready',wait('verification_failed','The server launch did not return this setup attempt’s continuity marker. Readiness is unconfirmed.'));return report(state,observed);}
  if (state.installationId && observed.installationId !== state.installationId) throw new Error('The workspace identity changed. Stop and recover the recorded connection; no data was reset.');
  if (observed.programVersion !== c.program.version) { await checkpoint(state, 'server_ready', wait('manual_action_needed', 'The workspace answered without the selected program version. Readiness is not confirmed.')); return report(state, observed); }
  try { await verifyDataLocation(c, observed); } catch (error) { await checkpoint(state, 'server_ready', wait('verification_failed', error.message)); return report(state, observed); }
  state.installationId ||= observed.installationId; await checkpoint(state, 'ready'); return report(state, observed);
}
export async function initializeSetup(input, { mode = 'init' } = {}) {
  if (!['init','adopt'].includes(mode)) throw new Error('Choose init or adopt.');
  const config = setupConfig(input, mode), project = config.project;
  const oldInfo = await physical(project, { missing: true, directory: true });
  if (!oldInfo) await ownedDirectory(project, { create: true }); else await ownedDirectory(project);
  // Nonempty adoption is explicit and proves the known local identity before any
  // checkpoint/lock/private-file change. No financial endpoint is requested.
  const dataDirectory=path.join(project,'data');if(await exists(dataDirectory))await ownedDirectory(dataDirectory);
  const dataFile=path.join(dataDirectory,'workspace.json');const dataInfo=await physical(dataFile,{missing:true});if(dataInfo&&(!dataInfo.isFile()||dataInfo.uid!==process.getuid()||dataInfo.mode&0o077))throw new Error('The existing data file must remain a private owned regular file.');
  if(mode==='adopt'&&!dataInfo)throw new Error('Adoption requires the existing private data file at the confirmed project location.');
  const existing = await readSetup(project, config.program.version);
  if (existing && (existing.configDigest !== digest(JSON.stringify(config)) || existing.mode !== mode)) throw new Error('This setup version already has a different immutable identity. Use its saved configuration.');
  if (!existing && (mode === 'adopt' || (await readdir(project)).length)) {
    if (!config.connection.installationId) throw new Error('A nonempty project requires the known installation ID and explicit verified adoption.');
    const observed = await capabilities(config.connection.origin);
    if (!observed || observed.installationId !== config.connection.installationId) throw new Error('The known workspace connection could not be verified. Existing files were left unchanged.');
    await verifyDataLocation(config, observed, { legacy: !observed.programVersion && !observed.dataLocationFingerprint });
    if (mode === 'adopt') { const node = await runtime(config), installed = await program(config); if (node.waiting || !installed) throw new Error('Adoption requires the verified existing runtime and selected installed program.'); }
  }
  await chmod(project,0o700);
  return withSetupLock(project, async () => {
    const current = await readSetup(project, config.program.version);
    if (current && (current.configDigest !== digest(JSON.stringify(config)) || current.mode !== mode)) throw new Error('This setup version already has a different immutable identity. Use its saved configuration.');
    await chmod(project,0o700);
    const state = current || { format: SETUP_FORMAT, setupId: randomUUID(), config, configDigest: digest(JSON.stringify(config)), mode, stage: 'choice_confirmed', hostReady: input.hostReady !== false, installationId: config.connection.installationId || null, runtime: null, program: null, server: null, events: [], createdAt: new Date().toISOString() };
    await checkpoint(state, state.stage); return advance(state);
  });
}
export async function resumeSetup(project, version, { hostReady } = {}) {
  if (!await readSetup(project, version)) throw new Error('No setup checkpoint exists for this project and version. Use explicit init or adopt.');
  return withSetupLock(project, async () => { const state = await readSetup(project, version); if (!state) throw new Error('No setup checkpoint exists for this project and version. Use explicit init or adopt.'); if (hostReady !== undefined) state.hostReady = hostReady; return advance(state); });
}
export async function setupStatus(project, version) {
  const state = await readSetup(project, version); if (!state) throw new Error('No setup checkpoint exists for this project and version.');
  const projectInfo=await ownedDirectory(project),dataInfo=await physical(path.join(project,'data'),{missing:true,directory:true});
  if(projectInfo.mode&0o077||dataInfo&&(dataInfo.uid!==process.getuid()||dataInfo.mode&0o077))return report(state,null,wait('verification_failed','The selected project/data folder permissions need private repair before readiness.'));
  if (!state.hostReady) return report(state,null,wait('host_unavailable','The selected computer is not ready. The CLI cannot wake it.'));
  const node = await runtime(state.config); if (node.waiting) return report(state, null, node.waiting);
  const installed = await program(state.config);
  if (state.program && (!installed || installed.digest !== state.program.digest)) return report(state, null, wait('verification_failed', 'The recorded program is missing or changed.'));
  if(!installed)return report(state,null,state.waiting||wait('manual_action_needed','The selected program is not installed yet. Resume its recorded setup.'));
  if(!await skillMatches(state.config,installed))return report(state,null,wait('verification_failed','The recorded project skill copy is missing or changed.'));
  const observed = await capabilities(state.config.connection.origin);
  if (!observed) return report(state, null, wait('manual_action_needed', 'The saved server connection is not currently reachable. Resume to reconcile it.'));
  if (state.installationId && observed.installationId !== state.installationId) return report(state, observed, wait('verification_failed', 'This connection belongs to a different workspace.'));
  if (observed.programVersion !== state.config.program.version) return report(state, observed, wait('manual_action_needed', 'The workspace is reachable, but its running program version is not the selected version.'));
  try { await verifyDataLocation(state.config, observed); } catch (error) { return report(state, observed, wait('verification_failed', error.message)); }
  return report(state, observed);
}
export async function runSetupCommand(args, { write = console.log } = {}) {
  if(!args.length||['help','--help','-h'].includes(args[0])){const help='Continue Angbao setup with your saved location and settings.\n\n  setup init|adopt --config /absolute/setup.json [--json]\n  setup status|resume --project /confirmed/project --version VERSION [--json]\n\nUse status to inspect progress and resume to continue the saved step. No signup is required.';write(help);return help;}
  const operation = args[0], options = {};
  for (let index = 1; index < args.length; index++) { const flag = args[index]; if (flag === '--json') { options.json = true; continue; } if (!['--config','--project','--version','--host-ready'].includes(flag) || options[flag] !== undefined || !args[index + 1]) throw new Error('Use setup init|adopt --config ABS, or status|resume --project ABS --version VERSION [--json].'); options[flag] = args[++index]; }
  let result;
  if (['init','adopt'].includes(operation)) { if (!options['--config'] || options['--project'] || options['--version'] || options['--host-ready']) throw new Error('init/adopt require an explicit configuration file.'); const file = absolute(options['--config']); const info = await physical(file); if (!info.isFile() || info.size > 8192) throw new Error('Use a bounded setup configuration file.'); result = await initializeSetup(JSON.parse(await readFile(file, 'utf8')), { mode: operation }); }
  else if (['resume','status'].includes(operation)) { if (options['--config'] || !options['--project'] || !options['--version'] || options['--host-ready'] && !['yes','no'].includes(options['--host-ready']) || operation === 'status' && options['--host-ready']) throw new Error('Use project and exact version; only resume can update host readiness.'); result = operation === 'status' ? await setupStatus(options['--project'], options['--version']) : await resumeSetup(options['--project'], options['--version'], { hostReady: options['--host-ready'] === undefined ? undefined : options['--host-ready'] === 'yes' }); }
  else throw new Error('Choose setup init, adopt, status or resume.');
  write(options.json ? JSON.stringify(result, null, 2) : result.message); return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){runSetupCommand(process.argv.slice(2)).catch(error=>{if(process.argv.includes('--json'))console.log(JSON.stringify({format:'angbao-setup-status@1',ready:false,error:{message:error.message}}));else console.error('Angbao setup could not continue. Ask your agent to check the saved step.');process.exitCode=1;});}
