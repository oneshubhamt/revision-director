from __future__ import annotations
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import argparse
import json
import os
import shutil
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "Revision_Director_Optimizer_Static"

def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)

def ensure_static() -> None:
    if (STATIC / "index.html").is_file():
        return
    if os.environ.get("CI") != "true":
        raise AssertionError("Build Revision_Director_Optimizer_Static first.")
    subprocess.run(
        ["npm", "ci", "--prefix", "tools/fsrs-optimizer", "--no-audit", "--no-fund"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(["npm", "run", "build:optimizer-static"], cwd=ROOT, check=True)
    check((STATIC / "index.html").is_file(), "CI failed to build Revision_Director_Optimizer_Static.")

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

def run(mode: str) -> None:
    ensure_static()
    handler = lambda *args, **kwargs: SimpleHTTPRequestHandler(*args, directory=str(STATIC), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            executable = os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=executable if executable else None,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
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
                print(f"PASS browser/WASM FSRS optimizer {mode}: {json.dumps(result, separators=(',', ':'))}")
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
