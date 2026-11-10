  const APP_VERSION = "va7.1-pass-e1";
  const DB_NAME = "revision-director";
  const DB_VERSION = 2;
  const DOCUMENT_SCHEMA_VERSION: DocumentSchemaVersion = 1;
  const BACKUP_FORMAT = "revision-director-backup" as const;
  const BACKUP_SCHEMA_VERSION = 2 as const;
  const DIAGNOSTICS_STORAGE_KEY = "revision-director:diagnostics:v1";
  const ACTIVE_RETRIEVAL_ID = "current" as const;
  const ACTIVE_RETRIEVAL_RECOVERY_KEY = "revision-director:active-retrieval:v1";
  const ACTIVE_RETRIEVAL_RECOVERY_FORMAT = "revision-director-active-retrieval" as const;
  const ACTIVE_RETRIEVAL_DEBOUNCE_MS = 350;
  const ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS = 900_000;
  const ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS = 160_000;
  const ACTIVE_RETRIEVAL_RECOVERY_POINTS = 12_000;
  const INACTIVE_GAP_THRESHOLD_MS = 120_000;
  const REVIEW_OWNER_STORAGE_KEY = "revision-director:review-owner:v1";
  const REVIEW_OWNER_CHANNEL = "revision-director-review-owner";
  const REVIEW_OWNER_HEARTBEAT_MS = 4_000;
  const REVIEW_OWNER_STALE_MS = 15_000;
  const REVIEW_OWNER_TAKEOVER_WAIT_MS = 1_800;
  const TIME_HISTORY_LIMIT = 200;
  const PLANNER_VERSION = "pass-d-2";
  const FSRS_PACKAGE_VERSION = "6.0.0" as const;
  const FSRS_MODEL: FsrsModelVersion = "FSRS-7";
  const FSRS_LEARNING_STEPS = ["1d"] as const;
  const FSRS_RELEARNING_STEPS = ["1d"] as const;
  const FSRS_GRADUATING_INTERVAL_DAYS = 1 as const;
  const FSRS_MAXIMUM_INTERVAL_DAYS = 36_500;
  const DAY_MS = 86_400_000;

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function nowIso(): ISODateTime {
    return new Date().toISOString();
  }

  function uid(prefix: string): string {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}_${Date.now().toString(36)}_${random[0]!.toString(36)}${random[1]!.toString(36)}`;
  }

  function clone<T>(value: T): T {
    return structuredClone(value);
  }

  function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function roundTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  function normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
  }

  function escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function parseDate(value: ISODateTime): Date {
    const date = new Date(value);
    assert(Number.isFinite(date.getTime()), "Invalid date-time value.");
    return date;
  }

  function validateCalendarDate(value: string, label = "Exam date"): void {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} is invalid.`);
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    assert(
      date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day,
      `${label} is invalid.`,
    );
  }

  function toLocalInput(value: ISODateTime): string {
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function localInputToIso(value: string): ISODateTime {
    const date = new Date(value);
    assert(Number.isFinite(date.getTime()), "Enter a valid date and time.");
    return date.toISOString();
  }

  function formatDateTime(value: ISODateTime | Date, withTime = true): string {
    const date = value instanceof Date ? value : new Date(value);
    const options: Intl.DateTimeFormatOptions = withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" };
    return new Intl.DateTimeFormat("en-IN", options).format(date);
  }

  function formatDuration(ms: number): string {
    const minutes = Math.floor(Math.max(0, ms) / 60_000);
    const seconds = Math.floor(Math.max(0, ms) / 1000) % 60;
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function ratingName(rating: Rating): string {
    return rating === Rating.Again ? "Again" : rating === Rating.Hard ? "Hard" : rating === Rating.Good ? "Good" : "Easy";
  }

  function obligationLabel(type: ObligationType): string {
    const labels: Record<ObligationType, string> = {
      "memory-recall": "Memory recall",
      "concept-reconstruction": "Concept reconstruction",
      "application-practice": "Application practice",
      "performance-practice": "Performance practice",
      relearn: "Relearn",
      "freshness-review": "Freshness review",
    };
    return labels[type];
  }

  function obligationChip(type: ObligationType): string {
    if (type === "memory-recall") return "memory";
    if (type === "concept-reconstruction") return "concept";
    if (type === "application-practice") return "application";
    if (type === "performance-practice") return "performance";
    if (type === "relearn") return "relearn";
    return "freshness";
  }

  function workflowLabel(kind: RetrievalWorkflow): string {
    const labels: Record<RetrievalWorkflow, string> = {
      recall: "Recall",
      reconstruction: "Reconstruction",
      questions: "Questions / application",
      diagram: "Diagram practice",
      "answer-writing": "Answer writing",
      relearning: "Relearning",
    };
    return labels[kind];
  }

  function responseMediumLabel(value: ResponseMedium): string {
    return value === "in-app" ? "In-app workspace" : value === "paper" ? "Paper / external workspace" : "Oral recall";
  }

  function cueLevelScore(value: CueLevel): 0 | 1 | 3 | 4 {
    return value === "none" ? 4 : value === "minor" ? 3 : value === "major" ? 1 : 0;
  }

  function compatibleWorkflows(type: ObligationType): readonly RetrievalWorkflow[] {
    if (type === "memory-recall") return ["recall"];
    if (type === "concept-reconstruction") return ["reconstruction", "diagram"];
    if (type === "application-practice") return ["questions"];
    if (type === "performance-practice") return ["answer-writing", "diagram", "questions"];
    if (type === "freshness-review") return ["recall", "reconstruction"];
    return ["relearning"];
  }

  function defaultWorkflowForType(type: ObligationType): RetrievalWorkflow {
    return compatibleWorkflows(type)[0]!;
  }

  function defaultWorkflowSpec(type: ObligationType, protocol: string, successCriteria: string): WorkflowSpec {
    const kind = defaultWorkflowForType(type);
    const common: WorkflowSpec = {
      kind,
      prompt: protocol.trim() || "Attempt the required retrieval before consulting the source.",
      checkpoints: successCriteria.split(/\n|;/).map((item) => item.trim()).filter(Boolean).slice(0, 12),
      responseMedium: kind === "diagram" || kind === "answer-writing" ? "paper" : "in-app",
    };
    if (common.checkpoints.length === 0) common.checkpoints = [successCriteria.trim() || "Complete the stated success criteria."];
    if (kind === "reconstruction") common.reconstructionShape = "outline";
    if (kind === "questions") { common.targetCount = 10; common.questionSetRef = "External question set"; }
    if (kind === "diagram") common.diagramSurface = "canvas";
    if (kind === "answer-writing") {
      common.answerMode = "full-answer";
      common.timeLimitMinutes = 10;
      common.wordLimit = 150;
    }
    return common;
  }

  function validateWorkflowSpec(spec: WorkflowSpec, type: ObligationType): void {
    const kinds = new Set<RetrievalWorkflow>(["recall", "reconstruction", "questions", "diagram", "answer-writing", "relearning"]);
    assert(kinds.has(spec.kind), "Retrieval workflow is invalid.");
    assert(spec.prompt.trim().length >= 3, "Retrieval workflow prompt is required.");
    assert(Array.isArray(spec.checkpoints) && spec.checkpoints.length >= 1 && spec.checkpoints.length <= 20, "Add between 1 and 20 observable checkpoints.");
    assert(spec.checkpoints.every((item) => typeof item === "string" && item.trim().length >= 2 && item.trim().length <= 300), "Workflow checkpoints are invalid.");
    assert(spec.responseMedium === "in-app" || spec.responseMedium === "paper" || spec.responseMedium === "oral", "Response medium is invalid.");
    if (spec.targetCount !== undefined) assert(Number.isInteger(spec.targetCount) && spec.targetCount >= 1 && spec.targetCount <= 500, "Target count is invalid.");
    if (spec.questionSetRef !== undefined) assert(spec.questionSetRef.trim().length >= 2 && spec.questionSetRef.trim().length <= 500, "Question-set reference is invalid.");
    if (spec.timeLimitMinutes !== undefined) assert(Number.isFinite(spec.timeLimitMinutes) && spec.timeLimitMinutes >= 1 && spec.timeLimitMinutes <= 240, "Workflow time limit is invalid.");
    if (spec.wordLimit !== undefined) assert(Number.isInteger(spec.wordLimit) && spec.wordLimit >= 20 && spec.wordLimit <= 5000, "Word limit is invalid.");
    if (spec.kind === "reconstruction") assert(["outline", "table", "flow", "concept-map", "sequence"].includes(spec.reconstructionShape ?? ""), "Reconstruction form is required.");
    if (spec.kind === "questions") {
      assert(spec.targetCount !== undefined, "Question workflow requires a target count.");
      assert((spec.questionSetRef?.trim().length ?? 0) >= 2, "Question workflow requires a question-set reference.");
    }
    if (spec.kind === "diagram") assert(spec.diagramSurface === "canvas" || spec.diagramSurface === "paper", "Diagram surface is required.");
    if (spec.kind === "answer-writing") {
      assert(spec.answerMode === "outline" || spec.answerMode === "full-answer", "Answer-writing mode is required.");
      assert(spec.timeLimitMinutes !== undefined, "Answer writing requires a time limit.");
      assert(spec.wordLimit !== undefined, "Answer writing requires a word limit.");
    }
    assert(compatibleWorkflows(type).includes(spec.kind), `${workflowLabel(spec.kind)} is not appropriate for ${obligationLabel(type)}.`);
  }

  function workflowSpecFromForm(form: HTMLFormElement, type: ObligationType): WorkflowSpec {
    const data = new FormData(form);
    const kind = String(data.get("workflowKind") ?? defaultWorkflowForType(type)) as RetrievalWorkflow;
    const spec: WorkflowSpec = {
      kind,
      prompt: String(data.get("workflowPrompt") ?? "").trim(),
      checkpoints: String(data.get("workflowCheckpoints") ?? "").split(/\n/).map((item) => item.trim()).filter(Boolean),
      responseMedium: String(data.get("responseMedium") ?? "in-app") as ResponseMedium,
    };
    if (kind === "questions") {
      spec.targetCount = Number(data.get("targetCount"));
      spec.questionSetRef = String(data.get("questionSetRef") ?? "").trim();
    }
    if (kind === "reconstruction") spec.reconstructionShape = String(data.get("reconstructionShape") ?? "outline") as ReconstructionShape;
    if (kind === "diagram") spec.diagramSurface = String(data.get("diagramSurface") ?? "canvas") as DiagramSurface;
    if (kind === "answer-writing") {
      spec.answerMode = String(data.get("answerMode") ?? "full-answer") as AnswerMode;
      spec.timeLimitMinutes = Number(data.get("timeLimitMinutes"));
      spec.wordLimit = Number(data.get("wordLimit"));
    }
    validateWorkflowSpec(spec, type);
    return spec;
  }

  function populateWorkflowOptions(form: HTMLFormElement, type: ObligationType, selected?: RetrievalWorkflow): void {
    const select = form.elements.namedItem("workflowKind") as HTMLSelectElement;
    const allowed = compatibleWorkflows(type);
    select.innerHTML = allowed.map((kind) => `<option value="${kind}">${escapeHtml(workflowLabel(kind))}</option>`).join("");
    select.value = selected && allowed.includes(selected) ? selected : allowed[0]!;
  }

  function populateWorkflowForm(form: HTMLFormElement, spec: WorkflowSpec, type: ObligationType): void {
    populateWorkflowOptions(form, type, spec.kind);
    (form.elements.namedItem("workflowKind") as HTMLSelectElement).value = spec.kind;
    (form.elements.namedItem("responseMedium") as HTMLSelectElement).value = spec.responseMedium;
    (form.elements.namedItem("workflowPrompt") as HTMLTextAreaElement).value = spec.prompt;
    (form.elements.namedItem("workflowCheckpoints") as HTMLTextAreaElement).value = spec.checkpoints.join("\n");
    (form.elements.namedItem("targetCount") as HTMLInputElement).value = String(spec.targetCount ?? 10);
    (form.elements.namedItem("questionSetRef") as HTMLInputElement).value = spec.questionSetRef ?? "External question set";
    (form.elements.namedItem("reconstructionShape") as HTMLSelectElement).value = spec.reconstructionShape ?? "outline";
    (form.elements.namedItem("diagramSurface") as HTMLSelectElement).value = spec.diagramSurface ?? "canvas";
    (form.elements.namedItem("answerMode") as HTMLSelectElement).value = spec.answerMode ?? "full-answer";
    (form.elements.namedItem("timeLimitMinutes") as HTMLInputElement).value = String(spec.timeLimitMinutes ?? 10);
    (form.elements.namedItem("wordLimit") as HTMLInputElement).value = String(spec.wordLimit ?? 150);
    updateWorkflowFields(form);
  }

  function updateWorkflowFields(form: HTMLFormElement): void {
    const kind = (form.elements.namedItem("workflowKind") as HTMLSelectElement).value as RetrievalWorkflow;
    form.querySelectorAll<HTMLElement>("[data-workflow-field]").forEach((field) => {
      field.hidden = field.dataset.workflowField !== kind;
    });
  }

  function applyDefaultWorkflowToForm(form: HTMLFormElement, type: ObligationType): void {
    const protocol = (form.elements.namedItem("protocol") as HTMLTextAreaElement | null)?.value ?? "";
    const success = (form.elements.namedItem("successCriteria") as HTMLTextAreaElement | null)?.value ?? "";
    populateWorkflowForm(form, defaultWorkflowSpec(type, protocol, success), type);
  }

  function checkpointScore(met: number, total: number): 0 | 1 | 2 | 3 | 4 {
    if (total <= 0) return 0;
    return clamp(Math.round((met / total) * 4), 0, 4) as 0 | 1 | 2 | 3 | 4;
  }

  function meanRubric(values: readonly number[]): 0 | 1 | 2 | 3 | 4 {
    return clamp(Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)), 0, 4) as 0 | 1 | 2 | 3 | 4;
  }

  function workflowEvidence(result: WorkflowResult, errorTypes: ErrorType[], correctionNote: string): ObjectiveEvidence {
    let evidence: ObjectiveEvidence;
    if (result.kind === "recall") {
      evidence = {
        completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
        independence: cueLevelScore(result.cueLevel),
        application: 2,
        errorTypes,
        correctionNote,
      };
    } else if (result.kind === "reconstruction") {
      evidence = {
        completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
        independence: cueLevelScore(result.cueLevel),
        application: meanRubric([result.structuralAccuracy, result.relationshipAccuracy]),
        errorTypes,
        correctionNote,
      };
    } else if (result.kind === "questions") {
      const weightedCorrect = result.correct + result.partial * 0.5;
      const accuracy = result.attempted > 0 ? (weightedCorrect / result.attempted) * 100 : 0;
      evidence = {
        completeness: checkpointScore(result.attempted, result.targetCount),
        independence: cueLevelScore(result.cueLevel),
        application: clamp(Math.round(accuracy / 25), 0, 4) as 0 | 1 | 2 | 3 | 4,
        accuracyPercent: roundTo(accuracy, 1),
        errorTypes,
        correctionNote,
      };
    } else if (result.kind === "diagram") {
      evidence = {
        completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
        independence: cueLevelScore(result.cueLevel),
        application: meanRubric([result.labelAccuracy, result.spatialAccuracy, result.processAccuracy]),
        errorTypes,
        correctionNote,
      };
    } else if (result.kind === "answer-writing") {
      let completion = meanRubric([result.demandAddressed, result.structure, result.conclusion]);
      const wordRatio = result.wordLimit > 0 ? result.wordCount / result.wordLimit : 1;
      if (!result.completedWithinTime) completion = clamp(completion - 1, 0, 4) as 0 | 1 | 2 | 3 | 4;
      if (wordRatio < 0.6 || wordRatio > 1.35) completion = clamp(completion - 1, 0, 4) as 0 | 1 | 2 | 3 | 4;
      evidence = {
        completeness: completion,
        independence: cueLevelScore(result.cueLevel),
        application: meanRubric([result.contentAccuracy, result.examplesEvidence, result.demandAddressed]),
        errorTypes,
        correctionNote,
      };
    } else {
      evidence = {
        completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
        independence: result.sourceClosedForVerification ? 4 : 1,
        application: result.repairCompleted ? 3 : 1,
        errorTypes,
        correctionNote,
      };
    }
    return evidence;
  }

  function validateWorkflowResult(result: WorkflowResult, expected: RetrievalWorkflow): void {
    assert(result.kind === expected, "Workflow result does not match the obligation workflow.");
    const integer = (value: number, min: number, max: number, label: string) => assert(Number.isInteger(value) && value >= min && value <= max, `${label} is invalid.`);
    const rubric = (value: number, label: string) => integer(value, 0, 4, label);
    const media = new Set<ResponseMedium>(["in-app", "paper", "oral"]);
    const cues = new Set<CueLevel>(["none", "minor", "major", "source"]);
    if ("cueLevel" in result) assert(cues.has(result.cueLevel), "Cue level is invalid.");
    if ("responseMedium" in result) assert(media.has(result.responseMedium), "Response medium is invalid.");
    if (result.kind === "recall") {
      integer(result.checkpointTotal, 1, 20, "Recall checkpoint total");
      integer(result.checkpointsMet, 0, result.checkpointTotal, "Recall checkpoints met");
    } else if (result.kind === "reconstruction") {
      integer(result.checkpointTotal, 1, 20, "Reconstruction checkpoint total");
      integer(result.checkpointsMet, 0, result.checkpointTotal, "Reconstruction checkpoints met");
      rubric(result.structuralAccuracy, "Structural accuracy"); rubric(result.relationshipAccuracy, "Relationship accuracy");
    } else if (result.kind === "questions") {
      integer(result.targetCount, 1, 500, "Question target");
      integer(result.attempted, 1, 500, "Questions attempted");
      integer(result.correct, 0, result.attempted, "Correct answers");
      integer(result.partial, 0, result.attempted, "Partially correct answers");
      integer(result.incorrect, 0, result.attempted, "Incorrect answers");
      assert(result.correct + result.partial + result.incorrect === result.attempted, "Question outcomes must equal questions attempted.");
      integer(result.novelCount, 0, result.attempted, "Novel questions");
      assert(result.questionSetRef.trim().length >= 2 && result.questionSetRef.trim().length <= 500, "Question-set reference is invalid.");
      assert(result.errorSummary.length <= 5000, "Question error summary is too long.");
    } else if (result.kind === "diagram") {
      integer(result.checkpointTotal, 1, 20, "Diagram checkpoint total");
      integer(result.checkpointsMet, 0, result.checkpointTotal, "Diagram checkpoints met");
      rubric(result.labelAccuracy, "Label accuracy"); rubric(result.spatialAccuracy, "Spatial accuracy"); rubric(result.processAccuracy, "Process accuracy");
      assert(result.attemptCompleted, "Complete the diagram attempt before rating it.");
    } else if (result.kind === "answer-writing") {
      for (const [value, label] of [[result.demandAddressed, "Demand"], [result.structure, "Structure"], [result.contentAccuracy, "Content"], [result.examplesEvidence, "Examples"], [result.conclusion, "Conclusion"]] as const) rubric(value, label);
      assert(Number.isFinite(result.attemptElapsedMs) && result.attemptElapsedMs >= 0 && result.attemptElapsedMs <= 86_400_000, "Answer-writing attempt time is invalid.");
      integer(result.timeLimitMinutes, 1, 240, "Answer-writing time limit");
      integer(result.wordCount, 0, 10000, "Word count");
      integer(result.wordLimit, 20, 5000, "Word limit");
    } else {
      integer(result.checkpointTotal, 1, 20, "Verification checkpoint total");
      integer(result.checkpointsMet, 0, result.checkpointTotal, "Verification checkpoints met");
      assert(ERROR_TYPES.has(result.diagnosis), "Relearning diagnosis is invalid.");
      assert(result.repairAction.trim().length >= 3, "Record the repair action.");
      assert(result.verificationText.trim().length >= 3, "Complete a closed-book verification.");
      assert(result.repairCompleted, "Finish the repair step before verification.");
      assert(result.sourceClosedForVerification, "Complete relearning verification with the source closed.");
    }
  }

  function errorLabel(type: ErrorType): string {
    const labels: Record<ErrorType, string> = {
      "factual-omission": "Factual omission",
      "conceptual-misunderstanding": "Conceptual misunderstanding",
      "confusion-interference": "Confusion / interference",
      "application-failure": "Application failure",
      "answer-structure": "Answer structure",
      "diagram-reconstruction": "Diagram reconstruction",
      "slow-retrieval": "Slow retrieval",
    };
    return labels[type];
  }

  function addDays(from: Date, days: number): Date {
    return new Date(from.getTime() + days * DAY_MS);
  }

  function daysBetween(later: Date, earlier: Date): number {
    return Math.max(0, (later.getTime() - earlier.getTime()) / DAY_MS);
  }

  function intervalLabel(dueAt: ISODateTime, now = new Date()): string {
    const diff = new Date(dueAt).getTime() - now.getTime();
    if (diff < 90 * 60_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
    if (diff < DAY_MS) return `${Math.max(1, Math.round(diff / 3_600_000))}h`;
    const days = Math.max(1, Math.round(diff / DAY_MS));
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${roundTo(days / 365, 1)}y`;
  }

  function studyDayStart(now: Date, boundaryHour: number): Date {
    const start = new Date(now);
    start.setHours(boundaryHour, 0, 0, 0);
    if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
    return start;
  }

  function studyDayEnd(now: Date, boundaryHour: number): Date {
    const end = studyDayStart(now, boundaryHour);
    end.setDate(end.getDate() + 1);
    return end;
  }

  function studyDayKey(now: Date, boundaryHour: number): string {
    const start = studyDayStart(now, boundaryHour);
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, "0");
    const day = String(start.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }



  function defaultSettings(): AppSettings {
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      key: "app",
      activeProfileId: "",
      desiredRetention: 0.9,
      dailyCapacityMinutes: 60,
      studyDayBoundaryHour: 4,
    };
  }

  function validateRating(value: number): Rating {
    assert(value === 1 || value === 2 || value === 3 || value === 4, "Invalid rating.");
    return value;
  }

  const ERROR_TYPES = new Set<ErrorType>([
    "factual-omission", "conceptual-misunderstanding", "confusion-interference",
    "application-failure", "answer-structure", "diagram-reconstruction", "slow-retrieval",
  ]);

  function objectiveScore(type: ObligationType, evidence: ObjectiveEvidence): number {
    const accuracyScore = evidence.accuracyPercent === undefined ? null : clamp(evidence.accuracyPercent / 25, 0, 4);
    let score: number;
    if (type === "memory-recall") {
      score = evidence.completeness * 0.5 + evidence.independence * 0.4 + evidence.application * 0.1;
    } else if (type === "concept-reconstruction") {
      score = evidence.completeness * 0.4 + evidence.independence * 0.35 + evidence.application * 0.25;
    } else if (type === "application-practice" || type === "performance-practice") {
      score = evidence.completeness * 0.2 + evidence.independence * 0.25 + evidence.application * 0.3;
      if (accuracyScore !== null) score += accuracyScore * 0.25;
      else score += evidence.application * 0.25;
    } else {
      score = evidence.completeness * 0.4 + evidence.independence * 0.4 + evidence.application * 0.2;
    }
    const penalty = Math.min(1.2, evidence.errorTypes.length * 0.18);
    return clamp(score - penalty, 0, 4);
  }

  function suggestRating(type: ObligationType, evidence: ObjectiveEvidence): Rating {
    const score = objectiveScore(type, evidence);
    if (score < 1.45) return Rating.Again;
    if (score < 2.45) return Rating.Hard;
    if (score < 3.45) return Rating.Good;
    return Rating.Easy;
  }

  function validateEvidence(evidence: ObjectiveEvidence): void {
    for (const value of [evidence.completeness, evidence.independence, evidence.application]) {
      assert(Number.isInteger(value) && value >= 0 && value <= 4, "Evidence rubric values must be from 0 to 4.");
    }
    if (evidence.accuracyPercent !== undefined) {
      assert(Number.isFinite(evidence.accuracyPercent) && evidence.accuracyPercent >= 0 && evidence.accuracyPercent <= 100, "Accuracy must be between 0 and 100.");
    }
    assert(Array.isArray(evidence.errorTypes), "Evidence errors must be an array.");
    assert(new Set(evidence.errorTypes).size === evidence.errorTypes.length, "Evidence errors cannot contain duplicates.");
    for (const errorType of evidence.errorTypes) assert(ERROR_TYPES.has(errorType), "Evidence contains an invalid error type.");
    assert(typeof evidence.correctionNote === "string", "Evidence correction note is invalid.");
  }

  function runtimeFsrs(): FsrsUmdRuntime {
    assert(typeof FSRS === "object" && FSRS !== null, "Embedded ts-fsrs 6.0.0 failed to initialize. The deployment file may be damaged.");
    assert(typeof FSRS.DefaultScheduler === "function", "Invalid ts-fsrs v6 scheduler runtime.");
    return FSRS;
  }

  /* ========================================================================== 
     SCHEDULER-POLICY ROUTER
     ========================================================================== */

