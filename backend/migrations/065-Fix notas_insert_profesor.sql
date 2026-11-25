-- ============================================================
-- MIGRACIÓN 065: Fix notas_insert_profesor y notas_update_profesor
-- — curso_id no debe exigirse para materias técnicas
--
-- Hallazgo: ambas policies exigían ap.curso_id = a.curso_id como
-- condición obligatoria para CUALQUIER materia, incluidas las
-- técnicas. Las técnicas se autorizan por inscripciones_tecnicas,
-- no por curso -- pero actividades.curso_id puede ser NULL en datos
-- migrados de la plataforma anterior (confirmado con datos reales:
-- 16 de 18 actividades de Sistemas Informáticos, todas con curso_id
-- NULL, incluida ebb06ee9-c47f-4333-b1da-6450883dd4e7 que ya tiene
-- notas insertadas). Como uuid = NULL nunca es verdadero, INSERT y
-- UPDATE se rechazaban con "violates row-level security policy"
-- aunque el profesor sí tuviera la asignación y el estudiante sí
-- estuviera inscrito en la técnica.
--
-- notas_select_profesor ya tenía el patrón correcto (curso_id
-- dentro de la rama de materias regulares, no afuera) -- este fix
-- alinea INSERT y UPDATE al mismo patrón, ya probado.
-- ============================================================

DROP POLICY IF EXISTS notas_insert_profesor ON public.notas;
CREATE POLICY notas_insert_profesor ON public.notas
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.asignaciones_profesor ap
    JOIN public.actividades a ON a.id = notas.actividad_id
    JOIN public.materias m ON m.id = a.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.materia_id = a.materia_id
      AND ap.activo = true
      AND (
        (
          m.es_tecnica IS NOT TRUE
          AND ap.curso_id = a.curso_id
          AND EXISTS (
            SELECT 1 FROM public.estudiantes e
            WHERE e.id = notas.estudiante_id AND e.curso_id = a.curso_id
          )
        )
        OR
        (
          m.es_tecnica IS TRUE
          AND EXISTS (
            SELECT 1 FROM public.inscripciones_tecnicas it
            WHERE it.estudiante_id = notas.estudiante_id
              AND it.materia_id = a.materia_id
              AND it.activo = true
          )
        )
      )
  )
);

-- Mismo bug, misma corrección: notas_update_profesor tenía
-- ap.curso_id = a.curso_id fuera de la rama de materias regulares
-- (a diferencia de notas_select_profesor, que sí lo tenía bien
-- puesto). Confirmado con datos reales: hay notas ya insertadas en
-- la actividad ebb06ee9-c47f-4333-b1da-6450883dd4e7 (curso_id NULL)
-- que hoy ningún profesor puede corregir/actualizar por este motivo.
DROP POLICY IF EXISTS notas_update_profesor ON public.notas;
CREATE POLICY notas_update_profesor ON public.notas
FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.asignaciones_profesor ap
    JOIN public.actividades a ON a.id = notas.actividad_id
    JOIN public.materias m ON m.id = a.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.materia_id = a.materia_id
      AND ap.activo = true
      AND (
        (
          m.es_tecnica IS NOT TRUE
          AND ap.curso_id = a.curso_id
          AND EXISTS (
            SELECT 1 FROM public.estudiantes e
            WHERE e.id = notas.estudiante_id AND e.curso_id = a.curso_id
          )
        )
        OR
        (
          m.es_tecnica IS TRUE
          AND EXISTS (
            SELECT 1 FROM public.inscripciones_tecnicas it
            WHERE it.estudiante_id = notas.estudiante_id
              AND it.materia_id = a.materia_id
              AND it.activo = true
          )
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.asignaciones_profesor ap
    JOIN public.actividades a ON a.id = notas.actividad_id
    JOIN public.materias m ON m.id = a.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.materia_id = a.materia_id
      AND ap.activo = true
      AND (
        (
          m.es_tecnica IS NOT TRUE
          AND ap.curso_id = a.curso_id
          AND EXISTS (
            SELECT 1 FROM public.estudiantes e
            WHERE e.id = notas.estudiante_id AND e.curso_id = a.curso_id
          )
        )
        OR
        (
          m.es_tecnica IS TRUE
          AND EXISTS (
            SELECT 1 FROM public.inscripciones_tecnicas it
            WHERE it.estudiante_id = notas.estudiante_id
              AND it.materia_id = a.materia_id
              AND it.activo = true
          )
        )
      )
  )
);

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. Profesor inserta/actualiza nota para un estudiante de materia
--    REGULAR, en su curso asignado -> debe seguir dando 201/200
--    (sin cambios de comportamiento, mismo criterio de antes).
--
-- 2. Profesor inserta/actualiza nota para un estudiante de materia
--    REGULAR en un curso que NO es el suyo -> debe seguir dando 403
--    (ap.curso_id = a.curso_id sigue exigiéndose para regulares).
--
-- 3. Profesor inserta nota en actividad TÉCNICA con curso_id NULL
--    (caso real: Choque Cruz Anai Yanis, actividad
--    ebb06ee9-c47f-4333-b1da-6450883dd4e7) para un estudiante con
--    inscripciones_tecnicas activa -> debe dar 201 (antes daba 403).
--
-- 4. Profesor actualiza una nota YA EXISTENTE en esa misma actividad
--    (ej. id 12e603ba-f857-4ad5-9bb4-c51d2fc318eb) -> debe dar 200
--    (antes daba 403, era el mismo bug en notas_update_profesor).
--
-- 5. Profesor inserta/actualiza nota técnica para un estudiante SIN
--    inscripciones_tecnicas activa en esa materia -> debe seguir
--    dando 403.
-- ─────────────────────────────────────────────────────────