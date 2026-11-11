# Scheduling and planning

## Responsibility boundary

Revision Director separates two questions:

- **Memory scheduler:** when should this memory item next be recalled?
- **Application planner:** among all revision obligations, what should the learner do today?

FSRS owns memory decay and memory intervals. Revision Director owns exam urgency, capacity, evidence weakness, subject balance, corrective workflows, interleaving and non-memory practice policies. Planner logic must not rewrite FSRS memory state merely to make an item more urgent.

## FSRS-7

Memory recall uses the vendored `ts-fsrs@6.0.0` runtime with **FSRS-7 only**.

Current scheduler policy:

- model: FSRS-7;
- desired retention: user setting, default `0.90`;
- dual-trace state: `stability`, `stabilityFast`, `difficulty`;
- fractional elapsed days;
- short-term middleware enabled;
- learning step: `1d`;
- relearning step: `1d`;
- graduating interval: `1d`;
- `allowModelOverride: true`;
- fuzz disabled;
- maximum interval: 36,500 days;
- package-default FSRS-7 weights.

The one-day step is a product adaptation for long-form revision sessions: it prevents seconds/minutes-scale flashcard behaviour while still allowing the FSRS model to choose longer intervals when appropriate.

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

After successful closed-book relearning verification, the original memory obligation is advanced again through FSRS-7 with a successful rating and reactivated at the resulting scheduler due date. The application does not substitute a hard-coded post-relearning interval.

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
