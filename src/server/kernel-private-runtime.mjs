/** Explicit private composition. Never discovers registry pins, providers, grants or global configuration. */
import path from 'node:path';
import {ownedDirectory} from '../../cli/setup-state.mjs';
import {createKernelCreationSourceRegistry} from '../integrations/kernel-creation-source-registry.mjs';
import {createKernelCreationPreflightExecutor} from './kernel-creation-preflight.mjs';
import {createKernelCreationPreflightBudget} from './kernel-creation-budget.mjs';
import {createKernelRuntimeEvidenceStore} from './kernel-runtime-evidence.mjs';
import {createKernelRuntimeBudget} from './kernel-runtime-budget.mjs';
import {createKernelRuntimeAdapter} from './kernel-runtime-adapter.mjs';

const unavailable=()=>Object.freeze({kernelRouteEvidenceDigest:null,kernelBridgeFactory:null,kernelReaderFactory:null,authorizeKernelReadPlan:async()=>false});
/** Return only createDemoServer's optional Kernel bindings. No HTTP/import value may configure this factory. */
export async function createPrivateKernelRuntime({directory=null,registry=null,reviewedRegistryDigests=[],chainRpcUrl=null,bundlerRpcUrl=null,authorizePreflightPlan=async()=>false,resolvePrivateConfiguration=null,sdk=null,primitives=null,fetchImpl=null,now=()=>new Date()}={}){
 const source=createKernelCreationSourceRegistry({registry,reviewedRegistryDigests});
 if(source.routeEvidenceDigest===null)return unavailable();
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory||typeof authorizePreflightPlan!=='function'||resolvePrivateConfiguration!==null&&typeof resolvePrivateConfiguration!=='function'||typeof now!=='function'||fetchImpl!==null&&typeof fetchImpl!=='function')throw Error('The private account setup configuration is incomplete.');
 const root=await ownedDirectory(directory);if(root.mode&0o077)throw Error('The private account setup directory must be private.');
 const paths=Object.fromEntries(['preflight-budget','proof','runtime-budget'].map(key=>[key,path.join(directory,key)]));
 for(const child of Object.values(paths)){const info=await ownedDirectory(child,{create:true});if(info.mode&0o077)throw Error('The private account setup directory must be private.');}
 const preflight=createKernelCreationPreflightExecutor({resolveSourceArtifacts:source.resolveSourceArtifacts,chainRpcUrl,bundlerRpcUrl,authorizePlan:authorizePreflightPlan,reserveRequest:createKernelCreationPreflightBudget({directory:paths['preflight-budget']}).reserveRequest,fetchImpl:fetchImpl??globalThis.fetch,now});
 const evidence=createKernelRuntimeEvidenceStore({directory:paths.proof,creationExecutor:preflight,resolvePrivateConfiguration,now});
 const runtime=createKernelRuntimeAdapter({acceptedEvidence:evidence.acceptedEvidence,sdk,primitives,fetchImpl,now,reserveRequest:createKernelRuntimeBudget({directory:paths['runtime-budget']}).reserveRequest});
 async function selected(intent){if(await source.resolveSourceArtifacts(intent)===null)throw Error('This account setup does not match the reviewed private source registry.');}
 return Object.freeze({
  kernelRouteEvidenceDigest:source.routeEvidenceDigest,
  async kernelBridgeFactory(args){
   await selected(args.intent);
   if(await evidence.acceptedEvidence(args.intent,{purpose:'prepare'})===null){const observation=await preflight.verify(args.intent);await evidence.acceptPreflight(args.intent,observation);}
   return runtime.bridgeFactory(args);
  },
  async kernelReaderFactory(args){await selected(args.intent);return runtime.readerFactory(args);},
  async authorizeKernelReadPlan(plan,args){try{await selected(args.intent);return await runtime.authorizeReadPlan(plan,args);}catch{return false;}},
 });
}
