-- ─────────────────────────────────────────────────────────
-- 045 — estudiantes.carnet: UNIQUE global -> UNIQUE por colegio,
-- + blindaje de buscar_estudiante_por_carnet() contra ambigüedad
--
-- Hallazgo 1: estudiantes_carnet_key era UNIQUE(carnet) para todo
-- el sistema, no por colegio. Si dos colegios asignan carnets de
-- forma independiente (números internos, no verificados contra un
-- padrón nacional), es plausible que coincidan por casualidad --
-- el segundo colegio no podría dar de alta a ese estudiante.
-- Verificado con datos reales: hoy no hay colisión activa
-- (SELECT carnet, count(*) ... HAVING count(*) > 1 -> 0 filas),
-- pero el diseño no lo impide a futuro.
--
-- Hallazgo 2 (encontrado al revisar el fix del Hallazgo 1, antes
-- de aplicarlo -- no se explotó, se identificó por lectura de
-- código): buscar_estudiante_por_carnet(), usada por el flujo de
-- vinculación de un tutor a su hijo, busca "WHERE carnet = p_carnet"
-- SIN filtrar por colegio cuando el tutor todavía no tiene colegio
-- asignado (primer hijo a vincular). El frontend (pagos.js,
-- buscarEstudiantePorCarnet) toma directo el primer resultado
-- (data?.[0]), sin verificar si hay más de una coincidencia.
-- Si se relaja el UNIQUE del Hallazgo 1 sin corregir esto, un
-- padre nuevo que busque el carnet de su hijo real podría, ante
-- una coincidencia de carnet con otro colegio, vincularse sin
-- darse cuenta al estudiante equivocado de un colegio ajeno --
-- un problema nuevo, más grave que el original (bloqueo de alta).
--
-- Fix aplicado en un solo script, en orden, para no dejar una
-- ventana donde el Hallazgo 1 esté resuelto y el Hallazgo 2 no:
--
-- 1) Restricción única pasa a ser por colegio.
-- 2) buscar_estudiante_por_carnet(): si el tutor no tiene colegio
--    asignado todavía Y la búsqueda encuentra más de un estudiante
--    con ese carnet (en distintos colegios), la función ahora
--    devuelve un error explícito en vez de elegir uno al azar --
--    obliga a resolver la ambigüedad (ej. pidiendo el nombre del
--    colegio) en vez de fallar en silencio.
--
-- Verificación pendiente (antes de dar por cerrado):
-- 1. Confirmar que sigue sin haber colisión real de carnet.
-- 2. Probar de nuevo el alta de un estudiante con carnet repetido
--    en OTRO colegio (hoy fallaría antes de este fix) -> debe
--    permitir el alta después del fix.
-- 3. Probar buscar_estudiante_por_carnet con un tutor real sin
--    colegio asignado, carnet sin ambigüedad -> debe funcionar
--    exactamente igual que antes (1 solo resultado).
-- 4. (Requiere datos de prueba con carnet duplicado entre colegios)
--    Confirmar que ante 2+ coincidencias, la función ahora
--    devuelve el error de ambigüedad en vez de un resultado.
-- ─────────────────────────────────────────────────────────

-- 1. Restricción única: de global a por colegio
ALTER TABLE public.estudiantes DROP CONSTRAINT IF EXISTS estudiantes_carnet_key;
ALTER TABLE public.estudiantes ADD CONSTRAINT estudiantes_carnet_colegio_key UNIQUE (carnet, colegio_id);

-- 2. Blindaje de buscar_estudiante_por_carnet() contra ambigüedad
CREATE OR REPLACE FUNCTION public.buscar_estudiante_por_carnet(p_carnet text)
RETURNS TABLE(id uuid, carnet text, nombre text, curso text, nivel text, colegio_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_intentos       INT;
  v_colegio_tutor  UUID;
  v_coincidencias  INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  SELECT COUNT(*) INTO v_intentos
  FROM public.intentos_busqueda_carnet
  WHERE tutor_id = auth.uid()
    AND created_at > NOW() - INTERVAL '1 hour';

  IF v_intentos >= 5 THEN
    RAISE EXCEPTION 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
  END IF;

  INSERT INTO public.intentos_busqueda_carnet (tutor_id) VALUES (auth.uid());

  SELECT tf.colegio_id INTO v_colegio_tutor
  FROM public.tutores_familia tf
  WHERE tf.id = auth.uid();

  -- Si el tutor todavía no tiene colegio asignado (primer hijo),
  -- verificar ambigüedad ANTES de devolver nada: si el carnet
  -- existe en más de un colegio, no elegir uno al azar.
  IF v_colegio_tutor IS NULL THEN
    SELECT COUNT(DISTINCT e.colegio_id) INTO v_coincidencias
    FROM public.estudiantes e
    WHERE e.carnet = TRIM(p_carnet);

    IF v_coincidencias > 1 THEN
      RAISE EXCEPTION 'Este carnet existe en más de un colegio. Contacta a la secretaría de tu colegio para vincularte manualmente.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT e.id, e.carnet, u.nombre_completo, c.nombre_completo, c.nivel, e.colegio_id
  FROM public.estudiantes e
  JOIN public.usuarios u ON u.id = e.id
  LEFT JOIN public.cursos c ON c.id = e.curso_id
  WHERE e.carnet = TRIM(p_carnet)
    AND (v_colegio_tutor IS NULL OR e.colegio_id = v_colegio_tutor);
END;
$$;