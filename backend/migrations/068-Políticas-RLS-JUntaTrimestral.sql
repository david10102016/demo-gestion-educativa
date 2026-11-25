-- ============================================================
-- MIGRACIÓN 068: Políticas RLS para notificaciones_log (acta Junta Trimestral)
-- Aditiva: tabla existente, sin datos, sin policies hasta ahora.
-- ============================================================

CREATE POLICY notificaciones_log_acta_insert ON public.notificaciones_log
FOR INSERT WITH CHECK (
  tipo = 'acta_junta'
  AND (mensaje::jsonb ->> 'profesor_id') = auth.uid()::text
);

CREATE POLICY notificaciones_log_acta_update ON public.notificaciones_log
FOR UPDATE USING (
  tipo = 'acta_junta'
  AND (mensaje::jsonb ->> 'profesor_id') = auth.uid()::text
)
WITH CHECK (
  tipo = 'acta_junta'
  AND (mensaje::jsonb ->> 'profesor_id') = auth.uid()::text
);

CREATE POLICY notificaciones_log_acta_select ON public.notificaciones_log
FOR SELECT USING (
  tipo = 'acta_junta'
  AND (mensaje::jsonb ->> 'profesor_id') = auth.uid()::text
);