  /* ==========================================================================
     WORKFLOW FORM ADAPTER · DOM ↔ DOMAIN WORKFLOW CONTRACT
     ========================================================================== */

  function workflowSpecFromForm(form: HTMLFormElement, type: ObligationType): WorkflowSpec {
    const data = new FormData(form);
    const kind = literalChoice(formText(data, "workflowKind", defaultWorkflowForType(type)), RETRIEVAL_WORKFLOWS, "Retrieval workflow");
    const spec: WorkflowSpec = {
      kind,
      prompt: formText(data, "workflowPrompt").trim(),
      checkpoints: formText(data, "workflowCheckpoints").split(/\n/).map((item) => item.trim()).filter(Boolean),
      responseMedium: literalChoice(formText(data, "responseMedium", "in-app"), RESPONSE_MEDIA, "Response medium"),
    };
    if (kind === "questions") {
      spec.targetCount = formNumber(data, "targetCount");
      spec.questionSetRef = formText(data, "questionSetRef").trim();
    }
    if (kind === "reconstruction") spec.reconstructionShape = literalChoice(formText(data, "reconstructionShape", "outline"), RECONSTRUCTION_SHAPES, "Reconstruction shape");
    if (kind === "diagram") spec.diagramSurface = literalChoice(formText(data, "diagramSurface", "canvas"), DIAGRAM_SURFACES, "Diagram surface");
    if (kind === "answer-writing") {
      spec.answerMode = literalChoice(formText(data, "answerMode", "full-answer"), ANSWER_MODES, "Answer mode");
      spec.timeLimitMinutes = formNumber(data, "timeLimitMinutes");
      spec.wordLimit = formNumber(data, "wordLimit");
    }
    validateWorkflowSpec(spec, type);
    return spec;
  }

  function populateWorkflowOptions(form: HTMLFormElement, type: ObligationType, selected?: RetrievalWorkflow): void {
    const select = formSelect(form, "workflowKind");
    const allowed = compatibleWorkflows(type);
    select.innerHTML = allowed.map((kind) => `<option value="${kind}">${escapeHtml(workflowLabel(kind))}</option>`).join("");
    select.value = selected && allowed.includes(selected) ? selected : allowed[0]!;
  }

  function populateWorkflowForm(form: HTMLFormElement, spec: WorkflowSpec, type: ObligationType): void {
    populateWorkflowOptions(form, type, spec.kind);
    formSelect(form, "workflowKind").value = spec.kind;
    formSelect(form, "responseMedium").value = spec.responseMedium;
    formTextarea(form, "workflowPrompt").value = spec.prompt;
    formTextarea(form, "workflowCheckpoints").value = spec.checkpoints.join("\n");
    formInput(form, "targetCount").value = String(spec.targetCount ?? 10);
    formInput(form, "questionSetRef").value = spec.questionSetRef ?? "External question set";
    formSelect(form, "reconstructionShape").value = spec.reconstructionShape ?? "outline";
    formSelect(form, "diagramSurface").value = spec.diagramSurface ?? "canvas";
    formSelect(form, "answerMode").value = spec.answerMode ?? "full-answer";
    formInput(form, "timeLimitMinutes").value = String(spec.timeLimitMinutes ?? 10);
    formInput(form, "wordLimit").value = String(spec.wordLimit ?? 150);
    updateWorkflowFields(form);
  }

  function updateWorkflowFields(form: HTMLFormElement): void {
    const kind = literalChoice(formSelect(form, "workflowKind").value, RETRIEVAL_WORKFLOWS, "Retrieval workflow");
    form.querySelectorAll<HTMLElement>("[data-workflow-field]").forEach((field) => {
      field.hidden = field.dataset["workflowField"] !== kind;
    });
  }

  function applyDefaultWorkflowToForm(form: HTMLFormElement, type: ObligationType): void {
    const protocol = formTextarea(form, "protocol").value;
    const success = formTextarea(form, "successCriteria").value;
    populateWorkflowForm(form, defaultWorkflowSpec(type, protocol, success), type);
  }
