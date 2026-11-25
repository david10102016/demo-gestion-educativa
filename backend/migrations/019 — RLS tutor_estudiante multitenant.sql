-- ============================================================
-- MIGRACIÓN 019 — RLS tutor_estudiante multitenant
-- Sistema de gestión escolar multitenant (gestion-educativa2027)
-- ------------------------------------------------------------
-- Agrega aislamiento multitenant a la tabla tutor_estudiante
-- mediante policies RLS para director y secretaria.
--
-- CONTEXTO:
--   La tabla tutor_estudiante vincula padres/tutores con
--   estudiantes. Sin estas policies, un director o secretaria
--   podría ver o modificar vinculaciones de otros colegios.
--   Se crea la función helper colegio_de_estudiante() para
--   resolver el colegio_id a partir del estudiante_id, ya que
--   tutor_estudiante no tiene colegio_id directo.
--
-- FUNCIÓN:
--   colegio_de_estudiante(p_estudiante_id UUID) → UUID
--   Devuelve el colegio_id del estudiante. SECURITY DEFINER
--   para evitar recursión en RLS.
--
-- POLICIES APLICADAS:
--   - tutor_estudiante_select_director: director ve solo
--     vinculaciones de estudiantes de su colegio
--   - tutor_estudiante_select_secretaria: secretaria igual
--   - tutor_estudiante_update_director: director puede
--     modificar solo vinculaciones de su colegio
-- ============================================================

CREATE OR REPLACE FUNCTION public.colegio_de_estudiante(p_estudiante_id UUID)
RETURNS UUID LANGUAGE SQL SECURITY DEFINER
SET search_path = public STABLE AS $$
  SELECT colegio_id FROM public.estudiantes WHERE id = p_estudiante_id;
$$;

DROP POLICY IF EXISTS "tutor_estudiante_select_director" ON public.tutor_estudiante;
CREATE POLICY "tutor_estudiante_select_director" ON public.tutor_estudiante
FOR SELECT USING (
  es_director() AND
  colegio_de_estudiante(estudiante_id) = mi_colegio_id()
);

DROP POLICY IF EXISTS "tutor_estudiante_select_secretaria" ON public.tutor_estudiante;
CREATE POLICY "tutor_estudiante_select_secretaria" ON public.tutor_estudiante
FOR SELECT USING (
  es_secretaria() AND
  colegio_de_estudiante(estudiante_id) = mi_colegio_id()
);

DROP POLICY IF EXISTS "tutor_estudiante_update_director" ON public.tutor_estudiante;
CREATE POLICY "tutor_estudiante_update_director" ON public.tutor_estudiante
FOR UPDATE USING (
  es_director() AND
  colegio_de_estudiante(estudiante_id) = mi_colegio_id()
);