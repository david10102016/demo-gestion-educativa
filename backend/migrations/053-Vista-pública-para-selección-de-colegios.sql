-- ============================================================
-- MIGRACIÓN 053: Vista pública para selección de colegios
-- 
-- Propósito:
--   La página pública (index.html) debe mostrar la lista de
--   colegios activos a cualquier visitante SIN necesidad de
--   autenticación (rol anon).
--
--   La tabla 'colegios' tiene políticas RLS que restringen el
--   acceso según el rol del usuario. Para usuarios anónimos,
--   la política 'colegios_select_publico' permite leer colegios
--   activos, pero otras políticas como 'colegios_select_propio'
--   se siguen ejecutando y llaman a funciones que requieren
--   autenticación (ej. mi_colegio_id()), causando error 401.
--
-- Solución:
--   Crear una vista separada que:
--     1. Expone SOLO los campos necesarios para la página pública
--        (id, nombre, sigla, logo_url, color_primario, color_secundario)
--     2. Filtra SOLO colegios activos (activo = true)
--     3. NO usa security_invoker, por lo que NO hereda las
--        políticas RLS de la tabla 'colegios'
--     4. Permite a usuarios anónimos (anon) hacer SELECT sin
--        ejecutar funciones que requieran autenticación
--
-- Alternativa descartada:
--   Usar la tabla 'colegios' directamente con políticas RLS.
--   Descartada porque 'colegios_select_propio' se aplica a anon
--   y ejecuta 'mi_colegio_id()' que necesita auth.uid().
--
-- ============================================================

-- 1. Crear vista (sin security_invoker para ignorar RLS)
CREATE OR REPLACE VIEW public.colegios_publico AS
SELECT 
  id, 
  nombre, 
  sigla, 
  logo_url, 
  color_primario, 
  color_secundario
FROM public.colegios
WHERE activo = true;

-- 2. ¿Por qué GRANT SELECT TO anon?
--    Sin este permiso, la vista solo es visible para el dueño
--    (postgres). Los visitantes anónimos (rol anon) no podrían
--    leerla y la página pública mostraría error 401.
--    Este GRANT permite que cualquier visitante vea la lista
--    de colegios activos sin necesidad de login.
GRANT SELECT ON public.colegios_publico TO anon;

-- 3. Verificación
-- SELECT * FROM public.colegios_publico;
-- Debe devolver los colegios con activo = true.