#!/usr/bin/env node
/** Explicit operator launch only. No network reads, signer or transaction is started by launch. */
import {readFile,realpath,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownedDirectory,physical} from '../cli/setup-state.mjs';
import {portfolioExact} from '../src/domain/portfolio-work-record.mjs';
import {validateRobinhoodEoaReviewedAsset} from '../src/integrations/robinhood-eoa-token-context.mjs';
import {createRobinhoodEoaTransferRuntime,DIRECT_PURPOSE} from '../src/server/robinhood-eoa-transfer.mjs';
import {createDemoServer} from '../server/server.mjs';
export async function launchReviewedOwnerFundedRun({grantFile,reviewedGrantSha256,fetchImpl=globalThis.fetch,now=()=>new Date()}={}){
 if(typeof reviewedGrantSha256!=='string'||!/^[a-f0-9]{64}$/.test(reviewedGrantSha256)||typeof grantFile!=='string'||!path.isAbsolute(grantFile))throw Error('An independently reviewed private grant file and exact SHA256 are required.');
 const entry=await physical(grantFile);if(!entry.isFile()||entry.uid!==process.getuid()||entry.mode&0o077||entry.size>65536)throw Error('The operator grant must be a private owned file.');
 const bytes=await readFile(grantFile);if(createHash('sha256').update(bytes).digest('hex')!==reviewedGrantSha256)throw Error('The private grant differs from its independent review.');const grant=JSON.parse(bytes.toString('utf8'));
 if(grant.format==='angbao-reviewed-owner-funded-run@2')return launchCheckpointOwnerRun({grant,fetchImpl,now});
 portfolioExact(grant,['format','chainId','dataFile','journalDirectory','port','assets','intentDigests','expiresAt']);if(grant.format!=='angbao-reviewed-owner-funded-run@1'||grant.chainId!==46630||!Number.isInteger(grant.port)||grant.port<1024||grant.port>65535||!Array.isArray(grant.assets)||!grant.assets.length||grant.assets.length>5||!Array.isArray(grant.intentDigests)||grant.intentDigests.length<1||grant.intentDigests.length>20||grant.intentDigests.some(d=>typeof d!=='string'||!/^[a-f0-9]{64}$/.test(d)))throw Error('The bounded operator grant is invalid.');
 const start=now().getTime(),expiry=Date.parse(grant.expiresAt);if(!Number.isFinite(start)||!Number.isFinite(expiry)||expiry<=start||expiry-start>30*60000)throw Error('The read grant must expire within thirty minutes.');
 const data=await physical(grant.dataFile);if(!data.isFile()||data.uid!==process.getuid()||data.mode&0o077||data.size>2*1024*1024)throw Error('Use the existing confirmed private workspace file.');if(path.dirname(grant.dataFile)!==grant.journalDirectory)throw Error('Keep the test-transfer journal beside the confirmed workspace file.');const directory=await ownedDirectory(grant.journalDirectory);if(directory.mode&0o077)throw Error('The test-transfer journal directory must be private.');
 const assets=grant.assets.map(validateRobinhoodEoaReviewedAsset),allowed=new Set(grant.intentDigests),current=()=>now().getTime()<expiry;
 // This exact hash-bound operator grant must be reviewed independently of the file.
 // Neither HTTP, setup/history import, a shape-valid asset nor an environment search can install it.
 const runtime=createRobinhoodEoaTransferRuntime({directory:grant.journalDirectory,reviewedTokens:assets,resolveAcceptedAsset:async({assetDigest,phase})=>current()&&['preflight','receipt-identity'].includes(phase)?assets.find(a=>a.assetDigest===assetDigest)??null:null,authorizePlan:async plan=>current()&&plan.purpose===DIRECT_PURPOSE&&allowed.has(plan.intentDigest),fetchImpl,now});
 const server=await createDemoServer({dataFile:grant.dataFile,directTransferRuntime:runtime});return {server,runtime,port:grant.port,expiresAt:grant.expiresAt};
}
export async function launchCheckpointOwnerRun({grant,fetchImpl=globalThis.fetch,now=()=>new Date()}={}){
 const {validateCheckpointOwnerGrant,assertCheckpointOwnerFiles,createLocalCheckpointController,createCheckpointChainTransport}=await import('../src/server/local-checkpoint-controller.mjs');
 const {createLocalOwnerTransactionJournal}=await import('../src/server/local-owner-transaction-journal.mjs');
 const {checkpointOperationPurposeAdapters}=await import('../src/domain/decision-checkpoint-operation.mjs');
 const g=validateCheckpointOwnerGrant(grant,{now:now()});assertCheckpointOwnerFiles(g);
 const journal=createLocalOwnerTransactionJournal({directory:g.journalDirectory,purposeAdapters:checkpointOperationPurposeAdapters});let controller;
 try{
  // Read validates the original canonical journal without provision/migration/reset.
  await journal.list({purpose:g.operations[0].purpose});
  const server=await createDemoServer({dataFile:g.dataFile,checkpointOwnerFactory:readers=>controller=createLocalCheckpointController({grant:g,journal,...readers,requestChain:createCheckpointChainTransport(fetchImpl),now})});
  server.once('close',()=>journal.close());server.once('error',()=>{controller?.close();journal.close();});return {server,port:g.port,expiresAt:g.expiresAt};
 }catch(error){controller?.close();journal.close();throw error;}
}
export async function runCheckpointOwnerOperator({grant,mode,inputFile,outputFile,handle,now=()=>new Date()}={}){
 const {validateCheckpointOwnerGrant,checkpointOwnerOperator}=await import('../src/server/local-checkpoint-controller.mjs');
 const {createLocalOwnerTransactionJournal}=await import('../src/server/local-owner-transaction-journal.mjs');
 const {checkpointOperationPurposeAdapters}=await import('../src/domain/decision-checkpoint-operation.mjs');
 const {readPrivateJson}=await import('../src/server/local-elfa-private-files.mjs');
 const {allPortfolioWork}=await import('../src/domain/portfolio-work-record.mjs');
 const g=validateCheckpointOwnerGrant(grant,{now:now()}),state=readPrivateJson(g.dataFile,2097152),fingerprint=createHash('sha256').update(await realpath(g.dataFile)).digest('hex');
 if(state.localInstallation?.id!==g.workspace.installationId||fingerprint!==g.workspace.dataLocationFingerprint)throw Error('The selected workspace changed.');
 const journal=createLocalOwnerTransactionJournal({directory:g.journalDirectory,purposeAdapters:checkpointOperationPurposeAdapters});
 try{return await checkpointOwnerOperator({mode,grant:g,journal,readWorkspaceBinding:()=>g.workspace,readSelectedRecord:ref=>allPortfolioWork(state).find(r=>r.id===ref.recordId),inputFile,outputFile,handle});}finally{journal.close();}
}
if(process.argv[1]&&await realpath(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args[0]==='operator'){const [_,mode,grantFile,reviewedSha,inputFile,outputFile,handleText]=args;if(!['provision','backup','restore'].includes(mode)||args.length!==7)throw Error('Invalid operator command');const {readPrivateJson}=await import('../src/server/local-elfa-private-files.mjs');const bytes=await readFile(grantFile);if(createHash('sha256').update(bytes).digest('hex')!==reviewedSha)throw Error('Grant changed');const checkedGrant=readPrivateJson(grantFile);if(JSON.stringify(checkedGrant)!==JSON.stringify(JSON.parse(bytes.toString('utf8'))))throw Error('Grant changed during review');const result=await runCheckpointOwnerOperator({grant:checkedGrant,mode,inputFile:inputFile==='-'?undefined:inputFile,outputFile:outputFile==='-'?undefined:outputFile,handle:handleText==='-'?undefined:JSON.parse(handleText)});console.log(JSON.stringify(result));}else{if(args.length!==4||args[0]!=='--grant'||args[2]!=='--reviewed-sha256')throw Error('Usage: node scripts/run-owner-funded-testnet.mjs --grant /private/reviewed-run.json --reviewed-sha256 EXACT_SHA256');const run=await launchReviewedOwnerFundedRun({grantFile:args[1],reviewedGrantSha256:args[3]});run.server.listen(run.port,'127.0.0.1',()=>console.log(`Local test-transfer review: http://127.0.0.1:${run.port}\nRead grant expires ${run.expiresAt}. No transaction, wallet request or network read has started.`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>run.server.close(()=>process.exit(0)));run.server.on('error',()=>{console.error('The local test-transfer server could not start.');process.exitCode=1;});}}catch{console.error('The reviewed private testnet run could not be started. Check its exact file, hash, expiry and confirmed workspace.');process.exitCode=1;}
}
