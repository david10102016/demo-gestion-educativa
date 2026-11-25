-- 104 · "Mis tareas" del estudiante: qué actividades y qué notas ya vio
-- Una fila por (estudiante, actividad, tipo):
--   tipo 'actividad' → ya vio que la actividad existe (deja de ser "Nueva")
--   tipo 'nota'      → ya vio la nota de esa actividad (deja de ser "Nota nueva")
-- Solo el propio estudiante lee y escribe sus filas. No modifica ningún dato existente.
-- Sin FK a usuarios (evita ambigüedad de relaciones en PostgREST).
begin;

create table if not exists public.tareas_vistas (
  estudiante_id uuid not null references public.estudiantes(id) on delete cascade,
  actividad_id  uuid not null references public.actividades(id) on delete cascade,
  tipo          text not null check (tipo in ('actividad','nota')),
  visto_en      timestamptz not null default now(),
  primary key (estudiante_id, actividad_id, tipo)
);

alter table public.tareas_vistas enable row level security;

drop policy if exists tareas_vistas_select_propio on public.tareas_vistas;
create policy tareas_vistas_select_propio on public.tareas_vistas
  for select to authenticated using (estudiante_id = auth.uid());

drop policy if exists tareas_vistas_insert_propio on public.tareas_vistas;
create policy tareas_vistas_insert_propio on public.tareas_vistas
  for insert to authenticated with check (estudiante_id = auth.uid());

grant select, insert on public.tareas_vistas to authenticated;

commit;
