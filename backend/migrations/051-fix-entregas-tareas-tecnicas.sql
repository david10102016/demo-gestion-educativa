-- ─────────────────────────────────────────────────────────
-- 051 — entrega_estudiante_own no permitía subir entregas en
-- materias técnicas (curso_id NULL)
--
-- Problema: mismo origen que 048/049. El WITH CHECK agregado en
-- la migración 044 exige EXISTS (estudiante.curso_id = actividad.curso_id)
-- para prevenir que un estudiante suba una entrega a una actividad
-- de otro curso. Las actividades de materias técnicas quedaron con
-- curso_id NULL (agrupan varios paralelos) -- ese EXISTS nunca es
-- verdadero, bloqueando el INSERT/UPDATE (upsert) de la entrega con
-- 403/42501 para cualquier estudiante técnico, sin importar que
-- esté correctamente inscrito.
--
-- Confirmado en vivo (Juana Azurduy, materia Sistemas Informáticos):
-- 24 estudiantes inscritos en inscripciones_tecnicas, todos bloqueados
-- para la actividad "Tarea: Diagnostico e introducción a redes"
-- (curso_id NULL), pese a estar correctamente inscritos.
--
-- Nota: mismo patrón ya corregido en notas_update_profesor (047) y
-- notas_select_profesor (049) -- se replica exactamente esa misma
-- lógica ya probada, ahora sobre entregas_tareas.
--
-- Solución: se agrega un OR a la política existente. Para materias
-- técnicas, en vez de comparar curso_id, se valida que el estudiante
-- esté inscrito en inscripciones_tecnicas para la materia de esa
-- actividad. El chequeo original por curso queda intacto para
-- materias no técnicas -- cambio aditivo, no reemplaza el criterio
-- existente, solo agrega la vía alternativa.
-- ─────────────────────────────────────────────────────────

alter policy "entrega_estudiante_own"
on public.entregas_tareas
with check (
  estudiante_id = auth.uid()
  and exists (
    select 1
    from public.actividades a
    join public.materias m on m.id = a.materia_id
    where a.id = entregas_tareas.actividad_id
      and (
        (m.es_tecnica is not true and exists (
          select 1 from public.estudiantes e
          where e.id = entregas_tareas.estudiante_id and e.curso_id = a.curso_id
        ))
        or
        (m.es_tecnica is true and exists (
          select 1 from public.inscripciones_tecnicas it
          where it.estudiante_id = entregas_tareas.estudiante_id
            and it.materia_id = a.materia_id
            and it.activo = true
        ))
      )
  )
);

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
-- select policyname, with_check from pg_policies
-- where tablename = 'entregas_tareas' and policyname = 'entrega_estudiante_own';
--
-- 1. Estudiante técnico real (ej. Pascual Portillo Miguel Angel,
--    curso 490245d5..., inscrito en Sistemas Informáticos) sube
--    entrega a la actividad "Diagnostico e introducción a redes"
--    (curso_id NULL) -> debe dar 201.
-- 2. Flujo legítimo no técnico: estudiante regular sube entrega a
--    actividad de su propio curso -> debe seguir dando 201, sin
--    cambios respecto al comportamiento anterior.
-- 3. Caso que debe seguir bloqueado: estudiante intentando subir
--    entrega a actividad de un curso ajeno (no técnico, no
--    inscrito) -> debe seguir dando 403/42501, igual que en 044.
-- ─────────────────────────────────────────────────────────
--NOTA FINAL SE HIZO LA PRUEBA Y COMPROBADO QUE ESTUDIANTES DE MATERIAS REGULARES Y CARRERAS TECNICAS PUEDEN SUBIR LAS TAREAS.
--PROBADO CON EXITO