-- MIGRACIÓN 108 — Dirección propia por colegio (ej: mariscal-sucre.vercel.app).
-- Ajustes de revisión sobre el borrador: candado de superadmin (2c), nombres
-- reservados (2b) y búsqueda que recorta espacios (3).
-- 1) Columna con el nombre de la dirección (solo minúsculas, números y guion)
ALTER TABLE public.colegios ADD COLUMN IF NOT EXISTS subdominio text;

ALTER TABLE public.colegios DROP CONSTRAINT IF EXISTS colegios_subdominio_formato;
ALTER TABLE public.colegios ADD CONSTRAINT colegios_subdominio_formato
  CHECK (subdominio IS NULL OR subdominio ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

-- 2) No puede repetirse entre colegios
CREATE UNIQUE INDEX IF NOT EXISTS colegios_subdominio_uq
  ON public.colegios (subdominio) WHERE subdominio IS NOT NULL;

-- 2b) Nombres que no se pueden usar como dirección de un colegio
ALTER TABLE public.colegios DROP CONSTRAINT IF EXISTS colegios_subdominio_reservado;
ALTER TABLE public.colegios ADD CONSTRAINT colegios_subdominio_reservado
  CHECK (subdominio IS NULL OR subdominio NOT IN
    ('www','admin','api','app','login','mail','correo','soporte','ayuda',
     'panel','dashboard','static','assets','cdn','staging','test'));

-- 2c) Solo el superadmin puede cambiar la dirección de un colegio.
--     La política colegios_write_director deja al director modificar la fila
--     de su propio colegio; sin este candado podría cambiar o borrar su
--     dirección (mismo patrón que proteger_dominio_correo, migración 078).
--     Sin sesión (SQL Editor, service_role) sí se permite, para cargar datos.
CREATE OR REPLACE FUNCTION public.proteger_subdominio_colegio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.subdominio IS DISTINCT FROM OLD.subdominio
     AND auth.uid() IS NOT NULL
     AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar la dirección propia (subdominio) de un colegio';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_subdominio_colegio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_subdominio ON public.colegios;
CREATE TRIGGER trg_proteger_subdominio
  BEFORE UPDATE OF subdominio ON public.colegios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_subdominio_colegio();

-- 3) Búsqueda pública por dirección: devuelve la misma fila que la vista colegios_publico
--    (respeta sus filtros; no cambia la vista)
CREATE OR REPLACE FUNCTION public.colegio_por_subdominio(p text)
RETURNS SETOF public.colegios_publico
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.*
  FROM public.colegios_publico v
  JOIN public.colegios c ON c.id = v.id
  WHERE c.subdominio = lower(btrim(p))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.colegio_por_subdominio(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.colegio_por_subdominio(text) TO anon, authenticated;

COMMENT ON COLUMN public.colegios.subdominio IS
  'Dirección web propia del colegio (ej: mariscal-sucre para mariscal-sucre.<dominio>). NO es dominio_correo, que es solo para los correos. Solo la cambia el superadmin.';

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'colegios' AND column_name = 'subdominio';