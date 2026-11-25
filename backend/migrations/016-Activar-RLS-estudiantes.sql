-- ============================================================
-- MIGRACIÓN 015: Activar RLS en estudiantes — Fix definitivo
-- Problema: Activar RLS en estudiantes causaba recursión infinita
-- por políticas que hacían JOIN cruzado entre estudiantes,
-- usuarios y tutor_estudiante.
-- Solución: 
--   1) usuarios_select_profesor_estudiantes ya no hace JOIN a 
--      estudiantes (solo lee asignaciones_profesor) — migración 008.
--   2) Nueva función SECURITY DEFINER colegio_de_estudiante() 
--      para que las políticas de tutor_estudiante no consulten 
--      estudiantes directamente, rompiendo el ciclo restante.
-- ============================================================

-- Función auxiliar: obtiene el colegio_id de un estudiante
-- sin pasar por RLS (evita recursión cruzada)
CREATE OR REPLACE FUNCTION public.colegio_de_estudiante(p_estudiante_id UUID)
RETURNS UUID LANGUAGE SQL SECURITY DEFINER
SET search_path = public STABLE AS $$
  SELECT colegio_id FROM public.estudiantes WHERE id = p_estudiante_id;
$$;

-- Políticas de tutor_estudiante reescritas usando la función,
-- en vez de JOIN directo a estudiantes
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

-- Activar RLS en estudiantes — ya sin riesgo de recursión
ALTER TABLE public.estudiantes ENABLE ROW LEVEL SECURITY;

-- Políticas ya existentes en estudiantes (verificadas, sin cambios):
-- estudiantes_select_propio   — el propio estudiante
-- estudiantes_select_profesor — profesor con asignación activa al curso
-- estudiantes_all_director    — director del mismo colegio
-- estudiantes_select_tutor    — tutor vinculado vía tutor_estudiante

-- ============================================================
-- Fix: eliminar política redundante en colegios
-- Permitía a cualquier usuario autenticado ver TODOS los colegios,
-- redundante con colegios_select_propio (que ya cubre el caso
-- propio + superadmin). Riesgo bajo (colegios no tiene datos
-- sensibles) pero rompía el principio de aislamiento por rol.
-- ============================================================

DO $$
BEGIN
  -- Nombre usado en el proyecto oficial
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'colegios' AND policyname = 'colegios_select_autenticado'
  ) THEN
    EXECUTE 'DROP POLICY "colegios_select_autenticado" ON public.colegios';
  END IF;

  -- Nombre usado en el proyecto alterno
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'colegios' AND policyname = 'colegios_select_all'
  ) THEN
    EXECUTE 'DROP POLICY "colegios_select_all" ON public.colegios';
  END IF;
END $$;