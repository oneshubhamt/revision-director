# Scheduling and planning

## Responsibility boundary

Revision Director separates two questions:

- **Memory scheduler:** when should this memory item next be recalled?
- **Application planner:** among all revision obligations, what should the learner do today?

FSRS owns memory decay and memory intervals. Revision Director owns exam urgency, capacity, evidence weakness, subject balance, corrective workflows, interleaving and non-memory practice policies. Planner logic must not rewrite FSRS memory state merely to make an item more urgent.

## FSRS-7

Memory recall uses the vendored `ts-fsrs@6.0.0` runtime with **FSRS-7 only**.

Current runtime policy:

- scheduling policy: an application-owned discriminated policy; the measured `cost-adr` preset is the default for new installations, while `fixed-retention` remains an explicit alternative with user target default `0.90`;
- dual-trace state: `stability`, `stabilityFast`, `difficulty`;
- fractional elapsed days;
- short-term middleware enabled;
- learning step: `1d`;
- relearning step: `1d`;
- graduating interval: `1d`;
- `allowModelOverride: true`;
- fuzz disabled;
- maximum interval: 36,500 days;
- stock FSRS-7 weights by default, with an explicitly activated validated optimizer profile as the only alternative.

Scheduler policy and model weights are independent configuration axes. Scheduler identity contains the complete policy plus complete weight provenance. The policy contract is discriminated as `fixed-retention` or `cost-adr`. Cost-ADR is enabled only as Revision Director's measured preset: the upstream default 15-coefficient policy and state/retention bounds with goal cost weight **1024**. Arbitrary cost weights or coefficient editing are intentionally unavailable. The runtime composes the same vendored FSRS-7 model and chronology while replacing fixed desired-retention middleware with upstream Cost-ADR middleware; all later scheduling middleware remains in the upstream order.

The one-day step is a product adaptation for long-form revision sessions: it prevents seconds/minutes-scale flashcard behaviour while still allowing the FSRS model to choose longer intervals when appropriate. It is intentionally retained even though a one-day learning step equals the one-day graduation interval: Revision Director intercepts `Again` with a separate host-owned corrective workflow rather than allowing a failed memory to continue through an ordinary flashcard learning-step loop.

### Advanced scheduling experiment gate

The permanent scheduling experiment uses the pinned vendored runtime directly. Its representative workload models 72 memory items, six deterministic recall-quality archetypes, 15-minute long-form sessions, and a representative successful corrective path: direct `Again` → suspended memory → next-day corrective verification → successful FSRS return. It evaluates 90-, 365- and 730-day horizons and compares Cost-ADR against fixed-retention targets 0.84, 0.86, 0.88, 0.90 and 0.92. Failed corrective verification is now canonical FSRS evidence too; broader outcome-sensitive policy recalibration is intentionally a separate scheduling-policy decision rather than hidden inside this lifecycle correction.

Under the production `1d` learning/relearning configuration, the selected Cost-ADR goal weight 1024 reduced modeled total long-form sessions versus fixed 0.90 by **21.3% at 90 days, 21.3% at 365 days and 24.7% at 730 days**. Mean retrievability at established-memory review opportunities changed by approximately **−0.13, +0.11 and −0.07 percentage points**, respectively; none of the tested fixed-retention alternatives Pareto-dominated the preset. The activation gate requires at least a 10% workload reduction with no more than a one-percentage-point mean established-memory retrievability loss, or a one-percentage-point retention gain with no more than 5% extra workload.

This is a deterministic product benchmark, not a clinical efficacy claim, a statistical confidence interval or proof that Cost-ADR is superior for every learner. The size and consistency of the measured workload benefit are nevertheless sufficient to make the measured Cost-ADR preset the default for **new installations**. Fixed retention remains available as an explicit alternative. Existing persisted scheduling choices are not silently rewritten: they remain authoritative until the user changes policy, at which point the existing complete atomic scheduler rebase applies.

Learning-step alternatives were tested separately. A 23-hour step preserves FSRS Learning/Relearning state after `Again`, whereas the current one-day step reaches Review immediately; however, after Revision Director's real next-day corrective return, the 23-hour variant scheduled the next review at **2.4375 days** versus **3 days** for the current one-day adaptation and did not establish a compensating application-level benefit. Twelve-hour, no-step and upstream minute-scale defaults were still more aggressive. The production learning and relearning steps therefore remain `1d`.

## Replay truth and materialized state

Append-only Evidence Events are the canonical review history. Direct memory reviews and successful returns from corrective relearning normalize into one chronological stream.

The stored FSRS card is a materialized projection for fast planning, not an independent source of truth. Revision Director uses one scheduler-forward replay path to rebuild and verify reviewed cards. Before preview, review or retrievability, the active projection is checked against canonical history.

When scheduler identity changes, historical Evidence Events retain the configuration that actually produced each transition. At a configuration boundary the replay verifier checks both the reprojected before-state and the resulting after-state for reviews produced under the active configuration. Immutable counters and last-review chronology must survive the boundary.

Retrievability is calculated from the replay-verified current dual-trace state and scheduler chronology. There is no separate model-forward replay implementation.

Replay verification is deliberately optimized without changing that trust model. A scheduler instance keeps only a transient fingerprint of projections it has already replay-verified under that exact scheduler configuration; unchanged preview, review and retrievability calls can therefore reuse the verification result while still validating the canonical chain. Dataset-integrity boundaries such as startup, restore and scheduler rebase explicitly force replay and cannot be satisfied from this cache. Target-scheduler rescheduling itself is also a real replay.

The application likewise keeps a transient normalized memory-review index for the current append-only Evidence Event snapshot. Ordinary planning and preview calls reuse it while the evidence endpoints/count are unchanged. Successful evidence writes, restore/import and service reinitialization invalidate that analysis cache. Neither cache is persisted, exported or treated as canonical state.

## Personalization and scheduler rebases

Revision Director has two implementations of the same personalization boundary:

- the pinned native optimizer in `tools/fsrs-optimizer/`, retained as the reference implementation;
- an optional browser-local optimizer that uses the pinned single-threaded WASIp1 binding in a dedicated Worker.

Both runtimes call the same optimizer core for chronological conversion, validation-candidate training, later holdout comparison, final retraining and profile assembly. The browser path differs only in Worker/WASM initialization, Web Crypto hashing, progress delivery and cancellation. No review evidence is uploaded to an optimizer service.

### Canonical optimizer evidence

Optimizer history preserves the memory outcome independently of workflow-cost measurement. Direct memory reviews export the closed-book `attempt` phase as `review_duration`; every memory-linked corrective relearning event exports its closed-book `relearn-verify` phase, including unsuccessful verification. Comparison, source-assisted repair and other workflow time remain available to Revision Director's capacity/duration model but are not represented as memory-review cost.

If timing is unreliable, the review remains in chronological recall history with its rating/state, while `review_duration` is exported as `0` (unavailable cost for the pinned converter) rather than substituting full-workflow time. The pinned FSRS converter currently requires a non-negative integer duration field but constructs parameter-training items from card/rating/time/state chronology rather than that duration.

The exact canonical CSV is SHA-256 fingerprinted. Every imported or locally optimized profile must match the current evidence checksum before it can be staged, and the checksum is checked again immediately before activation. Thus reviews added or changed while a profile is being optimized or waiting staged force re-optimization rather than allowing stale weights to become active.

A profile is eligible only when it contains exactly 34 valid FSRS-7 weights and records the required evaluation provenance. The external tool:

1. trains a candidate on the historical first five-sixths;
2. evaluates stock FSRS-7 and the candidate on the chronological final sixth;
3. requires at least 64 training items, 64 holdout items and 16 holdout cards;
4. requires a **practical** held-out log-loss improvement over stock: at least 0.001 absolute or 0.5% relative, whichever is larger;
5. requires no held-out RMSE-bins calibration regression;
6. retrains final weights on all eligible evidence after the gate passes;
7. records upstream time-series evaluation separately.

The practical-improvement threshold is an activation guard against epsilon-sized wins on one holdout, not a claim of statistical significance. Calibration remains separately inspectable through RMSE-bins: the UI reports stock → personalized calibration and whether it improved or remained unchanged. The gate never trades worse calibration for a tiny discrimination gain.

Native import and successful browser optimization both **stage only**. Local optimization never activates weights automatically. Activation, deactivation and every scheduling-policy change are explicit scheduler rebases. A rebase:

- is rejected while an active retrieval exists;
- first verifies the current dataset against the current scheduler;
- replays every reviewed memory obligation under the target scheduler;
- atomically stores the target settings identity and rebuilt memory projections;
- records the prior and target configuration fingerprints in scheduler-owned rebase metadata;
- never rewrites historical Evidence Events.

Backup/restore preserves staged or active personalization state. Restore prepares the referenced scheduler configuration and independently verifies every materialized memory projection before replacing current data.

The ordinary `index.html` remains the self-contained `file://` distribution and does not embed optimizer assets. This is a measured packaging decision: at the F3 audit the tracked self-contained HTML was 789,009 bytes, while the official pinned `0.6.1` release asset `fsrs-binding.wasm32-wasip1.wasm` is 1,396,770 bytes (about 1.77× the entire HTML before Worker/runtime code). Base64-inlining that binary alone would add about 1.86 MB. The optional optimizer-enabled static distribution therefore keeps the Worker and WASM as local sibling assets and instantiates them only when **Optimize locally** is pressed. Its build records actual installed Worker/WASM byte sizes in `optimizer-footprint.json`; this prevents convenience tooling from silently bloating the principal artifact.

## Rating semantics

Memory ratings describe **recall quality**, not a generic percentage score.

Objective retrieval evidence suggests:

- **Again** when recall is substantially missing or dependent on major/source cueing;
- **Hard** when recall is partial, cued or contains meaningful errors;
- **Good** when the target is recalled completely and independently;
- **Easy** remains an explicit user judgement for unusually effortless retrieval rather than being auto-awarded from a generic rubric.

The user confirms the final rating.

## Corrective relearning

An `Again` review advances the FSRS-7 state and creates a separate corrective `relearn` obligation. The original memory obligation is suspended rather than independently rescheduled by application code.

Corrective work normally becomes due one day later. When a known examination is closer than that, the relearning due date is capped at the examination deadline so corrective work cannot be silently scheduled beyond the exam. This changes only the application-owned relearning obligation; the FSRS memory-card due date is not rewritten.

Closed-book corrective verification is the exact boundary back into FSRS-7. Every verification advances the original memory card once with a normalized memory-verification rating: an explicit `Again` remains `Again`; an objectively unsuccessful non-`Again` verification is capped at `Hard`; a qualifying `Good` or `Easy` remains successful. `Again` or `Hard` therefore remains genuine memory evidence while the repair obligation stays active and the original memory stays suspended; the first qualifying `Good` or `Easy` verification completes the repair and returns the memory obligation to the normal queue. Source-assisted repair itself never becomes an FSRS observation. The application does not substitute a hard-coded post-relearning interval.

## Learning difficulty and persistent difficulty

Revision Director distinguishes **initial-learning difficulty** from **established-memory lapses** using canonical memory-review history. Failures before the first successful `Good`/`Easy` memory observation are counted as early-learning failures even if the one-day learning-step adaptation has already moved the raw FSRS card into Review state. After two such failures the planner and corrective guidance flag early learning difficulty. Only failures after a demonstrated successful memory observation count toward host remediation/persistent-difficulty policy.

The raw FSRS lapse counter remains part of the canonical card projection, but host difficulty policy is derived from the canonical review sequence so the one-day product adaptation cannot misclassify a pre-establishment corrective failure as an established-memory lapse. Revision Director still does not install `schedulerLeechMiddleware`, and persisted FSRS cards may not use `scheduleStatus: suspended`.

The host policy is:

- fewer than 2 established recall failures: normal corrective relearning;
- 2–3 established recall failures: **remediation**, adding source review and a changed retrieval representation;
- 4+ established recall failures: **persistent difficulty**, escalating to scope review, prerequisite review, source review, representation change and deliberate intervention; oversized work is also flagged for splitting;
- optional automatic hold: disabled by default; when explicitly enabled, the default threshold is 8 established recall failures.

Persistent difficulty does not bypass the recovery mechanism. Even when automatic hold is enabled, successful closed-book relearning first advances the original memory card through FSRS with a successful return transition. Only then may the **Revision Director obligation** remain suspended with reason `persistent-difficulty`. The FSRS card itself remains schedulable and its `scheduleStatus` is not mutated. Initial-learning difficulty can raise weakness and corrective priority, but it can never trigger this established-memory hold policy.

A held item can be deliberately resumed from the Library. Disabling automatic hold, or changing thresholds so an existing policy-generated hold no longer qualifies, atomically releases that hold while preserving any independent unit-level pause. Avoiding automatic hold leaves persistently difficult items in the normal queue but visibly flagged, with a strong weakness signal in planning. Difficulty level is derived from canonical memory-review history; Revision Director does not persist a second mutable leech counter. The raw FSRS lapse counter remains part of scheduler state and replay integrity, but it does not independently determine host difficulty under the one-day learning-step adaptation.

## Exam horizon

An exam deadline is a planner constraint, not an FSRS parameter. If an FSRS due date falls after a known exam, the planner may offer one final memory-review opportunity inside the final three days. That opportunity does not mutate the FSRS card due date and is suppressed after a review has already occurred in that final window. Examination proximity also raises the planner score of otherwise identical difficult memories, while corrective relearning is deadline-capped as described above; neither mechanism mutates the underlying FSRS schedule.

## Non-memory policies

Concept reconstruction, application practice, performance practice, freshness review and corrective relearning use explicit deterministic policies rather than pretending to be FSRS cards. Their evidence and intervals remain separate from memory-recall state.

## Planner signals

The daily planner combines transparent signals such as:

- due/overdue risk;
- examination proximity;
- unit importance;
- evidence weakness;
- FSRS retrievability for memory obligations;
- adaptive duration estimate;
- weekly subject balance;
- capacity;
- bounded interleaving penalties.

Weekly balance is profile-qualified so identically named subjects from different exams cannot collide. Interleaving only reorders candidates sufficiently close in score; severe overdue work and active relearning are not displaced for variety. Under fixed retention, retrievability can contribute additional risk relative to the fixed target. Under Cost-ADR there is no single target retention, so the planner trusts scheduler-owned `dueAt` for adaptive memory timing rather than reimplementing the Cost-ADR policy.

The planner weights are operational heuristics, not calibrated predictors of examination marks. Equal-score/equal-due candidates use stable obligation/chunk identifiers as the final tie-breaker so equivalent stored data produces the same plan ordering regardless of IndexedDB or backup record order.

## Duration learning

Duration estimates learn only from completed, plausible and reliable execution:

- exact-obligation evidence has greatest weight;
- same-unit/same-workflow and global-workflow evidence are weaker fallbacks;
- recent samples receive greater weight;
- weighted medians reduce outlier sensitivity;
- per-review movement is bounded;
- unreliable interruption timing remains evidence but does not train duration estimates.

## Automatic splitting and synthesis

Work that exceeds available capacity may be split into execution chunks with a reserved final synthesis. Chunks are execution units, not independent memory cards.

The parent policy owns its due date. Chunk completion and `synthesis-ready` state must never overwrite an FSRS due date. Synthesis readiness makes the work immediately plannable through planner state, not by falsifying the parent scheduler timestamp.

Untouched cycles may reflow when capacity changes; partially completed cycles remain stable to preserve scope and auditability.

## Persisted plans

The initial recommendation is immutable. Material regeneration, capacity change or manual addition creates a new plan version. Actual execution is stored as outcomes rather than rewriting the original proposal.
