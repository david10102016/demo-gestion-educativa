-- ============================================================
-- MIGRACIÓN 083: Entregas de tareas visibles solo para el
--                profesor de la materia + bucket "tareas" privado
--
-- Aplicada en producción: 17/10/2026
--
-- PARTE A — Política entrega_select_profesor
--
-- Hallazgo:
--   La política "entrega_select_profesor" (migración 022) solo
--   validaba profesor_tiene_asignacion(estudiante_id), es decir,
--   que el profesor tuviera al estudiante en ALGÚN curso asignado.
--   No verificaba que la tarea fuera de una materia que él dicta.
--   Resultado: un profesor podía leer las entregas de tareas de
--   otras materias del mismo curso.
--
-- Diagnóstico real (17/10/2026):
--   19 combinaciones profesor-entrega visibles, 3 expuestas.
--   Caso: un profesor sin Física ni Química veía 3 entregas de
--   "Ciencias Naturales: Física" y "Ciencias Naturales: Química".
--
-- Fix:
--   Nueva función SECURITY DEFINER profesor_dicta_actividad():
--   la materia de la actividad debe estar entre las asignaciones
--   activas del profesor. Para materias técnicas (actividades con
--   curso_id NULL) basta la asignación a la materia; la inscripción
--   del estudiante ya la valida profesor_tiene_asignacion().
--   La política exige ambas condiciones.
--
-- Verificación (17/10/2026, simulando el JWT del profesor):
--   1. Profesor SIN la materia  -> 0 entregas visibles  (OK)
--   2. Profesor de la materia   -> 1 entrega visible    (OK)
--
-- PARTE B — Bucket "tareas" privado
--
-- Hallazgo:
--   Las entregas se suben a Cloudinary (entrega-tareas.js); el
--   bucket "tareas" de Supabase ya no se usa, pero era PÚBLICO y
--   contenía 15 archivos antiguos accesibles por URL.
--   Ninguna fila de entregas_tareas apunta a ese bucket.
--
-- Fix:
--   El bucket pasa a privado. No se borra ningún archivo.
--
-- Reversión:
--   A) Volver a crear la política de la migración 022.
--   B) update storage.buckets set public = true where id = 'tareas';
-- ============================================================


-- ─── PARTE A ────────────────────────────────────────────────

create or replace function public.profesor_dicta_actividad(p_actividad_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.actividades a
    join public.asignaciones_profesor ap on ap.materia_id = a.materia_id
    where a.id = p_actividad_id
      and ap.profesor_id = auth.uid()
      and ap.activo = true
      and (a.curso_id is null or ap.curso_id = a.curso_id)  -- técnicas: curso_id NULL
  );
$$;

drop policy if exists "entrega_select_profesor" on public.entregas_tareas;

create policy "entrega_select_profesor"
on public.entregas_tareas
for select
using (
  es_profesor()
  and profesor_tiene_asignacion(estudiante_id)
  and profesor_dicta_actividad(actividad_id)
);


-- ─── PARTE B ────────────────────────────────────────────────

update storage.buckets
set public = false
where id = 'tareas';


-- ─── Verificación ───────────────────────────────────────────
-- select policyname, qual from pg_policies
-- where tablename = 'entregas_tareas' and policyname = 'entrega_select_profesor';
--
-- select id, public from storage.buckets where id = 'tareas';   -- public = false