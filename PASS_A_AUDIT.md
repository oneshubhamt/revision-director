# Pass A Objective Audit — VA6.2 QA Closure

## Verdict

All six requested Pass A objectives are implemented at the intended product and
architecture level. The exact scheduler dependency is now also fully vendored,
checksum-locked and offline-capable.

| Objective | Status | Implementation evidence | Boundary retained |
|---|---|---|---|
| Knowledge hierarchy | Complete | Exam Profile → Subject → Section → Topic → Knowledge Unit, with unique path indexes and cross-profile validation | Hierarchy quality and syllabus templates can be refined later |
| Study Events | Complete | Append-only Learn, Review, Practice and Test records using Area, Task and Measure, with source, duration, understanding, origin and linked units | Study time never advances memory scheduling |
| Stronger evidence model | Complete for Pass A | Completeness, independence and application rubrics; optional accuracy; controlled error taxonomy; correction note; suggested and confirmed rating; immutable before/after policy state | Rubric weights are transparent baseline heuristics, not claimed as final empirical calibration |
| Different revision obligations | Complete | Memory recall, concept reconstruction, application practice, performance practice, relearn and freshness review | Additional modalities can be added without changing existing event history |
| Scheduler-policy router | Complete | One policy per obligation type; FSRS is restricted to memory recall | Five non-FSRS policies remain explicit versioned baselines for later refinement |
| Exact ts-fsrs integration | Complete | Official `ts-fsrs@5.4.1` UMD artifact embedded byte-for-byte; build-time SHA-256 and metadata verification; real-runtime scheduling tests | Optimiser remains intentionally excluded |

## Audit corrections made

The audit found and corrected two edge cases:

1. Every FSRS Evidence Event now stores the exact request-retention and scheduler
   flag configuration used for that review, making interval history reproducible.
2. Obligation suspension now records whether it was caused by the user suspending
   the whole unit or by an active relearning workflow. Reactivating a unit cannot
   accidentally revive work that must remain paused until relearning completes.

Backup validation was also strengthened to validate controlled error types,
relearning relationships, suspension reasons, scheduler configuration and
Knowledge Unit evidence counters against the append-only history.

## Not part of Pass A

The following remain future work rather than unmet Pass A objectives:

- empirical refinement of mastery, application and performance policies;
- exam-proximity and workload-aware daily prioritisation;
- richer modality-specific review workflows;
- Study Director live integration;
- AI packet exchange or API-backed assistance;
- FSRS parameter optimisation from sufficient personal review history.


## VA6.2 de novo QA closure

The objective was rechecked through the complete package. Runtime-boundary, calendar-validation and active-profile-scoping defects discovered by independent QA were corrected and regression-tested. See `QA_REPORT.md` for the full scope and limitations.
