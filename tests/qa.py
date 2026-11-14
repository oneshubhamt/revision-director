from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
import os
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"

STATIC_PYTHON = (
    "tests/build-integrity.spec.py",
    "tests/html-sanity.spec.py",
)

CORE_NODE_PLAN = (
    "tests/scenarios/public-plugin-runtime.js",
    "tests/fsrs-contract-parity.spec.js",
    "tests/fsrs-reference-parity.spec.js",
    "tests/fsrs-integration.spec.js",
    "tests/fsrs-optimizer-core.spec.js",
    "tests/fsrs-optimizer-policy.spec.js",
    "tests/fsrs-programme-closure.spec.js",
    "tests/fsrs-scale-benchmark.spec.js",
    "tests/kernel-policy.spec.js",
    "tests/scenarios/adaptive-planning.js",
    "tests/scenarios/planning-persistence-validation.js",
    "tests/scenarios/backup-codec.js",
    "tests/scenarios/backup-controller.js",
    "tests/scenarios/data-safety-controller.js",
    "tests/planning.spec.js",
    "tests/planner-properties.spec.js",
    "tests/runtime-harness-ownership.spec.js",
    "tests/scenarios/production-contracts-storage.js",
    "tests/scenarios/active-retrieval-persistence.js",
    "tests/scenarios/phase-time-runtime.js",
    "tests/scenarios/ownership-storage-health.js",
    "tests/scenarios/reliability-closure.js",
    "tests/scenarios/presentation-kernel.js",
)

BROWSER_PLAN = (
    "tests/scenarios/backup-codec.py",
    "tests/scenarios/backup-restore-controller.py",
    "tests/scenarios/data-safety.py",
    "tests/scenarios/restore-dialog-accessibility.py",
    "tests/scenarios/public-plugin-runtime.py",
    "tests/browser-qa.spec.py",
    "tests/scenarios/persistent-active-retrieval.py",
    "tests/scenarios/ownership-storage-health.py",
    "tests/scenarios/hostile-recovery.py",
    "tests/scenarios/indexeddb-durability.py",
    "tests/scenarios/native-indexeddb-journey.py",
    "tests/scenarios/presentation-kernel.py",
    "tests/scenarios/ui-runtime-accessibility.py",
    "tests/scenarios/ui-behaviour.py",
    "tests/scenarios/responsive-layout.py",
    "tests/canonical-topology-browser.spec.py",
    "tests/fsrs-browser-optimizer.spec.py",
    "tests/fsrs-programme-closure-browser.spec.py",
    "tests/full-qa-supplement.spec.py",
)

DEEP_NODE_PLAN = (
    "tests/fsrs-scheduling-experiments.spec.js",
)

PERFORMANCE_BROWSER_PLAN = (
    "tests/scenarios/planning-large-dataset.py",
)

REMOVED_WRAPPERS = (
    "browser-data-safety.spec.py",
    "browser-extensions.spec.py",
    "browser-recovery.spec.py",
    "browser-ui.spec.py",
    "extensions-and-public-api.spec.js",
    "planning-and-data-safety.spec.js",
    "storage-and-recovery.spec.js",
    "ui-and-presentation.spec.js",
)


def run(*command: str) -> None:
    print("==>", " ".join(command), flush=True)
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(TESTS) + (os.pathsep + existing if existing else "")
    subprocess.run(command, cwd=ROOT, env=env, check=True)



@contextmanager
def shared_chromium():
    executable = os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    if not executable:
        raise AssertionError("Chromium executable is required for browser QA.")
    with TemporaryDirectory(prefix="revision-director-browser-", ignore_cleanup_errors=True) as user_data_dir:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        endpoint = f"http://127.0.0.1:{port}"
        process = subprocess.Popen(
            [
                executable,
                "--headless=new",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--no-first-run",
                "--no-default-browser-check",
                "--remote-debugging-address=127.0.0.1",
                f"--remote-debugging-port={port}",
                f"--user-data-dir={user_data_dir}",
                "about:blank",
            ],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError("Shared Chromium exited before the CDP endpoint became ready.")
                try:
                    with urlopen(endpoint + "/json/version", timeout=0.4):
                        break
                except Exception:
                    time.sleep(0.05)
            else:
                raise AssertionError("Timed out waiting for shared Chromium CDP endpoint.")
            previous = os.environ.get("REVISION_DIRECTOR_CDP_ENDPOINT")
            os.environ["REVISION_DIRECTOR_CDP_ENDPOINT"] = endpoint
            try:
                yield
            finally:
                if previous is None:
                    os.environ.pop("REVISION_DIRECTOR_CDP_ENDPOINT", None)
                else:
                    os.environ["REVISION_DIRECTOR_CDP_ENDPOINT"] = previous
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

def assert_test_topology() -> None:
    historical = [*TESTS.glob("pass-*"), *TESTS.glob("stage-*")]
    stale_wrappers = [TESTS / name for name in REMOVED_WRAPPERS if (TESTS / name).exists()]
    stale_helper = TESTS / "helpers/suite-runner.js"
    stale = sorted([*historical, *stale_wrappers, *([stale_helper] if stale_helper.exists() else [])], key=lambda path: path.name)
    if stale:
        raise AssertionError("Obsolete QA entrypoints remain: " + ", ".join(path.name for path in stale))


def core() -> None:
    assert_test_topology()
    run(sys.executable, "build/build.py")
    run(sys.executable, "build/checksums.py", "--check")
    run("node", "--check", "dist/app.js")
    for path in STATIC_PYTHON:
        run(sys.executable, path)
    for path in CORE_NODE_PLAN:
        run("node", path)


def optimizer() -> None:
    run("npm", "run", "--prefix", "tools/fsrs-optimizer", "smoke")


def durability() -> None:
    run(sys.executable, "tests/scenarios/phase-time-runtime.py")


def browser() -> None:
    assert_test_topology()
    with shared_chromium():
        for path in BROWSER_PLAN:
            run(sys.executable, path)


def performance() -> None:
    assert_test_topology()
    for path in PERFORMANCE_BROWSER_PLAN:
        run(sys.executable, path)


def deep() -> None:
    assert_test_topology()
    run(sys.executable, "tools/qa-mutation-probes.py")  # Pass E diagnostic; remove after independent verification.
    for path in DEEP_NODE_PLAN:
        run("node", path)
    run(sys.executable, "tests/fsrs-browser-optimizer.spec.py", "full")


def full() -> None:
    core()
    optimizer()
    durability()
    browser()
    performance()
    deep()


COMMANDS = {
    "core": core,
    "optimizer": optimizer,
    "durability": durability,
    "browser": browser,
    "performance": performance,
    "deep": deep,
    "full": full,
}

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) == 2 else ""
    action = COMMANDS.get(command)
    if action is None:
        raise SystemExit("Usage: python3 tests/qa.py {core|optimizer|durability|browser|performance|deep|full}")
    action()
