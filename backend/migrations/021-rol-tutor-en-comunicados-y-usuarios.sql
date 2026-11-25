-- ─────────────────────────────────────────────────────────
-- 021 — Políticas faltantes para el rol tutor en comunicados y usuarios
-- Mismo patrón ya aplicado para el rol estudiante en la migración 018.
-- Aditivo: no modifica ninguna política ni tabla existente.
-- ─────────────────────────────────────────────────────────

CREATE POLICY "comunicados_select_tutor"
ON public.comunicados FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.tutor_estudiante te
    JOIN public.estudiantes e ON e.id = te.estudiante_id
    WHERE te.tutor_id = auth.uid()
      AND e.colegio_id = comunicados.colegio_id
  )
);

CREATE POLICY "usuarios_select_tutor_colegio"
ON public.usuarios FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tutores_familia tf
    WHERE tf.id = auth.uid()
      AND tf.colegio_id = usuarios.colegio_id
  )
);