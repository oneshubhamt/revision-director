from __future__ import annotations
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(ROOT / "build/build.py")], check=True)
source_manifest_path = ROOT / "source/app/source-manifest.json"
source_manifest = json.loads(source_manifest_path.read_text())
optimizer_package = json.loads((ROOT / "tools/fsrs-optimizer/package.json").read_text())
optimizer_lock = json.loads((ROOT / "tools/fsrs-optimizer/package-lock.json").read_text())
optimizer_policy = (ROOT / "tools/fsrs-optimizer/optimizer-policy.mjs").read_text()
optimizer_cli = (ROOT / "tools/fsrs-optimizer/optimize.mjs").read_text()
source_parts = sorted(source_manifest["parts"], key=lambda item: item["order"])
source_paths = [ROOT / "source" / item["path"] for item in source_parts]
ts = "".join(path.read_text() for path in source_paths)
contracts_ts = (ROOT / "source/app/12-production-contracts.ts").read_text()
tsconfig = json.loads((ROOT / "source/tsconfig.json").read_text())
build_script = (ROOT / "build/build.py").read_text()
first_source = source_paths[0].read_text()
last_source = source_paths[-1].read_text()
shell = (ROOT / "source/revision-director.shell.html").read_text()
css = (ROOT / "source/revision-director.va7.css").read_text()
js = (ROOT / "dist/app.js").read_text()
html = (ROOT / "index.html").read_text()
vendor_path = ROOT / "vendor/ts-fsrs-6.0.0/index.umd.js"
vendor = vendor_path.read_text()
package = json.loads((ROOT / "vendor/ts-fsrs-6.0.0/package.json").read_text())
expected_hash = "6ef23308221a59a524c18153e665480159bc4e26e9d437a70d9e1e912cc54554"
actual_hash = hashlib.sha256(vendor_path.read_bytes()).hexdigest()

checks: list[tuple[str, bool]] = []
def check(name: str, condition: bool) -> None:
    checks.append((name, condition))
    if not condition:
        raise AssertionError(name)

check("source ownership manifest", source_manifest.get("schemaVersion") == 1 and len(source_parts) > 0)
check("source order contiguous", [item["order"] for item in source_parts] == list(range(len(source_parts))))
check("source parts unique", len(source_paths) == len(set(source_paths)))
check("source parts present", all(path.is_file() and path.stat().st_size > 0 for path in source_paths))
check("obsolete monolith absent", not (ROOT / "source/revision-director.va7.ts").exists())
check("synthetic TypeScript composite absent", not (ROOT / "build/generated/revision-director.combined.ts").exists() and "revision-director.combined.ts" not in build_script and "GENERATED_TS" not in build_script)
check("manifest runtime assembly", source_manifest.get("runtime") == {"assembly":"manifest-ordered-emitted-js","boundary":"build-owned-iife","output":"../dist/app.js"} and "entrypoint" not in source_manifest)
check("TypeScript compiles real source graph", tsconfig.get("include") == ["app/*.ts"] and tsconfig.get("compilerOptions", {}).get("rootDir") == "." and tsconfig.get("compilerOptions", {}).get("outDir") == "../build/generated-js" and tsconfig.get("compilerOptions", {}).get("noEmitOnError") is True and tsconfig.get("compilerOptions", {}).get("moduleDetection") == "legacy")
check("TypeScript correctness flags", all(tsconfig.get("compilerOptions", {}).get(name) is expected for name, expected in {
    "noImplicitReturns": True,
    "noFallthroughCasesInSwitch": True,
    "noPropertyAccessFromIndexSignature": True,
    "allowUnreachableCode": False,
    "allowUnusedLabels": False,
    "noUnusedLocals": True,
    "noUnusedParameters": True,
    "forceConsistentCasingInFileNames": True,
}.items()))
check("build assembles emitted files", "expected_outputs" in build_script and "manifest-ordered-emitted-js" in build_script and "textwrap.indent(body, \"  \")" in build_script)
check("measured TypeScript checker parallelism", 'TYPESCRIPT_CHECKERS = 2' in build_script and '"--checkers", str(TYPESCRIPT_CHECKERS)' in build_script)
check("source parts own no runtime wrapper", not first_source.lstrip().startswith("(() => {") and not last_source.rstrip().endswith("})();"))
check("manifest owns expected layers", all(token in {path.name for path in source_paths} for token in [
    "00-runtime-boundary.ts", "05-presentation-engine.ts", "10-domain-model.ts", "11-domain-kernel.ts",
    "12-production-contracts.ts", "18-fsrs-personalization.ts", "19-revision-scheduler-port.ts", "20-policy-planning-kernel.ts", "21-policy-implementations.ts",
    "30-indexeddb-repository.ts", "31-storage-facade.ts", "32-active-retrieval-persistence.ts", "33-phase-time-runtime.ts", "34-cross-tab-ownership.ts", "40-application-services.ts",
    "41-backup-codec.ts", "45-ui-runtime.ts", "50-ui-controller.ts", "60-public-bridge-bootstrap.ts"
]))
check("shell presentation manifest placeholder", "<!-- INLINE_PRESENTATION_MANIFEST -->" in shell)
check("shell presentation prepaint placeholder", "<!-- INLINE_PRESENTATION_PREPAINT -->" in shell)
check("shell CSS placeholder", "<!-- INLINE_CSS -->" in shell)
check("shell vendor placeholder", "<!-- INLINE_VENDOR_JS -->" in shell)
check("shell app placeholder", "<!-- INLINE_JS -->" in shell)
check("build has no placeholders", not any(marker in html for marker in ["<!-- INLINE_PRESENTATION_MANIFEST -->", "<!-- INLINE_PRESENTATION_PREPAINT -->", "<!-- INLINE_CSS -->", "<!-- INLINE_VENDOR_JS -->", "<!-- INLINE_JS -->"]))
check("no external scripts", not re.search(r"<script\s+[^>]*src=", html, re.I))
check("no CDN references", "cdn.jsdelivr.net" not in html and "unpkg.com" not in html)
check("offline CSP", "script-src 'self' 'unsafe-inline' blob:;" in html and "connect-src 'none'" in html)
check("presentation source assets", (ROOT / "source/presentation/revision-director.presentation.json").is_file() and (ROOT / "source/presentation/prepaint.js").is_file())
check("presentation manifest embedded before CSS", html.index('id="revision-director-presentation-manifest"') < html.index('<style>'))
check("presentation prepaint before CSS", html.index('data-rd-presentation-prepaint="1"') < html.index('<style>'))
check("presentation kernel source", "revision-director.presentation-kernel" in ts and "installPresentationKernel" in ts and '"__RD_PRESENTATION_MANIFEST__"' in ts and "__RD_PRESENTATION_MANIFEST__" not in js)
check("immutable presentation default", '"immutable":true' in html and 'data-presentation="revision-current"' in shell)
check("semantic presentation token namespace", "--rd-color-canvas" in css and "--rd-font-body" in css and "--rd-layout-sidebar-width" in css)
presentation_manifest_text = (ROOT / "source/presentation/revision-director.presentation.json").read_text()
check("direct semantic presentation tokens", '"aliases"' not in presentation_manifest_text and all(token not in css for token in ["var(--bg)", "var(--s1)", "var(--acc)", "var(--txt)", "var(--line-soft)", "var(--sidebar)"]))
check("delegated UI action runtime", all(token in ts for token in [
    'document.addEventListener("click"', 'document.addEventListener("submit"',
    'document.addEventListener("input"', 'document.addEventListener("change"',
    'document.addEventListener("keydown"'
]))
check("render coordinator and dirty invalidation", "class RenderCoordinator" in ts and "private readonly dirty = new Set<RenderDomain>()" in ts and "requestAnimationFrame" in ts and "invalidateDebounced" in ts)
check("ARIA tab registry", "class AriaTabRegistry" in ts and 'setAttribute("role", "tablist")' in ts and 'event.key === "Home"' in ts and 'event.key === "End"' in ts)
check("dialog and overlay focus managers", "class NativeDialogFocusManager" in ts and "class OverlayFocusManager" in ts and "root.inert = true" in ts and "restoreDocumentFocus" in ts)
check("44-pixel interaction contract", "min-height:44px" in css and ".file-btn{min-height:44px}" in css)
check("reduced-motion contract", "@media (prefers-reduced-motion:reduce)" in css)
check("safe-area contract", "env(safe-area-inset-bottom)" in css and "viewport-fit=cover" in shell)
check("compact content reserves navigation", "height:calc(100dvh - 64px - env(safe-area-inset-bottom))" in css and "overflow-y:auto" in css)
check("vendor metadata", package.get("name") == "ts-fsrs" and package.get("version") == "6.0.0" and package.get("license") == "MIT")
check("vendor checksum", actual_hash == expected_hash)
check("embedded vendor marker", f'data-vendor="ts-fsrs@6.0.0" data-sha256="{expected_hash}"' in html)
check("embedded vendor exact parity", f'<script data-vendor="ts-fsrs@6.0.0" data-sha256="{expected_hash}">\n{vendor}\n</script>' in html)
check("vendor loads before app", html.index('data-vendor="ts-fsrs@6.0.0"') < html.rindex(f"<script>\n{js}\n</script>"))
check("inline CSS parity", f"<style>\n{css}\n</style>" in html)
check("inline JS parity", f"<script>\n{js}\n</script>" in html)
check("sealed generated runtime", js.startswith('(() => {\n  "use strict";') and js.rstrip().endswith("})();"))
check("single strict runtime directive", js.count('"use strict";') == 1)
check("no TS namespace", "namespace RD" not in ts and "namespace RevisionDirector" not in ts)
check("no compiled RD global", not re.search(r"\bvar\s+RD\b", js))
check("temporary FSRS global removed", 'delete (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS' in ts)
check("production database identity", 'const DB_NAME = "revision-director"' in ts and 'const DB_VERSION = 3' in ts)
check("document schema version contract", 'type DocumentSchemaVersion = 1' in ts and 'const DOCUMENT_SCHEMA_VERSION: DocumentSchemaVersion = 1' in ts)
check("all durable documents versioned", all(token in ts for token in [
    "interface ExamProfile", "interface KnowledgeNode", "interface KnowledgeUnit", "interface StudyEvent",
    "interface RevisionObligation", "interface EvidenceEvent", "interface ObligationChunk",
    "interface DailyPlanRecord", "interface AppSettings", "interface AppMetadata"
]) and ts.count("schemaVersion: DocumentSchemaVersion;") >= 10)
check("canonical boundary normalisers", all(token in ts for token in [
    "function canonicalExamProfile", "function canonicalKnowledgeNode", "function canonicalKnowledgeUnit",
    "function canonicalStudyEvent", "function canonicalRevisionObligation", "function canonicalEvidenceEvent",
    "function canonicalObligationChunk", "function canonicalDailyPlanRecord", "function canonicalAppSettings",
    "function canonicalAppMetadata", "function canonicalDocument"
]))
check("application storage facade", "class RevisionData" in ts and "class IndexedDbRepository" in ts and "class AppDiagnostics" in ts)
check("storage health contracts", "interface StorageHealthSnapshot" in ts and "navigator.storage" in ts and "persisted" in ts and "estimate" in ts)
check("bounded diagnostics", "while (this.records.length > 50)" in ts and "JSON.stringify(this.records).length > 32_000" in ts)
check("metadata verifies production database", "Database metadata does not match this production database." in ts and "canonicalAppMetadata" in ts)
check("single canonical DB identity", all(name not in html for name in ["revision-director-va1", "revision-director-va2", "revision-director-va3", "revision-director-va7-1"]))
check("knowledge hierarchy", 'type KnowledgeNodeKind = "subject" | "section" | "topic"' in ts and 'interface KnowledgeUnit' in ts and 'async ensureHierarchy' in ts)
check("six obligation types", all(value in ts for value in [
    '"memory-recall"', '"concept-reconstruction"', '"application-practice"',
    '"performance-practice"', '"relearn"', '"freshness-review"'
]))
check("eleven durable stores", all(value in ts for value in [
    'Profiles: "profiles"', 'Nodes: "nodes"', 'Units: "units"',
    'StudyEvents: "studyEvents"', 'Obligations: "obligations"',
    'EvidenceEvents: "evidenceEvents"', 'Chunks: "chunks"', 'DailyPlans: "dailyPlans"', 'Settings: "settings"',
    'Metadata: "metadata"', 'ActiveRetrieval: "activeRetrieval"'
]))
check("exact FSRS-7 adapter", 'readonly id = `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}/fsrs-7`' in ts)
check("FSRS limited to memory", 'readonly type: ObligationType = "memory-recall"' in ts)
check("modern FSRS scheduler API", "DefaultScheduler(options: FsrsDefaultSchedulerOptions)" in ts and "interface RevisionSchedulerPort" in ts and "class TsFsrsSchedulerPort" in ts and "prepareFsrsScheduler" in ts and "this.scheduler.review({" in ts and "this.scheduler.preview({" in ts and "this.scheduler.forward({" in ts)
check("single FSRS replay path", "model.forward" not in ts and "private replayCards" in ts and "this.history.reschedule({" in ts and "replayMemoryStates" not in ts)
check("FSRS scheduler warmup lifecycle", "prepareFsrsScheduler(this.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(this.settings))" in ts and "prepareFsrsScheduler(canonical.fsrsScheduling.policy, activeFsrsOptimizerProfile(canonical))" in ts and "prepareFsrsScheduler(validated.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(validated.settings))" in ts)
check("no deprecated FSRS scheduler API", all(token not in ts for token in ["api.fsrs(", ".createEmptyCard(", "generatorParameters("]))
check("FSRS-7 only", 'type FsrsModelVersion = "FSRS-7"' in ts and 'const FSRS_MODEL: FsrsModelVersion = "FSRS-7"' in ts)
check("FSRS-7 dual trace", "stabilityFast: number" in ts and "requiredFsrs7StabilityFast" in ts)
check("FSRS-7 long-form interval policy", "fractionalDays: true" in ts and "enableShortTerm: true" in ts and 'learningSteps: ["1d"]' in ts and 'relearningSteps: ["1d"]' in ts and "graduatingInterval: FSRS_GRADUATING_INTERVAL_DAYS" in ts and "allowModelOverride: true" in ts)
check("FSRS scheduler policy boundary", 'type FsrsSchedulingPolicy =' in ts and '"fixed-retention"' in ts and '"cost-adr"' in ts and "fsrsSchedulingPolicyIdentity(config.schedulingPolicy)" in ts and "Cost-ADR scheduling is defined but not enabled in this build." in ts and "settings.desiredRetention" not in ts)
check("Again routes to corrective relearning", 'if (rating === Rating.Again) completion.followUpType = "relearn"' in ts)
check("host-owned persistent difficulty", 'type MemoryDifficultyLevel = "normal" | "remediation" | "persistent-difficulty"' in ts and "memoryDifficultyAssessment" in ts and "memoryDifficultyRemediationPlan" in ts and 'suspensionReason = "persistent-difficulty"' in ts and "resumePersistentDifficulty" in ts)
check("leech signal without parallel suspension", "schedulerLeechMiddleware" not in ts and 'Revision Director does not persist FSRS-owned suspension state.' in ts and 'scheduleStatus = "suspended"' not in ts)
check("FSRS rating semantics", 'if (type === "memory-recall")' in ts and '"Easy" remains a user judgement' in ts and "partial or cued recall" in ts)
check("strict current data only", "event.oldVersion === 0" in ts and "canonical.applicationVersion === APP_VERSION" in ts and 'candidate["appVersion"] === APP_VERSION' in ts)
check("no timing compatibility synthesis", "fallbackElapsedMs" not in ts and "canonicalTimingEvidenceSummary(value: TimingEvidenceSummary)" in ts and "completeChunk(chunkId: string, timing: TimingEvidenceSummary" in ts)
check("no current-shape repair coercions", "reliabilityFlags.push" not in contracts_ts and "checked[key] = Boolean(rawValue)" not in contracts_ts and "sourceVisible: Boolean(value.sourceVisible)" not in contracts_ts and "Active retrieval elapsed time does not match phase timing." in contracts_ts)
check("backup payload narrows from unknown", "const candidate = requireRecord(input, \"Backup\")" in ts and "canonicalDocumentArray(\"profile\"" in ts and "candidate.profiles as ExamProfile[]" not in ts and "candidate.evidenceEvents as EvidenceEvent[]" not in ts)
check("checked external domain boundaries", "function literalChoice<const Values" in ts and "MessageEvent<unknown>" in ts and "async register(input: unknown)" in ts and "private async importStudyEvent(input: unknown)" in ts and "private async createRevisionCandidate(input: unknown)" in ts and " as InactiveGapClassification" not in ts and " as BackupActiveSessionTreatment" not in ts)
check("archive parsers narrow unknown records", "as Partial<BackupArchive" not in ts and "const candidate: BackupPayload" not in ts and "const parsed = JSON.parse(raw) as ActiveRetrievalRecoveryEnvelope" not in ts and "as Partial<DiagnosticRecord>" not in ts)
check("store-keyed persistence typing", "interface StoreValueMap" in ts and "type StoreValue<S extends StoreName>" in ts and "async get<S extends StoreName>(store: S" in ts and "async getAll<S extends StoreName>(store: S" in ts and "async get<T>(store: StoreName" not in ts and "async getAll<T>(store: StoreName" not in ts)
check("stateful non-null assertions are guarded", all(token not in ts for token in ["obligation.chunking!", "versions.at(-1)!", "returnedTarget!.", "itemByKey.get(outcome.itemKey)!", "activeReviewIds[this.activeReviewIndex]!", "activeReviewIds[0]!"]) and "function latestPlanVersion" in ts and "private activeReviewTarget" in ts)
check("closed domain maps are exhaustive", all(token in ts for token in [
    "as const satisfies Record<ObligationType, string>",
    "as const satisfies Record<RetrievalWorkflow, string>",
    "satisfies Record<ObligationType, NonEmptyReadonlyArray<RetrievalWorkflow>>",
    'satisfies Record<ObligationType, PolicyState["engine"]>',
    "satisfies Record<Rating, number>",
    "satisfies Record<keyof PlanningFactors, number>",
]) and "const engineFor: Record<ObligationType" not in ts and "compatibleWorkflows(type)[0]!" not in ts)
check("DOM and FormData boundaries are runtime typed", "function requiredNamedFormControl" in ts and "function formNumber" in ts and "function requiredElement<T extends HTMLElement>" in ts and "instanceof constructor" in ts and "elements.namedItem(\"workflowKind\") as HTMLSelectElement" not in ts and "requiredElement<HTML" not in ts and "event.target as HTMLInputElement" not in ts and "event.target as HTMLElement" not in ts)

check("SHA-256-only backup integrity", 'type BackupArchiveHashAlgorithm = "sha256";' in ts and "fnv1a64" not in (ROOT / "source/app/41-backup-codec.ts").read_text())
check("policy router", "class SchedulerPolicyRouter" in ts)
check("immutable Study Event semantics", "interface StudyEvent" in ts and "studyEvents" in ts)
check("atomic unit and first obligation", "createUnitWithObligation" in ts and "this.db.transaction([Store.Units, Store.Obligations]" in ts)
check("atomic unit status propagation", "updateUnitWithObligations" in ts)
check("cross-profile Study Event guard", "Study Event cannot link a knowledge unit from another exam profile" in ts)
check("strong evidence rubric", all(term in ts for term in ["completeness", "independence", "application", "accuracyPercent", "errorTypes", "ERROR_TYPES"]))
check("scheduler configuration provenance", "interface FsrsConfigSnapshot" in ts and "schedulerConfig?: FsrsConfigSnapshot" in ts and "fingerprint: string" in ts and "validateFsrsConfigSnapshot" in ts)
check("FSRS personalization profile contract", 'schema: "revision-director-fsrs-profile/v1"' in ts and "function validateFsrsOptimizerProfile" in ts and "bindingVersion" in ts)
check("FSRS-7 exact 34-weight validation", "FSRS7_PARAMETER_BOUNDS" in ts and "value.length === 34" in ts and "FSRS7_DEFAULT_WEIGHTS" in ts)
check("FSRS optimizer evidence export", 'review_time,card_id,review_rating,review_duration,review_state' in ts and "fsrsOptimizerCsv" in ts and "relearning-return" in ts)
check("chronological held-out activation gate", 'strategy: "final-sixth"' in ts and "minimumTrainItems: 64" in ts and "minimumHoldoutItems: 64" in ts and "minimumHoldoutCards: 16" in ts and "personalized.logLoss < stock.logLoss" in ts and "personalized.rmseBins <= stock.rmseBins" in ts)
check("explicit personalization rebase semantics", "activateFsrsOptimizerProfile" in ts and "deactivateFsrsOptimizerProfile" in ts and "replaceSettingsAndObligations" in ts and "rescheduledObligations" in ts and "Finish or end the active retrieval session before changing FSRS scheduler parameters." in ts)
check("optimizer remains outside browser runtime", "@open-spaced-repetition/binding" not in ts and "@open-spaced-repetition/binding" not in js and "@open-spaced-repetition/binding" in optimizer_cli)
check("optimizer dependency pinned", optimizer_package.get("dependencies") == {"@open-spaced-repetition/binding": "0.6.1"} and optimizer_lock.get("packages", {}).get("", {}).get("dependencies") == {"@open-spaced-repetition/binding": "0.6.1"})
check("optimizer training policy", all(token in optimizer_cli for token in ["computeParameters", "evaluateWithTimeSeriesSplits", "splitChronologicalHoldout", "evaluateHoldoutGate", "finalRetrainedOnAllEvidence"]) and all(token in optimizer_policy for token in ["MIN_TRAIN_ITEMS=64", "MIN_HOLDOUT_ITEMS=64", "MIN_HOLDOUT_CARDS=16", 'HOLDOUT_STRATEGY="final-sixth"']))
check("optimizer tooling syntax", subprocess.run(["node", "--check", str(ROOT / "tools/fsrs-optimizer/optimizer-policy.mjs")], capture_output=True).returncode == 0 and subprocess.run(["node", "--check", str(ROOT / "tools/fsrs-optimizer/optimize.mjs")], capture_output=True).returncode == 0)
check("safe suspension provenance", "type SuspensionReason" in ts and 'suspensionReason = "relearning"' in ts and 'suspensionReason === "unit"' in ts)
check("automatic relearn follow-up", 'completion.followUpType = "relearn"' in ts)
check("relearn pauses exact original", 'item.returnObligationId === obligation.id' in ts and 'obligation.status = "suspended"' in ts)
check("atomic original reactivation", "relatedObligation?: RevisionObligation" in ts and "if (relatedObligation) obligationStore.put(relatedObligation)" in ts)
check("FSRS relearning resumption", 'const resumed = this.router.get("memory-recall").complete(' in ts and "memoryReviewObservationsFor(original.id, priorEvidence)" in ts and "original.dueAt = resumed.dueAt" in ts and "original.policyState = resumed.policyState" in ts)
check("FSRS due ownership invariant", 'assert(fsrsCard.dueAt === obligation.dueAt' in ts and "original.lastCompletedAt = reviewedAt.toISOString()" in ts)
check("FSRS relearning transition audit", "returnedMemoryTransition" in ts and "ReturnedMemoryTransition" in ts and "Returned-memory scheduler transition presence is inconsistent" in ts)
check("priority-aware queue", "b.obligation.priority - a.obligation.priority" in ts and "b.unit.importance - a.unit.importance" in ts)
check("relational backup validation", "Section must belong to a subject in the same profile" in ts and "Evidence event relationships are inconsistent" in ts)
check("six retrieval workflows", all(value in ts for value in ['"recall"', '"reconstruction"', '"questions"', '"diagram"', '"answer-writing"', '"relearning"']))
check("workflow separated from policy", "interface WorkflowSpec" in ts and "workflow: WorkflowSpec" in ts and "defaultWorkflowForType" in ts)
check("workflow-specific evidence", "type WorkflowResult" in ts and "workflowEvidence" in ts and "validateWorkflowResult" in ts)
check("workflow-policy routing", "function compatibleWorkflows" in ts and '"memory-recall": ["recall"]' in ts and '"performance-practice": ["answer-writing", "diagram", "questions"]' in ts and "WORKFLOWS_BY_OBLIGATION[type]" in ts)
check("closed-book relearning verification", "Complete relearning verification with the source closed" in ts)
check("diagram canvas", 'id="diagram-canvas"' in ts and "initializeDiagramCanvas" in ts)
check("answer-writing constraints", "completedWithinTime" in ts and "wordLimit" in ts and "timeLimitMinutes" in ts)
check("two-stage relearning", 'data-review-phase="relearn-repair"' in ts and 'data-review-phase="relearn-verify"' in ts)
check("keyboard uses protected reveal", "reveal.click();" in ts and 'this.reviewPhase === "attempt"' in ts)
check("keyboard cannot rerender through reveal", "void this.renderReview();" not in ts[ts.index("private handleKeyboard"):ts.index("private toast")])
check("production path has no sample seeding", all(term not in ts for term in ["seedPrototypeData", "seededSamples", "clearAndReseed", "reset-data", "RESET PROTOTYPE"]))
check("attempt survives navigation", "reviewDrafts" in ts and "captureReviewDraft" in ts and "restoreReviewDraft" in ts)
check("side-by-side comparison", "comparison-grid" in ts and "attemptComparisonPanel" in ts and "comparison-attempt-text" in ts)
check("diagram visible in comparison", "comparison-diagram-canvas" in ts and "syncComparisonAttempt" in ts)
check("automatic answer timing", "attemptElapsedMs <= timeLimitMinutes * 60_000" in ts and "answer-within-time" not in ts)
check("relearning trigger context", "triggeringEvidence" in ts and "WHY THIS RELEARNING EXISTS" in ts)
check("question set provenance", "questionSetRef" in ts and "questions-error-summary" in ts)
check("source reveal preserves attempt", 'this.reviewPhase = "compare"' in ts and "await this.renderReview();" not in ts[ts.index('else if (action === "reveal")'):ts.index('else if (action === "begin-verification")')])
check("production backup schema", 'const BACKUP_FORMAT = "revision-director-backup" as const' in ts and 'const BACKUP_SCHEMA_VERSION = 2' in ts)
check("frozen public capability API", "interface RevisionDirectorPublicApi" in ts and "Object.freeze({" in ts and 'Object.defineProperty(window, "RevisionDirector"' in ts)
check("non-writable public API", 'Object.defineProperty(window, "RevisionDirector"' in ts and "writable: false" in ts and "RevisionDirectorBridge" not in ts)
check("plugin capability negotiation", "REVISION_DIRECTOR_CAPABILITIES" in ts and "Missing capabilities:" in ts and "PLUGIN_MAX_REGISTRATION_ATTEMPTS = 2" in ts)
check("plugin failure isolation", 'state: "failed"' in ts and "Plugin file could not be evaluated" in ts and "Plugin setup returned inactive" in ts)
check("trusted local plugin loader", "LOCAL_PLUGIN_MAX_BYTES = 1 * 1024 * 1024" in ts and "revisionDirectorPluginFile" in ts and "script-src 'self' 'unsafe-inline' blob:" in shell)
check("minimal canonical public operations", all(term in ts for term in ["getDueSummary", "listProfiles", "importStudyEvent", "createRevisionCandidate"]) and all(term not in ts[ts.index("interface RevisionDirectorPublicApi"):ts.index("const REVISION_DIRECTOR_PUBLIC_API_VERSION")] for term in ["rawDump", "recordReview", "replaceFromBackup"]))
check("production backup format", 'format: BACKUP_FORMAT' in ts and 'candidate["format"] === BACKUP_FORMAT' in ts)
check("D1 backup archive codec", "class BackupCodec" in ts and 'const BACKUP_ARCHIVE_FORMAT = "revision-director-backup-archive"' in ts and 'const BACKUP_ARCHIVE_VERSION = 2' in ts)
check("D1 bounded chunks", "BACKUP_ARCHIVE_CHUNK_TARGET_BYTES = 512 * 1024" in ts and "BACKUP_ARCHIVE_CHUNK_MAX_ITEMS = 100" in ts and "BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES" in ts)
check("D1 compression detection", 'bytes[0] === 0x1f && bytes[1] === 0x8b' in ts and 'DecompressionStream("gzip")' in ts)
check("D1 integrity proofs", "hashJson" in ts and "chunkHashes" in ts and "Backup final checksum failed verification" in ts and "sha256Fallback" in ts)
check("D1 inspection metadata", "interface BackupInspectionMetadata" in ts and "totalDocuments" in ts and "warnings" in ts)
check("D1 unreliable-time export contract", '"unreliable-interruption"].includes(duration.reason)' in ts)
check("D1 production file route", '.rdbackup' in ts and "decodeBackupArchive" in ts and "inspectBackupArchive" in ts)
check("D2 backup controller", "class BackupController" in ts and "createSafetyCopy" in ts and "acknowledgeSafetyCopy" in ts and "restore(candidateId" in ts)
check("D2 non-mutating preview", "No application data has been changed" in ts and "renderRestorePreview" in ts)
check("D2 active-session treatment", "activeRetrieval" in ts and "restore-active-treatment" in ts and "A backup containing a committing retrieval cannot be restored" in ts)
check("D2 safety and confirmation", "restore-safety-saved" in ts and "restore-replace-confirm" in ts and "Final confirmation" in ts)
check("D2 forensic rescue", "revision-director-forensic-rescue" in ts and ".rdrescue" in ts and "importable: false" in ts)
check("mobile six-item nav", "grid-template-columns:repeat(6,1fr)" in css)

check("Pass C planning factors", all(term in ts for term in ["dueRisk", "examImportance", "weakness", "reviewDuration", "examinationProximity"]))
check("FSRS retrievability used only for memory risk", "function fsrsRetrievability" in ts and 'obligation.type !== "memory-recall"' in ts and ".model.forgettingCurve(" in ts and "elapsedDays" in ts and "stabilityFast" in ts)
check("capacity-bounded planner", "function choosePlanItems" in ts and "Int32Array(capacity + 1)" in ts and "dailyCapacityMinutes" in ts)
check("daily plan service", "async dailyPlan" in ts and "buildPlanningCandidate" in ts)
check("transparent planner UI", "Why score" in ts and "factorMeter" in ts and "Deferred by capacity" in ts)
check("daily plan starts selected queue", "item.chunk ? `chunk:${item.chunk.id}` : item.joined.obligation.id" in ts)
check("editable exam horizons", "async updateProfile" in ts and "data-profile-date" in ts and "data-profile-status" in ts)
check("paused profiles excluded", 'item.profile.status !== "active"' in ts)
check("passed profiles excluded", 'if (examDateTime(item.profile) && daysToExam < 0) return undefined' in ts and 'if (daysToExam < 0) return 0' in ts)
check("obligation-specific weakness", "function obligationWeaknessScore" in ts and "event.obligationId === item.obligation.id" in ts)
check("unit weakness secondary", "obligationSignal * 0.68" in ts and "unitContext * 0.18" in ts)
check("capacity exceptions model", "requiredOverrun: PlannedQueueItem[]" in ts and "mustSplit: PlannedQueueItem[]" in ts)
check("critical overrun explicit", "highestCritical && durationOf(highestCritical) > capacityMinutes" in ts and "requiredOverrun = [highestCritical]" in ts)
check("must-split UI", "Critical work requiring split" in ts and "required overrun" in ts and "must split" in ts)

check("duration learning model", "interface DurationObservation" in ts and "function durationObservationFor" in ts and "durationSampleCount" in ts)
check("weekly balance factor", "weeklyBalance" in ts and "weeklySubjectBalanceScores" in ts and "interleaveSelected" in ts)
check("automatic chunking", "interface ObligationChunk" in ts and "createAutomaticChunks" in ts and "synthesis-ready" in ts)
check("parent scheduling protected", "completing this chunk records execution only" in ts and "completeChunk" in ts and 'const synthesisReady = item.obligation.chunking?.status === "synthesis-ready"' in ts and "obligation.dueAt = completedAt.toISOString()" not in ts)
check("persisted daily plans", "interface DailyPlanRecord" in ts and 'DailyPlans: "dailyPlans"' in ts and "persistDailyPlan" in ts)
check("plan versions and outcomes", "versions: DailyPlanVersion[]" in ts and "outcomes: DailyPlanOutcome[]" in ts)
check("profile-qualified weekly balance", "function subjectBalanceKey" in ts and "subjectBalanceKey(item.profile.id, item.subject)" in ts)
check("configured study-day balance boundary", "weeklySubjectBalanceScores(joined, planHistory, planningReference, this.settings.studyDayBoundaryHour)" in ts)
check("chunk capacity provenance", "capacityMinutes: number;" in ts and "obligation.chunking.capacityMinutes" in ts)
check("untouched split capacity reflow", "Replanned before execution because daily capacity changed." in ts)
check("material plan signature", "capacityMinutes: value.capacityMinutes" in ts and "items: value.items.map" in ts)
check("manual deferred amendment", "existing.disposition !== \"selected\" && existing.disposition !== \"required-overrun\"" in ts)
check("Pass D de novo QA suite", (ROOT / "tests/pass-d-qa.spec.js").exists())
check("Pass D browser stress suite", (ROOT / "tests/pass-d-browser-qa.spec.py").exists())
check("phase-aware time runtime", "class PhaseTimeRuntime" in ts and "activeByPhase" in ts and "pauseHistory" in ts and "phaseHistory" in ts)
check("120-second inactive-gap detection", "const INACTIVE_GAP_THRESHOLD_MS = 120_000" in ts and "gap-pending" in ts)
check("four gap classifications", all(token in ts for token in ['"focus"', '"break"', '"split"', '"ignore"']))
check("source reveal boundary", "sourceRevealAt" in ts and '"source-reveal"' in ts and '"verification-reveal"' in ts)
check("unreliable timing excluded", 'reason: "unreliable-interruption"' in ts and "durationReliable" in ts)
check("Pass B2 runtime suite", (ROOT / "tests/pass-b2.spec.js").exists())
check("Pass B2 browser suite", (ROOT / "tests/pass-b2-browser.spec.py").exists())
check("cross-tab ownership runtime", "class ReviewOwnershipCoordinator" in ts and "REVIEW_OWNER_HEARTBEAT_MS = 4_000" in ts and "REVIEW_OWNER_STALE_MS = 15_000" in ts)
check("takeover hydration before mutation", 'this.transition("hydrating")' in ts and 'await this.callbacks?.hydrate(reason)' in ts and 'this.transition("primary")' in ts)
check("secondary read-only UI", "This tab is read-only" in ts and "applyReadOnlyState" in ts and "existingPendingChunks" in ts)
check("ownership lifecycle closure", "releaseForExit" in ts and 'window.addEventListener("pagehide"' in ts and 'window.addEventListener("beforeunload"' in ts)
check("storage quota refresh", "refreshStorageHealth(requestPersistence = false)" in ts and "refreshStorageHealth(true)" in ts and "storage-capacity-banner" in shell)
check("Pass B3 runtime suite", (ROOT / "tests/pass-b3.spec.js").exists())
check("Pass B3 browser suite", (ROOT / "tests/pass-b3-browser.spec.py").exists())
check("Stage B hostile recovery suite", (ROOT / "tests/stage-b-hostile-recovery.spec.py").exists())
subprocess.run(["node", "--check", str(ROOT / "dist/app.js")], check=True)
print(f"PASS {len(checks)} build-integrity checks")
