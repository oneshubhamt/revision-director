from __future__ import annotations

from pathlib import Path
import importlib.util
import os
import shutil
import time
from typing import Callable

from playwright.sync_api import Browser, Page, Playwright
from backup_fixture_codec import baseline_backup_path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "tests"
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
    endpoint = os.environ.get("REVISION_DIRECTOR_CDP_ENDPOINT")
    if endpoint:
        return playwright.chromium.connect_over_cdp(endpoint)
    executable = chromium_executable()
    return playwright.chromium.launch(
        headless=headless,
        executable_path=executable if executable else None,
        args=args if args is not None else DEFAULT_CHROMIUM_ARGS,
    )


def launch_persistent_chromium(
    playwright: Playwright,
    user_data_dir: str | Path,
    *,
    headless: bool = True,
    args: list[str] | None = None,
    viewport: dict[str, int] | None = None,
):
    executable = chromium_executable()
    return playwright.chromium.launch_persistent_context(
        str(user_data_dir),
        headless=headless,
        executable_path=executable if executable else None,
        args=args if args is not None else DEFAULT_CHROMIUM_ARGS,
        viewport=viewport or {"width": 1440, "height": 1000},
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



def wait_for_app_ready(page: Page, *, timeout: int = 10_000) -> None:
    page.wait_for_function(
        """() => {
          const fatal=document.querySelector('#fatal-error');
          return (fatal && fatal.offsetParent !== null) || typeof window.RevisionDirector === 'object';
        }""",
        timeout=timeout,
    )
    if page.locator("#fatal-error").count():
        assert not page.locator("#fatal-error").is_visible(), "Fatal startup error"


def wait_for_layout(page: Page) -> None:
    page.evaluate(
        """() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"""
    )

def open_html_page(
    browser: Browser,
    html: str,
    *,
    viewport: dict[str, int] | None = None,
    settle_ms: int = 0,
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
    wait_for_app_ready(page, timeout=default_timeout)
    if settle_ms:
        page.wait_for_timeout(settle_ms)
    return page, errors
