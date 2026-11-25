-- ─────────────────────────────────────────────────────────
-- 024 — Control de rol y asignación en fichas_seguimiento_ser
-- Aditivo: no modifica la tabla, no borra datos existentes.
-- Corrige: las políticas fichas_insert_profesor y fichas_update_profesor
-- solo verificaban "profesor_id = auth.uid()", sin confirmar que quien
-- llama realmente tenga el rol de profesor ni que esté asignado al
-- curso del estudiante. Cualquier usuario logueado (ej. un tutor) podía
-- insertar/editar una Ficha SER haciéndose pasar por profesor,
-- para cualquier estudiante, incluso de otro colegio.
--
-- Confirmado en vivo con curl usando token real de una cuenta tutor:
-- antes del fix -> error 23503 (foreign key), es decir pasó el control
-- de acceso y solo falló por el estudiante_id/materia_id inventados.
-- después del fix -> error 42501 "new row violates row-level security
-- policy for table fichas_seguimiento_ser".
-- ─────────────────────────────────────────────────────────

DROP POLICY fichas_insert_profesor ON public.fichas_seguimiento_ser;
CREATE POLICY fichas_insert_profesor ON public.fichas_seguimiento_ser
FOR INSERT WITH CHECK (
  public.es_profesor()
  AND profesor_id = auth.uid()
  AND public.profesor_tiene_asignacion(estudiante_id)
);

DROP POLICY fichas_update_profesor ON public.fichas_seguimiento_ser;
CREATE POLICY fichas_update_profesor ON public.fichas_seguimiento_ser
FOR UPDATE USING (
  public.es_profesor()
  AND profesor_id = auth.uid()
  AND public.profesor_tiene_asignacion(estudiante_id)
);