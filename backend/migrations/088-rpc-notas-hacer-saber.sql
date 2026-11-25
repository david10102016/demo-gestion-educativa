-- ============================================================
-- 088 — Exponer HACER y SABER en las RPC del director y del asesor
--
-- Motivo: coherencia del criterio "En riesgo" (HACER+SABER < nota mínima)
-- entre Bajo Rendimiento (profesor), Junta, panel del asesor y reportes
-- del director. Ambas funciones devolvían solo nota_final.
--
-- Aditiva:
--   · Agrega 2 columnas al final: nota_hacer, nota_saber
--     (tomadas de notas_finales.promedio_hacer / promedio_saber,
--      ya ponderadas: HACER sobre 40, SABER sobre 45).
--   · El resto de la lógica, filtros y seguridad quedan IGUAL
--     a la definición vigente en la base (verificada 29/10/2026).
--   · No modifica tablas, vistas ni datos.
-- Se usa DROP + CREATE porque cambia el tipo de retorno.
-- ============================================================

BEGIN;

-- ─── 1. Director: reporte_notas_periodo ─────────────────────
DROP FUNCTION IF EXISTS public.reporte_notas_periodo(integer, text);

CREATE FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text DEFAULT NULL::text)
 RETURNS TABLE(estudiante_id uuid, estudiante text, carnet text, materia_id uuid, materia text,
               curso_id uuid, curso text, nivel text, trimestre integer, nota_final numeric, estado text,
               nota_hacer numeric, nota_saber numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Solo el director puede consultar este reporte';
  END IF;

  IF public.mi_colegio_id() IS NULL THEN
    RAISE EXCEPTION 'El director no tiene colegio asignado';
  END IF;

  IF p_trimestre IS NULL OR p_trimestre < 1 THEN
    RAISE EXCEPTION 'Trimestre inválido';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (nf.estudiante_id, nf.materia_id)
    nf.estudiante_id,
    nf.estudiante::text,
    nf.carnet::text,
    nf.materia_id,
    nf.materia::text,
    nf.curso_id,
    nf.curso::text,
    nf.nivel::text,
    nf.trimestre::integer,
    nf.nota_final::numeric,
    nf.estado::text,
    nf.promedio_hacer::numeric,
    nf.promedio_saber::numeric
  FROM public.notas_finales nf
  WHERE nf.colegio_id = public.mi_colegio_id()
    AND nf.trimestre  = p_trimestre
    AND nf.nota_final > 0
    AND (p_nivel IS NULL OR btrim(p_nivel) = '' OR nf.nivel = p_nivel)
  ORDER BY
    nf.estudiante_id,
    nf.materia_id,
    nf.nota_final DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.reporte_notas_periodo(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_notas_periodo(integer, text) TO authenticated;


-- ─── 2. Asesor: asesor_notas_curso ──────────────────────────
DROP FUNCTION IF EXISTS public.asesor_notas_curso(uuid);

CREATE FUNCTION public.asesor_notas_curso(p_curso_id uuid)
 RETURNS TABLE(estudiante_id uuid, estudiante text, carnet text, materia_id uuid, materia text,
               trimestre integer, nota_final numeric, hacer_estado text, saber_estado text,
               ser_estado text, decidir_estado text, puntos_posibles numeric,
               nota_hacer numeric, nota_saber numeric)
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
      AND EXISTS (SELECT 1 FROM public.estudiantes es
                  WHERE es.id = nf.estudiante_id AND es.estado = 'activo')
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

REVOKE ALL ON FUNCTION public.asesor_notas_curso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_notas_curso(uuid) TO authenticated;

COMMIT;

-- Verificación (solo lectura):
-- SELECT p.proname, pg_get_function_result(p.oid)
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname IN ('reporte_notas_periodo','asesor_notas_curso');