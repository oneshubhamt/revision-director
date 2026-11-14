# Revision Director — Pass E: invariant-level evidence and redundancy audit

**Source branch:** `working`, snapshot `5b7fcd6e477e9936686c8b24988888cff047f257` (14 Nov 2026). **Status:** audit and profiling, zero test deletions, no production code or workflow changes. The only permanent addition is a tiny diagnostic timer for named browser subjourneys.

## Rule and scope

Inventory **input/trigger → required invariant → failure detected** rather than test names or assertion counts. Checks are duplicates only when all three coincide **and** no different execution layer, provider, real browser, fault injection, timing, security or end-user UI boundary adds independent evidence. Each row groups repeated property-loop assertions under one invariant; this is intentionally not a raw thousands-of-lines assertion dump.

**Types:** M mathematical; B behavioural; I integration; S security/authority; A architecture; P presentation; U superficial.

**Coverage:** 21 core Node, three static Python, 19 standard browser, one browser timing, one browser performance and one deep Node experiment = **46 active entrypoints**; full browser/WASM optimization reuses a browser entrypoint in a more expensive mode. Inventory includes each entrypoint at least once as primary or independent witness. Paths refer to matching files under `tests/` or `tests/scenarios/`.

**Footprint:** 55 test-related tracked files (includes helper/fixture and the new non-entrypoint timer), 590,150 bytes; helper files 33,991 bytes against a 34,000-byte threshold.

## Invariant ownership register

### Build, architecture and QA ownership

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| A01 | A | Ordered TS manifest → complete, unique compilation source graph and strict configuration | build-integrity.spec.py | Compiler/build plus generated artifact inspection; retain |
| A02 | A | Build → exact inline JavaScript/CSS parity, sealed runtime and resolved placeholders | build-integrity.spec.py | html-sanity.spec.py parses shipped structure independently |
| A03 | S | Offline HTML loaded → no remote resources; restrictive Content-Security-Policy | html-sanity.spec.py | Browser startup probes actual runtime; different failure |
| A04 | A | Vendored scheduler bundled → exact checksum, license, load-before-app order | build-integrity.spec.py | fsrs-scheduler-reference.spec.js proves mathematics, not file identity |
| A05 | A | Optimizer package/lock evaluated → pinned provider and shared static contract | build-integrity.spec.py | fsrs-optimizer-contract.spec.js verifies actual consumer boundary |
| A06 | A | Tests parse module graph → no direct Node VM/vendor access outside harness | runtime-harness-ownership.spec.js | Positive and negative parser controls retained |
| A07 | A | Full QA invoked → each test exactly once, one Chromium, one hosted build, no recursive installation | qa-runner.spec.py | qa.py execution plan plus CI log confirms nonrecursive behavior |
| A08 | A | Browser owners declared → native IndexedDB tests not routed through simulation | qa-runner.spec.py | native-indexeddb-journey.py is an independent real-storage witness |
| A09 | A | Schema metadata is absent/unsupported → app must fail closed without rewriting survivor state | canonical-topology-browser.spec.py | production-contracts-storage.js owns canonical schema and rejection |
| A10 | P | Parsed HTML has unique IDs, related tabs/panels, labeled dialogs and early prepaint | html-sanity.spec.py | ui-behaviour.py verifies live focus/navigation |
| A11 | U | QA contains historical words, exact filenames or exceeds arbitrary footprint numbers → runner rejects source shape | qa.py assert_test_topology | qa-runner.spec.py plus AST module graph retain actual execution integrity |

### FSRS reference, provider and memory

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| F01 | M | Seeded New/Again/Good/review histories → upstream FSRS-7 state and interval parity | fsrs-scheduler-reference.spec.js | Browser memory journey checks storage/UI rather than recalculating oracle |
| F02 | M | Seeded chronological inputs → preview and retrievability agree with upstream scheduler | fsrs-scheduler-reference.spec.js | fsrs-scale.spec.js owns replay cache/load |
| F03 | M | Stock→Cost-ADR policy switch → explicit 0.90 default, bounded coefficients/weight, distinct fingerprint | fsrs-scheduler-integration.spec.js | fsrs-browser-integration.spec.py checks actual setting and exported data |
| F04 | S | Invalid Cost-ADR weight, coefficients or state bounds → policy activation rejected | fsrs-scheduler-integration.spec.js | No need to repeat invalid variants in browser |
| F05 | M | Chronological optimization CSV, malformed input and learned options → deterministic rejection or normalized evidence | fsrs-optimizer.spec.js | Browser provider chronology handshake is integration not same math |
| F06 | M | Closed-book attempt duration, ignored gaps or clock rollback → reliable vs unavailable optimizer cost correctly tagged | fsrs-scheduler-integration.spec.js | phase-time-runtime.js owns timer-side reliability |
| F07 | M | 384 review items → 320/64 holdout, leakage prevention and gate diagnostics | fsrs-optimizer.spec.js | Full WASM browser mode independently tests real training |
| F08 | I | Actual optimizer worker trains → 34 parameter profile, accepted holdout, staged progress | fsrs-browser-integration.spec.py full | Node gate policy tests are distinct |
| F09 | A | Browser/Node/provider optimizer modules imported → one shared contract, no conversion drift | fsrs-optimizer-contract.spec.js | Build lock pins upstream dependency separately |
| F10 | I | Change scheduling policy → atomic settings/obligation rebase with immutable evidence intact | fsrs-scheduler-integration.spec.js | Browser Cost-ADR round-trip verifies persistence and UX |
| F11 | I | Optimizer activate/replace/clear/reset → winning weights, exact rebase and historical replay catalog | fsrs-memory-lifecycle.spec.js | fsrs-scheduler-integration.spec.js supplies failure-path publication checks |
| F12 | B | Failed direct recall → memory suspended and corrective relearn queued, without synthetic FSRS success | fsrs-memory-lifecycle.spec.js | fsrs-memory-lifecycle-browser.spec.py verifies user-triggered workflow |
| F13 | B | Failed then successful closed-book verification → exact Again/Again/Good evidence and reactivation | fsrs-memory-lifecycle.spec.js | Browser corrective-memory journey additionally proves History |
| F14 | M | 4,608 reviews and reverse input → deterministic replay, bounded retrievability, cache reuse | fsrs-scale.spec.js --performance | Core small-mode keeps cheap semantics, deep timing is different invariant |
| F15 | M | 90/365/730-day learning-policy populations → long-horizon decision evidence for fixed/Cost-ADR | fsrs-scheduling-policy-deep.spec.js | Neither regular browser nor planner oracle duplicates simulation |
| F16 | I | User switches Cost-ADR→fixed → real Settings and exported backup carry current policy | fsrs-browser-integration.spec.py probe | Node canonical policy alone cannot detect event or export failures |
| F17 | I | Reconstruction, diagram, writing, question, memory workflows → real review controls persist events and History | fsrs-memory-lifecycle-browser.spec.py | kernel-policy.spec.js owns individual outcome normalizers |
| F18 | B | Cued recall, questions, writing and diagram evidence → exact normalized outcomes and suggested ratings | kernel-policy.spec.js | Browser inputs test controls, not a second mathematical model |

### Planner, priorities, capacity and history

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| P01 | M | Exam date/priority changed → proximity rank; passed/suspended exams excluded | planner-policy.spec.js | planner-browser.py tests execution not ranking oracle |
| P02 | M | Weakness history changed → obligation-specific prioritization and persistent-difficulty boost | planner-policy.spec.js | Browser explanation bars are a different presentation check |
| P03 | M | Duration, scope, lookahead and importance changed → policy rank/eligibility without rewriting dueAt | planner-policy.spec.js | fsrs-scheduler-integration.spec.js protects dueAt |
| P04 | B | Known exam near completion → one bounded final memory review and corrective deadline | planner-policy.spec.js | planner-persistence.spec.js owns persisted version |
| P05 | M | 320 seeded fitting instances → exhaustive knapsack optimum, critical priority, tie-break and monotonicity | planner-properties.spec.js | Browser does not duplicate brute-force computation |
| P06 | M | 180 oversized/mixed instances → required overrun, must-split, fallback and item partition | planner-properties.spec.js | planner-browser.py independently verifies rendered chunk |
| P07 | M | Permutation/repeated call → deterministic result, no omitted/duplicated item, no input mutation | planner-properties.spec.js | planner-policy.spec.js covers candidate construction |
| P08 | I | Read-only plan vs ensure/regenerate → only explicit command writes, version lineage intact | planner-policy.spec.js | planner-persistence.spec.js tests full state lifecycle |
| P09 | I | Chunk completion/manual regeneration → prior plan versions/outcomes preserved | planner-persistence.spec.js | planner-browser.py checks click and History projection |
| P10 | I | Start one review → one started and remaining planned outcomes in exported backup | planner-browser.py | Node planner-persistence.spec.js cannot prove export/UI transition |
| P11 | I | Capacity 60→30→120 → chunk reflow/dissolve, old cycle archival and no lost history | planner-performance.py | Pure knapsack optimality cannot detect live reflow bugs |
| P12 | S | Hostile daily-plan import → browser import rejects invalid state without preview | planner-performance.py | backup-codec.js owns cryptographic archive checks |
| P13 | P | 1000 units loaded → bounded planner rows, complete Library, no overflow, 25s ceiling | planner-performance.py | FSRS scale benchmark tests scheduler not rendered UI |
| P14 | P | Planning row shown → six normalized factor meters and durable chunk action | planner-browser.py | planner-policy.spec.js owns numerical scoring |

### Backup codec, restore ceremony and data safety

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| B01 | M | Known SHA-256 test vector → correct fallback digest | backup-codec.js | Browser preview verifies proof delivery not cryptographic implementation |
| B02 | S | Manifest/checksum/chunk/compression tampered → reject before candidate state | backup-codec.js | backup-codec.py tests actual file-input rejection |
| B03 | M | Eight canonical settings in compressed/plain archives → exact encode/decode roundtrip | backup-codec.js | Browser export roundtrip is separate File/Blob integration |
| B04 | S | Unknown schema fields/version/counts/oversized chunk → decoder fails closed | backup-codec.js | data-safety-controller.js protects staged operation not byte syntax |
| B05 | I | Candidate inspected → no mutation before explicit confirm and verified safety proof | backup-controller.js | backup-restore-controller.py verifies UI no-mutation |
| B06 | S | Safety proof current, acknowledged, unexpired and single use → staged restore only once | backup-controller.js | data-safety-controller.js tests alternate failure conditions |
| B07 | S | State changed, proof stale or commit in progress → restore blocked | data-safety-controller.js | backup-controller.js overlaps on one path, distinct edge conditions remain |
| B08 | S | Corrupted live state → nonimportable forensic rescue rather than fake valid backup | data-safety-controller.js | data-safety.py verifies user warning/rescue download |
| B09 | I | Failed restore or settings rebase → in-memory and durable state unchanged | fsrs-scheduler-integration.spec.js | backup-controller.js checks controller gate |
| B10 | I | Verified file selected → preview proof, safety download, acknowledgements and terminal success | backup-restore-controller.py | complete_open_restore shared fixture is not independent witness |
| B11 | I | Active unfinished session export/restore → text, treatment and review state rehydrated | backup-restore-controller.py | data-safety.py tests current-state safety and discard variants |
| B12 | S | Raw JSON, altered archive and semantic invalidity → UI rejects without restore preview | backup-codec.py and backup-restore-controller.py | Different invalid inputs; same UI outcome does not make them duplicates |
| B13 | I | Empty clean export/cancel/reselect current copy → no premature mutation | data-safety.py | restore-dialog-accessibility.py tests focus under short-screen conditions |
| B14 | P | Six restored dialog viewport sizes → focus containment, scroll, 44px controls, Escape and reselection | restore-dialog-accessibility.py | Main-pane responsive-layout.py has a distinct trigger |
| B15 | U | Preview contains at least six stat nodes, or mere filename/manifest string → UI declared healthy | data-safety.py and backup-codec.py | Replace with meaningful checksum and decoded record assertions |

### Storage authority, recovery, crash paths and native browser

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| D01 | A | Untrusted profiles/nodes/settings/plan → canonical schema, paths, identity and validation | production-contracts-storage.js | native-indexeddb-journey.py persists actual browser values |
| D02 | I | Repository write fails → error and storage diagnostics not swallowed | production-contracts-storage.js | ownership-storage-health.py renders warnings |
| D03 | S | First/second owner, takeover and forged lease heartbeat → exactly one mutable tab | ownership-storage-health.js | ownership-storage-health.py tests real multi-frame controls |
| D04 | S | Secondary attempts plugin/intake/import mutation → denied; backup export still enabled | ownership-storage-health.py | public-plugin-runtime.js verifies API capability authority |
| D05 | I | Owner handoff/exit/reacquire → flushed draft survives and new owner hydrates | ownership-storage-health.py | native-indexeddb-journey.py tests independent real tabs |
| D06 | I | Passive quota inspection and opt-in persistence request → warning/critical/denial surfaced | ownership-storage-health.js | ownership-storage-health.py adds user banner and request behavior |
| D07 | I | Profile/unit/evidence created → native IndexedDB reload and Chromium restart preserve exact records | native-indexeddb-journey.py | Simulated database tests are not substitutes |
| D08 | S | Second real tab → read-only and reads same native IndexedDB | native-indexeddb-journey.py | Simulated ownership detects injected race variants |
| D09 | I | Default/strict durability option or unsupported option → proper native transaction fallback | reliability-closure.js | indexeddb-durability.py tests native Chromium transaction modes |
| D10 | I | Parallel root/child hierarchy requests → unique normalized path, deterministic root ID | persistent-active-retrieval.py | reliability-closure.js tests root key optimization, distinct |
| D11 | I | Pagehide/reopen or newer emergency copy → draft restored and reconciled to IndexedDB | persistent-active-retrieval.py | active-retrieval-persistence.js has seeded precedence oracle |
| D12 | M | Recovery copies/tombstones permuted → deterministic revision precedence, debounce and recovery | active-retrieval-persistence.js | hostile-recovery.py uses actual corruption and Chromium |
| D13 | S | Corrupted local or IndexedDB copy → valid other copy repairs and diagnostics retained | hostile-recovery.py | Node recovery validation lacks host fault injection |
| D14 | S | Missing target/completed tombstone → never resurrect invalid session; clear both copies | hostile-recovery.py | persistent-active-retrieval.py tests manual ending, different trigger |
| D15 | I | Commit token altered between snapshot and write → no partial scheduler/evidence write, one safe retry | hostile-recovery.py | Double-click evidence witness in persistent-active-retrieval.py differs |
| D16 | I | Aborted simulated multi-store write → provisional records invisible, committed records preserved | hostile-recovery.py | indexeddb-durability.py owns actual Chromium semantics |
| D17 | S | Missing database metadata/settings/invalid active profile → startup fails closed without rewriting survivors | canonical-topology-browser.spec.py | kernel-policy.spec.js tests canonical service fail-closed |
| D18 | B | Duplicate/overflowing storage diagnostics → bounded deduplicated journal | production-contracts-storage.js | User-facing banner tests are separate projection |
| D19 | B | Rapid autosave and forced pagehide → latest draft persisted, synchronous emergency fallback | active-retrieval-persistence.js | persistent-active-retrieval.py confirms typing/reopen in Chromium |

### Time accounting and interruption behavior

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| T01 | M | Fake clock active/pause/resume/phase → conserved active seconds and phase totals | phase-time-runtime.js | phase-time-runtime.py tests live browser timer and storage |
| T02 | M | Focus/break/split/ignore inactivity → exact include/exclude allocation and pause history | phase-time-runtime.js | Browser overlay and event wiring is independent |
| T03 | M | Backward clock → no negative duration, unreliable optimizer evidence flagged | phase-time-runtime.js | Browser persisted recovery and warning add integration |
| T04 | S | Malformed timing/phase/gap snapshots → schema rejects impossible state | phase-time-runtime.js | Backup schema validation is different layer |
| T05 | I | Real UI pause and long-gap classification → timer, overlay, persistent session and Evidence agree | phase-time-runtime.py | Pure Node arithmetic cannot verify DOM integration |
| T06 | P | 12 repeated gap overlays → inert background, focus trap/return and no listener accumulation | ui-behaviour.py | One overlay in phase-time-runtime.py has a distinct stress horizon |

### Presentation, accessibility, plugins and public API

| ID | Type | Input/trigger → invariant and failure detected | Primary witness | Independent witness / judgment |
|---|---|---|---|---|
| U01 | P | Presentation registered → immutable default, unknown/faulted preference fallback, storage identity | presentation-kernel.js | presentation-kernel.py checks real boot and CSS |
| U02 | U | Public theme tokens merely >=35 → size proxy instead of semantic validity | presentation-kernel.js | validatePublicTokens and browser rendering are stronger witnesses |
| U03 | P | Corrupt browser prepaint preference → default presentation and no named global leak | presentation-kernel.py | html-sanity.spec.py checks order of prepaint script |
| U04 | P | ARIA tabs/panels → exactly one active view; keyboard navigation and roving tabindex | ui-behaviour.py | html-sanity.spec.py checks static structure |
| U05 | I | Clean install creates exam/unit/study record → sidebar and Study projection reflect persisted state | ui-behaviour.py | production-contracts-storage.js owns canonical writes |
| U06 | P | Library search debounced rerender → filtered row, focus and selection survive | ui-behaviour.py | No Node mathematical witness |
| U07 | P | Keyboard Space reveal and 3 rating → actual review transition | ui-runtime-accessibility.py | fsrs-memory-lifecycle-browser.spec.py primarily uses UI action path |
| U08 | P | 16 viewport sizes and six panes → no clipping/overflow, touch target size, nav reachability | responsive-layout.py | restore-dialog-accessibility.py is modal-specific |
| U09 | S | User submits img/SVG/script markup → shown inert, no active DOM payload | security-rendering-browser.spec.py | Schema/HTML parser alone cannot replace security rendering |
| U10 | P | After hostile stored text → mobile chrome and accessible buttons remain usable | security-rendering-browser.spec.py | responsive-layout.py tests ordinary content, distinct input |
| U11 | S | Public API frozen; internals withheld; invalid intake rejected | public-plugin-runtime.js | public-plugin-runtime.py verifies actual loading/UI |
| U12 | S | Local JavaScript file loaded/failed/oversized/wrong extension → isolated failures and statuses | public-plugin-runtime.py | Node registerPlugin checks do not test file loader |
| U13 | I | Intake creates study/unit → canonical plan and profile summary obey owner/status | public-plugin-runtime.js | public-plugin-runtime.py verifies browser Save and due summary |
| U14 | U | Exact historical version name, no-op check(True), exact public key list → false confidence | public-plugin-runtime.py | Semantic public version parity and browser plugin registration survive |
| U15 | S | User pauses exam profiles → stored status suspended and due summary excludes them | public-plugin-runtime.py | planner-policy.spec.js excludes inactive profiles at policy layer |

## Ranked removal/consolidation decisions

These are **proposals**, not deletions performed during the audit. Each row specifies the surviving witness that is required before removal.


| Priority | Duplicate or weak assertion assessed by input → invariant → failure | Required surviving witness; decision |
|---|---|---|
| P0-1 | \`public-plugin-runtime.py\` does \`check(True, 'Local plugin status rendered')\`: every input → always succeeds → no possible defect detected | Keep \`wait_local_file_settled\`, rendered file-name wait and loaded/failed/rejected status checks. **Remove no-op.** |
| P0-2 | \`public-plugin-runtime.py\` repeats hard-coded \`va7.1-pass-f1\` after healthy boot/plugin callback: literal rename → test failure, no product defect | \`public-plugin-runtime.js\` verifies API/public-data version parity; browser actual plugin registration still verifies matching version. **Replace literal with semantic identity.** |
| P0-3 | \`presentation-kernel.js\` checks public token count >=35: token renamed/corrupted but total unchanged → would pass | \`validatePublicTokens()\`, required manifest keys and browser CSS projection. **Replace count with required-token semantic check.** |
| P0-4 | \`data-safety.py\` checks preview has >=6 summary stat nodes: meaningless DOM count → wrong checksum/details undetected | Validated full archive proof/checksum and decoded payload in \`backup-restore-controller.py\` and \`data-safety.py\`. **Replace by named field/content checks.** |
| P0-5 | \`qa.py\` scans for historical Pass/Stage strings and banned filename shapes: inert comment/rename → false architecture failure | \`qa-runner.spec.py\` canonical ownership plan plus parsed \`runtime-harness-ownership.spec.js\` import graph. **Consolidate string heuristics; retain real topology constraints.** |
| P1-6 | \`backup-codec.py\` normal restore/inspect baseline and \`backup-restore-controller.py\` normal restore: same file → populated state → same happy-path failure | \`backup-restore-controller.py\` complete terminal restore; \`backup-codec.js\` codec oracle; keep browser raw JSON/tamper probes. **Merge redundant setup only.** |
| P1-7 | \`backup-codec.py\`, \`data-safety.py\`, \`backup-restore-controller.py\` each download same verified safety copy and perform ordinary confirmation | \`complete_open_restore\` fixture with \`backup-restore-controller.py\` successful restore; \`data-safety.py\` retains cancellation, active draft, forensic cases. **Remove only duplicate happy ceremony.** |
| P1-8 | \`presentation-kernel.py\` rechecks same frozen default/registry details already in \`presentation-kernel.js\` for identical API input | Node is primary semantic contract; browser keeps corrupt preference startup, no leak and responsive rendering. **Narrow duplicate introspection.** |
| P1-9 | \`public-plugin-runtime.py\` repeats Node frozen-object and exact API member/key shape, under ordinary registration | \`public-plugin-runtime.js\` primary authority contract; browser retains one host-exposure sentinel and local-file failure/containment. **Consolidate repeated shape checks.** |
| P1-10 | \`planner-browser.py\` waits for one chunk, then immediately checks the exact same \`count()==1\` condition | Existing bounded \`wait_until\`, durable chunk status, next chunk identity and History projection. **Remove post-wait duplicate, not durable assertion.** |
| P1-11 | \`phase-time-runtime.py\`, \`ui-behaviour.py\`, \`restore-dialog-accessibility.py\`: exact predicate checked immediately after a bounded wait asserting identical predicate | Keep diagnostic wait and any later distinct state/evidence check. **Collapse mechanically repeated wait/check pairs.** |
| P1-12 | Multiple Node files repeat archive schema version ==2 against same constant and same healthy input | \`backup-codec.js\` owns canonical archive identity, build integrity owns release provenance, browser decoded compatibility path retained. **Remove only duplicated literal checks.** |
| P1-13 | \`fsrs-memory-lifecycle-browser.spec.py\` repeats raw New/Review/1d transition math from Node reference | \`fsrs-scheduler-reference.spec.js\` and \`fsrs-memory-lifecycle.spec.js\` own math; browser retains real controls, durable events and History. **Trim only identical raw-card checks.** |
| P1-14 | \`phase-time-runtime.py\` duplicates fake-clock totals already calculated by Node with same synthetic times | \`phase-time-runtime.js\` numerical oracle; browser maintains overlay classification, persisted session and final Evidence timing. **Review exact numeric overlap; do not remove browser boundary.** |
| P1-15 | \`ui-behaviour.py\` repeats gap-overlay focus checks 12 times in one session: later iterations target stress/listener accumulation rather than new semantics | Preserve 2–3 routine cycles **and a separately owned deep stress witness** before reducing. **Not deletable yet.** |
| P2-16 | Browser button-name loops in \`ui-runtime-accessibility.py\` versus post-injection security rendering | Different input: baseline keyboard vs hostile stored text. **Independent, keep both or share helper without deleting contracts.** |
| P2-17 | Restore dialog geometry/focus at six sizes versus six ordinary panes across 16 sizes | Modal open/focus trap vs normal pane layout; differing stimulus and failure. **Retain.** |
| P2-18 | Simulated hostile recovery/atomic abort versus native IndexedDB reload/restart/durability | Fault injection vs actual engine guarantees. **Retain all independent witnesses.** |
| P2-19 | Browser full WASM optimizer/34 weights versus Node holdout and upstream FSRS reference | Real provider training/worker vs independent math/reference. **Retain both.** |
| P2-20 | Exact vendor/package checks in build-integrity versus optimizer contract and scheduler reference | Artifact provenance vs consumed contract vs behavior. **Retain one for each boundary; delete only duplicate literals, never all three.** |

## Measured cost by file and named browser scenario

Source: [GitHub Actions run 43582317544, attempt 2](https://github.com/oneshubhamt/revision-director/actions/runs/43582317544). These are one run's **child-process wall-clock spans** from consecutive `==>` timestamps, not full job duration. The final entry is timed to its last `PASS` log and may slightly undercount process shutdown. The Python `QA_SCENARIO` markers use monotonic timers around named subjourneys. Different runs vary substantially with cold starts/CPU contention.

- Core static and Node test child time **4.08s**; standard browser plus timer **117.78s**; dedicated browser performance **28.95s**. Optimizer and hosted build setup is separate.
- In the prior green run 43581709503, the browser timing entry took 24.03s, while the new run took 17.87s. **Do not infer a reliable speed gain from two observations.**


### Core and static Python — file-level

| Executed file | Child seconds |
|---|---:|
| `tests/build-integrity.spec.py` | 0.03 |
| `tests/html-sanity.spec.py` | 0.03 |
| `tests/qa-runner.spec.py` | 0.44 |
| `tests/scenarios/public-plugin-runtime.js` | 0.04 |
| `tests/runtime-harness-ownership.spec.js` | 0.08 |
| `tests/fsrs-optimizer-contract.spec.js` | 0.04 |
| `tests/fsrs-scheduler-reference.spec.js` | 0.94 |
| `tests/fsrs-scheduler-integration.spec.js` | 0.31 |
| `tests/fsrs-optimizer.spec.js` | 0.02 |
| `tests/fsrs-memory-lifecycle.spec.js` | 0.09 |
| `tests/fsrs-scale.spec.js` | 0.19 |
| `tests/planner-policy.spec.js` | 0.05 |
| `tests/planner-properties.spec.js` | 0.06 |
| `tests/planner-persistence.spec.js` | 0.42 |
| `tests/scenarios/backup-codec.js` | 0.07 |
| `tests/scenarios/backup-controller.js` | 0.07 |
| `tests/scenarios/data-safety-controller.js` | 0.06 |
| `tests/kernel-policy.spec.js` | 0.07 |
| `tests/scenarios/production-contracts-storage.js` | 0.04 |
| `tests/scenarios/active-retrieval-persistence.js` | 0.72 |
| `tests/scenarios/phase-time-runtime.js` | 0.04 |
| `tests/scenarios/ownership-storage-health.js` | 0.20 |
| `tests/scenarios/reliability-closure.js` | 0.04 |
| `tests/scenarios/presentation-kernel.js` | 0.04 |

### Browser matrix — individual scenario entrypoints

| Executed file | Child seconds |
|---|---:|
| `tests/scenarios/phase-time-runtime.py` | 17.87 |
| `tests/scenarios/backup-codec.py` | 2.34 |
| `tests/scenarios/backup-restore-controller.py` | 3.33 |
| `tests/scenarios/data-safety.py` | 6.19 |
| `tests/scenarios/restore-dialog-accessibility.py` | 6.71 |
| `tests/scenarios/public-plugin-runtime.py` | 3.67 |
| `tests/scenarios/planner-browser.py` | 5.03 |
| `tests/scenarios/persistent-active-retrieval.py` | 6.28 |
| `tests/scenarios/ownership-storage-health.py` | 4.76 |
| `tests/scenarios/hostile-recovery.py` | 9.88 |
| `tests/scenarios/indexeddb-durability.py` | 0.63 |
| `tests/scenarios/native-indexeddb-journey.py` | 3.86 |
| `tests/canonical-topology-browser.spec.py` | 2.60 |
| `tests/scenarios/presentation-kernel.py` | 4.89 |
| `tests/scenarios/ui-runtime-accessibility.py` | 2.87 |
| `tests/scenarios/ui-behaviour.py` | 14.48 |
| `tests/scenarios/responsive-layout.py` | 3.81 |
| `tests/security-rendering-browser.spec.py` | 5.12 |
| `tests/fsrs-browser-integration.spec.py` | 3.29 |
| `tests/fsrs-memory-lifecycle-browser.spec.py` | 10.16 |

### Deep/performance extra witnesses

| Executed file | Child seconds |
|---|---:|
| `tests/scenarios/planner-performance.py` | 28.95 |
| `tests/fsrs-scheduling-policy-deep.spec.js` | 19.02 |
| `tests/fsrs-scale.spec.js` | 4.29 |
| `tests/fsrs-browser-integration.spec.py` | 27.94 |

### Named subjourney wall-clock measurements

| Browser subjourney | Seconds |
|---|---:|
| `public-api.intake-profile` | 1.94 |
| `planner.chunk-history` | 2.67 |
| `planner.execution-state` | 1.95 |
| `ui.clean-install-crud` | 2.03 |
| `security.stored-escaping` | 0.48 |
| `security.post-injection-a11y` | 0.20 |
| `fsrs.policy-settings` | 2.03 |
| `fsrs.workflow-chain` | 6.12 |
| `fsrs.corrective-memory` | 3.67 |
| `planner.capacity-reflow` | 7.38 |
| `planner.hostile-import` | 1.38 |
| `planner.large-dataset` | 2.04 |

Subjourney spans exclude the remainder of the script (browser connection, fixture restore, teardown and nonbracketed sections); do **not** sum them as total process time. All other browser scenario entrypoints have their individual process spans above. Browser tests with multiple internal phases not instrumented here are a stated profiling-resolution limit, not invented measurements.

## Independent evidence that must not be consolidated away

- **Native IndexedDB durability, real reload/restart and two-tab ownership** detect browser engine faults that the simulated-storage adapter cannot establish.
- **Hostile recovery, commit-token injection and simulator abort conformance** detect failure paths that native happy-path reload cannot establish.
- **Node planner exhaustive oracle and upstream FSRS differential parity** detect numerical errors; the browsers should not duplicate these calculations at high cost.
- **Real FSRS WASM training, stored-credential/Settings policy paths, backup restore ceremony and XSS rendering** detect integration and security failures that pure Node checks cannot.
- **Dialog focus trap under small screens and general pane overflow** use different inputs and detect different defects.

## Unresolved and next-pass evidence requirements

1. **Observed flake:** profiling run 43582317544 attempt 1 failed at `hostile-recovery.py.remove_frame` waiting for secondary ownership after `pagehide`. Attempt 2 passed without source change. Record as intermittent test/host-order sensitivity, **not** a confirmed product defect and **not** solved by retry. Future validation should include pending-transaction/lease diagnostics before any synchronization change.
2. **QA footprint guards are maintenance policies, not product invariants.** A source-text or file-count failure should not be mistaken for demonstrated user data loss. Preserve strict test ownership without turning historical vocabulary into runtime correctness.
3. **Timing is not controlled benchmarking.** Profile warmed repeated runs, median and p95 before quantifying savings. Phase-time and deep WASM costs vary with worker setup.
4. **No deletion has occurred in Pass E.** The follow-up consolidation pass must cite the ranked row and surviving witness, run targeted browser/Node QA, and reconcile the corresponding invariant row before removing or merging a test.
5. **Full QA verification:** GitHub Actions jobs for core, deep, optimizer, browser/durability, browser performance and generated artifact all passed on the profiling snapshot (one failed browser attempt was retried once and passed). The single serial `qa:full` CLI was not separately invoked.

## Pass F — completed implementation and surviving-witness reconciliation

**Source changes:** `f16c0ce` (P0 contracts and structural ownership), `1db5644` (domain/browser consolidation), `ec87f7e` (28 redundant post-wait assertions), followed by a small import/format cleanup. **No executable entrypoint deleted, no production/workflow changes.** All 46 entrypoints remain owned by the runner; the 98 invariant rows above retain the same owners or the explicit replacements below.

| Ledger item | What was replaced or removed | Surviving independent witness / disposition |
|---|---|---|
| P0-1 | Removed always-true `check(True)` from browser plugin status | `wait_local_file_settled`, visible Settings status, and loaded/failed/rejected status assertions in `public-plugin-runtime.py` |
| P0-2 | Replaced hard-coded browser application version in startup, intake and plugin callback | Browser version equals exported data-contract version and plugin's received version; Node `public-plugin-runtime.js` checks the public contract and capabilities |
| P0-3 | Removed arbitrary presentation-token count >=35 | `presentation-kernel.js` now requires named roles across all six token families, valid token prefix and uniqueness; `presentation-kernel.py` verifies computed browser CSS tokens |
| P0-4 | Removed restore-preview stat-card count >=6 | `data-safety.py` checks actual units/evidence counts against the decoded verified fixture, hash algorithm, archive descriptor, creation metadata and coherent document total; unchanged 64-hex checksum proof and safety gates remain |
| P0-5 | Removed historical filename/Pass/Stage and legacy-token source-string scans, obsolete-wrapper list and hard arbitrary footprint limit | `qa.py` now checks complete discovered-vs-declared executable entrypoint ownership, no duplicate runs, and AST-import-level native/simulated fixture separation; `qa-runner.spec.py` and the parsed Node module graph independently enforce execution and boundary contracts. Footprint continues as an audited maintainability metric, not correctness |
| P1-6/7 | Removed the repeated ordinary successful restore from `backup-codec.py`; its redundant happy-path assertion no longer duplicates the restore journey | `backup-restore-controller.py` retains actual safety-copy download, acknowledgement, completed restore and active-draft treatment; `backup-codec.py` still tests valid archive inspection/export/reinspection and tampered/raw import rejection. `data-safety.py` keeps the distinct cancel, active-safety, forensic rescue and hostile-import branches |
| P1-8 | Removed browser duplicate frozen kernel, registry identity, immutable re-registration and exact storage-key introspection | `presentation-kernel.js` owns registry/freeze/persistence; browser still verifies prepaint attributes, active presentation, computed token validity, absence of legacy CSS and globals, corrupt preference fallback, and both viewport journeys |
| P1-9 | Removed browser duplicate exact API key inventory, deep freezing and capability literal assertions | `public-plugin-runtime.js` retains the full public authority/API contract; browser retains hidden private-service sentinel, version parity, registration, actual local-file loading and error containment |
| P1-10/11 | Removed **27** redundant post-wait/retrieved-count assertions and one unused snapshot assignment from `planner-browser.py`, `ui-behaviour.py`, `restore-dialog-accessibility.py`, `phase-time-runtime.py` and `data-safety.py` | Original bounded waits (including focus and selection combinations), distinct persisted planner outcomes, History, time/evidence conservation, keyboard focus trap, cancel/same-file preview and negative error checks remain. The overlay wait now reports its exact cycle upon failure |
| P1-12 | Removed duplicate `BACKUP_ARCHIVE_VERSION===2` and `BACKUP_SCHEMA_VERSION===2` checks from backup/data-safety controller Node suites | Canonical codec validation in `backup-codec.js`, production schema in `production-contracts-storage.js`, build provenance, and both controller-level failure branches remain |
| P1-13 | Removed two raw numeric FSRS card-state assertions from the browser lifecycle | Upstream `fsrs-scheduler-reference.spec.js` and `fsrs-memory-lifecycle.spec.js` own state math; browser still checks persisted New schedule status, Again rating/evidence exactly once, suspension, relearn creation, repair, History and final restoration |
| P1-14 | **Kept** independent browser time conservation, persisted session and final Evidence checks | Node `phase-time-runtime.js` remains the mathematical oracle; only immediately repeated visible/wait checks were removed (P1-11) |
| P1-15 | **Kept** all 12 overlay focus cycles pending a separately owned stress witness | `ui-behaviour.py` continues to guard repeated inert-background/focus restoration and listener stability; no unproven test-count reduction |
| P2-16 through P2-20 | **Retained** independently triggered accessibility/security, modal responsive, simulated/native IndexedDB, WASM/Node and build/provider checks | Different inputs, defect classes or execution layers; not safely deletable as duplicates |

**Verification at source commit `ec87f7e`:** [GitHub Actions run 43586139979](https://github.com/oneshubhamt/revision-director/actions/runs/43586139979) passed core/TypeScript, native optimizer, deep FSRS including full WASM training, browser/durability, browser performance and generated artifacts. The final source commit `bee12e8` also passed all six CI jobs on [run 43586546247](https://github.com/oneshubhamt/revision-director/actions/runs/43586546247), with the browser/durability job passing on an unchanged retry. Its first attempt encountered the already observed intermittent delegated-profile-readiness timeout in `ui-behaviour.py`. This remains an explicit Pass H flake investigation, not an unresolved data-integrity regression or an assertion removed to make CI green.

**Measured structural effect:** baseline 590,150 bytes in 55 test files (Pass E) versus 584,538 bytes after final implementation cleanup, with all 46 test entrypoints retained; the shared helpers remain 33,991 bytes. This is source reduction, **not** a claimed wall-clock runtime gain. Pass H should benchmark repeated warmed samples and investigate the previously observed intermittent ownership-handoff timeout rather than masking it with retries.

### Exact redundant-check accounting (P1-10/11)

The following **27 checks** repeated a condition already required by a bounded wait or restore-preview helper. Their named wait is the surviving witness, so loss of the invariant still fails the test.

| Owner | Checks removed | Surviving condition |
|---|---:|---|
| `ui-behaviour.py` | 12 | Sidebar unit count; ArrowRight, End and Home tab selection; library focus and text selection; dialog initial and return focus; gap overlay appearance/disappearance; background becoming non-inert; return focus to Pause — all verified by existing waits or the combined focus wait with a cycle-specific failure message |
| `restore-dialog-accessibility.py` | 3 | Restore dialog opened, escaped/hidden and same-file reselected — each has its own `wait_for(state=...)`; geometry, trap and control-size checks remain |
| `planner-browser.py` | 5 | Initial chunk row/action, completed chunk in canonical storage, next distinct chunk/action and persisted History row — each has a bounded `wait_until`; parent scheduling and version/outcome checks remain |
| `phase-time-runtime.py` | 4 | Accumulated display time, paused CSS, inactive-gap overlay and compare-pane visibility — preserved through bounded clock/UI waits; persisted timer, gap classification and final Evidence assertions remain |
| `data-safety.py` | 3 | Preview open, cancel close and same-file preview reopen — established by `open_restore_preview` or dialog waits; unchanged-state and checksum assertions remain |

The associated `planner-browser.py` local variable `chunk_after` was also deleted because it existed only to feed one of those redundant checks. **No additional assertion was deleted for that variable.**

**Acceptance record:** 46/46 entrypoints retained; all six CI jobs passed for source commit `bee12e8` (one unchanged browser retry). The source-level/semantic witness map above is authoritative for Pass F removals; repeatability and the known UI readiness flake remain owned by Pass H.


## Pass G — independent reference and state-machine strengthening

**Verified source:** \`f7ebd3f2bc0d56ef03d8d35756ed4810035a6ed1\` on \`working\`. [Six-gate GitHub Actions run 43590104546](https://github.com/oneshubhamt/revision-director/actions/runs/43590104546) passed after one unchanged rerun of the existing browser matrix. **Scope:** six existing test files only; no production, build, CI, dependency or browser-harness changes, and all 46 QA entrypoints retained.

| Objective | New independent witness / input | Detected failure class and surviving owner |
|---|---|---|
| FSRS mathematical/reference correctness | Three fixed retention settings (0.82, 0.90, 0.95), five seeded ten-review sequences each; compare every transition with a fresh upstream FSRS-7 scheduler, replay identical immutable histories with different evidence IDs | Wrong per-policy scheduler configuration, replay/order errors, incorrectly using evidence identifiers in the formula; \`fsrs-scheduler-reference.spec.js\` is authoritative; browser full WASM optimizer is separate integration evidence |
| Planning metamorphic correctness | 64 seeded candidate sets at three capacity frontiers; exhaustive subset oracle for critical and normal selection at each capacity; score multiplication and +7-day calendar translation tested **separately**; unchanged input identity | Ranking/knapsack errors, score scaling drift, calendar-origin dependency, input mutation; \`planner-properties.spec.js\` owns mathematics; UI chunk/history and performance scenarios remain independent |
| Recovery state precedence and convergence | 96 three-way associativity/reference comparisons; 36 seeded local-vs-IndexedDB winners independently ranked by revision then timestamp, with both storage copies reconciled; newer completed tombstones tested in both backend directions | Non-transitive choice, wrong backend winner, stale store not repaired, completed session erroneously resurrected; \`active-retrieval-persistence.js\` owns policy, real/native and hostile-recovery browser tests own host behavior |
| Timing conservation | 64 deterministic event-ledger scenarios, each replayed at two calendar epochs; independently sum active attempt/compare time, pause, focus/break/ignore/split, classification prompt, backward-clock flags; reconstruct the same snapshot | Lost/overcounted time, phase misallocation, unreliable evidence not flagged, calendar-origin sensitivity, rehydration drift; \`phase-time-runtime.js\` owns numerical policy, browser Timing/Evidence integration stays independent |
| Exactly-once guarded publication | Eight seeded service-level state-machine cases: wrong revision/target/token/session, injected precommit failure, two concurrent attempts, successful postcommit state and rejected replay. Check no partial unit, obligation, evidence or active-session state | Host ignores guard or token, premature publication, duplicate evidence or partial state after failure; \`fsrs-memory-lifecycle.spec.js\` tests service publication using an explicitly atomic fake repository; it **does not** replace actual native IndexedDB evidence |
| Native transaction atomicity | Chromium on the **application's actual database**: attempt unit count and obligation due-date changes in the same strict transaction as a duplicate immutable evidence \`add\`; expect a ConstraintError-driven abort, original three stores intact, exactly one event after browser restart | Multi-store partial publication despite evidence conflict, duplicate immutable event after restart; \`native-indexeddb-journey.py\` tests the real storage engine. Existing \`hostile-recovery.py\` separately proves application commit-guard retry behavior under fault injection |

**Measured run output (including pre-existing checks):** 1,550 upstream FSRS checks; 9,219 planner checks across 564 seeded cases; 553 recovery checks; 1,024 timing checks; 110 memory-lifecycle checks; 28 native application IndexedDB checks. Counts measure executed assertions, **not** independent defect classes, and are not a goal to maximize.

**Pass G structural reconciliation:** six test files changed, 55 tracked test-related files remain, approximately 606,161 test-tree bytes (baseline after Pass F: 584,538), and helper footprint remains 33,991 bytes. Extra test code is limited to six pre-existing domain suites. No mathematical calculation was added to browser UI tests.

**QA and unresolved stability:** core/TypeScript, native optimizer, deep FSRS, browser performance, generated artifact sync and browser/durability all passed on the source commit. Browser matrix attempt 1 failed in an **existing** delegated profile creation journey: a settings rerender cleared the filled profile inputs before click, resulting in "Enter an exam-profile name." Browser matrix attempt 2 passed **without code changes**. This is an observed product/UI timing race; it is not a fix and is explicitly assigned to Pass H for source-level diagnosis and repeatable regression testing. Likewise preserve the previous pagehide ownership-handoff flake finding. Neither failure is evidence that a new FSRS, planner, recovery, time, transaction or publication assertion is wrong.

**Outcome:** every Pass G objective now has a corresponding explicit independent or state-machine witness; no existing invariant was removed. Pass H should verify fault sensitivity/mutations, repeat-run stability, realistic median/p95 economics, and correct the known UI ownership/rerender races without weakening the release checks.


## Pass H — CI economics, flakiness and adequacy (closure)

**Verified source SHA:** `27756ac03e09dda24124358f62b15c92efe7aeec`; all six jobs succeeded on [Actions run 43595206379](https://github.com/oneshubhamt/revision-director/actions/runs/43595206379), first attempt. The same SHA's complete browser/durability job then passed **two unchanged repeats** (three successes total); the browser-performance job also passed an unchanged repeat (two successes). No changes to production sources, generated artifacts, dependencies, workflow YAML, or releases.

### Permanent QA contract

| Layer / command | Required evidence and scheduling |
|---|---|
| `python3 tests/qa.py core` | Generated build/parity, static/TypeScript contracts, independent FSRS/reference and planner properties, recovery/timing/backup/authority/architecture checks; cheapest routine developer gate |
| `optimizer` | Actual pinned external optimizer smoke; install dependencies in setup, not in QA |
| `durability` | Browser active-time/interruptions, displayed Evidence, persistent session semantics |
| `browser` | All critical candidate/restore/FSRS/recovery/security/accessibility journeys. Independent simulated-context journeys use **at most two isolated Chromium processes**; ownership, hostile recovery, native IndexedDB and UI-focus stress run **serially**. Never parallelize independent CDP Playwright clients inside one Chromium |
| `performance` | 1,000-unit browser rendering/capacity, import and reflow; no duplicate Node knapsack mathematics |
| `deep` | Long-horizon FSRS simulation, full 4,608-event replay budget, real WASM optimizer, and **five genuine in-memory source mutations** against their primary Node oracle |
| `full` / release | All above once, with exact entrypoint ownership; all six existing GitHub CI jobs must be green, including artifact sync and native storage. No workflow changes were made |

**47 executable entrypoints** (46 existing plus `tests/qa-mutation-adequacy.spec.js`) remain unique. The runner emits `QA_PROCESS_TIME` for each child command and retains the existing `QA_SCENARIO` timers. No quick/smoke alias or new CI workflow was added because the existing fast core plus independently scheduled browser/deep/performance gates already cover the release obligation without duplicating expensive tests.

### Cost evidence, reproducibility and limits

Historical pre-H reference: **eight passing browser CI jobs across late Pass D–G commits**; source/tests varied, so this is an operational comparator, **not** a controlled A/B experiment. Post-H: **three passing browser jobs on one unchanged Pass H source SHA**, including two reruns without other scheduled job load. Measurements span from the `phase-time-runtime.py` invocation or first standard browser scenario to the last `QA_PROCESS_TIME` emission, excluding preparation and CI queue.

| Clocked span | Historical n=8 median | Pass H n=3 median | Historical nearest-rank p95 | Pass H nearest-rank p95 |
|---|---:|---:|---:|---:|
| Standard browser scenario matrix | 99.75 s | **74.53 s (−25.3%)** | 111.5 s | **87.85 s** |
| Browser plus preceding durability/time journey | 119.95 s | **107.42 s (−10.4%)** | 135.2 s | **121.31 s** |

Post-H total-duration observations: **121.31, 91.46, 107.42 seconds**; standard-browser observations **87.85, 70.41, 74.53 seconds**. Nearest-rank p95 with **three samples equals the observed maximum**, *not* a statistically stable tail forecast; historical hardware contention and different suite revisions limit causal interpretation. The source-level gain is credible for the browser portion, while the phase-time scenario's variability limits the end-to-end improvement.

Median per-scenario child timings on Pass H's three runs: phase-time **31.99 s** (max 32.50), UI behavior **10.35 s** (max 13.01), FSRS memory/browser **9.92 s** (max 11.00), hostile recovery **9.71 s** (max 10.53), restore dialog **9.19 s** (max 10.67). Browser-performance process durations in two runs were **35.97 s** and **20.66 s** (median 28.31 s); do **not** infer a stable performance gain from this highly variable two-point sample. Core and deep gates remain complete; deep mutation adequacy added about **0.43 s** in one measured run.

### Adequacy and failure-path reconciliation

- **Mutation kills: 5/5.** Deliberate FSRS-retention forwarding, critical-priority, recovery revision-comparator, elapsed-time arithmetic and guarded deterministic-evidence-ID defects were injected only into *isolated in-memory compiled application copies*. Each designated canonical Node suite failed with a corresponding semantic error. No mutation touched tracked files or generated artifacts.
- **Deterministic replay and baseline equivalence:** Existing Pass G seeded FSRS reference, exhaustive planner, three-way recovery precedence, timing conservation, exactly-once service publication and native rollback assertions remain. Every test-file diff is in QA; application source and generated artifacts are unchanged from the previously verified Pass G baseline. Full CI, including generated-artifact sync, remained green.
- **Native persistence:** Real Chromium IndexedDB backup/reload, second-tab read-only ownership, strict transaction rollback on duplicate immutable evidence, and browser restart with exactly one event passed in each of the three completed browser runs. Simulated hostile commits remain a *separate* injected failure witness.
- **Hostile handoff investigation:** The old test dispatched synthetic `pagehide` but kept the iframe alive, creating an unrealistic interval during which ownership reacquisition was possible. The fixture now dispatches `pagehide` and removes the iframe within one browser task, then asserts that the shared owner lease was released. All three same-commit browser runs passed; the original timeout's exact interleaving was not directly captured, so the root cause is plausible rather than conclusively proven. Production ownership code was not changed.
- **UI timing:** Settings and Library tests now use a forced fresh-pane render barrier before editing input controls; the performance capacity test does likewise. Dirty-library focus/selection still must pass; on failure it now reports focus, selection, filter and visible rows. This removes *test-side interaction with an unfinished render*, not an assertion. It does **not** establish that arbitrary real-user input cannot be lost by an unrelated asynchronous production rerender: that potential product-side race remains worth targeted source work when production/generated artifact edits are authorized.
- **Rejected optimization:** Concurrent Playwright processes attached to the **same shared CDP Chromium** caused browser-global JavaScript-dialog interference (observed failures in backup/restore). That configuration was rejected. The accepted implementation isolates independent workers in their own Chromium processes and preserves an explicit serial tail for sensitive cases. At most two worker processes run at once.

**Closure confidence:** 3/3 unchanged browser-matrix repetitions plus two passing performance executions are meaningful regression evidence, but are insufficient to claim a zero-flake lifetime or a stable p95 forecast. Keep all release gates, monitor the known host/UI sensitivity, and treat any new intermittent failure as an investigation rather than automatically weakening assertions or silently retrying in CI. Further CI workflow changes require owner approval.
