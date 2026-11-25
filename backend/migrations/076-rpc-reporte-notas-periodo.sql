-- ============================================================
-- 076 — RPC reporte_notas_periodo
-- Reportes del director (todos los tabs + Excel de aprovechamiento)
--
-- Aditiva: NO toca la vista notas_finales ni asistencias.
-- Devuelve el mismo shape que _getNotas en reportes-director.js,
-- ya filtrado (nota_final > 0) y deduplicado (1 fila por alumno+materia).
-- Solo es_director() + mi_colegio_id().
-- ============================================================

CREATE OR REPLACE FUNCTION public.reporte_notas_periodo(
  p_trimestre integer,
  p_nivel     text DEFAULT NULL
)
RETURNS TABLE (
  estudiante_id uuid,
  estudiante    text,
  carnet        text,
  materia_id    uuid,
  materia       text,
  curso_id      uuid,
  curso         text,
  nivel         text,
  trimestre     integer,
  nota_final    numeric,
  estado        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    nf.estado::text
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
$$;

COMMENT ON FUNCTION public.reporte_notas_periodo(integer, text) IS
  'Reportes director: notas del periodo filtradas (nota>0) y deduplicadas por alumno+materia. Solo es_director() + mi_colegio_id().';

REVOKE ALL ON FUNCTION public.reporte_notas_periodo(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_notas_periodo(integer, text) TO authenticated;