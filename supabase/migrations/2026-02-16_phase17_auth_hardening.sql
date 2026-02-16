-- Phase 17 - Auth docente + hardening RLS per deploy pubblico

create table if not exists public.teacher_whitelist (
  email text primary key,
  created_at timestamptz not null default now()
);

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

-- Cleanup vecchie policy demo aperte.
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

-- Recreate policies in modo idempotente.
drop policy if exists quiz_templates_teacher_all on public.quiz_templates;
create policy quiz_templates_teacher_all on public.quiz_templates
for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists questions_teacher_all on public.questions;
create policy questions_teacher_all on public.questions
for all using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists questions_student_select_open on public.questions;
create policy questions_student_select_open on public.questions
for select using (
  exists (
    select 1
    from public.sessions s
    where s.quiz_template_id = public.questions.quiz_template_id
      and s.status = 'open'
  )
);

drop policy if exists options_teacher_all on public.question_options;
create policy options_teacher_all on public.question_options
for all using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists options_student_select_open on public.question_options;
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

drop policy if exists sessions_teacher_all on public.sessions;
create policy sessions_teacher_all on public.sessions
for all using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists sessions_student_select_open on public.sessions;
create policy sessions_student_select_open on public.sessions
for select using (status = 'open');

drop policy if exists participants_teacher_select on public.participants;
create policy participants_teacher_select on public.participants
for select using (public.is_teacher());
drop policy if exists participants_teacher_delete on public.participants;
create policy participants_teacher_delete on public.participants
for delete using (public.is_teacher());
drop policy if exists participants_student_insert_open on public.participants;
create policy participants_student_insert_open on public.participants
for insert with check (
  exists (
    select 1
    from public.sessions s
    where s.id = public.participants.session_id
      and s.status = 'open'
  )
);
drop policy if exists participants_student_update_open on public.participants;
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

drop policy if exists answers_teacher_select on public.answers;
create policy answers_teacher_select on public.answers
for select using (public.is_teacher());
drop policy if exists answers_teacher_delete on public.answers;
create policy answers_teacher_delete on public.answers
for delete using (public.is_teacher());
drop policy if exists answers_student_select_open on public.answers;
create policy answers_student_select_open on public.answers
for select using (
  exists (
    select 1
    from public.sessions s
    where s.id = public.answers.session_id
      and s.status = 'open'
  )
);
drop policy if exists answers_student_insert_open on public.answers;
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
drop policy if exists answers_student_update_open on public.answers;
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
