# Revision Director FSRS-7 optimizer

This is an **external personalization tool**, not part of the Revision Director browser runtime. The application remains fully functional on stock FSRS-7 without this directory or its dependencies.

## Workflow

1. In Revision Director Settings, export **FSRS optimizer evidence**.
2. In this directory run `npm ci`.
3. Run `npm run optimize -- path/to/revision-director-fsrs-evidence.csv profile.json`.
4. Import the produced JSON profile into Revision Director.
5. Importing only **stages** the profile. Activate it separately if you want current memory schedules rebuilt under the personalized weights.

Activation is conservative and explicit. The optimizer uses the historical first 5/6 of converted FSRS items to train a validation candidate, evaluates both stock FSRS-7 and that candidate on the chronological final 1/6, requires strictly better held-out log loss with no RMSE-bins regression, then retrains the final 34 weights on all evidence. At least 64 training items, 64 later holdout items and 16 distinct holdout cards are required. Upstream time-series evaluation is recorded separately in the profile.

Chronology is fixed to elapsed 24-hour days: converter UTC offset 0 and rollover hour 0. Training uses FSRS-7, short-term behavior, one relearning step and scheduling penalties. The profile also attests Revision Director's runtime learning/relearning policy of one day so profiles trained for a different scheduling regime cannot be activated silently.

The native optimizer dependency is pinned to `@open-spaced-repetition/binding@0.6.1`. No optimizer package or WASM runtime is embedded in Revision Director in Pass 2. Browser/WASM optimization can be evaluated later behind the same profile boundary.

Failed or interrupted optimization clears the requested output first and publishes a profile only after every validation/evaluation gate succeeds.
