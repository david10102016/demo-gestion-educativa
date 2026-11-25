-- 086-politica-notas-traslado-paralelo.sql
-- Fecha: 2026-10-20
-- Problema: al cambiar a un estudiante de paralelo (ej. 6° A -> 6° B),
-- el profesor del curso nuevo no podía leer las notas que el estudiante
-- tenía en el paralelo anterior (notas_select_profesor exige
-- ap.curso_id = a.curso_id en materias regulares).
-- Solución: política SELECT aditiva. El profesor lee las notas de sus
-- estudiantes ACTUALES, en la materia que dicta, aunque la actividad sea
-- de otro paralelo. Solo materias regulares. Solo lectura: no cambia
-- insert/update/delete ni las políticas existentes.
-- Probado en PostgreSQL local antes de aplicar.
-- Revertir: drop policy notas_select_profesor_traslado on public.notas;
create policy notas_select_profesor_traslado
on public.notas
for select
to authenticated
using (
  exists (
    select 1
    from actividades a
    join materias m on m.id = a.materia_id
    join estudiantes e on e.id = notas.estudiante_id
    join asignaciones_profesor ap
      on ap.profesor_id = auth.uid()
     and ap.materia_id = a.materia_id
     and ap.curso_id = e.curso_id
     and ap.activo = true
    where a.id = notas.actividad_id
      and m.es_tecnica is not true
  )
);