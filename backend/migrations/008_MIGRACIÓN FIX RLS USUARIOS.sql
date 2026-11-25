-- ============================================================
-- MIGRACIÓN 008: FIX RLS USUARIOS — MULTITENANT
-- Problema 1: usuarios_select_public con true exponía todos los
-- usuarios a cualquier usuario autenticado de cualquier colegio.
-- Problema 2: funciones es_director(), es_profesor(), es_secretaria()
-- y mi_colegio_id() causaban recursión infinita al leer usuarios
-- bajo contexto RLS.
-- Solución: SECURITY DEFINER + SET search_path en todas las
-- funciones helper para que operen fuera del contexto RLS.
-- ============================================================

-- Romper recursión en todas las funciones helper
CREATE OR REPLACE FUNCTION public.mi_colegio_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, auth
STABLE AS $$
  SELECT colegio_id FROM usuarios WHERE id = auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.es_director()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, auth
STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'director' AND activo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.es_profesor()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, auth
STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'profesor' AND activo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.es_secretaria()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, auth
STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'secretaria' AND activo = true
  );
$$;

-- Eliminar política que exponía todos los usuarios
DROP POLICY IF EXISTS "usuarios_select_public" ON public.usuarios;

-- Reemplazar política circular — elimina dependencia de colegio_id
-- en la subquery a estudiantes para evitar recursión
DROP POLICY IF EXISTS "usuarios_select_profesor_estudiantes" ON public.usuarios;
CREATE POLICY usuarios_select_profesor_estudiantes ON public.usuarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      JOIN public.asignaciones_profesor ap ON ap.curso_id = e.curso_id
      WHERE e.id = usuarios.id
        AND ap.profesor_id = auth.uid()
        AND ap.activo = true
    )
  );

-- Activar RLS en usuarios
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;