-- ============================================================
-- MIGRACIÓN 052: Theming multitenant + página pública dinámica
--
-- Agrega columnas de identidad visual a la tabla colegios:
--   color_primario  → color institucional principal (hex)
--   color_secundario → color institucional secundario (hex)
--
-- Ambos son configurables por el director desde su panel.
-- Al login, el frontend lee estos valores y aplica
-- setProperty('--color-primary') en todos los dashboards,
-- garantizando que cada colegio tenga su propia identidad
-- visual sin afectar a los demás (aislamiento multitenant).
--
-- También crea la política colegios_select_publico que permite
-- al rol anon leer colegios activos — necesaria para que la
-- página pública cargue las tarjetas de colegios sin sesión.
-- Solo expone datos no sensibles (nombre, logo, colores).
-- ============================================================

ALTER TABLE public.colegios
ADD COLUMN IF NOT EXISTS color_primario TEXT DEFAULT '#4f46e5';

ALTER TABLE public.colegios
ADD COLUMN IF NOT EXISTS color_secundario TEXT DEFAULT '#ffffff';

CREATE POLICY "colegios_select_publico"
ON public.colegios FOR SELECT
TO anon
USING (activo = true);