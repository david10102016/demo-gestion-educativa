-- 105 · Reabrir la entrega en línea cuando el profesor amplía la fecha de una actividad ya calificada
-- · actividades.fecha_cambiada_en: se llena SOLO cuando cambia fecha_limite u hora_limite
--   (cambiar título o descripción no reabre nada).
-- · notas.updated_at: fecha de la última calificación (al recalificar, se actualiza).
-- Regla en el panel del estudiante: la entrega está bloqueada si ya tiene nota,
-- salvo que la fecha se haya cambiado DESPUÉS de esa nota y siga vigente.
-- No cambia ninguna nota ni actividad existente (solo agrega columnas y triggers).
begin;

alter table public.actividades add column if not exists fecha_cambiada_en timestamptz;

alter table public.notas add column if not exists updated_at timestamptz;
update public.notas set updated_at = created_at where updated_at is null;
alter table public.notas alter column updated_at set default now();

create or replace function public.trg_actividad_fecha_cambiada()
returns trigger language plpgsql as $$
begin
  if new.fecha_limite is distinct from old.fecha_limite
     or new.hora_limite is distinct from old.hora_limite then
    new.fecha_cambiada_en := now();
  end if;
  return new;
end $$;

drop trigger if exists actividad_fecha_cambiada on public.actividades;
create trigger actividad_fecha_cambiada before update on public.actividades
  for each row execute function public.trg_actividad_fecha_cambiada();

create or replace function public.trg_nota_updated_at()
returns trigger language plpgsql as $$
begin
  if new.valor is distinct from old.valor then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists nota_updated_at on public.notas;
create trigger nota_updated_at before update on public.notas
  for each row execute function public.trg_nota_updated_at();

commit;