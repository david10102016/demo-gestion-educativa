-- ============================================================
-- MIGRACIÓN 107 — Tutoriales y manuales por rol (contenido global)
--
-- Propósito: guardar los tutoriales que cada usuario ve en la
-- sección "Tutoriales" de su panel. El contenido es único para todos
-- los colegios (sin colegio_id) y lo administra solo el superadmin.
--
-- Acceso:
--   * Lectura : cada usuario ve solo los tutoriales PUBLICADOS de su
--               rol. El superadmin ve todos, incluidos borradores.
--   * Escritura: solo es_superadmin().
--   * anon    : sin acceso.
--
-- Videos: columna "videos" = lista de hasta 5 enlaces https de cualquier
-- plataforma (YouTube, TikTok, Facebook, Instagram, Vimeo, Drive...).
-- Formato: [{"url":"https://...","titulo":"opcional"}]
-- La base solo exige https y estructura; qué plataforma es y cómo se
-- muestra lo decide el visor.
--
-- Ajustes de revision (15-nov-2026):
--   * El enlace de cada video no puede contener comillas, apostrofes, < >,
--     barra invertida ni acento grave (evita inyeccion si el visor lo inserta
--     en HTML sin escapar).
--   * tutoriales_videos_validos() se revoca a PUBLIC/anon, igual que
--     tutoriales_rol_actual().
--   * Permisos de la tabla: se revoca todo a PUBLIC, anon y authenticated y
--     luego se concede solo SELECT/INSERT/UPDATE/DELETE a authenticated
--     (Supabase da TRUNCATE, REFERENCES y TRIGGER por defecto).
--
-- Aditiva: no modifica tablas, políticas RLS ni datos existentes.
-- Reutiliza public.set_updated_at() y public.es_superadmin().
-- Idempotente: se puede ejecutar más de una vez.
-- ============================================================

-- 1. Rol del usuario actual (SECURITY DEFINER; exige activo = true)
CREATE OR REPLACE FUNCTION public.tutoriales_rol_actual()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT u.rol
  FROM public.usuarios u
  WHERE u.id = auth.uid() AND u.activo = true;
$$;

REVOKE EXECUTE ON FUNCTION public.tutoriales_rol_actual() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tutoriales_rol_actual() TO authenticated;

-- 2. Validación de la lista de videos (la usa el CHECK de la tabla)
CREATE OR REPLACE FUNCTION public.tutoriales_videos_validos(v jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' THEN false
    WHEN jsonb_array_length(v) > 5 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) e
      WHERE jsonb_typeof(e) <> 'object'
         OR coalesce(jsonb_typeof(e->'url'), '') <> 'string'
         OR coalesce(e->>'url', '') !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^[:space:]"''<>\\`]*)?$'
         OR char_length(coalesce(e->>'url', '')) > 500
         OR (e->'titulo' IS NOT NULL AND (jsonb_typeof(e->'titulo') <> 'string'
                                          OR char_length(e->>'titulo') > 60))
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.tutoriales_videos_validos(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tutoriales_videos_validos(jsonb) TO authenticated;

-- 3. Tabla
CREATE TABLE IF NOT EXISTS public.tutoriales (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rol         text        NOT NULL,
  titulo      text        NOT NULL,
  aprenderas  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  secciones   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  videos      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  orden       integer     NOT NULL DEFAULT 0,
  publicado   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tutoriales_rol_check
    CHECK (rol IN ('director','profesor','estudiante','tutor','secretaria','regente')),
  CONSTRAINT tutoriales_titulo_check
    CHECK (char_length(btrim(titulo)) BETWEEN 3 AND 200),
  CONSTRAINT tutoriales_aprenderas_check
    CHECK (jsonb_typeof(aprenderas) = 'array' AND jsonb_array_length(aprenderas) <= 20),
  CONSTRAINT tutoriales_secciones_check
    CHECK (jsonb_typeof(secciones) = 'array'
           AND jsonb_array_length(secciones) <= 60
           AND octet_length(secciones::text) <= 262144),
  CONSTRAINT tutoriales_videos_check
    CHECK (public.tutoriales_videos_validos(videos)),
  CONSTRAINT tutoriales_orden_check
    CHECK (orden >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tutoriales_rol_orden
  ON public.tutoriales (rol, orden)
  WHERE publicado = true;

-- 4. Trigger de updated_at (función genérica ya existente)
DROP TRIGGER IF EXISTS set_updated_at_tutoriales ON public.tutoriales;
CREATE TRIGGER set_updated_at_tutoriales
  BEFORE UPDATE ON public.tutoriales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Privilegios y RLS
ALTER TABLE public.tutoriales ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tutoriales FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutoriales TO authenticated;

DROP POLICY IF EXISTS tutoriales_select_rol ON public.tutoriales;
CREATE POLICY tutoriales_select_rol ON public.tutoriales
  FOR SELECT TO authenticated
  USING (publicado = true AND rol = public.tutoriales_rol_actual());

DROP POLICY IF EXISTS tutoriales_select_superadmin ON public.tutoriales;
CREATE POLICY tutoriales_select_superadmin ON public.tutoriales
  FOR SELECT TO authenticated
  USING (public.es_superadmin());

DROP POLICY IF EXISTS tutoriales_insert_superadmin ON public.tutoriales;
CREATE POLICY tutoriales_insert_superadmin ON public.tutoriales
  FOR INSERT TO authenticated
  WITH CHECK (public.es_superadmin());

DROP POLICY IF EXISTS tutoriales_update_superadmin ON public.tutoriales;
CREATE POLICY tutoriales_update_superadmin ON public.tutoriales
  FOR UPDATE TO authenticated
  USING (public.es_superadmin())
  WITH CHECK (public.es_superadmin());

DROP POLICY IF EXISTS tutoriales_delete_superadmin ON public.tutoriales;
CREATE POLICY tutoriales_delete_superadmin ON public.tutoriales
  FOR DELETE TO authenticated
  USING (public.es_superadmin());