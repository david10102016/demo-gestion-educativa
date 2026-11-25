-- ============================================================
-- MIGRACIÓN 010: Fix Multitenant — Vista notas_finales
-- Agrega colegio_id al SELECT para filtrado por colegio
-- ============================================================

DROP VIEW public.notas_finales;

CREATE OR REPLACE VIEW notas_finales AS
 SELECT e.id AS estudiante_id,
    e.carnet,
    u.nombre_completo AS estudiante,
    m.id AS materia_id,
    m.nombre AS materia,
    t.periodo AS trimestre,
    e.colegio_id,
    COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2)
           FROM ((actividades a
             JOIN notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer') AND (a.curso_id = e.curso_id))), (0)::numeric) AS promedio_hacer,
    COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2)
           FROM ((actividades a
             JOIN notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber') AND (a.curso_id = e.curso_id))), (0)::numeric) AS promedio_saber,
    COALESCE(c.nota_ser, (0)::numeric) AS nota_ser,
    COALESCE(c.nota_decidir, (0)::numeric) AS nota_decidir,
    (((COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2)
           FROM ((actividades a
             JOIN notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer') AND (a.curso_id = e.curso_id))), (0)::numeric) +
    COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2)
           FROM ((actividades a
             JOIN notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber') AND (a.curso_id = e.curso_id))), (0)::numeric)) +
    COALESCE(c.nota_ser, (0)::numeric)) + COALESCE(c.nota_decidir, (0)::numeric)) AS nota_final,
    CASE
        WHEN ((((COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2)
               FROM ((actividades a
                 JOIN notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
                 JOIN config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer))))
              WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer') AND (a.curso_id = e.curso_id))), (0)::numeric) +
        COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2)
               FROM ((actividades a
                 JOIN notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
                 JOIN config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer))))
              WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber') AND (a.curso_id = e.curso_id))), (0)::numeric)) +
        COALESCE(c.nota_ser, (0)::numeric)) + COALESCE(c.nota_decidir, (0)::numeric)) >=
        ( SELECT gestion_activa.nota_minima_aprobacion FROM gestion_activa LIMIT 1))
        THEN ( SELECT gestion_activa.etiqueta_aprobado FROM gestion_activa LIMIT 1)
        ELSE ( SELECT gestion_activa.etiqueta_reprobado FROM gestion_activa LIMIT 1)
    END AS estado,
    cu.id AS curso_id,
    cu.nombre_completo AS curso,
    cu.nivel
   FROM (((((estudiantes e
     JOIN usuarios u ON ((u.id = e.id)))
     JOIN cursos cu ON ((cu.id = e.curso_id)))
     CROSS JOIN LATERAL ( SELECT materias.id, materias.colegio_id, materias.nombre, materias.nivel,
            materias.campo_saberes, materias.es_tecnica, materias.aplica_desde, materias.activo, materias.created_at
           FROM materias
          WHERE ((materias.activo = true) AND (materias.nivel = cu.nivel) AND (materias.colegio_id = e.colegio_id))) m)
     CROSS JOIN ( SELECT generate_series.generate_series AS periodo
           FROM generate_series(1, ( SELECT COALESCE(gestion_activa.cantidad_periodos, 3)
                   FROM gestion_activa LIMIT 1)) generate_series(generate_series)) t)
     LEFT JOIN calificaciones c ON (((c.estudiante_id = e.id) AND (c.materia_id = m.id) AND (c.trimestre = t.periodo))));