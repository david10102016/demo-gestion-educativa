-- ─────────────────────────────────────────────────────────
-- 042 — Endurecimiento RLS en asistencias (mismo patrón que
-- la migración 037 aplicada a notas)
--
-- Hallazgo: asistencias_write_profesor / asistencias_update_profesor
-- validan que el profesor esté asignado al curso (profesor_asignado_curso),
-- pero nunca que el estudiante_id puntual pertenezca a ese curso_id.
-- Un profesor podía registrar/editar asistencia de un estudiante de
-- OTRO curso, indicando el curso_id donde sí está asignado.
--
-- Además, bloquear_asistencias_insert/update/delete son PERMISSIVE
-- (no declaradas AS RESTRICTIVE) — el candado de "gestión cerrada"
-- se combina por OR con la política de rol, no actúa como AND.
--
-- Fix: agrega verificación estudiante.curso_id = asistencias.curso_id
-- a las políticas de escritura de profesor, y convierte los 3
-- bloquear_asistencias_* a RESTRICTIVE.
--
-- Pendiente de verificar en vivo (mismo protocolo que 037):
-- 1. Profesor real intentando marcar asistencia a un estudiante de
--    otro curso, indicando su propio curso asignado -> debe dar 403.
-- 2. Flujo legítimo (profesor marcando asistencia real de su curso)
--    sigue funcionando sin cambios.
-- 3. Tutor/estudiante intentando INSERT directo -> debe seguir dando
--    403 (ya bloqueado por ausencia de política de rol, reforzado
--    ahora también por el RESTRICTIVE).
-- ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "asistencias_write_profesor" ON public.asistencias;
CREATE POLICY "asistencias_write_profesor"
ON public.asistencias FOR INSERT
WITH CHECK (
  public.es_profesor()
  AND public.profesor_asignado_curso(curso_id)
  AND EXISTS (
    SELECT 1 FROM public.cursos c
    WHERE c.id = asistencias.curso_id AND c.colegio_id = public.mi_colegio_id()
  )
  AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = asistencias.estudiante_id AND e.curso_id = asistencias.curso_id
  )
);

DROP POLICY IF EXISTS "asistencias_update_profesor" ON public.asistencias;
CREATE POLICY "asistencias_update_profesor"
ON public.asistencias FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.cursos c
    WHERE c.id = asistencias.curso_id AND c.colegio_id = public.mi_colegio_id()
  )
  AND (
    (public.es_profesor() AND public.profesor_asignado_curso(curso_id))
    OR public.es_director()
  )
  AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = asistencias.estudiante_id AND e.curso_id = asistencias.curso_id
  )
);

DROP POLICY IF EXISTS "bloquear_asistencias_insert" ON public.asistencias;
CREATE POLICY "bloquear_asistencias_insert" ON public.asistencias
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.config_gestion cg
    WHERE cg."año" = EXTRACT(year FROM asistencias.fecha)::integer
      AND cg.bloqueada = true
  )
);

DROP POLICY IF EXISTS "bloquear_asistencias_update" ON public.asistencias;
CREATE POLICY "bloquear_asistencias_update" ON public.asistencias
AS RESTRICTIVE
FOR UPDATE
USING (
  NOT EXISTS (
    SELECT 1 FROM public.config_gestion cg
    WHERE cg."año" = EXTRACT(year FROM asistencias.fecha)::integer
      AND cg.bloqueada = true
  )
);

DROP POLICY IF EXISTS "bloquear_asistencias_delete" ON public.asistencias;
CREATE POLICY "bloquear_asistencias_delete" ON public.asistencias
AS RESTRICTIVE
FOR DELETE
USING (
  NOT EXISTS (
    SELECT 1 FROM public.config_gestion cg
    WHERE cg."año" = EXTRACT(year FROM asistencias.fecha)::integer
      AND cg.bloqueada = true
  )
);