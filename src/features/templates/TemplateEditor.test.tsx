import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TemplateEditor, validateTemplateDraft } from "./TemplateEditor";

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

describe("TemplateEditor", () => {
  it("keeps options in place when marking a newly added option as correct", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<TemplateEditor template={null} onSave={onSave} />);

    await user.type(screen.getByLabelText("Option 1"), "One");
    await user.type(screen.getByLabelText("Option 2"), "Two");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getByLabelText("Option 3"), "Three");

    const optionRows = screen.getAllByLabelText(/Option \d+/).map((input) => input.closest(".option-row"));
    expect(optionRows).toHaveLength(3);

    const thirdOptionRow = optionRows[2];
    expect(thirdOptionRow).not.toBeNull();
    await user.click(within(thirdOptionRow as HTMLElement).getByLabelText("Correct answer"));

    expect(screen.getByLabelText("Option 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 3")).toHaveValue("Three");
    expect(thirdOptionRow?.querySelector("input[type='checkbox']")).toBeChecked();
    expect(screen.getByRole("heading", { name: "New quiz" })).toBeInTheDocument();
  });
});
