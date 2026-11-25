-- 048-fix-select-actividades-tecnicas.sql
-- ─────────────────────────────────────────────────────────
-- 048 — actividades_select_colegio no mostraba actividades de
-- materias técnicas (curso_id NULL)
--
-- Problema: al migrar el historial de Sistemas Informáticos (16
-- actividades, T1 y T2) desde el sistema viejo de Juana Azurduy hacia
-- el sistema multitenant, las actividades quedaron con curso_id NULL
-- — correcto para materias técnicas, ya que agrupan estudiantes de
-- varios paralelos (6°A y 6°B) sin pertenecer a un curso único.
--
-- La policy de SELECT existente exigía:
--   EXISTS (SELECT 1 FROM cursos c WHERE c.id = actividades.curso_id
--           AND c.colegio_id = mi_colegio_id())
-- Con curso_id NULL, ese EXISTS nunca es verdadero — la policy
-- bloqueaba las 16 actividades por completo, incluso para el propio
-- profesor dueño de ellas. Confirmado en vivo: 0 resultados en la
-- interfaz (con y sin caché, con y sin incógnito) pese a que las
-- filas existían y creado_por/materia_id/trimestre eran correctos.
--
-- Nota: el mismo patrón faltante ya existía corregido en
-- actividades_update_profesor (usa materias.es_tecnica) — este fix
-- lleva el SELECT al mismo nivel.
--
-- Solución: se agrega un OR a la policy existente. Para materias
-- técnicas (curso_id IS NULL), el aislamiento por colegio pasa a
-- validarse contra materias.colegio_id en vez de cursos.colegio_id.
-- El chequeo original por curso queda intacto para el resto de las
-- materias. Sin riesgo de recursión: ni materias ni cursos tienen
-- policies que referencien actividades.
-- ─────────────────────────────────────────────────────────

alter policy "actividades_select_colegio"
on public.actividades
using (
  exists (select 1 from cursos c where c.id = actividades.curso_id and c.colegio_id = mi_colegio_id())
  or
  (actividades.curso_id is null and exists (select 1 from materias m where m.id = actividades.materia_id and m.colegio_id = mi_colegio_id()))
);

-- ─────────────────────────────────────────────────────────
-- Pendiente, no urgente (mismo patrón, menor impacto porque no se usa
-- todavía sobre filas con curso_id NULL): actividades_delete_director
-- y actividades_update_profesor (esta última YA corregida) comparten
-- el mismo tipo de EXISTS contra cursos. Si en el futuro se necesita
-- editar/borrar una actividad técnica con curso_id NULL, revisar ese
-- mismo punto.
--
-- Verificación post-migración:
-- select policyname, qual from pg_policies
-- where tablename = 'actividades' and policyname = 'actividades_select_colegio';
-- Probar en vivo: panel de Juan David (Juana Azurduy), materia
-- Sistemas Informáticos -> deben verse las 16 actividades en T1/T2.
-- ─────────────────────────────────────────────────────────