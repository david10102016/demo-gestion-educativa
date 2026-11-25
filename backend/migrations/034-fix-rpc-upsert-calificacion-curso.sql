-- ─────────────────────────────────────────────────────────
-- 034 — Corrige rpc_upsert_calificacion: exige curso+materia,
-- no solo materia.
--
-- Hallazgo: la función validaba que el profesor dictara la materia
-- en ALGÚN curso, pero no que la dictara en el curso específico
-- del estudiante calificado. Un profesor con Física asignada en
-- 3°/4° Secundaria pudo insertar una nota real de Física a un
-- estudiante de 1° Secundaria A, donde solo dicta Valores.
--
-- Confirmado con curl usando token real de profesor:
-- antes del fix -> {"ok":true,...} (nota creada fuera de su curso)
-- después del fix -> {"code":"P0001","message":"Profesor no
-- asignado a esta materia para este estudiante"}
-- Verificado también que el caso legítimo (misma materia, curso
-- correcto) sigue funcionando sin cambios.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric DEFAULT NULL::numeric, p_nota_decidir numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_asignado  BOOLEAN;
  v_pesos     RECORD;
  v_cal_id    UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
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

  IF p_nota_ser IS NOT NULL THEN
    SELECT peso_maximo INTO v_pesos FROM public.config_dimensiones
    WHERE codigo = 'ser' AND año = EXTRACT(YEAR FROM NOW())::INT LIMIT 1;
    IF p_nota_ser < 0 OR p_nota_ser > v_pesos.peso_maximo THEN
      RAISE EXCEPTION 'Nota SER fuera de rango';
    END IF;
  END IF;

  IF p_nota_decidir IS NOT NULL THEN
    SELECT peso_maximo INTO v_pesos FROM public.config_dimensiones
    WHERE codigo = 'decidir' AND año = EXTRACT(YEAR FROM NOW())::INT LIMIT 1;
    IF p_nota_decidir < 0 OR p_nota_decidir > v_pesos.peso_maximo THEN
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
$function$