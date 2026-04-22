import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { createTestGateway } from "../lib/testing/testGateway";
import type { TestScenario } from "../lib/testing/testGateway";
import type { Answer, Participant, QuizTemplate, SessionRecord } from "../types/domain";

function createTemplate(): QuizTemplate {
  return {
      id: "template-1",
      title: "Biology quiz",
      createdAt: "2026-04-20T10:00:00.000Z",
    questions: [
      {
        id: "q1",
        orderIndex: 1,
        prompt: "What is the basic unit of life?",
        options: [
          { id: "o1", orderIndex: 1, label: "Cell", isCorrect: true },
          { id: "o2", orderIndex: 2, label: "Atom", isCorrect: false },
        ],
      },
      {
        id: "q2",
        orderIndex: 2,
        prompt: "Which molecule stores genetic information?",
        options: [
          { id: "o3", orderIndex: 1, label: "DNA", isCorrect: true },
          { id: "o4", orderIndex: 2, label: "ATP", isCorrect: false },
        ],
      },
    ],
  };
}

function createOpenSession(): SessionRecord {
  return {
    id: "session-1",
    quizTemplateId: "template-1",
    templateTitleSnapshot: "Biology quiz",
    code: "ABC123",
    status: "open",
    createdAt: "2026-04-20T10:00:00.000Z",
  };
}

function renderApp(search: string, scenario: Partial<TestScenario> = {}) {
  window.history.replaceState(null, "", search);
  return render(
    <App
      gateway={createTestGateway({
        authUser: null,
        isTeacher: false,
        templates: [],
        sessions: [],
        participants: [],
        answers: [],
        ...scenario,
      })}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("App", () => {
  it("shows the host login screen for unauthenticated users", async () => {
    renderApp("?mode=host");
    expect(await screen.findByText("Login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
  });

  it("shows access denied for authenticated users without workspace access", async () => {
    renderApp("?mode=host", {
      authUser: { id: "user-1", email: "student@example.com" },
      isTeacher: false,
    });
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.getByText("Access not available")).toBeInTheDocument();
    expect(screen.getByText(/not currently allowed to open this workspace/i)).toBeInTheDocument();
  });

  it("allows settings navigation while a session is still open", async () => {
    window.localStorage.setItem(
      "quiz-qr/host-workspace",
      JSON.stringify({
        stage: "live",
        sessionId: "session-1",
        selectedTemplateId: "template-1",
        resultSource: "live",
        resultQuestionIndex: 0,
      }),
    );

    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [createOpenSession()],
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("You can return to this live session")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("blocks logout while a session is still open and closes it before signing out", async () => {
    window.localStorage.setItem(
      "quiz-qr/host-workspace",
      JSON.stringify({
        stage: "live",
        sessionId: "session-1",
        selectedTemplateId: "template-1",
        resultSource: "live",
        resultQuestionIndex: 0,
      }),
    );

    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [createOpenSession()],
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByText("Close live session before logout")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close session and logout" }));
    expect(await screen.findByText("Login")).toBeInTheDocument();
  });

  it("restores a local participant token into the student url when pt is missing", async () => {
    window.localStorage.setItem("quiz-qr/participant-tokens", JSON.stringify({ ABC123: "persisted-token" }));

    renderApp("?mode=student&session=ABC123", {
      templates: [createTemplate()],
      sessions: [createOpenSession()],
    });

    expect(await screen.findByRole("button", { name: "Start quiz" })).toBeInTheDocument();
    expect(window.location.search).toContain("pt=persisted-token");
  });

  it("restores completion directly when all answers already exist for the participant token", async () => {
    window.localStorage.setItem("quiz-qr/participant-tokens", JSON.stringify({ ABC123: "persisted-token" }));

    renderApp("?mode=student&session=ABC123", {
      templates: [createTemplate()],
      sessions: [createOpenSession()],
      answers: [
        {
          id: 1,
          sessionId: "session-1",
          participantToken: "persisted-token",
          questionId: "q1",
          optionId: "o1",
          submittedAt: "2026-04-20T10:00:00.000Z",
        },
        {
          id: 2,
          sessionId: "session-1",
          participantToken: "persisted-token",
          questionId: "q2",
          optionId: "o3",
          submittedAt: "2026-04-20T10:00:05.000Z",
        },
      ],
    });

    expect(await screen.findByText("Thanks for participating")).toBeInTheDocument();
    expect(window.location.search).toContain("pt=persisted-token");
  });

  it("saves the student answer before advancing to the next question", async () => {
    renderApp("?mode=student&session=ABC123&pt=student-1", {
      templates: [createTemplate()],
      sessions: [createOpenSession()],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Start quiz" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cell" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(await screen.findByText("Which molecule stores genetic information?")).toBeInTheDocument();
  });

  it("can start a new live session from the host setup screen", async () => {
    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
    });

    expect(await screen.findByRole("heading", { name: "Start live session" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start live session" }));
    expect(await screen.findByText("Live")).toBeInTheDocument();
  });

  it("opens live results only after the first answer is available", async () => {
    window.localStorage.setItem(
      "quiz-qr/host-workspace",
      JSON.stringify({
        stage: "live",
        sessionId: "session-1",
        selectedTemplateId: "template-1",
        resultSource: "live",
        resultQuestionIndex: 0,
      }),
    );
    const participant: Participant = {
      id: 1,
      sessionId: "session-1",
      participantToken: "student-1",
      nickname: "Student 1",
      avatar: null,
      joinedAt: "2026-04-20T10:01:00.000Z",
    };
    const answer: Answer = {
      id: 1,
      sessionId: "session-1",
      participantToken: "student-1",
      questionId: "q1",
      optionId: "o1",
      submittedAt: "2026-04-20T10:02:00.000Z",
    };

    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [createOpenSession()],
      participants: [participant],
      answers: [answer],
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(await screen.findByText(/Live results/)).toBeInTheDocument();
  });

  it("persists test sessions so student links opened later can load them", async () => {
    const gateway = createTestGateway({
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [],
      participants: [],
      answers: [],
    }, {
      onChange: (scenario) => window.localStorage.setItem("quiz-qr/test-scenario", JSON.stringify(scenario)),
    });

    const session = await gateway.sessions.start({
      templateId: "template-1",
      templateTitleSnapshot: "Biology quiz",
    });

    const persistedScenario = JSON.parse(window.localStorage.getItem("quiz-qr/test-scenario") ?? "{}") as TestScenario;

    window.history.replaceState(null, "", `?mode=student&session=${session.code}`);
    render(<App gateway={createTestGateway(persistedScenario)} />);

    expect(await screen.findByRole("button", { name: "Start quiz" })).toBeInTheDocument();
  });

  it("shows simplified settings without app identity controls", async () => {
    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Quiz")).toBeInTheDocument();
    expect(screen.queryByText("Quiz settings")).not.toBeInTheDocument();
    expect(screen.queryByText("App identity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("App title")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New quiz" }));
    expect(await screen.findByLabelText("Quiz title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("saves quiz drafts locally without saving to the database", async () => {
    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "New quiz" }));
    await userEvent.type(await screen.findByLabelText("Quiz title"), "Local draft");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Draft saved locally on this device.")).toBeInTheDocument();
    expect(window.localStorage.getItem("quiz-qr/quiz-drafts")).toContain("Local draft");
    expect(await screen.findByText("Local draft")).toBeInTheDocument();
  });

  it("marks quizzes with local drafts in the settings list", async () => {
    window.localStorage.setItem(
      "quiz-qr/quiz-drafts",
      JSON.stringify({
        "template-1": {
          id: "template-1",
          title: "Drafted biology quiz",
          questions: [
            {
              id: "q1",
              localId: "q1",
              prompt: "Draft question",
              options: [
                { id: "o1", localId: "o1", label: "Cell", isCorrect: true },
                { id: "o2", localId: "o2", label: "Atom", isCorrect: false },
              ],
            },
          ],
        },
      }),
    );
    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Draft")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Biology quiz/ }));
    expect(await screen.findByRole("button", { name: "Discard changes" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
  });

  it("can delete a local quiz draft", async () => {
    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "New quiz" }));
    await userEvent.type(await screen.findByLabelText("Quiz title"), "Temporary draft");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Temporary draft")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("This only deletes the local draft saved on this device. The saved quiz in the database will not be deleted.")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => {
      expect(screen.queryByText("Temporary draft")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem("quiz-qr/quiz-drafts")).not.toContain("Temporary draft");
  });

  it("lists and clears closed sessions from the sessions area", async () => {
    const closedSession: SessionRecord = { ...createOpenSession(), id: "session-2", status: "closed", code: "ZZ999" };
    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [closedSession],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Sessions" }));
    expect(await screen.findByText(/ZZ999/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete closed sessions" }));
    expect(await screen.findByText("This deletes all closed session archives and their results. This action cannot be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete sessions" }));
    await waitFor(() => {
      expect(screen.getByText("No sessions yet")).toBeInTheDocument();
    });
  });

  it("shows an open live session in the sessions area", async () => {
    window.localStorage.setItem(
      "quiz-qr/host-workspace",
      JSON.stringify({
        stage: "live",
        sessionId: "session-1",
        selectedTemplateId: "template-1",
        resultSource: "live",
        resultQuestionIndex: 0,
      }),
    );

    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [createOpenSession()],
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(await screen.findByText("You can return to this live session")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter live session" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enter live session" }));
    expect(await screen.findByText("Live")).toBeInTheDocument();
  });

  it("can dismiss the live exit hint permanently", async () => {
    window.localStorage.setItem(
      "quiz-qr/host-workspace",
      JSON.stringify({
        stage: "live",
        sessionId: "session-1",
        selectedTemplateId: "template-1",
        resultSource: "live",
        resultQuestionIndex: 0,
      }),
    );

    renderApp("?mode=host", {
      authUser: { id: "teacher-1", email: "teacher@example.com" },
      isTeacher: true,
      templates: [createTemplate()],
      sessions: [createOpenSession()],
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    await userEvent.click(await screen.findByLabelText("Don't show this again"));
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sessions" }));
    await userEvent.click(screen.getByRole("button", { name: "Enter live session" }));
    expect(await screen.findByText("Live")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByText("You can return to this live session")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});


