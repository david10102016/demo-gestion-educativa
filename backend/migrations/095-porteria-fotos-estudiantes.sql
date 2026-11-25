-- 095-porteria-fotos-estudiantes.sql
-- Fotos de estudiantes para credencial QR y escáner de portería.
--   · Bucket PRIVADO 'fotos-estudiantes' (fotos de menores): ruta {colegio_id}/{estudiante_id}/{archivo}.jpg
--     Solo director y regente del colegio suben y ven (enlaces firmados temporales).
--   · estudiantes.foto_url guarda la RUTA del archivo (columna existente desde la 001, sin uso previo).
--   · Nuevas columnas: quién y cuándo subió la foto, y la foto anterior (para restaurar).
--   · Funciones: fotos_curso, estado_foto_estudiante, guardar_foto_estudiante, restaurar_foto_estudiante.
-- Mismo patrón multitenant que las migraciones 054/055 (carpeta = colegio).
-- No toca registros de asistencia ni de portería.
-- Corrección 30/10/2026: foto_subida_por SIN clave foránea (con FK, PostgREST veía dos relaciones
-- estudiantes→usuarios y fallaban las consultas usuarios(...) de todo el sistema).

BEGIN;

-- 1. Bucket privado (límite 500 KB, solo JPEG)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'fotos-estudiantes', 'fotos-estudiantes', false, 512000, ARRAY['image/jpeg']
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'fotos-estudiantes');

-- 2. Políticas de Storage: director o regente, solo la carpeta de su colegio
DROP POLICY IF EXISTS "fotos_est_insert" ON storage.objects;
CREATE POLICY "fotos_est_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'fotos-estudiantes'
  AND (public.es_director() OR public.es_regente())
  AND (storage.foldername(name))[1] = public.mi_colegio_id()::text
);

DROP POLICY IF EXISTS "fotos_est_select" ON storage.objects;
CREATE POLICY "fotos_est_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'fotos-estudiantes'
  AND (public.es_director() OR public.es_regente())
  AND (storage.foldername(name))[1] = public.mi_colegio_id()::text
);

-- Solo se borra el archivo propio recién subido (si se cancela el reemplazo)
DROP POLICY IF EXISTS "fotos_est_delete" ON storage.objects;
CREATE POLICY "fotos_est_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'fotos-estudiantes'
  AND auth.uid() = owner
  AND (storage.foldername(name))[1] = public.mi_colegio_id()::text
);

-- 3. Columnas de control en estudiantes
ALTER TABLE public.estudiantes
  ADD COLUMN IF NOT EXISTS foto_subida_por uuid,   -- sin FK: una 2.ª relación estudiantes→usuarios rompe los embeds de PostgREST
  ADD COLUMN IF NOT EXISTS foto_subida_at  timestamptz,
  ADD COLUMN IF NOT EXISTS foto_anterior   text;

-- 4. Lista de un curso para el modo Fotos (orden alfabético)
CREATE OR REPLACE FUNCTION public.fotos_curso(p_curso_id uuid)
RETURNS TABLE (estudiante_id uuid, nombre_completo text, foto_path text,
               subida_por text, subida_at timestamptz, tiene_anterior boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT (public.es_director() OR public.es_regente()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  RETURN QUERY
  SELECT e.id, u.nombre_completo, e.foto_url, us.nombre_completo, e.foto_subida_at,
         e.foto_anterior IS NOT NULL
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id
    LEFT JOIN public.usuarios us ON us.id = e.foto_subida_por
   WHERE e.curso_id = p_curso_id
     AND e.colegio_id = public.mi_colegio_id()
     AND u.activo = true
   ORDER BY u.nombre_completo;
END;
$$;

-- 5. Estado actual de la foto (se consulta justo antes de guardar)
CREATE OR REPLACE FUNCTION public.estado_foto_estudiante(p_estudiante_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE r record;
BEGIN
  IF NOT (public.es_director() OR public.es_regente()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  SELECT e.foto_url, e.foto_subida_at, us.nombre_completo AS por
    INTO r
    FROM public.estudiantes e
    LEFT JOIN public.usuarios us ON us.id = e.foto_subida_por
   WHERE e.id = p_estudiante_id AND e.colegio_id = public.mi_colegio_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;
  RETURN jsonb_build_object('tiene_foto', r.foto_url IS NOT NULL, 'foto_path', r.foto_url,
                            'subida_por', r.por, 'subida_at', r.foto_subida_at);
END;
$$;

-- 6. Guardar foto. Si ya tenía y no se confirmó el reemplazo, no cambia nada.
--    Al reemplazar, la foto actual pasa a foto_anterior (se puede restaurar).
CREATE OR REPLACE FUNCTION public.guardar_foto_estudiante(
  p_estudiante_id uuid, p_path text, p_reemplazar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_actual  text;
BEGIN
  IF NOT (public.es_director() OR public.es_regente()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF p_path IS NULL OR p_path NOT LIKE v_colegio::text || '/' || p_estudiante_id::text || '/%' THEN
    RAISE EXCEPTION 'Ruta de foto no válida';
  END IF;
  SELECT e.foto_url INTO v_actual
    FROM public.estudiantes e
   WHERE e.id = p_estudiante_id AND e.colegio_id = v_colegio
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;
  IF v_actual IS NOT NULL AND NOT p_reemplazar THEN
    RETURN jsonb_build_object('ok', false, 'requiere_confirmar', true);
  END IF;
  UPDATE public.estudiantes
     SET foto_anterior   = CASE WHEN v_actual IS NOT NULL THEN v_actual ELSE foto_anterior END,
         foto_url        = p_path,
         foto_subida_por = auth.uid(),
         foto_subida_at  = now()
   WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true, 'reemplazo', v_actual IS NOT NULL);
END;
$$;

-- 7. Restaurar la foto anterior (solo director): intercambia actual y anterior
CREATE OR REPLACE FUNCTION public.restaurar_foto_estudiante(p_estudiante_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  UPDATE public.estudiantes
     SET foto_url = foto_anterior, foto_anterior = foto_url,
         foto_subida_por = auth.uid(), foto_subida_at = now()
   WHERE id = p_estudiante_id
     AND colegio_id = public.mi_colegio_id()
     AND foto_anterior IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay foto anterior para restaurar';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fotos_curso(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estado_foto_estudiante(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_foto_estudiante(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurar_foto_estudiante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fotos_curso(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_foto_estudiante(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_foto_estudiante(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_foto_estudiante(uuid) TO authenticated;

COMMIT;