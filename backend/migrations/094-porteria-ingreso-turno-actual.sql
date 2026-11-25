-- 094-porteria-ingreso-turno-actual.sql
-- Profesor: la hora de ingreso junto a cada estudiante es la del TURNO ACTUAL
-- (antes: la primera entrada del día). Turno actual = misma regla del escáner
-- (horario del nivel o excepción del grado, 093). Fuera de toda ventana: la última entrada del día.
-- Reemplaza solo porteria_ingreso_hoy_estudiantes (misma firma y columnas). Sin cambios de frontend.

CREATE OR REPLACE FUNCTION public.porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[])
RETURNS TABLE (estudiante_id uuid, hora_ingreso timestamptz, estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_ahora   timestamp := now() AT TIME ZONE 'America/La_Paz';
  v_hoy     date := v_ahora::date;
  v_t       time := v_ahora::time;
  v_colegio uuid := public.mi_colegio_id();
  v_dir     boolean := public.es_director();
BEGIN
  IF NOT public.porteria_activa() OR p_estudiante_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH est AS (
    SELECT e.id, c.nivel, c.grado
      FROM public.estudiantes e
      LEFT JOIN public.cursos c ON c.id = e.curso_id
     WHERE e.id = ANY (p_estudiante_ids)
       AND e.colegio_id = v_colegio
       AND (
         v_dir
         OR EXISTS (SELECT 1 FROM public.asignaciones_profesor ap
                     WHERE ap.profesor_id = auth.uid() AND ap.activo AND ap.curso_id = e.curso_id)
         OR EXISTS (SELECT 1 FROM public.inscripciones_tecnicas it
                      JOIN public.asignaciones_profesor ap
                        ON ap.materia_id = it.materia_id AND ap.profesor_id = auth.uid() AND ap.activo
                     WHERE it.estudiante_id = e.id AND it.activo)
       )
  ),
  turno_actual AS (
    SELECT est.id,
           (SELECT h.turno
              FROM (
                SELECT g.turno, g.hora_entrada, g.hora_salida
                  FROM public.porteria_horarios_grado g
                 WHERE g.colegio_id = v_colegio AND g.nivel = est.nivel AND g.grado = est.grado AND g.activo
                UNION ALL
                SELECT n.turno, n.hora_entrada, n.hora_salida
                  FROM public.porteria_horarios n
                 WHERE n.colegio_id = v_colegio AND n.nivel = est.nivel AND n.activo
                   AND NOT EXISTS (SELECT 1 FROM public.porteria_horarios_grado g2
                                    WHERE g2.colegio_id = v_colegio AND g2.nivel = est.nivel
                                      AND g2.grado = est.grado AND g2.turno = n.turno AND g2.activo)
              ) h
             WHERE v_t >= h.hora_entrada - interval '90 minutes'
               AND v_t <= h.hora_salida  + interval '90 minutes'
             ORDER BY h.hora_entrada DESC
             LIMIT 1) AS turno
      FROM est
  )
  SELECT ta.id, x.hora, x.estado
    FROM turno_actual ta
    CROSS JOIN LATERAL (
      SELECT r.hora, r.estado
        FROM public.asistencia_porteria r
       WHERE r.estudiante_id = ta.id
         AND r.colegio_id = v_colegio
         AND r.fecha = v_hoy AND r.tipo = 'entrada' AND NOT r.duplicado
         AND (ta.turno IS NULL OR r.turno = ta.turno)
       ORDER BY CASE WHEN ta.turno IS NULL THEN r.hora END DESC,
                r.hora ASC
       LIMIT 1
    ) x;
END;
$$;