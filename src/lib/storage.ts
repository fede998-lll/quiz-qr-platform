import type { HostWorkspaceState, ParticipantIdentity, TemplateDraft } from "../types/domain";
import { getAppEnv } from "./env";

const KEYS = {
  participantTokens: "quiz-qr/participant-tokens",
  participantProfiles: "quiz-qr/participant-profiles",
  hostWorkspace: "quiz-qr/host-workspace",
  participantBaseUrl: "quiz-qr/participant-base-url",
  liveExitHintDismissed: "quiz-qr/live-exit-hint-dismissed",
  quizDrafts: "quiz-qr/quiz-drafts",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const appStorage = {
  getParticipantToken(sessionCode: string): string {
    const map = readJson<Record<string, string>>(KEYS.participantTokens, {});
    return map[sessionCode] ?? "";
  },
  setParticipantToken(sessionCode: string, token: string): void {
    const map = readJson<Record<string, string>>(KEYS.participantTokens, {});
    map[sessionCode] = token;
    writeJson(KEYS.participantTokens, map);
  },
  getParticipantProfile(token: string): ParticipantIdentity | null {
    const map = readJson<Record<string, ParticipantIdentity>>(KEYS.participantProfiles, {});
    return map[token] ?? null;
  },
  setParticipantProfile(token: string, identity: ParticipantIdentity): void {
    const map = readJson<Record<string, ParticipantIdentity>>(KEYS.participantProfiles, {});
    map[token] = identity;
    writeJson(KEYS.participantProfiles, map);
  },
  getHostWorkspace(): HostWorkspaceState | null {
    return readJson<HostWorkspaceState | null>(KEYS.hostWorkspace, null);
  },
  setHostWorkspace(workspace: HostWorkspaceState): void {
    writeJson(KEYS.hostWorkspace, workspace);
  },
  clearHostWorkspace(): void {
    window.localStorage.removeItem(KEYS.hostWorkspace);
  },
  getParticipantBaseUrl(): string {
    const configuredBaseUrl = getAppEnv().publicAppUrl.trim();
    return (
      configuredBaseUrl ||
      window.localStorage.getItem(KEYS.participantBaseUrl) ||
      `${window.location.origin}${window.location.pathname}`
    );
  },
  setParticipantBaseUrl(baseUrl: string): void {
    window.localStorage.setItem(KEYS.participantBaseUrl, baseUrl.trim());
  },
  getLiveExitHintDismissed(): boolean {
    return window.localStorage.getItem(KEYS.liveExitHintDismissed) === "true";
  },
  setLiveExitHintDismissed(value: boolean): void {
    window.localStorage.setItem(KEYS.liveExitHintDismissed, value ? "true" : "false");
  },
  getQuizDraft(draftKey: string): TemplateDraft | null {
    const map = readJson<Record<string, TemplateDraft>>(KEYS.quizDrafts, {});
    return map[draftKey] ?? null;
  },
  getQuizDraftKeys(): string[] {
    const map = readJson<Record<string, TemplateDraft>>(KEYS.quizDrafts, {});
    return Object.keys(map);
  },
  setQuizDraft(draftKey: string, draft: TemplateDraft): void {
    const map = readJson<Record<string, TemplateDraft>>(KEYS.quizDrafts, {});
    map[draftKey] = draft;
    writeJson(KEYS.quizDrafts, map);
  },
  clearQuizDraft(draftKey: string): void {
    const map = readJson<Record<string, TemplateDraft>>(KEYS.quizDrafts, {});
    delete map[draftKey];
    writeJson(KEYS.quizDrafts, map);
  },
};
