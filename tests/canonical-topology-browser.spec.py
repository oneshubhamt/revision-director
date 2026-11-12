from __future__ import annotations
from pathlib import Path
import os
import runpy
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
b1 = runpy.run_path(str(ROOT / "tests/pass-b1-browser.spec.py"), run_name="rd_canonical_topology_base")
HTML = (ROOT / "index.html").read_text().replace("<head>", "<head>" + b1["PERSISTENT_BROWSER_SHIM"], 1)
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def fresh_host(page) -> None:
    page.evaluate("window.__RD_B1_QA_STATE__={local:{},databases:{}}")


def boot(page):
    page.evaluate("""() => {
      document.querySelector('#app')?.remove();
      const frame=document.createElement('iframe');
      frame.id='app'; frame.name='canonical-topology-app';
      document.body.appendChild(frame);
    }""")
    frame = page.frame(name="canonical-topology-app")
    if frame is None:
        raise AssertionError("Canonical-topology QA frame was not created")
    frame.set_content(HTML, wait_until="load")
    return frame


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
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      return structuredClone(raw?.stores?.[store]?.records ?? []);
    }""", store)


def main() -> None:
    global checks
    chromium = os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=chromium if chromium else None, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        page.set_content("<body><script>window.__RD_B1_QA_STATE__={local:{},databases:{}}</script></body>")

        # Missing metadata in an otherwise initialized database must not be regenerated.
        fresh_host(page)
        frame = boot(page); wait_ready(frame)
        before_settings = store_records(page, "settings")
        page.evaluate("""() => {
          const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
          raw.stores.metadata.records=[];
        }""")
        frame = boot(page)
        wait_fatal(frame, "Database metadata is missing from a populated Revision Director database")
        check(store_records(page, "metadata") == [], "Missing metadata was silently regenerated")
        check(store_records(page, "settings") == before_settings, "Metadata failure mutated surviving settings")

        # Missing settings are only created for a genuinely empty fresh database.
        fresh_host(page)
        frame = boot(page); wait_ready(frame)
        page.evaluate("""() => {
          const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
          const now=new Date().toISOString();
          const profile={schemaVersion:1,id:'p',name:'Exam',examDate:'',status:'active',createdAt:now,updatedAt:now};
          raw.stores.profiles.records=[[JSON.stringify('p'),profile]];
          raw.stores.settings.records=[];
        }""")
        before_metadata = store_records(page, "metadata")
        frame = boot(page)
        wait_fatal(frame, "Application settings are missing from a populated Revision Director database")
        check(store_records(page, "settings") == [], "Missing settings were silently synthesized over populated state")
        check(store_records(page, "metadata") == before_metadata, "Settings failure mutated metadata")
        check(len(store_records(page, "profiles")) == 1, "Settings failure mutated surviving profile data")

        # Invalid current-schema relationships fail closed instead of being startup-repaired.
        fresh_host(page)
        frame = boot(page); wait_ready(frame)
        page.evaluate("""() => {
          const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
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
