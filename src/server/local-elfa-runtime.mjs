/** Owner-local one-shot composition. No HTTP, model, native financial save or replacement ledger. */
import fs from 'node:fs';
import path from 'node:path';
import {readPrivateJson,privateDirectory,privateJsonTransaction,privateDigest,createLocalElfaPrivateFiles} from './local-elfa-private-files.mjs';
import {localElfaPolicyDigest} from './local-elfa-operator.mjs';
import {createLocalElfaConsentStore} from './local-elfa-consent-store.mjs';
import {researchDigest} from '../domain/research-work-record.mjs';
import {createSqliteElfaReservationRepository} from './elfa-evidence-reservations.mjs';

export class LocalElfaRuntimeError extends Error{constructor(code='local_elfa_unavailable'){super('Local evidence access was not confirmed. Inspect the original operation and retained files before trying again. No retry or fallback was sent.');this.name='LocalElfaRuntimeError';this.code=code;}}
const fail=code=>{throw new LocalElfaRuntimeError(code);};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail('local_elfa_input');}
const fields=['dataFile','configurationFile','credentialFile','consentFile','ledgerDirectory','evidenceDirectory'];
export function localElfaJson(value){
  const text=JSON.stringify(value);
  if(typeof text!=='string'||Buffer.byteLength(text)>900*1024||/alc_[oc]_[a-f0-9-]{36}_|abp_[a-f0-9-]{36}_|\bBearer\s+\S+|-----BEGIN .*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_/i.test(text))fail('local_elfa_output_withheld');
  return text;
}
const deny=()=>fail('local_elfa_transport_denied');
const previewRepository=Object.freeze({reserve:deny,settle:deny});
const absent=file=>{try{fs.lstatSync(file);return false;}catch(error){if(error.code==='ENOENT')return true;fail('local_elfa_storage');}};
function newValue(file,value){return privateJsonTransaction(file,current=>{if(current!==null)fail('local_elfa_output_exists');return {value,result:undefined};},{createOnly:true});}
export function provisionLocalElfa({operatorFile,dataFile,privateDir}={}){
  // Only this explicit owner command creates private scaffolding. No key or enabled policy.
  if(!path.isAbsolute(privateDir??'')||path.resolve(privateDir)!==privateDir||!path.isAbsolute(operatorFile??'')||!path.isAbsolute(dataFile??''))fail('local_elfa_input');
  privateDirectory(path.dirname(privateDir));privateDirectory(path.dirname(operatorFile));
  const workspace=readPrivateJson(dataFile,16*1024*1024);if(typeof workspace.localInstallation?.id!=='string'||!/^[-a-f0-9]{36}$/i.test(workspace.localInstallation.id))fail('local_elfa_workspace');
  if(!absent(operatorFile)||!absent(privateDir)||privateDir===path.dirname(dataFile)||privateDir.startsWith(path.dirname(dataFile)+path.sep))fail('local_elfa_output_exists');
  fs.mkdirSync(privateDir,{mode:0o700});fs.mkdirSync(path.join(privateDir,'ledger'),{mode:0o700});fs.mkdirSync(path.join(privateDir,'evidence'),{mode:0o700});
  const descriptor={format:'angbao-local-elfa-operator-files@1',dataFile,configurationFile:path.join(privateDir,'configuration.json'),credentialFile:path.join(privateDir,'credential.json'),consentFile:path.join(privateDir,'consents.json'),ledgerDirectory:path.join(privateDir,'ledger'),evidenceDirectory:path.join(privateDir,'evidence')};
  newValue(descriptor.configurationFile,{format:'angbao-local-elfa-files@1',revision:0,grant:null,policy:null});newValue(operatorFile,descriptor);
  return {configured:true,enabled:false,credentialCreated:false,providerCalls:0,workspaceWritten:false,message:'Private setup saved. Source access is off. Review provider eligibility, rights, budget and receiving agent before provisioning an approved configuration and key.'};
}
export function createLocalElfaRuntime({operatorFile,fetchImpl=globalThis.fetch,now=()=>new Date(),checkpoint=()=>{}}={}){
  let descriptor;
  try{descriptor=readPrivateJson(operatorFile);exact(descriptor,['format',...fields]);if(descriptor.format!=='angbao-local-elfa-operator-files@1')fail();
    for(const key of fields){const value=descriptor[key];if(typeof value!=='string'||!path.isAbsolute(value)||path.resolve(value)!==value)fail();privateDirectory(key.endsWith('Directory')?value:path.dirname(value));}
    if(new Set(fields.map(k=>descriptor[k])).size!==fields.length||fields.filter(k=>k!=='dataFile').some(k=>descriptor[k]===path.dirname(descriptor.dataFile)||descriptor[k].startsWith(path.dirname(descriptor.dataFile)+path.sep)))fail();
  }catch{fail('local_elfa_private_setup');}
  const descriptorDigest=localElfaPolicyDigest(descriptor),guards=new WeakMap();let closed=false;
  const loader=createLocalElfaPrivateFiles(descriptor),workspace=loader.readWorkspaceBinding();
  const clock=()=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))fail('local_elfa_clock');return d.getTime();};
  function assertDescriptor(){if(closed||localElfaPolicyDigest(readPrivateJson(operatorFile))!==descriptorDigest||localElfaPolicyDigest(loader.readWorkspaceBinding())!==localElfaPolicyDigest(workspace))fail('local_elfa_changed');privateDirectory(descriptor.evidenceDirectory);}
  function fingerprint(){assertDescriptor();return localElfaPolicyDigest({descriptor,configuration:readPrivateJson(descriptor.configurationFile),credential:readPrivateJson(descriptor.credentialFile,8192)});}
  function context(repository=previewRepository,transport=deny){const pin=fingerprint(),binding=loader.createBinding({repository,fetchImpl:transport,now});return {binding,pin,check(){assertDescriptor();binding.assertCurrent();if(fingerprint()!==pin)fail('local_elfa_changed');}};}
  const previewFacade={async preview(args){const ctx=context();const result=await ctx.binding.preview(args);ctx.check();return {...result,operatorBinding:ctx.pin,localPersistence:{kind:'private-retained-delivery',directoryFingerprint:privateDigest(descriptor.evidenceDirectory),format:'angbao-local-elfa-delivery-artifact@1'}};}};
  const store=createLocalElfaConsentStore({file:descriptor.consentFile,binding:previewFacade,readWorkspaceBinding:loader.readWorkspaceBinding,now});
  function selection(args){exact(args,['operationId','expectedDigest']);if(!id(args.operationId)||!hash(args.expectedDigest))fail('local_elfa_input');return {...args};}
  function protectedResult(value,check=assertDescriptor){localElfaJson(value);guards.set(value,check);return value;}
  function artifactFile(args){return path.join(descriptor.evidenceDirectory,localElfaPolicyDigest(args)+'.json');}
  function artifact(args){assertDescriptor();const file=artifactFile(args);if(!absent(file+'.lock'))fail('local_elfa_artifact_uncertain');if(absent(file))return null;
    const saved=readPrivateJson(file,1048576);exact(saved,['format','operationId','previewDigest','workspace','delivery','digest']);const{digest,...body}=saved;
    if(saved.format!=='angbao-local-elfa-delivery-artifact@1'||saved.operationId!==args.operationId||saved.previewDigest!==args.expectedDigest||localElfaPolicyDigest(saved.workspace)!==localElfaPolicyDigest(workspace)||researchDigest(body)!==digest||saved.delivery?.format!=='angbao-elfa-evidence-delivery@1'||saved.delivery.delivery?.operationId!==args.operationId)fail('local_elfa_artifact_invalid');localElfaJson(saved);return saved;
  }
  function assertEvidenceDelivery(args){
    assertDescriptor();const row=store.readStatus(args),grant=loader.readOperatorGrant(),policy=loader.readPolicy();
    if(!row||row.status!=='approved'||!grant||grant.revoked!==false||grant.ownerId!==row.preview.recipient.ownerId||grant.operatorUid!==process.getuid()||grant.grantId!==row.preview.recipient.operatorGrantId||!Array.isArray(grant.scopes)||grant.scopes.length!==1||grant.scopes[0]!=='research:evidence:elfa-events'||grant.policyDigest!==row.preview.policyDigest||grant.policyDigest!==localElfaPolicyDigest(policy)||policy?.rights?.agentDeliveryApproved!==true||policy.rights.recipientUse!=='private-synthesis-no-redistribution')fail('local_elfa_evidence_access_ended');
    store.assertApproved(args);const current=clock();
    if([row.preview.expiresAt,grant.expiresAt,policy.rights.expiresAt].some(expiry=>!Number.isFinite(Date.parse(expiry))||current>=Date.parse(expiry)))fail('local_elfa_evidence_access_ended');
  }
  function inspect(args){
    assertDescriptor();let consent=null,consentUnreadable=false;
    try{consent=store.readStatus(args);}catch(error){if(error.code==='local_consent_reference_mismatch')throw error;consentUnreadable=true;}
    const ledgerFile=path.join(descriptor.ledgerDirectory,'elfa-evidence-reservations.sqlite'),ledgerPresent=!absent(ledgerFile);
    const disabled=loader.readPolicy()===null&&loader.readOperatorGrant()===null&&loader.readRevision()===0;
    const fresh=disabled&&!consent&&!consentUnreadable&&absent(descriptor.consentFile)&&!ledgerPresent&&absent(artifactFile(args))&&absent(artifactFile(args)+'.lock');
    let ledger={status:fresh?'not-started':'unknown',action:'inspect-original-consent-and-ledger'},evidence={status:fresh?'missing':'unknown'};
    if(ledgerPresent){let repo;try{
      // A retained consent supplies the original key/owner. Without it, inspect only
      // a verified current same-OS-user binding and label the disclosure unverifiable.
      const grant=consent?null:loader.readOperatorGrant();
      const keySlot=consent?.preview.keySlot??grant?.keySlot,ownerId=consent?.preview.recipient.ownerId??grant?.ownerId;
      if(!consent&&(!grant||grant.operatorUid!==process.getuid()||ownerId!==`local-os-user:${process.getuid()}`))fail('local_elfa_status_binding_unavailable');
      repo=createSqliteElfaReservationRepository({directory:descriptor.ledgerDirectory,readOnly:true});
      const held=repo.inspect({keySlot,ownerId,operationId:args.operationId});
      ledger=held?{...held,status:held.state==='reserved'?'in-flight-or-uncertain':held.state,disclosureBinding:consent?'retained-consent':'unverified-consent-unavailable'}:{status:consent?'not-reserved':'unknown',action:'recover-original-disclosure-before-any-new-operation'};
    }catch{ledger={status:'unavailable',action:'inspect-original-ledger-without-reset'};}finally{repo?.close();}}
    else if(consent)ledger={status:'not-started'};
    // Artifact existence/integrity is independent from consent availability. This
    // status contains metadata only; it never delivers an unapproved evidence body.
    try{const saved=artifact(args);if(saved)evidence={status:'available',digest:saved.digest};else if(consent)evidence={status:'missing'};}catch{evidence={status:'unavailable',action:'inspect-original-artifact-and-lock'};}
    const consentStatus=consent?{status:consent.status,expired:consent.expired}:fresh?null:{status:'unavailable',reason:consentUnreadable?'unreadable-disclosure':'missing-disclosure'};
    return {operationId:args.operationId,previewDigest:args.expectedDigest,consent:consentStatus,ledger,evidence,providerCalls:0,refetched:false,memoryWritten:false,financialAuthority:false};
  }

  return Object.freeze({
    close(){closed=true;},
    print(value){const check=guards.get(value);if(!check)fail('local_elfa_output_withheld');const text=localElfaJson(value);checkpoint('serialized');check();return text;},
    async preview(args){exact(args,['operationId','query']);if(!id(args.operationId))fail('local_elfa_input');const value=await store.recordPreview(args),row=value.preview;
      return protectedResult(value,()=>{assertDescriptor();if(fingerprint()!==row.operatorBinding||clock()>=Date.parse(row.expiresAt))fail('local_elfa_changed');});},
    async approve(args){args=selection(args);const result=await store.approve(args),row=store.readStatus(args);return protectedResult(result,()=>{assertDescriptor();if(fingerprint()!==row.preview.operatorBinding)fail('local_elfa_changed');const s=store.assertApproved(args);if(clock()>=Date.parse(s.expiresAt))fail('local_elfa_expired');});},
    revoke(args){args=selection(args);return protectedResult(store.revoke(args));},
    status(args){args=selection(args);return protectedResult(inspect(args));},
    readEvidence(args){args=selection(args);assertEvidenceDelivery(args);const saved=artifact(args);if(!saved)fail('local_elfa_artifact_missing');const value={...saved,historical:true,providerCalls:0};return protectedResult(value,()=>{if(artifact(args)?.digest!==saved.digest)fail('local_elfa_artifact_invalid');assertEvidenceDelivery(args);});},
    async fetchEvidence(args){args=selection(args);assertDescriptor();const approved=await store.readApproved(args),row=store.readStatus(args);
      // Existing holds are inspected, never used as a reason to reacquire/replay a provider body.
      const previous=inspect(args);if(previous.ledger.status!=='not-started'&&previous.ledger.status!=='not-reserved')return protectedResult(previous);
      if(previous.evidence.status!=='missing')fail('local_elfa_artifact_uncertain');
      let repo;try{
        repo=createSqliteElfaReservationRepository({directory:descriptor.ledgerDirectory});let ctx;
        const dispatch=store.guardDispatch(args,(...request)=>{ctx.check();const s=store.assertApproved(args);if(clock()>=Date.parse(s.expiresAt))fail('local_elfa_expired');checkpoint('before-dispatch');ctx.check();store.assertApproved(args);return fetchImpl(...request);});
        ctx=context(repo,dispatch);if(ctx.pin!==row.preview.operatorBinding)fail('local_elfa_changed');
        const check=()=>{ctx.check();const current=store.assertApproved(args);if(clock()>=Date.parse(current.expiresAt))fail('local_elfa_expired');};
        const delivery=await ctx.binding.fetchEvidence(approved);checkpoint('provider-returned');await store.readApproved(args);check();
        if(delivery.format!=='angbao-elfa-evidence-delivery@1')return protectedResult(delivery,check);
        localElfaJson(delivery);const body={format:'angbao-local-elfa-delivery-artifact@1',operationId:args.operationId,previewDigest:args.expectedDigest,workspace,delivery},digest=researchDigest(body);
        checkpoint('before-publish');check();newValue(artifactFile(args),{...body,digest});checkpoint('published');
        return protectedResult({...delivery,artifact:{operationId:args.operationId,previewDigest:args.expectedDigest,digest,persisted:true}},check);
      }finally{repo?.close();}
    },
  });
}
