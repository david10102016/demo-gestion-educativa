begin;

alter policy calificaciones_select_profesor on public.calificaciones
using (
  (
    exists (
      select 1
      from public.asignaciones_profesor ap
      where ap.profesor_id = auth.uid()
        and ap.materia_id = calificaciones.materia_id
        and ap.activo = true
    )
    and public.usuario_activo(estudiante_id)
  )
  or (estudiante_id = auth.uid())
);

commit;