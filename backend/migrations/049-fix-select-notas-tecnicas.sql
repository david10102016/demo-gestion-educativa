-- 049-fix-select-notas-tecnicas.sql
-- ─────────────────────────────────────────────────────────
-- 049 — notas_select_profesor no mostraba notas de materias técnicas
--
-- Problema: mismo origen que la migración 048. Con las actividades
-- técnicas ya visibles (curso_id NULL), las notas ligadas a ellas
-- seguían sin aparecer — "0/24 calificados" pese a que las 381 notas
-- migradas existían.
--
-- La policy de SELECT existente exigía:
--   ap.curso_id = a.curso_id
-- (comparar el curso de la asignación del profesor contra el curso
-- de la actividad). Con a.curso_id NULL, la comparación nunca es
-- verdadera.
--
-- Nota: el mismo patrón faltante ya existía corregido en
-- notas_update_profesor (usa materias.es_tecnica +
-- inscripciones_tecnicas) — este fix lleva el SELECT al mismo nivel,
-- replicando exactamente esa misma lógica ya probada.
--
-- Solución: se agrega un OR a la policy existente. Para materias
-- técnicas, en vez de comparar curso_id, se valida que el estudiante
-- de la nota esté realmente inscrito en inscripciones_tecnicas para
-- esa materia. Es más preciso que el chequeo por curso, no menos
-- estricto. El chequeo original queda intacto para materias no
-- técnicas. Sin riesgo de recursión: materias e inscripciones_tecnicas
-- no tienen policies que referencien notas.
-- ─────────────────────────────────────────────────────────

alter policy "notas_select_profesor"
on public.notas
using (
  exists (
    select 1
    from asignaciones_profesor ap
    join actividades a on a.id = notas.actividad_id
    join materias m on m.id = a.materia_id
    where ap.profesor_id = auth.uid()
    and ap.materia_id = a.materia_id
    and ap.activo = true
    and (
      (m.es_tecnica is not true and ap.curso_id = a.curso_id)
      or
      (m.es_tecnica is true and exists (
        select 1 from inscripciones_tecnicas it
        where it.estudiante_id = notas.estudiante_id
        and it.materia_id = a.materia_id
        and it.activo = true
      ))
    )
  )
);

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
-- select policyname, qual from pg_policies
-- where tablename = 'notas' and policyname = 'notas_select_profesor';
-- Probar en vivo: mismo panel, mismas actividades -> debe mostrar
-- "24/24 calificados" (o el conteo real) en vez de 0.
-- ─────────────────────────────────────────────────────────