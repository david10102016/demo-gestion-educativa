-- ============================================================
-- 089 — reporte_notas_periodo: incluir notas 0 REGISTRADAS
--
-- Motivo: el filtro "nota_final > 0" (migración 076) descartaba también
-- al estudiante cuyo profesor registró 0 (no entregó / abandono).
-- El panel del asesor sí lo muestra como Reprobado → incoherencia.
--
-- Nuevo filtro: nota_final > 0  O  tiene al menos una nota en HACER o SABER
-- (promedio_hacer / promedio_saber no nulos). Las filas sin ninguna
-- calificación (que la vista devuelve con 0) siguen excluidas.
-- Verificado 29/10/2026 en Buena Fe T2: 3823 filas vacías excluidas,
-- 6 filas con 0 registrado (4 estudiantes) incluidas.
--
-- Misma firma y columnas que la 088 → CREATE OR REPLACE. No toca datos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text DEFAULT NULL::text)
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