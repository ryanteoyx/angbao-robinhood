/** Private, bounded setup metadata only. No financial state is read here. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, open, rename, unlink, rmdir, chmod } from 'node:fs/promises';
import path from 'node:path';

export const SETUP_FORMAT = 'angbao-setup@1';
export const MAX_STATE_BYTES = 32768;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const exists = async file => { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
export function absolute(value) {
  if (typeof value !== 'string' || value.length > 2048 || !path.isAbsolute(value) || path.resolve(value) !== value) throw new Error('Use an absolute physical path for setup.');
  return value;
}
export async function physical(file, { missing = false, directory = false } = {}) {
  absolute(file);
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await exists(current);
    if (!info) { if (missing) return null; throw new Error('A required setup path is missing.'); }
    if (info.isSymbolicLink() || current !== file && !info.isDirectory()) throw new Error('Setup paths cannot use symlinks.');
  }
  const info = await lstat(file);
  if (directory && !info.isDirectory() || await realpath(file) !== file) throw new Error('Use the physical setup directory.');
  return info;
}
export async function ownedDirectory(directory, { create = false } = {}) {
  if (create) { await physical(path.dirname(directory), { directory: true }); try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const info = await physical(directory, { directory: true });
  if (typeof process.getuid !== 'function' || info.uid !== process.getuid()) throw new Error('Setup requires a directory owned by the current system user.');
  return info;
}
export function locations(project, version) {
  absolute(project);
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Choose an exact setup version.');
  const root = path.join(project, '.angbao-setup');
  return { root, directory: path.join(root, version), state: path.join(root, version, 'state.json'), lock: path.join(project, '.angbao-setup.lock') };
}
export async function readSetup(project, version) {
  await ownedDirectory(project);
  const files = locations(project, version), info = await physical(files.state, { missing: true });
  if (!info) return null;
  if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > MAX_STATE_BYTES) throw new Error('The setup checkpoint is not a private valid file.');
  const state = JSON.parse(await readFile(files.state, 'utf8'));
  if (!/^[0-9a-f-]{36}$/.test(state.setupId||'') || !['init','adopt'].includes(state.mode) || !Number.isInteger(state.installAttempts||0) || (state.installAttempts||0)>3 || state.format !== SETUP_FORMAT || state.config?.project !== project || state.config?.program?.version !== version || state.configDigest !== digest(JSON.stringify(state.config)) || !Array.isArray(state.events) || state.events.length > 16) throw new Error('The setup checkpoint identity is invalid. Keep the original files for recovery.');
  return state;
}
export async function writeSetup(state) {
  const files = locations(state.config.project, state.config.program.version);
  await ownedDirectory(files.root, { create: true }); await ownedDirectory(files.directory, { create: true });
  const old = await physical(files.state, { missing: true });
  if (old && (!old.isFile() || old.uid !== process.getuid() || old.mode & 0o077)) throw new Error('The setup checkpoint cannot be replaced safely.');
  state.updatedAt = new Date().toISOString();
  const bytes = JSON.stringify(state, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) throw new Error('Setup metadata exceeds its bounded size.');
  const temporary = path.join(files.directory, `.state-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, files.state); } finally { await unlink(temporary).catch(() => {}); }
}
export async function withSetupLock(project, operation) {
  await ownedDirectory(project);await chmod(project,0o700);
  const file = path.join(project, '.angbao-setup.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Only one recovery owner may inspect/remove a dead lock. Re-read *inside*
    // that guard; a pre-guard snapshot could otherwise unlink a new live lock.
    const guard=path.join(project,'.angbao-setup.lock-recovery');
    try { await mkdir(guard,{mode:0o700}); } catch { throw new Error('Setup lock recovery is already running or needs explicit recovery.'); }
    try {
      const info = await physical(file,{missing:true});
      if(info){
        if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 512) throw new Error('The setup lock cannot be verified.');
        let lock; try { lock = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('Setup is already running or its lock needs explicit recovery.'); }
        if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error('The setup lock needs explicit recovery.');
        try { process.kill(lock.pid, 0); throw new Error('Setup is already running for this project. Use status to inspect it.'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
        await unlink(file);
      }
      try {handle=await open(file,'wx',0o600);}catch(acquire){if(acquire.code==='EEXIST')throw new Error('Setup is already running for this project.');throw acquire;}
    } finally { await rmdir(guard).catch(()=>{}); }
  }
  if (!handle) throw new Error('Setup is already running for this project.');
  const marker = randomUUID();
  await handle.writeFile(JSON.stringify({ pid: process.pid, marker })); await handle.close();
  try { return await operation(); }
  finally { const current = await readFile(file, 'utf8').catch(() => ''); if (current.includes(marker)) await unlink(file).catch(() => {}); }
}
