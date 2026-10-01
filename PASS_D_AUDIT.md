# Pass D Completion Audit — Revision Director VA7.1

## Overall verdict

Pass D is complete at the requested functional scope after de novo QA
hardening. All four requested mechanisms are implemented, connected to the
existing Pass A–C model and independently regression-tested against VA6.2.

## Objective status

| Objective | Status | Implemented mechanism |
|---|---|---|
| Learn estimated duration from actual review sessions | Complete | Immutable duration observations; plausible-sample gate; exact/unit/global hierarchy; recent weighted median; bounded update; split-cycle aggregation |
| Weekly subject balance and interleaving | Complete | Seven configured study days of completed actual minutes; profile-qualified subjects; importance-weighted target share; gentle balance factor; protected score-bounded interleaving |
| Automatic splitting of oversized obligations | Complete | Eligibility-safe capacity-bounded chunks; page/question range parsing; parent-owned scheduler; final synthesis; untouched-cycle capacity reflow |
| Persisted daily-plan history | Complete | Immutable first recommendation; sequential material-change/manual versions; explicit planned/started/completed outcomes; actual duration and Evidence links |

## Verified invariants

### Duration learning

- Previewing or merely planning work cannot change an estimate.
- Rejected timing samples retain an audit record but cannot alter estimates.
- One sample cannot cause an unbounded jump.
- Repeated consistent evidence can correct a poor estimate over time.
- Split chunks plus final synthesis form one complete parent-cycle sample.
- Accepted-sample counters must match Evidence history.

### Weekly balance and interleaving

- Uses completed actual minutes, not planned minutes.
- Uses exactly seven Study Director-style study days.
- Respects the configured day boundary before dawn.
- Same-named subjects in different exams do not share exposure.
- Balance remains neutral with insufficient weekly evidence.
- Relearning and severe overdue work cannot be displaced for cosmetic variety.

### Automatic splitting

- Only active, planning-eligible, oversized work is split.
- Every generated child session fits the creating capacity.
- Child work plus synthesis exactly conserves the parent estimate.
- Child completion cannot advance FSRS or another scheduling policy.
- Only final parent synthesis can create Evidence and reschedule the parent.
- An untouched cycle reflows safely after capacity changes.
- A partially completed cycle remains fixed to preserve its audit trail.

### Persisted daily plans

- Initial plans are never overwritten.
- Capacity and ordered-queue changes create durable versions.
- Manual regeneration is always explicit.
- Manually undertaking deferred work creates a manual-addition amendment.
- Planned, started and completed are distinct states.
- Only the current session target becomes started.
- Completion records actual time and, for parent reviews, a matching Evidence ID.
- Backup import validates every new relationship before replacement.

## Scope boundary

Pass D does not include semantic AI subdivision, automatic interruption
classification, learned marks-per-minute yield, hard weekly quotas, Study
Director Plan/Timer synchronisation or production-device QA. These are later
capabilities rather than unfinished Pass D objectives.
