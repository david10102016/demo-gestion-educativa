-- ─────────────────────────────────────────────────────────
-- 030 — Permite pagos sin cuenta de tutor asociada (pago en
-- efectivo, registrado por secretaria), y cambia la visibilidad
-- del padre de "lo que yo mismo cargué" a "lo que le corresponde
-- a mi hijo vinculado".
-- Aditivo en su mayoría: relaja una restricción NOT NULL, agrega
-- columnas nuevas, y reemplaza pagos_select_tutor por una versión
-- que cubre más casos sin quitarle nada a nadie legítimo.
--
-- Contexto: pagos_mensualidad.tutor_id era obligatorio, así que un
-- pago no podía existir sin una cuenta de padre ya creada. Si el
-- padre nunca se registró (o llega al colegio a pagar en efectivo
-- sin cuenta), secretaria no tenía forma de cargar ese pago.
--
-- Verificado en vivo: se registró un pago en efectivo para un
-- estudiante ya vinculado a un tutor real (Paz), y ese pago
-- apareció automáticamente en el panel del padre sin que él
-- hiciera nada, confirmando que la nueva política de lectura
-- funciona según lo esperado. También se confirmó que los pagos
-- previos del padre (con tutor_id ya puesto) siguieron visibles
-- sin cambios tras aplicar la migración.
-- ─────────────────────────────────────────────────────────

ALTER TABLE public.pagos_mensualidad ALTER COLUMN tutor_id DROP NOT NULL;
ALTER TABLE public.pagos_mensualidad ADD COLUMN IF NOT EXISTS nombre_pagador TEXT;
ALTER TABLE public.pagos_mensualidad ADD COLUMN IF NOT EXISTS registrado_por UUID REFERENCES public.usuarios(id);

DROP POLICY IF EXISTS "pagos_select_tutor" ON public.pagos_mensualidad;
CREATE POLICY "pagos_select_tutor"
ON public.pagos_mensualidad FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tutor_estudiante te
    WHERE te.estudiante_id = pagos_mensualidad.estudiante_id
      AND te.tutor_id = auth.uid()
      AND te.activo = true
  )
);

CREATE POLICY "pagos_insert_secretaria"
ON public.pagos_mensualidad FOR INSERT
WITH CHECK (
  es_secretaria() AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = estudiante_id AND e.colegio_id = mi_colegio_id()
  )
);