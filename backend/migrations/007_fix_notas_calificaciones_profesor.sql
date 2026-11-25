-- ============================================================
-- MIGRACIÓN 007: FIX VISIBILIDAD NOTAS Y CALIFICACIONES PROFESOR
-- Problema: políticas del script 006 usaban es_profesor() +
-- subquery a estudiantes con RLS desactivado, bloqueando
-- la visibilidad de notas y calificaciones al profesor.
-- Solución: usar auth.uid() directamente contra asignaciones_profesor
-- ============================================================

DROP POLICY IF EXISTS "notas_select_profesor" ON public.notas;
CREATE POLICY notas_select_profesor ON public.notas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.asignaciones_profesor ap
      JOIN public.actividades a ON a.id = notas.actividad_id
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = a.materia_id
        AND ap.curso_id = a.curso_id
        AND ap.activo = true
    )
    OR public.es_director()
    OR public.es_secretaria()
    OR estudiante_id = auth.uid()
  );

DROP POLICY IF EXISTS "calificaciones_select_profesor" ON public.calificaciones;
CREATE POLICY calificaciones_select_profesor ON public.calificaciones
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = calificaciones.materia_id
        AND ap.activo = true
    )
    OR public.es_director()
    OR estudiante_id = auth.uid()
  );
  -- ============================================================
-- MIGRACIÓN 008: FIX LOGIN — DESHABILITAR RLS EN USUARIOS Y ESTUDIANTES
-- Problema: script 006 causó recursión infinita en RLS.
-- Las políticas de estudiantes llamaban a mi_colegio_id() que leía
-- usuarios, y usuarios tenía políticas que llamaban a es_director()
-- que también leía usuarios — loop infinito causando error 500.
-- Solución: deshabilitar RLS en ambas tablas.
-- Nota: el aislamiento por colegio en estas tablas queda pendiente
-- de una solución sin recursión.
-- ============================================================

ALTER TABLE public.usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudiantes DISABLE ROW LEVEL SECURITY;