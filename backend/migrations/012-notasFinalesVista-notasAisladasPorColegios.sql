-- ============================================================
-- MIGRACIÓN 012: Fix vista notas_finales — Multitenant
-- Problema: La vista original hacía JOIN a todas las materias
-- activas del mismo nivel sin filtrar por colegio, mostrando
-- datos de otros colegios en los reportes del director.
-- Solución: Agregar filtro colegio_id = e.colegio_id en el
-- CROSS JOIN de materias. También se agregan las columnas
-- curso_id, curso y nivel que el frontend necesita.
-- ============================================================

DROP VIEW IF EXISTS public.notas_finales;

CREATE VIEW public.notas_finales AS
SELECT
  e.id                    AS estudiante_id,
  e.carnet,
  u.nombre_completo       AS estudiante,
  m.id                    AS materia_id,
  m.nombre                AS materia,
  t.periodo               AS trimestre,
  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer' AND a.curso_id = e.curso_id
  ), 0) AS promedio_hacer,
  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber' AND a.curso_id = e.curso_id
  ), 0) AS promedio_saber,
  COALESCE(c.nota_ser, 0) AS nota_ser,
  COALESCE(c.nota_decidir, 0) AS nota_decidir,
  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer' AND a.curso_id = e.curso_id
  ), 0)
  + COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber' AND a.curso_id = e.curso_id
  ), 0)
  + COALESCE(c.nota_ser, 0)
  + COALESCE(c.nota_decidir, 0) AS nota_final,
  CASE
    WHEN (
      COALESCE((SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC,2)
        FROM public.actividades a JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
        JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
        WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer' AND a.curso_id = e.curso_id), 0)
      + COALESCE((SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC,2)
        FROM public.actividades a JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
        JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
        WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber' AND a.curso_id = e.curso_id), 0)
      + COALESCE(c.nota_ser, 0)
      + COALESCE(c.nota_decidir, 0)
    ) >= (SELECT nota_minima_aprobacion FROM public.gestion_activa LIMIT 1)
    THEN (SELECT etiqueta_aprobado FROM public.gestion_activa LIMIT 1)
    ELSE (SELECT etiqueta_reprobado FROM public.gestion_activa LIMIT 1)
  END AS estado,
  cu.id              AS curso_id,
  cu.nombre_completo AS curso,
  cu.nivel
FROM public.estudiantes e
JOIN public.usuarios u ON u.id = e.id
JOIN public.cursos cu ON cu.id = e.curso_id
CROSS JOIN LATERAL (
  SELECT * FROM public.materias
  WHERE activo = true
    AND nivel = cu.nivel
    AND colegio_id = e.colegio_id
) m
CROSS JOIN (
  SELECT generate_series AS periodo
  FROM generate_series(1, (
    SELECT COALESCE(cantidad_periodos, 3) FROM public.gestion_activa LIMIT 1
  ))
) t
LEFT JOIN public.calificaciones c
  ON c.estudiante_id = e.id AND c.materia_id = m.id AND c.trimestre = t.periodo;

COMMENT ON VIEW public.notas_finales IS 'Notas calculadas dinámicamente por colegio. Filtra materias por colegio_id para aislamiento multitenant.';