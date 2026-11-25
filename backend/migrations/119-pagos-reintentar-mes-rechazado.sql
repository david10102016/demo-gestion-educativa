-- ─────────────────────────────────────────────────────────
-- 119 — Permite volver a pagar un mes cuyo pago fue rechazado.
--
-- Problema (23-nov-2026, prueba en Juana Azurduy): la tabla
-- pagos_mensualidad tenía un único (estudiante_id, año, mes). Un pago
-- rechazado seguía ocupando ese lugar, así que ni el padre (transferencia)
-- ni la secretaría (efectivo) podían registrar un pago nuevo para ese mes:
-- error 23505 "Ese mes ya tiene un pago registrado para este estudiante".
--
-- Corrección: el único pasa a contar solo los pagos NO rechazados
-- (índice único parcial). Los rechazados quedan como historial.
-- Sigue sin poder haber dos pagos vigentes (pendiente, en_revision o
-- aprobado) del mismo mes; si alguien intentara volver a poner vigente un
-- rechazado habiendo otro vigente, la base lo rechaza.
--
-- No borra ni modifica datos. Las filas actuales cumplen el índice nuevo
-- porque ya cumplían el anterior, que era más estricto. Idempotente.
--
-- Reversión (solo si no hay dos filas del mismo mes):
--   DROP INDEX public.pagos_mensualidad_mes_vigente_uq;
--   ALTER TABLE public.pagos_mensualidad
--     ADD CONSTRAINT "pagos_mensualidad_estudiante_id_año_mes_key"
--     UNIQUE (estudiante_id, "año", mes);
-- ─────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.pagos_mensualidad
  DROP CONSTRAINT IF EXISTS "pagos_mensualidad_estudiante_id_año_mes_key";

DROP INDEX IF EXISTS public."pagos_mensualidad_estudiante_id_año_mes_key";

CREATE UNIQUE INDEX IF NOT EXISTS pagos_mensualidad_mes_vigente_uq
  ON public.pagos_mensualidad (estudiante_id, "año", mes)
  WHERE estado <> 'rechazado';

COMMIT;

-- Verificación (debe listar pagos_mensualidad_mes_vigente_uq con WHERE
-- y ya no el índice ..._estudiante_id_año_mes_key):
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'pagos_mensualidad';