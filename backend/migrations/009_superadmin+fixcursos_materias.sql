-- ============================================================
-- MIGRACIÓN 009: SUPERADMIN + FIX CURSOS Y MATERIAS MULTITENANT
-- ============================================================

-- PASO 1: Agregar rol superadmin al constraint
ALTER TABLE public.usuarios 
DROP CONSTRAINT usuarios_rol_check;

ALTER TABLE public.usuarios 
ADD CONSTRAINT usuarios_rol_check 
CHECK (rol = ANY (ARRAY['director','profesor','estudiante','secretaria','tutor','superadmin']));

-- PASO 2: Políticas superadmin en colegios
CREATE POLICY colegios_write_superadmin ON public.colegios
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND rol = 'superadmin' AND activo = true
    )
  );

DROP POLICY IF EXISTS "colegios_select_propio" ON public.colegios;
CREATE POLICY colegios_select_propio ON public.colegios
  FOR SELECT USING (
    id = public.mi_colegio_id()
    OR EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND rol = 'superadmin' AND activo = true
    )
  );

-- PASO 3: Fix cursos y materias multitenant
DROP POLICY IF EXISTS "cursos_select_public" ON public.cursos;
DROP POLICY IF EXISTS "materias_select_public" ON public.materias;

-- ============================================================
-- PASO 4: CREAR SUPERADMIN
-- Primero crear el usuario en Supabase Auth dashboard
-- Authentication → Users → Add user → email + contraseña
-- Luego ejecutar con el UUID generado:
-- ============================================================

/*
INSERT INTO public.usuarios (id, rol, nombre_completo, email, activo, colegio_id)
VALUES (
  '<UUID_DEL_AUTH>',
  'superadmin',
  '<NOMBRE SUPERADMIN>',
  '<EMAIL>',
  true,
  NULL
);
*/

-- ============================================================
-- PASO 5: REPLICAR CURSOS Y MATERIAS A NUEVO COLEGIO
-- Ejecutar cada vez que se crea un nuevo colegio
-- ============================================================

/*
INSERT INTO cursos (nivel, grado, paralelo, activo, colegio_id)
SELECT nivel, grado, paralelo, activo, '<UUID_NUEVO_COLEGIO>'
FROM cursos
WHERE colegio_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, '<UUID_NUEVO_COLEGIO>'
FROM materias
WHERE colegio_id = '00000000-0000-0000-0000-000000000001';
*/