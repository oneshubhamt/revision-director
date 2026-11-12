import {createInstance} from "@open-spaced-repetition/binding-wasm32-wasip1/workerd";
import {OptimizerGateRejectedError,convertFsrsEvidence,optimizeFsrsProfile,optimizerMetrics} from "./optimizer-core.mjs";
import {OPTIMIZER_CHRONOLOGY} from "./optimizer-policy.mjs";

const send=message=>self.postMessage(message);
const hex=buffer=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,"0")).join("");

async function createBindingRuntime(){
 const wasmUrl=new URL("./fsrs-binding.wasm32-wasip1.wasm",import.meta.url);
 const response=await fetch(wasmUrl);
 if(!response.ok)throw Error("Could not load local FSRS optimizer WASM: "+response.status);
 const module=await WebAssembly.compile(await response.arrayBuffer());
 const instance=await createInstance(module);
 return {binding:instance.exports,dispose:()=>instance.dispose()};
}

const progress=(requestId,stage)=>{
 let lastAt=0,lastCurrent=-1;
 return (current,total)=>{
  const now=Date.now();
  if(current===total||current===0||now-lastAt>=250||
    current-lastCurrent>=Math.max(1,Math.floor(total/20))){
   lastAt=now;lastCurrent=current;
   send({type:"progress",requestId,stage,current,total});
  }
  return true;
 };
};

async function probe(binding,request){
 const {requestId,csv}=request;
 if(typeof requestId!=="string"||!requestId)throw Error("Optimizer request ID is invalid");
 const converted=await convertFsrsEvidence({
  binding,
  csv,
  sourceSha256:async bytes=>hex(await crypto.subtle.digest("SHA-256",bytes))
 });
 const metrics=optimizerMetrics(
  new binding.FSRSBinding().evaluate(converted.items,converted.cardIds),
  "Browser optimizer probe"
 );
 send({
  type:"probe-result",requestId,
  items:converted.items.length,
  cards:new Set(converted.cardIds).size,
  metrics,
  chronology:OPTIMIZER_CHRONOLOGY
 });
}

async function optimize(binding,request){
 const {requestId,csv}=request;
 if(typeof requestId!=="string"||!requestId)throw Error("Optimizer request ID is invalid");
 if(typeof csv!=="string"||!csv.trim())throw Error("Optimizer evidence is empty");
 const result=await optimizeFsrsProfile({
  binding,
  csv,
  sourceSha256:async bytes=>hex(await crypto.subtle.digest("SHA-256",bytes)),
  optimizerOptions:(cardIds,stage)=>({
   modelVersion:"FSRS-7",enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,
   cardIds,progress:progress(requestId,stage)
  }),
  incumbentProfile
 });
 send({type:"result",requestId,profile:result.profile});
}

self.addEventListener("message",event=>{
 const request=event.data;
 if(!request||typeof request!=="object"||(request.type!=="optimize"&&request.type!=="probe"))return;
 void (async()=>{
  let runtime;
  try{
   runtime=await createBindingRuntime();
   if(runtime.binding.__napiBindingTarget!=="wasm32-wasip1")
    throw Error("Unexpected FSRS optimizer binding target");
   await (request.type==="optimize" ? optimize(runtime.binding,request) : probe(runtime.binding,request));
  }catch(error){
   if(error instanceof OptimizerGateRejectedError){
    send({type:"rejected",requestId:request.requestId,reasons:error.reasons});
   }else{
    send({type:"error",requestId:request.requestId,message:error instanceof Error?error.message:String(error)});
   }
  }finally{
   try{await runtime?.dispose();}catch(error){
    console.error("FSRS optimizer WASM disposal failed",error);
   }
  }
 })();
});
