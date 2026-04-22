import type { Session } from "@supabase/supabase-js";
import { makeSessionCode } from "../ids";
import { buildSessionAnalytics } from "../sessionAnalytics";
import { getSupabaseClient } from "./client";
import type { AppGateway, AuthSnapshot } from "../../types/gateway";
import type {
  Answer,
  AuthUser,
  ClosedSessionSummary,
  Participant,
  Question,
  QuestionOption,
  QuizTemplate,
  QuizTemplateSummary,
  SessionRecord,
  StudentProgress,
  StudentSessionBundle,
  TemplateDraft,
} from "../../types/domain";

type Row = Record<string, unknown>;

function mapUser(session: Session | null): AuthUser | null {
  if (!session?.user) {
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email ?? null,
  };
}

function mapTemplateSummary(row: Row): QuizTemplateSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
  };
}

function mapOption(row: Row): QuestionOption {
  return {
    id: String(row.id),
    orderIndex: Number(row.order_index),
    label: String(row.label),
    isCorrect: Boolean(row.is_correct),
  };
}

function mapQuestion(row: Row, options: QuestionOption[]): Question {
  return {
    id: String(row.id),
    orderIndex: Number(row.order_index),
    prompt: String(row.prompt),
    options,
  };
}

function mapSession(row: Row): SessionRecord {
  return {
    id: String(row.id),
    quizTemplateId: row.quiz_template_id ? String(row.quiz_template_id) : null,
    templateTitleSnapshot: row.template_title_snapshot ? String(row.template_title_snapshot) : null,
    code: String(row.code),
    status: row.status === "closed" ? "closed" : "open",
    createdAt: String(row.created_at),
  };
}

function mapParticipant(row: Row): Participant {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    participantToken: String(row.participant_token),
    nickname: row.nickname ? String(row.nickname) : null,
    avatar: row.avatar ? String(row.avatar) : null,
    joinedAt: String(row.joined_at),
  };
}

function mapAnswer(row: Row): Answer {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    participantToken: String(row.participant_token),
    questionId: String(row.question_id),
    optionId: String(row.option_id),
    submittedAt: String(row.submitted_at),
  };
}

async function loadTemplateQuestions(templateId: string): Promise<Question[]> {
  const client = getSupabaseClient();
  const { data: questionRows, error: questionError } = await client
    .from("questions")
    .select("id, order_index, prompt")
    .eq("quiz_template_id", templateId)
    .order("order_index", { ascending: true });

  if (questionError) {
    throw questionError;
  }

  const questionIds = (questionRows ?? []).map((row) => String(row.id));
  const { data: optionRows, error: optionError } = await client
    .from("question_options")
    .select("id, question_id, order_index, label, is_correct")
    .in("question_id", questionIds.length > 0 ? questionIds : ["00000000-0000-0000-0000-000000000000"])
    .order("order_index", { ascending: true });

  if (optionError) {
    throw optionError;
  }

  const optionsByQuestion = new Map<string, QuestionOption[]>();
  for (const row of optionRows ?? []) {
    const questionId = String(row.question_id);
    const bucket = optionsByQuestion.get(questionId) ?? [];
    bucket.push(mapOption(row));
    optionsByQuestion.set(questionId, bucket);
  }

  return (questionRows ?? []).map((row) => mapQuestion(row, optionsByQuestion.get(String(row.id)) ?? []));
}

async function loadSessionQuestions(session: SessionRecord): Promise<Question[]> {
  if (!session.quizTemplateId) {
    return [];
  }
  return loadTemplateQuestions(session.quizTemplateId);
}

async function fetchSessionByCode(code: string): Promise<SessionRecord | null> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("sessions")
    .select("id, quiz_template_id, template_title_snapshot, code, status, created_at")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? mapSession(data) : null;
}

async function loadSessionAnswers(sessionId: string): Promise<Answer[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("answers")
    .select("id, session_id, participant_token, question_id, option_id, submitted_at")
    .eq("session_id", sessionId);
  if (error) {
    throw error;
  }
  return (data ?? []).map(mapAnswer);
}

async function loadSessionParticipants(sessionId: string): Promise<Participant[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("participants")
    .select("id, session_id, participant_token, nickname, avatar, joined_at")
    .eq("session_id", sessionId);
  if (error) {
    throw error;
  }
  return (data ?? []).map(mapParticipant);
}

async function getTemplateOrThrow(templateId: string): Promise<QuizTemplate> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("quiz_templates")
    .select("id, title, created_at")
    .eq("id", templateId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Template not found.");
  }

  return {
    ...mapTemplateSummary(data),
    questions: await loadTemplateQuestions(templateId),
  };
}

export function createSupabaseGateway(): AppGateway {
  const client = getSupabaseClient();

  return {
    auth: {
      async getSnapshot(): Promise<AuthSnapshot> {
        const { data, error } = await client.auth.getSession();
        if (error) {
          throw error;
        }
        return { user: mapUser(data.session) };
      },
      onChange(listener) {
        const { data } = client.auth.onAuthStateChange((_, session) => {
          listener({ user: mapUser(session) });
        });
        return () => data.subscription.unsubscribe();
      },
      async signInWithGoogle() {
        const redirectTo = `${window.location.origin}${window.location.pathname}?mode=host`;
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) {
          throw error;
        }
      },
      async signOut() {
        const { error } = await client.auth.signOut();
        if (error) {
          throw error;
        }
      },
      async isTeacher() {
        const { data, error } = await client.rpc("is_teacher");
        if (error) {
          throw error;
        }
        return Boolean(data);
      },
    },
    templates: {
      async list() {
        const { data, error } = await client
          .from("quiz_templates")
          .select("id, title, created_at")
          .order("created_at", { ascending: false });
        if (error) {
          throw error;
        }
        return (data ?? []).map(mapTemplateSummary);
      },
      async getById(templateId) {
        try {
          return await getTemplateOrThrow(templateId);
        } catch {
          return null;
        }
      },
      async save(draft: TemplateDraft) {
        let templateId = draft.id;
        if (templateId) {
          const { error } = await client
            .from("quiz_templates")
            .update({ title: draft.title.trim(), description: null })
            .eq("id", templateId);
          if (error) {
            throw error;
          }
        } else {
          const { data, error } = await client
            .from("quiz_templates")
            .insert({ title: draft.title.trim(), description: null })
            .select("id")
            .single();
          if (error) {
            throw error;
          }
          templateId = String(data.id);
        }

        const existingQuestions = await loadTemplateQuestions(templateId);
        if (existingQuestions.length > 0) {
          const { error } = await client.from("questions").delete().eq("quiz_template_id", templateId);
          if (error) {
            throw error;
          }
        }

        const insertedQuestions = await Promise.all(
          draft.questions.map(async (question, index) => {
            const { data, error } = await client
              .from("questions")
              .insert({
                quiz_template_id: templateId,
                order_index: index + 1,
                prompt: question.prompt.trim(),
              })
              .select("id")
              .single();
            if (error) {
              throw error;
            }
            return { localId: question.localId, id: String(data.id), options: question.options };
          }),
        );

        for (const question of insertedQuestions) {
          const payload = question.options.map((option, index) => ({
            question_id: question.id,
            order_index: index + 1,
            label: option.label.trim(),
            is_correct: option.isCorrect,
          }));
          const { error } = await client.from("question_options").insert(payload);
          if (error) {
            throw error;
          }
        }

        return getTemplateOrThrow(templateId);
      },
      async deleteById(templateId) {
        const { error } = await client.from("quiz_templates").delete().eq("id", templateId);
        if (error) {
          throw error;
        }
      },
    },
    sessions: {
      async start(input) {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const { data, error } = await client
            .from("sessions")
            .insert({
              quiz_template_id: input.templateId,
              template_title_snapshot: input.templateTitleSnapshot,
              code: makeSessionCode(),
              status: "open",
            })
            .select("id, quiz_template_id, template_title_snapshot, code, status, created_at")
            .single();
          if (!error) {
            return mapSession(data);
          }
          lastError = error;
        }
        throw lastError instanceof Error ? lastError : new Error("Unable to generate a unique session code.");
      },
      async getById(sessionId) {
        const { data, error } = await client
          .from("sessions")
          .select("id, quiz_template_id, template_title_snapshot, code, status, created_at")
          .eq("id", sessionId)
          .maybeSingle();
        if (error) {
          throw error;
        }
        return data ? mapSession(data) : null;
      },
      async getByCode(code) {
        return fetchSessionByCode(code);
      },
      async getAnalytics(sessionId) {
        const session = await this.getById(sessionId);
        if (!session) {
          throw new Error("Session not found.");
        }
        const [questions, answers, participants] = await Promise.all([
          loadSessionQuestions(session),
          loadSessionAnswers(sessionId),
          loadSessionParticipants(sessionId),
        ]);

        return buildSessionAnalytics({
          session,
          title: session.templateTitleSnapshot ?? "Untitled session",
          questions,
          answers,
          participantTokens: participants.map((participant) => participant.participantToken),
        });
      },
      async listClosed(): Promise<ClosedSessionSummary[]> {
        const { data, error } = await client
          .from("sessions")
          .select("id, quiz_template_id, template_title_snapshot, code, status, created_at, participants(count)")
          .eq("status", "closed")
          .order("created_at", { ascending: false });
        if (error) {
          throw error;
        }
        return (data ?? []).map((row) => ({
          ...mapSession(row as Row),
          participantCount: (row.participants as { count: number }[])[0]?.count ?? 0,
        }));
      },
      async close(sessionId) {
        const { data, error } = await client
          .from("sessions")
          .update({ status: "closed" })
          .eq("id", sessionId)
          .select("id, quiz_template_id, template_title_snapshot, code, status, created_at")
          .single();
        if (error) {
          throw error;
        }
        return mapSession(data);
      },
      async deleteClosed(sessionId) {
        const { error } = await client.from("sessions").delete().eq("id", sessionId).eq("status", "closed");
        if (error) {
          throw error;
        }
      },
      async deleteAllClosed() {
        const { error } = await client.from("sessions").delete().eq("status", "closed");
        if (error) {
          throw error;
        }
      },
      subscribeToSession(sessionId, onUpdate) {
        const channel = client
          .channel(`session-${sessionId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: `session_id=eq.${sessionId}` }, onUpdate)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants", filter: `session_id=eq.${sessionId}` }, onUpdate)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, onUpdate)
          .subscribe();
        return () => { void client.removeChannel(channel); };
      },
    },
    student: {
      async getBundleByCode(code) {
        const session = await fetchSessionByCode(code);
        if (!session || session.status !== "open") {
          return null;
        }
        return {
          session,
          title: session.templateTitleSnapshot ?? "Live quiz",
          questions: await loadSessionQuestions(session),
        };
      },
      async registerParticipant(input) {
        const payload = {
          session_id: input.sessionId,
          participant_token: input.participantToken,
          nickname: input.nickname.trim() || null,
          avatar: input.avatar,
        };
        const { error } = await client.from("participants").insert(payload);
        if (error && error.code !== "23505") {
          throw error;
        }
        return {
          id: 0,
          sessionId: input.sessionId,
          participantToken: input.participantToken,
          nickname: payload.nickname,
          avatar: payload.avatar,
          joinedAt: new Date().toISOString(),
        };
      },
      async getProgress(sessionId, participantToken, questionCount) {
        const { data, error } = await client
          .from("answers")
          .select("id, session_id, participant_token, question_id, option_id, submitted_at")
          .eq("session_id", sessionId)
          .eq("participant_token", participantToken);
        if (error) {
          throw error;
        }
        const answers = (data ?? []).map(mapAnswer);
        const answeredQuestions = new Set(answers.map((answer) => answer.questionId));
        return {
          answers,
          completed: answers.length >= questionCount && questionCount > 0,
          nextQuestionIndex: Math.min(answeredQuestions.size, Math.max(questionCount - 1, 0)),
        } satisfies StudentProgress;
      },
      async submitAnswer(input) {
        const { data, error } = await client
          .from("answers")
          .upsert(
            {
              session_id: input.sessionId,
              participant_token: input.participantToken,
              question_id: input.questionId,
              option_id: input.optionId,
              submitted_at: new Date().toISOString(),
            },
            {
              onConflict: "session_id,participant_token,question_id",
            },
          )
          .select("id, session_id, participant_token, question_id, option_id, submitted_at")
          .single();
        if (error) {
          throw error;
        }
        return mapAnswer(data);
      },
    },
  };
}
