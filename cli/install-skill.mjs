/** Explicit destination only. No harness discovery, global config edit or credential write. */
import { lstat, mkdir, realpath, copyFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const SKILL_FILES = Object.freeze(['SKILL.md','references/commands.md','references/connection.md','references/research-memory.md','references/portfolio-checks.md','assets/research-brief.example.json','assets/mcp-stdio.template.json','evals/evals.json']);
async function noSymlinkAncestors(directory) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,part); const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Skill destination must have existing directory ancestors without symlinks.');
  }
}
export async function installSkill(destination, { source = fileURLToPath(new URL('../integrations/angbao',import.meta.url)) } = {}) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination) || path.basename(destination) !== 'angbao') throw new Error('Choose a new skill folder with a full path ending in /angbao.');
  const target = path.resolve(destination), parent = path.dirname(target); await noSymlinkAncestors(parent);
  const root = await realpath(source);
  for (const relative of SKILL_FILES) {
    const from = path.join(source,relative);
    if (!(await lstat(from)).isFile() || !(await realpath(from)).startsWith(root + path.sep)) throw new Error('Packaged skill files must be regular files within the skill root.');
  }
  // mkdir is exclusive: an existing directory, file or symlink is never overwritten.
  await mkdir(target,{mode:0o700});
  try {
    for (const relative of SKILL_FILES) {
      if (await realpath(target) !== target) throw new Error('Skill destination changed during installation.');
      const to = path.join(target,relative); if (path.dirname(to) !== target) await mkdir(path.dirname(to),{recursive:true,mode:0o700});
      await copyFile(path.join(source,relative),to,constants.COPYFILE_EXCL);
    }
    return {installed:true,directory:target,files:[...SKILL_FILES],harnessConfigurationChanged:false,credentialsWritten:false,financialActions:0};
  } catch (error) { if (await realpath(target).catch(() => null) === target) await rm(target,{recursive:true,force:true}); throw error; }
}
export async function installSkillCommand(args) {
  if (args.length !== 3 || args[0] !== 'install' || args[1] !== '--dest') throw new Error('Use angbao skill install --dest /explicit/parent/angbao. Existing destinations are refused.');
  try { console.log(JSON.stringify(await installSkill(args[2]))); }
  catch { throw new Error('Could not install the skill. Check the archive and choose a new /angbao folder with an absolute path and existing non-symlink parents. Existing files are not overwritten.'); }
}
