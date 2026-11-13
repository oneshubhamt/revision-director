# Scheduling and planning

## Responsibility boundary

Revision Director separates two questions:

- **Memory scheduler:** when should this memory item next be recalled?
- **Application planner:** among all revision obligations, what should the learner do today?

FSRS owns memory decay and memory intervals. Revision Director owns exam urgency, capacity, evidence weakness, subject balance, corrective workflows, interleaving and non-memory practice policies. Planner logic must not rewrite FSRS memory state merely to make an item more urgent.

## FSRS-7

Memory recall uses the vendored `ts-fsrs@6.0.0` runtime with **FSRS-7 only**.

Current runtime policy:

- scheduling policy: an application-owned discriminated policy; `fixed-retention` at `0.90` is the measured default for new installations, while the bounded Cost-ADR 1024 preset remains an explicit optional alternative;
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

Scheduler policy and model weights are independent configuration axes. Scheduler identity contains the complete policy plus complete weight provenance. The policy contract is discriminated as `fixed-retention` or `cost-adr`. The new-install default is fixed retention at **0.90**. Cost-ADR remains available only as a bounded comparison preset using the upstream default 15-coefficient policy/state bounds with goal cost weight **1024**; arbitrary cost weights or coefficient editing are intentionally unavailable. Its runtime still composes the same vendored FSRS-7 model and chronology while replacing fixed desired-retention middleware with upstream Cost-ADR middleware; all later scheduling middleware remains in the upstream order.

The one-day step is a product adaptation for long-form revision sessions: it prevents seconds/minutes-scale flashcard behaviour while still allowing the FSRS model to choose longer intervals when appropriate. It is intentionally retained even though a one-day learning step equals the one-day graduation interval: Revision Director intercepts `Again` with a separate host-owned corrective workflow rather than allowing a failed memory to continue through an ordinary flashcard learning-step loop.

### Advanced scheduling experiment gate

The permanent FSRS-R2 experiment invokes the pinned vendored runtime directly and models Revision Director's corrected host lifecycle rather than feeding the scheduler fixed rating scripts. It uses 48 memory items across 90-, 365- and 730-day horizons and three deterministic sensitivity scenarios. Initial closed-book recall is stressed at 58%, 72% and 84%; source-assisted repair is not itself an FSRS review, but the later closed-book verification receives an explicit +5, +12 or +18 percentage-point recall-probability sensitivity assumption. After the first direct `Again`, verification occurs at +1 day; unsuccessful verification advances FSRS and remains in host corrective work, with the next verification at +1 day after `Again` or +2 days after `Hard`, exactly matching the application lifecycle.

For reviewed cards, the FSRS forgetting curve supplies the recall probability. A deterministic per-card/per-observation draw decides whether retrieval fails, so longer intervals can cause more `Again` outcomes and additional corrective sessions. The same latent draw sequence is reused across policies, making the comparison reproducible while preserving schedule-dependent outcomes. These scenario assumptions are sensitivity inputs for engineering selection, not clinical estimates of learner behaviour.

Learning/relearning alternatives tested were `1d`, `23h`, `18h`, `12h`, no explicit steps and upstream minute-scale steps. The **1d** policy remained the lowest-workload operational candidate: 5,250 modeled sessions across the full matrix. The 23-hour alternative used 5,372 sessions (+2.3% aggregate; up to +7.6% in the worst cell) for a small recall/retrievability gain. Twelve-hour and shorter alternatives introduced sub-20-hour scheduling and higher workload. Revision Director therefore retains **1d** learning and relearning steps; early-learning semantics remain host-derived from canonical memory history rather than raw FSRS state labels.

The scheduling-policy sweep retested fixed retention **0.84, 0.86, 0.88, 0.90 and 0.92** plus Cost-ADR goal weights **64, 128, 256, 384, 512, 640, 768, 896 and 1024**. Fixed 0.84–0.88 reduced sessions but breached the one-percentage-point recall-rate / one-percentage-point mean-retrievability guardrails in at least one sensitivity cell. Fixed 0.92 improved memory metrics but raised aggregate workload to 6,298 sessions. Fixed **0.90** was the lowest-workload candidate that remained inside all production guardrails.

The earlier fixed-rating benchmark had made Cost-ADR 1024 look substantially cheaper because schedule length could not increase simulated failure. Under the outcome-sensitive model that advantage disappeared: Cost-ADR 1024 used **6,189 sessions versus 5,250** for fixed 0.90 (+17.9% aggregate), reached a worst-cell workload increase of **48%**, and breached both the recall-rate and mean-retrievability guardrails. Several Cost-ADR weights also became Pareto-dominated by fixed-retention choices in individual cells. Cost-ADR is therefore **not** the new-install default. The bounded 1024 preset remains available for explicit comparison/research without implying that it is production-optimal for Revision Director.

Fuzzing was measured on the selected fixed-0.90 / 1d policy using ts-fsrs's deterministic card-ID/review-count fuzz. It reduced aggregate sessions slightly (5,250 → 5,176, about 1.4%) but produced **no improvement in p95 due-day load**, worsened mean peak due-day load from about **8.33 to 9.00**, and incurred small worst-cell recall/retrievability losses. Since its intended spreading benefit was absent in this workload, production **keeps fuzz disabled**.

The selection guard is deliberately conservative: a new default must stay within +1 percentage point worst-cell direct-Again rate, −1 percentage point mean direct retrievability and −2 percentage points minimum direct retrievability versus fixed 0.90; a non-baseline winner must also deliver at least a 5% aggregate workload reduction. Fuzzing has tighter memory guards and must materially improve p95 or peak due-day concentration without adding more than 1% workload. This is a deterministic engineering benchmark, not a clinical efficacy claim or statistical confidence interval. Existing persisted scheduler choices are never silently rewritten; explicit policy changes continue to use the atomic replay/rebase path.

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

The exact canonical CSV is SHA-256 fingerprinted. Every imported or locally optimized profile must match the current evidence checksum before publication. A stock→personalized candidate is checked again immediately before activation. While personalized weights are already active, the incumbent remains authoritative throughout optimization; the candidate records the incumbent source checksum and weights fingerprint used for the same final-sixth holdout comparison. Publication fails if either the evidence snapshot or incumbent profile changed while training was running.

A profile is eligible only when it contains exactly 34 valid FSRS-7 weights and records the required evaluation provenance. The shared optimizer core:

1. trains a candidate on the historical first five-sixths;
2. evaluates stock FSRS-7 and the candidate on the chronological final sixth;
3. when a personalized profile is active, evaluates those incumbent weights on **the same holdout**;
4. requires at least 64 training items, 64 holdout items and 16 holdout cards;
5. requires a **practical** held-out log-loss improvement over stock: at least 0.001 absolute or 0.5% relative, whichever is larger;
6. for replacement optimization, requires the same practical improvement over the incumbent profile as well;
7. requires no held-out RMSE-bins calibration regression versus stock or, for replacement optimization, versus the incumbent;
8. retrains final weights on all eligible evidence only after those gates pass;
9. records upstream time-series evaluation separately.

The practical-improvement threshold is an activation guard against epsilon-sized wins on one holdout, not a claim of statistical significance. Calibration remains separately inspectable through RMSE-bins: the UI reports stock → personalized calibration and whether it improved or remained unchanged. The gate never trades worse calibration for a tiny discrimination gain.

From stock FSRS-7, native import and successful browser optimization still **stage only**, and initial activation remains explicit. Once personalized weights are active, R3 permits re-optimization without returning to stock: the incumbent remains active while training runs, and a candidate that beats both stock and incumbent is published through one personalized→personalized atomic rebase. Imported replacement profiles must carry the same incumbent comparison provenance. Activation, replacement, deactivation and every scheduling-policy change use the same explicit scheduler-rebase mechanism. A rebase:

- is rejected while an active retrieval exists;
- first verifies the current dataset against the current scheduler;
- replays every reviewed memory obligation under the target scheduler;
- atomically stores the target settings identity and rebuilt memory projections;
- records the prior and target configuration fingerprints in scheduler-owned rebase metadata;
- never rewrites historical Evidence Events.

Backup/restore preserves staged or active personalization state. Integrity verification prepares the current scheduler plus every distinct historical scheduler configuration referenced by immutable memory evidence, resolving displaced personalized weights from the replay-profile catalog before replay. This is done explicitly on cold startup, backup verification, rebase and restore rather than relying on an in-process scheduler cache. Restore independently verifies every materialized memory projection before replacing current data.

The root `index.html` remains the self-contained `file://` **portable fallback** and does not embed optimizer assets. This remains a measured packaging decision: at the F3 audit the tracked self-contained HTML was 789,009 bytes, while the official pinned `0.6.1` release asset `fsrs-binding.wasm32-wasip1.wasm` is 1,396,770 bytes (about 1.77× the entire HTML before Worker/runtime code). Base64-inlining that binary alone would add about 1.86 MB.

For normal hosted deployment, `npm run build:hosted` now produces `Revision_Director_Hosted/` with the existing Worker and WASM shipped as local sibling assets by default. A host application's PWA shell can package/cache that directory, but Revision Director does not claim a web-app manifest or service worker as part of this pass. The optimizer is still lazy: the Worker/WASM runtime is instantiated only when optimization is requested, so normal application startup does not pay the optimizer execution cost. The hosted builder records exact HTML, Worker and WASM sizes in `optimizer-footprint.json`, preserves pinned binary identity and copies required licence texts. No network optimizer backend is introduced.

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
