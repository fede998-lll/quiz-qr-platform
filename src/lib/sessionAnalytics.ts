import type {
  Answer,
  Question,
  SessionAnalytics,
  SessionAnalyticsQuestion,
  SessionRecord,
} from "../types/domain";

export function buildSessionAnalytics(input: {
  session: SessionRecord;
  title: string;
  questions: Question[];
  answers: Answer[];
  participantTokens: string[];
}): SessionAnalytics {
  const answersByQuestion = new Map<string, Answer[]>();
  for (const answer of input.answers) {
    const bucket = answersByQuestion.get(answer.questionId) ?? [];
    bucket.push(answer);
    answersByQuestion.set(answer.questionId, bucket);
  }

  const participantQuestionCounts = new Map<string, number>();
  for (const answer of input.answers) {
    participantQuestionCounts.set(
      answer.participantToken,
      (participantQuestionCounts.get(answer.participantToken) ?? 0) + 1,
    );
  }

  const participantCount = input.participantTokens.length;
  const completedCount = Array.from(participantQuestionCounts.values()).filter(
    (count) => count >= input.questions.length && input.questions.length > 0,
  ).length;

  const questions: SessionAnalyticsQuestion[] = input.questions
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((question) => {
      const questionAnswers = answersByQuestion.get(question.id) ?? [];
      const total = questionAnswers.length;
      return {
        id: question.id,
        orderIndex: question.orderIndex,
        prompt: question.prompt,
        options: question.options
          .slice()
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((option) => {
            const count = questionAnswers.filter((answer) => answer.optionId === option.id).length;
            return {
              ...option,
              count,
              percentage: total === 0 ? 0 : Math.round((count / total) * 100),
            };
          }),
      };
    });

  return {
    session: input.session,
    title: input.title,
    participantCount,
    completedCount,
    questions,
  };
}

