-- ============================================================
-- 110 — reporte_notas_periodo: exponer SER y DECIDIR calificados
--
-- Motivo: el panel del director y sus reportes no podían saber si SER y
-- DECIDIR (Autoevaluación) ya tienen nota, así que con el trimestre abierto
-- mostraban solo HACER+SABER aunque la nota ya estuviera completa
-- (mismo caso que el panel del asesor de curso).
--
-- Aditiva: agrega 2 columnas al final (ser_estado, decidir_estado), con el
-- mismo criterio que asesor_notas_curso (migración 102):
--   'calificada' si existe al menos una calificación con nota_ser / nota_decidir
--   no nula para ese estudiante + materia + trimestre; si no, 'pendiente'.
-- Filtros, orden y seguridad IGUALES a la 089. No modifica tablas ni datos.
-- DROP + CREATE porque cambia el tipo de retorno.
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS public.reporte_notas_periodo(integer, text);

CREATE FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text DEFAULT NULL::text)
 RETURNS TABLE(estudiante_id uuid, estudiante text, carnet text, materia_id uuid, materia text,
               curso_id uuid, curso text, nivel text, trimestre integer, nota_final numeric, estado text,
               nota_hacer numeric, nota_saber numeric,
               ser_estado text, decidir_estado text)
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
  WITH cal AS (
    SELECT c.estudiante_id, c.materia_id, c.trimestre,
           bool_or(c.nota_ser IS NOT NULL)     AS ser_ok,
           bool_or(c.nota_decidir IS NOT NULL) AS decidir_ok
    FROM public.calificaciones c
    WHERE c.trimestre = p_trimestre
    GROUP BY c.estudiante_id, c.materia_id, c.trimestre
  )
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
    nf.promedio_saber::numeric,
    (CASE WHEN COALESCE(c.ser_ok, false)     THEN 'calificada' ELSE 'pendiente' END)::text,
    (CASE WHEN COALESCE(c.decidir_ok, false) THEN 'calificada' ELSE 'pendiente' END)::text
  FROM public.notas_finales nf
  LEFT JOIN cal c
    ON c.estudiante_id = nf.estudiante_id
   AND c.materia_id    = nf.materia_id
   AND c.trimestre     = nf.trimestre
  WHERE nf.colegio_id = public.mi_colegio_id()
    AND nf.trimestre  = p_trimestre
    AND (nf.nota_final > 0 OR nf.promedio_hacer IS NOT NULL OR nf.promedio_saber IS NOT NULL)
    AND (p_nivel IS NULL OR btrim(p_nivel) = '' OR nf.nivel = p_nivel)
  ORDER BY
    nf.estudiante_id,
    nf.materia_id,
    nf.nota_final DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.reporte_notas_periodo(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_notas_periodo(integer, text) TO authenticated;

COMMIT;