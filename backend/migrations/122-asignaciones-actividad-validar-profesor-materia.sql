-- ─────────────────────────────────────────────────────────
-- 122 — Asignaciones y actividades: profesor y materia del mismo colegio
--
-- Problema (hueco de integridad, severidad baja; informe de pruebas,
-- sección 6.1): tres políticas validaban solo que el CURSO fuera del colegio
-- de quien escribe, no el profesor ni la materia:
--   - asignaciones_write_director (todas las operaciones del director sobre
--     asignaciones_profesor): un director podía asignar a un profesor de otro
--     colegio, o una materia de otro colegio, en un curso propio.
--   - actividades_write_profesor (INSERT del profesor): podía crear una
--     actividad con una materia de otro colegio en su curso.
--   - actividades_update_profesor (UPDATE de profesor y director): podía
--     cambiar la materia de una actividad por una de otro colegio.
-- Comprobado en producción el 24-nov-2026 con rollback (director de Gloria II:
-- los dos inserts en asignaciones_profesor aceptados). En ese momento no daba
-- acceso a datos ajenos en ninguna dirección: es integridad, no fuga.
--
-- Datos previos (24-nov, producción): 0 materias sin colegio, 0 asignaciones
-- con profesor o materia de otro colegio, 0 actividades con materia de otro
-- colegio, 0 actividades sin curso. Ninguna fila existente queda fuera de la
-- regla nueva.
--
-- Corrección: se agrega WITH CHECK a las tres políticas. Se conserva todo lo
-- que ya validaban (USING sin cambios) y se suma:
--   - asignaciones: el profesor y la materia deben ser de mi_colegio_id().
--   - actividades (insert y update): la materia, si la hay, debe ser de
--     mi_colegio_id().
-- No toca datos ni otras políticas. Idempotente (ALTER POLICY).
--
-- Reversión: volver a crear las tres políticas sin WITH CHECK (texto original
-- en el volcado de estructura del 24-nov o en pg_policies antes de aplicar).
--
-- Historial (24-nov-2026):
--   - Primera versión aplicada a las 08:18: el WITH CHECK de asignaciones
--     consultaba public.usuarios directamente. La política
--     usuarios_select_profesor_estudiantes consulta asignaciones_profesor, y
--     eso causó "infinite recursion detected in policy" (42P17): el director
--     no podía insertar ni modificar asignaciones, ni siquiera las propias.
--     Detectado en la verificación de las 08:20.
--   - Versión final (este archivo): la comprobación del profesor pasa a una
--     función SECURITY DEFINER (profesor_es_de_mi_colegio), que lee usuarios
--     sin pasar por su RLS y corta el círculo. Probado en PostgreSQL 16 con la
--     política de usuarios que provocaba la recursión.
-- ─────────────────────────────────────────────────────────

BEGIN;

-- Comprueba que un usuario sea profesor del colegio de quien llama, leyendo
-- usuarios sin su RLS (evita la recursión con asignaciones_profesor).
CREATE OR REPLACE FUNCTION public.profesor_es_de_mi_colegio(p_profesor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = p_profesor_id
      AND u.colegio_id = public.mi_colegio_id()
  );
$$;

REVOKE ALL ON FUNCTION public.profesor_es_de_mi_colegio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profesor_es_de_mi_colegio(uuid) TO authenticated;

ALTER POLICY asignaciones_write_director ON public.asignaciones_profesor
  WITH CHECK (
    public.es_director()
    AND EXISTS (SELECT 1 FROM public.cursos c
                WHERE c.id = asignaciones_profesor.curso_id
                  AND c.colegio_id = public.mi_colegio_id())
    AND public.profesor_es_de_mi_colegio(asignaciones_profesor.profesor_id)
    AND EXISTS (SELECT 1 FROM public.materias m
                WHERE m.id = asignaciones_profesor.materia_id
                  AND m.colegio_id = public.mi_colegio_id())
  );

ALTER POLICY actividades_write_profesor ON public.actividades
  WITH CHECK (
    public.es_profesor()
    AND public.profesor_asignado_curso(curso_id)
    AND EXISTS (SELECT 1 FROM public.cursos c
                WHERE c.id = actividades.curso_id
                  AND c.colegio_id = public.mi_colegio_id())
    AND (actividades.materia_id IS NULL
         OR EXISTS (SELECT 1 FROM public.materias m
                    WHERE m.id = actividades.materia_id
                      AND m.colegio_id = public.mi_colegio_id()))
  );

ALTER POLICY actividades_update_profesor ON public.actividades
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.cursos c
            WHERE c.id = actividades.curso_id
              AND c.colegio_id = public.mi_colegio_id())
    AND ((public.es_profesor() AND actividades.creado_por = auth.uid()) OR public.es_director())
    AND (actividades.materia_id IS NULL
         OR EXISTS (SELECT 1 FROM public.materias m
                    WHERE m.id = actividades.materia_id
                      AND m.colegio_id = public.mi_colegio_id()))
  );

COMMIT;

-- Verificación (solo lee): las tres políticas deben tener with_check no nulo
-- select policyname, cmd, with_check is not null as tiene_with_check
-- from pg_policies
-- where schemaname = 'public'
--   and policyname in ('asignaciones_write_director','actividades_write_profesor','actividades_update_profesor');