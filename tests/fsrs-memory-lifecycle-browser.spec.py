from __future__ import annotations
from pathlib import Path
from playwright.sync_api import sync_playwright
from scenario_timing import timed

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "tests"))
from helpers.browser_harness import launch_chromium
from helpers import browser_fixture as qa


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
          const [units,obligations,evidenceEvents,activeRetrieval]=await Promise.all([
            read('units'),read('obligations'),read('evidenceEvents'),read('activeRetrieval')
          ]);
          return {units,obligations,evidenceEvents,activeRetrieval};
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


def exercise_workflow_chain(browser) -> None:
    page, errors = qa.open_page(browser, baseline=True)
    before_event_ids = {event["id"] for event in qa.stored_all(page, "evidenceEvents")}
    qa.review_unit(page, "Drainage patterns and structural control")
    check(qa.active_workflow_kind(page) == "reconstruction", "Reconstruction workflow did not become the active review target")
    page.locator("#attempt-text").fill("Dendritic uniform rocks; trellis folded strata; rectangular joints; radial domes; annular rings; parallel slopes.")
    page.locator('[data-action="reveal"]').click(); page.locator("#comparison-attempt-text").wait_for(state="visible")
    check("Dendritic uniform rocks" in page.locator("#comparison-attempt-text").inner_text(), "Reconstruction attempt lost")
    qa.check_all_checkpoints(page); qa.set_range(page, "#structural-accuracy", 4); qa.set_range(page, "#relationship-accuracy", 4); qa.rate_good(page)

    qa.wait_until(page, lambda: qa.active_workflow_kind(page) == "diagram", timeout=5_000, interval=40, message="Diagram workflow did not follow")
    canvas = page.locator("#diagram-canvas"); box = canvas.bounding_box(); check(box is not None, "Diagram canvas missing")
    page.mouse.move(box["x"] + 20, box["y"] + 30); page.mouse.down(); page.mouse.move(box["x"] + 120, box["y"] + 100, steps=6); page.mouse.up()
    page.locator('[data-action="reveal"]').click(); page.locator("#comparison-diagram-canvas").wait_for(state="visible")
    check(page.locator("#comparison-diagram-canvas").is_visible(), "Diagram comparison missing")
    qa.check_all_checkpoints(page)
    for selector in ("#diagram-labels", "#diagram-spatial", "#diagram-process"): qa.set_range(page, selector, 4)
    qa.rate_good(page)

    qa.wait_until(page, lambda: qa.active_workflow_kind(page) == "answer-writing", timeout=5_000, interval=40, message="Answer-writing workflow did not follow")
    page.locator("#attempt-completed").check(); page.locator('[data-action="reveal"]').click(); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    for selector in ("#answer-demand", "#answer-structure-score", "#answer-content", "#answer-examples", "#answer-conclusion"): qa.set_range(page, selector, 4)
    page.locator("#answer-word-count").fill("148")
    check(
        page.locator("#answer-attempt-time").inner_text().strip() != "—"
        and not page.locator("#answer-time-status").evaluate("e=>e.classList.contains('bad')"),
        "Automatic answer timing did not record an in-limit attempt",
    )
    qa.rate_good(page)

    qa.review_unit(page, "Staphylococcus aureus")
    check(qa.active_workflow_kind(page) == "questions", "Questions workflow did not become the active review target")
    questions_obligation_id = qa.stored_record(page, "activeRetrieval", "current")["activeTargetId"]
    page.locator("#attempt-text").fill("Attempted; toxin distinctions uncertain.")
    page.locator("#attempt-completed").check(); page.locator('[data-action="reveal"]').click(); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    page.locator("#questions-attempted").fill("10"); page.locator("#questions-correct").fill("1"); page.locator("#questions-partial").fill("0")
    page.locator("#questions-error-summary").fill("Q2 toxin; Q3 resistance.")
    page.locator("#correction-note").fill("Relearn toxin syndromes and resistance logic.")
    page.locator("#error-application-failure").check()
    page.locator('[data-action="rate"][data-rating="1"]').click()
    qa.wait_until(
        page,
        lambda: qa.active_workflow_kind(page) == "recall"
        and page.locator("#attempt-completed").count() == 1
        and page.locator("#attempt-completed").is_visible(),
        timeout=5000,
        interval=40,
        message="Recall workflow did not finish rendering",
    )
    page.locator("#attempt-completed").check(); page.locator('[data-action="reveal"]').click(); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    qa.check_all_checkpoints(page); qa.rate_good(page)

    qa.wait_until(
        page,
        lambda: any(
            item["type"] == "relearn"
            and item.get("returnObligationId") == questions_obligation_id
            and item["status"] == "active"
            for item in qa.stored_all(page, "obligations")
        ),
        timeout=5_000,
        interval=40,
        message="Relearning obligation was not created",
    )
    relearn_obligation = next(
        item
        for item in qa.stored_all(page, "obligations")
        if item["type"] == "relearn"
        and item.get("returnObligationId") == questions_obligation_id
        and item["status"] == "active"
    )
    relearn = page.locator(f'[data-action="review-one"][data-id="{relearn_obligation["id"]}"]')
    qa.wait_until(
        page,
        lambda: relearn.count() == 1 and relearn.is_visible(),
        timeout=5_000,
        interval=40,
        message="Active relearning obligation did not finish rendering",
    )
    check(relearn.count() == 1, "Active relearning obligation is not represented by one review action")
    relearn.click()
    repair_phase = page.locator('[data-review-phase="relearn-repair"]')
    repair_phase.wait_for(state="visible")
    trigger = repair_phase.locator(".trigger-evidence:not(.missing)")
    check(trigger.count() == 1 and "Relearn toxin syndromes" in trigger.inner_text(), "Relearning trigger evidence did not project the recorded correction")
    page.locator("#relearn-repair-action").fill("Rebuilt toxin and resistance distinctions from the source.")
    page.locator("#relearn-repair-completed").check(); page.locator('[data-action="begin-verification"]').click()
    page.locator("#relearn-verification-text").fill("TSS is superantigen-mediated; MRSA uses altered PBP; treatment follows susceptibility.")
    page.locator("#relearn-source-closed").check(); page.locator('[data-action="check-verification"]').click(); page.locator('[data-action="rate"][data-rating="3"]').wait_for(state="visible")
    qa.check_all_checkpoints(page); qa.rate_good(page)

    new_events = [event for event in qa.stored_all(page, "evidenceEvents") if event["id"] not in before_event_ids]
    expected_workflows = {"reconstruction", "diagram", "answer-writing", "recall", "questions", "relearning"}
    check(expected_workflows <= {event["workflow"] for event in new_events}, f"Persisted workflow chain is incomplete: {new_events}")
    page.locator('[data-pane="history"]').click(); page.locator("#pane-history").wait_for(state="visible")
    evidence_count = len(qa.stored_all(page, "evidenceEvents"))
    qa.wait_until(
        page,
        lambda: page.locator("#history-content .record-row").count() >= evidence_count,
        timeout=8_000,
        interval=50,
        message="History did not project every persisted evidence record",
    )
    check(page.locator("#history-content .record-row").count() >= evidence_count, "History projection dropped persisted evidence records")
    check(not errors, f"Browser errors: {errors}")
    page.close()

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
    check(memory["policyState"]["fsrsCard"]["scheduleStatus"] == "new", "Browser closure memory must begin with New schedule status")

    start_obligation(page, memory_id)
    qa.wait_until(
        page,
        lambda: bool(read_state(page)["activeRetrieval"])
        and read_state(page)["activeRetrieval"][0].get("activeTargetId") == memory_id,
        timeout=8_000,
        interval=50,
        message="Direct memory recall did not publish its active retrieval state",
    )
    active_state = read_state(page)
    active_target = active_state["activeRetrieval"][0]["activeTargetId"]
    active_obligation = next(item for item in active_state["obligations"] if item["id"] == active_target)
    check(active_target == memory_id and active_obligation["workflow"]["kind"] == "recall", "Direct memory recall did not start")
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
    check(not errors, f"FSRS memory-lifecycle browser errors: {errors}")
    page.close()


def main() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        timed('fsrs.workflow-chain', exercise_workflow_chain, browser)
        timed('fsrs.corrective-memory', scenario_corrective_memory_e2e, browser)
        browser.close()
    print("PASS FSRS browser workflow chain and corrective-memory lifecycle scenarios")


if __name__ == "__main__":
    main()
