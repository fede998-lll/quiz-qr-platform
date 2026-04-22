export type AppMode = "default" | "host" | "student";
export type HostStage =
  | "boot"
  | "setup"
  | "settings"
  | "archives"
  | "live"
  | "results"
  | "closed";
export type ResultSource = "live" | "past" | "closed";
export type SessionStatus = "open" | "closed";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface QuizTemplateSummary {
  id: string;
  title: string;
  createdAt: string;
}

export interface QuestionOption {
  id: string;
  orderIndex: number;
  label: string;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  orderIndex: number;
  prompt: string;
  options: QuestionOption[];
}

export interface QuizTemplate extends QuizTemplateSummary {
  questions: Question[];
}

export interface SessionRecord {
  id: string;
  quizTemplateId: string | null;
  templateTitleSnapshot: string | null;
  code: string;
  status: SessionStatus;
  createdAt: string;
}

export interface ClosedSessionSummary extends SessionRecord {
  participantCount: number;
}

export interface Participant {
  id: number;
  sessionId: string;
  participantToken: string;
  nickname: string | null;
  avatar: string | null;
  joinedAt: string;
}

export interface Answer {
  id: number;
  sessionId: string;
  participantToken: string;
  questionId: string;
  optionId: string;
  submittedAt: string;
}

export interface ParticipantIdentity {
  nickname: string;
  avatar: string;
}

export interface HostWorkspaceState {
  stage: HostStage;
  sessionId: string | null;
  selectedTemplateId: string | null;
  resultSource: ResultSource;
  resultQuestionIndex: number;
}

export interface StudentEntryState {
  sessionCode: string;
  participantToken: string;
}

export interface TemplateDraftOption {
  id?: string;
  localId: string;
  label: string;
  isCorrect: boolean;
}

export interface TemplateDraftQuestion {
  id?: string;
  localId: string;
  prompt: string;
  options: TemplateDraftOption[];
}

export interface TemplateDraft {
  id?: string;
  title: string;
  questions: TemplateDraftQuestion[];
}

export interface TemplateValidationIssue {
  path: string;
  message: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  issues: TemplateValidationIssue[];
}

export interface SessionAnalyticsOption extends QuestionOption {
  count: number;
  percentage: number;
}

export interface SessionAnalyticsQuestion {
  id: string;
  orderIndex: number;
  prompt: string;
  options: SessionAnalyticsOption[];
}

export interface SessionAnalytics {
  session: SessionRecord;
  title: string;
  participantCount: number;
  completedCount: number;
  questions: SessionAnalyticsQuestion[];
}

export interface StudentSessionBundle {
  session: SessionRecord;
  title: string;
  questions: Question[];
}

export interface StudentProgress {
  answers: Answer[];
  completed: boolean;
  nextQuestionIndex: number;
}
