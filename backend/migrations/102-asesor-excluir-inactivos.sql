-- =====================================================================
-- 102 · Asesor de curso: excluir estudiantes inactivos (usuarios.activo = false)
-- Los retirados se inactivan con usuarios.activo = false; estas 3 funciones solo
-- filtraban estudiantes.estado = 'activo', por eso el asesor seguía viéndolos.
-- Cambio único en cada función: + filtro usuarios.activo = true. Resto idéntico.
-- No modifica datos. Mismo nombre, parámetros y retorno (CREATE OR REPLACE).
-- =====================================================================
begin;

CREATE OR REPLACE FUNCTION public.asesor_notas_curso(p_curso_id uuid)
 RETURNS TABLE(estudiante_id uuid, estudiante text, carnet text, materia_id uuid, materia text, trimestre integer, nota_final numeric, hacer_estado text, saber_estado text, ser_estado text, decidir_estado text, puntos_posibles numeric, nota_hacer numeric, nota_saber numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_año   integer;
  v_nivel text;
  v_grado integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN;
  END IF;

  v_año := public.año_gestion_vigente();

  SELECT c.nivel, COALESCE(NULLIF(regexp_replace(c.grado::text, '\D', '', 'g'), '')::int, 0)
    INTO v_nivel, v_grado
  FROM public.cursos c
  WHERE c.id = p_curso_id AND c.colegio_id = public.mi_colegio_id();

  RETURN QUERY
  WITH dims AS (
    SELECT
      MAX(CASE WHEN d.codigo = 'hacer'   THEN d.peso_maximo ELSE 0 END) AS peso_hacer,
      MAX(CASE WHEN d.codigo = 'saber'   THEN d.peso_maximo ELSE 0 END) AS peso_saber,
      MAX(CASE WHEN d.codigo = 'ser'     THEN d.peso_maximo ELSE 0 END) AS peso_ser,
      MAX(CASE WHEN d.codigo = 'decidir' THEN d.peso_maximo ELSE 0 END) AS peso_decidir
    FROM public.config_dimensiones d
    JOIN public.config_gestion g ON g.id = d.gestion_id
    WHERE g.año = v_año
      AND g.colegio_id = public.mi_colegio_id()
      AND d.activo = true
  ),
  base AS (
    SELECT nf.estudiante_id, nf.estudiante::text AS estudiante, nf.carnet::text AS carnet,
           nf.materia_id, nf.materia::text AS materia,
           nf.trimestre::integer AS trimestre, nf.nota_final::numeric AS nota_final,
           nf.promedio_hacer::numeric AS nota_hacer, nf.promedio_saber::numeric AS nota_saber
    FROM public.notas_finales nf
    WHERE nf.curso_id = p_curso_id
      AND nf.colegio_id = public.mi_colegio_id()
      AND EXISTS (SELECT 1 FROM public.estudiantes es JOIN public.usuarios us ON us.id = es.id
                  WHERE es.id = nf.estudiante_id AND es.estado = 'activo' AND us.activo = true)
      AND (
        NOT EXISTS (SELECT 1 FROM public.materias mt
                    WHERE mt.id = nf.materia_id AND mt.es_tecnica IS TRUE)
        OR (
          v_nivel = 'Secundaria' AND v_grado >= 4
          AND EXISTS (
            SELECT 1
            FROM public.inscripciones_tecnicas it
            JOIN public.materias mt ON mt.id = it.materia_id
            WHERE it.estudiante_id = nf.estudiante_id
              AND it.materia_id    = nf.materia_id
              AND it.activo = true
              AND v_grado >= COALESCE(NULLIF(
                    NULLIF(regexp_replace(COALESCE(mt.aplica_desde, '4'), '\D', '', 'g'), '')::int,
                    0), 4)
          )
        )
      )
  ),
  marcas AS (
    SELECT n.estudiante_id, a.materia_id, a.trimestre, a.tipo
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id
    JOIN public.materias mt ON mt.id = a.materia_id
    WHERE a.tipo IN ('hacer', 'saber')
      AND (
        (mt.es_tecnica IS NOT TRUE AND a.curso_id = p_curso_id)
        OR
        (mt.es_tecnica IS TRUE
         AND EXISTS (
           SELECT 1 FROM public.estudiantes es
           WHERE es.id = n.estudiante_id
             AND es.curso_id = p_curso_id
             AND es.estado = 'activo'
         )
         AND EXISTS (
           SELECT 1 FROM public.inscripciones_tecnicas it
           WHERE it.estudiante_id = n.estudiante_id
             AND it.materia_id    = a.materia_id
             AND it.activo = true
         ))
      )
    GROUP BY n.estudiante_id, a.materia_id, a.trimestre, a.tipo
  ),
  cal AS (
    SELECT c.estudiante_id, c.materia_id, c.trimestre,
           bool_or(c.nota_ser IS NOT NULL)     AS ser_ok,
           bool_or(c.nota_decidir IS NOT NULL) AS decidir_ok
    FROM public.calificaciones c
    WHERE c.estudiante_id IN (SELECT es.id FROM public.estudiantes es WHERE es.curso_id = p_curso_id)
    GROUP BY c.estudiante_id, c.materia_id, c.trimestre
  ),
  marcado AS (
    SELECT b.*,
      CASE WHEN mh.estudiante_id IS NOT NULL THEN 'calificada' ELSE 'pendiente' END AS hacer_estado,
      CASE WHEN ms.estudiante_id IS NOT NULL THEN 'calificada' ELSE 'pendiente' END AS saber_estado,
      CASE WHEN COALESCE(c.ser_ok, false)     THEN 'calificada' ELSE 'pendiente' END AS ser_estado,
      CASE WHEN COALESCE(c.decidir_ok, false) THEN 'calificada' ELSE 'pendiente' END AS decidir_estado
    FROM base b
    LEFT JOIN marcas mh ON mh.estudiante_id = b.estudiante_id AND mh.materia_id = b.materia_id
                       AND mh.trimestre = b.trimestre AND mh.tipo = 'hacer'
    LEFT JOIN marcas ms ON ms.estudiante_id = b.estudiante_id AND ms.materia_id = b.materia_id
                       AND ms.trimestre = b.trimestre AND ms.tipo = 'saber'
    LEFT JOIN cal c     ON c.estudiante_id  = b.estudiante_id AND c.materia_id  = b.materia_id
                       AND c.trimestre  = b.trimestre
  )
  SELECT
    m.estudiante_id, m.estudiante, m.carnet, m.materia_id, m.materia, m.trimestre, m.nota_final,
    m.hacer_estado, m.saber_estado, m.ser_estado, m.decidir_estado,
    (
      CASE WHEN m.hacer_estado   = 'pendiente' THEN COALESCE(d.peso_hacer, 0)   ELSE 0 END +
      CASE WHEN m.saber_estado   = 'pendiente' THEN COALESCE(d.peso_saber, 0)   ELSE 0 END +
      CASE WHEN m.ser_estado     = 'pendiente' THEN COALESCE(d.peso_ser, 0)     ELSE 0 END +
      CASE WHEN m.decidir_estado = 'pendiente' THEN COALESCE(d.peso_decidir, 0) ELSE 0 END
    )::numeric AS puntos_posibles,
    m.nota_hacer, m.nota_saber
  FROM marcado m
  CROSS JOIN dims d
  ORDER BY m.estudiante, m.estudiante_id, m.materia_id, m.trimestre;
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_datos_libreta(p_curso_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_nivel  text;
  v_grado  integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT c.nivel, COALESCE(NULLIF(regexp_replace(c.grado::text, '\D', '', 'g'), '')::int, 0)
    INTO v_nivel, v_grado
  FROM public.cursos c
  WHERE c.id = p_curso_id AND c.colegio_id = public.mi_colegio_id();

  SELECT jsonb_build_object(
    'curso', (
      SELECT jsonb_build_object(
        'id', c.id,
        'nombre_completo', c.nombre_completo,
        'nivel', c.nivel,
        'grado', c.grado
      )
      FROM public.cursos c
      WHERE c.id = p_curso_id AND c.colegio_id = public.mi_colegio_id()
    ),
    'colegio', (
      SELECT jsonb_build_object(
        'nombre', col.nombre,
        'director_nombre', col.director_nombre
      )
      FROM public.colegios col
      WHERE col.id = public.mi_colegio_id()
    ),
    'estudiantes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'carnet', e.carnet,
          'nombre_completo', u.nombre_completo
        )
        ORDER BY u.nombre_completo
      )
      FROM public.estudiantes e
      JOIN public.usuarios u ON u.id = e.id
      WHERE e.curso_id = p_curso_id
        AND e.colegio_id = public.mi_colegio_id()
        AND e.estado = 'activo'
        AND u.activo = true
    ), '[]'::jsonb),
    'materias', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'nombre', m.nombre,
          'campo_saberes', m.campo_saberes,
          'es_tecnica', m.es_tecnica,
          'aplica_desde', m.aplica_desde,
          'nivel', m.nivel
        )
        ORDER BY m.nombre
      )
      FROM public.materias m
      JOIN public.cursos c ON c.id = p_curso_id
      WHERE m.activo = true
        AND m.colegio_id = public.mi_colegio_id()
        AND (m.nivel = c.nivel OR m.nivel = 'Ambos')
    ), '[]'::jsonb),
    'notas', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'estudiante_id', nf.estudiante_id,
          'materia_id', nf.materia_id,
          'trimestre', nf.trimestre,
          'nota_final', nf.nota_final
        )
      )
      FROM public.notas_finales nf
      WHERE nf.curso_id = p_curso_id
        AND nf.colegio_id = public.mi_colegio_id()
        AND EXISTS (SELECT 1 FROM public.estudiantes es JOIN public.usuarios us ON us.id = es.id
                    WHERE es.id = nf.estudiante_id AND es.estado = 'activo' AND us.activo = true)
        AND (
          NOT EXISTS (SELECT 1 FROM public.materias mt
                      WHERE mt.id = nf.materia_id AND mt.es_tecnica IS TRUE)
          OR (
            v_nivel = 'Secundaria' AND v_grado >= 4
            AND EXISTS (
              SELECT 1
              FROM public.inscripciones_tecnicas it
              JOIN public.materias mt ON mt.id = it.materia_id
              WHERE it.estudiante_id = nf.estudiante_id
                AND it.materia_id    = nf.materia_id
                AND it.activo = true
                AND v_grado >= COALESCE(NULLIF(
                      NULLIF(regexp_replace(COALESCE(mt.aplica_desde, '4'), '\D', '', 'g'), '')::int,
                      0), 4)
            )
          )
        )
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date)
 RETURNS TABLE(estudiante_id uuid, estudiante text, fecha date, sesion text, estado text, materia_excepcion text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN;
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_desde > p_hasta THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.estudiante_id,
    u.nombre_completo::text AS estudiante,
    r.fecha,
    r.sesion::text,
    r.estado_resumen::text AS estado,
    r.materia_excepcion::text
  FROM public.asistencia_resumen_diario r
  JOIN public.estudiantes e ON e.id = r.estudiante_id
  JOIN public.usuarios u ON u.id = e.id
  WHERE r.curso_id = p_curso_id
    AND r.fecha BETWEEN p_desde AND p_hasta
    AND e.colegio_id = public.mi_colegio_id()
    AND e.estado = 'activo'
    AND u.activo = true
  ORDER BY u.nombre_completo, r.fecha, r.sesion;
END;
$function$;

commit;