'use strict';
const { createAppRuntime } = require('../helpers/runtime-harness');

class TestCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
const { api: T, context } = createAppRuntime({
  globalName: '__RD_E1_TEST__',
  expose: ["APP_VERSION","ExtensionRuntime","REVISION_DIRECTOR_CAPABILITIES","REVISION_DIRECTOR_PUBLIC_API_VERSION","REVISION_DIRECTOR_PUBLIC_DATA_CONTRACT"],
  context: { document: {}, CustomEvent: TestCustomEvent, dispatchEvent(){ return true; }, addEventListener(){}, removeEventListener(){} },
});
let checks=0;
function check(v,m){checks++;if(!v)throw new Error(m)}
async function mustReject(fn,m){checks++;try{await fn()}catch{return}throw new Error(m)}
const due=[{obligation:{type:'memory-recall',expectedMinutes:12}},{obligation:{type:'memory-recall',expectedMinutes:8}},{obligation:{type:'application-practice',expectedMinutes:20}}];
const profiles=[{id:'p1',name:'Exam',examDate:'2027-01-01',status:'active'}];
class FakeService{
 constructor(){this.study=[];this.units=[];this.planEnsures=0}
 async dueQueue(){return structuredClone(due)}
 async profiles(){return structuredClone(profiles)}
 getSettings(){return {activeProfileId:'p1'}}
 storageHealth(){return {checkedAt:new Date().toISOString(),level:'healthy',indexedDbAvailable:true,persistence:'granted',diagnosticCount:0}}
 async logStudyEvent(payload){this.study.push(payload);return {id:'study-1'}}
 async createUnit(payload){this.units.push(payload);return {id:'unit-1'}}
 async ensureDailyPlan(){this.planEnsures+=1;return {}}
}
class FakeOwnership{constructor(){this.mutable=true}canMutate(){return this.mutable}snapshot(){return {state:this.mutable?'primary':'secondary',tabId:'tab',canMutate:this.mutable,revision:1}}}
(async()=>{
 check(T.REVISION_DIRECTOR_PUBLIC_API_VERSION===1,'Public API version wrong');
 check(Object.isFrozen(T.REVISION_DIRECTOR_CAPABILITIES),'Capabilities are not frozen');
 const service=new FakeService(),ownership=new FakeOwnership();
 const runtime=new T.ExtensionRuntime(service,ownership);
 const api=runtime.installPublicApi();
 check(context.RevisionDirector===api,'Public API not installed');
 check(context.RevisionDirectorBridge===undefined,'Legacy bridge still exposed');
 check(Object.isFrozen(api)&&Object.isFrozen(api.records)&&Object.isFrozen(api.intake)&&Object.isFrozen(api.plugins),'Public API is not deeply frozen at exposed boundaries');
 const descriptor=Object.getOwnPropertyDescriptor(context,'RevisionDirector');
 check(descriptor&&descriptor.writable===false&&descriptor.configurable===false&&descriptor.enumerable===false,'Public API property is mutable');
 check(Object.keys(api).sort().join(',')==='apiVersion,capabilities,data,intake,plugins,records,registerPlugin,runtime,version','Unexpected public API surface');
 check(!('repository' in api)&&!('backup' in api)&&!('scheduler' in api)&&!('evidence' in api)&&!('ui' in api),'Sensitive internals are public');
 const summary=await api.records.getDueSummary();
 check(summary.dueCount===3&&summary.estimatedMinutes===40&&summary.byType['memory-recall']===2,'Due summary wrong');
 check(Object.isFrozen(summary)&&Object.isFrozen(summary.byType),'Due summary is mutable');
 const publicProfiles=await api.records.listProfiles();
 check(publicProfiles.length===1&&publicProfiles[0].id==='p1'&&Object.isFrozen(publicProfiles)&&Object.isFrozen(publicProfiles[0]),'Profile summary wrong or mutable');
 const study=await api.intake.importStudyEvent({area:'Geology',task:'Drainage',measure:'1 topic',durationMinutes:30});
 check(study.id==='study-1'&&service.study.length===1&&service.study[0].origin==='study-director','Study intake failed');
 await mustReject(()=>api.intake.importStudyEvent({area:'A',task:'B',measure:'C',durationMinutes:10,activityMode:'invalid'}),'Invalid public activity mode was accepted');
 const candidate=await api.intake.createRevisionCandidate({subject:'Geology',section:'Geomorphology',topic:'Drainage',title:'Drainage patterns',scope:'Major patterns',protocol:'Recall and draw',successCriteria:'Accurate structure'});
 check(candidate.unitId==='unit-1'&&service.units.length===1&&service.planEnsures===1,'Candidate intake failed or did not synchronize the persisted daily plan');
 await mustReject(()=>api.intake.createRevisionCandidate({subject:'S',section:'C',topic:'T',title:'U',scope:'Scope',protocol:'P',successCriteria:'Success',obligationType:'invalid'}),'Invalid public obligation type was accepted');
 ownership.mutable=false;
 let denied='';try{await api.intake.importStudyEvent({area:'A',task:'B',measure:'C',durationMinutes:1})}catch(e){denied=String(e.message||e)}
 check(denied.toLowerCase().includes('read-only'),'Mutation bypassed ownership');
 ownership.mutable=true;
 let received;
 check(await api.registerPlugin({name:'Good Plugin',version:'1.0',requires:{pluginApi:1,dueSummary:1},setup(publicApi){received=publicApi;return true}}),'Compatible plugin did not register');
 check(received===api,'Plugin setup received another API object');
 check(await api.registerPlugin({name:'Good Plugin',version:'1.0',setup(){throw new Error('duplicate should not rerun')}}),'Duplicate registered plugin was not idempotent');
 check(!(await api.registerPlugin({name:'Future Plugin',requires:{pluginApi:2},setup(){return true}})),'Incompatible plugin registered');
 check(!(await api.registerPlugin({name:'Inactive Plugin',setup(){return false}})),'Inactive plugin reported active');
 check(!(await api.registerPlugin({name:'Failed Plugin',setup(){throw new Error('isolated failure')}})),'Throwing plugin reported active');
 check(!(await api.registerPlugin({name:'Retry Plugin',setup(){throw new Error('retry')}})),'First retry failure wrong');
 check(!(await api.registerPlugin({name:'Retry Plugin',setup(){throw new Error('retry')}})),'Second retry failure wrong');
 check(!(await api.registerPlugin({name:'Retry Plugin',setup(){return true}})),'Registration attempt cap was bypassed');
 check(!(await api.registerPlugin({name:'Bad',requires:{'bad-key':1},setup(){return true}})),'Invalid capability key accepted');
 check(!(await api.registerPlugin({name:'',setup(){return true}})),'Blank plugin name accepted');
 check(!(await api.registerPlugin({name:'Wrong Setup',setup:'not-a-function'})),'Non-function plugin setup was accepted');
 const status=api.plugins.status();
 check(Object.isFrozen(status)&&Object.isFrozen(status.registered)&&status.registered.some(x=>x.name==='Good Plugin'&&x.state==='registered'),'Plugin status missing');
 check(status.registered.some(x=>x.name==='Future Plugin'&&x.state==='incompatible'&&x.detail.includes('pluginApi>=2')),'Incompatibility status missing');
 check(status.registered.some(x=>x.name==='Failed Plugin'&&x.state==='failed'),'Failure status missing');
 check(status.registered.find(x=>x.name==='Retry Plugin').attempts===2,'Attempt cap status wrong');
 check(Object.isFrozen(api.data)&&Object.isFrozen(api.data.contract),'Data contract not frozen');
 check(api.data.contract.application==='revision-director' &&
   typeof T.APP_VERSION==='string' && T.APP_VERSION.length>0 &&
   api.version===T.APP_VERSION && api.data.contract.applicationVersion===api.version,
   'Public API and data contract application versions drifted');
 check(api.runtime.ownership().canMutate===true&&api.runtime.storageHealth().level==='healthy','Runtime summaries wrong');
 console.log(`PASS ${checks} public API public-capability and plugin-runtime checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
