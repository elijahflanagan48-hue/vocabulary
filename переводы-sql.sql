-- NOEON Words v133: память переводов и журнал исправлений
-- Вставьте целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

create table if not exists public.tr_memory(
  teacher_id uuid not null references auth.users(id) on delete cascade,
  lang text not null,
  en_key text not null,
  en text not null,
  ru text not null,
  n int not null default 1,
  updated_at timestamptz not null default now(),
  primary key(teacher_id,lang,en_key)
);
create table if not exists public.tr_log(
  id bigserial primary key,
  student_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  lang text not null,
  en text not null,
  en_key text not null,
  auto text not null,
  chosen text not null,
  created_at timestamptz not null default now()
);
create index if not exists tr_log_teacher on public.tr_log(teacher_id,created_at desc);

alter table public.tr_memory enable row level security;
alter table public.tr_log enable row level security;

drop policy if exists tr_memory_teacher on public.tr_memory;
create policy tr_memory_teacher on public.tr_memory for all to authenticated
  using (teacher_id=auth.uid()) with check (teacher_id=auth.uid());

drop policy if exists tr_memory_student_read on public.tr_memory;
create policy tr_memory_student_read on public.tr_memory for select to authenticated
  using (exists(select 1 from public.links l where l.teacher_id=tr_memory.teacher_id and l.student_id=auth.uid()));

drop policy if exists tr_log_student_insert on public.tr_log;
create policy tr_log_student_insert on public.tr_log for insert to authenticated
  with check (student_id=auth.uid() and exists(select 1 from public.links l where l.teacher_id=tr_log.teacher_id and l.student_id=auth.uid()));

drop policy if exists tr_log_teacher on public.tr_log;
create policy tr_log_teacher on public.tr_log for select to authenticated using (teacher_id=auth.uid());

drop policy if exists tr_log_teacher_del on public.tr_log;
create policy tr_log_teacher_del on public.tr_log for delete to authenticated using (teacher_id=auth.uid());

-- ученик должен видеть свою связь с учителем (если такой политики уже нет)
drop policy if exists links_student_read_tr on public.links;
create policy links_student_read_tr on public.links for select to authenticated using (student_id=auth.uid());
