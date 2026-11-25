-- ============================================================
-- 113 — Proteger el rol superadmin en usuarios (cierra la escalada de director a superadmin)
--
-- Problema:
--   La política usuarios_update_director permite a un director actualizar usuarios de su colegio
--   y no tiene WITH CHECK. La tabla usuarios solo tenía el trigger set_updated_at_usuarios, así que
--   nada protegía la columna rol. Un director podía, llamando a la API con su sesión, ejecutar
--   UPDATE usuarios SET rol = 'superadmin' sobre su propia fila. Desde ese momento es_superadmin()
--   devolvía true y veía todos los colegios (también pasaba por las funciones que dejan pasar
--   al superadmin sin restricción, como promover_estudiante y marcar_egresado).
--
-- Evidencia (20-nov-2026, producción, prueba con rollback forzado):
--   Director de Buena Fe:           filas_actualizadas=1, es_superadmin=t, colegios visibles 1 -> 5
--   Director de Juana Azurduy:      filas_actualizadas=1, es_superadmin=t, colegios visibles 1 -> 5
--   La app no tiene ese flujo: desde el navegador solo se cambian nombre, telefono y activo.
--   Al momento de la prueba existía un único superadmin (superadmin@sistema.bo).
--
-- Solución:
--   Trigger BEFORE INSERT OR UPDATE OF rol sobre public.usuarios. Si hay una sesión de usuario
--   (auth.uid() no es nulo) y quien llama no es superadmin, rechaza (error 42501):
--     - insertar un usuario con rol 'superadmin'
--     - cambiar un rol hacia 'superadmin' o desde 'superadmin'
--
-- Qué NO cambia:
--   - El director sigue pudiendo editar nombre, teléfono, estado activo y roles distintos de superadmin
--     en su colegio, igual que hoy.
--   - Sin sesión de usuario (auth.uid() nulo) todo sigue permitido: service_role de las Edge Functions
--     de creación masiva, reset de contraseña y SQL Editor.
--   - handle_new_user sigue creando perfiles con rol 'tutor'.
--   - No modifica políticas RLS ni datos existentes.
--
-- Idempotente: create or replace function + drop trigger if exists.
--
-- Verificación después de aplicar:
--   Repetir la prueba de escalada con un director (UPDATE usuarios SET rol='superadmin' dentro de un
--   bloque DO con RAISE EXCEPTION final). Debe fallar con:
--   "No autorizado: solo un superadmin puede asignar o quitar el rol superadmin."
--
-- Revertir (solo si hiciera falta; reabre la brecha):
--   DROP TRIGGER IF EXISTS proteger_rol_superadmin ON public.usuarios;
--   DROP FUNCTION IF EXISTS public.proteger_rol_superadmin();
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.proteger_rol_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.es_superadmin()
     AND (
          (TG_OP = 'INSERT' AND NEW.rol = 'superadmin')
       OR (TG_OP = 'UPDATE' AND ((NEW.rol = 'superadmin') IS DISTINCT FROM (OLD.rol = 'superadmin')))
     ) THEN
    RAISE EXCEPTION 'No autorizado: solo un superadmin puede asignar o quitar el rol superadmin.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.proteger_rol_superadmin() IS
  'Impide que un usuario que no es superadmin asigne o quite el rol superadmin (migración 113).';

DROP TRIGGER IF EXISTS proteger_rol_superadmin ON public.usuarios;
CREATE TRIGGER proteger_rol_superadmin
  BEFORE INSERT OR UPDATE OF rol ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_rol_superadmin();

COMMIT;