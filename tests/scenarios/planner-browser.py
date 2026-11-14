from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
from playwright.sync_api import sync_playwright
from scenario_timing import timed
from backup_fixture_codec import decode_file

TESTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import launch_chromium, open_rendered_pane, wait_until
from helpers.browser_fixture import open_page, stored_all, stored_record

CHECKS = 0

def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)

def exercise_chunk_and_plan_history(browser) -> None:
    page, errors = open_page(browser, {"width": 1365, "height": 1000}, baseline=True)
    page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
    settings = page.locator('#settings-form')
    settings.locator('[name="dailyCapacityMinutes"]').fill('30')
    settings.locator('button[type="submit"]').click()

    page.locator('#quick-add-unit').click(); page.locator("#unit-dialog").wait_for(state="visible")
    form = page.locator('#unit-form')
    due = page.evaluate("new Date(Date.now()-3600000).toISOString().slice(0,16)")
    values = {
        'subject': 'Geology', 'section': 'Geomorphology', 'topic': 'Drainage',
        'title': 'Oversized drainage synthesis', 'scope': 'Pages 101-112',
        'source': 'Geology notes pages 101-112', 'expectedMinutes': '90',
        'workflowPrompt': 'Reconstruct the complete drainage framework from memory.',
        'workflowCheckpoints': 'Definitions\nControls\nPatterns\nExamples',
        'protocol': 'Reconstruct each bounded section, then perform one final synthesis.',
        'successCriteria': 'Complete structure, relationships and examples.',
        'firstDueAt': due,
    }
    for name, value in values.items():
        form.locator(f'[name="{name}"]').fill(value)
    form.locator('[name="obligationType"]').select_option('concept-reconstruction')
    form.locator('[name="workflowKind"]').select_option('reconstruction')
    form.locator('button[type="submit"]').click(); page.locator("#unit-dialog").wait_for(state="hidden")
    open_rendered_pane(page, "today")

    chunk_row = page.locator('.planner-row').filter(has_text='Oversized drainage synthesis').first
    wait_until(
        page,
        lambda: chunk_row.count() == 1 and chunk_row.locator('[data-action="review-chunk"]').count() == 1,
        timeout=5_000,
        interval=40,
        message="Oversized obligation did not finish rendering as a daily chunk",
    )
    check(chunk_row.count() == 1, 'Oversized obligation was not converted into a daily chunk')
    chunk_action = chunk_row.locator('[data-action="review-chunk"]')
    check(chunk_action.count() == 1, 'Chunk action missing')
    chunk_row.locator('details.planner-details').evaluate('e=>e.open=true')
    factor_meters = chunk_row.locator('.factor-grid .factor-meter')
    check(factor_meters.count() == 6, 'Planner explanation does not expose all six scoring factors')
    factor_values = [int(factor_meters.nth(index).locator('strong').inner_text()) for index in range(factor_meters.count())]
    check(all(0 <= value <= 100 for value in factor_values), f'Planner factor projection is outside the normalized range: {factor_values}')

    chunk_id = chunk_action.get_attribute('data-id')
    check(bool(chunk_id), 'Chunk action lacks durable chunk identity')
    chunk_before = stored_record(page, 'chunks', chunk_id)
    parent_before = stored_record(page, 'obligations', chunk_before['obligationId'])
    chunk_action.click(); page.locator("#chunk-note").wait_for(state="visible")
    page.locator('#chunk-note').fill('Completed the first bounded page range.')
    page.locator('[data-action="complete-chunk"]').click()
    wait_until(
        page,
        lambda: (stored_record(page, 'chunks', chunk_id) or {}).get('status') == 'completed',
        timeout=5000,
        interval=40,
        message="Chunk completion did not reach canonical storage",
    )
    chunk_after = stored_record(page, 'chunks', chunk_id)
    parent_after = stored_record(page, 'obligations', chunk_before['obligationId'])
    check(chunk_after['status'] == 'completed', 'Chunk completion was not persisted')
    wait_until(
        page,
        lambda: page.locator('[data-pane="today"]').get_attribute('aria-selected') == 'true',
        timeout=5000,
        interval=40,
        message="Chunk completion did not return to the Today planner",
    )
    next_chunk = page.locator('.planner-row').filter(has_text='Oversized drainage synthesis').first
    wait_until(
        page,
        lambda: next_chunk.locator('[data-action="review-chunk"]').count() == 1
        and next_chunk.locator('[data-action="review-chunk"]').get_attribute('data-id') != chunk_id,
        timeout=5000,
        interval=40,
        message="Next bounded chunk did not finish rendering",
    )
    check(next_chunk.count() == 1 and next_chunk.locator('[data-action="review-chunk"]').count() == 1, 'Completing one chunk did not expose the next bounded chunk')
    check(
        parent_after['dueAt'] == parent_before['dueAt']
        and parent_after['policyState'] == parent_before['policyState'],
        'Completing an intermediate chunk incorrectly rescheduled the parent obligation',
    )

    page.locator('[data-action="regenerate-plan"]').click()
    plans = stored_all(page, 'dailyPlans')
    current_plan = max(plans, key=lambda item: item['studyDayKey'])
    check(len(current_plan['versions']) >= 2, 'Manual regeneration did not preserve a prior plan version')
    check(any(outcome['status'] == 'completed' for outcome in current_plan['outcomes']), 'Completed chunk outcome was not preserved in the daily plan')
    page.locator('[data-pane="history"]').click(); page.locator("#pane-history").wait_for(state="visible")
    plan_row = page.locator('#history-content .record-row').filter(has_text=current_plan['studyDayKey'])
    wait_until(page, lambda: plan_row.count() >= 1, timeout=5000, interval=40, message="Persisted daily-plan record was not projected in History")
    check(plan_row.count() >= 1, 'Persisted daily-plan record was not projected in History')
    check(not errors, f'Planner browser errors: {errors}')
    page.close()

def exercise_plan_execution_state(browser) -> None:
    page, errors = open_page(browser, {"width": 1365, "height": 950}, baseline=True)
    page.locator('[data-pane="today"]').click(); page.locator("#pane-today").wait_for(state="visible")
    planned_count = page.locator('#today-content .planner-row.selected, #today-content .planner-row.required-overrun').count()
    check(planned_count >= 2, 'Execution-state scenario requires at least two planned items')
    page.locator('[data-action="start-due"]').click(); page.locator("#review-content").wait_for(state="visible")
    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / 'execution-state.rdbackup')
        page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        plan = sorted(payload['dailyPlans'], key=lambda item: item['studyDayKey'])[-1]
        statuses = [outcome['status'] for outcome in plan['outcomes']]
        check(statuses.count('started') == 1, f'Only the current review target should be started, got {statuses}')
        check(statuses.count('planned') >= 1, f'Future review targets should remain planned, got {statuses}')
    check(not errors, f'Execution-state browser errors: {errors}')
    page.close()


def main() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        timed('planner.chunk-history', exercise_chunk_and_plan_history, browser)
        timed('planner.execution-state', exercise_plan_execution_state, browser)
        browser.close()
    print(f"PASS {CHECKS} planner browser execution and history checks")

if __name__ == "__main__":
    main()
