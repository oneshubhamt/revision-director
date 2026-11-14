from __future__ import annotations
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import argparse
import json
from playwright.sync_api import sync_playwright
from helpers.browser_harness import launch_chromium, open_rendered_pane, wait_until, wait_for_toast_outcome
from helpers import browser_fixture as fixture
from backup_fixture_codec import decode_file

ROOT = Path(__file__).resolve().parents[1]
HOSTED = ROOT / "Revision_Director_Hosted"

def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)

def ensure_hosted() -> None:
    required = ("index.html", "fsrs-optimizer.worker.js", "fsrs-binding.wasm32-wasip1.wasm")
    missing = [name for name in required if not (HOSTED / name).is_file()]
    if missing:
        raise AssertionError(
            "Hosted optimizer assets are missing: " + ", ".join(missing)
            + ". Prepare them with `npm run build:hosted` before running this test directly."
        )

def evidence_csv(full: bool) -> str:
    rows: list[tuple[int, str]] = []
    cards = 96 if full else 12
    for card in range(cards):
        start = 1704067200000 + card * 1000
        rows.append((start, f"{start},card-{card},3,1000,0"))
        rows.append((start + 10 * 60 * 1000, f"{start + 10 * 60 * 1000},card-{card},3,900,1"))
        if full:
            pattern = card % 4
            rows.append((start + 12 * 60 * 60 * 1000, f"{start + 12 * 60 * 60 * 1000},card-{card},{3 if pattern == 3 else 1},800,2"))
            rows.append((start + 24 * 60 * 60 * 1000, f"{start + 24 * 60 * 60 * 1000},card-{card},{3 if pattern >= 2 else 1},750,2"))
            rows.append((start + 48 * 60 * 60 * 1000, f"{start + 48 * 60 * 60 * 1000},card-{card},{3 if pattern == 3 else 1},700,2"))
        else:
            rows.append((start + 24 * 60 * 60 * 1000, f"{start + 24 * 60 * 60 * 1000},card-{card},3,800,2"))
    rows.sort(key=lambda item: (item[0], item[1]))
    return "review_time,card_id,review_rating,review_duration,review_state\n" + "\n".join(row for _, row in rows) + "\n"

def exercise_scheduling_policy_settings(browser) -> None:
    page, errors = fixture.open_page(browser, {"width": 1365, "height": 950}, baseline=True)
    open_rendered_pane(page, "settings")
    settings = page.locator('#settings-form')
    policy = settings.locator('[name="memorySchedulingPolicy"]')
    check(policy.count() == 1, "Memory scheduling policy selector missing")
    check(policy.input_value() == "fixed-retention", "Restored fixed-retention settings must be preserved instead of being silently migrated to the new default")

    policy.select_option("cost-adr")
    page.evaluate("document.querySelector('#toast').textContent=''")
    settings.locator('button[type="submit"]').click()
    wait_until(page, lambda: (fixture.stored_scheduling_policy(page) or {}).get("kind") == "cost-adr", timeout=8000, interval=40, message="Cost-ADR settings did not reach canonical IndexedDB state")
    wait_for_toast_outcome(page, expect_error=False, timeout=8_000, message="Cost-ADR settings did not report successful completion")
    check(not page.locator("#fatal-error").is_visible(), "Cost-ADR activation caused a fatal application state")

    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / "cost-adr-settings.rdbackup")
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        saved_policy = payload["settings"]["fsrsScheduling"]["policy"]
        check(saved_policy["kind"] == "cost-adr", "Cost-ADR policy was not persisted in backup state")
        check(saved_policy["goalCostWeight"] == 1024, "Persisted Cost-ADR goal cost weight is not the bounded preset")
        check(len(saved_policy["costAdrPolicy"]["coefficients"]) == 15, "Persisted Cost-ADR policy lost upstream coefficient provenance")

    settings = page.locator('#settings-form')
    settings.locator('[name="memorySchedulingPolicy"]').select_option("fixed-retention")
    settings.locator('[name="desiredRetention"]').fill("0.90")
    page.evaluate("document.querySelector('#toast').textContent=''")
    settings.locator('button[type="submit"]').click()
    wait_until(page, lambda: (fixture.stored_scheduling_policy(page) or {}).get("kind") == "fixed-retention", timeout=8000, interval=40, message="Fixed-retention settings did not reach canonical IndexedDB state")
    wait_for_toast_outcome(page, expect_error=False, timeout=8_000, message="Fixed-retention settings did not report successful completion")
    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / "fixed-retention-settings.rdbackup")
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        saved_policy = payload["settings"]["fsrsScheduling"]["policy"]
        check(saved_policy["kind"] == "fixed-retention", f"Fixed-retention policy did not persist: {saved_policy}")
        check(abs(float(saved_policy["desiredRetention"]) - 0.90) < 1e-12, "Fixed-retention target did not persist at 90%")
    check(not page.locator("#fatal-error").is_visible(), "Return from Cost-ADR caused a fatal application state")
    check(not errors, f"Cost-ADR Settings browser errors: {errors}")
    page.close()


def run(mode: str) -> None:
    ensure_hosted()
    handler = lambda *args, **kwargs: SimpleHTTPRequestHandler(*args, directory=str(HOSTED), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = launch_chromium(playwright)
            try:
                page = browser.new_page()
                page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until="load")
                marker = page.locator('meta[name="revision-director-browser-optimizer"]').get_attribute("content")
                check(marker == "wasm32-wasip1-0.6.1", "Optimizer capability marker is missing.")
                result = page.evaluate(
                    """async ({csv,mode}) => await new Promise((resolve,reject) => {
                      const worker=new Worker("./fsrs-optimizer.worker.js",{type:"module"});
                      const requestId="browser-smoke";
                      const progress=[];
                      const timeout=setTimeout(()=>{
                        worker.terminate();
                        reject(new Error("browser optimizer smoke timed out"));
                      },mode==="full"?8*60*1000:60000);
                      worker.onmessage=event=>{
                        const data=event.data;
                        if(data?.requestId!==requestId)return;
                        if(data.type==="progress"){progress.push([data.stage,data.current,data.total]);return;}
                        if(data.type==="probe-result"||data.type==="result"){
                          clearTimeout(timeout);worker.terminate();resolve({...data,progress});return;
                        }
                        if(data.type==="rejected"){
                          clearTimeout(timeout);worker.terminate();
                          reject(new Error("optimizer rejected: "+(data.reasons??[]).join("; ")));return;
                        }
                        if(data.type==="error"){
                          clearTimeout(timeout);worker.terminate();reject(new Error(data.message));return;
                        }
                      };
                      worker.onerror=event=>{
                        clearTimeout(timeout);worker.terminate();reject(new Error(event.message));
                      };
                      worker.postMessage({type:mode==="full"?"optimize":"probe",requestId,csv});
                    })""",
                    {"csv": evidence_csv(mode == "full"), "mode": mode},
                )
                if mode == "probe":
                    check(result.get("type") == "probe-result", "Browser probe did not return probe-result.")
                    check(result.get("items", 0) > 0 and result.get("cards", 0) > 0, "Browser probe returned no optimizer evidence.")
                    check(result.get("chronology") == "elapsed-24h", "Browser probe chronology diverged.")
                    metrics = result.get("metrics", {})
                    check(isinstance(metrics.get("logLoss"), (int, float)) and isinstance(metrics.get("rmseBins"), (int, float)), "Browser probe metrics are invalid.")
                else:
                    profile = result.get("profile", {})
                    check(profile.get("schema") == "revision-director-fsrs-profile/v1", "Full browser optimizer returned the wrong profile schema.")
                    check(profile.get("evaluation", {}).get("holdout", {}).get("gate") == "passed", "Full browser optimizer did not pass the holdout gate.")
                    check(len(profile.get("weights", [])) == 34, "Full browser optimizer did not return 34 weights.")
                    stages = {item[0] for item in result.get("progress", [])}
                    for stage in ("Train validation candidate", "Retrain final profile on all evidence", "Time-series cross-validation"):
                        check(stage in stages, f"Browser optimizer did not report stage: {stage}")
                print(f"PASS browser/WASM FSRS integration optimizer {mode}: {json.dumps(result, separators=(',', ':'))}")
                if mode == "probe":
                    exercise_scheduling_policy_settings(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", choices=("probe", "full"), default="probe")
    args = parser.parse_args()
    run(args.mode)
