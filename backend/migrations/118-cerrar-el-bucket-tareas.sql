-- ============================================================
-- 118 — Cerrar el bucket "tareas" de Supabase Storage
--
-- Situación (verificada en producción el 23-nov-2026):
--   - El bucket "tareas" es privado desde la migración 083 (las entregas de los estudiantes van a
--     Cloudinary). Tiene 17 archivos: 16 consignas de profesores y 1 antiguo.
--   - El profesor seguía subiendo ahí la consigna de cada actividad y guardaba una dirección
--     PÚBLICA (getPublicUrl). Con el bucket privado esa dirección responde "Bucket not found":
--     las consignas de 5 actividades no se podían abrir.
--   - La política storage_read_all permitía a CUALQUIER usuario con sesión, de cualquier colegio,
--     leer los archivos del bucket por la API.
--   - storage_estudiante_upload / storage_estudiante_delete permitían subir y borrar en el bucket
--     (flujo antiguo, ya no se usa).
--
-- Solución:
--   El front sube las consignas a Cloudinary (profesor.js, 23-nov-2026), igual que las entregas.
--   Aquí se quitan las tres políticas del bucket "tareas". Las tres están limitadas a
--   bucket_id = 'tareas' (verificado): no afectan a logos-colegios, fotos-estudiantes ni
--   documentos-tutores. El bucket queda cerrado para anon y authenticated; los archivos NO se borran
--   (siguen accesibles desde el panel de Supabase).
--
-- Comprobado antes de aplicar (producción, 23-nov-2026):
--   - En todo el front y en las Edge Functions, solo profesor.js usaba el bucket "tareas".
--   - Ningún dato apunta al bucket salvo 5 consignas antiguas (actividades = 5, entregas = 0);
--     esos enlaces ya no abrían y los profesores vuelven a adjuntar el archivo.
--   - Origen de las políticas: antes de mayo de 2026 las entregas de los estudiantes se subían a
--     este bucket; al pasar a Cloudinary (26-may) y volverlo privado (083) quedaron sin uso.
--
-- Orden: aplicar DESPUÉS de desplegar el cambio de profesor.js. Antes, el profesor no podría
--   adjuntar consignas.
--
-- Verificación después de aplicar (debe devolver 0 filas):
--   select policyname from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and qual ilike '%''tareas''%'
--      or (schemaname = 'storage' and tablename = 'objects' and with_check ilike '%''tareas''%');
--
-- Revertir (reabre el acceso de cualquier usuario con sesión):
--   create policy storage_read_all on storage.objects for select to authenticated
--     using (bucket_id = 'tareas');
-- ============================================================
BEGIN;

DROP POLICY IF EXISTS storage_read_all          ON storage.objects;
DROP POLICY IF EXISTS storage_estudiante_upload ON storage.objects;
DROP POLICY IF EXISTS storage_estudiante_delete ON storage.objects;

COMMIT;