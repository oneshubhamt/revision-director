from __future__ import annotations

from pathlib import Path
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text().replace(
    "void boot();",
    "window.__RD_F1_RELIABILITY__={readwriteTransaction};",
    1,
)


def main() -> None:
    chromium = os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=chromium if chromium else None,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_page()
        page.set_content(HTML, wait_until="load")
        result = page.evaluate("""async () => {
          if (typeof window.__RD_F1_RELIABILITY__?.readwriteTransaction !== "function") {
            throw new Error("Reliability test hook missing");
          }
          const request=indexedDB.open("revision-director-durability-probe",1);
          const db=await new Promise((resolve,reject)=>{
            request.onupgradeneeded=()=>request.result.createObjectStore("probe");
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error);
          });
          const strict=window.__RD_F1_RELIABILITY__.readwriteTransaction(db,"probe","strict");
          strict.objectStore("probe").put({ok:true},"strict");
          const strictHint=strict.durability;
          await new Promise((resolve,reject)=>{
            strict.oncomplete=()=>resolve();
            strict.onabort=()=>reject(strict.error ?? new Error("strict transaction aborted"));
            strict.onerror=()=>reject(strict.error ?? new Error("strict transaction failed"));
          });
          const ordinary=window.__RD_F1_RELIABILITY__.readwriteTransaction(db,"probe");
          ordinary.objectStore("probe").put({ok:true},"default");
          const ordinaryHint=ordinary.durability;
          await new Promise((resolve,reject)=>{
            ordinary.oncomplete=()=>resolve();
            ordinary.onabort=()=>reject(ordinary.error ?? new Error("default transaction aborted"));
            ordinary.onerror=()=>reject(ordinary.error ?? new Error("default transaction failed"));
          });
          db.close();
          indexedDB.deleteDatabase("revision-director-durability-probe");
          return {strictHint,ordinaryHint};
        }""")
        if result["strictHint"] != "strict":
            raise AssertionError(f"Chromium did not honor strict IndexedDB durability hint: {result}")
        if result["ordinaryHint"] != "default":
            raise AssertionError(f"Ordinary write unexpectedly requested non-default durability: {result}")
        browser.close()
    print("PASS selective strict/default IndexedDB durability in Chromium")


if __name__ == "__main__":
    main()
