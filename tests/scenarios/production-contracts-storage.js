'use strict';
const { createAppRuntime } = require('../helpers/runtime-harness');

const { api } = createAppRuntime({
  globalName: '__RD_A2_TEST__',
  expose: ["APP_VERSION","DB_NAME","DB_VERSION","DOCUMENT_SCHEMA_VERSION","BACKUP_FORMAT","BACKUP_SCHEMA_VERSION","Store","defaultSettings","canonicalExamProfile","canonicalKnowledgeNode","canonicalAppSettings","canonicalDailyPlanRecord","latestPlanVersion","AppDiagnostics","RevisionData","RevisionService","validateBackupPayload"],
});

let checks=0;
const fixed=desiredRetention=>({kind:'fixed-retention',desiredRetention});
function check(value, message) { checks += 1; if (!value) throw new Error(message); }
function mustFail(fn, message) { checks += 1; try { fn(); } catch { return; } throw new Error(message); }

check(api.APP_VERSION === 'va7.1-pass-f1', 'Pass A2 application version is wrong');
check(api.DB_NAME === 'revision-director' && api.DB_VERSION === 3, 'Production database identity is wrong');
check(api.BACKUP_FORMAT === 'revision-director-backup' && api.BACKUP_SCHEMA_VERSION === 2, 'Production backup identity is wrong');
check(Object.values(api.Store).includes('metadata'), 'Metadata store is missing');
const defaults = api.defaultSettings();
check(defaults.schemaVersion === 1 && defaults.activeProfileId === '' && defaults.memoryDifficultyPolicy.remediationLapses===2 && defaults.memoryDifficultyPolicy.persistentDifficultyLapses===4 && defaults.memoryDifficultyPolicy.automaticHold.enabled===false, 'Default settings are not clean production settings');
check(!Object.prototype.hasOwnProperty.call(defaults, 'seededSamples'), 'Prototype seeding flag survived');

const rawProfile = { schemaVersion:1, id:'  p  ', name:'  Exam   Profile  ', examDate:'2027-06-01', status:'active', createdAt:'2026-07-25T06:00:00+05:30', updatedAt:'2026-07-25T06:00:00+05:30' };
const profile = api.canonicalExamProfile(rawProfile);
check(profile.id === 'p' && profile.name === 'Exam Profile', 'Profile canonicalisation failed');
check(profile.createdAt.endsWith('Z') && profile.updatedAt.endsWith('Z'), 'Profile dates were not canonicalised');
mustFail(() => api.canonicalExamProfile({...rawProfile, schemaVersion:2}), 'Unsupported document schema was accepted');
mustFail(() => api.canonicalExamProfile({...rawProfile, id:'p"><img src=x onerror=alert(1)>'}), 'HTML-breaking durable identifier was accepted');
mustFail(() => api.canonicalExamProfile({...rawProfile, id:'internal space'}), 'Whitespace-bearing durable identifier was accepted');

const node = api.canonicalKnowledgeNode({ schemaVersion:1, id:'n', profileId:'p', parentId:null, kind:'subject', name:'  Public   Administration ', normalizedName:'wrong', createdAt:rawProfile.createdAt, updatedAt:rawProfile.updatedAt });
check(node.name === 'Public Administration' && node.normalizedName === 'public administration', 'Node canonical name contract failed');
const settings = api.canonicalAppSettings({ schemaVersion:1, key:'app', activeProfileId:'  p ', fsrsScheduling:{policy:fixed(.9)}, memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}}, dailyCapacityMinutes:60, studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]} });
check(settings.activeProfileId === 'p' && settings.fsrsScheduling.policy.kind === 'fixed-retention', 'Settings canonicalisation failed');
mustFail(() => api.canonicalAppSettings({ ...settings, desiredRetention:.9 }), 'Obsolete top-level desiredRetention was accepted');
mustFail(() => api.canonicalAppSettings((({memoryDifficultyPolicy,...rest})=>rest)(settings)), 'Missing canonical memory-difficulty policy was accepted');
mustFail(() => api.canonicalAppSettings({ ...settings, memoryDifficultyPolicy:{...settings.memoryDifficultyPolicy,automaticHold:{enabled:true,lapseThreshold:3}} }), 'Automatic hold below persistent-difficulty threshold was accepted');
mustFail(() => api.canonicalAppSettings({ ...settings, memoryDifficultyPolicy:{...settings.memoryDifficultyPolicy,automaticHold:{enabled:true,lapseThreshold:4}} }), 'Automatic hold at the persistent-difficulty boundary was accepted');
mustFail(() => api.canonicalAppSettings({ schemaVersion:1, key:'app', fsrsScheduling:{policy:fixed(.9)}, memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}}, dailyCapacityMinutes:60, studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]} }), 'Missing current settings fields were accepted');

const plan = api.canonicalDailyPlanRecord({ schemaVersion:1, id:' d ', studyDayKey:'2026-07-25', createdAt:rawProfile.createdAt, updatedAt:rawProfile.updatedAt, plannerVersion:' pass-d-2 ', versions:[{version:1,generatedAt:rawProfile.createdAt,capacityMinutes:60,reason:'initial',items:[]}], outcomes:[] });
check(plan.id === 'd' && plan.plannerVersion === 'pass-d-2', 'Daily-plan canonicalisation failed');
check(api.latestPlanVersion(plan).version === 1, 'Latest daily-plan version guard returned the wrong version');
mustFail(() => api.latestPlanVersion({...plan, versions:[]}), 'Empty daily-plan version history did not fail closed');

const diagnostics = new api.AppDiagnostics();
diagnostics.record('test.same', 'test operation', new Error('same error'));
diagnostics.record('test.same', 'test operation', new Error('same error'));
check(diagnostics.list().length === 1 && diagnostics.list()[0].count === 2, 'Diagnostics did not deduplicate repeated failures');
for (let index = 0; index < 60; index += 1) diagnostics.record(`test.${index}`, 'bounded test', new Error(`error ${index}`));
check(diagnostics.list().length <= 50, 'Diagnostics journal exceeded its bound');

(async () => {
  const writes = [];
  const rawRepo = {
    put: async (store, value) => writes.push({store, value: structuredClone(value)}),
    get: async () => undefined,
    getAll: async () => [],
  };
  const data = new api.RevisionData(rawRepo, new api.AppDiagnostics());
  await data.put(api.Store.Profiles, rawProfile);
  check(writes[0].value.id === 'p' && writes[0].value.name === 'Exam Profile', 'Storage facade did not canonicalise writes');
  rawRepo.put = async () => { throw new Error('disk unavailable'); };
  let failed = false;
  try { await data.put(api.Store.Profiles, rawProfile); } catch { failed = true; }
  check(failed, 'Storage facade swallowed a write failure');
  check(data.storageHealth().level === 'warning' && data.diagnostics().some((entry) => entry.code.includes('storage.put.profiles')), 'Storage failure was not surfaced through health and diagnostics');

  const service = new api.RevisionService(data);
  const emptyBackup = {
    format:'revision-director-backup', schemaVersion:2, exportedAt:'2026-07-25T06:00:00.000Z', appVersion:'va7.1-pass-f1',
    profiles:[], nodes:[], units:[], studyEvents:[], obligations:[], evidenceEvents:[], chunks:[], dailyPlans:[],
    settings:{schemaVersion:1,key:'app',activeProfileId:'',fsrsScheduling:{policy:fixed(.9)},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]}},
    activeRetrieval:null,
  };
  check(api.validateBackupPayload(emptyBackup).profiles.length === 0, 'Clean empty production backup was rejected');
  mustFail(() => api.validateBackupPayload({...emptyBackup, format:'revision-director-va7-1'}), 'Non-current backup identity was accepted');
  mustFail(() => api.validateBackupPayload({...emptyBackup, profiles:[null]}), 'Non-object backup profile was accepted');
  mustFail(() => api.validateBackupPayload({...emptyBackup, profiles:'not-an-array'}), 'Non-array backup collection was accepted');
  mustFail(() => api.validateBackupPayload({...emptyBackup, settings:{...emptyBackup.settings, schemaVersion:2}}), 'Unsupported settings schema was accepted');
  mustFail(() => api.validateBackupPayload({...emptyBackup, activeRetrieval:42}), 'Non-object active retrieval payload was accepted');
  mustFail(() => api.validateBackupPayload({...emptyBackup, profiles:[{...rawProfile,status:'suspended',id:'profile\" autofocus onfocus=alert(1) x=\"'}]}), 'Hostile imported identifier was accepted');
  const hierarchyProfile = api.canonicalExamProfile({...rawProfile, id:'p', status:'active'});
  const subjectA = api.canonicalKnowledgeNode({schemaVersion:1,id:'subject_a',profileId:'p',parentId:null,kind:'subject',name:'Public Administration',normalizedName:'public administration',createdAt:rawProfile.createdAt,updatedAt:rawProfile.updatedAt});
  const subjectB = api.canonicalKnowledgeNode({...subjectA,id:'subject_b'});
  const hierarchyBackup = {
    ...emptyBackup,
    profiles:[hierarchyProfile],
    nodes:[subjectA,subjectB],
    settings:{...emptyBackup.settings,activeProfileId:'p'},
  };
  mustFail(() => api.validateBackupPayload(hierarchyBackup), 'Duplicate semantic root hierarchy paths were accepted');
  console.log(`PASS ${checks} Pass A2 production-contract and storage-facade checks`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
