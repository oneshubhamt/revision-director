  /* ==========================================================================
     FSRS-7 PERSONALIZATION CONTRACT — EXTERNAL OPTIMIZER BOUNDARY
     ========================================================================== */

  const FSRS_OPTIMIZER_PROFILE_SCHEMA = "revision-director-fsrs-profile/v1" as const;
  const FSRS_OPTIMIZER_BINDING_VERSION = "0.6.1" as const;
  const FSRS_OPTIMIZER_HOLDOUT_STRATEGY = "final-sixth" as const;
  const FSRS_OPTIMIZER_MIN_TRAIN_ITEMS = 64 as const;
  const FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS = 64 as const;
  const FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS = 16 as const;
  const FSRS_OPTIMIZER_CHRONOLOGY = "elapsed-24h" as const;
  const FSRS_OPTIMIZER_FIXED_UTC_OFFSET_MINUTES = 0 as const;
  const FSRS_OPTIMIZER_ROLLOVER_HOUR = 0 as const;

  // Pinned ts-fsrs@6.0.0 FSRS-7 defaults and parameter bounds. Keep these
  // synchronized with vendor/ts-fsrs-6.0.0; profile activation also passes the
  // weights through DefaultScheduler, providing a second vendor-level check.
  const FSRS7_DEFAULT_WEIGHTS = Object.freeze([
    0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0,
    1.3826, 0.7024, 0.5999, 0.8146, 0.6398, 1, 1.3207, 0.6707, 3.8668,
    0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567, 0.0801, 0.2421,
    0.9464, 0.1433, 0.7145, 0, 0.5667, 0.3734, 0.5333, 0.3048,
  ] as const);

  const FSRS7_PARAMETER_BOUNDS = Object.freeze([
    [0.0001, 50], [0.0001, 100], [0.0001, 100], [0.0001, 100], [1, 10],
    [0.001, 4], [0.1, 4], [0, 4], [0, 1.2], [0.3, 3], [0.01, 1.5],
    [0.1, 1], [0, 3.5], [0, 1], [1, 7], [0, 4], [0, 2], [0.5, 6],
    [0.001, 1.5], [0.001, 1], [0, 5], [0, 1], [1, 7], [0.01, 0.25],
    [0.01, 0.95], [0.2, 0.85], [0.5, 0.99], [0.01, 1], [0.1, 1],
    [0, 0.9], [0.1, 1.1], [0, 1], [0, 0.6], [0, 0.6],
  ] as const);

  function fingerprintText64(value: string): string {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
  }

  function validateFsrs7Weights(value: unknown): number[] {
    assert(Array.isArray(value) && value.length === 34, "FSRS-7 optimizer profile must contain exactly 34 weights.");
    const weights = value.map((item) => {
      assert(typeof item === "number" && Number.isFinite(item), "FSRS-7 optimizer weights must be finite numbers.");
      return item;
    });
    for (let index = 0; index < weights.length; index += 1) {
      const [minimum, maximum] = FSRS7_PARAMETER_BOUNDS[index]!;
      const monotonicMinimum = index > 0 && index < 4
        ? Math.max(minimum, weights[index - 1]!)
        : index === 26
          ? Math.max(minimum, weights[25]!)
          : minimum;
      assert(weights[index]! >= monotonicMinimum && weights[index]! <= maximum, `FSRS-7 optimizer weight ${index} is outside the ts-fsrs 6.0.0 model bounds.`);
    }
    return weights;
  }

  function fsrsWeightsFingerprint(weights: readonly number[]): string {
    return fingerprintText64(validateFsrs7Weights([...weights]).map((value) => Number(value).toString()).join(","));
  }

  const FSRS7_DEFAULT_WEIGHTS_FINGERPRINT = fsrsWeightsFingerprint(FSRS7_DEFAULT_WEIGHTS);

  function optimizerMetrics(value: unknown, label: string): FsrsEvaluationMetrics {
    const record = requireRecord(value, `FSRS optimizer ${label} metrics`);
    const logLoss = Number(record["logLoss"]);
    const rmseBins = Number(record["rmseBins"]);
    assert(Number.isFinite(logLoss) && logLoss >= 0 && Number.isFinite(rmseBins) && rmseBins >= 0, `FSRS optimizer ${label} metrics are invalid.`);
    return { logLoss, rmseBins };
  }

  function validateFsrsOptimizerProfile(value: unknown): FsrsOptimizerProfile {
    const profile = requireRecord(value, "FSRS optimizer profile");
    const allowed = new Set(["schema", "model", "bindingVersion", "trainedAt", "sourceSha256", "evidenceItems", "weights", "evaluation", "training"]);
    assert(Object.keys(profile).every((key) => allowed.has(key)), "FSRS optimizer profile contains unexpected fields.");
    assert(profile["schema"] === FSRS_OPTIMIZER_PROFILE_SCHEMA && profile["model"] === FSRS_MODEL, "FSRS optimizer profile schema/model is invalid.");
    assert(profile["bindingVersion"] === FSRS_OPTIMIZER_BINDING_VERSION, "FSRS optimizer binding version is unsupported.");
    const trainedAt = canonicalIso(requiredString(profile["trainedAt"], "FSRS optimizer training date"), "FSRS optimizer training date");
    const sourceSha256 = requiredString(profile["sourceSha256"], "FSRS optimizer source checksum");
    assert(/^[a-f0-9]{64}$/.test(sourceSha256), "FSRS optimizer source checksum is invalid.");
    const evidenceItems = Number(profile["evidenceItems"]);
    assert(Number.isSafeInteger(evidenceItems) && evidenceItems > 0, "FSRS optimizer evidence item count is invalid.");
    const weights = validateFsrs7Weights(profile["weights"]);

    const evaluation = requireRecord(profile["evaluation"], "FSRS optimizer evaluation");
    const crossValidation = optimizerMetrics(evaluation["crossValidation"], "cross-validation");
    const holdout = requireRecord(evaluation["holdout"], "FSRS optimizer holdout");
    assert(holdout["strategy"] === FSRS_OPTIMIZER_HOLDOUT_STRATEGY && holdout["gate"] === "passed", "FSRS optimizer holdout strategy/gate is invalid.");
    const trainItems = Number(holdout["trainItems"]);
    const holdoutItems = Number(holdout["holdoutItems"]);
    const holdoutCards = Number(holdout["holdoutCards"]);
    assert(Number.isSafeInteger(trainItems) && trainItems >= FSRS_OPTIMIZER_MIN_TRAIN_ITEMS, "FSRS optimizer training prefix is too small.");
    assert(Number.isSafeInteger(holdoutItems) && holdoutItems >= FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS, "FSRS optimizer holdout is too small.");
    assert(Number.isSafeInteger(holdoutCards) && holdoutCards >= FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS && holdoutCards <= holdoutItems, "FSRS optimizer holdout-card count is invalid.");
    assert(trainItems + holdoutItems === evidenceItems, "FSRS optimizer holdout counts do not match evidence items.");
    assert(holdout["minimumTrainItems"] === FSRS_OPTIMIZER_MIN_TRAIN_ITEMS
      && holdout["minimumHoldoutItems"] === FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS
      && holdout["minimumHoldoutCards"] === FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS,
    "FSRS optimizer activation thresholds are invalid.");
    const stock = optimizerMetrics(holdout["stock"], "stock holdout");
    const personalized = optimizerMetrics(holdout["personalized"], "personalized holdout");
    assert(personalized.logLoss < stock.logLoss && personalized.rmseBins <= stock.rmseBins,
      "Personalized FSRS-7 profile did not beat stock FSRS-7 on the chronological holdout without RMSE regression.");

    const training = requireRecord(profile["training"], "FSRS optimizer training metadata");
    assert(training["enableShortTerm"] === true && training["enableSchedPenalties"] === true && training["numRelearningSteps"] === 1,
      "FSRS optimizer training flags are invalid.");
    assert(training["chronology"] === FSRS_OPTIMIZER_CHRONOLOGY
      && training["converterFixedUtcOffsetMinutes"] === FSRS_OPTIMIZER_FIXED_UTC_OFFSET_MINUTES
      && training["converterRolloverHour"] === FSRS_OPTIMIZER_ROLLOVER_HOUR,
    "FSRS optimizer chronology metadata is invalid.");
    assert(Array.isArray(training["runtimeLearningSteps"]) && training["runtimeLearningSteps"].length === 1 && training["runtimeLearningSteps"][0] === "1d"
      && Array.isArray(training["runtimeRelearningSteps"]) && training["runtimeRelearningSteps"].length === 1 && training["runtimeRelearningSteps"][0] === "1d",
    "FSRS optimizer runtime step metadata is invalid.");
    assert(training["validationCandidateTrainedItems"] === trainItems && training["finalRetrainedOnAllEvidence"] === true,
      "FSRS optimizer final-training metadata is invalid.");

    return {
      schema: FSRS_OPTIMIZER_PROFILE_SCHEMA,
      model: FSRS_MODEL,
      bindingVersion: FSRS_OPTIMIZER_BINDING_VERSION,
      trainedAt,
      sourceSha256,
      evidenceItems,
      weights,
      evaluation: {
        crossValidation,
        holdout: {
          strategy: FSRS_OPTIMIZER_HOLDOUT_STRATEGY,
          trainItems,
          holdoutItems,
          holdoutCards,
          minimumTrainItems: FSRS_OPTIMIZER_MIN_TRAIN_ITEMS,
          minimumHoldoutItems: FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS,
          minimumHoldoutCards: FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS,
          stock,
          personalized,
          gate: "passed",
        },
      },
      training: {
        enableShortTerm: true,
        enableSchedPenalties: true,
        numRelearningSteps: 1,
        chronology: FSRS_OPTIMIZER_CHRONOLOGY,
        converterFixedUtcOffsetMinutes: FSRS_OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,
        converterRolloverHour: FSRS_OPTIMIZER_ROLLOVER_HOUR,
        runtimeLearningSteps: ["1d"],
        runtimeRelearningSteps: ["1d"],
        validationCandidateTrainedItems: trainItems,
        finalRetrainedOnAllEvidence: true,
      },
    };
  }

  function defaultFsrsPersonalizationSettings(): FsrsPersonalizationSettings {
    return { profile: null, active: false };
  }

  function canonicalFsrsPersonalizationSettings(value: unknown): FsrsPersonalizationSettings {
    const record = requireRecord(value, "FSRS personalization settings");
    const profile = record["profile"] === null ? null : validateFsrsOptimizerProfile(record["profile"]);
    const active = record["active"];
    assert(typeof active === "boolean", "FSRS personalization active flag is invalid.");
    assert(!active || profile !== null, "Active FSRS personalization requires an optimizer profile.");
    let lastRebase: FsrsPersonalizationRebase | undefined;
    if (record["lastRebase"] !== undefined) {
      const rebase = requireRecord(record["lastRebase"], "FSRS personalization rebase");
      const reason = rebase["reason"];
      const target = rebase["target"];
      const rescheduledObligations = Number(rebase["rescheduledObligations"]);
      assert(reason === "activate-profile" || reason === "deactivate-profile" || reason === "retention-change", "FSRS personalization rebase reason is invalid.");
      assert(target === "stock" || target === "personalized", "FSRS personalization rebase target is invalid.");
      assert(Number.isSafeInteger(rescheduledObligations) && rescheduledObligations >= 0, "FSRS personalization rebase count is invalid.");
      const profileSourceSha256 = rebase["profileSourceSha256"];
      if (target === "personalized") assert(typeof profileSourceSha256 === "string" && /^[a-f0-9]{64}$/.test(profileSourceSha256), "Personalized rebase lacks optimizer provenance.");
      if (target === "stock") assert(profileSourceSha256 === undefined, "Stock rebase cannot claim optimizer provenance.");
      lastRebase = {
        at: canonicalIso(requiredString(rebase["at"], "FSRS personalization rebase date"), "FSRS personalization rebase date"),
        reason,
        target,
        rescheduledObligations,
        ...(typeof profileSourceSha256 === "string" ? { profileSourceSha256 } : {}),
      };
    }
    return { profile, active, ...(lastRebase ? { lastRebase } : {}) };
  }

  function effectiveFsrsPersonalization(settings: AppSettings): FsrsPersonalizationSettings {
    return canonicalFsrsPersonalizationSettings(settings.fsrsPersonalization);
  }

  function activeFsrsOptimizerProfile(settings: AppSettings): FsrsOptimizerProfile | null {
    const personalization = effectiveFsrsPersonalization(settings);
    return personalization.active ? personalization.profile : null;
  }

  interface FsrsOptimizerEvidenceRow {
    reviewTimeMs: number;
    cardId: string;
    rating: Rating;
    durationMs: number;
    state: number;
    evidenceEventId: string;
    source: MemoryReviewSource;
  }

  function fsrsOptimizerEvidenceRows(events: readonly EvidenceEvent[]): FsrsOptimizerEvidenceRow[] {
    const rows: FsrsOptimizerEvidenceRow[] = [];
    for (const event of events) {
      assert(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0, "Optimizer evidence contains an invalid duration.");
      if (event.obligationType === "memory-recall") {
        const before = event.beforePolicyState.fsrsCard;
        assert(before, "Memory optimizer evidence is missing its before-card projection.");
        rows.push({
          reviewTimeMs: new Date(event.reviewedAt).getTime(),
          cardId: event.obligationId,
          rating: validateRating(event.confirmedRating),
          durationMs: Math.round(event.elapsedMs),
          state: before.state,
          evidenceEventId: event.id,
          source: "direct-memory",
        });
      }
      const returned = event.returnedMemoryTransition;
      if (returned) {
        const before = returned.beforePolicyState.fsrsCard;
        assert(before, "Returned-memory optimizer evidence is missing its before-card projection.");
        rows.push({
          reviewTimeMs: new Date(event.reviewedAt).getTime(),
          cardId: returned.obligationId,
          rating: Rating.Good,
          durationMs: Math.round(event.elapsedMs),
          state: before.state,
          evidenceEventId: event.id,
          source: "relearning-return",
        });
      }
    }
    rows.sort((left, right) => left.reviewTimeMs - right.reviewTimeMs
      || left.cardId.localeCompare(right.cardId)
      || left.evidenceEventId.localeCompare(right.evidenceEventId)
      || left.source.localeCompare(right.source));
    let previous = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      assert(Number.isFinite(row.reviewTimeMs) && row.reviewTimeMs >= previous, "FSRS optimizer evidence is not chronological.");
      assert(Number.isInteger(row.state) && row.state >= 0 && row.state <= 3, "FSRS optimizer evidence contains an invalid review state.");
      previous = row.reviewTimeMs;
    }
    return rows;
  }

  function optimizerCsvCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }

  function fsrsOptimizerCsv(events: readonly EvidenceEvent[]): string {
    const lines = ["review_time,card_id,review_rating,review_duration,review_state"];
    for (const row of fsrsOptimizerEvidenceRows(events)) {
      lines.push([row.reviewTimeMs, optimizerCsvCell(row.cardId), row.rating, row.durationMs, row.state].join(","));
    }
    return lines.join("\n") + "\n";
  }

  function fsrsOptimizerEvidenceSummary(events: readonly EvidenceEvent[]): { cards: number; reviews: number } {
    const rows = fsrsOptimizerEvidenceRows(events);
    return { cards: new Set(rows.map((row) => row.cardId)).size, reviews: rows.length };
  }

