-- ============================================================
-- 114 — Activar RLS en las tablas de respaldo del esquema público
--
-- Problema:
--   Las tablas de respaldo creadas a mano desde el SQL Editor nacieron sin RLS y con
--   los permisos por defecto de Supabase sobre el esquema public:
--     respaldo_calificaciones_t2_20261119   (creada el 19-nov-2026)
--     respaldo_calificaciones_t3_20261119   (creada el 19-nov-2026)
--     respaldo_notas_t3_20261119            (creada el 19-nov-2026)
--     respaldo_calificaciones_t1_20261120   (creada el 20-nov-2026; detectada sin RLS el 20-nov-2026
--                                            con la consulta de verificación de esta migración)
--   Verificado el 20-nov-2026 en producción (pg_class / has_table_privilege) para las tres primeras:
--     rls_activo = false, anon_lee = true, anon_inserta = true, autenticado_actualiza = true.
--   Es decir, cualquiera con la clave pública anon podía leerlas e insertar filas sin iniciar sesión,
--   y cualquier usuario con sesión podía modificarlas. Con sesión de secretaria, regente y tutor se
--   leyeron 180 filas de notas y 30 de calificaciones de estudiantes ajenos a su alcance.
--   Fuera de estas tablas, todas las del esquema public tenían RLS activa.
--
-- Solución:
--   Activar RLS sin políticas y quitar los permisos de anon y authenticated. Con eso ambos roles
--   quedan sin acceso a las filas; postgres y service_role (SQL Editor, Edge Functions) siguen
--   accediendo. No modifica los datos. Nada en el código de la app usa estas tablas.
--
-- Por qué se recorre una lista con to_regclass:
--   Son copias temporales hechas a mano y no están creadas por ninguna migración. Con la
--   comprobación de existencia la migración no falla en una base donde no existan (por ejemplo,
--   un proyecto nuevo) y es idempotente.
--
-- Verificación después de aplicar (debe devolver "Success. No rows returned"):
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
--
-- Revertir (solo si hiciera falta; vuelve a exponerlas), por cada tabla:
--   ALTER TABLE public.<tabla> DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON public.<tabla> TO anon, authenticated;
--
-- Prevención: las tablas creadas desde el SQL Editor nacen sin RLS. Para futuras copias de respaldo,
-- activar RLS en la misma ejecución:
--   create table public.respaldo_xxx as select * from public.<tabla>;
--   alter table public.respaldo_xxx enable row level security;
-- o crearlas en un esquema aparte que la API no exponga.
-- ============================================================
BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'respaldo_calificaciones_t2_20261119',
    'respaldo_calificaciones_t3_20261119',
    'respaldo_notas_t3_20261119',
    'respaldo_calificaciones_t1_20261120'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END
$$;

COMMIT;