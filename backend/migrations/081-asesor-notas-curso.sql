-- ============================================================
-- MIGRACIÓN 081: asesor_notas_curso
--   1. ORDER BY determinista (estudiante_id + materia_id) para
--      paginación estable de 1000 filas (PostgREST).
--   2. Fix marcas Hacer/Saber en materias técnicas
--      (actividades con curso_id NULL).
-- Reversión: volver a ejecutar la función de la 080.
-- ============================================================

CREATE OR REPLACE FUNCTION public.asesor_notas_curso(p_curso_id uuid)
RETURNS TABLE (
  estudiante_id   uuid,
  estudiante      text,
  carnet          text,
  materia_id      uuid,
  materia         text,
  trimestre       integer,
  nota_final      numeric,
  hacer_estado    text,
  saber_estado    text,
  ser_estado      text,
  decidir_estado  text,
  puntos_posibles numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_año integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN;
  END IF;

  v_año := public.año_gestion_vigente();

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
           nf.trimestre::integer AS trimestre, nf.nota_final::numeric AS nota_final
    FROM public.notas_finales nf
    WHERE nf.curso_id = p_curso_id
      AND nf.colegio_id = public.mi_colegio_id()
      AND EXISTS (SELECT 1 FROM public.estudiantes es
                  WHERE es.id = nf.estudiante_id AND es.estado = 'activo')
      AND (
        NOT EXISTS (SELECT 1 FROM public.materias mt
                    WHERE mt.id = nf.materia_id AND mt.es_tecnica IS TRUE)
        OR EXISTS (SELECT 1 FROM public.inscripciones_tecnicas it
                   WHERE it.estudiante_id = nf.estudiante_id
                     AND it.materia_id    = nf.materia_id
                     AND it.activo = true)
      )
  ),
  -- FIX técnicas: actividades tienen curso_id NULL → validar por
  -- inscripción + que el estudiante pertenezca al paralelo del asesor
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
    )::numeric AS puntos_posibles
  FROM marcado m
  CROSS JOIN dims d
  ORDER BY m.estudiante, m.estudiante_id, m.materia_id, m.trimestre;  -- orden estable (sugerencia anterior)
END;
$$;

COMMENT ON FUNCTION public.asesor_notas_curso(uuid) IS
  'Asesor: notas + estado dimensiones. Técnicas vía inscripción. ORDER BY estable para paginar.';