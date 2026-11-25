-- ============================================================
-- MIGRACIÓN 067: profesor_tiene_asignacion() ahora exige inscripción
-- técnica real cuando la materia lo es (comunicados, entregas, fichas SER)
--
-- Misma firma de siempre (1 parámetro, p_estudiante_id) -- CREATE OR
-- REPLACE reemplaza de verdad la función existente, sin DROP ni CASCADE,
-- sin tocar ninguna de las 4 policies que la usan. No hace falta un
-- segundo parámetro de materia_id: el cuerpo ya lo obtiene de la propia
-- fila de asignaciones_profesor a través del JOIN. Un primer intento con
-- una firma de 2 parámetros (uno opcional) falló al aplicarse: Postgres
-- trata cantidad de parámetros distinta como una función sobrecargada
-- aparte, no como un reemplazo -- y DROP FUNCTION de la versión vieja no
-- se puede hacer sin CASCADE porque las 4 policies dependen de ella
-- directamente. Se descartó esa vía; esta es la definitiva.
-- ============================================================
CREATE OR REPLACE FUNCTION public.profesor_tiene_asignacion(p_estudiante_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor ap
    JOIN public.estudiantes e ON e.curso_id = ap.curso_id
    JOIN public.materias m ON m.id = ap.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND e.id = p_estudiante_id
      AND ap.activo = true
      AND (
        m.es_tecnica IS NOT TRUE
        OR EXISTS (
          SELECT 1 FROM public.inscripciones_tecnicas it
          WHERE it.estudiante_id = p_estudiante_id AND it.materia_id = ap.materia_id AND it.activo = true
        )
      )
  );
$$;