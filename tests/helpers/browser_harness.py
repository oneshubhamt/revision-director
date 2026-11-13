from __future__ import annotations

from pathlib import Path
import importlib.util
import os
import shutil
import subprocess
import sys
import time
from typing import Callable

from playwright.sync_api import Browser, Page, Playwright

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "tests"
SCENARIOS = TESTS / "scenarios"
BASELINE_BACKUP = baseline_backup_path()
DEFAULT_CHROMIUM_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"]


def chromium_executable() -> str | None:
    configured = os.environ.get("CHROMIUM_EXECUTABLE")
    if configured:
        return configured
    return shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")


def launch_chromium(
    playwright: Playwright,
    *,
    headless: bool = True,
    args: list[str] | None = None,
):
    executable = chromium_executable()
    return playwright.chromium.launch(
        headless=headless,
        executable_path=executable if executable else None,
        args=args if args is not None else DEFAULT_CHROMIUM_ARGS,
    )


def capture_browser_errors(page: Page, *, include_warnings: bool = False) -> list[str]:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    accepted = ("error", "warning") if include_warnings else ("error",)
    page.on(
        "console",
        lambda message: errors.append(f"{message.type}: {message.text}")
        if message.type in accepted
        else None,
    )
    return errors


def accept_dialogs(page: Page) -> None:
    page.on("dialog", lambda dialog: dialog.accept())


def wait_until(
    target,
    predicate: Callable[[], bool],
    *,
    timeout: int = 10_000,
    interval: int = 60,
    message: str = "Timed out waiting for browser condition",
) -> None:
    deadline = time.monotonic() + timeout / 1000
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except Exception as error:
            last_error = error
        target.wait_for_timeout(interval)
    if last_error is not None:
        raise AssertionError(message) from last_error
    raise AssertionError(message)


def load_test_module(path: str | Path, name: str):
    resolved = Path(path)
    spec = importlib.util.spec_from_file_location(name, resolved)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load browser test support: {resolved}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_browser_qa(name: str = "revision_director_browser_qa"):
    return load_test_module(TESTS / "browser-qa.spec.py", name)


def open_html_page(
    browser: Browser,
    html: str,
    *,
    viewport: dict[str, int] | None = None,
    settle_ms: int = 1_200,
    default_timeout: int = 10_000,
    include_warnings: bool = False,
    auto_accept_dialogs: bool = True,
) -> tuple[Page, list[str]]:
    page = browser.new_page(viewport=viewport or {"width": 1440, "height": 1000})
    page.set_default_timeout(default_timeout)
    errors = capture_browser_errors(page, include_warnings=include_warnings)
    if auto_accept_dialogs:
        accept_dialogs(page)
    page.set_content(html, wait_until="load")
    if settle_ms:
        page.wait_for_timeout(settle_ms)
    if page.locator("#fatal-error").count():
        assert not page.locator("#fatal-error").is_visible(), "Fatal startup error"
    return page, errors


def run_python_scenarios(paths: Iterable[str]) -> None:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(TESTS) + (os.pathsep + existing if existing else "")
    for relative in paths:
        path = SCENARIOS / relative
        print(f"==> {path.relative_to(ROOT)}", flush=True)
        subprocess.run([sys.executable, str(path)], cwd=ROOT, env=env, check=True)
