-- ============================================================
-- MIGRACIÓN 011: Fix Multitenant — config_gestion
-- Permite que cada colegio tenga su propia gestión por año
-- ============================================================

-- PASO 1: Eliminar constraint única por año (solo permitía un registro por año global)
ALTER TABLE public.config_gestion DROP CONSTRAINT config_gestion_año_key;

-- PASO 2: Nueva constraint única por año + colegio
ALTER TABLE public.config_gestion ADD CONSTRAINT config_gestion_año_colegio_key UNIQUE (año, colegio_id);