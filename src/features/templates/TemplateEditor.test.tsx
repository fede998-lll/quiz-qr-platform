import { describe, expect, it } from "vitest";
import { validateTemplateDraft } from "./TemplateEditor";

describe("validateTemplateDraft", () => {
  it("rejects missing title, empty questions, and questions without enough valid options", () => {
    const validation = validateTemplateDraft({
      title: "",
      questions: [
        {
          localId: "q1",
          prompt: "",
          options: [
            { localId: "o1", label: "", isCorrect: true },
            { localId: "o2", label: "", isCorrect: false },
          ],
        },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.message)).toContain("Quiz title is required.");
    expect(validation.issues.map((issue) => issue.message)).toContain("Question text is required.");
    expect(validation.issues.map((issue) => issue.message)).toContain("Each question needs at least two filled options.");
    expect(validation.issues.map((issue) => issue.message)).toContain("Each question needs at least one correct option.");
  });
});
