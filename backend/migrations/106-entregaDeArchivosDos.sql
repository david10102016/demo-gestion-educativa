-- 106 — Entregas de tareas: hasta 2 archivos por estudiante y actividad
-- Antes: UNIQUE (estudiante_id, actividad_id) = un solo archivo (subir otro lo reemplazaba).
-- Ahora: cada archivo es una fila; un trigger impide pasar de 2.
-- Las reglas de acceso (RLS) no cambian: ya trabajan por fila.

alter table public.entregas_tareas drop constraint if exists entregas_tareas_est_act_key;

create index if not exists entregas_tareas_est_act_idx
  on public.entregas_tareas (estudiante_id, actividad_id);

create or replace function public.entregas_max_dos()
returns trigger language plpgsql security definer
set search_path to 'public'
as $$
begin
  -- Evita que dos subidas simultáneas pasen el límite
  perform pg_advisory_xact_lock(hashtext(new.estudiante_id::text || new.actividad_id::text));
  if (select count(*) from entregas_tareas
      where estudiante_id = new.estudiante_id and actividad_id = new.actividad_id) >= 2 then
    raise exception 'Máximo 2 archivos por entrega' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists entregas_max_dos on public.entregas_tareas;
create trigger entregas_max_dos
  before insert on public.entregas_tareas
  for each row execute function public.entregas_max_dos();