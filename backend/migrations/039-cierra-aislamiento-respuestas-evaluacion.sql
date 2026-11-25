-- 039-cierra-aislamiento-respuestas-evaluacion.sql
-- ============================================================================
-- Migración: cierra hueco de aislamiento entre colegios en INSERT de
--            respuestas_evaluacion
-- Fecha: 2026-07-13
-- Autor: Juan David
--
-- Contexto:
--   Verificación de aislamiento multitenant tras la migración 038. Se revisó
--   si el mismo patrón de la migración 036 (función RPC sin filtro de
--   colegio_id, ver hallazgo en notas de fichas_seguimiento_ser /
--   get_config_año) se repetía en la sección de evaluación docente.
--   Se descartó ese patrón: ni respuestas_evaluacion ni
--   config_preguntas_docente pasan por ninguna función RPC — se
--   consultan/insertan directo contra la tabla, así que el aislamiento
--   depende 100% de RLS. config_preguntas_docente y las políticas de
--   SELECT de respuestas_evaluacion ya estaban correctamente acotadas por
--   colegio_id.
--
-- Problema encontrado:
--   El WITH CHECK de la policy "respuestas_insert_estudiante" (INSERT)
--   valida que el estudiante inserte con su propio estudiante_id, que la
--   evaluación esté activa, y que el profesor_id sea uno realmente
--   asignado al curso del estudiante — pero NO valida que la evaluación
--   (evaluacion_id) pertenezca al colegio del propio estudiante. Un
--   estudiante que conociera el UUID de una evaluación activa de otro
--   colegio podría, en teoría, insertar una respuesta contra esa campaña
--   ajena (siempre que el profesor_id siga siendo de su propio colegio).
--   No es una fuga de lectura, es un problema de integridad entre
--   colegios.
--
-- Solución:
--   Se agrega una función SECURITY DEFINER (mismo patrón que
--   mi_curso_id() de la migración 038) para evitar cualquier riesgo de
--   recursión al cruzar evaluaciones_docente -> usuarios dentro de la
--   policy, y se amplía el WITH CHECK existente con un AND adicional.
--   Cambio estrictamente restrictivo: las 3 condiciones que ya
--   funcionaban quedan intactas; la condición nueva solo puede bloquear
--   inserts que antes hubieran pasado, nunca habilitar algo nuevo.
--
-- Este script es idempotente (create or replace function + alter policy
-- pueden correrse de nuevo sin error).
-- ============================================================================

-- 1. Función auxiliar: ¿la evaluación pertenece a mi propio colegio?
create or replace function public.evaluacion_es_de_mi_colegio(p_evaluacion_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1
    from evaluaciones_docente e
    join usuarios u on u.id = e.activada_por
    where e.id = p_evaluacion_id
    and u.colegio_id = mi_colegio_id()
  );
$function$;

-- 2. Amplía el WITH CHECK existente (ALTER, no DROP+CREATE: sin ventana
--    sin protección). Las 3 condiciones originales quedan igual, se
--    agrega una cuarta con AND.
alter policy "respuestas_insert_estudiante"
on public.respuestas_evaluacion
with check (
  es_estudiante()
  and estudiante_id = auth.uid()
  and exists (
    select 1 from evaluaciones_docente e
    where e.id = respuestas_evaluacion.evaluacion_id
    and e.activa = true
  )
  and exists (
    select 1
    from asignaciones_profesor ap
    join estudiantes est on est.curso_id = ap.curso_id
    where ap.profesor_id = respuestas_evaluacion.profesor_id
    and est.id = auth.uid()
    and ap.activo = true
  )
  and evaluacion_es_de_mi_colegio(respuestas_evaluacion.evaluacion_id)
);

-- ============================================================================
-- Verificación post-migración:
--
-- select policyname, cmd, with_check
-- from pg_policies
-- where tablename = 'respuestas_evaluacion' and policyname = 'respuestas_insert_estudiante';
-- -> el with_check debe incluir evaluacion_es_de_mi_colegio(...) al final
--
-- PROBAR ANTES DE DAR POR CERRADO (flujo normal, dentro del mismo colegio):
-- 1. Login de un estudiante real (confirmar que el login no se ve afectado
--    — esta migración no toca usuarios ni sus policies, solo LEE de
--    usuarios vía función security definer, así que no debería, pero se
--    confirma igual).
-- 2. Ese estudiante entra a "Evaluar docente" y envía una evaluación
--    normal de su propio colegio -> debe funcionar exactamente igual que
--    antes (evaluacion_id y profesor_id de su propio colegio, la función
--    nueva devuelve true).
-- 3. (Opcional, si querés confirmar que el hueco se cerró) Intentar el
--    mismo tipo de prueba que se hizo para fichas_seguimiento_ser en la
--    migración 024: insertar una respuesta_evaluacion apuntando a un
--    evaluacion_id de otro colegio -> debe devolver 403 / RLS violation.
-- ============================================================================