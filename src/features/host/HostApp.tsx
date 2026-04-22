import { useEffect, useMemo, useRef, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { FiLogOut, FiSettings } from "react-icons/fi";
import type { AppGateway } from "../../types/gateway";
import type {
  ClosedSessionSummary,
  HostStage,
  QuizTemplate,
  QuizTemplateSummary,
  ResultSource,
  SessionAnalytics,
  SessionRecord,
  TemplateDraft,
} from "../../types/domain";
import { APP_TITLE } from "../../lib/branding";
import { appStorage } from "../../lib/storage";
import { buildStudentLink } from "../../lib/url";
import { AppFrame, BarChart, Button, Dialog, EmptyState, KpiCard, LoadingState, Panel, QrPanel, SelectField, StatusPill, TextField } from "../../components/ui";
import { TemplateEditor } from "../templates/TemplateEditor";
import { ResultsView } from "../results/ResultsView";

type AuthState = "booting" | "guest" | "denied" | "teacher";
type GuardAction = "settings" | "archives" | "logout" | null;
type NavigationStage = Exclude<HostStage, "boot" | "live" | "results" | "closed">;
type SessionGroup = {
  label: string;
  sessions: ClosedSessionSummary[];
};
type LocalQuizDraft = {
  key: string;
  draft: TemplateDraft;
};
type PendingSessionDeletion = { type: "allClosed" } | { type: "closedSession"; sessionId: string; title: string };

interface HostAppProps {
  gateway: AppGateway;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function formatSessionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function groupClosedSessions(sessions: ClosedSessionSummary[]): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const groups: SessionGroup[] = [
    { label: "Today", sessions: [] },
    { label: "This week", sessions: [] },
    { label: "Older", sessions: [] },
  ];

  for (const session of sessions) {
    const createdTime = new Date(session.createdAt).getTime();
    if (createdTime >= startOfToday) {
      groups[0].sessions.push(session);
    } else if (createdTime >= startOfWeek) {
      groups[1].sessions.push(session);
    } else {
      groups[2].sessions.push(session);
    }
  }

  return groups.filter((group) => group.sessions.length > 0);
}

export function HostApp(props: HostAppProps) {
  const [authState, setAuthState] = useState<AuthState>("booting");
  const [email, setEmail] = useState<string | null>(null);
  const [stage, setStage] = useState<HostStage>("boot");
  const [templates, setTemplates] = useState<QuizTemplateSummary[]>([]);
  const [quizDraftKeys, setQuizDraftKeys] = useState<Set<string>>(() => new Set(appStorage.getQuizDraftKeys()));
  const [localQuizDrafts, setLocalQuizDrafts] = useState<LocalQuizDraft[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [editingTemplate, setEditingTemplate] = useState<QuizTemplate | null>(null);
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [analytics, setAnalytics] = useState<SessionAnalytics | null>(null);
  const [closedSessions, setClosedSessions] = useState<ClosedSessionSummary[]>([]);
  const [resultSource, setResultSource] = useState<ResultSource>("live");
  const [resultQuestionIndex, setResultQuestionIndex] = useState(0);
  const [isStudentLinkVisible, setIsStudentLinkVisible] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Checking access...");
  const [error, setError] = useState("");
  const [guardAction, setGuardAction] = useState<GuardAction>(null);
  const [pendingLiveExitStage, setPendingLiveExitStage] = useState<NavigationStage | null>(null);
  const [shouldHideLiveExitHint, setShouldHideLiveExitHint] = useState(false);
  const [openingArchiveSessionId, setOpeningArchiveSessionId] = useState<string | null>(null);
  const [isEnteringLiveSession, setIsEnteringLiveSession] = useState(false);
  const [deletingArchiveSessionIds, setDeletingArchiveSessionIds] = useState<Set<string>>(new Set());
  const [pendingSessionDeletion, setPendingSessionDeletion] = useState<PendingSessionDeletion | null>(null);
  const workspaceRestoredRef = useRef(false);
  const skipClosedInterstitialRef = useRef(false);
  const stageRef = useRef<HostStage>("boot");

  stageRef.current = stage;

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        setLoadingLabel("Checking access...");
        const auth = await props.gateway.auth.getSnapshot();
        if (!active) {
          return;
        }
        setEmail(auth.user?.email ?? null);
        if (!auth.user) {
          setAuthState("guest");
          setStage("boot");
          return;
        }
        const isTeacher = await props.gateway.auth.isTeacher();
        if (!active) {
          return;
        }
        if (!isTeacher) {
          setAuthState("denied");
          return;
        }
        setAuthState("teacher");
        await syncTemplates();
        await restoreWorkspace();
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to bootstrap host area.");
        }
      }
    }

    void boot();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "teacher") {
      return;
    }
    if ((stage === "live" || stage === "results") && session?.id) {
      const sessionId = session.id;
      return props.gateway.sessions.subscribeToSession(sessionId, () => {
        void refreshAnalytics(sessionId, false);
      });
    }
    return undefined;
  }, [authState, stage, session?.id]);

  async function syncTemplates(nextTemplateId?: string) {
    const nextTemplates = await props.gateway.templates.list();
    setTemplates(nextTemplates);
    syncLocalDraftState(nextTemplates);
    const targetId = nextTemplateId ?? selectedTemplateId ?? nextTemplates[0]?.id ?? "";
    setSelectedTemplateId(targetId);
    setEditingTemplate(targetId ? await props.gateway.templates.getById(targetId) : null);
  }

  function syncLocalDraftState(currentTemplates = templates) {
    const draftKeys = appStorage.getQuizDraftKeys();
    setQuizDraftKeys(new Set(draftKeys));
    setLocalQuizDrafts(
      draftKeys
        .filter((key) => !currentTemplates.some((template) => template.id === key))
        .map((key) => ({ key, draft: appStorage.getQuizDraft(key) }))
        .filter((item): item is LocalQuizDraft => Boolean(item.draft)),
    );
  }

  async function openTemplateEditor(templateId: string) {
    setSelectedTemplateId(templateId);
    if (editingTemplate?.id === templateId) {
      setIsTemplateEditorOpen(true);
      return;
    }
    const nextTemplate = await props.gateway.templates.getById(templateId);
    setEditingTemplate(nextTemplate);
    setIsTemplateEditorOpen(true);
  }

  function openNewTemplateEditor() {
    setSelectedTemplateId("");
    setEditingTemplate(null);
    setIsTemplateEditorOpen(true);
  }

  function openLocalDraftEditor() {
    setSelectedTemplateId("");
    setEditingTemplate(null);
    setIsTemplateEditorOpen(true);
  }

  function closeTemplateEditor() {
    setIsTemplateEditorOpen(false);
    setSelectedTemplateId("");
  }

  async function restoreWorkspace() {
    const snapshot = appStorage.getHostWorkspace();
    if (!snapshot) {
      setStage("setup");
      workspaceRestoredRef.current = true;
      return;
    }
    setSelectedTemplateId(snapshot.selectedTemplateId ?? "");
    setResultSource(snapshot.resultSource);
    setResultQuestionIndex(snapshot.resultQuestionIndex);

    if (!snapshot.sessionId) {
      if (snapshot.stage === "settings" || snapshot.stage === "archives") {
        await goToStage(snapshot.stage);
      } else {
        setStage("setup");
      }
      workspaceRestoredRef.current = true;
      return;
    }

    const restoredSession = await props.gateway.sessions.getById(snapshot.sessionId);
    if (!restoredSession) {
      appStorage.clearHostWorkspace();
      setStage("setup");
      workspaceRestoredRef.current = true;
      return;
    }

    setSession(restoredSession);
    if (restoredSession.status === "open") {
      await refreshAnalytics(restoredSession.id, true);
      if (snapshot.stage === "results") {
        setStage("results");
      } else {
        setStage("live");
      }
      workspaceRestoredRef.current = true;
      return;
    }

    if (snapshot.stage === "results") {
      await refreshAnalytics(restoredSession.id, true);
      setStage("results");
    } else {
      setSession(null);
      setAnalytics(null);
      setStage("setup");
      appStorage.clearHostWorkspace();
    }
    workspaceRestoredRef.current = true;
  }

  function persistWorkspace(
    nextStage: HostStage,
    overrides?: Partial<{
      sessionId: string | null;
      templateId: string | null;
      source: ResultSource;
      questionIndex: number;
    }>,
  ) {
    appStorage.setHostWorkspace({
      stage: nextStage,
      sessionId: overrides?.sessionId ?? session?.id ?? null,
      selectedTemplateId: overrides?.templateId ?? (selectedTemplateId || null),
      resultSource: overrides?.source ?? resultSource,
      resultQuestionIndex: overrides?.questionIndex ?? resultQuestionIndex,
    });
  }

  async function refreshAnalytics(sessionId: string, hardRefresh: boolean) {
    if (hardRefresh) {
      setLoadingLabel("Refreshing live session...");
    }
    const nextAnalytics = await props.gateway.sessions.getAnalytics(sessionId);
    setAnalytics(nextAnalytics);
    setSession(nextAnalytics.session);
    if (nextAnalytics.session.status === "closed" && stageRef.current === "live" && !skipClosedInterstitialRef.current) {
      setStage("setup");
      persistWorkspace("setup", { sessionId: null });
    }
  }

  async function continueToStage(nextStage: NavigationStage) {
    if (nextStage === "archives") {
      setClosedSessions(await props.gateway.sessions.listClosed());
    }
    if (nextStage === "settings") {
      await syncTemplates();
      setIsTemplateEditorOpen(false);
    }
    setStage(nextStage);
    persistWorkspace(nextStage);
  }

  async function goToStage(nextStage: NavigationStage) {
    if (
      stage === "live" &&
      session?.status === "open" &&
      !appStorage.getLiveExitHintDismissed()
    ) {
      setShouldHideLiveExitHint(false);
      setPendingLiveExitStage(nextStage);
      return;
    }
    await continueToStage(nextStage);
  }

  async function confirmLiveExitHint() {
    const targetStage = pendingLiveExitStage;
    if (!targetStage) {
      return;
    }
    if (shouldHideLiveExitHint) {
      appStorage.setLiveExitHintDismissed(true);
    }
    setPendingLiveExitStage(null);
    await continueToStage(targetStage);
  }

  async function startSession() {
    const activeTemplateId = selectedTemplateId || templates[0]?.id || "";
    if (!activeTemplateId) {
      return;
    }
    const template =
      editingTemplate?.id === activeTemplateId
        ? editingTemplate
        : await props.gateway.templates.getById(activeTemplateId);
    if (!template) {
      return;
    }
    setSelectedTemplateId(activeTemplateId);
    const nextSession = await props.gateway.sessions.start({
      templateId: template.id,
      templateTitleSnapshot: template.title,
    });
    setSession(nextSession);
    setResultSource("live");
    setResultQuestionIndex(0);
    setStage("live");
    persistWorkspace("live", {
      sessionId: nextSession.id,
      source: "live",
      questionIndex: 0,
    });
    await refreshAnalytics(nextSession.id, true);
  }

  async function closeCurrentSession(targetStage: HostStage = "closed") {
    if (!session) {
      return;
    }
    const closed = await props.gateway.sessions.close(session.id);
    setSession(closed);
    if (targetStage === "results") {
      skipClosedInterstitialRef.current = true;
      try {
        setResultSource("closed");
        await refreshAnalytics(closed.id, true);
        setStage("results");
        persistWorkspace("results", { sessionId: closed.id, source: "closed" });
      } finally {
        skipClosedInterstitialRef.current = false;
      }
      return;
    }
    setSession(closed);
  }

  async function runGuardAction() {
    const action = guardAction;
    setGuardAction(null);
    await closeCurrentSession("closed");
    if (action === "settings") {
      await goToStage("settings");
      return;
    }
    if (action === "archives") {
      await goToStage("archives");
      return;
    }
    if (action === "logout") {
      await props.gateway.auth.signOut();
      appStorage.clearHostWorkspace();
      setAuthState("guest");
      setStage("boot");
    }
  }

  async function openResults(source: ResultSource) {
    if (!session) {
      return;
    }
    setResultSource(source);
    setResultQuestionIndex(0);
    persistWorkspace("results", { source, questionIndex: 0 });
    await refreshAnalytics(session.id, true);
    setStage("results");
  }

  async function handleTemplateSave(templateDraft: Parameters<typeof props.gateway.templates.save>[0]) {
    const saved = await props.gateway.templates.save(templateDraft);
    setEditingTemplate(saved);
    setSelectedTemplateId(saved.id);
    setIsTemplateEditorOpen(true);
    await syncTemplates(saved.id);
  }

  async function handleTemplateDelete() {
    if (!editingTemplate) {
      return;
    }
    await props.gateway.templates.deleteById(editingTemplate.id);
    setEditingTemplate(null);
    setIsTemplateEditorOpen(false);
    await syncTemplates("");
  }

  async function confirmPendingSessionDeletion() {
    const deletion = pendingSessionDeletion;
    setPendingSessionDeletion(null);
    if (!deletion) {
      return;
    }
    if (deletion.type === "allClosed") {
      await props.gateway.sessions.deleteAllClosed();
      setClosedSessions([]);
      return;
    }
    setDeletingArchiveSessionIds((current) => new Set([...current, deletion.sessionId]));
    window.setTimeout(() => {
      void props.gateway.sessions.deleteClosed(deletion.sessionId).then(async () => {
        setClosedSessions(await props.gateway.sessions.listClosed());
        setDeletingArchiveSessionIds((current) => {
          const next = new Set(current);
          next.delete(deletion.sessionId);
          return next;
        });
      });
    }, 180);
  }

  const pendingSessionDeletionDialog =
    pendingSessionDeletion?.type === "allClosed"
      ? {
          title: "Delete closed sessions?",
          body: "This deletes all closed session archives and their results. This action cannot be undone.",
          confirmLabel: "Delete sessions",
        }
      : pendingSessionDeletion?.type === "closedSession"
        ? {
            title: "Delete session?",
            body: `This deletes the archived session "${pendingSessionDeletion.title}" and its results. This action cannot be undone.`,
            confirmLabel: "Delete session",
          }
        : null;

  async function logout() {
    if (session?.status === "open") {
      setGuardAction("logout");
      return;
    }
    await props.gateway.auth.signOut();
    appStorage.clearHostWorkspace();
    setAuthState("guest");
    setStage("boot");
  }

  const studentLink = useMemo(() => {
    if (!session) {
      return "";
    }
    return buildStudentLink(appStorage.getParticipantBaseUrl(), session.code);
  }, [session]);
  const closedSessionGroups = useMemo(() => groupClosedSessions(closedSessions), [closedSessions]);
  const hasLiveResults = useMemo(
    () => (analytics?.questions ?? []).some((question) => question.options.some((option) => option.count > 0)),
    [analytics],
  );

  useEffect(() => {
    if (authState !== "teacher" || !workspaceRestoredRef.current) {
      return;
    }
    persistWorkspace(stage);
  }, [stage, session?.id, selectedTemplateId, resultSource, resultQuestionIndex, authState]);

  useEffect(() => {
    const suffix =
      stage === "live"
        ? "Live Session"
        : stage === "results"
          ? "Results"
          : stage === "settings"
            ? "Settings"
            : stage === "archives"
              ? "Sessions"
              : "Home";
    document.title = `${APP_TITLE} · ${suffix}`;
  }, [stage]);

  if (authState === "booting") {
    return (
      <AppFrame title="Host workspace" subtitle="Preparing the teacher dashboard.">
        <LoadingState label={loadingLabel} />
      </AppFrame>
    );
  }

  if (authState === "guest") {
    return (
      <AppFrame title={APP_TITLE} eyebrow={null} subtitle="Sign in with your account to manage quizzes and live sessions.">
        <Panel title="Login" className="teacher-access-panel">
          <div className="stack teacher-access-content">
            <p>Use your authorized Google account to open the workspace.</p>
            <Button onClick={() => void props.gateway.auth.signInWithGoogle()}>
              <span className="google-signin-label">
                <FcGoogle className="google-logo" aria-hidden="true" />
                Sign in with Google
              </span>
            </Button>
          </div>
        </Panel>
      </AppFrame>
    );
  }

  if (authState === "denied") {
    return (
      <AppFrame title="Access denied" subtitle="This Google account is authenticated but not authorized as a teacher.">
        <Panel title="Teacher whitelist required">
          <p>{email ?? "Unknown email"} is not currently allowed by the `is_teacher()` rule.</p>
          <Button variant="secondary" onClick={() => void logout()}>
            Logout
          </Button>
        </Panel>
      </AppFrame>
    );
  }

  const pageTitle =
    stage === "settings"
      ? "Settings"
      : stage === "archives"
        ? "Sessions"
        : stage === "live"
          ? "Live Session"
          : stage === "results"
            ? "Results"
      : "Home";

  return (
    <AppFrame
      title={pageTitle}
      eyebrow={null}
      className={pendingLiveExitStage ? "live-exit-help-active" : undefined}
      actions={
        <nav className="host-nav">
          <Button variant={stage === "setup" ? "primary" : "ghost"} onClick={() => void goToStage("setup")}>
            Home
          </Button>
          <Button variant={stage === "archives" ? "primary" : "ghost"} onClick={() => void goToStage("archives")}>
            <span className={`sessions-nav-label ${pendingLiveExitStage ? "live-exit-focus" : ""}`}>
              <span className={`live-nav-dot ${session?.status === "open" ? "visible" : ""}`} aria-hidden="true" />
              <span>Sessions</span>
            </span>
          </Button>
          <Button variant={stage === "settings" ? "primary" : "ghost"} className="topbar-icon-button" onClick={() => void goToStage("settings")}>
            <span className="topbar-icon-label">
              <FiSettings aria-hidden="true" />
              <span className="sr-only">Settings</span>
            </span>
          </Button>
          <Button variant="ghost" className="topbar-icon-button" onClick={() => void logout()}>
            <span className="topbar-icon-label logout-icon-label">
              <FiLogOut aria-hidden="true" />
              <span className="sr-only">Logout</span>
            </span>
          </Button>
        </nav>
      }
    >
      {error ? <p className="error-text">{error}</p> : null}

      {stage === "setup" ? (
        <div className="setup-stage">
          <Panel
            title="Start live session"
            description="Choose a quiz and launch a live classroom session."
            className="setup-panel"
          >
            {templates.length === 0 ? (
              <EmptyState
                title="No quizzes yet"
                body="Create the first quiz in Settings before launching a live session."
                action={
                  <Button onClick={() => void goToStage("settings")}>
                    Open settings
                  </Button>
                }
              />
            ) : (
              <div className="stack setup-panel-body">
                <SelectField
                  label="Quiz"
                  value={selectedTemplateId || templates[0]?.id || ""}
                  options={templates.map((template) => ({ value: template.id, label: template.title }))}
                  onChange={(templateId) => {
                    setSelectedTemplateId(templateId);
                    void props.gateway.templates.getById(templateId).then((template) => setEditingTemplate(template));
                  }}
                  disabled={session?.status === "open"}
                />
                <div className="button-row">
                  <Button onClick={() => void startSession()} disabled={session?.status === "open"}>Start live session</Button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {stage === "settings" ? (
        <div className={`settings-layout ${isTemplateEditorOpen ? "editor-open" : "editor-closed"}`}>
          <div className="settings-column settings-column-list">
            <Panel title="Quiz" description="Select a quiz or create a new one." className="settings-panel settings-panel-list management-panel">
              <div className="management-header">
                <span>{templates.length + localQuizDrafts.length} quiz{templates.length + localQuizDrafts.length !== 1 ? "zes" : ""}</span>
                <Button variant="secondary" onClick={openNewTemplateEditor}>
                  New quiz
                </Button>
              </div>
              <div className="stack settings-panel-content scroll-list">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`list-item management-item template-row ${isTemplateEditorOpen && selectedTemplateId === template.id ? "active" : ""}`}
                    onClick={() => void openTemplateEditor(template.id)}
                    >
                    <span className="management-item-main">
                      <strong>{template.title}</strong>
                    </span>
                    <span className="management-item-meta">
                      <span>{formatShortDate(template.createdAt)}</span>
                      {quizDraftKeys.has(template.id) ? <span className="draft-pill">Draft</span> : null}
                    </span>
                  </button>
                ))}
                {localQuizDrafts.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`list-item management-item template-row ${isTemplateEditorOpen && !selectedTemplateId ? "active" : ""}`}
                    onClick={openLocalDraftEditor}
                  >
                    <span className="management-item-main">
                      <strong>{item.draft.title.trim() || "Untitled quiz draft"}</strong>
                    </span>
                    <span className="management-item-meta">
                      <span>Local</span>
                      <span className="draft-pill">Draft</span>
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          <div className={`settings-column settings-column-editor ${isTemplateEditorOpen ? "open" : "closed"}`}>
            <TemplateEditor
              template={editingTemplate}
              onSave={handleTemplateSave}
              onDelete={editingTemplate ? handleTemplateDelete : undefined}
              onClose={closeTemplateEditor}
              onDraftChange={() => syncLocalDraftState()}
            />
          </div>
        </div>
      ) : null}

      {stage === "live" && session ? (
        <div className={`live-layout ${hasLiveResults ? "results-open" : "results-closed"}`}>
          <div className="live-column live-column-main">
          <Panel
            title={session.templateTitleSnapshot ?? "Live session"}
            description={`Session code: ${session.code}`}
            className="live-session-panel"
            actions={
              <StatusPill tone="open">
                <span className="live-status-pill">
                  <span className="live-nav-dot visible" aria-hidden="true" />
                  <span>Live</span>
                </span>
              </StatusPill>
            }
          >
            <div className="stack">
              <div className="kpi-grid">
                <KpiCard label="Connected" value={analytics?.participantCount ?? 0} />
                <KpiCard label="Completed" value={analytics?.completedCount ?? 0} />
              </div>
              <QrPanel title="Student link" value={studentLink} href={studentLink} isLinkVisible={isStudentLinkVisible} />
              <div className="button-row live-session-actions">
                <Button variant="secondary" onClick={() => setIsStudentLinkVisible((current) => !current)}>
                  {isStudentLinkVisible ? "Hide link" : "Show link"}
                </Button>
                <Button variant="danger" onClick={() => void closeCurrentSession("results")}>
                  Close session
                </Button>
              </div>
            </div>
          </Panel>
          </div>

          <div className={`live-column live-column-results ${hasLiveResults ? "open" : "closed"}`}>
          {(() => {
            const liveQuestion = analytics?.questions[resultQuestionIndex];
            return (
              <Panel
                title={liveQuestion ? `Live results — Q${resultQuestionIndex + 1} of ${analytics!.questions.length}` : "Live results"}
                description={liveQuestion?.prompt ?? "Waiting for participants…"}
                className="results-question-panel live-results-panel"
              >
                {liveQuestion ? (
                  <div className="stack results-question-content">
                    <div className="results-chart-area">
                      <BarChart
                        items={liveQuestion.options.map((option) => ({
                          label: option.label,
                          value: option.count,
                          percentage: option.percentage,
                          isCorrect: option.isCorrect,
                        }))}
                        showCorrectHighlight={false}
                      />
                    </div>
                      <div className="button-row question-nav-actions">
                        <Button
                          variant="secondary"
                          onClick={() => setResultQuestionIndex((i) => Math.max(0, i - 1))}
                          disabled={resultQuestionIndex === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setResultQuestionIndex((i) => Math.min((analytics?.questions.length ?? 1) - 1, i + 1))}
                          disabled={resultQuestionIndex >= (analytics?.questions.length ?? 1) - 1}
                        >
                          Next
                        </Button>
                      </div>
                  </div>
                ) : (
                  <p>Results will appear here as participants answer.</p>
                )}
              </Panel>
            );
          })()}
          </div>
        </div>
      ) : null}

      {stage === "results" && analytics ? (
        <div className="results-stage">
          {resultSource === "past" ? (
            <div className="results-stage-bar">
              <Button
                variant="secondary"
                onClick={() => {
                  setStage("archives");
                  persistWorkspace("archives", { sessionId: session?.id ?? null });
                }}
              >
                <span className="back-to-sessions-label" aria-hidden="true" />
                <span>Back</span>
              </Button>
            </div>
          ) : null}
          <ResultsView
            analytics={analytics}
            questionIndex={resultQuestionIndex}
            onQuestionIndexChange={(next) => {
              setResultQuestionIndex(next);
              persistWorkspace("results", { questionIndex: next });
            }}
            onCloseSession={analytics.session.status === "open" ? () => void closeCurrentSession("results") : undefined}
          />
        </div>
      ) : null}

      {stage === "archives" ? (
        <div className="archives-stage">
          <div className="archives-header">
            <div>
              <p className="archives-kicker">
                {session?.status === "open" ? "1 live session" : "No live session"} · {closedSessions.length} closed session{closedSessions.length !== 1 ? "s" : ""}
              </p>
              <p className="archives-copy">Monitor the current live session or reopen closed results.</p>
            </div>
            {closedSessions.length > 0 ? (
              <Button
                variant="danger"
                onClick={() => setPendingSessionDeletion({ type: "allClosed" })}
              >
                Delete closed sessions
              </Button>
            ) : null}
          </div>
          <div className="archives-body">
            {session?.status === "open" ? (
              <div className={`live-session-card ${isEnteringLiveSession ? "entering" : ""}`}>
                <div className="archive-session-main">
                  <div className="live-session-title-row">
                    <strong>{session.templateTitleSnapshot ?? "Live session"}</strong>
                    <StatusPill tone="open">Live</StatusPill>
                  </div>
                  <div className="archive-session-meta">
                    <span className="archive-session-code">{session.code}</span>
                    <span>{formatSessionDate(session.createdAt)}</span>
                    <span>{analytics?.participantCount ?? 0} participant{(analytics?.participantCount ?? 0) !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="archive-actions">
                  <Button
                    variant="secondary"
                    disabled={isEnteringLiveSession}
                    onClick={() => {
                      setIsEnteringLiveSession(true);
                      window.setTimeout(() => {
                        setStage("live");
                        setIsEnteringLiveSession(false);
                      }, 220);
                    }}
                  >
                    Enter live session
                  </Button>
                </div>
              </div>
            ) : null}
            {closedSessions.length === 0 && session?.status !== "open" ? (
              <EmptyState title="No sessions yet" body="Live and closed sessions will appear here." />
            ) : null}
            {closedSessions.length > 0 ? (
              <div className="archives-content">
                <div className="archives-list scroll-list" role="list" aria-label="Closed sessions list">
                  {closedSessionGroups.map((group) => (
                    <section className="session-group" key={group.label} aria-label={group.label}>
                      <div className="session-group-heading">
                        <h3>{group.label}</h3>
                        <span>{group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="session-group-list">
                        {group.sessions.map((closed) => (
                          <div
                            className={`list-item management-item archive-row ${openingArchiveSessionId === closed.id ? "opening" : ""} ${deletingArchiveSessionIds.has(closed.id) ? "deleting" : ""}`}
                            key={closed.id}
                            role="listitem"
                          >
                            <div className="archive-session-main">
                              <strong>{closed.templateTitleSnapshot ?? "Untitled session"}</strong>
                              <div className="archive-session-meta">
                                <span className="archive-session-code">{closed.code}</span>
                                <span>{formatSessionDate(closed.createdAt)}</span>
                                <span>{closed.participantCount} participant{closed.participantCount !== 1 ? "s" : ""}</span>
                              </div>
                            </div>
                            <div className="archive-actions">
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setOpeningArchiveSessionId(closed.id);
                                  setSession(closed);
                                  setResultSource("past");
                                  setResultQuestionIndex(0);
                                  persistWorkspace("results", {
                                    sessionId: closed.id,
                                    source: "past",
                                    questionIndex: 0,
                                  });
                                  void refreshAnalytics(closed.id, true).then(() => {
                                    setStage("results");
                                    setOpeningArchiveSessionId(null);
                                  });
                                }}
                              >
                                Open results
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() =>
                                  setPendingSessionDeletion({
                                    type: "closedSession",
                                    sessionId: closed.id,
                                    title: closed.templateTitleSnapshot ?? "Untitled session",
                                  })
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {guardAction ? (
        <Dialog
          title="Close live session before logout"
          body="Logout is blocked while a live session is open. Close it now and sign out."
          confirmLabel="Close session and logout"
          cancelLabel="Stay here"
          onConfirm={() => void runGuardAction()}
          onCancel={() => setGuardAction(null)}
        />
      ) : null}

      {pendingSessionDeletionDialog ? (
        <Dialog
          title={pendingSessionDeletionDialog.title}
          body={pendingSessionDeletionDialog.body}
          confirmLabel={pendingSessionDeletionDialog.confirmLabel}
          cancelLabel="Cancel"
          onConfirm={() => void confirmPendingSessionDeletion()}
          onCancel={() => setPendingSessionDeletion(null)}
        />
      ) : null}

      {pendingLiveExitStage ? (
        <div className="live-exit-help-backdrop" role="presentation">
          <div className="live-exit-help-dialog" role="dialog" aria-modal="true" aria-labelledby="live-exit-help-title">
            <h3 id="live-exit-help-title">You can return to this live session</h3>
            <p>
              This session stays active while you move around the teacher workspace. Open Sessions and choose the current live session whenever you want to return.
            </p>
            <label className="live-exit-help-check">
              <input
                type="checkbox"
                checked={shouldHideLiveExitHint}
                onChange={(event) => setShouldHideLiveExitHint(event.target.checked)}
              />
              <span>Don't show this again</span>
            </label>
            <div className="dialog-actions live-exit-help-actions">
              <Button variant="secondary" onClick={() => void confirmLiveExitHint()}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppFrame>
  );
}
