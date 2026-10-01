'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const {webcrypto}=require('crypto');
const root=path.resolve(__dirname,'..');
let source=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
source=source.replace('void boot();','window.__RD_STAGE_D_TEST__={APP_VERSION,RevisionService,BackupCodec,BackupController,BACKUP_ARCHIVE_VERSION,BACKUP_SCHEMA_VERSION};');
const vendor=fs.readFileSync(path.join(root,'vendor/ts-fsrs-5.4.1','index.umd.js'),'utf8');
const storage=new Map();
const context={crypto:webcrypto,structuredClone,console,Date,Intl,URL,Blob,TextEncoder,TextDecoder,CompressionStream,DecompressionStream,ReadableStream,setTimeout,clearTimeout,setInterval,clearInterval,Map,Set,Math,Number,String,Object,Array,JSON,Error,Promise,Int32Array,Uint8Array,BigInt,navigator:{},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(String(k),String(v)),removeItem:k=>storage.delete(String(k))}};
context.window=context;context.self=context;context.globalThis=context;vm.createContext(context);vm.runInContext(vendor,context);vm.runInContext(source,context);
const api=context.__RD_STAGE_D_TEST__;let checks=0;
function check(v,m){checks++;if(!v)throw new Error(m)}
async function mustFail(fn,text){checks++;try{await fn()}catch(e){if(text&&!String(e.message).toLowerCase().includes(text.toLowerCase()))throw e;return}throw new Error('Expected failure: '+text)}
const settings={schemaVersion:1,key:'app',activeProfileId:'',desiredRetention:.9,dailyCapacityMinutes:60,studyDayBoundaryHour:4};
const empty=()=>({format:'revision-director-backup',schemaVersion:2,exportedAt:new Date().toISOString(),appVersion:'va7.1-pass-e1',profiles:[],nodes:[],units:[],studyEvents:[],obligations:[],evidenceEvents:[],chunks:[],dailyPlans:[],settings:structuredClone(settings),activeRetrieval:null});
const validator=new api.RevisionService({});
class FakeService{
  constructor(){this.payload=empty();this.raw={profiles:[]};this.restores=0;this.failCreate=false;this.diags=[];this.decodeMode='normal'}
  async currentActiveRetrieval(){return this.payload.activeRetrieval}
  async createBackupArchive(prefer=true){if(this.failCreate)throw new Error('current relational state invalid');return api.BackupCodec.create(validator.validateBackup(this.payload),prefer)}
  async decodeBackupArchive(bytes){const decoded=await api.BackupCodec.decode(bytes,x=>validator.validateBackup(x));if(this.decodeMode==='mismatch')decoded.inspection.totalDocuments+=1;return decoded}
  validateBackup(x){return validator.validateBackup(x)}
  async exportBackup(){return structuredClone(this.payload)}
  async restoreBackupPayload(payload,treatment){this.restores++;this.payload=structuredClone(payload);if(treatment==='discard')this.payload.activeRetrieval=null}
  async rawStateForRescue(){return structuredClone(this.raw)}
  diagnostics(){return structuredClone(this.diags)}
}
(async()=>{
  check(api.BACKUP_ARCHIVE_VERSION===2&&api.BACKUP_SCHEMA_VERSION===2,'Stage D versions are not closed at v2');

  const sourceBytes=(await api.BackupCodec.create(validator.validateBackup(empty()),false)).bytes;
  const service=new FakeService();
  const controller=new api.BackupController(service);
  const mutableInput=sourceBytes.slice();
  const candidate=await controller.inspect(mutableInput);
  mutableInput[0]^=0xff;
  check(controller.candidate(candidate.id).inspection.archiveChecksum===candidate.inspection.archiveChecksum,'Inspection retained caller-owned bytes');
  candidate.payload.settings.dailyCapacityMinutes=999;
  check(controller.candidate(candidate.id).payload.settings.dailyCapacityMinutes===60,'Candidate payload escaped defensive cloning');

  const safety=await controller.createSafetyCopy(candidate.id);
  check(safety.kind==='verified-backup'&&safety.filename.endsWith('.rdbackup'),'Healthy state did not create a verified safety backup');
  const safetyDecoded=await api.BackupCodec.decode(safety.bytes,x=>validator.validateBackup(x));
  check(safetyDecoded.payload.settings.dailyCapacityMinutes===60,'Safety backup does not represent current state');
  const publicSafety=safety.bytes.slice();publicSafety[0]^=0xff;
  await mustFail(()=>controller.restore(candidate.id,safety.proofId,'discard'),'confirm');
  controller.acknowledgeSafetyCopy(safety.proofId);
  const restored=await controller.restore(candidate.id,safety.proofId,'discard');
  check(restored.inspection.verified&&service.restores===1,'Acknowledged verified restore failed');
  await mustFail(()=>controller.restore(candidate.id,safety.proofId,'discard'),'inspected backup');

  const replacementService=new FakeService();
  const replacementController=new api.BackupController(replacementService);
  const first=await replacementController.inspect(sourceBytes);
  const firstProof=await replacementController.createSafetyCopy(first.id);
  const second=await replacementController.inspect(sourceBytes);
  await mustFail(()=>replacementController.candidate(first.id),'no longer available');
  await mustFail(()=>replacementController.restore(first.id,firstProof.proofId,'discard'),'no longer available');
  replacementController.cancel(second.id);
  await mustFail(()=>replacementController.candidate(second.id),'no longer available');

  const staleService=new FakeService();
  const staleController=new api.BackupController(staleService);
  const staleCandidate=await staleController.inspect(sourceBytes);
  const staleProof=await staleController.createSafetyCopy(staleCandidate.id);staleController.acknowledgeSafetyCopy(staleProof.proofId);
  staleService.payload.settings.dailyCapacityMinutes=61;
  await mustFail(()=>staleController.restore(staleCandidate.id,staleProof.proofId,'discard'),'changed');

  const expiryService=new FakeService();
  const expiryController=new api.BackupController(expiryService);
  const expiryCandidate=await expiryController.inspect(sourceBytes);
  const expiryProof=await expiryController.createSafetyCopy(expiryCandidate.id);expiryController.acknowledgeSafetyCopy(expiryProof.proofId);
  expiryController.proofs.get(expiryProof.proofId).expiresAt='2000-01-01T00:00:00.000Z';
  await mustFail(()=>expiryController.restore(expiryCandidate.id,expiryProof.proofId,'discard'),'expired');

  const committingService=new FakeService();
  committingService.payload.activeRetrieval={status:'committing'};
  const committingController=new api.BackupController(committingService);
  // Candidate is inspected before the current local session enters committing state.
  committingService.payload.activeRetrieval=null;
  const committingCandidate=await committingController.inspect(sourceBytes);
  committingService.payload.activeRetrieval={status:'committing'};
  await mustFail(()=>committingController.createSafetyCopy(committingCandidate.id),'commit');

  const forensicService=new FakeService();forensicService.failCreate=true;forensicService.raw={profiles:[{bad:true}]};
  const forensicController=new api.BackupController(forensicService);
  const forensicCandidate=await forensicController.inspect(sourceBytes);
  const rescue=await forensicController.createSafetyCopy(forensicCandidate.id);
  check(rescue.kind==='forensic-rescue'&&rescue.filename.endsWith('.rdrescue'),'Corrupt current state did not produce forensic rescue');
  const rescueObject=JSON.parse(new TextDecoder().decode(rescue.bytes));
  check(rescueObject.format==='revision-director-forensic-rescue'&&rescueObject.importable===false,'Forensic rescue identity is unsafe');
  await mustFail(()=>api.BackupCodec.decode(rescue.bytes,x=>validator.validateBackup(x)),'backup');
  forensicController.acknowledgeSafetyCopy(rescue.proofId);
  forensicService.raw={profiles:[{bad:true},{changed:true}]};
  await mustFail(()=>forensicController.restore(forensicCandidate.id,rescue.proofId,'discard'),'changed');

  const emergencyService=new FakeService();emergencyService.failCreate=true;emergencyService.raw={profiles:[{bad:true}]};
  const emergencyController=new api.BackupController(emergencyService);
  const emergencyCandidate=await emergencyController.inspect(sourceBytes);
  storage.set('revision-director:active-retrieval:v1','first');
  const emergencyRescue=await emergencyController.createSafetyCopy(emergencyCandidate.id);emergencyController.acknowledgeSafetyCopy(emergencyRescue.proofId);
  storage.set('revision-director:active-retrieval:v1','second');
  await mustFail(()=>emergencyController.restore(emergencyCandidate.id,emergencyRescue.proofId,'discard'),'changed');
  storage.delete('revision-director:active-retrieval:v1');

  const diagnosticService=new FakeService();diagnosticService.failCreate=true;diagnosticService.raw={profiles:[{bad:true}]};diagnosticService.diags=[{code:'a'}];
  const diagnosticController=new api.BackupController(diagnosticService);
  const diagnosticCandidate=await diagnosticController.inspect(sourceBytes);
  const diagnosticRescue=await diagnosticController.createSafetyCopy(diagnosticCandidate.id);diagnosticController.acknowledgeSafetyCopy(diagnosticRescue.proofId);
  diagnosticService.diags.push({code:'b'});
  await mustFail(()=>diagnosticController.restore(diagnosticCandidate.id,diagnosticRescue.proofId,'discard'),'changed');

  const auditService=new FakeService();auditService.decodeMode='mismatch';
  await mustFail(()=>new api.BackupController(auditService).createVerified(false),'document count');

  console.log(`PASS ${checks} Stage D data-safety controller checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
