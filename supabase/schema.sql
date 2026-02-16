-- Quiz QR Classroom demo schema

create extension if not exists pgcrypto;

create table if not exists public.quiz_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_template_id uuid not null references public.quiz_templates(id) on delete cascade,
  order_index int not null,
  prompt text not null,
  created_at timestamptz not null default now(),
  unique(quiz_template_id, order_index)
);

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  order_index int not null,
  label text not null,
  is_correct boolean not null default false,
  unique(question_id, order_index)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_template_id uuid references public.quiz_templates(id) on delete set null,
  template_title_snapshot text,
  code text not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_token text not null,
  nickname text,
  avatar text,
  joined_at timestamptz not null default now(),
  unique(session_id, participant_token)
);

create table if not exists public.answers (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_token text not null,
  question_id uuid not null references public.questions(id) on delete cascade,
  option_id uuid not null references public.question_options(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique(session_id, participant_token, question_id)
);

create table if not exists public.teacher_whitelist (
  email text primary key,
  created_at timestamptz not null default now()
);

create index if not exists idx_answers_session on public.answers(session_id);
create index if not exists idx_answers_question on public.answers(question_id);
create index if not exists idx_participants_session on public.participants(session_id);

alter table public.quiz_templates enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.answers enable row level security;
alter table public.teacher_whitelist enable row level security;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_whitelist tw
    where lower(tw.email) = lower(coalesce(auth.jwt()->>'email', ''))
  );
$$;

grant execute on function public.is_teacher() to anon, authenticated;

-- Cleanup policy names from previous demo setup.
drop policy if exists quiz_templates_select_all on public.quiz_templates;
drop policy if exists quiz_templates_insert_all on public.quiz_templates;
drop policy if exists quiz_templates_update_all on public.quiz_templates;
drop policy if exists quiz_templates_delete_all on public.quiz_templates;
drop policy if exists questions_select_all on public.questions;
drop policy if exists questions_insert_all on public.questions;
drop policy if exists questions_update_all on public.questions;
drop policy if exists questions_delete_all on public.questions;
drop policy if exists options_select_all on public.question_options;
drop policy if exists options_insert_all on public.question_options;
drop policy if exists options_update_all on public.question_options;
drop policy if exists options_delete_all on public.question_options;
drop policy if exists sessions_select_all on public.sessions;
drop policy if exists sessions_insert_all on public.sessions;
drop policy if exists sessions_update_all on public.sessions;
drop policy if exists participants_select_all on public.participants;
drop policy if exists participants_insert_all on public.participants;
drop policy if exists participants_update_all on public.participants;
drop policy if exists answers_select_all on public.answers;
drop policy if exists answers_insert_all on public.answers;
drop policy if exists answers_update_all on public.answers;

-- Teacher whitelist table: no direct access via anon/authenticated; management via SQL Editor.

-- Teacher policies (full access where needed).
create policy quiz_templates_teacher_all on public.quiz_templates
for all using (public.is_teacher()) with check (public.is_teacher());

create policy questions_teacher_all on public.questions
for all using (public.is_teacher()) with check (public.is_teacher());
create policy questions_student_select_open on public.questions
for select using (
  exists (
    select 1
    from public.sessions s
    where s.quiz_template_id = public.questions.quiz_template_id
      and s.status = 'open'
  )
);

create policy options_teacher_all on public.question_options
for all using (public.is_teacher()) with check (public.is_teacher());
create policy options_student_select_open on public.question_options
for select using (
  exists (
    select 1
    from public.questions q
    join public.sessions s on s.quiz_template_id = q.quiz_template_id
    where q.id = public.question_options.question_id
      and s.status = 'open'
  )
);

create policy sessions_teacher_all on public.sessions
for all using (public.is_teacher()) with check (public.is_teacher());
create policy sessions_student_select_open on public.sessions
for select using (status = 'open');

create policy participants_teacher_select on public.participants
for select using (public.is_teacher());
create policy participants_teacher_delete on public.participants
for delete using (public.is_teacher());
create policy participants_student_insert_open on public.participants
for insert with check (
  exists (
    select 1
    from public.sessions s
    where s.id = public.participants.session_id
      and s.status = 'open'
  )
);
create policy participants_student_update_open on public.participants
for update using (
  exists (
    select 1
    from public.sessions s
    where s.id = public.participants.session_id
      and s.status = 'open'
  )
) with check (
  exists (
    select 1
    from public.sessions s
    where s.id = public.participants.session_id
      and s.status = 'open'
  )
);

create policy answers_teacher_select on public.answers
for select using (public.is_teacher());
create policy answers_teacher_delete on public.answers
for delete using (public.is_teacher());
create policy answers_student_select_open on public.answers
for select using (
  exists (
    select 1
    from public.sessions s
    where s.id = public.answers.session_id
      and s.status = 'open'
  )
);
create policy answers_student_insert_open on public.answers
for insert with check (
  exists (
    select 1
    from public.sessions s
    where s.id = public.answers.session_id
      and s.status = 'open'
  )
  and exists (
    select 1
    from public.questions q
    where q.id = public.answers.question_id
  )
  and exists (
    select 1
    from public.question_options qo
    where qo.id = public.answers.option_id
      and qo.question_id = public.answers.question_id
  )
);
create policy answers_student_update_open on public.answers
for update using (
  exists (
    select 1
    from public.sessions s
    where s.id = public.answers.session_id
      and s.status = 'open'
  )
) with check (
  exists (
    select 1
    from public.sessions s
    where s.id = public.answers.session_id
      and s.status = 'open'
  )
  and exists (
    select 1
    from public.question_options qo
    where qo.id = public.answers.option_id
      and qo.question_id = public.answers.question_id
  )
);

-- Seed demo: 1 template, 3 domande, 5 opzioni ciascuna
with ins_template as (
  insert into public.quiz_templates (title, description)
  values ('Blocco Demo - Biologia', 'Quiz demo con 3 domande a scelta multipla')
  returning id
),
q1 as (
  insert into public.questions (quiz_template_id, order_index, prompt)
  select id, 1, 'Qual e l''unita base della vita?' from ins_template
  returning id
),
q2 as (
  insert into public.questions (quiz_template_id, order_index, prompt)
  select id, 2, 'Quale organello e coinvolto nella respirazione cellulare?' from ins_template
  returning id
),
q3 as (
  insert into public.questions (quiz_template_id, order_index, prompt)
  select id, 3, 'Quale molecola contiene l''informazione genetica?' from ins_template
  returning id
)
insert into public.question_options (question_id, order_index, label, is_correct)
select q1.id, 1, 'Cellula', true from q1
union all select q1.id, 2, 'Atomo', false from q1
union all select q1.id, 3, 'Neurone', false from q1
union all select q1.id, 4, 'Tessuto', false from q1
union all select q1.id, 5, 'Proteina', false from q1
union all select q2.id, 1, 'Ribosoma', false from q2
union all select q2.id, 2, 'Mitocondrio', true from q2
union all select q2.id, 3, 'Nucleo', false from q2
union all select q2.id, 4, 'Apparato di Golgi', false from q2
union all select q2.id, 5, 'Lisosoma', false from q2
union all select q3.id, 1, 'ATP', false from q3
union all select q3.id, 2, 'RNA', false from q3
union all select q3.id, 3, 'DNA', true from q3
union all select q3.id, 4, 'Glucosio', false from q3
union all select q3.id, 5, 'Lipidi', false from q3;
