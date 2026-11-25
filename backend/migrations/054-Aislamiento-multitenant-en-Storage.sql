-- ============================================================
-- MIGRACIÓN 054: Aislamiento multitenant en Storage de logos
--
-- Propósito:
--   Restringir la subida de logos SOLO a directores y SOLO a
--   la carpeta de su propio colegio.
--
-- Antes: cualquier usuario autenticado podía subir archivos.
-- Después: solo directores, solo a su colegio.
--
-- Seguridad y aislamiento multitenant:
--   - Solo directores pueden subir logos (es_director())
--   - Solo al colegio del director (mi_colegio_id())
--   - Un director de Buena Fe no puede subir logo para Juana Azurduy
--   - No afecta RLS de tablas existentes
-- ============================================================

DROP POLICY IF EXISTS "logos_upload" ON storage.objects;

CREATE POLICY "logos_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'logos-colegios'
  AND public.es_director()
  AND (storage.foldername(name))[1] = public.mi_colegio_id()::text
);

-- Verificación
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'logos_upload';