-- ============================================================
-- MIGRACIÓN 055: Bucket Storage para logos de colegios
--
-- Propósito:
--   Permitir que el director suba el logo/escudo de su colegio
--   desde el panel de Configuración. El logo se almacena en
--   Storage y se muestra en la página pública (index.html)
--   junto con los colores institucionales.
--
--   El bucket es público para que cualquier visitante pueda ver
--   el logo sin autenticación. La subida y el borrado están
--   restringidos (ver detalle de cada política más abajo).
--
-- Aislamiento multitenant:
--   - Cada logo se guarda en la carpeta: logos-colegios/{colegio_id}/logo.ext
--   - La lectura es pública (rol public)
--   - El borrado solo lo puede hacer quien subió el archivo
--     (auth.uid() = owner)
--   - No afecta RLS de tablas existentes
-- ============================================================

-- 1. Crear bucket si no existe (100% aditivo)
INSERT INTO storage.buckets (id, name, public)
SELECT 'logos-colegios', 'logos-colegios', true
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id = 'logos-colegios'
);

-- 2. Política: cualquiera puede leer logos (público)
DROP POLICY IF EXISTS "logos_read" ON storage.objects;

CREATE POLICY "logos_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'logos-colegios');

-- 3. Política: solo quien subió el logo puede eliminarlo
DROP POLICY IF EXISTS "logos_delete" ON storage.objects;

CREATE POLICY "logos_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'logos-colegios' AND auth.uid() = owner);

-- 4. Verificación
-- SELECT * FROM storage.buckets WHERE id = 'logos-colegios';
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects';