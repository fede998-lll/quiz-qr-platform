import { useEffect, useState } from "react";
import type { AppGateway } from "../../types/gateway";
import type { ParticipantIdentity, StudentSessionBundle } from "../../types/domain";
import { AVATAR_CHOICES } from "../../lib/avatars";
import { APP_TITLE } from "../../lib/branding";
import { makeParticipantToken } from "../../lib/ids";
import { appStorage } from "../../lib/storage";
import { parseUrlState, replaceUrlState } from "../../lib/url";
import { AppFrame, AvatarPicker, Button, EmptyState, LoadingState, Panel, ProgressRail, StatusPill, TextField } from "../../components/ui";

type StudentScreen = "join" | "not-found" | "closed" | "intro" | "question" | "completion";

interface StudentAppProps {
  gateway: AppGateway;
}

export function StudentApp(props: StudentAppProps) {
  const urlState = parseUrlState(window.location.search);
  const [screen, setScreen] = useState<StudentScreen>("join");
  const [loading, setLoading] = useState(Boolean(urlState.sessionCode));
  const [sessionCodeInput, setSessionCodeInput] = useState(urlState.sessionCode);
  const [bundle, setBundle] = useState<StudentSessionBundle | null>(null);
  const [participantToken, setParticipantToken] = useState(urlState.participantToken);
  const [identity, setIdentity] = useState<ParticipantIdentity>({ nickname: "", avatar: AVATAR_CHOICES[0].id });
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = `${APP_TITLE} · Student`;
  }, []);

  useEffect(() => {
    if (!urlState.sessionCode) {
      return;
    }
    void loadSession(urlState.sessionCode, true);
  }, []);

  useEffect(() => {
    if (!bundle) {
      return;
    }
    const currentQuestion = bundle.questions[questionIndex];
    if (!currentQuestion) {
      return;
    }
    setSelectedOptionId(answersByQuestion[currentQuestion.id] ?? "");
  }, [bundle, questionIndex, answersByQuestion]);

  function resolveToken(sessionCode: string, preferUrl: boolean): string {
    const urlToken = preferUrl ? parseUrlState(window.location.search).participantToken : "";
    const localToken = appStorage.getParticipantToken(sessionCode);
    const nextToken = urlToken || localToken || makeParticipantToken();
    appStorage.setParticipantToken(sessionCode, nextToken);
    setParticipantToken(nextToken);
    return nextToken;
  }

  async function loadSession(sessionCode: string, preferUrlToken = false) {
    setLoading(true);
    setError("");
    const normalizedCode = sessionCode.trim().toUpperCase();
    setSessionCodeInput(normalizedCode);
    try {
      const session = await props.gateway.sessions.getByCode(normalizedCode);
      if (!session) {
        setBundle(null);
        setScreen("not-found");
        return;
      }
      if (session.status === "closed") {
        setBundle(null);
        setScreen("closed");
        return;
      }

      const token = resolveToken(normalizedCode, preferUrlToken);
      replaceUrlState({ mode: "student", sessionCode: normalizedCode, participantToken: token });

      const nextBundle = await props.gateway.student.getBundleByCode(normalizedCode);
      if (!nextBundle) {
        setBundle(null);
        setScreen("not-found");
        return;
      }
      setBundle(nextBundle);

      const storedProfile = appStorage.getParticipantProfile(token);
      if (storedProfile) {
        setIdentity(storedProfile);
      }

      const progress = await props.gateway.student.getProgress(nextBundle.session.id, token, nextBundle.questions.length);
      const mappedAnswers = Object.fromEntries(progress.answers.map((answer) => [answer.questionId, answer.optionId]));
      setAnswersByQuestion(mappedAnswers);
      if (progress.completed) {
        setScreen("completion");
        return;
      }
      if (progress.answers.length > 0) {
        setQuestionIndex(progress.nextQuestionIndex);
        setScreen("question");
        return;
      }
      setQuestionIndex(0);
      setScreen("intro");
    } catch (caught) {
      setScreen("join");
      setError(caught instanceof Error ? caught.message : "Unable to load the student session.");
    } finally {
      setLoading(false);
    }
  }

  async function startQuiz() {
    if (!bundle) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const token = resolveToken(bundle.session.code, true);
      await props.gateway.student.registerParticipant({
        sessionId: bundle.session.id,
        participantToken: token,
        nickname: identity.nickname,
        avatar: identity.avatar,
      });
      appStorage.setParticipantProfile(token, identity);
      const progress = await props.gateway.student.getProgress(bundle.session.id, token, bundle.questions.length);
      setAnswersByQuestion(Object.fromEntries(progress.answers.map((answer) => [answer.questionId, answer.optionId])));
      setQuestionIndex(progress.nextQuestionIndex);
      setScreen(progress.completed ? "completion" : "question");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register participant.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmAnswer() {
    if (!bundle) {
      return;
    }
    const currentQuestion = bundle.questions[questionIndex];
    if (!currentQuestion || !selectedOptionId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      await props.gateway.student.submitAnswer({
        sessionId: bundle.session.id,
        participantToken,
        questionId: currentQuestion.id,
        optionId: selectedOptionId,
      });
      const nextAnswers = { ...answersByQuestion, [currentQuestion.id]: selectedOptionId };
      setAnswersByQuestion(nextAnswers);
      if (questionIndex >= bundle.questions.length - 1) {
        setScreen("completion");
      } else {
        setQuestionIndex(questionIndex + 1);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your answer.");
    } finally {
      setLoading(false);
    }
  }

  const currentQuestion = bundle?.questions[questionIndex] ?? null;
  const title = bundle?.title ?? APP_TITLE;
  const currentAnswerId = currentQuestion ? answersByQuestion[currentQuestion.id] ?? "" : "";

  if (loading) {
    return (
      <AppFrame title={title} subtitle="Preparing the quiz experience for the participant.">
        <LoadingState label="Loading quiz session..." />
      </AppFrame>
    );
  }

  return (
    <AppFrame title={title} subtitle="Join the classroom quiz with a session code or QR link.">
      {error ? <p className="error-text">{error}</p> : null}

      {screen === "join" ? (
        <Panel title="Join a session" description="Enter the live session code shared by the teacher.">
          <div className="stack">
            <TextField label="Session code" value={sessionCodeInput} onChange={setSessionCodeInput} placeholder="AB12CD" />
            <Button onClick={() => void loadSession(sessionCodeInput)}>Join</Button>
          </div>
        </Panel>
      ) : null}

      {screen === "not-found" ? (
        <Panel title="Session not found" description="Check the code and try again.">
          <EmptyState
            title="No matching open session"
            body="The code does not map to a current quiz session."
            action={<Button onClick={() => setScreen("join")}>Back to join</Button>}
          />
        </Panel>
      ) : null}

      {screen === "closed" ? (
        <Panel title="Session closed" description="This quiz is no longer accepting answers.">
          <StatusPill tone="closed">Closed</StatusPill>
        </Panel>
      ) : null}

      {screen === "intro" && bundle ? (
        <Panel title={bundle.title} description="Choose an avatar before starting the quiz." className="student-intro-panel">
          <div className="stack">
            <AvatarPicker
              value={identity.avatar}
              options={AVATAR_CHOICES}
              onChange={(avatar) => setIdentity((current) => ({ ...current, avatar }))}
            />
            <Button onClick={() => void startQuiz()}>Start quiz</Button>
          </div>
        </Panel>
      ) : null}

      {screen === "question" && bundle && currentQuestion ? (
        <Panel title={bundle.title} description={currentQuestion.prompt}>
          <div className="stack">
            <ProgressRail current={Object.keys(answersByQuestion).length} total={bundle.questions.length} />
            <div className="option-list">
              {currentQuestion.options.map((option) => {
                const checked = selectedOptionId ? selectedOptionId === option.id : currentAnswerId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`option-card ${checked ? "active" : ""}`}
                    onClick={() => setSelectedOptionId((current) => (current === option.id ? "" : option.id))}
                  >
                    <strong>{option.label}</strong>
                  </button>
                );
              })}
            </div>
            <Button onClick={() => void confirmAnswer()} disabled={!selectedOptionId && !currentAnswerId}>
              Confirm and continue
            </Button>
          </div>
        </Panel>
      ) : null}

      {screen === "completion" && bundle ? (
        <Panel title="All done" description="Your answers are saved.">
          <EmptyState
            title="Thanks for participating"
            body="If you refresh now, the app will recognize your token and keep you on the completed state."
          />
        </Panel>
      ) : null}
    </AppFrame>
  );
}
