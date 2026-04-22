import { makeClientId } from "../ids";
import { buildSessionAnalytics } from "../sessionAnalytics";
import type { AppGateway, AuthSnapshot } from "../../types/gateway";
import type {
  Answer,
  ClosedSessionSummary,
  Participant,
  Question,
  QuizTemplate,
  QuizTemplateSummary,
  SessionRecord,
  StudentProgress,
  StudentSessionBundle,
  TemplateDraft,
} from "../../types/domain";

export interface TestScenario {
  authUser: AuthSnapshot["user"];
  isTeacher: boolean;
  templates: QuizTemplate[];
  sessions: SessionRecord[];
  participants: Participant[];
  answers: Answer[];
}

export interface TestGatewayOptions {
  onChange?: (scenario: TestScenario) => void;
}

function now(): string {
  return new Date("2026-04-20T12:00:00.000Z").toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDefaultScenario(): TestScenario {
  return {
    authUser: null,
    isTeacher: false,
    templates: [],
    sessions: [],
    participants: [],
    answers: [],
  };
}

export function createTestGateway(seed?: Partial<TestScenario>, options: TestGatewayOptions = {}): AppGateway {
  const store: TestScenario = {
    ...createDefaultScenario(),
    ...seed,
    templates: clone(seed?.templates ?? []),
    sessions: clone(seed?.sessions ?? []),
    participants: clone(seed?.participants ?? []),
    answers: clone(seed?.answers ?? []),
  };

  let authListener: ((snapshot: AuthSnapshot) => void) | null = null;

  function persistStore(): void {
    options.onChange?.(clone(store));
  }

  function findTemplate(templateId: string): QuizTemplate | null {
    return store.templates.find((template) => template.id === templateId) ?? null;
  }

  function findSession(sessionId: string): SessionRecord | null {
    return store.sessions.find((session) => session.id === sessionId) ?? null;
  }

  function getQuestionsForSession(session: SessionRecord): Question[] {
    return session.quizTemplateId ? findTemplate(session.quizTemplateId)?.questions ?? [] : [];
  }

  return {
    auth: {
      async getSnapshot() {
        return { user: clone(store.authUser) };
      },
      onChange(listener) {
        authListener = listener;
        return () => {
          authListener = null;
        };
      },
      async signInWithGoogle() {
        store.authUser = {
          id: "teacher-1",
          email: "teacher@example.com",
        };
        persistStore();
        authListener?.({ user: clone(store.authUser) });
      },
      async signOut() {
        store.authUser = null;
        persistStore();
        authListener?.({ user: null });
      },
      async isTeacher() {
        return store.isTeacher;
      },
    },
    templates: {
      async list() {
        return clone(
          store.templates.map<QuizTemplateSummary>(({ questions, ...summary }) => summary),
        );
      },
      async getById(templateId) {
        return clone(findTemplate(templateId));
      },
      async save(draft: TemplateDraft) {
        const nextTemplate: QuizTemplate = {
          id: draft.id ?? makeClientId("tpl"),
          title: draft.title.trim(),
          createdAt: findTemplate(draft.id ?? "")?.createdAt ?? now(),
          questions: draft.questions.map((question, questionIndex) => ({
            id: question.id ?? makeClientId("q"),
            orderIndex: questionIndex + 1,
            prompt: question.prompt.trim(),
            options: question.options.map((option, optionIndex) => ({
              id: option.id ?? makeClientId("opt"),
              orderIndex: optionIndex + 1,
              label: option.label.trim(),
              isCorrect: option.isCorrect,
            })),
          })),
        };
        store.templates = store.templates.filter((template) => template.id !== nextTemplate.id);
        store.templates.unshift(nextTemplate);
        persistStore();
        return clone(nextTemplate);
      },
      async deleteById(templateId) {
        store.templates = store.templates.filter((template) => template.id !== templateId);
        store.sessions = store.sessions.map((session) =>
          session.quizTemplateId === templateId ? { ...session, quizTemplateId: null } : session,
        );
        persistStore();
      },
    },
    sessions: {
      async start(input) {
        const session: SessionRecord = {
          id: makeClientId("sess"),
          quizTemplateId: input.templateId,
          templateTitleSnapshot: input.templateTitleSnapshot,
          code: `S${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          status: "open",
          createdAt: now(),
        };
        store.sessions.unshift(session);
        persistStore();
        return clone(session);
      },
      async getById(sessionId) {
        return clone(findSession(sessionId));
      },
      async getByCode(code) {
        return clone(store.sessions.find((session) => session.code === code) ?? null);
      },
      async getAnalytics(sessionId) {
        const session = findSession(sessionId);
        if (!session) {
          throw new Error("Session not found.");
        }
        const questions = getQuestionsForSession(session);
        const answers = store.answers.filter((answer) => answer.sessionId === sessionId);
        const participants = store.participants
          .filter((participant) => participant.sessionId === sessionId)
          .map((participant) => participant.participantToken);
        return buildSessionAnalytics({
          session,
          title: session.templateTitleSnapshot ?? "Live quiz",
          questions,
          answers,
          participantTokens: participants,
        });
      },
      async listClosed(): Promise<ClosedSessionSummary[]> {
        return store.sessions
          .filter((session) => session.status === "closed")
          .map((session) => ({
            ...clone(session),
            participantCount: store.participants.filter((p) => p.sessionId === session.id).length,
          }));
      },
      async close(sessionId) {
        const session = findSession(sessionId);
        if (!session) {
          throw new Error("Session not found.");
        }
        session.status = "closed";
        persistStore();
        return clone(session);
      },
      async deleteClosed(sessionId) {
        store.sessions = store.sessions.filter((session) => session.id !== sessionId);
        store.participants = store.participants.filter((participant) => participant.sessionId !== sessionId);
        store.answers = store.answers.filter((answer) => answer.sessionId !== sessionId);
        persistStore();
      },
      async deleteAllClosed() {
        const closedIds = new Set(store.sessions.filter((session) => session.status === "closed").map((item) => item.id));
        store.sessions = store.sessions.filter((session) => !closedIds.has(session.id));
        store.participants = store.participants.filter((participant) => !closedIds.has(participant.sessionId));
        store.answers = store.answers.filter((answer) => !closedIds.has(answer.sessionId));
        persistStore();
      },
      subscribeToSession() {
        return () => undefined;
      },
    },
    student: {
      async getBundleByCode(code) {
        const session = store.sessions.find((item) => item.code === code && item.status === "open");
        if (!session) {
          return null;
        }
        return clone<StudentSessionBundle>({
          session,
          title: session.templateTitleSnapshot ?? "Live quiz",
          questions: getQuestionsForSession(session),
        });
      },
      async registerParticipant(input) {
        const existing = store.participants.find(
          (participant) =>
            participant.sessionId === input.sessionId && participant.participantToken === input.participantToken,
        );
        if (existing) {
          existing.nickname = input.nickname || null;
          existing.avatar = input.avatar || null;
          persistStore();
          return clone(existing);
        }
        const participant: Participant = {
          id: store.participants.length + 1,
          sessionId: input.sessionId,
          participantToken: input.participantToken,
          nickname: input.nickname || null,
          avatar: input.avatar || null,
          joinedAt: now(),
        };
        store.participants.push(participant);
        persistStore();
        return clone(participant);
      },
      async getProgress(sessionId, participantToken, questionCount) {
        const answers = store.answers.filter(
          (answer) => answer.sessionId === sessionId && answer.participantToken === participantToken,
        );
        return clone<StudentProgress>({
          answers,
          completed: questionCount > 0 && answers.length >= questionCount,
          nextQuestionIndex: Math.min(answers.length, Math.max(questionCount - 1, 0)),
        });
      },
      async submitAnswer(input) {
        const existing = store.answers.find(
          (answer) =>
            answer.sessionId === input.sessionId &&
            answer.participantToken === input.participantToken &&
            answer.questionId === input.questionId,
        );
        if (existing) {
          existing.optionId = input.optionId;
          existing.submittedAt = now();
          persistStore();
          return clone(existing);
        }
        const answer: Answer = {
          id: store.answers.length + 1,
          sessionId: input.sessionId,
          participantToken: input.participantToken,
          questionId: input.questionId,
          optionId: input.optionId,
          submittedAt: now(),
        };
        store.answers.push(answer);
        persistStore();
        return clone(answer);
      },
    },
  };
}


