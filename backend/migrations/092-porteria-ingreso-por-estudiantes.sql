CREATE OR REPLACE FUNCTION public.porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[])
RETURNS TABLE (estudiante_id uuid, hora_ingreso timestamptz, estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/La_Paz')::date;
  v_dir boolean := public.es_director();
BEGIN
  IF NOT public.porteria_activa() OR p_estudiante_ids IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (r.estudiante_id) r.estudiante_id, r.hora, r.estado
    FROM public.asistencia_porteria r
    JOIN public.estudiantes e ON e.id = r.estudiante_id
   WHERE r.estudiante_id = ANY (p_estudiante_ids)
     AND r.colegio_id = public.mi_colegio_id()
     AND r.fecha = v_hoy AND r.tipo = 'entrada' AND NOT r.duplicado
     AND (
       v_dir
       OR EXISTS (SELECT 1 FROM public.asignaciones_profesor ap
                   WHERE ap.profesor_id = auth.uid() AND ap.activo AND ap.curso_id = e.curso_id)
       OR EXISTS (SELECT 1 FROM public.inscripciones_tecnicas it
                    JOIN public.asignaciones_profesor ap
                      ON ap.materia_id = it.materia_id AND ap.profesor_id = auth.uid() AND ap.activo
                   WHERE it.estudiante_id = r.estudiante_id AND it.activo)
     )
   ORDER BY r.estudiante_id, r.hora;
END;
$$;

REVOKE ALL ON FUNCTION public.porteria_ingreso_hoy_estudiantes(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.porteria_ingreso_hoy_estudiantes(uuid[]) TO authenticated;