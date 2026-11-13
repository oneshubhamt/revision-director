  interface BackupSafetyProofRecord {
    id: string;
    candidateId: string;
    candidateArchiveChecksum: string;
    kind: BackupSafetyCopyKind;
    currentStateFingerprint: string;
    createdAt: ISODateTime;
    expiresAt: ISODateTime;
    acknowledged: boolean;
    consumed: boolean;
    artifact: BackupSafetyCopyArtifact;
  }

  interface ForensicRescueEnvelope {
    format: "revision-director-forensic-rescue";
    version: 1;
    createdAt: ISODateTime;
    appVersion: string;
    importable: false;
    reason: string;
    rawStores: Record<string, unknown[]>;
    emergencyRecovery: string | null;
    diagnostics: DiagnosticRecord[];
  }

  const BACKUP_SAFETY_PROOF_TTL_MS = 30 * 60_000;
  const BACKUP_RESCUE_MAX_BYTES = 64 * 1024 * 1024;
  const BACKUP_RESCUE_MIME = "application/x-revision-director-rescue";

  class BackupController {
    private readonly candidates = new Map<string, InspectedBackupCandidate>();
    private readonly proofs = new Map<string, BackupSafetyProofRecord>();

    constructor(private readonly service: RevisionService) {}

    async createVerified(preferCompression = true): Promise<BackupArchiveArtifact> {
      const active = await this.service.currentActiveRetrieval();
      assert(active?.status !== "committing", "Finish or recover the Evidence commit before creating a backup.");
      const artifact = await this.service.createBackupArchive(preferCompression);
      const decoded = await this.service.decodeBackupArchive(artifact.bytes);
      assert(decoded.inspection.archiveChecksum === artifact.inspection.archiveChecksum, "Created backup failed archive self-verification.");
      assert(decoded.inspection.stateChecksum === artifact.inspection.stateChecksum, "Created backup failed state self-verification.");
      assert(decoded.inspection.totalDocuments === artifact.inspection.totalDocuments, "Created backup document count changed during verification.");
      return { bytes: artifact.bytes.slice(), inspection: clone(artifact.inspection) };
    }

    async inspect(bytes: Uint8Array): Promise<InspectedBackupCandidate> {
      const stableBytes = bytes.slice();
      const decoded = await this.service.decodeBackupArchive(stableBytes);
      assert(decoded.payload.activeRetrieval?.status !== "committing", "A backup containing a committing retrieval cannot be restored.");
      const candidate: InspectedBackupCandidate = {
        id: uid("backup_candidate"),
        inspectedAt: nowIso(),
        bytes: stableBytes,
        payload: clone(decoded.payload),
        inspection: clone(decoded.inspection),
      };
      this.candidates.clear();
      this.proofs.clear();
      this.candidates.set(candidate.id, candidate);
      return this.publicCandidate(candidate);
    }

    candidate(id: string): InspectedBackupCandidate {
      const candidate = this.candidates.get(id);
      assert(candidate, "The inspected backup is no longer available. Select the file again.");
      return this.publicCandidate(candidate);
    }

    async createSafetyCopy(candidateId: string): Promise<BackupSafetyCopyArtifact> {
      const candidate = this.requireCandidate(candidateId);
      const currentActive = await this.service.currentActiveRetrieval();
      assert(currentActive?.status !== "committing", "A retrieval Evidence commit is in progress. Finish recovery before restoring data.");
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + BACKUP_SAFETY_PROOF_TTL_MS).toISOString();
      let artifact: BackupSafetyCopyArtifact;
      let fingerprint: string;
      try {
        const verified = await this.createVerified(true);
        const verifiedPayload = (await this.service.decodeBackupArchive(verified.bytes)).payload;
        fingerprint = await BackupCodec.stateFingerprint(verifiedPayload, "sha256");
        artifact = {
          proofId: "",
          kind: "verified-backup",
          filename: `revision-director-safety-${createdAt.slice(0, 10)}.rdbackup`,
          mimeType: BACKUP_ARCHIVE_MIME,
          bytes: verified.bytes,
          createdAt,
          expiresAt,
          acknowledged: false,
        };
      } catch (error) {
        const rescue = await this.createForensicRescue(error);
        fingerprint = rescue.fingerprint;
        artifact = {
          proofId: "",
          kind: "forensic-rescue",
          filename: `revision-director-forensic-rescue-${createdAt.slice(0, 10)}.rdrescue`,
          mimeType: BACKUP_RESCUE_MIME,
          bytes: rescue.bytes,
          createdAt,
          expiresAt,
          acknowledged: false,
          warning: "The current database could not produce a verified backup. This forensic rescue preserves raw local state but cannot be imported automatically.",
        };
      }
      const proofId = uid("safety_proof");
      artifact.proofId = proofId;
      const proof: BackupSafetyProofRecord = {
        id: proofId,
        candidateId: candidate.id,
        candidateArchiveChecksum: candidate.inspection.archiveChecksum,
        kind: artifact.kind,
        currentStateFingerprint: fingerprint,
        createdAt,
        expiresAt,
        acknowledged: false,
        consumed: false,
        artifact: { ...artifact, bytes: artifact.bytes.slice() },
      };
      this.proofs.clear();
      this.proofs.set(proofId, proof);
      return this.publicArtifact(proof.artifact);
    }

    acknowledgeSafetyCopy(proofId: string): BackupSafetyCopyArtifact {
      const proof = this.requireProof(proofId);
      assert(!proof.consumed, "This safety copy has already been used.");
      assert(Date.now() <= new Date(proof.expiresAt).getTime(), "The safety-copy proof expired. Create a new safety copy.");
      proof.acknowledged = true;
      proof.artifact.acknowledged = true;
      return this.publicArtifact(proof.artifact);
    }

    async restore(candidateId: string, proofId: string, treatment: BackupActiveSessionTreatment): Promise<BackupRestoreResult> {
      const candidate = this.requireCandidate(candidateId);
      const proof = this.requireProof(proofId);
      assert(!proof.consumed, "This safety-copy proof has already been used.");
      assert(proof.acknowledged, "Confirm that the current-state safety copy was saved.");
      assert(Date.now() <= new Date(proof.expiresAt).getTime(), "The safety-copy proof expired. Create a new safety copy.");
      assert(proof.candidateId === candidate.id && proof.candidateArchiveChecksum === candidate.inspection.archiveChecksum, "The safety copy does not belong to this inspected backup.");
      const currentActive = await this.service.currentActiveRetrieval();
      assert(currentActive?.status !== "committing", "A retrieval Evidence commit is in progress. Restore is blocked.");
      await this.verifyCurrentStateStillMatches(proof);
      const decoded = await this.service.decodeBackupArchive(candidate.bytes);
      assert(decoded.inspection.archiveChecksum === candidate.inspection.archiveChecksum, "The inspected backup changed before restoration.");
      if (decoded.payload.activeRetrieval) assert(treatment === "restore" || treatment === "discard", "Choose how to treat the unfinished retrieval.");
      else assert(treatment === "discard", "This backup has no unfinished retrieval to restore.");
      await this.service.restoreBackupPayload(decoded.payload, treatment);
      proof.consumed = true;
      this.candidates.delete(candidate.id);
      return {
        inspection: clone(decoded.inspection),
        restoredActiveRetrieval: treatment === "restore" ? clone(decoded.payload.activeRetrieval) : null,
      };
    }

    cancel(candidateId?: string): void {
      if (candidateId) this.candidates.delete(candidateId);
      else this.candidates.clear();
      this.proofs.clear();
    }

    private async verifyCurrentStateStillMatches(proof: BackupSafetyProofRecord): Promise<void> {
      if (proof.kind === "verified-backup") {
        const payload = validateBackupPayload(await this.service.exportBackup());
        const current = await BackupCodec.stateFingerprint(payload, "sha256");
        assert(current === proof.currentStateFingerprint, "Current application data changed after the safety copy was created. Create a new safety copy.");
        return;
      }
      const raw = await this.captureForensicState("verify safety proof");
      const current = await BackupCodec.opaqueFingerprint(raw.fingerprintSource);
      assert(current === proof.currentStateFingerprint, "Current raw application state changed after the forensic rescue was created. Create a new rescue copy.");
    }

    private async createForensicRescue(error: unknown): Promise<{ bytes: Uint8Array; fingerprint: string }> {
      const captured = await this.captureForensicState(error instanceof Error ? error.message : String(error));
      const envelope: ForensicRescueEnvelope = {
        format: "revision-director-forensic-rescue",
        version: 1,
        createdAt: nowIso(),
        appVersion: APP_VERSION,
        importable: false,
        reason: captured.reason,
        rawStores: captured.rawStores,
        emergencyRecovery: captured.emergencyRecovery,
        diagnostics: captured.diagnostics,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(envelope, null, 2));
      assert(bytes.byteLength <= BACKUP_RESCUE_MAX_BYTES, "The forensic rescue exceeds the safety size limit.");
      return { bytes, fingerprint: await BackupCodec.opaqueFingerprint(captured.fingerprintSource) };
    }

    private async captureForensicState(reason: string): Promise<{
      reason: string;
      rawStores: Record<string, unknown[]>;
      emergencyRecovery: string | null;
      diagnostics: DiagnosticRecord[];
      fingerprintSource: unknown;
    }> {
      const rawStores = await this.service.rawStateForRescue();
      let emergencyRecovery: string | null = null;
      try { emergencyRecovery = localStorage.getItem(ACTIVE_RETRIEVAL_RECOVERY_KEY); } catch { emergencyRecovery = null; }
      const diagnostics = this.service.diagnostics();
      return {
        reason,
        rawStores,
        emergencyRecovery,
        diagnostics,
        fingerprintSource: { rawStores, emergencyRecovery, diagnostics },
      };
    }

    private requireCandidate(id: string): InspectedBackupCandidate {
      const candidate = this.candidates.get(id);
      assert(candidate, "The inspected backup is no longer available. Select it again.");
      return candidate;
    }

    private requireProof(id: string): BackupSafetyProofRecord {
      const proof = this.proofs.get(id);
      assert(proof, "The safety-copy proof is unavailable. Create the safety copy again.");
      return proof;
    }

    private publicCandidate(candidate: InspectedBackupCandidate): InspectedBackupCandidate {
      return {
        id: candidate.id,
        inspectedAt: candidate.inspectedAt,
        bytes: candidate.bytes.slice(),
        payload: clone(candidate.payload),
        inspection: clone(candidate.inspection),
      };
    }

    private publicArtifact(artifact: BackupSafetyCopyArtifact): BackupSafetyCopyArtifact {
      return { ...artifact, bytes: artifact.bytes.slice() };
    }
  }
