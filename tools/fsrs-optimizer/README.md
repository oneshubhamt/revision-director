# Revision Director FSRS-7 optimizer

This directory owns the personalization computation used by both the **native reference CLI** and the hosted **browser Worker/WASM** path. Revision Director remains fully functional on stock FSRS-7 without these dependencies.

## One algorithm, two runtimes

`optimizer-core.mjs` owns the complete personalization algorithm:

1. validate globally chronological evidence;
2. convert the evidence with the pinned FSRS-7 binding;
3. split the first 5/6 for validation training and the final 1/6 for held-out evaluation;
4. require at least 64 training items, 64 later holdout items and 16 distinct holdout cards;
5. require a practical personalized held-out log-loss gain: at least 0.001 absolute or 0.5% relative versus stock FSRS-7, whichever is larger;
6. when replacing an active profile, evaluate the incumbent weights on that same holdout and require the same practical gain over the incumbent;
7. require no held-out RMSE-bins calibration regression versus stock or incumbent;
8. retrain the final 34 weights on all evidence;
9. record upstream time-series evaluation and exact Revision Director runtime-step attestation.

The native and browser runtimes do not reimplement this sequence.

## Native reference workflow

```sh
npm ci
npm run optimize -- path/to/revision-director-fsrs-evidence.csv profile.json
# Optional incumbent comparison for a personalized→personalized upgrade:
npm run optimize -- path/to/revision-director-fsrs-evidence.csv candidate.json --incumbent-profile=active-profile.json
npm run parity
```

The native binding is `@open-spaced-repetition/binding@0.6.1`.

## Browser-local workflow

The same dependency set pins the single-threaded `@open-spaced-repetition/binding-wasm32-wasip1@0.6.1` runtime and the emnapi versions required by that release. From the repository root:

```sh
npm ci
npm ci --prefix tools/fsrs-optimizer
npm run build:hosted
```

This produces `Revision_Director_Hosted/`. Serve that directory over localhost or HTTPS. The Worker and WASM are local files; no training backend or evidence upload exists. The WASM runtime is created only when **Optimize locally** is pressed and Worker termination provides hard cancellation.

The normal hosted distribution includes these optimizer assets by default. The root `index.html` remains a self-contained `file://` portable fallback and intentionally does not include them. The hosted builder records exact Worker/WASM sizes in `optimizer-footprint.json`.

From stock, a successful native import or browser optimization **stages** the validated profile and activation remains explicit. If personalized weights are already active, the incumbent stays active while optimization runs; a candidate must beat both stock and incumbent on the same holdout, then one atomic rebase replaces the incumbent without an intermediate return to stock.

Chronology is fixed to elapsed 24-hour days: converter UTC offset 0 and rollover hour 0. Training uses FSRS-7, short-term behavior, one relearning step and scheduling penalties. The profile also attests Revision Director's one-day runtime learning/relearning policy.

Failed, rejected, interrupted or timed-out optimization never publishes or stages a partial profile.
