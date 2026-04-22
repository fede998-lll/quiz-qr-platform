import type { AppMode } from "../types/domain";

export interface UrlState {
  mode: AppMode;
  sessionCode: string;
  participantToken: string;
}

function sanitizeMode(rawMode: string | null): AppMode {
  if (rawMode === "host" || rawMode === "student") {
    return rawMode;
  }
  return "default";
}

function sanitizeSessionCode(rawCode: string | null): string {
  return (rawCode ?? "").trim().toUpperCase();
}

function sanitizeParticipantToken(rawToken: string | null): string {
  return (rawToken ?? "").trim();
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  return {
    mode: sanitizeMode(params.get("mode")),
    sessionCode: sanitizeSessionCode(params.get("session")),
    participantToken: sanitizeParticipantToken(params.get("pt")),
  };
}

export function buildSearch(state: Partial<UrlState>): string {
  const params = new URLSearchParams();
  if (state.mode && state.mode !== "default") {
    params.set("mode", state.mode);
  }
  if (state.sessionCode) {
    params.set("session", sanitizeSessionCode(state.sessionCode));
  }
  if (state.participantToken) {
    params.set("pt", sanitizeParticipantToken(state.participantToken));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function replaceUrlState(nextState: Partial<UrlState>): void {
  const nextSearch = buildSearch(nextState);
  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}`);
}

export function buildStudentLink(baseUrl: string, sessionCode: string, participantToken?: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("mode", "student");
  url.searchParams.set("session", sanitizeSessionCode(sessionCode));
  if (participantToken) {
    url.searchParams.set("pt", sanitizeParticipantToken(participantToken));
  }
  return url.toString();
}

