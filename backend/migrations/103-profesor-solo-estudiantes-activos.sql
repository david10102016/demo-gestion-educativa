-- 103 · Profesor: solo ve estudiantes con usuario activo (retirados = usuarios.activo false)
-- Solo cambia lo que ve el PROFESOR. Director, secretaria, tutor y estudiante: sin cambios.
-- No modifica ni borra datos: al reactivar, todo vuelve a aparecer.
begin;

-- Sin sesión devuelve false (no revela nada). SECURITY DEFINER evita recursión de RLS.
create or replace function public.usuario_activo(p_id uuid)
returns boolean language sql stable security definer
set search_path to 'public'
as $$ select case when auth.uid() is null then false
             else coalesce((select activo from public.usuarios where id = p_id), false) end $$;
grant execute on function public.usuario_activo(uuid) to anon, authenticated;

-- estudiantes
drop policy if exists estudiantes_select_profesor on public.estudiantes;
create policy estudiantes_select_profesor on public.estudiantes
  for select using (
    es_profesor() AND (colegio_id = mi_colegio_id())
    AND public.usuario_activo(estudiantes.id)
    AND (EXISTS ( SELECT 1 FROM asignaciones_profesor ap
                  WHERE ap.profesor_id = auth.uid() AND ap.curso_id = estudiantes.curso_id AND ap.activo = true)));

-- inscripciones_tecnicas
drop policy if exists inscripciones_select on public.inscripciones_tecnicas;
create policy inscripciones_select on public.inscripciones_tecnicas
  for select using (
    (estudiante_id = auth.uid())
    OR (es_director() AND (EXISTS ( SELECT 1 FROM estudiantes e
          WHERE e.id = inscripciones_tecnicas.estudiante_id AND e.colegio_id = mi_colegio_id())))
    OR (es_profesor() AND public.usuario_activo(inscripciones_tecnicas.estudiante_id)
        AND (EXISTS ( SELECT 1 FROM estudiantes e
          WHERE e.id = inscripciones_tecnicas.estudiante_id AND e.colegio_id = mi_colegio_id()))));

-- asistencias_materia (lectura y escritura del profesor; la de escritura es ALL y también da lectura)
drop policy if exists asistencias_materia_select_profesor on public.asistencias_materia;
create policy asistencias_materia_select_profesor on public.asistencias_materia
  for select using (
    (profesor_id = auth.uid())
    AND public.usuario_activo(asistencias_materia.estudiante_id)
    AND (EXISTS ( SELECT 1 FROM asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid() AND ap.curso_id = asistencias_materia.curso_id
        AND ap.materia_id = asistencias_materia.materia_id AND ap.activo = true)));

drop policy if exists asistencias_materia_write_profesor on public.asistencias_materia;
create policy asistencias_materia_write_profesor on public.asistencias_materia
  for all using (
    (profesor_id = auth.uid())
    AND public.usuario_activo(asistencias_materia.estudiante_id)
    AND (EXISTS ( SELECT 1 FROM asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid() AND ap.curso_id = asistencias_materia.curso_id
        AND ap.materia_id = asistencias_materia.materia_id AND ap.activo = true)))
  with check (
    (profesor_id = auth.uid())
    AND public.usuario_activo(asistencias_materia.estudiante_id)
    AND (EXISTS ( SELECT 1 FROM asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid() AND ap.curso_id = asistencias_materia.curso_id
        AND ap.materia_id = asistencias_materia.materia_id AND ap.activo = true)));

-- calificaciones (Ser/Decidir): solo la rama del profesor cambia
drop policy if exists calificaciones_select_profesor on public.calificaciones;
create policy calificaciones_select_profesor on public.calificaciones
  for select using (
    ((EXISTS ( SELECT 1 FROM asignaciones_profesor ap
        WHERE ap.profesor_id = auth.uid() AND ap.materia_id = calificaciones.materia_id AND ap.activo = true))
      AND public.usuario_activo(calificaciones.estudiante_id))
    OR es_director() OR (estudiante_id = auth.uid()));

-- notas
drop policy if exists notas_select_profesor on public.notas;
create policy notas_select_profesor on public.notas
  for select using (
    public.usuario_activo(notas.estudiante_id)
    AND (EXISTS ( SELECT 1
      FROM asignaciones_profesor ap
      JOIN actividades a ON a.id = notas.actividad_id
      JOIN materias m ON m.id = a.materia_id
      WHERE ap.profesor_id = auth.uid() AND ap.materia_id = a.materia_id AND ap.activo = true
        AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id))
          OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1 FROM inscripciones_tecnicas it
                WHERE it.estudiante_id = notas.estudiante_id AND it.materia_id = a.materia_id AND it.activo = true)))))));

drop policy if exists notas_select_profesor_traslado on public.notas;
create policy notas_select_profesor_traslado on public.notas
  for select to authenticated using (
    public.usuario_activo(notas.estudiante_id)
    AND (EXISTS ( SELECT 1
      FROM actividades a
      JOIN materias m ON m.id = a.materia_id
      JOIN estudiantes e ON e.id = notas.estudiante_id
      JOIN asignaciones_profesor ap ON ap.profesor_id = auth.uid() AND ap.materia_id = a.materia_id
                                   AND ap.curso_id = e.curso_id AND ap.activo = true
      WHERE a.id = notas.actividad_id AND m.es_tecnica IS NOT TRUE)));

commit;