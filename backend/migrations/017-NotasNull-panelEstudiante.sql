-- ============================================================
-- MIGRACIÓN 017: notas_finales — dimensiones NULL-aware
-- Las columnas promedio_hacer, promedio_saber, nota_ser y
-- nota_decidir ahora devuelven NULL cuando el profesor no ha
-- ingresado notas (antes devolvían 0 por COALESCE).
-- El panel del estudiante distingue correctamente entre
-- "sin notas" (muestra — y estado Pendiente) y "nota real 0".
-- nota_final y estado mantienen COALESCE para sumar bien
-- cuando hay al menos una dimensión calificada.
-- Se agrega d.colegio_id = e.colegio_id en el JOIN con
-- config_dimensiones para garantizar aislamiento multitenant.
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
  e.colegio_id,

  (
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT AND d.colegio_id = e.colegio_id
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer' AND a.curso_id = e.curso_id
  ) AS promedio_hacer,

  (
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT AND d.colegio_id = e.colegio_id
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber' AND a.curso_id = e.curso_id
  ) AS promedio_saber,

  c.nota_ser,
  c.nota_decidir,

  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT AND d.colegio_id = e.colegio_id
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer' AND a.curso_id = e.curso_id
  ), 0)
  + COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT AND d.colegio_id = e.colegio_id
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber' AND a.curso_id = e.curso_id
  ), 0)
  + COALESCE(c.nota_ser, 0)
  + COALESCE(c.nota_decidir, 0) AS nota_final,

  CASE
    WHEN (
      COALESCE((
        SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC,2)
        FROM public.actividades a
        JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
        JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT AND d.colegio_id = e.colegio_id
        WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer' AND a.curso_id = e.curso_id
      ), 0)
      + COALESCE((
        SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC,2)
        FROM public.actividades a
        JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
        JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT AND d.colegio_id = e.colegio_id
        WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber' AND a.curso_id = e.curso_id
      ), 0)
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