import { useEffect, useMemo, useState } from "react";
import { makeClientId } from "../../lib/ids";
import { appStorage } from "../../lib/storage";
import type { QuizTemplate, TemplateDraft, TemplateValidationResult } from "../../types/domain";
import { Button, Dialog, EmptyState, Panel, TextAreaField, TextField } from "../../components/ui";

function createEmptyDraft(): TemplateDraft {
  return {
    title: "",
    questions: [
      {
        localId: makeClientId("draft-question"),
        prompt: "",
        options: [
          { localId: makeClientId("draft-option"), label: "", isCorrect: true },
          { localId: makeClientId("draft-option"), label: "", isCorrect: false },
        ],
      },
    ],
  };
}

export function toTemplateDraft(template: QuizTemplate | null): TemplateDraft {
  if (!template) {
    return createEmptyDraft();
  }
  return {
    id: template.id,
    title: template.title,
    questions: template.questions.map((question) => ({
      id: question.id,
      localId: question.id,
      prompt: question.prompt,
      options: question.options.map((option) => ({
        id: option.id,
        localId: option.id,
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

export function validateTemplateDraft(draft: TemplateDraft): TemplateValidationResult {
  const issues: TemplateValidationResult["issues"] = [];

  if (!draft.title.trim()) {
    issues.push({ path: "title", message: "Quiz title is required." });
  }
  if (draft.questions.length === 0) {
    issues.push({ path: "questions", message: "Add at least one question." });
  }

  draft.questions.forEach((question, questionIndex) => {
    if (!question.prompt.trim()) {
      issues.push({ path: `questions.${questionIndex}.prompt`, message: "Question text is required." });
    }
    const validOptions = question.options.filter((option) => option.label.trim());
    if (validOptions.length < 2) {
      issues.push({
        path: `questions.${questionIndex}.options`,
        message: "Each question needs at least two filled options.",
      });
    }
    if (!question.options.some((option) => option.isCorrect && option.label.trim())) {
      issues.push({
        path: `questions.${questionIndex}.correct`,
        message: "Each question needs at least one correct option.",
      });
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}

function normalizeDraftForComparison(draft: TemplateDraft): unknown {
  return {
    title: draft.title,
    questions: draft.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

function areDraftsEquivalent(first: TemplateDraft, second: TemplateDraft): boolean {
  return JSON.stringify(normalizeDraftForComparison(first)) === JSON.stringify(normalizeDraftForComparison(second));
}

interface TemplateEditorProps {
  template: QuizTemplate | null;
  onSave: (draft: TemplateDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose?: () => void;
  onDraftChange?: () => void;
}

type PendingEditorDeletion =
  | { type: "discard" }
  | { type: "deleteQuiz" }
  | { type: "removeQuestion"; questionId: string }
  | { type: "removeOption"; questionId: string; optionId: string };

export function TemplateEditor(props: TemplateEditorProps) {
  const draftKey = props.template?.id ?? "new";
  const [draft, setDraft] = useState<TemplateDraft>(() => appStorage.getQuizDraft(draftKey) ?? toTemplateDraft(props.template));
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(() => new Set([draft.questions[0]?.localId].filter(Boolean)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [hasLocalDraft, setHasLocalDraft] = useState(() => Boolean(appStorage.getQuizDraft(draftKey)));
  const [pendingDeletion, setPendingDeletion] = useState<PendingEditorDeletion | null>(null);
  const validation = useMemo(() => validateTemplateDraft(draft), [draft]);
  const baseDraft = useMemo(() => toTemplateDraft(props.template), [props.template]);
  const hasDetectedChanges = hasLocalDraft || !areDraftsEquivalent(draft, baseDraft);
  const deleteHandler = props.onDelete;
  const templateActions = (
    <div className="template-action-toolbar">
      <div className="template-action-set">
        <Button variant="draftDanger" onClick={() => setPendingDeletion({ type: "discard" })} disabled={!hasDetectedChanges}>
          Discard changes
        </Button>
        <Button variant="draft" onClick={handleSaveDraft} disabled={!hasDetectedChanges}>
          Save draft
        </Button>
      </div>
      <div className="template-action-set template-action-set-db">
        {deleteHandler ? (
          <Button variant="danger" onClick={() => setPendingDeletion({ type: "deleteQuiz" })}>
            Delete
          </Button>
        ) : null}
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );

  useEffect(() => {
    const nextDraftKey = props.template?.id ?? "new";
    const nextDraft = appStorage.getQuizDraft(nextDraftKey) ?? toTemplateDraft(props.template);
    setDraft(nextDraft);
    setExpandedQuestionIds(new Set([nextDraft.questions[0]?.localId].filter(Boolean)));
    setError("");
    setDraftSaved(false);
    setHasLocalDraft(Boolean(appStorage.getQuizDraft(nextDraftKey)));
  }, [props.template]);

  async function handleSave() {
    if (!validation.valid) {
      setError(validation.issues[0]?.message ?? "Template is invalid.");
      const invalidQuestionIndexes = validation.issues
        .map((issue) => issue.path.match(/^questions\.(\d+)/)?.[1])
        .filter((index): index is string => Boolean(index))
        .map(Number);
      setExpandedQuestionIds((current) => {
        const next = new Set(current);
        for (const questionIndex of invalidQuestionIndexes) {
          const questionId = draft.questions[questionIndex]?.localId;
          if (questionId) {
            next.add(questionId);
          }
        }
        return next;
      });
      return;
    }
    setSaving(true);
    setError("");
    try {
      await props.onSave({
        ...draft,
        title: draft.title.trim(),
        questions: draft.questions.map((question) => ({
          ...question,
          prompt: question.prompt.trim(),
          options: question.options
            .filter((option) => option.label.trim())
            .map((option) => ({ ...option, label: option.label.trim() })),
        })),
      });
      appStorage.clearQuizDraft(draftKey);
      setDraftSaved(false);
      setHasLocalDraft(false);
      props.onDraftChange?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save quiz.");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveDraft() {
    appStorage.setQuizDraft(draftKey, draft);
    setDraftSaved(true);
    setHasLocalDraft(true);
    setError("");
    props.onDraftChange?.();
  }

  function handleDeleteDraft() {
    appStorage.clearQuizDraft(draftKey);
    setDraftSaved(false);
    setHasLocalDraft(false);
    setError("");
    props.onDraftChange?.();
    const restoredDraft = toTemplateDraft(props.template);
    setDraft(restoredDraft);
    setExpandedQuestionIds(new Set([restoredDraft.questions[0]?.localId].filter(Boolean)));
    if (!props.template) {
      props.onClose?.();
    }
  }

  async function confirmPendingDeletion() {
    const deletion = pendingDeletion;
    setPendingDeletion(null);
    if (!deletion) {
      return;
    }
    if (deletion.type === "discard") {
      handleDeleteDraft();
      return;
    }
    if (deletion.type === "deleteQuiz") {
      await deleteHandler?.();
      return;
    }
    if (deletion.type === "removeQuestion") {
      setDraft((current) => ({
        ...current,
        questions: current.questions.filter((question) => question.localId !== deletion.questionId),
      }));
      return;
    }
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.localId === deletion.questionId
          ? {
              ...question,
              options: question.options.filter((option) => option.localId !== deletion.optionId),
            }
          : question,
      ),
    }));
  }

  const pendingDeletionDialog =
    pendingDeletion?.type === "discard"
      ? {
          title: "Discard local changes?",
          body: "This only deletes the local draft saved on this device. The saved quiz in the database will not be deleted.",
          confirmLabel: "Discard changes",
        }
      : pendingDeletion?.type === "deleteQuiz"
        ? {
            title: "Delete quiz?",
            body: "This deletes the saved quiz and its questions. This action cannot be undone.",
            confirmLabel: "Delete quiz",
          }
        : pendingDeletion?.type === "removeQuestion"
          ? {
              title: "Remove question?",
              body: "This removes the question from the current quiz draft.",
              confirmLabel: "Remove question",
            }
          : pendingDeletion?.type === "removeOption"
            ? {
                title: "Remove option?",
                body: "This removes the answer option from the current quiz draft.",
                confirmLabel: "Remove option",
              }
            : null;

  function addQuestion() {
    const nextQuestionId = makeClientId("draft-question");
    setDraft((current) => ({
      ...current,
      questions: [
        ...current.questions,
        {
          localId: nextQuestionId,
          prompt: "",
          options: [
            { localId: makeClientId("draft-option"), label: "", isCorrect: true },
            { localId: makeClientId("draft-option"), label: "", isCorrect: false },
          ],
        },
      ],
    }));
    setExpandedQuestionIds((current) => new Set([...current, nextQuestionId]));
  }

  function toggleQuestion(questionId: string) {
    setExpandedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }

  if (!props.template && draft.questions.length === 0) {
    return (
      <EmptyState
        title="Choose or create a quiz"
        body="Start from a blank quiz and shape the questions for your classroom session."
      />
    );
  }

  return (
    <>
    <Panel
      title={props.template ? "Quiz settings" : "New quiz"}
      className="settings-panel settings-panel-editor"
      actions={
        <div className="template-header-actions">
          {props.onClose ? (
          <button type="button" className="icon-button" aria-label="Close quiz settings" onClick={props.onClose}>
            ×
          </button>
          ) : null}
        </div>
      }
    >
      <div className="stack settings-panel-content">
        {templateActions}
        <TextField
          label="Quiz title"
          value={draft.title}
          onChange={(title) => {
            setDraft((current) => ({ ...current, title }));
            setDraftSaved(false);
          }}
          placeholder="Quiz title"
        />
        {draftSaved ? <p className="draft-save-note">Draft saved locally on this device.</p> : null}

        {draft.questions.map((question, questionIndex) => {
          const isExpanded = expandedQuestionIds.has(question.localId);
          const filledOptions = question.options.filter((option) => option.label.trim()).length;

          return (
            <section
              key={question.localId}
              className={`nested-panel question-editor-panel ${isExpanded ? "expanded" : "collapsed"}`}
            >
              <button
                type="button"
                className="question-toggle"
                aria-expanded={isExpanded}
                onClick={() => toggleQuestion(question.localId)}
              >
                <span className="question-toggle-main">
                  <strong>Question {questionIndex + 1}</strong>
                  <span>{filledOptions} option{filledOptions !== 1 ? "s" : ""}</span>
                </span>
                <span className="question-toggle-icon" aria-hidden="true" />
              </button>

              {isExpanded ? (
                <div className="stack question-editor-body">
                  <TextAreaField
                    label="Question"
                    value={question.prompt}
                    onChange={(prompt) =>
                      setDraft((current) => ({
                        ...current,
                        questions: current.questions.map((item, index) =>
                          index === questionIndex ? { ...item, prompt } : item,
                        ),
                      }))
                    }
                    placeholder="Write the question"
                  />
                  <div className="option-list editor-option-list">
                    {question.options.map((option, optionIndex) => (
                      <div className="option-row" key={option.localId}>
                        <TextField
                          label={`Option ${optionIndex + 1}`}
                          value={option.label}
                          onChange={(label) =>
                            setDraft((current) => ({
                              ...current,
                              questions: current.questions.map((item, index) =>
                                index === questionIndex
                                  ? {
                                      ...item,
                                      options: item.options.map((child, childIndex) =>
                                        childIndex === optionIndex ? { ...child, label } : child,
                                      ),
                                    }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="Answer option"
                        />
                        <label className="correct-answer-visibility-toggle correct-answer-toggle" aria-label="Correct answer">
                          <input
                            type="checkbox"
                            checked={option.isCorrect}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                questions: current.questions.map((item, index) =>
                                  index === questionIndex
                                    ? {
                                        ...item,
                                        options: item.options.map((child, childIndex) =>
                                          childIndex === optionIndex
                                            ? { ...child, isCorrect: event.target.checked }
                                            : child,
                                        ),
                                      }
                                    : item,
                                ),
                              }))
                            }
                          />
                          <span className="toggle-track" aria-hidden="true">
                            <span className="toggle-thumb" />
                          </span>
                        </label>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setPendingDeletion({
                              type: "removeOption",
                              questionId: question.localId,
                              optionId: option.localId,
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="button-row question-editor-actions">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          questions: current.questions.map((item, index) =>
                            index === questionIndex
                              ? {
                                  ...item,
                                  options: [
                                    ...item.options,
                                    { localId: makeClientId("draft-option"), label: "", isCorrect: false },
                                  ],
                                }
                              : item,
                          ),
                        }))
                      }
                    >
                      Add option
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setPendingDeletion({ type: "removeQuestion", questionId: question.localId })}
                    >
                      Remove question
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}

        {error ? <p className="error-text">{error}</p> : null}
        {!validation.valid ? (
          <ul className="validation-list">
            {validation.issues.map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}

        <div className="button-row template-editor-actions">
          <Button variant="secondary" onClick={addQuestion}>
            Add question
          </Button>
        </div>
      </div>
    </Panel>
    {pendingDeletionDialog ? (
      <Dialog
        title={pendingDeletionDialog.title}
        body={pendingDeletionDialog.body}
        confirmLabel={pendingDeletionDialog.confirmLabel}
        cancelLabel="Cancel"
        onConfirm={() => void confirmPendingDeletion()}
        onCancel={() => setPendingDeletion(null)}
      />
    ) : null}
    </>
  );
}
