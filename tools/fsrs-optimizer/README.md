# Revision Director FSRS-7 optimizer

This directory owns the personalization computation used by both the **native reference CLI** and the optional **browser Worker/WASM** path. Revision Director remains fully functional on stock FSRS-7 without these dependencies.

## One algorithm, two runtimes

`optimizer-core.mjs` owns the complete personalization algorithm:

1. validate globally chronological evidence;
2. convert the evidence with the pinned FSRS-7 binding;
3. split the first 5/6 for validation training and the final 1/6 for held-out evaluation;
4. require at least 64 training items, 64 later holdout items and 16 distinct holdout cards;
5. require personalized held-out log loss to be strictly lower than stock FSRS-7 with no RMSE-bins regression;
6. retrain the final 34 weights on all evidence;
7. record upstream time-series evaluation and exact Revision Director runtime-step attestation.

The native and browser runtimes do not reimplement this sequence.

## Native reference workflow

```sh
npm ci
npm run optimize -- path/to/revision-director-fsrs-evidence.csv profile.json
npm run parity
```

The native binding is `@open-spaced-repetition/binding@0.6.1`.

## Browser-local workflow

The same dependency set pins the single-threaded `@open-spaced-repetition/binding-wasm32-wasip1@0.6.1` runtime and the emnapi versions required by that release. From the repository root:

```sh
npm ci
npm ci --prefix tools/fsrs-optimizer
npm run build:optimizer-static
```

This produces `Revision_Director_Optimizer_Static/`. Serve that directory over localhost or HTTPS. The Worker and WASM are local files; no training backend or evidence upload exists. The WASM runtime is created only when **Optimize locally** is pressed and Worker termination provides hard cancellation.

The normal root `index.html` remains a self-contained `file://` application and intentionally does not include optimizer assets. The static builder records exact Worker/WASM sizes in `optimizer-footprint.json`.

A successful native import or browser optimization **stages** the validated profile only. Activation is a separate user action and atomically reprojects reviewed memory schedules from immutable Evidence Events.

Chronology is fixed to elapsed 24-hour days: converter UTC offset 0 and rollover hour 0. Training uses FSRS-7, short-term behavior, one relearning step and scheduling penalties. The profile also attests Revision Director's one-day runtime learning/relearning policy.

Failed, rejected, interrupted or timed-out optimization never publishes or stages a partial profile.
