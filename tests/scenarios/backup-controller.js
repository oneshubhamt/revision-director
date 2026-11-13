'use strict';
const { createAppRuntime } = require('../helpers/runtime-harness');

const { api } = createAppRuntime({
  globalName: '__RD_D2_TEST__',
  expose: ["APP_VERSION","RevisionService","BackupCodec","BackupController","BACKUP_ARCHIVE_VERSION","BACKUP_SCHEMA_VERSION","validateBackupPayload"],
});
let checks=0;
function check(v,m){checks++;if(!v)throw new Error(m)}
async function mustFail(fn,text){checks++;try{await fn()}catch(e){if(text&&!String(e.message).toLowerCase().includes(text.toLowerCase()))throw e;return}throw new Error('Expected failure: '+text)}
const settings={schemaVersion:1,key:'app',activeProfileId:'',fsrsScheduling:{policy:{kind:'fixed-retention',desiredRetention:.9}},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]}};
const empty=()=>({format:'revision-director-backup',schemaVersion:2,exportedAt:new Date().toISOString(),appVersion:'va7.1-pass-f1',profiles:[],nodes:[],units:[],studyEvents:[],obligations:[],evidenceEvents:[],chunks:[],dailyPlans:[],settings:structuredClone(settings),activeRetrieval:null});
class FakeService{
 constructor(){this.payload=empty();this.raw={profiles:[]};this.restores=0;this.failCreate=false;this.diags=[]}
 async currentActiveRetrieval(){return this.payload.activeRetrieval}
 async createBackupArchive(prefer=true){if(this.failCreate)throw new Error('current relational state invalid');return api.BackupCodec.create(api.validateBackupPayload(this.payload),prefer)}
 async decodeBackupArchive(bytes){return api.BackupCodec.decode(bytes,x=>api.validateBackupPayload(x))}
 validateBackup(x){return api.validateBackupPayload(x)}
 async exportBackup(){return structuredClone(this.payload)}
 async restoreBackupPayload(payload,treatment){this.restores++;this.payload=structuredClone(payload);if(treatment==='discard')this.payload.activeRetrieval=null}
 async rawStateForRescue(){return structuredClone(this.raw)}
 diagnostics(){return structuredClone(this.diags)}
}
(async()=>{
 check(api.APP_VERSION==='va7.1-pass-f1','D2 app version wrong');
 check(api.BACKUP_ARCHIVE_VERSION===2&&api.BACKUP_SCHEMA_VERSION===2,'D2 backup version wrong');
 const service=new FakeService();const controller=new api.BackupController(service);
 const created=await controller.createVerified(false);
 check(created.inspection.verified&&created.inspection.archiveChecksum.length>=16,'Verified creation failed');
 const candidate=await controller.inspect(created.bytes);
 check(service.restores===0,'Inspection mutated state');
 check(candidate.inspection.stateChecksum===created.inspection.stateChecksum,'Inspection metadata mismatch');
 const safety=await controller.createSafetyCopy(candidate.id);
 check(safety.kind==='verified-backup'&&safety.filename.endsWith('.rdbackup'),'Verified safety copy missing');
 await mustFail(()=>controller.restore(candidate.id,safety.proofId,'discard'),'confirm');
 controller.acknowledgeSafetyCopy(safety.proofId);
 service.payload.settings.dailyCapacityMinutes=61;
 await mustFail(()=>controller.restore(candidate.id,safety.proofId,'discard'),'changed');
 service.payload.settings.dailyCapacityMinutes=60;
 const safety2=await controller.createSafetyCopy(candidate.id);controller.acknowledgeSafetyCopy(safety2.proofId);
 const result=await controller.restore(candidate.id,safety2.proofId,'discard');
 check(result.restoredActiveRetrieval===null&&service.restores===1,'Verified restore failed');
 await mustFail(()=>controller.restore(candidate.id,safety2.proofId,'discard'),'inspected backup');
 const sourceService=new FakeService();
 const activePayload=empty();
 // Minimal active session with no targets is intentionally invalid; validator must reject it.
 activePayload.activeRetrieval={schemaVersion:1,id:'current',revision:1,status:'committing',queueTargetIds:[],activeIndex:0,activeTargetId:'',phase:'attempt',draft:{phase:'attempt',values:{},checked:{},diagramStrokes:[],attemptElapsedMs:0},timeRuntime:{currentPhase:'attempt',state:'running',sessionStartedAt:new Date().toISOString(),lastTickAt:new Date().toISOString(),activeByPhase:{attempt:0,compare:0,'relearn-repair':0,'relearn-verify':0},pauseHistory:[],phaseHistory:[],gapHistory:[],sourceVisible:false,backwardClockCount:0},elapsedMs:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),commitToken:'c'};
 sourceService.payload=activePayload;
 await mustFail(()=>new api.BackupController(sourceService).createVerified(false),'commit');
 const forensicService=new FakeService();const sourceArchive=await api.BackupCodec.create(api.validateBackupPayload(empty()),false);const forensicController=new api.BackupController(forensicService);const forensicCandidate=await forensicController.inspect(sourceArchive.bytes);
 forensicService.failCreate=true;forensicService.raw={profiles:[{bad:true}],activeRetrieval:[{bad:true}]};
 const rescue=await forensicController.createSafetyCopy(forensicCandidate.id);
 check(rescue.kind==='forensic-rescue'&&rescue.filename.endsWith('.rdrescue'),'Forensic rescue fallback missing');
 const rescueText=new TextDecoder().decode(rescue.bytes);
 check(rescueText.includes('revision-director-forensic-rescue')&&rescueText.includes('"importable": false'),'Forensic rescue identity wrong');
 await mustFail(()=>api.BackupCodec.decode(rescue.bytes,x=>api.validateBackupPayload(x)),'backup');
 forensicController.acknowledgeSafetyCopy(rescue.proofId);
 const forensicResult=await forensicController.restore(forensicCandidate.id,rescue.proofId,'discard');
 check(forensicResult.inspection.verified&&forensicService.restores===1,'Forensic-gated restore failed');
 const expService=new FakeService();const expController=new api.BackupController(expService);const expCandidate=await expController.inspect((await api.BackupCodec.create(api.validateBackupPayload(empty()),false)).bytes);const expSafety=await expController.createSafetyCopy(expCandidate.id);expController.acknowledgeSafetyCopy(expSafety.proofId);expController.proofs.get(expSafety.proofId).expiresAt='2000-01-01T00:00:00.000Z';
 await mustFail(()=>expController.restore(expCandidate.id,expSafety.proofId,'discard'),'expired');
 console.log(`PASS ${checks} Pass D2 backup-controller checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
