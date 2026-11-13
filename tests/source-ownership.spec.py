from __future__ import annotations
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
MANIFEST_PATH = SOURCE / "app/source-manifest.json"
EXPECTED_NAMES = [
    "00-runtime-boundary.ts",
    "05-presentation-engine.ts",
    "10-domain-model.ts",
    "11-domain-kernel.ts",
    "12-production-contracts.ts",
    "18-fsrs-personalization.ts",
    "18a-fsrs-browser-optimizer.ts",
    "19-revision-scheduler-port.ts",
    "20-policy-planning-kernel.ts",
    "21-policy-implementations.ts",
    "22-backup-validation.ts",
    "23-evidence-transition.ts",
    "30-indexeddb-repository.ts",
    "31-storage-facade.ts",
    "32-active-retrieval-persistence.ts",
    "33-phase-time-runtime.ts",
    "34-cross-tab-ownership.ts",
    "40-application-services.ts",
    "41-backup-codec.ts",
    "42-backup-controller.ts",
    "45-ui-runtime.ts",
    "46-workflow-form-adapter.ts",
    "47-active-retrieval-workspace.ts",
    "48-settings-workspace.ts",
    "50-ui-controller.ts",
    "55-extension-runtime.ts",
    "60-public-bridge-bootstrap.ts",
]

checks: list[tuple[str, bool]] = []
def check(name: str, condition: bool) -> None:
    checks.append((name, condition))
    if not condition:
        raise AssertionError(name)

manifest = json.loads(MANIFEST_PATH.read_text())
parts = sorted(manifest.get("parts", []), key=lambda item: item.get("order", -1))
paths = [SOURCE / item["path"] for item in parts]
texts = [path.read_text() for path in paths]
assembled = "".join(texts)

check("manifest schema", manifest.get("schemaVersion") == 1)
check("manifest runtime assembly", manifest.get("runtime") == {
    "assembly": "manifest-ordered-emitted-js",
    "boundary": "build-owned-iife",
    "output": "../dist/app.js",
} and "entrypoint" not in manifest)
check("owned source parts", len(parts) == len(EXPECTED_NAMES))
check("contiguous order", [item.get("order") for item in parts] == list(range(len(EXPECTED_NAMES))))
check("expected ownership names", [path.name for path in paths] == EXPECTED_NAMES)
check("all source parts exist", all(path.is_file() for path in paths))
check("all source parts are under source/app", all(path.parent == SOURCE / "app" for path in paths))
check("all source parts have layer descriptions", all(isinstance(item.get("layer"), str) and item["layer"].strip() for item in parts))
check("legacy monolith absent", not (SOURCE / "revision-director.va7.ts").exists())
check("source owns no IIFE opening", not texts[0].lstrip().startswith("(() => {"))
check("source owns no IIFE closure", not texts[-1].rstrip().endswith("})();"))
check("bootstrap remains explicit", texts[-1].rstrip().endswith("void boot();"))
check("no source modules", all(not re.search(r"^\s*(?:import|export)(?:\s|\{)", text, re.M) for text in texts))
text_by_name = {path.name: text for path, text in zip(paths, texts)}
check("runtime boundary owned", "EXACT ts-fsrs 6.0.0 / FSRS-7 CONTRACT" in text_by_name["00-runtime-boundary.ts"])
check("presentation engine owned", "interface PresentationManifest" in text_by_name["05-presentation-engine.ts"] and "function installPresentationKernel" in text_by_name["05-presentation-engine.ts"])
check("domain model owned", "interface ExamProfile" in text_by_name["10-domain-model.ts"] and "interface BackupPayload" in text_by_name["10-domain-model.ts"])
check("production contracts owned", "function canonicalDocument" in text_by_name["12-production-contracts.ts"] and "function canonicalAppMetadata" in text_by_name["12-production-contracts.ts"])
check("personalization boundary owned", "function validateFsrsOptimizerProfile" in text_by_name["18-fsrs-personalization.ts"] and "function fsrsOptimizerCsv" in text_by_name["18-fsrs-personalization.ts"])
check("browser optimizer boundary owned", "class FsrsOptimizerRejectedError" in text_by_name["18a-fsrs-browser-optimizer.ts"] and "function startBrowserFsrsOptimizer" in text_by_name["18a-fsrs-browser-optimizer.ts"])
check("scheduler port owned", "interface RevisionSchedulerPort" in text_by_name["19-revision-scheduler-port.ts"] and "class TsFsrsSchedulerPort" in text_by_name["19-revision-scheduler-port.ts"] and "class Reschedule" in text_by_name["19-revision-scheduler-port.ts"])
check("policy planning owned", "interface SchedulerPolicy" in text_by_name["20-policy-planning-kernel.ts"] and "function choosePlanItems" in text_by_name["20-policy-planning-kernel.ts"])
check("backup validation owned", "function validateBackupPayload" in text_by_name["22-backup-validation.ts"] and "this." not in text_by_name["22-backup-validation.ts"])
check("evidence transition owned", "function applyPrimaryEvidenceTransition" in text_by_name["23-evidence-transition.ts"] and "function buildEvidenceEvent" in text_by_name["23-evidence-transition.ts"] and "this." not in text_by_name["23-evidence-transition.ts"])
check("repository owned", "const Store = Object.freeze" in text_by_name["30-indexeddb-repository.ts"] and "class IndexedDbRepository" in text_by_name["30-indexeddb-repository.ts"])
check("storage facade owned", "class AppDiagnostics" in text_by_name["31-storage-facade.ts"] and "class RevisionData" in text_by_name["31-storage-facade.ts"])
check("active retrieval persistence owned", "class ActiveRetrievalPersistence" in text_by_name["32-active-retrieval-persistence.ts"])
check("phase-time runtime owned", "class PhaseTimeRuntime" in text_by_name["33-phase-time-runtime.ts"] and "function timingEvidenceSummary" in text_by_name["33-phase-time-runtime.ts"])
check("cross-tab ownership owned", "class ReviewOwnershipCoordinator" in text_by_name["34-cross-tab-ownership.ts"] and "takeControl" in text_by_name["34-cross-tab-ownership.ts"])
check("application service owned", "class RevisionService" in text_by_name["40-application-services.ts"])
check("backup codec owned", "class BackupCodec" in text_by_name["41-backup-codec.ts"] and "BACKUP_ARCHIVE_FORMAT" in text_by_name["41-backup-codec.ts"])
check("backup controller owned", "class BackupController" in text_by_name["42-backup-controller.ts"] and "BackupSafetyProofRecord" in text_by_name["42-backup-controller.ts"])
check("extension runtime owned", "class ExtensionRuntime" in text_by_name["55-extension-runtime.ts"] and "REVISION_DIRECTOR_CAPABILITIES" in text_by_name["55-extension-runtime.ts"] and "loadLocalFiles" in text_by_name["55-extension-runtime.ts"])
check("UI runtime owned", "class RenderCoordinator" in text_by_name["45-ui-runtime.ts"] and "class AriaTabRegistry" in text_by_name["45-ui-runtime.ts"] and "class OverlayFocusManager" in text_by_name["45-ui-runtime.ts"])
check("workflow form adapter owned", "function workflowSpecFromForm" in text_by_name["46-workflow-form-adapter.ts"] and "function populateWorkflowForm" in text_by_name["46-workflow-form-adapter.ts"])
check("active retrieval workspace owned", "class ActiveRetrievalWorkspace" in text_by_name["47-active-retrieval-workspace.ts"] and "async render()" in text_by_name["47-active-retrieval-workspace.ts"] and "async flushForOwnershipRelease()" in text_by_name["47-active-retrieval-workspace.ts"])
check("settings workspace owned", "class SettingsWorkspace" in text_by_name["48-settings-workspace.ts"] and "async render()" in text_by_name["48-settings-workspace.ts"] and "async handleAction" in text_by_name["48-settings-workspace.ts"])
check("domain kernel owns no DOM forms", all(token not in text_by_name["11-domain-kernel.ts"] for token in ["FormData", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "innerHTML"]))
check("UI owned", "class UIController" in text_by_name["50-ui-controller.ts"])
check("UI shell does not own active retrieval state", all(token not in text_by_name["50-ui-controller.ts"] for token in ["private activeReviewIds", "private reviewPhase", "private phaseTime", "private reviewDrafts", "private commitInFlight"]))
check("public bootstrap owned", "async function boot" in text_by_name["60-public-bridge-bootstrap.ts"] and "installPublicApi" in text_by_name["60-public-bridge-bootstrap.ts"] and "announceReady" in text_by_name["60-public-bridge-bootstrap.ts"])

subprocess.run([sys.executable, str(ROOT / "build/build.py")], check=True)
check("compiled runtime present", (ROOT / "dist/app.js").is_file() and (ROOT / "dist/app.js").stat().st_size > 0)
check("deployable HTML present", (ROOT / "index.html").is_file() and (ROOT / "index.html").stat().st_size > 0)
check("generated composite removed", not (ROOT / "build/generated/revision-director.combined.ts").exists())
check("ephemeral compiler output removed", not (ROOT / "build/generated-js").exists())
tsconfig = json.loads((SOURCE / "tsconfig.json").read_text())
compiler = tsconfig.get("compilerOptions", {})
check("strict compile target retained", compiler.get("strict") is True and compiler.get("noEmitOnError") is True)
check("TypeScript 7 real-source compile retained", tsconfig.get("include") == ["app/*.ts"] and compiler.get("module") == "preserve" and compiler.get("moduleDetection") == "legacy" and compiler.get("rootDir") == "." and compiler.get("outDir") == "../build/generated-js")

print(f"PASS {len(checks)} source-ownership checks")
