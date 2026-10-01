# Revision Director VA7.1 — Pass B3 verification inventory

## Pass-specific suites

- `tests/pass-b3.spec.js` — **40** ownership, lease, handoff, fail-closed and storage-health checks.
- `tests/pass-b3-browser.spec.py` — **26** two-document ownership, hydration, lifecycle, quota and owner-only commit checks.
- `tests/pass-b2.spec.js` — **35** phase-runtime checks.
- `tests/pass-b2-browser.spec.py` — **27** browser timing checks.
- `tests/pass-b1.spec.js` — **25** durable-session checks.
- `tests/pass-b1-browser.spec.py` — **23** persistent recovery checks.

- `tests/stage-b-hostile-recovery.spec.py` — **23** adversarial recovery, transaction-rollback and tombstone checks.

## Inherited targeted regression

- `tests/kernel-policy.spec.js` — **139** checks.
- `tests/planning.spec.js` — **24** scenarios.
- `tests/pass-d.spec.js` — **26** checks.
- `tests/pass-d-qa.spec.js` — **138,674** assertions.
- `tests/pass-a2.spec.js` — **20** checks.
- `tests/source-ownership.spec.py` — **29** checks.
- `tests/build-integrity.spec.py` — **120** checks.
- `tests/html-sanity.spec.py` — **29** checks.
- `tests/browser-qa.spec.py` — **7** principal Chromium scenarios.
- `tests/pass-d-browser-qa.spec.py` — **3** hostile and large-data scenarios.
- `tests/full-qa-supplement.spec.py` — **161** responsive, accessibility and rerender checks.

## B3 coverage

- verified one-owner lease and heartbeat;
- fail-closed lease storage;
- read-only secondary controls and bridge;
- browse, search and export preservation;
- flush-before-takeover;
- canonical session hydration before mutation;
- safe stale-lease reacquisition;
- page visibility, focus, pageshow and exit closure;
- passive versus explicit persistence requests;
- warning and critical quota thresholds;
- owner-only evidence commit.

## Test boundary

The multi-document harness shares deterministic IndexedDB, local recovery and a
BroadcastChannel-compatible host across two application documents. Production
uses native browser facilities. Real operating-system sleep, full browser
restart, tab eviction and storage pressure remain target-device certification
items.
