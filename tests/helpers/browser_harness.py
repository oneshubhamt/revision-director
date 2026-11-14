from __future__ import annotations

from pathlib import Path
import os
import shutil
import time
from typing import Callable

from playwright.sync_api import Browser, Page, Playwright

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CHROMIUM_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"]


def chromium_executable() -> str | None:
    configured = os.environ.get("CHROMIUM_EXECUTABLE")
    if configured:
        return configured
    return shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")


class SharedChromiumSession:
    def __init__(self, browser):
        self._browser = browser
        self._contexts = []

    def _close_context(self, context) -> None:
        if context not in self._contexts:
            return
        self._contexts.remove(context)
        try:
            context.close()
        except Exception:
            pass

    def new_context(self, **kwargs):
        context = self._browser.new_context(**kwargs)
        self._contexts.append(context)
        return context

    def new_page(self, **kwargs):
        context = self.new_context(**kwargs)
        page = context.new_page()
        closing = {"active": False}

        def close_ephemeral_context() -> None:
            if closing["active"]:
                return
            closing["active"] = True
            self._close_context(context)

        page.on("close", lambda: close_ephemeral_context())
        return page

    def close(self) -> None:
        for context in list(reversed(self._contexts)):
            self._close_context(context)
        # The parent qa.py process owns the CDP Chromium lifetime. A child
        # suite closing its Browser facade must never terminate that process.

    def __getattr__(self, name):
        return getattr(self._browser, name)


def launch_chromium(
    playwright: Playwright,
    *,
    headless: bool = True,
    args: list[str] | None = None,
):
    endpoint = os.environ.get("REVISION_DIRECTOR_CDP_ENDPOINT")
    if endpoint:
        return SharedChromiumSession(playwright.chromium.connect_over_cdp(endpoint))
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


def wait_for_toast_outcome(
    target,
    *,
    expect_error: bool = False,
    timeout: int = 8_000,
    message: str = "Timed out waiting for action feedback",
) -> str:
    wait_until(
        target,
        lambda: bool(target.locator("#toast").inner_text().strip()),
        timeout=timeout,
        interval=40,
        message=message,
    )
    text = target.locator("#toast").inner_text().strip()
    is_error = target.locator("#toast").evaluate("e=>e.classList.contains('error')")
    if is_error != expect_error:
        expected = "error" if expect_error else "success"
        actual = "error" if is_error else "success"
        raise AssertionError(f"{message}: expected {expected}, got {actual}: {text}")
    return text


def select_backup_file(page: Page, path: str | Path, *, timeout: int = 8_000) -> dict[str, object]:
    page.wait_for_function(
        """() => {
          const pane=document.querySelector('#pane-settings');
          const input=document.querySelector('#import-backup');
          return document.documentElement.dataset.reviewOwnership === 'primary'
            && pane?.classList.contains('on')
            && input instanceof HTMLInputElement
            && !input.disabled;
        }""",
        timeout=timeout,
    )
    page.evaluate("document.querySelector('#toast').textContent=''")
    input_element = page.locator("#import-backup")
    input_element.set_input_files([])
    input_element.set_input_files(str(path))
    return wait_for_backup_import_result(page, timeout=timeout)


def wait_for_backup_import_result(page: Page, *, timeout: int = 8_000) -> dict[str, object]:
    # Import owns the file input until inspection reaches its finally block.
    # Synchronize on that lifecycle rather than requiring a toast and input reset
    # to be observable in the same polling instant.
    page.wait_for_function(
        """() => {
          const input=document.querySelector('#import-backup');
          const dialog=document.querySelector('#restore-dialog');
          return Boolean(dialog instanceof HTMLDialogElement && dialog.open)
            || Boolean(input instanceof HTMLInputElement && input.files?.length === 0);
        }""",
        timeout=timeout,
    )
    message = page.locator("#toast").inner_text().strip()
    return {
        "preview": page.locator("#restore-dialog").is_visible(),
        "message": message,
        "error": page.locator("#toast").evaluate("e=>e.classList.contains('error')"),
        "inspectionComplete": page.locator("#import-backup").evaluate("e=>e instanceof HTMLInputElement && e.files?.length === 0"),
    }


def wait_for_app_ready(page: Page, *, timeout: int = 10_000) -> None:
    page.wait_for_function(
        """() => {
          const fatal=document.querySelector('#fatal-error');
          if (fatal && fatal.offsetParent !== null) return true;
          const ownership=document.documentElement.dataset.reviewOwnership;
          return typeof window.RevisionDirector === 'object'
            && ['primary','secondary','faulted'].includes(ownership);
        }""",
        timeout=timeout,
    )
    if page.locator("#fatal-error").count():
        assert not page.locator("#fatal-error").is_visible(), "Fatal startup error"


def open_rendered_pane(page: Page, pane: str, *, timeout: int = 10_000, force_render: bool = False) -> None:
    tab = page.locator(f'[data-pane="{pane}"]')
    panel = page.locator(f'#pane-{pane}')
    if tab.get_attribute("aria-selected") == "true" and not force_render:
        panel.wait_for(state="visible", timeout=timeout)
        return
    content = page.locator(f'#{pane}-content')
    marker = f"qa-stale-{pane}"
    if content.count() and content.locator(":scope > *").count():
        content.locator(":scope > *").first.evaluate(
            "(e, marker) => e.setAttribute('data-qa-render-marker', marker)",
            marker,
        )
    tab.click()
    wait_until(
        page,
        lambda: tab.get_attribute("aria-selected") == "true"
        and panel.is_visible()
        and (
            not content.count()
            or content.locator(f'[data-qa-render-marker="{marker}"]').count() == 0
        ),
        timeout=timeout,
        interval=30,
        message=f"Timed out waiting for {pane} pane render",
    )


def wait_for_layout(page: Page) -> None:
    page.evaluate(
        """() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"""
    )

def open_html_page(
    browser: Browser,
    html: str,
    *,
    viewport: dict[str, int] | None = None,
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
    return page, errors
