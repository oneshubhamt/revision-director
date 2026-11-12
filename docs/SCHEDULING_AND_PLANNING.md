# Scheduling and planning

## Responsibility boundary

Revision Director separates two questions:

- **Memory scheduler:** when should this memory item next be recalled?
- **Application planner:** among all revision obligations, what should the learner do today?

FSRS owns memory decay and memory intervals. Revision Director owns exam urgency, capacity, evidence weakness, subject balance, corrective workflows, interleaving and non-memory practice policies. Planner logic must not rewrite FSRS memory state merely to make an item more urgent.

## FSRS-7

Memory recall uses the vendored `ts-fsrs@6.0.0` runtime with **FSRS-7 only**.

Current runtime policy:

- scheduling policy: an application-owned discriminated policy; the currently enabled policy is `fixed-retention`, with user target default `0.90`;
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

Scheduler policy and model weights are independent configuration axes. Scheduler identity contains the complete policy plus complete weight provenance. The policy contract is discriminated as `fixed-retention` or `cost-adr`; the Cost-ADR variant already validates the exact upstream policy shape (15 coefficients, cost-weight bounds, retention bounds, state bounds and goal cost weight), but **Cost-ADR execution is intentionally fail-closed in this build** until its runtime middleware is implemented and evaluated.

The one-day step is a product adaptation for long-form revision sessions: it prevents seconds/minutes-scale flashcard behaviour while still allowing the FSRS model to choose longer intervals when appropriate.

## Replay truth and materialized state

Append-only Evidence Events are the canonical review history. Direct memory reviews and successful returns from corrective relearning normalize into one chronological stream.

The stored FSRS card is a materialized projection for fast planning, not an independent source of truth. Revision Director uses one scheduler-forward replay path to rebuild and verify reviewed cards. Before preview, review or retrievability, the active projection is checked against canonical history.

When scheduler identity changes, historical Evidence Events retain the configuration that actually produced each transition. At a configuration boundary the replay verifier checks both the reprojected before-state and the resulting after-state for reviews produced under the active configuration. Immutable counters and last-review chronology must survive the boundary.

Retrievability is calculated from the replay-verified current dual-trace state and scheduler chronology. There is no separate model-forward replay implementation.

## Personalization and scheduler rebases

Optimization remains outside the browser runtime. Revision Director exports chronological review evidence; the pinned native tool in `tools/fsrs-optimizer/` produces a versioned FSRS-7 profile.

A profile is eligible only when it contains exactly 34 valid FSRS-7 weights and records the required evaluation provenance. The external tool:

1. trains a candidate on the historical first five-sixths;
2. evaluates stock FSRS-7 and the candidate on the chronological final sixth;
3. requires at least 64 training items, 64 holdout items and 16 holdout cards;
4. requires strictly lower held-out log loss and no RMSE-bins regression;
5. retrains final weights on all eligible evidence after the gate passes;
6. records upstream time-series evaluation separately.

Importing a profile only stages it. Activation, deactivation and every scheduling-policy change are explicit scheduler rebases. A rebase:

- is rejected while an active retrieval exists;
- first verifies the current dataset against the current scheduler;
- replays every reviewed memory obligation under the target scheduler;
- atomically stores the target settings identity and rebuilt memory projections;
- records the prior and target configuration fingerprints in scheduler-owned rebase metadata;
- never rewrites historical Evidence Events.

Backup/restore preserves staged or active personalization state. Restore prepares the referenced scheduler configuration and independently verifies every materialized memory projection before replacing current data.

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

After successful closed-book relearning verification, the original memory obligation is advanced again through FSRS-7 with a successful rating. The application does not substitute a hard-coded post-relearning interval.

## Persistent difficulty

Revision Director deliberately uses the **FSRS lapse counter as a signal**, not upstream leech suspension as an independent lifecycle. The vendored default scheduler already records a lapse only when an `Again` occurs from FSRS `Review` state. Revision Director does not install `schedulerLeechMiddleware`, and persisted FSRS cards may not use `scheduleStatus: suspended`.

The host policy is:

- fewer than 2 FSRS lapses: normal corrective relearning;
- 2–3 lapses: **remediation**, adding source review and a changed retrieval representation;
- 4+ lapses: **persistent difficulty**, escalating to scope review, prerequisite review, source review, representation change and deliberate intervention; oversized work is also flagged for splitting;
- optional automatic hold: disabled by default; when explicitly enabled, the default threshold is 8 FSRS lapses.

Persistent difficulty does not bypass the recovery mechanism. Even when automatic hold is enabled, successful closed-book relearning first advances the original memory card through FSRS with a successful return transition. Only then may the **Revision Director obligation** remain suspended with reason `persistent-difficulty`. The FSRS card itself remains schedulable and its `scheduleStatus` is not mutated.

A held item can be deliberately resumed from the Library. Disabling automatic hold, or changing thresholds so an existing policy-generated hold no longer qualifies, atomically releases that hold while preserving any independent unit-level pause. Avoiding automatic hold leaves persistently difficult items in the normal queue but visibly flagged, with a strong weakness signal in planning. Difficulty level is derived from the authoritative FSRS lapse count; Revision Director does not persist a second mutable leech counter.

## Exam horizon

An exam deadline is a planner constraint, not an FSRS parameter. If an FSRS due date falls after a known exam, the planner may offer one final memory-review opportunity inside the final three days. That opportunity does not mutate the FSRS card due date and is suppressed after a review has already occurred in that final window.

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

Weekly balance is profile-qualified so identically named subjects from different exams cannot collide. Interleaving only reorders candidates sufficiently close in score; severe overdue work and active relearning are not displaced for variety.

The planner weights are operational heuristics, not calibrated predictors of examination marks.

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
