-- ============================================================
-- 116 — Comunicados: estudiante y tutor solo leen los comunicados dirigidos a ellos
--
-- Problema (hallazgo 4, detectado el 23-nov-2026):
--   Las políticas SELECT de public.comunicados para estudiante y tutor filtraban solo por colegio:
--     comunicados_select_estudiante: es_estudiante() AND colegio_id = mi_colegio_id()
--     comunicados_select_tutor:      el tutor tiene un hijo en el mismo colegio
--   La pantalla solo muestra los propios (lee desde comunicados_estudiante), pero consultando la
--   API directamente un estudiante o un padre podía leer asunto y contenido de TODOS los
--   comunicados de su colegio, incluidos los individuales a otros estudiantes (p. ej. citaciones).
--   No cruzaba colegios.
--
-- Evidencia (producción, 23-nov-2026, sesión simulada con rollback):
--   Estudiante de Juana Azurduy sin ningún comunicado dirigido: comunicados_que_puede_leer = 4,
--   comunicados_dirigidos_a_el = 0.
--
-- Solución:
--   Estudiante: solo comunicados con una fila suya en comunicados_estudiante.
--   Tutor: solo comunicados con una fila de alguno de sus hijos vinculados.
--   La comprobación va en funciones SECURITY DEFINER porque las políticas de
--   comunicados_estudiante consultan comunicados; consultarla directo desde una política de
--   comunicados provocaría recursión infinita de RLS.
--
-- Qué NO cambia:
--   Políticas de director, profesor e INSERT. Datos. El front (estudiante y tutor ya leen los
--   comunicados a través de comunicados_estudiante).
--
-- Verificación después de aplicar (la misma prueba, debe dar 0 y 0):
--   begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<id estudiante sin comunicados>',
--     'role','authenticated')::text, true);
--   set local role authenticated;
--   select (select count(*) from comunicados) as puede_leer,
--          (select count(*) from comunicados_estudiante where estudiante_id = auth.uid()) as dirigidos;
--   rollback;
--
-- Revertir (reabre la fuga): volver a crear las dos políticas con su condición anterior.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.comunicado_dirigido_a_mi(p_comunicado_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comunicados_estudiante ce
    WHERE ce.comunicado_id = p_comunicado_id
      AND ce.estudiante_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.comunicado_dirigido_a_mi_hijo(p_comunicado_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comunicados_estudiante ce
    JOIN public.tutor_estudiante te ON te.estudiante_id = ce.estudiante_id
    WHERE ce.comunicado_id = p_comunicado_id
      AND te.tutor_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.comunicado_dirigido_a_mi(UUID)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.comunicado_dirigido_a_mi_hijo(UUID)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.comunicado_dirigido_a_mi(UUID)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comunicado_dirigido_a_mi_hijo(UUID)  TO authenticated;

DROP POLICY IF EXISTS "comunicados_select_estudiante" ON public.comunicados;
CREATE POLICY "comunicados_select_estudiante" ON public.comunicados
  FOR SELECT
  USING (es_estudiante() AND public.comunicado_dirigido_a_mi(id));

DROP POLICY IF EXISTS "comunicados_select_tutor" ON public.comunicados;
CREATE POLICY "comunicados_select_tutor" ON public.comunicados
  FOR SELECT
  USING (public.comunicado_dirigido_a_mi_hijo(id));

COMMIT;