--Migración 047: Corrige notas_insert_profesor y notas_update_profesor para
--soportar materias técnicas con estudiantes de varios paralelos.

--Las políticas exigían estudiante.curso_id = actividad.curso_id, criterio
--válido para materias regulares pero incompatible con materias técnicas,
--donde los estudiantes inscritos conservan su curso_id original de
--paralelo (A, B, C) y no comparten uno solo. Esto bloqueaba con RLS el
--registro de notas para estudiantes de un paralelo distinto al de la
--actividad, dentro de la misma materia técnica.

--Se agrega un camino alternativo de validación vía inscripciones_tecnicas
--cuando materias.es_tecnica = true, sin modificar el criterio existente
--para materias regulares (cambio aditivo, mismo patrón usado en 037/041).

--Probado en producción (colegio Juana Azurduy, materia Sistemas
--Informáticos, 24 estudiantes repartidos en 6° Secundaria A y B):
--confirmado el bloqueo antes del fix, confirmado el guardado correcto
--para todos los 24 después de aplicarlo.
ALTER POLICY notas_insert_profesor ON public.notas
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM asignaciones_profesor ap
    JOIN actividades a ON a.id = notas.actividad_id
    JOIN materias m ON m.id = a.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.curso_id = a.curso_id
      AND ap.materia_id = a.materia_id
      AND ap.activo = true
      AND (
        (m.es_tecnica IS NOT TRUE AND EXISTS (
          SELECT 1 FROM estudiantes e WHERE e.id = notas.estudiante_id AND e.curso_id = a.curso_id
        ))
        OR
        (m.es_tecnica IS TRUE AND EXISTS (
          SELECT 1 FROM inscripciones_tecnicas it
          WHERE it.estudiante_id = notas.estudiante_id AND it.materia_id = a.materia_id AND it.activo = true
        ))
      )
  )
);

ALTER POLICY notas_update_profesor ON public.notas
USING (
  EXISTS (
    SELECT 1
    FROM asignaciones_profesor ap
    JOIN actividades a ON a.id = notas.actividad_id
    JOIN materias m ON m.id = a.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.curso_id = a.curso_id
      AND ap.materia_id = a.materia_id
      AND ap.activo = true
      AND (
        (m.es_tecnica IS NOT TRUE AND EXISTS (
          SELECT 1 FROM estudiantes e WHERE e.id = notas.estudiante_id AND e.curso_id = a.curso_id
        ))
        OR
        (m.es_tecnica IS TRUE AND EXISTS (
          SELECT 1 FROM inscripciones_tecnicas it
          WHERE it.estudiante_id = notas.estudiante_id AND it.materia_id = a.materia_id AND it.activo = true
        ))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM asignaciones_profesor ap
    JOIN actividades a ON a.id = notas.actividad_id
    JOIN materias m ON m.id = a.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.curso_id = a.curso_id
      AND ap.materia_id = a.materia_id
      AND ap.activo = true
      AND (
        (m.es_tecnica IS NOT TRUE AND EXISTS (
          SELECT 1 FROM estudiantes e WHERE e.id = notas.estudiante_id AND e.curso_id = a.curso_id
        ))
        OR
        (m.es_tecnica IS TRUE AND EXISTS (
          SELECT 1 FROM inscripciones_tecnicas it
          WHERE it.estudiante_id = notas.estudiante_id AND it.materia_id = a.materia_id AND it.activo = true
        ))
      )
  )
);