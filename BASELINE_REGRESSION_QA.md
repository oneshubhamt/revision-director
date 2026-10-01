# VA6.2 → VA7.1 baseline regression audit

## Baseline used

`Revision_Director_VA6_2_Pass_ABC_QA.zip` was freshly extracted and its checksum
manifest verified before testing.

## Baseline result

- Strict TypeScript compilation: passed.
- 133 kernel/workflow/policy/backup checks: passed.
- 24 planning scenarios: passed.
- 77 build-integrity checks: passed.
- 29 static HTML checks: passed.
- 5 Chromium browser workflows: passed.

## VA7.1 carry-forward result

VA7.1 retains the Pass A–C model, all six retrieval workflows, exact embedded
FSRS, planner inputs, backup/recovery and sealed monolithic deployment. Its
expanded suites pass:

- 139 kernel/workflow/policy/backup checks;
- 24 Pass C scenarios;
- 7 principal browser workflows, including the baseline workflow set;
- all build and HTML checks.

## Intended Pass D additions

- duration observations and learned estimates;
- profile-qualified seven-day balance;
- interleaving;
- execution chunks and synthesis state;
- daily-plan versions and outcomes;
- corresponding IndexedDB stores, transactions and backup records.

## Regression conclusion

No testable Pass A–C behavioural regression remains after VA7.1 hardening. The
new database and backup identity are intentional because this remains an unused
prototype and backward compatibility was explicitly out of scope.
