
  type ISODateTime = string;
  type DocumentSchemaVersion = 1;
  type EntityStatus = "active" | "suspended" | "archived";
  type KnowledgeNodeKind = "subject" | "section" | "topic";
  type ActivityMode = "learn" | "review" | "practice" | "test";
  type StudyOrigin = "manual" | "study-director";
  type ObligationType =
    | "memory-recall"
    | "concept-reconstruction"
    | "application-practice"
    | "performance-practice"
    | "relearn"
    | "freshness-review";
  type ObligationStatus = "active" | "completed" | "suspended" | "archived";
  type SuspensionReason = "unit" | "relearning";
  type ChunkStatus = "pending" | "completed" | "archived";
  type PlanItemStatus = "planned" | "started" | "completed" | "skipped";
  type RetrievalWorkflow = "recall" | "reconstruction" | "questions" | "diagram" | "answer-writing" | "relearning";
  type ResponseMedium = "in-app" | "paper" | "oral";
  type CueLevel = "none" | "minor" | "major" | "source";
  type ReconstructionShape = "outline" | "table" | "flow" | "concept-map" | "sequence";
  type AnswerMode = "outline" | "full-answer";
  type DiagramSurface = "canvas" | "paper";
  type ErrorType =
    | "factual-omission"
    | "conceptual-misunderstanding"
    | "confusion-interference"
    | "application-failure"
    | "answer-structure"
    | "diagram-reconstruction"
    | "slow-retrieval";

  const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 } as const);
  type Rating = typeof Rating[keyof typeof Rating];

  interface ExamProfile {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    name: string;
    examDate: string;
    status: EntityStatus;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
  }

  interface KnowledgeNode {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    profileId: string;
    parentId: string | null;
    kind: KnowledgeNodeKind;
    name: string;
    normalizedName: string;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
  }

  interface KnowledgeUnit {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    profileId: string;
    topicNodeId: string;
    title: string;
    scope: string;
    source: string;
    importance: 1 | 2 | 3;
    status: EntityStatus;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
    latestEvidenceAt?: ISODateTime;
    latestEvidenceRating?: Rating;
    evidenceCount: number;
    lapseCount: number;
  }

  interface StudyEvent {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    profileId: string;
    occurredAt: ISODateTime;
    activityMode: ActivityMode;
    area: string;
    task: string;
    measure: string;
    source: string;
    durationMinutes: number;
    understanding: 1 | 2 | 3 | 4;
    linkedUnitIds: string[];
    notes: string;
    origin: StudyOrigin;
    createdAt: ISODateTime;
  }

  interface StoredFsrsCard {
    model: FsrsModelVersion;
    cardId: string;
    dueAt: ISODateTime;
    stability: number;
    stabilityFast: number;
    difficulty: number;
    scheduledDays: number;
    learningStep: number;
    reps: number;
    lapses: number;
    state: number;
    scheduleStatus: FsrsScheduleStatus;
    lastReviewAt?: ISODateTime;
  }

  interface PolicyState {
    engine: "ts-fsrs" | "mastery" | "application" | "performance" | "relearn" | "freshness";
    version: string;
    stage: number;
    successStreak: number;
    failureCount: number;
    lastIntervalDays: number;
    fsrsCard?: StoredFsrsCard;
  }

  interface WorkflowSpec {
    kind: RetrievalWorkflow;
    prompt: string;
    checkpoints: string[];
    responseMedium: ResponseMedium;
    targetCount?: number;
    questionSetRef?: string;
    timeLimitMinutes?: number;
    wordLimit?: number;
    reconstructionShape?: ReconstructionShape;
    answerMode?: AnswerMode;
    diagramSurface?: DiagramSurface;
  }

  interface ChunkingState {
    cycleId: string;
    status: "chunking" | "synthesis-ready";
    originalMinutes: number;
    synthesisMinutes: number;
    capacityMinutes: number;
    totalChunks: number;
    completedChunks: number;
    createdAt: ISODateTime;
  }

  interface RevisionObligation {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    unitId: string;
    type: ObligationType;
    status: ObligationStatus;
    suspensionReason?: SuspensionReason;
    dueAt: ISODateTime;
    expectedMinutes: number;
    baselineMinutes: number;
    durationSampleCount: number;
    chunking?: ChunkingState;
    protocol: string;
    successCriteria: string;
    workflow: WorkflowSpec;
    freshnessDays: number;
    priority: number;
    policyState: PolicyState;
    parentObligationId?: string;
    returnObligationId?: string;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
    lastCompletedAt?: ISODateTime;
  }

  interface RecallWorkflowResult {
    kind: "recall";
    responseMedium: ResponseMedium;
    attemptText: string;
    checkpointTotal: number;
    checkpointsMet: number;
    cueLevel: CueLevel;
  }

  interface ReconstructionWorkflowResult {
    kind: "reconstruction";
    responseMedium: ResponseMedium;
    attemptText: string;
    shape: ReconstructionShape;
    checkpointTotal: number;
    checkpointsMet: number;
    structuralAccuracy: 0 | 1 | 2 | 3 | 4;
    relationshipAccuracy: 0 | 1 | 2 | 3 | 4;
    cueLevel: CueLevel;
  }

  interface QuestionsWorkflowResult {
    kind: "questions";
    targetCount: number;
    attempted: number;
    correct: number;
    partial: number;
    incorrect: number;
    novelCount: number;
    cueLevel: CueLevel;
    questionSetRef: string;
    attemptNotes: string;
    errorSummary: string;
  }

  interface DiagramWorkflowResult {
    kind: "diagram";
    surface: DiagramSurface;
    checkpointTotal: number;
    checkpointsMet: number;
    labelAccuracy: 0 | 1 | 2 | 3 | 4;
    spatialAccuracy: 0 | 1 | 2 | 3 | 4;
    processAccuracy: 0 | 1 | 2 | 3 | 4;
    cueLevel: CueLevel;
    attemptCompleted: boolean;
    notes: string;
  }

  interface AnswerWritingWorkflowResult {
    kind: "answer-writing";
    mode: AnswerMode;
    responseMedium: ResponseMedium;
    answerText: string;
    demandAddressed: 0 | 1 | 2 | 3 | 4;
    structure: 0 | 1 | 2 | 3 | 4;
    contentAccuracy: 0 | 1 | 2 | 3 | 4;
    examplesEvidence: 0 | 1 | 2 | 3 | 4;
    conclusion: 0 | 1 | 2 | 3 | 4;
    completedWithinTime: boolean;
    attemptElapsedMs: number;
    timeLimitMinutes: number;
    wordCount: number;
    wordLimit: number;
    cueLevel: CueLevel;
  }

  interface RelearningWorkflowResult {
    kind: "relearning";
    diagnosis: ErrorType;
    repairAction: string;
    verificationText: string;
    checkpointTotal: number;
    checkpointsMet: number;
    sourceClosedForVerification: boolean;
    repairCompleted: boolean;
  }

  type WorkflowResult =
    | RecallWorkflowResult
    | ReconstructionWorkflowResult
    | QuestionsWorkflowResult
    | DiagramWorkflowResult
    | AnswerWritingWorkflowResult
    | RelearningWorkflowResult;

  interface ObjectiveEvidence {
    completeness: 0 | 1 | 2 | 3 | 4;
    independence: 0 | 1 | 2 | 3 | 4;
    application: 0 | 1 | 2 | 3 | 4;
    accuracyPercent?: number;
    errorTypes: ErrorType[];
    correctionNote: string;
  }

  interface FsrsConfigSnapshot {
    model: FsrsModelVersion;
    desiredRetention: number;
    fractionalDays: true;
    enableFuzz: false;
    enableShortTerm: true;
    learningSteps: ["1d"];
    relearningSteps: ["1d"];
    graduatingInterval: 1;
    allowModelOverride: true;
    maximumInterval: number;
    clearStatsOnForget: false;
    weightsSource: "ts-fsrs-package-default";
  }

  interface DurationObservation {
    plannedMinutes: number;
    actualMinutes: number;
    accepted: boolean;
    reason: "accepted" | "too-short" | "too-long" | "invalid" | "unreliable-interruption";
    estimateBefore: number;
    estimateAfter: number;
    exactSamples: number;
    unitWorkflowSamples: number;
    globalWorkflowSamples: number;
  }

  interface ReturnedMemoryTransition {
    obligationId: string;
    rating: Rating.Good;
    beforeDueAt: ISODateTime;
    afterDueAt: ISODateTime;
    beforePolicyState: PolicyState;
    afterPolicyState: PolicyState;
    policyId: string;
    schedulerPackage: "ts-fsrs";
    schedulerVersion: "6.0.0";
    schedulerModel: FsrsModelVersion;
    schedulerConfig: FsrsConfigSnapshot;
    reviewLog: Record<string, unknown>;
  }

  interface EvidenceEvent {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    profileId: string;
    unitId: string;
    obligationId: string;
    obligationType: ObligationType;
    reviewedAt: ISODateTime;
    elapsedMs: number;
    evidence: ObjectiveEvidence;
    workflow: RetrievalWorkflow;
    workflowResult: WorkflowResult;
    suggestedRating: Rating;
    confirmedRating: Rating;
    beforeDueAt: ISODateTime;
    afterDueAt: ISODateTime;
    beforePolicyState: PolicyState;
    afterPolicyState: PolicyState;
    policyId: string;
    schedulerPackage?: "ts-fsrs";
    schedulerVersion?: "6.0.0";
    schedulerModel?: FsrsModelVersion;
    schedulerConfig?: FsrsConfigSnapshot;
    reviewLog?: Record<string, unknown>;
    durationObservation: DurationObservation;
    timing: TimingEvidenceSummary;
    followUpObligationId?: string;
    returnedMemoryTransition?: ReturnedMemoryTransition;
    createdAt: ISODateTime;
  }

  interface AppSettings {
    schemaVersion: DocumentSchemaVersion;
    key: "app";
    activeProfileId: string;
    desiredRetention: number;
    dailyCapacityMinutes: number;
    studyDayBoundaryHour: number;
  }

  interface AppMetadata {
    schemaVersion: DocumentSchemaVersion;
    key: "database";
    databaseName: string;
    databaseVersion: number;
    applicationVersion: string;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
  }

  type StoragePersistenceState = "granted" | "available" | "denied" | "unsupported";
  type StorageHealthLevel = "healthy" | "warning" | "critical" | "unavailable";

  interface StorageHealthSnapshot {
    checkedAt: ISODateTime;
    level: StorageHealthLevel;
    indexedDbAvailable: boolean;
    persistence: StoragePersistenceState;
    usageBytes?: number;
    quotaBytes?: number;
    usageRatio?: number;
    diagnosticCount: number;
    lastError?: string;
  }

  interface DiagnosticRecord {
    id: string;
    code: string;
    message: string;
    operation: string;
    firstAt: ISODateTime;
    lastAt: ISODateTime;
    count: number;
  }

  interface UnitDraft {
    id?: string;
    profileId: string;
    subject: string;
    section: string;
    topic: string;
    title: string;
    scope: string;
    source: string;
    importance: 1 | 2 | 3;
    obligationType: ObligationType;
    expectedMinutes: number;
    protocol: string;
    successCriteria: string;
    firstDueAt: ISODateTime;
    freshnessDays: number;
    workflow: WorkflowSpec;
  }

  interface StudyEventDraft {
    profileId: string;
    occurredAt: ISODateTime;
    activityMode: ActivityMode;
    area: string;
    task: string;
    measure: string;
    source: string;
    durationMinutes: number;
    understanding: 1 | 2 | 3 | 4;
    linkedUnitIds: string[];
    notes: string;
    origin: StudyOrigin;
  }

  interface ObligationDraft {
    unitId: string;
    type: ObligationType;
    expectedMinutes: number;
    protocol: string;
    successCriteria: string;
    dueAt: ISODateTime;
    freshnessDays: number;
    workflow: WorkflowSpec;
  }

  interface EvidenceDraft extends ObjectiveEvidence {
    workflowResult: WorkflowResult;
    elapsedMs: number;
    timing: TimingEvidenceSummary;
    confirmedRating: Rating;
  }

  interface JoinedObligation {
    obligation: RevisionObligation;
    unit: KnowledgeUnit;
    profile: ExamProfile;
    subject: string;
    section: string;
    topic: string;
  }

  interface ObligationChunk {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    obligationId: string;
    cycleId: string;
    ordinal: number;
    total: number;
    label: string;
    scope: string;
    expectedMinutes: number;
    status: ChunkStatus;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
    completedAt?: ISODateTime;
    actualMinutes?: number;
    note?: string;
    timing?: TimingEvidenceSummary;
  }

  interface PlanningFactors {
    dueRisk: number;
    examImportance: number;
    weakness: number;
    reviewDuration: number;
    examinationProximity: number;
    weeklyBalance: number;
  }

  interface PlannedQueueItem {
    joined: JoinedObligation;
    factors: PlanningFactors;
    score: number;
    dueState: "overdue" | "due" | "brought-forward";
    daysToExam: number;
    examDateKnown: boolean;
    daysFromDue: number;
    retrievability?: number;
    reasons: string[];
    executionMinutes: number;
    chunk?: ObligationChunk;
  }

  interface DailyPlanItemSnapshot {
    key: string;
    obligationId: string;
    chunkId?: string;
    profileId: string;
    unitId: string;
    subject: string;
    workflow: RetrievalWorkflow;
    title: string;
    estimatedMinutes: number;
    score: number;
    disposition: "selected" | "required-overrun" | "must-split" | "deferred";
    reasons: string[];
  }

  interface DailyPlanVersion {
    version: number;
    generatedAt: ISODateTime;
    capacityMinutes: number;
    items: DailyPlanItemSnapshot[];
    reason: "initial" | "manual-regeneration" | "data-change" | "manual-addition";
  }

  interface DailyPlanOutcome {
    itemKey: string;
    status: PlanItemStatus;
    startedAt?: ISODateTime;
    completedAt?: ISODateTime;
    actualMinutes?: number;
    evidenceEventId?: string;
    note?: string;
  }

  interface DailyPlanRecord {
    schemaVersion: DocumentSchemaVersion;
    id: string;
    studyDayKey: string;
    createdAt: ISODateTime;
    updatedAt: ISODateTime;
    plannerVersion: string;
    versions: DailyPlanVersion[];
    outcomes: DailyPlanOutcome[];
  }

  interface DailyRevisionPlan {
    generatedAt: ISODateTime;
    studyDayKey: string;
    capacityMinutes: number;
    candidateMinutes: number;
    plannedMinutes: number;
    selected: PlannedQueueItem[];
    requiredOverrun: PlannedQueueItem[];
    mustSplit: PlannedQueueItem[];
    deferred: PlannedQueueItem[];
    overdueCount: number;
    dueCount: number;
    broughtForwardCount: number;
    planRecordId: string;
    versionNumber: number;
  }

  interface SchedulePreview {
    rating: Rating;
    dueAt: ISODateTime;
    intervalDays: number;
    label: string;
  }

  interface PolicyCompletion {
    dueAt: ISODateTime;
    policyState: PolicyState;
    policyId: string;
    reviewLog?: Record<string, unknown>;
    schedulerConfig?: FsrsConfigSnapshot;
    followUpType?: "relearn";
  }

  type ReviewPhase = "attempt" | "compare" | "relearn-repair" | "relearn-verify";
  type PhaseTimeState = "running" | "paused" | "gap-pending";
  type InactiveGapClassification = "focus" | "break" | "split" | "ignore";
  type TimeRuntimeSource = "tick" | "visibility" | "focus" | "pageshow" | "recovery" | "snapshot";
  type PauseReason = "manual" | "inactive-gap-break" | "classification-prompt";
  type TimingReliabilityFlag = "ignored-gap" | "backward-clock";

  interface PhaseTransitionRecord {
    from: ReviewPhase;
    to: ReviewPhase;
    at: ISODateTime;
    sourceVisible: boolean;
    reason: "source-reveal" | "begin-verification" | "verification-reveal" | "queue-advance";
  }

  interface PauseRecord {
    id: string;
    reason: PauseReason;
    phase: ReviewPhase;
    startedAt: ISODateTime;
    endedAt: ISODateTime;
    durationMs: number;
  }

  interface GapClassificationRecord {
    id: string;
    phase: ReviewPhase;
    source: TimeRuntimeSource;
    detectedAt: ISODateTime;
    resolvedAt: ISODateTime;
    gapMs: number;
    classification: InactiveGapClassification;
    focusMs: number;
    breakMs: number;
    ignoredMs: number;
    promptMs: number;
  }

  interface PendingInactiveGap {
    id: string;
    phase: ReviewPhase;
    source: TimeRuntimeSource;
    lastReliableAt: ISODateTime;
    detectedAt: ISODateTime;
    gapMs: number;
  }

  interface PhaseTimeRuntimeSnapshot {
    currentPhase: ReviewPhase;
    state: PhaseTimeState;
    sessionStartedAt: ISODateTime;
    lastTickAt: ISODateTime;
    activeByPhase: Record<ReviewPhase, number>;
    pauseStartedAt?: ISODateTime;
    pauseHistory: PauseRecord[];
    phaseHistory: PhaseTransitionRecord[];
    gapHistory: GapClassificationRecord[];
    pendingGap?: PendingInactiveGap;
    sourceVisible: boolean;
    sourceRevealAt?: ISODateTime;
    backwardClockCount: number;
  }

  interface TimingEvidenceSummary {
    totalActiveMs: number;
    activeByPhase: Record<ReviewPhase, number>;
    pauseMs: number;
    pauseCount: number;
    inactiveGapCount: number;
    classifiedFocusMs: number;
    classifiedBreakMs: number;
    ignoredGapMs: number;
    promptExcludedMs: number;
    backwardClockCount: number;
    sourceRevealAt?: ISODateTime;
    durationReliable: boolean;
    reliabilityFlags: TimingReliabilityFlag[];
  }

  interface DiagramPoint { x: number; y: number; }
  type DiagramStroke = DiagramPoint[];

  interface ReviewDraftSnapshot {
    phase: ReviewPhase;
    values: Record<string, string>;
    checked: Record<string, boolean>;
    diagramStrokes: DiagramStroke[];
    attemptElapsedMs: number;
  }

  type ActiveRetrievalStatus = "active" | "committing" | "completed";

  interface ActiveRetrievalSession {
    schemaVersion: DocumentSchemaVersion;
    id: typeof ACTIVE_RETRIEVAL_ID;
    revision: number;
    status: ActiveRetrievalStatus;
    queueTargetIds: string[];
    activeIndex: number;
    activeTargetId: string;
    phase: ReviewPhase;
    draft: ReviewDraftSnapshot;
    timeRuntime: PhaseTimeRuntimeSnapshot;
    elapsedMs: number;
    startedAt: ISODateTime;
    updatedAt: ISODateTime;
    commitToken?: string;
  }

  interface ActiveRetrievalRecoveryEnvelope {
    format: typeof ACTIVE_RETRIEVAL_RECOVERY_FORMAT;
    schemaVersion: 1;
    savedAt: ISODateTime;
    session: ActiveRetrievalSession;
  }

  interface ActiveCommitGuard {
    sessionId: typeof ACTIVE_RETRIEVAL_ID;
    expectedRevision: number;
    targetId: string;
    commitToken: string;
  }

  interface BackupPayload {
    format: "revision-director-backup";
    schemaVersion: 2;
    exportedAt: ISODateTime;
    appVersion: string;
    profiles: ExamProfile[];
    nodes: KnowledgeNode[];
    units: KnowledgeUnit[];
    studyEvents: StudyEvent[];
    obligations: RevisionObligation[];
    evidenceEvents: EvidenceEvent[];
    chunks: ObligationChunk[];
    dailyPlans: DailyPlanRecord[];
    settings: AppSettings;
    activeRetrieval: ActiveRetrievalSession | null;
  }

  type BackupActiveSessionTreatment = "restore" | "discard";

  interface InspectedBackupCandidate {
    id: string;
    inspectedAt: ISODateTime;
    bytes: Uint8Array;
    payload: BackupPayload;
    inspection: BackupInspectionMetadata;
  }

  type BackupSafetyCopyKind = "verified-backup" | "forensic-rescue";

  interface BackupSafetyCopyArtifact {
    proofId: string;
    kind: BackupSafetyCopyKind;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    createdAt: ISODateTime;
    expiresAt: ISODateTime;
    acknowledged: boolean;
    warning?: string;
  }

  interface BackupRestoreResult {
    inspection: BackupInspectionMetadata;
    restoredActiveRetrieval: ActiveRetrievalSession | null;
  }

  /* ========================================================================== 
     UTILITIES & INVARIANTS
     ========================================================================== */

