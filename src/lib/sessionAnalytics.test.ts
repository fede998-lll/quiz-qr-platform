import { describe, expect, it } from "vitest";
import { buildSessionAnalytics } from "./sessionAnalytics";

describe("buildSessionAnalytics", () => {
  it("derives counts, percentages, and completed participants", () => {
    const analytics = buildSessionAnalytics({
      session: {
        id: "session-1",
        quizTemplateId: "template-1",
        templateTitleSnapshot: "Biology quiz",
        code: "ABC123",
        status: "open",
        createdAt: "2026-04-20T10:00:00.000Z",
      },
      title: "Biology quiz",
      participantTokens: ["p1", "p2"],
      questions: [
        {
          id: "q1",
          orderIndex: 1,
          prompt: "Question 1",
          options: [
            { id: "o1", orderIndex: 1, label: "A", isCorrect: true },
            { id: "o2", orderIndex: 2, label: "B", isCorrect: false },
          ],
        },
        {
          id: "q2",
          orderIndex: 2,
          prompt: "Question 2",
          options: [
            { id: "o3", orderIndex: 1, label: "C", isCorrect: true },
            { id: "o4", orderIndex: 2, label: "D", isCorrect: false },
          ],
        },
      ],
      answers: [
        {
          id: 1,
          sessionId: "session-1",
          participantToken: "p1",
          questionId: "q1",
          optionId: "o1",
          submittedAt: "2026-04-20T10:00:00.000Z",
        },
        {
          id: 2,
          sessionId: "session-1",
          participantToken: "p1",
          questionId: "q2",
          optionId: "o3",
          submittedAt: "2026-04-20T10:00:05.000Z",
        },
        {
          id: 3,
          sessionId: "session-1",
          participantToken: "p2",
          questionId: "q1",
          optionId: "o2",
          submittedAt: "2026-04-20T10:00:06.000Z",
        },
      ],
    });

    expect(analytics.participantCount).toBe(2);
    expect(analytics.completedCount).toBe(1);
    expect(analytics.questions[0].options[0].count).toBe(1);
    expect(analytics.questions[0].options[0].percentage).toBe(50);
    expect(analytics.questions[1].options[0].percentage).toBe(100);
  });
});

