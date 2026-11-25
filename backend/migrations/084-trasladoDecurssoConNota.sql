-- Corrección: en materias regulares cuentan las notas del estudiante en cualquier paralelo
-- (traslados de curso). Técnicas sin cambio. Resultado idéntico para quien no se trasladó.
CREATE OR REPLACE VIEW notas_finales WITH (security_invoker = true) AS SELECT e.id AS estudiante_id,
    e.carnet,
    u.nombre_completo AS estudiante,
    m.id AS materia_id,
    m.nombre AS materia,
    t.periodo AS trimestre,
    e.colegio_id,
    ( SELECT round(avg(n.valor::numeric / NULLIF(a.max_puntos, 0::numeric) * d.peso_maximo), 2) AS round
           FROM actividades a
             JOIN notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
             JOIN config_dimensiones d ON d.codigo = a.tipo AND d."año" = EXTRACT(year FROM now())::integer AND d.colegio_id = e.colegio_id
          WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer'::text AND (m.es_tecnica IS NOT TRUE OR m.es_tecnica IS TRUE AND (EXISTS ( SELECT 1
                   FROM inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true)))) AS promedio_hacer,
    ( SELECT round(avg(n.valor::numeric / NULLIF(a.max_puntos, 0::numeric) * d.peso_maximo), 2) AS round
           FROM actividades a
             JOIN notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
             JOIN config_dimensiones d ON d.codigo = a.tipo AND d."año" = EXTRACT(year FROM now())::integer AND d.colegio_id = e.colegio_id
          WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber'::text AND (m.es_tecnica IS NOT TRUE OR m.es_tecnica IS TRUE AND (EXISTS ( SELECT 1
                   FROM inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true)))) AS promedio_saber,
    c.nota_ser,
    c.nota_decidir,
    COALESCE(( SELECT round(avg(n.valor::numeric / NULLIF(a.max_puntos, 0::numeric) * d.peso_maximo), 2) AS round
           FROM actividades a
             JOIN notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
             JOIN config_dimensiones d ON d.codigo = a.tipo AND d."año" = EXTRACT(year FROM now())::integer AND d.colegio_id = e.colegio_id
          WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer'::text AND (m.es_tecnica IS NOT TRUE OR m.es_tecnica IS TRUE AND (EXISTS ( SELECT 1
                   FROM inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true)))), 0::numeric) + COALESCE(( SELECT round(avg(n.valor::numeric / NULLIF(a.max_puntos, 0::numeric) * d.peso_maximo), 2) AS round
           FROM actividades a
             JOIN notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
             JOIN config_dimensiones d ON d.codigo = a.tipo AND d."año" = EXTRACT(year FROM now())::integer AND d.colegio_id = e.colegio_id
          WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber'::text AND (m.es_tecnica IS NOT TRUE OR m.es_tecnica IS TRUE AND (EXISTS ( SELECT 1
                   FROM inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true)))), 0::numeric) + COALESCE(c.nota_ser, 0::numeric) + COALESCE(c.nota_decidir, 0::numeric) AS nota_final,
        CASE
            WHEN (COALESCE(( SELECT round(avg(n.valor::numeric / NULLIF(a.max_puntos, 0::numeric) * d.peso_maximo), 2) AS round
               FROM actividades a
                 JOIN notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
                 JOIN config_dimensiones d ON d.codigo = a.tipo AND d."año" = EXTRACT(year FROM now())::integer AND d.colegio_id = e.colegio_id
              WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer'::text AND (m.es_tecnica IS NOT TRUE OR m.es_tecnica IS TRUE AND (EXISTS ( SELECT 1
                       FROM inscripciones_tecnicas it
                      WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true)))), 0::numeric) + COALESCE(( SELECT round(avg(n.valor::numeric / NULLIF(a.max_puntos, 0::numeric) * d.peso_maximo), 2) AS round
               FROM actividades a
                 JOIN notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
                 JOIN config_dimensiones d ON d.codigo = a.tipo AND d."año" = EXTRACT(year FROM now())::integer AND d.colegio_id = e.colegio_id
              WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber'::text AND (m.es_tecnica IS NOT TRUE OR m.es_tecnica IS TRUE AND (EXISTS ( SELECT 1
                       FROM inscripciones_tecnicas it
                      WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true)))), 0::numeric) + COALESCE(c.nota_ser, 0::numeric) + COALESCE(c.nota_decidir, 0::numeric)) >= (( SELECT gestion_activa.nota_minima_aprobacion
               FROM gestion_activa
             LIMIT 1)) THEN ( SELECT gestion_activa.etiqueta_aprobado
               FROM gestion_activa
             LIMIT 1)
            ELSE ( SELECT gestion_activa.etiqueta_reprobado
               FROM gestion_activa
             LIMIT 1)
        END AS estado,
    cu.id AS curso_id,
    cu.nombre_completo AS curso,
    cu.nivel
   FROM estudiantes e
     JOIN usuarios u ON u.id = e.id
     JOIN cursos cu ON cu.id = e.curso_id
     CROSS JOIN LATERAL ( SELECT materias.id,
            materias.colegio_id,
            materias.nombre,
            materias.nivel,
            materias.campo_saberes,
            materias.es_tecnica,
            materias.aplica_desde,
            materias.activo,
            materias.created_at
           FROM materias
          WHERE materias.activo = true AND materias.nivel = cu.nivel AND materias.colegio_id = e.colegio_id) m
     CROSS JOIN ( SELECT generate_series.generate_series AS periodo
           FROM generate_series(1, ( SELECT COALESCE(gestion_activa.cantidad_periodos, 3) AS "coalesce"
                   FROM gestion_activa
                 LIMIT 1)) generate_series(generate_series)) t
     LEFT JOIN calificaciones c ON c.estudiante_id = e.id AND c.materia_id = m.id AND c.trimestre = t.periodo;