#!/usr/bin/env python3
"""One-shot P0 mutation audit for final QA closure. Delete after evidence is recorded."""
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

PROBES = (
    (
        "planner objective inversion",
        ("node", "tests/planner-properties.spec.js"),
        "dist/app.js",
        "if (candidateValue > dp[used]) {",
        "if (candidateValue < dp[used]) {",
        ("Exact-capacity work should fit", "critical objective differs", "normal objective differs"),
    ),
    (
        "recovery precedence inversion",
        ("node", "tests/scenarios/active-retrieval-persistence.js"),
        "dist/app.js",
        "return a.revision > b.revision ? a : b;",
        "return a.revision < b.revision ? a : b;",
        ("Seeded recovery precedence mismatch", "Newest local recovery copy did not win"),
    ),
    (
        "backup checksum bypass",
        ("node", "tests/scenarios/backup-codec.js"),
        "dist/app.js",
        'assert(completion.checksum === expectedCompletion, "Backup final checksum failed verification.");',
        'assert(true, "Backup final checksum failed verification.");',
        ("Final checksum tampering accepted",),
    ),
    (
        "transaction fencing bypass",
        (sys.executable, "tests/scenarios/hostile-recovery.py"),
        "index.html",
        "if (!matches) {\n                  tx.abort();",
        "if (false && !matches) {\n                  tx.abort();",
        (
            "Guard mismatch wrote Evidence despite transaction abort",
            "Guard mismatch advanced scheduler state despite transaction abort",
            "Timed out waiting for hostile-recovery condition",
        ),
    ),
    (
        "duplicate evidence publication",
        (sys.executable, "tests/scenarios/persistent-active-retrieval.py"),
        "index.html",
        "tx.objectStore(Store.EvidenceEvents).add(event);",
        "tx.objectStore(Store.EvidenceEvents).add(event);\n"
        "              tx.objectStore(Store.EvidenceEvents).add({ ...event, id: event.id + '-duplicated' });",
        ("Double rating created duplicate evidence", "Timed out waiting for condition"),
    ),
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


def probe_mutation(probe, temporary: Path) -> None:
    label, command, target, before, after, diagnostics = probe

    clean = execute(command)
    if clean.returncode:
        raise AssertionError(
            f"Clean control failed: {label}:\n{(clean.stdout + clean.stderr)[-2500:]}"
        )

    path = ROOT / target
    source = path.read_text()
    count = source.count(before)
    if count != 1:
        raise AssertionError(f"{label}: mutation anchor count {count}, expected one")

    mutant = temporary / ("mutated-" + target.replace("/", "-"))
    mutant.write_text(source.replace(before, after, 1))

    env = os.environ.copy()
    env.update(
        RD_MUTATION_TARGET=str(path),
        RD_MUTATION_REPLACEMENT=str(mutant),
    )

    if command[0] == "node":
        preload = temporary / "node-preload.cjs"
        preload.write_text(NODE_PRELOAD)
        env["NODE_OPTIONS"] = (
            env.get("NODE_OPTIONS", "") + f" --require={preload}"
        ).strip()
    else:
        (temporary / "sitecustomize.py").write_text(PYTHON_PRELOAD)
        env["PYTHONPATH"] = (
            str(temporary)
            + os.pathsep
            + str(ROOT / "tests")
            + os.pathsep
            + env.get("PYTHONPATH", "")
        )

    broken = execute(command, env)
    output = broken.stdout + broken.stderr
    if broken.returncode == 0:
        raise AssertionError(f"Mutation survived intended witness: {label}")
    if not any(marker in output for marker in diagnostics):
        raise AssertionError(
            f"Mutation failed for an unexpected reason: {label}, exit={broken.returncode}:\n"
            f"{output[-3000:]}"
        )

    print(f"MUTATION CAUGHT: {label} -> {command[-1]}", flush=True)


def main() -> None:
    with TemporaryDirectory(prefix="revision-director-p0-mutations-") as name:
        temporary = Path(name)
        for probe in PROBES:
            probe_mutation(probe, temporary)
    print(f"PASS {len(PROBES)} P0 mutation challenges", flush=True)


if __name__ == "__main__":
    main()
