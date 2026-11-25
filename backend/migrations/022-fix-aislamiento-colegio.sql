-- ─────────────────────────────────────────────────────────
-- 022 — Corrige fugas de aislamiento entre colegios
-- entregas_tareas, notas, audit_logs, respuestas_evaluacion
-- ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "entrega_profesor_read" ON public.entregas_tareas;

CREATE POLICY "entrega_select_profesor"
ON public.entregas_tareas FOR SELECT
USING (es_profesor() AND public.profesor_tiene_asignacion(estudiante_id));

CREATE POLICY "entrega_select_director"
ON public.entregas_tareas FOR SELECT
USING (
  es_director() AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = entregas_tareas.estudiante_id
      AND e.colegio_id = mi_colegio_id()
  )
);

DROP POLICY IF EXISTS "notas_select_profesor" ON public.notas;

CREATE POLICY "notas_select_profesor"
ON public.notas FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.asignaciones_profesor ap
    JOIN public.actividades a ON a.id = notas.actividad_id
    WHERE ap.profesor_id = auth.uid()
      AND ap.materia_id = a.materia_id
      AND ap.curso_id = a.curso_id
      AND ap.activo = true
  )
);

DROP POLICY IF EXISTS "audit_select_director" ON public.audit_logs;

CREATE POLICY "audit_select_director"
ON public.audit_logs FOR SELECT
USING (
  es_director() AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = audit_logs.actor_id
      AND u.colegio_id = mi_colegio_id()
  )
);

DROP POLICY IF EXISTS "respuestas_select_director" ON public.respuestas_evaluacion;

CREATE POLICY "respuestas_select_director"
ON public.respuestas_evaluacion FOR SELECT
USING (
  es_director() AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = respuestas_evaluacion.estudiante_id
      AND e.colegio_id = mi_colegio_id()
  )
);