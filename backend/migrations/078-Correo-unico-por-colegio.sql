-- ============================================================
-- MIGRACIÓN 078: Correo único por colegio + generador en el servidor
--
-- PROBLEMA
--   El correo de acceso es único en TODO Supabase Auth, pero el panel
--   del director lo genera mirando solo los usuarios de SU colegio
--   (la RLS no le deja ver los demás) y probando hasta 30 sufijos
--   desde el navegador. Con varios colegios, el mismo nombre local
--   (ej. "asam.prof") choca entre colegios y contra cuentas de Auth
--   que no tienen perfil en public.usuarios (hoy hay 12).
--   Además, public.usuarios solo tiene la clave primaria: nada
--   impide guardar dos veces el mismo correo.
--
-- SOLUCIÓN
--   1. Cada colegio tiene su propio dominio de correo
--      (colegios.dominio_correo). Los correos nuevos quedan como
--      <iniciales>@<dominio>.educativa.com
--      Ej.: asam.prof@jap.educativa.com
--      El superadmin escribe el dominio al crear el colegio, sin
--      depender del nombre ni de la sigla, y solo él puede cambiarlo.
--   2. El siguiente correo libre lo calcula el servidor, mirando
--      public.usuarios Y auth.users (así las cuentas de Auth sin
--      perfil también cuentan).
--   3. Índice único sobre lower(usuarios.email): garantía real en la
--      base y búsqueda por índice.
--
-- QUÉ NO HACE
--   - No modifica, renombra ni borra usuarios ni cuentas existentes.
--   - Los correos actuales (@educativa.com, @educativo.com, escritos a
--     mano) siguen siendo válidos y siguen iniciando sesión igual.
--   - Solo afecta a los correos que se generen DESPUÉS, cuando el
--     front (director.js) y la función crear-estudiantes-masivo
--     empiecen a usar las funciones nuevas.
--
-- ORDEN DE DESPLIEGUE
--   1) Ejecutar esta migración.  2) Subir superadmin.js y
--   dashboard-superadmin.html (piden la columna dominio_correo).
--
-- VERIFICADO ANTES DE ESCRIBIRLA
--   - 0 correos repetidos en public.usuarios (sin distinguir mayúsculas).
--   - Los 4 colegios reales dan un dominio válido y distinto.
--
-- Es transaccional: si algo falla, no queda nada a medias.
-- Se puede volver a ejecutar sin error.
-- ============================================================

BEGIN;

-- ── 1. Dominio de correo por colegio ─────────────────────────
ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS dominio_correo text;

-- Se quita el trigger de protección (si existe) para que el relleno
-- corra sin sesión de usuario; se vuelve a crear más abajo.
DROP TRIGGER IF EXISTS trg_proteger_dominio_correo ON public.colegios;

-- Relleno único para los colegios que YA existen: iniciales de la
-- sigla, sin puntos ni símbolos y en minúsculas (U.E.B.F -> uebf).
-- La plantilla no lleva dominio: nadie inicia sesión con ella.
-- Los colegios nuevos NO usan esto: el superadmin escribe su dominio
-- al crearlos.
UPDATE public.colegios
SET dominio_correo = lower(regexp_replace(sigla, '[^a-zA-Z0-9]', '', 'g'))
WHERE dominio_correo IS NULL
  AND COALESCE(es_plantilla, false) = false
  AND regexp_replace(COALESCE(sigla, ''), '[^a-zA-Z0-9]', '', 'g') <> '';

-- Formato permitido: minúsculas, números y guion (sin puntos ni
-- espacios); hasta 32 caracteres.
ALTER TABLE public.colegios
  DROP CONSTRAINT IF EXISTS colegios_dominio_correo_formato;
ALTER TABLE public.colegios
  ADD CONSTRAINT colegios_dominio_correo_formato
  CHECK (dominio_correo IS NULL OR dominio_correo ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$');

-- Un dominio no puede repetirse entre colegios. Si dos siglas dieran
-- el mismo dominio, este índice falla y toda la migración se revierte.
CREATE UNIQUE INDEX IF NOT EXISTS colegios_dominio_correo_key
  ON public.colegios (dominio_correo)
  WHERE dominio_correo IS NOT NULL;

COMMENT ON COLUMN public.colegios.dominio_correo IS
  'Subdominio de los correos nuevos del colegio: <iniciales>@<dominio_correo>.educativa.com. Lo escribe el superadmin al crear el colegio y solo él puede cambiarlo.';

-- Solo el superadmin puede cambiar el dominio (mismo patrón que
-- proteger_plan_colegio, migración 058). Se crea DESPUÉS del relleno.
CREATE OR REPLACE FUNCTION public.proteger_dominio_correo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.dominio_correo IS DISTINCT FROM OLD.dominio_correo
     AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar el dominio de correo de un colegio';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proteger_dominio_correo
  BEFORE UPDATE ON public.colegios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_dominio_correo();

-- ── 2. Garantía de unicidad en la base ───────────────────────
-- Antes solo existía la clave primaria: ni unicidad ni índice para
-- buscar por correo. Verificado: 0 correos repetidos.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_key
  ON public.usuarios (lower(email));

-- ── 3. Generador en el servidor ──────────────────────────────
-- Núcleo interno (no se llama desde el front): toma las iniciales de
-- todas las palabras del nombre, sin tildes, y busca el primer número
-- libre. Cada intento es una búsqueda por índice en usuarios y en
-- auth.users (Auth guarda el correo en minúsculas).
CREATE OR REPLACE FUNCTION public._siguiente_email_libre(
  p_colegio_id uuid, p_nombre text, p_marca text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_dom    text;
  v_partes text[];
  v_p      text;
  v_ini    text := '';
  v_n      int  := 1;
  v_cand   text;
BEGIN
  SELECT dominio_correo INTO v_dom FROM public.colegios WHERE id = p_colegio_id;
  IF v_dom IS NULL THEN
    RAISE EXCEPTION 'El colegio no tiene dominio de correo configurado. Pide al superadmin que lo configure.';
  END IF;

  v_partes := regexp_split_to_array(
    trim(lower(translate(COALESCE(p_nombre, ''),
      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'))),
    '\s+');
  FOREACH v_p IN ARRAY v_partes LOOP
    IF left(v_p, 1) ~ '[a-z]' THEN v_ini := v_ini || left(v_p, 1); END IF;
  END LOOP;
  IF v_ini = '' THEN RETURN NULL; END IF;

  LOOP
    v_cand := v_ini || p_marca
              || CASE WHEN v_n = 1 THEN '' ELSE v_n::text END
              || '@' || v_dom || '.educativa.com';
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = v_cand)
          AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_cand);
    v_n := v_n + 1;
    IF v_n > 1000 THEN
      RAISE EXCEPTION 'No se pudo generar un correo libre para este nombre';
    END IF;
  END LOOP;

  RETURN v_cand;
END;
$$;

REVOKE ALL ON FUNCTION public._siguiente_email_libre(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- Panel del director: correo sugerido para un profesor de SU colegio
-- (el colegio sale de la sesión, no se puede pedir el de otro).
CREATE OR REPLACE FUNCTION public.generar_email_profesor(p_nombre text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  RETURN public._siguiente_email_libre(public.mi_colegio_id(), p_nombre, '.prof');
END;
$$;

REVOKE ALL ON FUNCTION public.generar_email_profesor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generar_email_profesor(text) TO authenticated;

-- Alta de estudiantes: la usa la edge function crear-estudiantes-masivo
-- (service_role) para obtener el correo libre de un estudiante del
-- colegio indicado. Reemplaza el sufijo con los 4 últimos dígitos del
-- carnet por un número consecutivo (abc, abc2, abc3...).
CREATE OR REPLACE FUNCTION public.generar_email_estudiante(p_colegio_id uuid, p_nombre text)
RETURNS text LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT public._siguiente_email_libre(p_colegio_id, p_nombre, '');
$$;

REVOKE ALL ON FUNCTION public.generar_email_estudiante(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generar_email_estudiante(uuid, text) TO service_role;

COMMIT;

-- ============================================================
-- VERIFICACIÓN después de aplicar
--
-- 1. Dominios de los colegios:
--    SELECT nombre, sigla, dominio_correo FROM public.colegios ORDER BY nombre;
--    -> los 4 colegios reales con dominio (uepg2, uepms, uebf, uethjap);
--       la plantilla BASE en NULL.
--
-- 2. Índices nuevos:
--    SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('usuarios','colegios')
--      AND indexname IN ('usuarios_email_lower_key','colegios_dominio_correo_key');
--    -> deben salir los 2.
--
-- 3. Con sesión de director (desde el panel, en el siguiente paso):
--    generar_email_profesor('Nombre de prueba') devuelve un correo con
--    el dominio de SU colegio y nunca uno ya usado.
-- ============================================================