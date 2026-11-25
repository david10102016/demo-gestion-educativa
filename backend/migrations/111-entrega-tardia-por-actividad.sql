-- ============================================================
-- 111 — Entrega en línea: permitir entregas fuera de plazo (por actividad)
--
-- Motivo: hoy, al vencer fecha_limite/hora_limite, el estudiante ya no puede subir su tarea.
-- Con esta columna, el profesor puede activar por actividad "Permitir entregas fuera de plazo":
-- el estudiante sube igual y la plataforma le muestra "Entregaste X horas después del plazo".
-- Si el profesor amplía la fecha, la marca de tardía se recalcula sola (se compara contra la fecha vigente).
--
-- Aditiva: 1 columna con default false → todas las actividades existentes siguen exactamente igual
-- (entrega cerrada al vencer). No toca notas, entregas, políticas RLS ni triggers.
-- Las políticas de UPDATE de actividades ya cubren la columna nueva (misma tabla).
-- Idempotente (if not exists).
-- ============================================================
BEGIN;

ALTER TABLE public.actividades
  ADD COLUMN IF NOT EXISTS permite_entrega_tardia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.actividades.permite_entrega_tardia IS
  'true = el estudiante puede subir su entrega después de fecha_limite/hora_limite; se marca como tardía en pantalla. false = se cierra al vencer (comportamiento original).';

COMMIT;

-- Revertir (solo si hace falta, después de desplegar el frontend anterior):
--   ALTER TABLE public.actividades DROP COLUMN IF EXISTS permite_entrega_tardia;