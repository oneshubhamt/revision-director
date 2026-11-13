from __future__ import annotations

from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
STATIC_PYTHON = {
    TESTS / "build-integrity.spec.py",
    TESTS / "html-sanity.spec.py",
    TESTS / "source-ownership.spec.py",
}


def run(*command: str) -> None:
    print("==>", " ".join(command), flush=True)
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(TESTS) + (os.pathsep + existing if existing else "")
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def assert_test_topology() -> None:
    historical = sorted([*TESTS.glob("pass-*"), *TESTS.glob("stage-*")], key=lambda path: path.name)
    if historical:
        names = ", ".join(path.name for path in historical)
        raise AssertionError(f"Historical pass/stage test entrypoints remain: {names}")


def core() -> None:
    assert_test_topology()
    run(sys.executable, "build/build.py")
    run(sys.executable, "build/checksums.py", "--write")
    run("node", "--check", "dist/app.js")
    for path in sorted(STATIC_PYTHON):
        run(sys.executable, str(path.relative_to(ROOT)))
    for path in sorted(TESTS.glob("*.spec.js")):
        run("node", str(path.relative_to(ROOT)))


def optimizer() -> None:
    run("npm", "run", "--prefix", "tools/fsrs-optimizer", "smoke")


def durability() -> None:
    run(sys.executable, "tests/scenarios/phase-time-runtime.py")


def browser() -> None:
    assert_test_topology()
    for path in sorted(TESTS.glob("*.spec.py")):
        if path in STATIC_PYTHON:
            continue
        run(sys.executable, str(path.relative_to(ROOT)))
    run(sys.executable, "tests/fsrs-browser-optimizer.spec.py", "full")


def full() -> None:
    core()
    optimizer()
    durability()
    browser()


COMMANDS = {
    "core": core,
    "optimizer": optimizer,
    "durability": durability,
    "browser": browser,
    "full": full,
}

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) == 2 else ""
    action = COMMANDS.get(command)
    if action is None:
        raise SystemExit("Usage: python3 tests/qa.py {core|optimizer|durability|browser|full}")
    action()
