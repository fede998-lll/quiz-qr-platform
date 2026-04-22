import type {
  Answer,
  AuthUser,
  ClosedSessionSummary,
  Participant,
  QuizTemplate,
  QuizTemplateSummary,
  SessionAnalytics,
  SessionRecord,
  StudentProgress,
  StudentSessionBundle,
  TemplateDraft,
} from "./domain";

export interface AuthSnapshot {
  user: AuthUser | null;
}

export interface AppGateway {
  auth: {
    getSnapshot: () => Promise<AuthSnapshot>;
    onChange: (listener: (snapshot: AuthSnapshot) => void) => () => void;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
    isTeacher: () => Promise<boolean>;
  };
  templates: {
    list: () => Promise<QuizTemplateSummary[]>;
    getById: (templateId: string) => Promise<QuizTemplate | null>;
    save: (draft: TemplateDraft) => Promise<QuizTemplate>;
    deleteById: (templateId: string) => Promise<void>;
  };
  sessions: {
    start: (input: { templateId: string; templateTitleSnapshot: string }) => Promise<SessionRecord>;
    getById: (sessionId: string) => Promise<SessionRecord | null>;
    getByCode: (code: string) => Promise<SessionRecord | null>;
    getAnalytics: (sessionId: string) => Promise<SessionAnalytics>;
    listClosed: () => Promise<ClosedSessionSummary[]>;
    close: (sessionId: string) => Promise<SessionRecord>;
    deleteClosed: (sessionId: string) => Promise<void>;
    deleteAllClosed: () => Promise<void>;
    subscribeToSession: (sessionId: string, onUpdate: () => void) => () => void;
  };
  student: {
    getBundleByCode: (code: string) => Promise<StudentSessionBundle | null>;
    registerParticipant: (input: {
      sessionId: string;
      participantToken: string;
      nickname: string;
      avatar: string;
    }) => Promise<Participant>;
    getProgress: (sessionId: string, participantToken: string, questionCount: number) => Promise<StudentProgress>;
    submitAnswer: (input: {
      sessionId: string;
      participantToken: string;
      questionId: string;
      optionId: string;
    }) => Promise<Answer>;
  };
}

