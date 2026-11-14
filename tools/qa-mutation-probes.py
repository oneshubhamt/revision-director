#!/usr/bin/env python3
"""Opt-in mutation audit: substitute corrupted runtime bytes in child tests, never in tracked files."""
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

# Test-to-defect mapping is intentional. This is a diagnostic, not a permanent
# source-text assertion: update its anchors when the production implementation moves.
PROBES = (
    ("planner objective comparison", ("node", "tests/planner-properties.spec.js"),
     "dist/app.js", "if (candidateValue > dp[used]) {",
     "if (candidateValue < dp[used]) {",
     ("Exact-capacity work should fit", "critical objective differs", "normal objective differs")),
    ("stale revision recovery precedence", ("node", "tests/scenarios/active-retrieval-persistence.js"),
     "dist/app.js", "return a.revision > b.revision ? a : b;",
     "return a.revision < b.revision ? a : b;",
     ("Seeded recovery precedence mismatch", "Newest local recovery copy did not win")),
    ("backup completion checksum", ("node", "tests/scenarios/backup-codec.js"),
     "dist/app.js",
     'assert(completion.checksum === expectedCompletion, "Backup final checksum failed verification.");',
     'assert(true, "Backup final checksum failed verification.");',
     ("Final checksum tampering accepted",)),
    ("IndexedDB commit-token transaction guard", (sys.executable, "tests/scenarios/hostile-recovery.py"),
     "index.html", "if (!matches) {\n                  tx.abort();",
     "if (false && !matches) {\n                  tx.abort();",
     ("Timed out waiting for hostile-recovery condition", "Guard mismatch wrote Evidence despite transaction abort",
      "Guard mismatch advanced scheduler state despite transaction abort")),
    ("duplicate evidence publication", (sys.executable, "tests/scenarios/persistent-active-retrieval.py"),
     "index.html", "tx.objectStore(Store.EvidenceEvents).add(event);",
     "tx.objectStore(Store.EvidenceEvents).add(event);\n              tx.objectStore(Store.EvidenceEvents).add({ ...event, id: event.id + '-duplicated' });",
     ("Double rating created duplicate evidence", "Atomic commit did not persist",
      'wait_until(frame, lambda: len(state_all(page, "evidenceEvents")) == before + 1)')),
)

NODE_PRELOAD = """'use strict';
const fs=require('node:fs'), path=require('node:path');
const original=fs.readFileSync, target=path.resolve(process.env.RD_MUTATION_TARGET);
fs.readFileSync=function(file,...args){
  if(typeof file==='string' && path.resolve(file)===target)
    return original.call(this,process.env.RD_MUTATION_REPLACEMENT,...args);
  return original.call(this,file,...args);
};
"""

PYTHON_PRELOAD = """from pathlib import Path
import os
_original=Path.read_text

def read_text(self,*args,**kwargs):
    if self.resolve() == Path(os.environ['RD_MUTATION_TARGET']).resolve():
        return _original(Path(os.environ['RD_MUTATION_REPLACEMENT']),*args,**kwargs)
    return _original(self,*args,**kwargs)

Path.read_text=read_text
"""


def execute(command, env=None):
    return subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, check=False)


def probe_mutation(probe, temporary):
    label, command, target, before, after, diagnostics = probe
    original_test = execute(command)
    if original_test.returncode:
        raise AssertionError(f"Clean control failed: {label}:\n{(original_test.stdout + original_test.stderr)[-1800:]}")
    path = ROOT / target
    source = path.read_text()
    count = source.count(before)
    if count != 1:
        raise AssertionError(f"{label}: mutation anchor count {count}, expected one")
    mutant = temporary / ("mutated-" + target.replace("/", "-"))
    mutant.write_text(source.replace(before, after, 1))
    env = os.environ.copy()
    env.update(RD_MUTATION_TARGET=str(path), RD_MUTATION_REPLACEMENT=str(mutant))
    if command[0] == "node":
        preload = temporary / "node-preload.cjs"
        preload.write_text(NODE_PRELOAD)
        env["NODE_OPTIONS"] = (env.get("NODE_OPTIONS", "") + f" --require={preload}").strip()
    else:
        (temporary / "sitecustomize.py").write_text(PYTHON_PRELOAD)
        env["PYTHONPATH"] = str(temporary) + os.pathsep + str(ROOT / "tests") + os.pathsep + env.get("PYTHONPATH", "")
    broken = execute(command, env)
    output = broken.stdout + broken.stderr
    if broken.returncode == 0 or not any(marker in output for marker in diagnostics):
        raise AssertionError(f"Mutation not demonstrably detected: {label}, exit={broken.returncode}:\n{output[-2500:]}")
    print(f"MUTATION CAUGHT: {label} ({command[-1]})", flush=True)


def probe_manifest(temporary):
    manifest = (ROOT / "CHECKSUMS.sha256").read_text()
    sandbox = temporary / "manifest-sandbox"
    (sandbox / "build").mkdir(parents=True)
    shutil.copy2(ROOT / "build/checksums.py", sandbox / "build/checksums.py")
    (sandbox / "CHECKSUMS.sha256").write_text(manifest)
    for line in manifest.splitlines():
        if not line:
            continue
        relative = line.split("  ./", 1)[1]
        destination = sandbox / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
    command = (sys.executable, str(sandbox / "build/checksums.py"), "--check")
    clean = execute(command)
    if clean.returncode:
        raise AssertionError("Clean release checksum control failed: " + (clean.stdout + clean.stderr)[-1000:])
    with (sandbox / "dist/app.js").open("ab") as output:
        output.write(b"\n// simulated release corruption\n")
    broken = execute(command)
    if broken.returncode == 0 or "Tracked checksums are stale." not in broken.stdout + broken.stderr:
        raise AssertionError("Release manifest failed to detect tampering")
    print("MUTATION CAUGHT: release checksum verification", flush=True)


def main():
    with TemporaryDirectory(prefix="revision-director-mutations-") as name:
        temporary = Path(name)
        for probe in PROBES:
            probe_mutation(probe, temporary)
        probe_manifest(temporary)
    print(f"PASS {len(PROBES) + 1} isolated mutation challenges (clean controls + mutant detection)", flush=True)


if __name__ == "__main__":
    main()
