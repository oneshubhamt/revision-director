"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "source/app/source-manifest.json"), "utf8"));
const parts = [...manifest.parts].sort((a,b)=>a.order-b.order);
const source = parts.map(item=>fs.readFileSync(path.join(root, "source", item.path), "utf8")).join("");
const runtime = fs.readFileSync(path.join(root, "source/app/45-ui-runtime.ts"), "utf8");
const workflowFormAdapter = fs.readFileSync(path.join(root, "source/app/46-workflow-form-adapter.ts"), "utf8");
const activeRetrieval = fs.readFileSync(path.join(root, "source/app/47-active-retrieval-workspace.ts"), "utf8");
const settingsWorkspace = fs.readFileSync(path.join(root, "source/app/48-settings-workspace.ts"), "utf8");
const domainKernel = fs.readFileSync(path.join(root, "source/app/11-domain-kernel.ts"), "utf8");
const backupValidation = fs.readFileSync(path.join(root, "source/app/22-backup-validation.ts"), "utf8");
const evidenceTransition = fs.readFileSync(path.join(root, "source/app/23-evidence-transition.ts"), "utf8");
const service = fs.readFileSync(path.join(root, "source/app/40-application-services.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "source/app/50-ui-controller.ts"), "utf8");
const uiSurfaces = ui + settingsWorkspace;
const shell = fs.readFileSync(path.join(root, "source/revision-director.shell.html"), "utf8");
const css = fs.readFileSync(path.join(root, "source/revision-director.va7.css"), "utf8");
let checks = 0;
function check(name, condition) { checks++; if (!condition) throw new Error(name); }

check("Pass C2 identity", source.includes('const APP_VERSION = "va7.1-pass-f1"'));
check("Scheduler port source is manifest-owned", parts.some(item=>item.path === "app/19-revision-scheduler-port.ts") && parts.map(item=>item.order).every((order,index)=>order===index));
check("UI runtime has dedicated ownership", parts.some(item=>item.path === "app/45-ui-runtime.ts"));
check("Render coordinator exists", runtime.includes("class RenderCoordinator"));
check("Named render domains", runtime.includes('type RenderDomain = PaneId | "plan" | "sidebar" | "ownership" | "storage"') && runtime.includes('"plan", "today", "review"'));
check("Dirty domain set", runtime.includes("private readonly dirty = new Set<RenderDomain>()"));
check("Animation-frame batching", runtime.includes("window.requestAnimationFrame"));
check("Serialized async flush", runtime.includes("private activeFlush: Promise<void> | null = null"));
check("Debounced invalidation", runtime.includes("invalidateDebounced"));
check("Deterministic domain order", runtime.includes("RENDER_DOMAIN_ORDER"));
check("Focus snapshot", runtime.includes("interface DocumentFocusSnapshot") && runtime.includes("captureDocumentFocus"));
check("Text selection preserved", runtime.includes("selectionStart") && runtime.includes("selectionEnd"));
check("ARIA tab registry", runtime.includes("class AriaTabRegistry"));
check("Roving tabindex", runtime.includes("entry.tab.tabIndex = selected ? 0 : -1"));
check("Arrow navigation", runtime.includes("ArrowRight") && runtime.includes("ArrowLeft") && runtime.includes("ArrowDown") && runtime.includes("ArrowUp"));
check("Home and End navigation", runtime.includes('event.key === "Home"') && runtime.includes('event.key === "End"'));
check("Automatic tab activation", runtime.includes("this.activate(entry.pane, true, true)"));
check("Native dialog focus manager", runtime.includes("class NativeDialogFocusManager"));
check("Overlay focus manager", runtime.includes("class OverlayFocusManager"));
check("Overlay background inert", runtime.includes("root.inert = true") && runtime.includes("root.inert = false"));
check("Overlay tab containment", runtime.includes('event.key !== "Tab"') && runtime.includes("last.focus") && runtime.includes("first.focus"));
check("Semantic focus fallback", runtime.includes("restoreDocumentFocus(snapshot, fallback)"));
check("Central click delegation", ui.includes('document.addEventListener("click"'));
check("Central submit delegation", ui.includes('document.addEventListener("submit"'));
check("Central input delegation", ui.includes('document.addEventListener("input"'));
check("Central change delegation", ui.includes('document.addEventListener("change"'));
check("Central keyboard delegation", ui.includes('document.addEventListener("keydown"'));
check("Form ID shadowing guarded", ui.includes('form.getAttribute("id")'));
check("Delegated settings uses submitted form",
  ui.includes("this.settingsWorkspace.submit(event)")
  && settingsWorkspace.includes('form.getAttribute("id") === "settings-form"'));
check("Read-only state is a render finalizer", ui.includes('this.applyReadOnlyState();') && ui.indexOf('this.applyReadOnlyState();') < ui.indexOf('if (this.gapFocus.isOpen())'));
check("Settings replacement is fail-closed", /settingsContent\.innerHTML[\s\S]*?this\.host\.applyReadOnlyState\(\);/.test(settingsWorkspace));
check("Diagram pointer stream remains direct", activeRetrieval.includes('canvas.addEventListener("pointerdown"') && activeRetrieval.includes('canvas.addEventListener("pointermove"'));
check("Static ARIA tablist", shell.includes('role="tablist"'));
check("Six static ARIA tabs", (shell.match(/role="tab"/g)||[]).length === 6);
check("Six static ARIA tabpanels", (shell.match(/role="tabpanel"/g)||[]).length === 6);
check("Tab-panel relationships", shell.includes('aria-controls="pane-today"') && shell.includes('aria-labelledby="primary-tab-today"'));
check("Dialog accessible naming", shell.includes('aria-labelledby="unit-dialog-title"') && shell.includes('aria-labelledby="study-dialog-title"') && shell.includes('aria-labelledby="obligation-dialog-title"'));
check("44-pixel general target", css.includes("min-height:44px"));
check("44-pixel file target", css.includes(".file-btn{min-height:44px}"));
check("File input included", css.includes('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'));
check("Reduced motion", css.includes("@media (prefers-reduced-motion:reduce)"));
check("Responsive breakpoint ownership is singular", (() => {
  const values = [...css.matchAll(/@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/g)].map((match) => match[1]);
  return values.length === new Set(values).size && css.includes("CONSOLIDATED RESPONSIVE OVERRIDES");
})());
check("Legacy CSS tokens are absent", !["var(--text-muted)", "var(--txt3)", "var(--f-head)"].some((token) => css.includes(token)));
check("Hidden display invariant is singular", (css.match(/\[hidden\]\{display:none!important\}/g)||[]).length === 1
  && !css.includes(".optimizer-progress[hidden]")
  && !css.includes(".gap-overlay[hidden]")
  && !css.includes(".ownership-banner[hidden]"));
check("Safe-area variables", css.includes("safe-area-inset-bottom") && css.includes("safe-area-inset-left"));
check("Compact independent scroll", css.includes("height:calc(100dvh - 64px - env(safe-area-inset-bottom))") && css.includes("overflow-y:auto"));
check("Viewport cover", shell.includes("viewport-fit=cover"));
check("Workflow form adapter has dedicated ownership", parts.some(item=>item.path === "app/46-workflow-form-adapter.ts"));
check("Active retrieval workspace has dedicated ownership",
  parts.some(item=>item.path === "app/47-active-retrieval-workspace.ts")
  && activeRetrieval.includes("class ActiveRetrievalWorkspace")
  && activeRetrieval.includes("async render()")
  && activeRetrieval.includes("async flushForOwnershipRelease()")
  && !ui.includes("private activeReviewIds")
  && !ui.includes("private reviewPhase")
  && !ui.includes("private phaseTime")
  && !ui.includes("private commitInFlight"));
check("Active retrieval durable commit envelope is canonical",
  activeRetrieval.includes("private async commitActiveRetrievalTransition(")
  && (activeRetrieval.match(/activePersistence\.flush\(committing\)/g) || []).length === 1
  && (activeRetrieval.match(/activePersistence\.acceptCommittedTransition\(post\)/g) || []).length === 1
  && (activeRetrieval.match(/const guard: ActiveCommitGuard/g) || []).length === 1
  && (activeRetrieval.match(/commitActiveRetrievalTransition\(/g) || []).length === 3);
check("Settings workspace has coherent ownership",
  parts.some(item=>item.path === "app/48-settings-workspace.ts")
  && settingsWorkspace.includes("class SettingsWorkspace")
  && settingsWorkspace.includes("async render(): Promise<void>")
  && settingsWorkspace.includes("async submit(event: SubmitEvent)")
  && settingsWorkspace.includes("private async exportBackup()")
  && settingsWorkspace.includes("private async performRestore()")
  && ui.includes("private readonly settingsWorkspace: SettingsWorkspace")
  && ui.includes("this.settingsWorkspace.handleAction(element)")
  && ui.includes("this.settingsWorkspace.handleChange(event)")
  && !ui.includes("private async renderSettings")
  && !ui.includes("private async exportBackup")
  && !ui.includes("fsrsOptimizerRun")
  && !ui.includes("restoreCandidateId"));
check("Domain kernel is DOM-free",
  !/FormData|HTMLFormElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|innerHTML|document\./.test(domainKernel));
check("Workflow form machinery lives in UI adapter",
  workflowFormAdapter.includes("function workflowSpecFromForm")
  && workflowFormAdapter.includes("function populateWorkflowForm")
  && runtime.includes("function formText")
  && runtime.includes("function formInput"));
check("Backup validator is a pure owned module",
  parts.some(item=>item.path === "app/22-backup-validation.ts")
  && backupValidation.includes("function validateBackupPayload")
  && !backupValidation.includes("this.")
  && !service.includes("validateBackup(input: unknown)"));
check("Backup validator is internally decomposed but canonical",
  backupValidation.includes("function validateBackupDocumentSchemas(")
  && backupValidation.includes("function validateBackupKnowledgeStructure(")
  && backupValidation.includes("function validateBackupObligations(")
  && backupValidation.includes("function validateBackupEvidenceEvents(")
  && backupValidation.includes("function validateBackupChunks(")
  && backupValidation.includes("function validateBackupDailyPlans(")
  && backupValidation.includes("function validateBackupHistoricalCounters(")
  && backupValidation.includes("function validateBackupActiveAndSettings(")
  && (backupValidation.match(/function validateBackupPayload\(/g) || []).length === 1);
check("Evidence transition is a pure owned module",
  parts.some(item=>item.path === "app/23-evidence-transition.ts")
  && evidenceTransition.includes("function applyPrimaryEvidenceTransition")
  && evidenceTransition.includes("function applyCorrectiveRelearningTransition")
  && evidenceTransition.includes("function buildEvidenceEvent")
  && !/\bthis\.|RevisionData|IndexedDbRepository/.test(evidenceTransition));
check("RevisionService recordEvidence is orchestration-only at transition boundary",
  service.includes("prepareEvidenceDraft(draft)")
  && service.includes("applyPrimaryEvidenceTransition({")
  && service.includes("buildEvidenceEvent({")
  && !service.includes("const evidence: ObjectiveEvidence = {"));
check("RevisionService evidence subflows are modestly factored",
  service.includes("private async createEvidenceFollowUp(")
  && service.includes("private async applyCorrectiveEvidenceReturn(")
  && service.includes("const followUp = await this.createEvidenceFollowUp(")
  && service.includes("const corrective = await this.applyCorrectiveEvidenceReturn(")
  && (service.match(/this\.repo\.recordReview\(/g) || []).length === 1);

check("Durable identifier HTML sinks are escaped",
  !uiSurfaces.includes('data-id="${unit.id}"')
  && !uiSurfaces.includes('data-id="${obligation.id}"')
  && !uiSurfaces.includes('data-id="${event.id}"')
  && !uiSurfaces.includes('data-id="${profile.id}"')
  && !uiSurfaces.includes('value="${profile.id}"')
  && !uiSurfaces.includes('value="${unit.id}"')
  && !uiSurfaces.includes('data-profile-editor="${profile.id}"')
  && uiSurfaces.includes('data-id="${escapeHtml(unit.id)}"')
  && uiSurfaces.includes('value="${escapeHtml(profile.id)}"'));

console.log(`PASS ${checks} Pass C2 UI-runtime and accessibility checks`);
