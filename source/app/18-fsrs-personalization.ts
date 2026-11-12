  /* ==========================================================================
     FSRS-7 PERSONALIZATION CONTRACT — EXTERNAL OPTIMIZER BOUNDARY
     ========================================================================== */

  const FSRS_OPTIMIZER_PROFILE_SCHEMA = "revision-director-fsrs-profile/v1" as const;
  const FSRS_OPTIMIZER_BINDING_VERSION = "0.6.1" as const;
  const FSRS_OPTIMIZER_HOLDOUT_STRATEGY = "final-sixth" as const;
  const FSRS_OPTIMIZER_MIN_TRAIN_ITEMS = 64 as const;
  const FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS = 64 as const;
  const FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS = 16 as const;
  const FSRS_OPTIMIZER_MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT = 0.001 as const;
  const FSRS_OPTIMIZER_MIN_RELATIVE_LOG_LOSS_IMPROVEMENT = 0.005 as const;
  const FSRS_OPTIMIZER_CALIBRATION_EPSILON = 1e-9 as const;
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

  function fsrsHoldoutDiagnostics(
    stock: FsrsEvaluationMetrics,
    personalized: FsrsEvaluationMetrics,
  ): FsrsHoldoutDiagnostics {
    const absolute = stock.logLoss - personalized.logLoss;
    const relative = stock.logLoss > 0 ? absolute / stock.logLoss : 0;
    const required = Math.max(
      FSRS_OPTIMIZER_MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT,
      stock.logLoss * FSRS_OPTIMIZER_MIN_RELATIVE_LOG_LOSS_IMPROVEMENT,
    );
    const delta = personalized.rmseBins - stock.rmseBins;
    const relativeDelta = stock.rmseBins > 0 ? delta / stock.rmseBins : delta === 0 ? 0 : Number.POSITIVE_INFINITY;
    const status: FsrsHoldoutDiagnostics["calibration"]["status"] =
      delta < -FSRS_OPTIMIZER_CALIBRATION_EPSILON ? "improved"
        : Math.abs(delta) <= FSRS_OPTIMIZER_CALIBRATION_EPSILON ? "unchanged"
          : "regressed";
    return {
      logLossImprovement: { absolute, relative, required },
      calibration: { metric: "rmse-bins", delta, relativeDelta, status },
    };
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
    const diagnostics = fsrsHoldoutDiagnostics(stock, personalized);
    assert(
      diagnostics.logLossImprovement.absolute + Number.EPSILON >= diagnostics.logLossImprovement.required,
      "Personalized FSRS-7 profile did not achieve the minimum practical held-out log-loss improvement over stock FSRS-7.",
    );
    assert(
      diagnostics.calibration.status !== "regressed",
      "Personalized FSRS-7 profile regressed held-out RMSE-bins calibration versus stock FSRS-7.",
    );

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

  const FSRS_COST_ADR_MEASURED_GOAL_COST_WEIGHT = 1024 as const;

  function upstreamDefaultFsrsCostAdrPolicy(): FsrsCostAdrPolicy {
    return {
      coefficients: [-0.202, 9.14, -0.0978, 0.226, -5.31, -7.44, 24.1, -0.375, 1.81, -22.9, -5.82, 22.3, 1.72, -1.99, -19.4],
      costWeightMin: 0,
      costWeightMax: 1024,
      retentionMin: 0.3,
      retentionMax: 0.995,
      bounds: { sMin: 0.0001, sMax: 36500, dMin: 1, dMax: 10 },
    };
  }

  function measuredCostAdrSchedulingPolicy(): FsrsSchedulingPolicy {
    return {
      kind: "cost-adr",
      goalCostWeight: FSRS_COST_ADR_MEASURED_GOAL_COST_WEIGHT,
      costAdrPolicy: upstreamDefaultFsrsCostAdrPolicy(),
    };
  }

  function canonicalFsrsCostAdrPolicy(value: unknown): FsrsCostAdrPolicy {
    const record = requireRecord(value, "FSRS Cost-ADR policy");
    const allowed = new Set(["coefficients", "costWeightMin", "costWeightMax", "retentionMin", "retentionMax", "bounds"]);
    assert(Object.keys(record).every((key) => allowed.has(key)), "FSRS Cost-ADR policy contains unexpected fields.");
    const coefficientsRaw = record["coefficients"];
    assert(Array.isArray(coefficientsRaw) && coefficientsRaw.length === 15, "FSRS Cost-ADR policy must contain exactly 15 coefficients.");
    const coefficients = coefficientsRaw.map((value) => {
      const coefficient = Number(value);
      assert(Number.isFinite(coefficient) && coefficient >= -64 && coefficient <= 64, "FSRS Cost-ADR coefficient is invalid.");
      return coefficient;
    });
    const costWeightMin = Number(record["costWeightMin"]);
    const costWeightMax = Number(record["costWeightMax"]);
    const retentionMin = Number(record["retentionMin"]);
    const retentionMax = Number(record["retentionMax"]);
    assert(Number.isFinite(costWeightMin) && Number.isFinite(costWeightMax) && costWeightMin >= 0 && costWeightMax > costWeightMin
      && Math.log1p(costWeightMax) > Math.log1p(costWeightMin), "FSRS Cost-ADR cost-weight bounds are invalid.");
    assert(Number.isFinite(retentionMin) && Number.isFinite(retentionMax) && retentionMin > 0 && retentionMax > retentionMin && retentionMax < 1, "FSRS Cost-ADR retention bounds are invalid.");
    const boundsRecord = requireRecord(record["bounds"], "FSRS Cost-ADR state bounds");
    const boundsAllowed = new Set(["sMin", "sMax", "dMin", "dMax"]);
    assert(Object.keys(boundsRecord).every((key) => boundsAllowed.has(key)), "FSRS Cost-ADR state bounds contain unexpected fields.");
    const bounds = {
      sMin: Number(boundsRecord["sMin"]),
      sMax: Number(boundsRecord["sMax"]),
      dMin: Number(boundsRecord["dMin"]),
      dMax: Number(boundsRecord["dMax"]),
    };
    assert(Number.isFinite(bounds.sMin) && Number.isFinite(bounds.sMax) && bounds.sMin > 0 && bounds.sMax > bounds.sMin
      && Math.log(bounds.sMax) > Math.log(bounds.sMin), "FSRS Cost-ADR stability bounds are invalid.");
    assert(Number.isFinite(bounds.dMin) && Number.isFinite(bounds.dMax) && bounds.dMax > bounds.dMin
      && Number.isFinite(bounds.dMax - bounds.dMin), "FSRS Cost-ADR difficulty bounds are invalid.");
    return { coefficients, costWeightMin, costWeightMax, retentionMin, retentionMax, bounds };
  }

  function canonicalFsrsSchedulingPolicy(value: unknown): FsrsSchedulingPolicy {
    const record = requireRecord(value, "FSRS scheduling policy");
    const kind = record["kind"];
    if (kind === "fixed-retention") {
      const allowed = new Set(["kind", "desiredRetention"]);
      assert(Object.keys(record).every((key) => allowed.has(key)), "Fixed-retention scheduling policy contains unexpected fields.");
      const desiredRetention = Number(record["desiredRetention"]);
      assert(Number.isFinite(desiredRetention) && desiredRetention >= 0.75 && desiredRetention <= 0.97, "Desired retention must be between 75% and 97%.");
      return { kind, desiredRetention };
    }
    if (kind === "cost-adr") {
      const allowed = new Set(["kind", "goalCostWeight", "costAdrPolicy"]);
      assert(Object.keys(record).every((key) => allowed.has(key)), "Cost-ADR scheduling policy contains unexpected fields.");
      const goalCostWeight = Number(record["goalCostWeight"]);
      const costAdrPolicy = canonicalFsrsCostAdrPolicy(record["costAdrPolicy"]);
      assert(
        goalCostWeight === FSRS_COST_ADR_MEASURED_GOAL_COST_WEIGHT
          && JSON.stringify(costAdrPolicy) === JSON.stringify(upstreamDefaultFsrsCostAdrPolicy()),
        "Only the measured Revision Director Cost-ADR preset is enabled.",
      );
      return { kind, goalCostWeight, costAdrPolicy };
    }
    assert(false, "FSRS scheduling policy kind is invalid.");
  }

  function fsrsSchedulingPolicyIdentity(value: FsrsSchedulingPolicy): string {
    const policy = canonicalFsrsSchedulingPolicy(value);
    if (policy.kind === "fixed-retention") {
      return ["fixed-retention", policy.desiredRetention.toFixed(6)].join("|");
    }
    const cost = policy.costAdrPolicy;
    return [
      "cost-adr",
      policy.goalCostWeight.toString(),
      ...cost.coefficients.map((coefficient) => coefficient.toString()),
      cost.costWeightMin.toString(),
      cost.costWeightMax.toString(),
      cost.retentionMin.toString(),
      cost.retentionMax.toString(),
      cost.bounds.sMin.toString(),
      cost.bounds.sMax.toString(),
      cost.bounds.dMin.toString(),
      cost.bounds.dMax.toString(),
    ].join("|");
  }

  function fsrsSchedulingPoliciesEqual(left: FsrsSchedulingPolicy, right: FsrsSchedulingPolicy): boolean {
    return fsrsSchedulingPolicyIdentity(left) === fsrsSchedulingPolicyIdentity(right);
  }

  function fixedRetentionForPolicy(value: FsrsSchedulingPolicy): number {
    const policy = canonicalFsrsSchedulingPolicy(value);
    assert(policy.kind === "fixed-retention", "Fixed retention is not available from an adaptive Cost-ADR policy.");
    return policy.desiredRetention;
  }

  function defaultFsrsSchedulingSettings(): FsrsSchedulingSettings {
    return { policy: { kind: "fixed-retention", desiredRetention: 0.9 } };
  }

  function canonicalFsrsSchedulingSettings(value: unknown): FsrsSchedulingSettings {
    const record = requireRecord(value, "FSRS scheduling settings");
    const allowed = new Set(["policy", "lastRebase"]);
    assert(Object.keys(record).every((key) => allowed.has(key)), "FSRS scheduling settings contain unexpected fields.");
    const policy = canonicalFsrsSchedulingPolicy(record["policy"]);
    let lastRebase: FsrsSchedulerRebase | undefined;
    if (record["lastRebase"] !== undefined) {
      const rebase = requireRecord(record["lastRebase"], "FSRS scheduler rebase");
      const rebaseAllowed = new Set(["at", "reason", "fromConfigFingerprint", "toConfigFingerprint", "rescheduledObligations"]);
      assert(Object.keys(rebase).every((key) => rebaseAllowed.has(key)), "FSRS scheduler rebase contains unexpected fields.");
      const reason = rebase["reason"];
      assert(reason === "scheduler-policy-change" || reason === "activate-profile" || reason === "deactivate-profile", "FSRS scheduler rebase reason is invalid.");
      const fromConfigFingerprint = requiredString(rebase["fromConfigFingerprint"], "FSRS prior configuration fingerprint");
      const toConfigFingerprint = requiredString(rebase["toConfigFingerprint"], "FSRS target configuration fingerprint");
      assert(/^fnv1a64:[0-9a-f]{16}$/.test(fromConfigFingerprint) && /^fnv1a64:[0-9a-f]{16}$/.test(toConfigFingerprint), "FSRS scheduler rebase fingerprint is invalid.");
      assert(fromConfigFingerprint !== toConfigFingerprint, "FSRS scheduler rebase must change scheduler identity.");
      const rescheduledObligations = Number(rebase["rescheduledObligations"]);
      assert(Number.isSafeInteger(rescheduledObligations) && rescheduledObligations >= 0, "FSRS scheduler rebase count is invalid.");
      lastRebase = {
        at: canonicalIso(requiredString(rebase["at"], "FSRS scheduler rebase date"), "FSRS scheduler rebase date"),
        reason,
        fromConfigFingerprint,
        toConfigFingerprint,
        rescheduledObligations,
      };
    }
    return { policy, ...(lastRebase ? { lastRebase } : {}) };
  }

  function defaultFsrsPersonalizationSettings(): FsrsPersonalizationSettings {
    return { profile: null, active: false };
  }

  function canonicalFsrsPersonalizationSettings(value: unknown): FsrsPersonalizationSettings {
    const record = requireRecord(value, "FSRS personalization settings");
    const allowed = new Set(["profile", "active"]);
    assert(Object.keys(record).every((key) => allowed.has(key)), "FSRS personalization settings contain unexpected fields.");
    const profile = record["profile"] === null ? null : validateFsrsOptimizerProfile(record["profile"]);
    const active = record["active"];
    assert(typeof active === "boolean", "FSRS personalization active flag is invalid.");
    assert(!active || profile !== null, "Active FSRS personalization requires an optimizer profile.");
    return { profile, active };
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
    durationReliable: boolean;
    durationPhase: "attempt" | "relearn-verify";
    state: number;
    evidenceEventId: string;
    source: MemoryReviewSource;
  }

  interface FsrsOptimizerEvidenceSummary {
    cards: number;
    reviews: number;
    reliableDurations: number;
    unavailableDurations: number;
  }

  interface FsrsOptimizerEvidenceDataset {
    rows: FsrsOptimizerEvidenceRow[];
    csv: string;
    summary: FsrsOptimizerEvidenceSummary;
  }

  interface FsrsOptimizerEvidenceSnapshot extends FsrsOptimizerEvidenceDataset {
    sourceSha256: string;
  }

  function fsrsOptimizerReviewDuration(
    event: EvidenceEvent,
    source: MemoryReviewSource,
  ): Pick<FsrsOptimizerEvidenceRow, "durationMs" | "durationReliable" | "durationPhase"> {
    const timing = canonicalTimingEvidenceSummary(event.timing);
    const durationPhase = source === "direct-memory" ? "attempt" : "relearn-verify";
    const phaseMs = timing.activeByPhase[durationPhase];
    const durationReliable = timing.durationReliable && timing.reliabilityFlags.length === 0;
    return {
      durationMs: durationReliable ? Math.round(phaseMs) : 0,
      durationReliable,
      durationPhase,
    };
  }

  function fsrsOptimizerEvidenceRows(events: readonly EvidenceEvent[]): FsrsOptimizerEvidenceRow[] {
    const rows: FsrsOptimizerEvidenceRow[] = [];
    for (const event of events) {
      if (event.obligationType === "memory-recall") {
        const before = event.beforePolicyState.fsrsCard;
        assert(before, "Memory optimizer evidence is missing its before-card projection.");
        rows.push({
          reviewTimeMs: new Date(event.reviewedAt).getTime(),
          cardId: event.obligationId,
          rating: validateRating(event.confirmedRating),
          ...fsrsOptimizerReviewDuration(event, "direct-memory"),
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
          ...fsrsOptimizerReviewDuration(event, "relearning-return"),
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
      assert(Number.isInteger(row.durationMs) && row.durationMs >= 0, "FSRS optimizer evidence contains an invalid retrieval duration.");
      assert(Number.isInteger(row.state) && row.state >= 0 && row.state <= 3, "FSRS optimizer evidence contains an invalid review state.");
      previous = row.reviewTimeMs;
    }
    return rows;
  }

  function optimizerCsvCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }

  function fsrsOptimizerEvidenceDataset(events: readonly EvidenceEvent[]): FsrsOptimizerEvidenceDataset {
    const rows = fsrsOptimizerEvidenceRows(events);
    const lines = ["review_time,card_id,review_rating,review_duration,review_state"];
    for (const row of rows) {
      lines.push([row.reviewTimeMs, optimizerCsvCell(row.cardId), row.rating, row.durationMs, row.state].join(","));
    }
    const summary: FsrsOptimizerEvidenceSummary = {
      cards: new Set(rows.map((row) => row.cardId)).size,
      reviews: rows.length,
      reliableDurations: rows.filter((row) => row.durationReliable).length,
      unavailableDurations: rows.filter((row) => !row.durationReliable).length,
    };
    return { rows, csv: lines.join("\n") + "\n", summary };
  }

  function fsrsOptimizerCsv(events: readonly EvidenceEvent[]): string {
    return fsrsOptimizerEvidenceDataset(events).csv;
  }

  function fsrsOptimizerEvidenceSummary(events: readonly EvidenceEvent[]): FsrsOptimizerEvidenceSummary {
    return fsrsOptimizerEvidenceDataset(events).summary;
  }

  async function fsrsOptimizerEvidenceSnapshot(events: readonly EvidenceEvent[]): Promise<FsrsOptimizerEvidenceSnapshot> {
    const dataset = fsrsOptimizerEvidenceDataset(events);
    return {
      ...dataset,
      sourceSha256: await sha256Hex(utf8Bytes(dataset.csv)),
    };
  }

