-- ============================================================
-- MIGRACIÓN 071 — Fix: trigger set_updated_at faltante en
-- bitacora_docente
--
-- Hallazgo: bitacora_docente (migración 070, ya aplicada y en uso
-- real en Buena Fe) se creó sin enganchar el trigger genérico
-- public.set_updated_at() que ya usan otras 6 tablas del sistema
-- (calificaciones, colegios, config_mensualidad, pagos_mensualidad,
-- tutores_familia, usuarios). Consecuencia: la columna updated_at
-- de bitacora_docente nunca se actualiza en un UPDATE -- queda fija
-- en el valor del INSERT original para siempre. No afecta el uso
-- diario ni bloquea nada; el impacto es de trazabilidad: hoy no hay
-- forma de distinguir por timestamp una fila recién creada de una
-- sobrescrita.
--
-- Verificado en vivo antes de aplicar:
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.bitacora_docente'::regclass;
-- -> solo devolvió los RI_ConstraintTrigger_* automáticos de las
-- FOREIGN KEY y trg_proteger_bitacora_columnas_director (058/070).
-- Ningún trigger llamado set_updated_at_bitacora_docente existía.
--
-- Fix: enganchar la función genérica ya existente, sin crear nada
-- nuevo. Puramente aditivo -- no toca RLS, no toca aislamiento por
-- colegio (mi_colegio_id()), no cambia ningún valor que el frontend
-- lea o compare hoy.
-- ============================================================

CREATE TRIGGER set_updated_at_bitacora_docente
  BEFORE UPDATE ON public.bitacora_docente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.bitacora_docente'::regclass;
--    -> debe incluir ahora set_updated_at_bitacora_docente.
--
-- 2. UPDATE public.bitacora_docente SET observacion_director = 'prueba'
--    WHERE id = '<cualquier id existente>';
--    SELECT created_at, updated_at FROM public.bitacora_docente WHERE id = '<mismo id>';
--    -> updated_at debe quedar posterior a created_at (antes quedaban idénticos).
-- ─────────────────────────────────────────────────────────