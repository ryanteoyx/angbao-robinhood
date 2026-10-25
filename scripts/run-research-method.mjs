#!/usr/bin/env node
/** Explicit file-in/stdout-out tool. It never saves a workspace, fetches or reads provider settings. */
import { readFile } from 'node:fs/promises';
import { prepareResearchMethodRun, repeatResearchMethodRun, validateResearchMethodOutput } from '../src/domain/research-method.mjs';

const usage = `Usage:
  node scripts/run-research-method.mjs prepare INPUT.json
  node scripts/run-research-method.mjs repeat PREVIOUS-RUN.json INPUT.json
  node scripts/run-research-method.mjs validate RUN.json AUTHORED-BRIEF.json

prepare input: {method:{id:"evidence-review",version:"1.0.0"},settings?,question,evidencePacks,asOf}
repeat input: {evidencePacks,asOf}; keeps the previous method, question and resolved settings.
validate: checks a separate agent-authored brief; it does not save or independently verify it.
All output goes to stdout. Inputs are explicit local files, at most 1 MiB each. No signup is required.`;
async function jsonFile(path) {
  const file = await readFile(path);
  if (file.byteLength > 1_048_576) throw new Error('This input file exceeds 1 MiB.');
  return JSON.parse(file.toString('utf8'));
}
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === 'help') { process.stdout.write(`${usage}\n`); }
  else {
    const expected = command === 'prepare' ? 1 : ['repeat', 'validate'].includes(command) ? 2 : 0;
    if (!expected || args.length !== expected || args.some(item => !item || item.startsWith('--'))) throw new Error(usage);
    const first = await jsonFile(args[0]); let result;
    if (command === 'prepare') result = await prepareResearchMethodRun(first);
    else if (command === 'repeat') result = await repeatResearchMethodRun(first, await jsonFile(args[1]));
    else result = await validateResearchMethodOutput(first, await jsonFile(args[1]), { expectedRunDigest: first.runDigest });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  // Never echo source text, provider payloads or file contents in failures.
  process.stderr.write(`${error.name === 'ResearchMethodError' || error.name === 'ResearchBriefError' ? error.message : error.message === usage ? usage : 'Research preparation failed. Check the command and the documented JSON files.'}\n`);
  process.exitCode = 1;
}
