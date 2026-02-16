-- Phase 8.1 (revisione) - elimina archiviazione, preserva storico sessioni quando si elimina template

alter table public.sessions
  add column if not exists template_title_snapshot text;

alter table public.sessions
  alter column quiz_template_id drop not null;

alter table public.sessions
  drop constraint if exists sessions_quiz_template_id_fkey;

alter table public.sessions
  add constraint sessions_quiz_template_id_fkey
  foreign key (quiz_template_id)
  references public.quiz_templates(id)
  on delete set null;

-- opzionale: se presente dal vecchio flusso, rimuove la colonna di archiviazione template
alter table public.quiz_templates
  drop column if exists is_archived;
