-- 026 — Restringe el UPDATE de "marcado como leído" en comunicados_estudiante
-- para que solo pueda tocar su propia fila con su propio estudiante_id,
-- sin poder reasignar comunicado_id ni estudiante_id a otro valor.
-- Aditivo puro: no borra datos, no afecta lectura, no afecta al tutor
-- para vincularse ni al flujo de comunicados ya funcionando.

DROP POLICY IF EXISTS "com_est_update_leido_estudiante" ON public.comunicados_estudiante;
CREATE POLICY "com_est_update_leido_estudiante"
ON public.comunicados_estudiante FOR UPDATE
USING (estudiante_id = auth.uid())
WITH CHECK (estudiante_id = auth.uid());

DROP POLICY IF EXISTS "com_est_update_leido_tutor" ON public.comunicados_estudiante;
CREATE POLICY "com_est_update_leido_tutor"
ON public.comunicados_estudiante FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.tutor_estudiante te
    WHERE te.estudiante_id = comunicados_estudiante.estudiante_id
      AND te.tutor_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tutor_estudiante te
    WHERE te.estudiante_id = comunicados_estudiante.estudiante_id
      AND te.tutor_id = auth.uid()
  )
);