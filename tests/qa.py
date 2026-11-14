from __future__ import annotations

from contextlib import contextmanager, nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
OPTIMIZER_WASM = ROOT / "tools/fsrs-optimizer/node_modules/@open-spaced-repetition/binding-wasm32-wasip1/fsrs-binding.wasm32-wasip1.wasm"
_HOSTED_PREPARED = False

STATIC_PYTHON = (
    "tests/build-integrity.spec.py",
    "tests/html-sanity.spec.py",
    "tests/qa-runner.spec.py",
)

CORE_DOMAIN_PLAN = {
    # Primary owners grouped by product risk; do not duplicate a test entrypoint.
    "public-api-and-architecture": (
        "tests/scenarios/public-plugin-runtime.js",
        "tests/runtime-harness-ownership.spec.js",
    ),
    "fsrs-scheduler-and-optimizer": (
        "tests/fsrs-optimizer-contract.spec.js",
        "tests/fsrs-scheduler-reference.spec.js",
        "tests/fsrs-scheduler-integration.spec.js",
        "tests/fsrs-optimizer.spec.js",
        "tests/fsrs-memory-lifecycle.spec.js",
        "tests/fsrs-scale.spec.js",
    ),
    "planner": (
        "tests/planner-policy.spec.js",
        "tests/planner-properties.spec.js",
        "tests/planner-persistence.spec.js",
    ),
    "backup-and-data-safety": (
        "tests/scenarios/backup-codec.js",
        "tests/scenarios/backup-controller.js",
        "tests/scenarios/data-safety-controller.js",
    ),
    "domain-policy": (
        "tests/kernel-policy.spec.js",
    ),
    "persistence-recovery-and-time": (
        "tests/scenarios/production-contracts-storage.js",
        "tests/scenarios/active-retrieval-persistence.js",
        "tests/scenarios/phase-time-runtime.js",
        "tests/scenarios/ownership-storage-health.js",
        "tests/scenarios/reliability-closure.js",
    ),
    "presentation": (
        "tests/scenarios/presentation-kernel.js",
    ),
}

CORE_NODE_PLAN = tuple(path for group in CORE_DOMAIN_PLAN.values() for path in group)

BROWSER_DOMAIN_PLAN = {
    "backup-and-data-safety": (
        "tests/scenarios/backup-codec.py",
        "tests/scenarios/backup-restore-controller.py",
        "tests/scenarios/data-safety.py",
        "tests/scenarios/restore-dialog-accessibility.py",
    ),
    "public-api-and-plugins": (
        "tests/scenarios/public-plugin-runtime.py",
    ),
    "planner": (
        "tests/scenarios/planner-browser.py",
    ),
    "persistence-and-recovery": (
        "tests/scenarios/persistent-active-retrieval.py",
        "tests/scenarios/ownership-storage-health.py",
        "tests/scenarios/hostile-recovery.py",
        "tests/scenarios/indexeddb-durability.py",
        "tests/scenarios/native-indexeddb-journey.py",
        "tests/canonical-topology-browser.spec.py",
    ),
    "presentation-and-accessibility": (
        "tests/scenarios/presentation-kernel.py",
        "tests/scenarios/ui-runtime-accessibility.py",
        "tests/scenarios/ui-behaviour.py",
        "tests/scenarios/responsive-layout.py",
        "tests/security-rendering-browser.spec.py",
    ),
    "fsrs": (
        "tests/fsrs-browser-integration.spec.py",
        "tests/fsrs-memory-lifecycle-browser.spec.py",
    ),
}

BROWSER_PLAN = tuple(path for group in BROWSER_DOMAIN_PLAN.values() for path in group)

NATIVE_INDEXEDDB_BROWSER_PLAN = (
    "tests/scenarios/indexeddb-durability.py",
    "tests/scenarios/native-indexeddb-journey.py",
)

DURABILITY_BROWSER_PLAN = (
    "tests/scenarios/phase-time-runtime.py",
)

DEEP_NODE_PLAN = (
    "tests/fsrs-scheduling-policy-deep.spec.js",
)

PERFORMANCE_BROWSER_PLAN = (
    "tests/scenarios/planner-performance.py",
)

SIMULATED_STORAGE_BROWSER_PLAN = (
    tuple(path for path in BROWSER_PLAN if path not in NATIVE_INDEXEDDB_BROWSER_PLAN)
    + DURABILITY_BROWSER_PLAN
    + PERFORMANCE_BROWSER_PLAN
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

def assert_python_test_syntax() -> None:
    for path in sorted(TESTS.rglob("*.py")):
        compile(path.read_text(), str(path.relative_to(ROOT)), "exec")


def assert_test_topology() -> None:
    historical = [
        path for path in TESTS.rglob("*")
        if path.is_file()
        and (
            path.name.lower().startswith(("pass-", "stage-"))
            or "programme" in path.name.lower()
            or path.name in {"browser-qa.spec.py", "full-qa-supplement.spec.py"}
        )
    ]
    stale_wrappers = [TESTS / name for name in REMOVED_WRAPPERS if (TESTS / name).exists()]
    stale_helper = TESTS / "helpers/suite-runner.js"
    stale_storage_helper = TESTS / "helpers/persistent_browser.py"
    stale = sorted(
        [
            *historical,
            *stale_wrappers,
            *([stale_helper] if stale_helper.exists() else []),
            *([stale_storage_helper] if stale_storage_helper.exists() else []),
        ],
        key=lambda path: path.name,
    )
    if stale:
        raise AssertionError("Obsolete QA entrypoints remain: " + ", ".join(path.name for path in stale))
    historical_label = re.compile(r"\b(?:Pass|Stage)\s+[A-E](?:\d+)?\b|__RD_(?:PASS|STAGE)_[A-Z0-9_]+|programme(?:-closure)?", re.IGNORECASE)
    historical_sources = []
    for path in sorted((*TESTS.rglob("*.py"), *TESTS.rglob("*.js"))):
        if path.resolve() == Path(__file__).resolve():
            continue
        matches = sorted(set(match.group(0) for match in historical_label.finditer(path.read_text())))
        if matches:
            historical_sources.append(f"{path.relative_to(ROOT)}: {', '.join(matches)}")
    if historical_sources:
        raise AssertionError("Historical QA labels remain: " + "; ".join(historical_sources))

    canonical_storage = (TESTS / "helpers/simulated_storage.py").resolve()
    legacy_storage_tokens = (
        "INDEXEDDB_SHIM",
        "PERSISTENT_BROWSER_SHIM",
        "__RD_PERSISTENT_QA_STATE__",
        "create_persistent_frame",
        "persistent_html",
        "host_state_all",
        "host_state_get",
    )
    duplicate_simulators = []
    legacy_storage_sources = []
    indexeddb_definition = re.compile(r"Object\.defineProperty\(window,\s*['\"]indexedDB['\"]")
    for path in sorted(TESTS.rglob("*.py")):
        source = path.read_text()
        if path.resolve() != canonical_storage and indexeddb_definition.search(source):
            duplicate_simulators.append(str(path.relative_to(ROOT)))
        matches = [token for token in legacy_storage_tokens if token in source]
        if matches:
            legacy_storage_sources.append(f"{path.relative_to(ROOT)}: {', '.join(matches)}")
    if duplicate_simulators:
        raise AssertionError("Duplicate simulated IndexedDB implementations remain: " + ", ".join(duplicate_simulators))
    if legacy_storage_sources:
        raise AssertionError("Legacy simulated-storage APIs remain: " + "; ".join(legacy_storage_sources))

    bypasses = []
    for relative in SIMULATED_STORAGE_BROWSER_PLAN:
        source = (ROOT / relative).read_text()
        if "browser_fixture" not in source and "simulated_storage" not in source:
            bypasses.append(relative)
    if bypasses:
        raise AssertionError("Simulated browser entrypoints bypass canonical storage: " + ", ".join(bypasses))

    native_coupling = []
    for relative in NATIVE_INDEXEDDB_BROWSER_PLAN:
        source = (ROOT / relative).read_text()
        if "browser_fixture" in source or "simulated_storage" in source:
            native_coupling.append(relative)
    if native_coupling:
        raise AssertionError("Native IndexedDB witnesses depend on simulated storage: " + ", ".join(native_coupling))


def core() -> None:
    assert_test_topology()
    assert_python_test_syntax()
    run(sys.executable, "build/build.py")
    run(sys.executable, "build/checksums.py", "--check")
    run("node", "--check", "dist/app.js")
    for path in STATIC_PYTHON:
        run(sys.executable, path)
    for path in CORE_NODE_PLAN:
        run("node", path)


def require_optimizer_dependencies() -> None:
    """QA validates the prepared toolchain; dependency installation belongs to setup."""
    if not OPTIMIZER_WASM.is_file():
        raise AssertionError(
            "FSRS optimizer dependencies are missing. "
            "Run `npm ci --prefix tools/fsrs-optimizer --no-audit --no-fund` before optimizer/browser/deep QA."
        )


def prepare_hosted_optimizer() -> None:
    """Build hosted optimizer assets once from an explicitly prepared toolchain."""
    global _HOSTED_PREPARED
    if _HOSTED_PREPARED:
        return
    require_optimizer_dependencies()
    # The root application is a committed/generated prerequisite; do not rebuild it here.
    run("node", "build/build-hosted.mjs")
    _HOSTED_PREPARED = True


def optimizer() -> None:
    require_optimizer_dependencies()
    run("npm", "run", "--prefix", "tools/fsrs-optimizer", "smoke")


def durability() -> None:
    assert_test_topology()
    for path in DURABILITY_BROWSER_PLAN:
        run(sys.executable, path)


def browser() -> None:
    assert_test_topology()
    prepare_hosted_optimizer()
    # A full run already owns Chromium. Preserve independent subprocesses and
    # browser contexts: each scenario still has isolated storage and JS state.
    context = nullcontext() if os.environ.get("REVISION_DIRECTOR_CDP_ENDPOINT") else shared_chromium()
    with context:
        for path in BROWSER_PLAN:
            run(sys.executable, path)


def performance() -> None:
    assert_test_topology()
    for path in PERFORMANCE_BROWSER_PLAN:
        run(sys.executable, path)


def deep() -> None:
    assert_test_topology()
    require_optimizer_dependencies()
    for path in DEEP_NODE_PLAN:
        run("node", path)
    # Keep full-scale timing envelopes as deep diagnostics, not routine core gates.
    run("node", "tests/fsrs-scale.spec.js", "--performance")
    prepare_hosted_optimizer()
    run(sys.executable, "tests/fsrs-browser-integration.spec.py", "full")


def full() -> None:
    core()
    optimizer()
    prepare_hosted_optimizer()
    with shared_chromium():
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
