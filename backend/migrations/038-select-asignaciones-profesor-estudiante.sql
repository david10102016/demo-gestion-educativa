-- 038-select-asignaciones-profesor-estudiante.sql
-- ============================================================================
-- Migración: SELECT en asignaciones_profesor para el rol estudiante
-- Fecha: 2026-07-13
-- Autor: Juan David
--
-- Problema:
--   El dashboard de estudiante ("Evaluar docente") mostraba "No tienes
--   profesores asignados aún" para todos los estudiantes, aunque los
--   profesores sí tenían asignaciones cargadas en asignaciones_profesor.
--   Causa: la tabla asignaciones_profesor solo tenía policy de SELECT para
--   profesor_id = auth.uid() OR es_director() — nunca contempló al rol
--   estudiante.
--
-- Intento fallido (para registro, NO se ejecuta en esta migración):
--   Un primer intento usó un EXISTS directo contra la tabla `estudiantes`
--   dentro del USING de la policy. Rompió el login de todos los estudiantes
--   con error 42P17 (infinite recursion detected in policy), porque
--   estudiantes_select_profesor ya consulta asignaciones_profesor, armando
--   un ciclo: asignaciones_profesor -> estudiantes -> asignaciones_profesor.
--   Se revirtió con `drop policy "asignaciones_select_estudiante" on
--   asignaciones_profesor;` y el login volvió a funcionar de inmediato.
--
-- Solución aplicada:
--   Igual que mi_colegio_id() y es_director(), se usa una función
--   SECURITY DEFINER (mi_curso_id()) para romper el ciclo: al ser
--   SECURITY DEFINER, la función no vuelve a disparar evaluación de RLS
--   sobre `estudiantes`, así que no hay recursión.
--
-- Este script es idempotente: puede correrse de nuevo sin error si ya
-- fue aplicado.
-- ============================================================================

-- 1. Función auxiliar: curso del estudiante logueado
create or replace function public.mi_curso_id()
returns uuid
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select curso_id from estudiantes where id = auth.uid();
$function$;

-- 2. Policy de SELECT para estudiantes (aditiva — no reemplaza ni afecta
--    a asignaciones_select_profesor ni a asignaciones_write_director,
--    ya que todas son PERMISSIVE y se combinan con OR)
drop policy if exists "asignaciones_select_estudiante" on public.asignaciones_profesor;

create policy "asignaciones_select_estudiante"
on public.asignaciones_profesor
for select
using (curso_id = mi_curso_id());

-- ============================================================================
-- Verificación post-migración:
--
-- select policyname, cmd, qual
-- from pg_policies
-- where tablename = 'asignaciones_profesor';
-- -> deben aparecer 3 policies: asignaciones_select_profesor,
--    asignaciones_write_director, asignaciones_select_estudiante
--
-- Probar login de un estudiante + panel "Evaluar docente" antes de dar
-- por cerrada la migración.
-- ============================================================================