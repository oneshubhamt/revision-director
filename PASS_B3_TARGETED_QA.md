# Pass B3 targeted QA — Cross-tab ownership and lifecycle closure

## Pass-specific tests

- `tests/pass-b3.spec.js` — **33/33** ownership, lease, handoff, fail-closed and storage-health checks.
- `tests/pass-b3-browser.spec.py` — **24/24** two-document ownership, takeover, hydration, lifecycle, quota and owner-only commit checks.

## Stage B preservation tests

- `tests/pass-b1.spec.js` — **25/25** durable active-session checks.
- `tests/pass-b1-browser.spec.py` — **23/23** persistent recovery and guarded-commit checks.
- `tests/pass-b2.spec.js` — **35/35** phase-time runtime checks.
- `tests/pass-b2-browser.spec.py` — **27/27** browser timing and gap-classification checks.

The B2 browser harness now emits a lifecycle return after simulated long wall-clock jumps. This models the ownership-lease reacquisition that precedes time reconciliation after a real sleep/wake or background return.

## Inherited regression

- `tests/kernel-policy.spec.js` — **139/139** checks.
- `tests/planning.spec.js` — **24/24** scenarios.
- `tests/pass-d.spec.js` — **26/26** checks.
- `tests/pass-d-qa.spec.js` — **138,674/138,674** assertions.
- `tests/pass-a2.spec.js` — **20/20** checks.
- `tests/source-ownership.spec.py` — **29/29** checks.
- `tests/build-integrity.spec.py` — **119/119** checks.
- `tests/html-sanity.spec.py` — **29/29** checks.
- `tests/browser-qa.spec.py` — **7/7** principal Chromium scenarios, executed independently because the combined runner exceeds the environment command ceiling.
- `tests/pass-d-browser-qa.spec.py` — **3/3** hostile and large-data scenarios.
- `tests/full-qa-supplement.spec.py` — **161/161** responsive, accessibility and rerender checks.

## Browser ownership scenarios covered

- first document acquires a verified lease;
- second document remains read-only;
- export and navigation remain available in the secondary document;
- backup import and public-bridge mutation are blocked;
- active owner flushes before takeover;
- requesting document hydrates the latest typed attempt before mutation;
- previous owner immediately loses timer and control rights;
- page exit releases the lease;
- remaining document reacquires and recovers the latest draft;
- passive lifecycle health checks do not request persistence;
- explicit persistence denial is visible;
- 80% usage reports warning and 95% usage reports critical;
- only the verified owner can create Evidence Events.

## Result

No unresolved Pass B3 defect or protected-workflow regression was found. The package is suitable as the Stage B implementation baseline. A comprehensive real-device Stage B certification remains appropriate before release or before relying on native sleep, eviction and storage-pressure behaviour.

## Stage B closure additions

- B3 ownership/storage checks: **40/40**.
- B3 two-document browser checks: **26/26**.
- Stage B hostile recovery browser checks: **23/23**.
- Build-integrity checks: **120/120**.

The new hostile suite covers corrupt-copy arbitration, deleted targets, stale committing recovery, guarded transaction rollback, retry idempotency, completed tombstones and three-tab ownership races.
