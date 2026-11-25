-- ─────────────────────────────────────────────────────────
-- 121 — La vista colegios_publico queda de solo lectura
--
-- Problema (detectado el 24-nov-2026 al revisar el volcado de estructura
-- de producción, pg_dump --schema-only):
--   La vista public.colegios_publico (migración 053) se creó sin
--   security_invoker a propósito, para que la página pública lea los
--   colegios activos sin pasar por el RLS de 'colegios'. La 053 solo dio
--   GRANT SELECT a anon, pero los privilegios por defecto de Supabase en el
--   esquema public le dieron GRANT ALL a anon y authenticated.
--   Una vista simple acepta INSERT/UPDATE/DELETE, y esa escritura se
--   ejecuta con los permisos del dueño de la vista, que no pasa por el RLS
--   de 'colegios'. Resultado: cualquiera con la clave pública (anon, sin
--   iniciar sesión) podía modificar nombre, sigla, logo y colores de los
--   colegios activos, y borrarlos, a través de la vista.
--
-- Evidencia (producción, 24-nov-2026, 00:47, con rollback, sin cambios):
--   set local role anon; update colegios_publico set nombre = nombre
--   returning id;  -> 4 filas (los 4 colegios activos).
--   Reproducido antes en PostgreSQL 16 local con la misma configuración.
--
-- Corrección: quitar la escritura de la vista a anon y authenticated.
--   La lectura queda igual (SELECT), así que la página pública, la
--   búsqueda por enlace (index.html) y colegio_por_subdominio (108)
--   siguen funcionando. service_role no cambia.
--   No toca datos. Idempotente.
--
-- Reversión (no recomendada): GRANT ALL ON public.colegios_publico TO anon, authenticated;
-- ─────────────────────────────────────────────────────────

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.colegios_publico FROM anon, authenticated;

GRANT SELECT ON public.colegios_publico TO anon, authenticated;

COMMIT;

-- Verificación 1 (permisos): anon y authenticated solo con SELECT
-- select grantee, string_agg(privilege_type, ', ' order by privilege_type) as permisos
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'colegios_publico'
-- group by grantee order by grantee;
--
-- Verificación 2 (no cambia nada: debe dar error de permisos en el update):
-- begin;
-- set local role anon;
-- select count(*) as visibles from public.colegios_publico;
-- update public.colegios_publico set nombre = nombre returning id;
-- rollback;