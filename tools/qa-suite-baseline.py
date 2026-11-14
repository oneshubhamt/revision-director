#!/usr/bin/env python3
"""Opt-in per-entry QA profiler. Does not modify production files or CI workflows."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
import qa  # noqa: E402 - use the repository's canonical entrypoint manifest

GROUPS = ("core", "optimizer", "timing", "browser", "performance", "deep", "mutations")


def git(*args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    return proc.stdout.strip() if proc.returncode == 0 else "unavailable"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--groups", nargs="+", choices=GROUPS, default=["core", "browser"],
                        help="Execute each selected layer once, in the listed order")
    parser.add_argument("--repeat", type=int, default=1, help="1-10 samples per entrypoint")
    parser.add_argument("--timeout-seconds", type=int, default=300,
                        help="Maximum seconds per child process")
    parser.add_argument("--output", type=Path,
                        default=Path(tempfile.gettempdir()) / "revision-director-qa-baseline.json")
    args = parser.parse_args()
    if not 1 <= args.repeat <= 10:
        parser.error("--repeat must be between 1 and 10")
    if len(args.groups) != len(set(args.groups)):
        parser.error("--groups contains duplicates")
    if args.timeout_seconds < 1:
        parser.error("--timeout-seconds must be positive")
    output = args.output.expanduser().resolve()
    if ROOT in output.parents or output == ROOT:
        parser.error("Place profiling output outside the tracked repository")

    log_dir = output.with_suffix("")
    log_dir = log_dir.with_name(log_dir.name + "-logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    qa.assert_test_topology()
    declared = set((*qa.STATIC_PYTHON, *qa.CORE_NODE_PLAN, *qa.BROWSER_PLAN,
                    *qa.DEEP_NODE_PLAN, *qa.PERFORMANCE_BROWSER_PLAN,
                    "tests/scenarios/phase-time-runtime.py"))
    discovered = {
        path.relative_to(ROOT).as_posix()
        for base in (ROOT / "tests", ROOT / "tests/scenarios")
        for path in base.iterdir()
        if path.is_file() and (
            path.name.endswith((".spec.js", ".spec.py")) or base.name == "scenarios"
            and path.suffix in (".js", ".py")
        )
    }
    if discovered != declared:
        raise SystemExit(f"QA manifest drift: unlisted={sorted(discovered - declared)}, missing={sorted(declared - discovered)}")
    data = {
        "schema": "revision-director.qa-baseline/v1",
        "inventory": {"testFiles": len(discovered), "smokeEntry": "tools/fsrs-optimizer npm smoke"},
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "commit": git("rev-parse", "HEAD"),
        "branch": git("branch", "--show-current"),
        "dirty": bool(git("status", "--porcelain")),
        "host": {"platform": platform.platform(), "python": platform.python_version(),
                 "node": subprocess.run(["node", "--version"], capture_output=True, text=True,
                                        check=False).stdout.strip()},
        "selectedGroups": args.groups,
        "repeat": args.repeat,
        "samples": [],
        "setups": [],
    }
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT / "tests") + (
        os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else ""
    )
    failed = False

    def save() -> None:
        staging = output.with_suffix(output.suffix + ".tmp")
        staging.write_text(json.dumps(data, indent=2) + "\n")
        staging.replace(output)

    def run(group: str, label: str, command: list[str], iteration: int) -> None:
        nonlocal failed
        start = time.perf_counter()
        try:
            # shared_chromium sets this only while the browser group is running.
            child_env = env.copy()
            endpoint = os.environ.get("REVISION_DIRECTOR_CDP_ENDPOINT")
            if endpoint:
                child_env["REVISION_DIRECTOR_CDP_ENDPOINT"] = endpoint
            proc = subprocess.run(command, cwd=ROOT, env=child_env,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, errors="replace", check=False,
                                  timeout=args.timeout_seconds)
            code, log = proc.returncode, proc.stdout
        except subprocess.TimeoutExpired as exc:
            code = 124
            log = (exc.stdout or b"").decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            log += f"\nTimed out after {args.timeout_seconds}s"
        except OSError as exc:
            code, log = 127, str(exc)
        seconds = round(time.perf_counter() - start, 3)
        filename = f"{len(data['samples']):03d}-{group}-{Path(label).name}.log"
        (log_dir / filename).write_text(log)
        row = {"group": group, "entry": label, "iteration": iteration,
               "command": command, "wallSeconds": seconds, "exitCode": code,
               "log": str(log_dir / filename)}
        data["samples"].append(row)
        failed |= code != 0
        save()
        print(f"{'PASS' if code == 0 else 'FAIL'} {seconds:.3f}s [{group}] {label}", flush=True)
        if code:
            print("\n".join(log.splitlines()[-15:]), flush=True)

    try:
        for iteration in range(1, args.repeat + 1):
            for group in args.groups:
                if group in ("browser", "deep"):
                    begin_setup = time.perf_counter()
                    qa.prepare_hosted_optimizer()
                    data["setups"].append({
                        "group": group, "iteration": iteration,
                        "step": "prepare-hosted-optimizer",
                        "wallSeconds": round(time.perf_counter() - begin_setup, 3),
                    })
                    save()
                if group == "core":
                    for label, cmd in [
                        ("build", [sys.executable, "build/build.py"]),
                        ("checksums", [sys.executable, "build/checksums.py", "--check"]),
                        ("javascript-syntax", ["node", "--check", "dist/app.js"]),
                    ]:
                        run(group, label, cmd, iteration)
                    for entry in qa.STATIC_PYTHON:
                        run(group, entry, [sys.executable, entry], iteration)
                    for entry in qa.CORE_NODE_PLAN:
                        run(group, entry, ["node", entry], iteration)
                elif group == "optimizer":
                    run(group, "native-optimizer-smoke",
                        ["npm", "run", "--prefix", "tools/fsrs-optimizer", "smoke"], iteration)
                elif group == "timing":
                    run(group, "tests/scenarios/phase-time-runtime.py",
                        [sys.executable, "tests/scenarios/phase-time-runtime.py"], iteration)
                elif group == "browser":
                    # Preserve the normal suite's shared-CDP Chromium lifecycle.
                    with qa.shared_chromium():
                        for entry in qa.BROWSER_PLAN:
                            run(group, entry, [sys.executable, entry], iteration)
                elif group == "performance":
                    for entry in qa.PERFORMANCE_BROWSER_PLAN:
                        run(group, entry, [sys.executable, entry], iteration)
                elif group == "deep":
                    for entry in qa.DEEP_NODE_PLAN:
                        run(group, entry, ["node", entry], iteration)
                    run(group, "browser-optimizer-full",
                        [sys.executable, "tests/fsrs-browser-optimizer.spec.py", "full"], iteration)
                elif group == "mutations":
                    run(group, "mutation-challenges",
                        [sys.executable, "tools/qa-mutation-probes.py"], iteration)
    except Exception as exc:
        failed = True
        data["setupFailure"] = f"{type(exc).__name__}: {exc}"
        print(f"FAIL setup: {data['setupFailure']}", file=sys.stderr)
    finally:
        data["completedAt"] = datetime.now(timezone.utc).isoformat()
        data["passed"] = not failed
        save()
        print(f"Baseline: {output} ({len(data['samples'])} entries)", flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
