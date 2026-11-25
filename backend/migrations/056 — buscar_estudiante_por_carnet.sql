-- ─────────────────────────────────────────────────────────
-- 056 — buscar_estudiante_por_carnet(): filtrar siempre por
-- colegio, recibido como parámetro explícito.
--
-- Hallazgo: cuando el tutor todavía no tiene colegio_id asignado
-- (caso normal antes de vincular a su primer hijo), la función
-- no filtraba por colegio en absoluto -- solo bloqueaba si el
-- carnet coincidía en más de un colegio (migración 045). Si el
-- carnet era único en el sistema, un tutor registrado en un
-- colegio podía encontrar (y vincularse a) un estudiante de
-- OTRO colegio.
--
-- Fix: la función ahora recibe p_colegio_id -- el colegio que el
-- tutor ya eligió en la pantalla pública antes de registrarse --
-- y filtra siempre por él. No se persiste en ningún lado ni se
-- usa para decidir el colegio_id real del tutor (eso lo sigue
-- haciendo únicamente vincular_hijo_seguro, sin cambios). Con el
-- filtro siempre activo, la restricción UNIQUE(carnet, colegio_id)
-- de la migración 045 garantiza como máximo 1 resultado, así que
-- el chequeo de ambigüedad ya no es necesario y se retira.
-- ─────────────────────────────────────────────────────────

-- IMPORTANTE: la función vieja tiene una firma distinta (1 parámetro
-- en vez de 2). CREATE OR REPLACE no la sobreescribe -- en Postgres,
-- una función se identifica por nombre + tipos de parámetros, así que
-- dejaría la versión vieja (sin filtro de colegio) activa y llamable
-- al lado de la nueva. Hay que borrarla explícitamente.
DROP FUNCTION IF EXISTS public.buscar_estudiante_por_carnet(text);

CREATE OR REPLACE FUNCTION public.buscar_estudiante_por_carnet(
  p_carnet text,
  p_colegio_id uuid
)
RETURNS TABLE(id uuid, carnet text, nombre text, curso text, nivel text, colegio_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_intentos INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  IF p_colegio_id IS NULL THEN
    RAISE EXCEPTION 'Falta el colegio para realizar la búsqueda';
  END IF;

  SELECT COUNT(*) INTO v_intentos
  FROM public.intentos_busqueda_carnet
  WHERE tutor_id = auth.uid()
    AND created_at > NOW() - INTERVAL '1 hour';

  IF v_intentos >= 5 THEN
    RAISE EXCEPTION 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
  END IF;

  INSERT INTO public.intentos_busqueda_carnet (tutor_id) VALUES (auth.uid());

  RETURN QUERY
  SELECT e.id, e.carnet, u.nombre_completo, c.nombre_completo, c.nivel, e.colegio_id
  FROM public.estudiantes e
  JOIN public.usuarios u ON u.id = e.id
  LEFT JOIN public.cursos c ON c.id = e.curso_id
  WHERE e.carnet = TRIM(p_carnet)
    AND e.colegio_id = p_colegio_id;
END;
$$;