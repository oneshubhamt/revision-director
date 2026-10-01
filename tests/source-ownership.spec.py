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
    "20-policy-planning-kernel.ts",
    "21-policy-implementations.ts",
    "30-indexeddb-repository.ts",
    "31-storage-facade.ts",
    "32-active-retrieval-persistence.ts",
    "33-phase-time-runtime.ts",
    "34-cross-tab-ownership.ts",
    "40-application-services.ts",
    "41-backup-codec.ts",
    "42-backup-controller.ts",
    "55-extension-runtime.ts",
    "45-ui-runtime.ts",
    "50-ui-controller.ts",
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
check("manifest entrypoint", manifest.get("entrypoint") == "generated/revision-director.combined.ts")
check("nineteen ownership parts", len(parts) == 19)
check("contiguous order", [item.get("order") for item in parts] == list(range(19)))
check("expected ownership names", [path.name for path in paths] == EXPECTED_NAMES)
check("all source parts exist", all(path.is_file() for path in paths))
check("all source parts are under source/app", all(path.parent == SOURCE / "app" for path in paths))
check("all source parts have layer descriptions", all(isinstance(item.get("layer"), str) and item["layer"].strip() for item in parts))
check("legacy monolith absent", not (SOURCE / "revision-director.va7.ts").exists())
check("sealed IIFE opening", assembled.lstrip().startswith('(() => {\n  "use strict";'))
check("sealed IIFE closure", assembled.rstrip().endswith("void boot();\n})();"))
check("no source modules", all(not re.search(r"^\s*(?:import|export)(?:\s|\{)", text, re.M) for text in texts))
check("runtime boundary owned", "EXACT ts-fsrs 5.4.1 UMD CONTRACT" in texts[0])
check("presentation engine owned", "interface PresentationManifest" in texts[1] and "function installPresentationKernel" in texts[1])
check("domain model owned", "interface ExamProfile" in texts[2] and "interface BackupPayload" in texts[2])
check("production contracts owned", "function canonicalDocument" in texts[4] and "function canonicalAppMetadata" in texts[4])
check("policy planning owned", "interface SchedulerPolicy" in texts[5] and "function choosePlanItems" in texts[5])
check("repository owned", "const Store = Object.freeze" in texts[7] and "class IndexedDbRepository" in texts[7])
check("storage facade owned", "class AppDiagnostics" in texts[8] and "class RevisionData" in texts[8])
check("active retrieval persistence owned", "class ActiveRetrievalPersistence" in texts[9])
check("phase-time runtime owned", "class PhaseTimeRuntime" in texts[10] and "function timingEvidenceSummary" in texts[10])
check("cross-tab ownership owned", "class ReviewOwnershipCoordinator" in texts[11] and "takeControl" in texts[11])
check("application service owned", "class RevisionService" in texts[12])
check("backup codec owned", "class BackupCodec" in texts[13] and "BACKUP_ARCHIVE_FORMAT" in texts[13])
check("backup controller owned", "class BackupController" in texts[14] and "BackupSafetyProofRecord" in texts[14])
check("extension runtime owned", "class ExtensionRuntime" in texts[15] and "REVISION_DIRECTOR_CAPABILITIES" in texts[15] and "loadLocalFiles" in texts[15])
check("UI runtime owned", "class RenderCoordinator" in texts[16] and "class AriaTabRegistry" in texts[16] and "class OverlayFocusManager" in texts[16])
check("UI owned", "class UIController" in texts[17])
check("public bootstrap owned", "async function boot" in texts[18] and "installPublicApi" in texts[18] and "announceReady" in texts[18])

subprocess.run([sys.executable, str(ROOT / "build/build.py")], check=True)
check("compiled runtime present", (ROOT / "dist/app.js").is_file() and (ROOT / "dist/app.js").stat().st_size > 0)
check("deployable HTML present", (ROOT / "index.html").is_file() and (ROOT / "index.html").stat().st_size > 0)
check("generated composite removed", not (ROOT / "build/generated/revision-director.combined.ts").exists())
check("strict compile target retained", '"strict": true' in (SOURCE / "tsconfig.json").read_text())
check("single compiled outFile retained", '"outFile": "../dist/app.js"' in (SOURCE / "tsconfig.json").read_text())

print(f"PASS {len(checks)} source-ownership checks")
