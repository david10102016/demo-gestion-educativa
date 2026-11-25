-- 123_validar_rango_notas_y_pesos_por_colegio.sql
-- 1) notas: la base valida 0 <= valor <= actividades.max_puntos (trigger), venga de la web, del Excel o de la API.
-- 2) rpc_upsert_calificacion: el máximo de SER/DECIDIR se lee del colegio de quien llama y de su gestión vigente;
--    si no hay configuración, rechaza (antes la comparación con NULL dejaba pasar cualquier valor).
-- Sin cambios de datos ni de políticas. Verificado antes de aplicar: 0 notas fuera de rango.

BEGIN;

-- ─────────────────────────────────────────────────────────
-- 1) Trigger de rango en notas
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_validar_rango_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max numeric;
BEGIN
  SELECT a.max_puntos INTO v_max FROM public.actividades a WHERE a.id = NEW.actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actividad no encontrada' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.valor < 0 OR (v_max IS NOT NULL AND NEW.valor > v_max) THEN
    RAISE EXCEPTION 'Valor % fuera de rango (0 - %)', NEW.valor, v_max USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_validar_rango_nota() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validar_rango_nota ON public.notas;
CREATE TRIGGER validar_rango_nota
  BEFORE INSERT OR UPDATE OF valor, actividad_id ON public.notas
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_rango_nota();

-- ─────────────────────────────────────────────────────────
-- 2) rpc_upsert_calificacion: pesos por colegio y gestión vigente
--    (mismo cuerpo que la versión vigente; solo cambian las dos lecturas de peso)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_upsert_calificacion(
  p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer,
  p_nota_ser numeric DEFAULT NULL::numeric, p_nota_decidir numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_asignado  BOOLEAN;
  v_max       NUMERIC;
  v_cal_id    UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  -- 115: estudiante y materia deben pertenecer al colegio de quien llama
  IF NOT EXISTS (
    SELECT 1
    FROM public.estudiantes e
    JOIN public.materias m ON m.id = p_materia_id
    WHERE e.id = p_estudiante_id
      AND e.colegio_id = public.mi_colegio_id()
      AND m.colegio_id = public.mi_colegio_id()
  ) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor ap
      JOIN public.estudiantes e ON e.curso_id = ap.curso_id
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = p_materia_id
        AND ap.activo = true
        AND e.id = p_estudiante_id
    ) INTO v_asignado;
    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia para este estudiante';
    END IF;
  END IF;

  -- 123: peso del colegio de quien llama y de su gestión vigente
  IF p_nota_ser IS NOT NULL THEN
    SELECT d.peso_maximo INTO v_max FROM public.config_dimensiones d
    WHERE d.colegio_id = public.mi_colegio_id()
      AND d.codigo = 'ser'
      AND d.año = public.año_gestion_vigente()
    LIMIT 1;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'No hay configuración de la dimensión SER para la gestión vigente';
    END IF;
    IF p_nota_ser < 0 OR p_nota_ser > v_max THEN
      RAISE EXCEPTION 'Nota SER fuera de rango';
    END IF;
  END IF;

  IF p_nota_decidir IS NOT NULL THEN
    v_max := NULL;
    SELECT d.peso_maximo INTO v_max FROM public.config_dimensiones d
    WHERE d.colegio_id = public.mi_colegio_id()
      AND d.codigo = 'decidir'
      AND d.año = public.año_gestion_vigente()
    LIMIT 1;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'No hay configuración de la dimensión DECIDIR para la gestión vigente';
    END IF;
    IF p_nota_decidir < 0 OR p_nota_decidir > v_max THEN
      RAISE EXCEPTION 'Nota DECIDIR fuera de rango';
    END IF;
  END IF;

  INSERT INTO public.calificaciones (estudiante_id, materia_id, trimestre, nota_ser, nota_decidir)
  VALUES (p_estudiante_id, p_materia_id, p_trimestre, p_nota_ser, p_nota_decidir)
  ON CONFLICT (estudiante_id, materia_id, trimestre)
  DO UPDATE SET
    nota_ser     = COALESCE(EXCLUDED.nota_ser, calificaciones.nota_ser),
    nota_decidir = COALESCE(EXCLUDED.nota_decidir, calificaciones.nota_decidir),
    updated_at   = NOW()
  RETURNING id INTO v_cal_id;

  RETURN jsonb_build_object('ok', true, 'calificacion_id', v_cal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_upsert_calificacion(uuid, uuid, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_calificacion(uuid, uuid, integer, numeric, numeric) TO authenticated;

COMMIT;