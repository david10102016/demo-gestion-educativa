-- =====================================================================
-- 109 · Notas del hijo en el panel del padre (solo lectura)
-- Aditiva e idempotente. Crea UNA función nueva; no toca tablas, vistas ni políticas existentes.
--
-- Por qué una función y no abrir políticas:
--   · notas_finales es una vista security_invoker y las tablas notas, calificaciones y actividades
--     no tienen ninguna política de lectura para el tutor. Consultar la vista como tutor devuelve ceros.
--   · En vez de abrir esas tablas, esta función comprueba el vínculo y devuelve SOLO las notas
--     finales de ese hijo (la misma vista que usa el panel del estudiante).
--
-- Quién puede ver las notas de un hijo (todas las condiciones):
--   1. Sesión activa y usuario con rol 'tutor' activo.
--   2. Vínculo vigente en tutor_estudiante (activo = true) con ese estudiante.
--   3. Su carnet fue revisado por dirección (tutor_verificacion.estado = 'revisado').
--      (Misma verificación que ya exige solicitar_licencia; aquí se exige 'revisado', no 'pendiente'.)
--
-- Reversión:  DROP FUNCTION IF EXISTS public.notas_de_mi_hijo(uuid);
-- =====================================================================
begin;

create or replace function public.notas_de_mi_hijo(p_estudiante_id uuid)
returns table (
  materia_id     uuid,
  materia        text,
  trimestre      integer,
  promedio_hacer numeric,
  promedio_saber numeric,
  nota_ser       numeric,
  nota_decidir   numeric,
  nota_final     numeric
)
language plpgsql stable security definer
set search_path to 'public'
as $$
declare v_estado text;
begin
  if auth.uid() is null then
    raise exception 'No hay sesión activa';
  end if;

  if not exists (select 1 from public.usuarios u
                 where u.id = auth.uid() and u.rol = 'tutor' and u.activo = true) then
    raise exception 'Solo un tutor puede ver las notas de un hijo';
  end if;

  if not exists (select 1 from public.tutor_estudiante te
                 where te.tutor_id = auth.uid() and te.estudiante_id = p_estudiante_id and te.activo = true) then
    raise exception 'Este estudiante no está vinculado a tu cuenta';
  end if;

  -- Carnet del tutor: solo 'revisado' por dirección da acceso. El hint le dice a la pantalla qué mostrar.
  select tv.estado into v_estado from public.tutor_verificacion tv where tv.tutor_id = auth.uid();
  if v_estado is null then
    raise exception 'Para ver las notas primero registrá tu carnet de identidad (una sola vez).' using hint = 'sin_carnet';
  elsif v_estado = 'pendiente' then
    raise exception 'Tu carnet está en revisión por dirección. Cuando lo aprueben vas a ver las notas.' using hint = 'carnet_pendiente';
  elsif v_estado <> 'revisado' then
    raise exception 'Dirección observó tu registro. Registrá tu carnet de nuevo.' using hint = 'carnet_rechazado';
  end if;

  return query
    select nf.materia_id, nf.materia, nf.trimestre::integer,
           nf.promedio_hacer, nf.promedio_saber, nf.nota_ser, nf.nota_decidir, nf.nota_final
    from public.notas_finales nf
    where nf.estudiante_id = p_estudiante_id
      -- La vista gestion_activa toma UNA gestion cualquiera cuando se lee sin las reglas por colegio
      -- (como en esta funcion); se acota a los periodos de la gestion activa del colegio del hijo.
      and nf.trimestre <= coalesce(
            (select cg.cantidad_periodos from public.config_gestion cg
             where cg.colegio_id = nf.colegio_id and cg.estado = 'activo' limit 1), 3)
    order by nf.materia, nf.trimestre;
end
$$;

-- Solo usuarios con sesión (criterio de las migraciones 023, 029 y 031)
revoke execute on function public.notas_de_mi_hijo(uuid) from public;
revoke execute on function public.notas_de_mi_hijo(uuid) from anon;
grant  execute on function public.notas_de_mi_hijo(uuid) to authenticated;

commit;