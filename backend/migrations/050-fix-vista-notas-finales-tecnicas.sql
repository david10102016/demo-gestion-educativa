-- 050-fix-vista-notas-finales-tecnicas.sql
-- ─────────────────────────────────────────────────────────
-- 050 — Vista notas_finales no calculaba Hacer/Saber para materias
-- técnicas (mismo bug de curso_id NULL, ahora en una vista)
--
-- Problema: en el reporte de "Calificaciones" del director, los
-- estudiantes de Sistemas Informáticos (Juana Azurduy) aparecían con
-- Hacer=0.0 y Saber=0.0 y "REPROBADO", pese a tener notas reales
-- cargadas y visibles en el panel del propio profesor.
--
-- Causa: la vista notas_finales calcula esos dos promedios con un
-- EXISTS que exige "a.curso_id = e.curso_id" — repetido 6 veces
-- dentro de la misma vista (3 para Hacer, 3 para Saber: una vez en
-- cada columna y otra vez repetido inline en el cálculo de nota_final
-- y de estado). Como las actividades técnicas tienen curso_id NULL,
-- esa comparación nunca es verdadera y el promedio siempre da 0,
-- sin importar cuántas notas reales existan. Mismo patrón que ya se
-- corrigió hoy en actividades_select_colegio (048) y
-- notas_select_profesor (049), esta vez en una vista en vez de una
-- policy RLS.
--
-- Solución: se agrega la misma condición OR ya usada en los fixes
-- anteriores — para materias técnicas, en vez de comparar curso_id,
-- se valida inscripción real en inscripciones_tecnicas. Aplicado en
-- las 6 ocurrencias. El cálculo para materias no técnicas queda
-- exactamente igual.
--
-- CREATE OR REPLACE VIEW no rompe nada: mismas columnas, mismo
-- nombre, mismos permisos — solo cambia la lógica interna del
-- WHERE en los 6 puntos señalados.
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.notas_finales WITH (security_invoker='true') AS
 SELECT e.id AS estudiante_id,
    e.carnet,
    u.nombre_completo AS estudiante,
    m.id AS materia_id,
    m.nombre AS materia,
    t.periodo AS trimestre,
    e.colegio_id,
    ( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer'::text)
          AND ((m.es_tecnica IS NOT TRUE AND a.curso_id = e.curso_id)
            OR (m.es_tecnica IS TRUE AND EXISTS (
                  SELECT 1 FROM public.inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true))))) AS promedio_hacer,
    ( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber'::text)
          AND ((m.es_tecnica IS NOT TRUE AND a.curso_id = e.curso_id)
            OR (m.es_tecnica IS TRUE AND EXISTS (
                  SELECT 1 FROM public.inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true))))) AS promedio_saber,
    c.nota_ser,
    c.nota_decidir,
    (((COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer'::text)
          AND ((m.es_tecnica IS NOT TRUE AND a.curso_id = e.curso_id)
            OR (m.es_tecnica IS TRUE AND EXISTS (
                  SELECT 1 FROM public.inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true))))), (0)::numeric) + COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber'::text)
          AND ((m.es_tecnica IS NOT TRUE AND a.curso_id = e.curso_id)
            OR (m.es_tecnica IS TRUE AND EXISTS (
                  SELECT 1 FROM public.inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true))))), (0)::numeric)) + COALESCE(c.nota_ser, (0)::numeric)) + COALESCE(c.nota_decidir, (0)::numeric)) AS nota_final,
        CASE
            WHEN ((((COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
               FROM ((public.actividades a
                 JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
                 JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
              WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer'::text)
          AND ((m.es_tecnica IS NOT TRUE AND a.curso_id = e.curso_id)
            OR (m.es_tecnica IS TRUE AND EXISTS (
                  SELECT 1 FROM public.inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true))))), (0)::numeric) + COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
               FROM ((public.actividades a
                 JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
                 JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
              WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber'::text)
          AND ((m.es_tecnica IS NOT TRUE AND a.curso_id = e.curso_id)
            OR (m.es_tecnica IS TRUE AND EXISTS (
                  SELECT 1 FROM public.inscripciones_tecnicas it
                  WHERE it.estudiante_id = e.id AND it.materia_id = m.id AND it.activo = true))))), (0)::numeric)) + COALESCE(c.nota_ser, (0)::numeric)) + COALESCE(c.nota_decidir, (0)::numeric)) >= ( SELECT gestion_activa.nota_minima_aprobacion
               FROM public.gestion_activa
             LIMIT 1)) THEN ( SELECT gestion_activa.etiqueta_aprobado
               FROM public.gestion_activa
             LIMIT 1)
            ELSE ( SELECT gestion_activa.etiqueta_reprobado
               FROM public.gestion_activa
             LIMIT 1)
        END AS estado,
    cu.id AS curso_id,
    cu.nombre_completo AS curso,
    cu.nivel
   FROM (((((public.estudiantes e
     JOIN public.usuarios u ON ((u.id = e.id)))
     JOIN public.cursos cu ON ((cu.id = e.curso_id)))
     CROSS JOIN LATERAL ( SELECT materias.id,
            materias.colegio_id,
            materias.nombre,
            materias.nivel,
            materias.campo_saberes,
            materias.es_tecnica,
            materias.aplica_desde,
            materias.activo,
            materias.created_at
           FROM public.materias
          WHERE ((materias.activo = true) AND (materias.nivel = cu.nivel) AND (materias.colegio_id = e.colegio_id))) m)
     CROSS JOIN ( SELECT generate_series.generate_series AS periodo
           FROM generate_series(1, ( SELECT COALESCE(gestion_activa.cantidad_periodos, 3) AS "coalesce"
                   FROM public.gestion_activa
                 LIMIT 1)) generate_series(generate_series)) t)
     LEFT JOIN public.calificaciones c ON (((c.estudiante_id = e.id) AND (c.materia_id = m.id) AND (c.trimestre = t.periodo))));


ALTER VIEW public.notas_finales OWNER TO postgres;

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
-- En el panel de director (Juana Azurduy), Calificaciones ->
-- 6° Secundaria A/B + Sistemas Informáticos + Trimestre 1 ->
-- Choque Choque Juan Pablo (y el resto) deben mostrar Hacer/Saber
-- reales, no 0.0, y el estado correcto según su nota real.
-- ─────────────────────────────────────────────────────────