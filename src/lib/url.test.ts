import { describe, expect, it } from "vitest";
import { buildSearch, buildStudentLink, parseUrlState } from "./url";

describe("url helpers", () => {
  it("parses host and student query semantics", () => {
    expect(parseUrlState("?mode=host")).toEqual({
      mode: "host",
      sessionCode: "",
      participantToken: "",
    });
    expect(parseUrlState("?mode=student&session=ab12cd&pt=test-token")).toEqual({
      mode: "student",
      sessionCode: "AB12CD",
      participantToken: "test-token",
    });
  });

  it("builds compatible search params", () => {
    expect(
      buildSearch({
        mode: "student",
        sessionCode: "ab12cd",
        participantToken: "tok-1",
      }),
    ).toBe("?mode=student&session=AB12CD&pt=tok-1");
  });

  it("builds the student public link from a base url", () => {
    expect(buildStudentLink("https://quiz.example.com/play", "ab12cd")).toBe(
      "https://quiz.example.com/play?mode=student&session=AB12CD",
    );
    expect(buildStudentLink("https://quiz.example.com/play", "ab12cd", "persisted")).toBe(
      "https://quiz.example.com/play?mode=student&session=AB12CD&pt=persisted",
    );
  });
});

