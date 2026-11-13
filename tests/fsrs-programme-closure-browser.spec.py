from __future__ import annotations
from pathlib import Path
import importlib.util
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "tests"))
from helpers.browser_harness import launch_chromium
QA_PATH = ROOT / "tests" / "browser-qa.spec.py"
spec = importlib.util.spec_from_file_location("revision_director_browser_qa", QA_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load browser QA helpers")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read_state(page):
    return page.evaluate(
        """async()=>{
          const db=await new Promise((resolve,reject)=>{
            const request=indexedDB.open('revision-director');
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
          });
          const read=store=>new Promise((resolve,reject)=>{
            const tx=db.transaction(store,'readonly');
            const request=tx.objectStore(store).getAll();
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error||new Error('IndexedDB read failed: '+store));
          });
          const [units,obligations,evidenceEvents]=await Promise.all([
            read('units'),read('obligations'),read('evidenceEvents')
          ]);
          return {units,obligations,evidenceEvents};
        }"""
    )


def start_obligation(page, obligation_id: str) -> None:
    page.evaluate(
        """id=>{
          const button=document.createElement('button');
          button.type='button';
          button.dataset.action='review-one';
          button.dataset.id=id;
          button.hidden=true;
          document.body.appendChild(button);
          button.click();
          button.remove();
        }""",
        obligation_id,
    )
    page.locator('.review-card').wait_for(state='visible')


def perform_relearn_verification(page, *, successful: bool) -> None:
    before_events = len(read_state(page)["evidenceEvents"])
    page.locator("#relearn-repair-action").fill(
        "Rebuilt the organism profile, mechanism and discriminators from the source."
    )
    page.locator("#relearn-repair-completed").check()
    page.locator('[data-action="begin-verification"]').click()
    page.locator("#relearn-verification-text").fill(
        "Closed-book verification of identification, virulence, syndromes, resistance and treatment distinctions."
        if successful
        else "Closed-book verification remained incomplete and confused key discriminators."
    )
    page.locator("#relearn-source-closed").check()
    page.locator('[data-action="check-verification"]').click()
    page.locator('[data-action="rate"][data-rating="3"]').wait_for(state="visible")
    if successful:
        qa.check_all_checkpoints(page)
        page.locator('[data-action="rate"][data-rating="3"]').click()
    else:
        page.locator("#correction-note").fill("Verification still failed; repair the causal chain again.")
        page.locator("#error-conceptual-misunderstanding").check()
        page.locator('[data-action="rate"][data-rating="1"]').click()
    qa.wait_until(
        page,
        lambda: len(read_state(page)["evidenceEvents"]) == before_events + 1,
        timeout=8000,
        interval=50,
        message="Corrective FSRS evidence did not persist",
    )


def scenario_corrective_memory_e2e(browser) -> None:
    page, errors = qa.open_page(browser, {"width": 1365, "height": 950}, baseline=True)
    state = read_state(page)
    unit_by_id = {item["id"]: item for item in state["units"]}
    memory = next(
        item
        for item in state["obligations"]
        if item["type"] == "memory-recall"
        and "Staphylococcus aureus" in unit_by_id[item["unitId"]]["title"]
    )
    memory_id = memory["id"]
    check(memory["policyState"]["fsrsCard"]["state"] == 0, "Browser closure memory must begin in FSRS New state")
    check(memory["policyState"]["fsrsCard"]["scheduleStatus"] == "new", "Browser closure memory must begin with New schedule status")

    start_obligation(page, memory_id)
    check("RECALL" in page.locator("#review-content").inner_text(), "Direct memory recall did not start")
    if page.locator("#attempt-completed").count():
        page.locator("#attempt-completed").check()
    page.locator('[data-action="reveal"]').click()
    page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    page.locator("#correction-note").fill("Could not reconstruct the organism profile independently.")
    page.locator("#error-conceptual-misunderstanding").check()
    page.locator('[data-action="rate"][data-rating="1"]').click()
    qa.wait_until(
        page,
        lambda: len([item for item in read_state(page)["evidenceEvents"] if item["obligationId"] == memory_id]) == 1,
        timeout=8000,
        interval=50,
        message="Direct memory Again did not persist",
    )

    state = read_state(page)
    memory = next(item for item in state["obligations"] if item["id"] == memory_id)
    relearn = next(
        item for item in state["obligations"]
        if item["type"] == "relearn" and item.get("returnObligationId") == memory_id and item["status"] == "active"
    )
    check(memory["status"] == "suspended" and memory.get("suspensionReason") == "relearning", "Direct Again did not suspend memory for corrective work")
    check(memory["policyState"]["fsrsCard"]["state"] == 2, "Production 1d boundary no longer has its documented raw Review-state semantics")
    direct_events = [item for item in state["evidenceEvents"] if item["obligationId"] == memory_id]
    check(len(direct_events) == 1 and direct_events[0]["confirmedRating"] == 1, "Direct Again was not persisted exactly once")

    start_obligation(page, relearn["id"])
    repair_phase = page.locator('[data-review-phase="relearn-repair"]')
    repair_phase.wait_for(state="visible")
    trigger = repair_phase.locator(".trigger-evidence:not(.missing)")
    check(trigger.count() == 1, "Corrective relearning did not resolve its triggering evidence")
    check(
        "Could not reconstruct the organism profile independently." in trigger.inner_text(),
        "Corrective relearning did not expose the recorded triggering correction",
    )
    perform_relearn_verification(page, successful=False)

    state = read_state(page)
    memory = next(item for item in state["obligations"] if item["id"] == memory_id)
    relearn = next(item for item in state["obligations"] if item["id"] == relearn["id"])
    corrective = [
        item["correctiveMemoryTransition"]
        for item in state["evidenceEvents"]
        if item.get("correctiveMemoryTransition", {}).get("obligationId") == memory_id
    ]
    check(relearn["status"] == "active", "Failed closed-book verification incorrectly completed relearning")
    check(memory["status"] == "suspended" and memory.get("suspensionReason") == "relearning", "Failed verification incorrectly returned memory to the normal queue")
    check(len(corrective) == 1 and corrective[0]["rating"] == 1, "Failed closed-book verification was not persisted as FSRS Again evidence")
    check(memory["policyState"]["fsrsCard"]["reps"] == 2, "Failed corrective verification did not advance the canonical FSRS review count")

    start_obligation(page, relearn["id"])
    perform_relearn_verification(page, successful=True)

    state = read_state(page)
    memory = next(item for item in state["obligations"] if item["id"] == memory_id)
    relearn = next(item for item in state["obligations"] if item["id"] == relearn["id"])
    corrective = [
        item["correctiveMemoryTransition"]
        for item in state["evidenceEvents"]
        if item.get("correctiveMemoryTransition", {}).get("obligationId") == memory_id
    ]
    ratings = [direct_events[0]["confirmedRating"], *[item["rating"] for item in corrective]]
    check(relearn["status"] == "completed", "Successful verification did not complete the corrective obligation")
    check(memory["status"] == "active" and memory.get("suspensionReason") is None, "Successful verification did not reactivate memory")
    check(ratings == [1, 1, 3], f"Corrective browser history must be Again → Again → Good, got {ratings}")
    check(memory["policyState"]["fsrsCard"]["reps"] == 3, "Successful return did not preserve all three closed-book FSRS observations")
    check(memory["dueAt"] == memory["policyState"]["fsrsCard"]["dueAt"], "Successful return desynchronized obligation and FSRS due dates")

    lifecycle_events = [item for item in state["evidenceEvents"] if item["unitId"] == memory["unitId"]]
    check(
        len(lifecycle_events) == 3
        and sum(item["obligationType"] == "memory-recall" for item in lifecycle_events) == 1
        and sum(item["obligationType"] == "relearn" for item in lifecycle_events) == 2,
        "Corrective lifecycle evidence types are incomplete",
    )
    page.locator('[data-pane="history"]').click()
    page.locator("#pane-history").wait_for(state="visible")
    history_rows = page.locator("#history-content .record-row").filter(has_text=unit_by_id[memory["unitId"]]["title"])
    qa.wait_until(
        page,
        lambda: history_rows.count() == len(lifecycle_events),
        timeout=5000,
        interval=40,
        message="Browser History did not project every corrective lifecycle event",
    )
    check(history_rows.count() == 3, "Browser History does not expose all corrective lifecycle records")
    check(not errors, f"FSRS programme-closure browser errors: {errors}")
    page.close()


def main() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        scenario_corrective_memory_e2e(browser)
        browser.close()
    print("PASS FSRS programme-closure Chromium corrective-memory scenario")


if __name__ == "__main__":
    main()
