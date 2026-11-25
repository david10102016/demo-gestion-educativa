-- Mantiene coherente el paralelo de origen de las inscripciones técnicas
-- cuando cambia el curso de un estudiante (desde cualquier pantalla o script).
create or replace function public.sync_curso_inscripciones_tecnicas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.curso_id is distinct from old.curso_id then
    update public.inscripciones_tecnicas
       set curso_id = new.curso_id
     where estudiante_id = new.id
       and activo = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_curso_inscripciones_tecnicas on public.estudiantes;
create trigger trg_sync_curso_inscripciones_tecnicas
after update of curso_id on public.estudiantes
for each row
execute function public.sync_curso_inscripciones_tecnicas();