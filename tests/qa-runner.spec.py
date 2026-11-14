from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import qa

checks = 0


def check(value: bool, reason: str) -> None:
    global checks
    checks += 1
    if not value:
        raise AssertionError(reason)


@contextmanager
def fake_chromium(events: list[str]):
    events.append("chromium-start")
    previous = os.environ.get("REVISION_DIRECTOR_CDP_ENDPOINT")
    os.environ["REVISION_DIRECTOR_CDP_ENDPOINT"] = "http://127.0.0.1:9000"
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("REVISION_DIRECTOR_CDP_ENDPOINT", None)
        else:
            os.environ["REVISION_DIRECTOR_CDP_ENDPOINT"] = previous
        events.append("chromium-stop")


def exercise(action, *, dependency_present: bool) -> tuple[list[tuple[str, ...]], list[str]]:
    commands: list[tuple[str, ...]] = []
    events: list[str] = []
    original_hosted_ready = qa._HOSTED_PREPARED
    original_endpoint = os.environ.pop("REVISION_DIRECTOR_CDP_ENDPOINT", None)
    try:
        with (
            patch.object(qa, "run", side_effect=lambda *args: commands.append(args)),
            patch.object(qa, "shared_chromium", side_effect=lambda: fake_chromium(events)),
            patch.object(qa, "OPTIMIZER_WASM", SimpleNamespace(is_file=lambda: dependency_present)),
        ):
            qa._HOSTED_PREPARED = False
            action()
    finally:
        qa._HOSTED_PREPARED = original_hosted_ready
        if original_endpoint is not None:
            os.environ["REVISION_DIRECTOR_CDP_ENDPOINT"] = original_endpoint
        else:
            os.environ.pop("REVISION_DIRECTOR_CDP_ENDPOINT", None)
    return commands, events


def count(commands: list[tuple[str, ...]], target: tuple[str, ...]) -> int:
    return commands.count(target)


check(tuple(path for group in qa.CORE_DOMAIN_PLAN.values() for path in group) == qa.CORE_NODE_PLAN,
      "Core domain ownership map differs from executable plan")
check(len(set(qa.CORE_NODE_PLAN)) == len(qa.CORE_NODE_PLAN),
      "A Node entrypoint is assigned to multiple product domains")
check(all(qa.CORE_DOMAIN_PLAN.values()), "Core domain ownership contains an empty group")
check(tuple(path for group in qa.BROWSER_DOMAIN_PLAN.values() for path in group) == qa.BROWSER_PLAN,
      "Browser domain ownership map differs from executable plan")
check(len(set(qa.BROWSER_PLAN)) == len(qa.BROWSER_PLAN),
      "A browser entrypoint is assigned to multiple product domains")
check(all(qa.BROWSER_DOMAIN_PLAN.values()), "Browser domain ownership contains an empty group")

commands, events = exercise(qa.full, dependency_present=True)
for path in qa.STATIC_PYTHON:
    check(count(commands, (sys.executable, path)) == 1, f"Static test repeated: {path}")
for path in qa.CORE_NODE_PLAN:
    check(count(commands, ("node", path)) == 1, f"Core test repeated: {path}")
for path in qa.BROWSER_PLAN:
    check(count(commands, (sys.executable, path)) == 1, f"Browser test repeated: {path}")
for path in qa.PERFORMANCE_BROWSER_PLAN:
    check(count(commands, (sys.executable, path)) == 1, f"Performance test repeated: {path}")
for path in qa.DEEP_NODE_PLAN:
    check(count(commands, ("node", path)) == 1, f"Deep test repeated: {path}")
check(count(commands, (sys.executable, "tests/scenarios/phase-time-runtime.py")) == 1,
      "Timing journey repeated")
check(count(commands, ("npm", "run", "--prefix", "tools/fsrs-optimizer", "smoke")) == 1,
      "Native optimizer smoke repeated")
check(not any(item[:2] == ("npm", "ci") for item in commands),
      "QA runner attempted to install dependencies")
check(count(commands, ("node", "build/build-hosted.mjs")) == 1,
      "Hosted assets built more than once")
check(count(commands, ("node", "tests/fsrs-scale.spec.js", "--performance")) == 1,
      "Dedicated deep-scale performance witness is missing or repeated")
check(not any("qa-mutation-probes.py" in " ".join(item) for item in commands),
      "One-shot mutation audit leaked into permanent QA")
check(count(commands, (sys.executable, "tests/fsrs-browser-integration.spec.py", "full")) == 1,
      "Full browser optimizer missed or repeated")
check(not any("qa-baseline.py" in " ".join(item) for item in commands),
      "Deep test recursively invokes the full-suite profiler")
check(events == ["chromium-start", "chromium-stop"],
      "Full run did not reuse a single shared Chromium session")
check(commands.index(("node", "build/build-hosted.mjs"))
      < commands.index((sys.executable, qa.BROWSER_PLAN[0])),
      "Hosted assets were prepared after browser tests")

commands, events = exercise(qa.browser, dependency_present=True)
check(events == ["chromium-start", "chromium-stop"],
      "Standalone browser suite did not own exactly one Chromium")
check(not any(item[:2] == ("npm", "ci") for item in commands),
      "Existing optimizer dependencies triggered reinstall")
check(count(commands, ("node", "build/build-hosted.mjs")) == 1,
      "Standalone browser did not prepare hosted assets exactly once")
check(len([item for item in commands if item[:1] == (sys.executable,)]) == len(qa.BROWSER_PLAN),
      "Standalone browser plan missed or added test entrypoints")

missing_commands: list[tuple[str, ...]] = []
with (
    patch.object(qa, "run", side_effect=lambda *args: missing_commands.append(args)),
    patch.object(qa, "OPTIMIZER_WASM", SimpleNamespace(is_file=lambda: False)),
):
    qa._HOSTED_PREPARED = False
    try:
        qa.deep()
        missing_error = ""
    except AssertionError as error:
        missing_error = str(error)
check("optimizer dependencies are missing" in missing_error.lower(),
      "Deep QA did not fail clearly when its prepared optimizer dependency was absent")
check(not missing_commands, "Deep QA mutated or executed setup after detecting a missing dependency")

print(f"PASS {checks} QA execution ownership checks")
