from __future__ import annotations
from pathlib import Path
from playwright.sync_api import sync_playwright
from helpers.browser_harness import ROOT, launch_chromium
from helpers.simulated_storage import create_simulated_frame, reset_simulated_storage, simulated_storage_html

HTML = simulated_storage_html()
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def fresh_host(page) -> None:
    reset_simulated_storage(page)


def detach_app(page) -> None:
    page.evaluate("document.querySelector('#app')?.remove()")


def boot(page):
    return create_simulated_frame(
        page,
        HTML,
        name="canonical-topology-app",
        element_id="app",
        width=1280,
        height=900,
    )


def wait_ready(frame) -> None:
    frame.wait_for_function("""() =>
      document.querySelector('#fatal-error')?.hidden !== false &&
      typeof RevisionDirector === 'object' &&
      document.querySelector('#import-backup')?.disabled === false
    """, timeout=10000)


def wait_fatal(frame, fragment: str) -> str:
    frame.wait_for_function("""fragment => {
      const node=document.querySelector('#fatal-error');
      return node && node.hidden === false && node.textContent.includes(fragment);
    }""", arg=fragment, timeout=10000)
    return frame.locator("#fatal-error").inner_text()


def store_records(page, store: str):
    return page.evaluate("""store => {
      const raw=window.__RD_SIMULATED_STORAGE_STATE__.databases['revision-director'];
      return structuredClone(raw?.stores?.[store]?.records ?? []);
    }""", store)


def main() -> None:
    global checks
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        page.set_content("<body></body>")
        reset_simulated_storage(page)

        # Missing metadata in an otherwise initialized database must not be regenerated.
        fresh_host(page)
        frame = boot(page); wait_ready(frame)
        before_settings = store_records(page, "settings")
        detach_app(page)
        page.evaluate("""() => {
          const raw=window.__RD_SIMULATED_STORAGE_STATE__.databases['revision-director'];
          raw.stores.metadata.records=[];
        }""")
        frame = boot(page)
        wait_fatal(frame, "Database metadata is missing from this Revision Director database")
        check(store_records(page, "metadata") == [], "Missing metadata was silently regenerated")
        check(store_records(page, "settings") == before_settings, "Metadata failure mutated surviving settings")

        # Missing settings in an existing database are never reconstructed.
        fresh_host(page)
        frame = boot(page); wait_ready(frame)
        detach_app(page)
        page.evaluate("""() => {
          const raw=window.__RD_SIMULATED_STORAGE_STATE__.databases['revision-director'];
          const now=new Date().toISOString();
          const profile={schemaVersion:1,id:'p',name:'Exam',examDate:'',status:'active',createdAt:now,updatedAt:now};
          raw.stores.profiles.records=[[JSON.stringify('p'),profile]];
          raw.stores.settings.records=[];
        }""")
        before_metadata = store_records(page, "metadata")
        frame = boot(page)
        wait_fatal(frame, "Canonical storage must contain exactly one application-settings document")
        check(store_records(page, "settings") == [], "Missing settings were silently synthesized over populated state")
        check(store_records(page, "metadata") == before_metadata, "Settings failure mutated metadata")
        check(len(store_records(page, "profiles")) == 1, "Settings failure mutated surviving profile data")

        # Invalid current-schema relationships fail closed instead of being startup-repaired.
        fresh_host(page)
        frame = boot(page); wait_ready(frame)
        detach_app(page)
        page.evaluate("""() => {
          const raw=window.__RD_SIMULATED_STORAGE_STATE__.databases['revision-director'];
          const now=new Date().toISOString();
          const profile={schemaVersion:1,id:'p',name:'Exam',examDate:'',status:'active',createdAt:now,updatedAt:now};
          raw.stores.profiles.records=[[JSON.stringify('p'),profile]];
        }""")
        before = store_records(page, "settings")
        frame = boot(page)
        wait_fatal(frame, "Default exam profile must reference an active exam profile")
        check(store_records(page, "settings") == before, "Startup repaired an inconsistent default-profile selection")

        browser.close()
    print(f"PASS {checks} canonical-topology browser checks")


if __name__ == "__main__":
    main()
