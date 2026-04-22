import { useEffect, useState } from "react";
import type { SessionAnalytics } from "../../types/domain";
import { BarChart, Button, KpiCard, Panel, StatusPill } from "../../components/ui";

interface ResultsViewProps {
  analytics: SessionAnalytics;
  questionIndex: number;
  onQuestionIndexChange: (next: number) => void;
  onCloseSession?: () => void;
}

export function ResultsView(props: ResultsViewProps) {
  const [isCorrectAnswerVisible, setIsCorrectAnswerVisible] = useState(false);
  const [revealedQuestionIndexes, setRevealedQuestionIndexes] = useState<Set<number>>(() => new Set());
  const currentQuestion = props.analytics.questions[props.questionIndex];

  useEffect(() => {
    setIsCorrectAnswerVisible(revealedQuestionIndexes.has(props.questionIndex));
  }, [props.questionIndex, revealedQuestionIndexes]);
  const questionSummaries = props.analytics.questions.map((question, index) => {
    const responseCount = question.options.reduce((total, option) => total + option.count, 0);
    const correctCount = question.options
      .filter((option) => option.isCorrect)
      .reduce((total, option) => total + option.count, 0);
    const accuracy = responseCount === 0 ? 0 : Math.round((correctCount / responseCount) * 100);
    return {
      index,
      prompt: question.prompt,
      responseCount,
      correctCount,
      accuracy,
    };
  });
  const answeredSummaries = questionSummaries.filter((question) => question.responseCount > 0);
  const totalResponses = questionSummaries.reduce((total, question) => total + question.responseCount, 0);
  const totalCorrect = questionSummaries.reduce((total, question) => total + question.correctCount, 0);
  const averageScore = totalResponses === 0 ? 0 : Math.round((totalCorrect / totalResponses) * 100);
  const completionRate =
    props.analytics.participantCount === 0
      ? 0
      : Math.round((props.analytics.completedCount / props.analytics.participantCount) * 100);
  const bestQuestion = answeredSummaries.reduce<typeof answeredSummaries[number] | null>(
    (best, question) => (!best || question.accuracy > best.accuracy ? question : best),
    null,
  );
  const mostMissedQuestion = answeredSummaries.reduce<typeof answeredSummaries[number] | null>(
    (worst, question) => (!worst || question.accuracy < worst.accuracy ? question : worst),
    null,
  );
  const reviewQuestions = answeredSummaries.filter((question) => question.accuracy < 50).map((question) => `Q${question.index + 1}`);

  return (
    <div className="grid-layout two-columns">
      <Panel title="Session summary" description={props.analytics.title}>
        <div className="stack results-summary">
          <div className="results-session-meta">
            <StatusPill tone={props.analytics.session.status === "open" ? "open" : "closed"}>
              {props.analytics.session.status === "open" ? "Session open" : "Session closed"}
            </StatusPill>
            <span className="session-code">Code {props.analytics.session.code}</span>
          </div>

          <div className="kpi-grid results-kpi-grid">
            <KpiCard label="Participants" value={props.analytics.participantCount} />
            <KpiCard label="Completed" value={props.analytics.completedCount} />
            <KpiCard label="Completion" value={`${completionRate}%`} />
            <KpiCard label="Avg score" value={totalResponses === 0 ? "-" : `${averageScore}%`} />
          </div>

          <div className="results-performance">
            <div className="results-section-heading">
              <span>Class performance</span>
              <strong>{totalResponses === 0 ? "No answers yet" : `${averageScore}%`}</strong>
            </div>
            <div className="summary-progress-track" aria-label={`Average score ${averageScore}%`}>
              <div className="summary-progress-fill" style={{ width: `${averageScore}%` }} />
            </div>
            <p>
              {totalResponses === 0
                ? "Results will become meaningful once students start answering."
                : `${totalCorrect} of ${totalResponses} submitted answers are correct.`}
            </p>
          </div>

          <div className="results-insights">
            <div className="results-section-heading">
              <span>Quick insights</span>
            </div>
            <div className="insight-list">
              <div className="insight-row">
                <span>Best result</span>
                <strong>{bestQuestion ? `Q${bestQuestion.index + 1} - ${bestQuestion.accuracy}%` : "Waiting for answers"}</strong>
              </div>
              <div className="insight-row">
                <span>Most missed</span>
                <strong>{mostMissedQuestion ? `Q${mostMissedQuestion.index + 1} - ${mostMissedQuestion.accuracy}%` : "Waiting for answers"}</strong>
              </div>
              <div className="insight-row">
                <span>Review suggested</span>
                <strong>{reviewQuestions.length > 0 ? reviewQuestions.join(", ") : "None for now"}</strong>
              </div>
            </div>
          </div>

          <div className="button-row results-actions">
            {props.onCloseSession ? (
              <Button variant="danger" onClick={props.onCloseSession}>
                Close session
              </Button>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        title={currentQuestion ? `Question ${props.questionIndex + 1} of ${props.analytics.questions.length}` : "No questions available"}
        description={currentQuestion?.prompt ?? "The template questions are no longer available for this session."}
        className="results-question-panel"
        actions={
          currentQuestion ? (
            <label className="correct-answer-visibility-toggle">
              <input
                type="checkbox"
                checked={isCorrectAnswerVisible}
                onChange={(event) => {
                  const isVisible = event.target.checked;
                  setIsCorrectAnswerVisible(isVisible);
                  setRevealedQuestionIndexes((current) => {
                    const next = new Set(current);
                    if (isVisible) {
                      next.add(props.questionIndex);
                    } else {
                      next.delete(props.questionIndex);
                    }
                    return next;
                  });
                }}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-thumb" />
              </span>
              <span>Show answer</span>
            </label>
          ) : null
        }
      >
        {currentQuestion ? (
          <div className="stack results-question-content">
            <div className="results-chart-area">
              <BarChart
                items={currentQuestion.options.map((option) => ({
                  label: option.label,
                  value: option.count,
                  percentage: option.percentage,
                  isCorrect: option.isCorrect,
                }))}
                showCorrectHighlight={isCorrectAnswerVisible}
              />
            </div>
            <div className="button-row question-nav-actions">
              <Button
                variant="secondary"
                onClick={() => props.onQuestionIndexChange(Math.max(0, props.questionIndex - 1))}
                disabled={props.questionIndex === 0}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  props.onQuestionIndexChange(
                    Math.min(props.analytics.questions.length - 1, props.questionIndex + 1),
                  )
                }
                disabled={props.questionIndex >= props.analytics.questions.length - 1}
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <p>Question data is unavailable, but the session archive still exists.</p>
        )}
      </Panel>
    </div>
  );
}
