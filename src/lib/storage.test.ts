import { beforeEach, describe, expect, it, vi } from "vitest";
import { appStorage } from "./storage";

vi.mock("./env", () => ({
  getAppEnv: () => ({
    supabaseUrl: "",
    supabaseAnonKey: "",
    publicAppUrl: "https://liveqrquiz.org",
  }),
}));

describe("appStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the configured public app url before a locally saved participant base url", () => {
    appStorage.setParticipantBaseUrl("http://192.168.1.108:5173");

    expect(appStorage.getParticipantBaseUrl()).toBe("https://liveqrquiz.org");
  });
});
