-- =====================================================================
-- 101 · Licencias de estudiantes + verificación de tutores + permisos delegados
-- Aditiva. Único cambio a lo existente:
--   · tutor_estudiante.parentesco acepta más valores (los actuales siguen válidos)
--   · vincular_hijo_seguro exige que el tutor haya registrado su carnet (solo vínculos NUEVOS)
-- Sin FKs nuevas hacia usuarios (evita "more than one relationship" en PostgREST).
-- Todas las escrituras de tutores pasan por funciones SECURITY DEFINER (sin INSERT/UPDATE directo).
-- Ajustes de revision frente al borrador del informe:
--   · Storage: la subcarpeta 'carnet' solo se lee con vinculos.revisar y 'licencias' solo con licencias.aprobar
--   · Indice unico parcial: una sola licencia pendiente por estudiante (evita la carrera entre 2 tutores)
--   · solicitar_licencia exige tambien estudiantes.estado = 'activo' (ademas de usuarios.activo)
--   · REVOKE EXECUTE a PUBLIC y anon solo en las 5 funciones que escriben (criterio de las migraciones 023, 029 y 031).
--     tiene_permiso y hoy_bolivia quedan abiertas: tiene_permiso se evalua dentro de politicas de licencias, permisos_usuario,
--     tutor_verificacion y storage.objects; si anon no pudiera ejecutarla, cualquier consulta sin sesion a esas tablas
--     (o a storage.objects) fallaria con "permission denied for function". Sin sesion auth.uid() es nulo y devuelve false.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Fecha de hoy en Bolivia
-- ---------------------------------------------------------------------
create or replace function public.hoy_bolivia()
returns date language sql stable
as $$ select (now() at time zone 'America/La_Paz')::date $$;

-- ---------------------------------------------------------------------
-- 1. Parentesco: se amplía la lista (aditivo)
-- ---------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.tutor_estudiante'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%parentesco%'
  loop
    execute format('alter table public.tutor_estudiante drop constraint %I', c);
  end loop;
end $$;

alter table public.tutor_estudiante
  add constraint tutor_estudiante_parentesco_check
  check (parentesco = any (array['padre','madre','tutor_legal','otro',
                                 'abuelo','abuela','tio','tia','hermano','hermana']));

-- ---------------------------------------------------------------------
-- 2. Permisos delegados por el director (secretaria / regente)
-- ---------------------------------------------------------------------
create table if not exists public.permisos_usuario (
  usuario_id   uuid not null,
  colegio_id   uuid not null,
  permiso      text not null check (permiso in ('licencias.aprobar','vinculos.revisar')),
  otorgado_por uuid,
  created_at   timestamptz not null default now(),
  primary key (usuario_id, permiso)
);
alter table public.permisos_usuario enable row level security;

-- El director siempre tiene todos los permisos; el resto, solo si se los otorgaron y sigue activo
create or replace function public.tiene_permiso(p_permiso text)
returns boolean language sql stable security definer
set search_path to 'public', 'auth'
as $$
  select public.es_director() or exists (
    select 1 from public.permisos_usuario pu
    join public.usuarios u on u.id = pu.usuario_id
    where pu.usuario_id = auth.uid() and pu.permiso = p_permiso
      and u.activo = true and u.rol in ('secretaria','regente')
      and pu.colegio_id = u.colegio_id
  );
$$;

drop policy if exists permisos_select_director on public.permisos_usuario;
create policy permisos_select_director on public.permisos_usuario
  for select using (es_director() and colegio_id = mi_colegio_id());
drop policy if exists permisos_select_propio on public.permisos_usuario;
create policy permisos_select_propio on public.permisos_usuario
  for select using (usuario_id = auth.uid());
drop policy if exists permisos_insert_director on public.permisos_usuario;
create policy permisos_insert_director on public.permisos_usuario
  for insert with check (
    es_director() and colegio_id = mi_colegio_id()
    and exists (select 1 from public.usuarios u
                where u.id = usuario_id and u.colegio_id = mi_colegio_id()
                  and u.rol in ('secretaria','regente'))
  );
drop policy if exists permisos_delete_director on public.permisos_usuario;
create policy permisos_delete_director on public.permisos_usuario
  for delete using (es_director() and colegio_id = mi_colegio_id());

-- ---------------------------------------------------------------------
-- 3. Verificación del tutor (carnet anverso/reverso, una sola vez por cuenta)
--    Tabla aparte: tutores_familia permite UPDATE al propio tutor y no debe poder "auto-revisarse"
-- ---------------------------------------------------------------------
create table if not exists public.tutor_verificacion (
  tutor_id        uuid primary key,
  parentesco      text not null check (parentesco = any (array['padre','madre','tutor_legal','otro',
                                 'abuelo','abuela','tio','tia','hermano','hermana'])),
  ci_anverso      text,          -- ruta en el bucket documentos-tutores (se borra al revisar)
  ci_reverso      text,
  estado          text not null default 'pendiente' check (estado in ('pendiente','revisado','rechazado')),
  revisado_por    uuid,
  revisado_en     timestamptz,
  motivo_rechazo  text,
  nota            text check (nota is null or char_length(nota) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.tutor_verificacion enable row level security;

drop policy if exists verif_select_propio on public.tutor_verificacion;
create policy verif_select_propio on public.tutor_verificacion
  for select using (tutor_id = auth.uid());
drop policy if exists verif_select_staff on public.tutor_verificacion;
create policy verif_select_staff on public.tutor_verificacion
  for select using (
    tiene_permiso('vinculos.revisar')
    and exists (select 1 from public.tutores_familia tf
                where tf.id = tutor_verificacion.tutor_id and tf.colegio_id = mi_colegio_id())
  );

-- El tutor registra (o vuelve a registrar si fue rechazado) su carnet
create or replace function public.registrar_verificacion_tutor(p_parentesco text, p_anverso text, p_reverso text)
returns boolean language plpgsql security definer
set search_path to 'public'
as $$
declare v_estado text;
begin
  if auth.uid() is null or not es_tutor() then raise exception 'Solo un tutor puede registrar su carnet'; end if;
  if coalesce(p_anverso,'') = '' or coalesce(p_reverso,'') = '' then
    raise exception 'Debes adjuntar las dos caras del carnet (anverso y reverso)';
  end if;
  if split_part(p_anverso,'/',1) <> auth.uid()::text or split_part(p_reverso,'/',1) <> auth.uid()::text then
    raise exception 'Ruta de archivo no válida';
  end if;

  select estado into v_estado from public.tutor_verificacion where tutor_id = auth.uid();
  if v_estado in ('pendiente','revisado') then
    raise exception 'Tu carnet ya está registrado';
  end if;

  insert into public.tutor_verificacion (tutor_id, parentesco, ci_anverso, ci_reverso, estado)
  values (auth.uid(), p_parentesco, p_anverso, p_reverso, 'pendiente')
  on conflict (tutor_id) do update
    set parentesco = excluded.parentesco, ci_anverso = excluded.ci_anverso, ci_reverso = excluded.ci_reverso,
        estado = 'pendiente', motivo_rechazo = null, nota = null, revisado_por = null, revisado_en = null,
        updated_at = now();
  return true;
end $$;

-- Dirección revisa: aceptar (se borran las rutas de las fotos) o rechazar (se desactivan sus vínculos)
-- Devuelve las rutas de las fotos para que el panel las elimine del bucket.
create or replace function public.revisar_vinculacion(p_tutor_id uuid, p_aceptar boolean,
                                                      p_motivo text default null, p_nota text default null)
returns json language plpgsql security definer
set search_path to 'public'
as $$
declare v record;
begin
  if not tiene_permiso('vinculos.revisar') then raise exception 'Sin permiso para revisar vinculaciones'; end if;
  select tv.* into v from public.tutor_verificacion tv
  join public.tutores_familia tf on tf.id = tv.tutor_id
  where tv.tutor_id = p_tutor_id and tf.colegio_id = mi_colegio_id();
  if v.tutor_id is null then raise exception 'Vinculación no encontrada'; end if;
  if v.estado <> 'pendiente' then raise exception 'Esta vinculación ya fue revisada'; end if;

  if p_aceptar then
    update public.tutor_verificacion
      set estado = 'revisado', revisado_por = auth.uid(), revisado_en = now(),
          ci_anverso = null, ci_reverso = null, nota = nullif(trim(coalesce(p_nota,'')),''), updated_at = now()
      where tutor_id = p_tutor_id;
  else
    if p_motivo is null or p_motivo not in ('carnet_ilegible','no_corresponde','parentesco_no_valido','presentarse_direccion','otro') then
      raise exception 'Elige un motivo de rechazo';
    end if;
    update public.tutor_verificacion
      set estado = 'rechazado', revisado_por = auth.uid(), revisado_en = now(),
          ci_anverso = null, ci_reverso = null, motivo_rechazo = p_motivo,
          nota = nullif(trim(coalesce(p_nota,'')),''), updated_at = now()
      where tutor_id = p_tutor_id;
    update public.tutor_estudiante te set activo = false
      where te.tutor_id = p_tutor_id and colegio_de_estudiante(te.estudiante_id) = mi_colegio_id();
  end if;
  return json_build_object('anverso', v.ci_anverso, 'reverso', v.ci_reverso);
end $$;

-- ---------------------------------------------------------------------
-- 4. vincular_hijo_seguro: igual que antes + exige carnet registrado (solo vínculos nuevos)
-- ---------------------------------------------------------------------
create or replace function public.vincular_hijo_seguro(p_estudiante_id uuid, p_parentesco text default 'padre')
returns boolean language plpgsql security definer
set search_path to 'public'
as $function$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_tutor      UUID;
  v_existe             UUID;
  v_total_tutores      INT;
  v_verif              TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  -- NUEVO (101): antes de vincular, el tutor debe registrar su carnet (una sola vez por cuenta)
  SELECT estado INTO v_verif FROM public.tutor_verificacion WHERE tutor_id = auth.uid();
  IF v_verif IS NULL THEN
    RAISE EXCEPTION 'Antes de vincular, registra tu carnet de identidad (anverso y reverso).';
  ELSIF v_verif = 'rechazado' THEN
    RAISE EXCEPTION 'Tu registro fue observado por dirección. Vuelve a registrar tu carnet o acércate al colegio.';
  END IF;

  SELECT colegio_id INTO v_colegio_estudiante
  FROM public.estudiantes WHERE id = p_estudiante_id;

  IF v_colegio_estudiante IS NULL THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;

  SELECT colegio_id INTO v_colegio_tutor
  FROM public.tutores_familia WHERE id = auth.uid();

  IF v_colegio_tutor IS NULL THEN
    UPDATE public.tutores_familia SET colegio_id = v_colegio_estudiante WHERE id = auth.uid();
    UPDATE public.usuarios        SET colegio_id = v_colegio_estudiante WHERE id = auth.uid();
  ELSIF v_colegio_tutor <> v_colegio_estudiante THEN
    RAISE EXCEPTION 'Este estudiante pertenece a otro colegio y no puede vincularse a tu cuenta.';
  END IF;

  SELECT te.id INTO v_existe
  FROM public.tutor_estudiante te
  WHERE te.tutor_id = auth.uid() AND te.estudiante_id = p_estudiante_id;

  IF v_existe IS NOT NULL THEN
    RAISE EXCEPTION 'Este estudiante ya está vinculado a tu cuenta';
  END IF;

  SELECT COUNT(*) INTO v_total_tutores
  FROM public.tutor_estudiante
  WHERE estudiante_id = p_estudiante_id AND activo = true;

  IF v_total_tutores >= 2 THEN
    RAISE EXCEPTION 'Este estudiante ya tiene el máximo de tutores permitidos. Si necesitas vincular a un tercer familiar (ej. tutor legal), contacta a dirección del colegio.';
  END IF;

  INSERT INTO public.tutor_estudiante (tutor_id, estudiante_id, parentesco)
  VALUES (auth.uid(), p_estudiante_id, p_parentesco);

  RETURN TRUE;
END;
$function$;

-- ---------------------------------------------------------------------
-- 5. Licencias
-- ---------------------------------------------------------------------
create table if not exists public.licencias (
  id               uuid primary key default gen_random_uuid(),
  colegio_id       uuid not null,
  estudiante_id    uuid not null,
  tutor_id         uuid not null,
  motivo           text not null check (motivo in ('emergencia','salud','viaje','academico','otro')),
  fecha_inicio     date not null,
  fecha_fin        date not null,
  descripcion      text not null check (char_length(descripcion) between 5 and 300),
  comprobante      text,                       -- ruta en documentos-tutores
  estado           text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','cancelada')),
  motivo_respuesta text check (motivo_respuesta is null or motivo_respuesta in
                     ('comprobante_ilegible','fuera_de_plazo','falta_comprobante','limite_mes','presentarse_direccion','otro')),
  nota_respuesta   text check (nota_respuesta is null or char_length(nota_respuesta) <= 200),
  resuelto_por     uuid,
  resuelto_en      timestamptz,
  created_at       timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio)
);
create index if not exists licencias_colegio_estado_idx on public.licencias (colegio_id, estado);
create index if not exists licencias_estudiante_fechas_idx on public.licencias (estudiante_id, fecha_inicio, fecha_fin);
create unique index if not exists licencias_una_pendiente_idx on public.licencias (estudiante_id) where estado = 'pendiente';
alter table public.licencias enable row level security;

drop policy if exists licencias_select_tutor on public.licencias;
create policy licencias_select_tutor on public.licencias
  for select using (tutor_id = auth.uid());
drop policy if exists licencias_select_staff on public.licencias;
create policy licencias_select_staff on public.licencias
  for select using (tiene_permiso('licencias.aprobar') and colegio_id = mi_colegio_id());
-- Profesor: solo licencias APROBADAS de estudiantes de sus cursos (para precargar L)
drop policy if exists licencias_select_profesor on public.licencias;
create policy licencias_select_profesor on public.licencias
  for select using (
    estado = 'aprobada' and es_profesor() and colegio_id = mi_colegio_id()
    and exists (select 1 from public.estudiantes e
                join public.asignaciones_profesor ap on ap.curso_id = e.curso_id
                where e.id = licencias.estudiante_id and ap.profesor_id = auth.uid() and ap.activo = true)
  );
-- Regente: aprobadas de su colegio (portería)
drop policy if exists licencias_select_regente on public.licencias;
create policy licencias_select_regente on public.licencias
  for select using (estado = 'aprobada' and es_regente() and colegio_id = mi_colegio_id());
-- Estudiante: las suyas aprobadas
drop policy if exists licencias_select_estudiante on public.licencias;
create policy licencias_select_estudiante on public.licencias
  for select using (estado = 'aprobada' and estudiante_id = auth.uid());
-- Sin políticas de INSERT/UPDATE/DELETE: todo pasa por las funciones de abajo.

-- El tutor solicita
create or replace function public.solicitar_licencia(p_estudiante_id uuid, p_motivo text, p_inicio date, p_fin date,
                                                     p_descripcion text, p_comprobante text default null)
returns uuid language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_hoy date := hoy_bolivia();
  v_colegio uuid; v_verif text; v_id uuid; v_mes int;
begin
  if auth.uid() is null or not es_tutor() then raise exception 'Solo un tutor puede solicitar licencias'; end if;

  if not exists (select 1 from public.tutor_estudiante
                 where tutor_id = auth.uid() and estudiante_id = p_estudiante_id and activo = true) then
    raise exception 'Este estudiante no está vinculado a tu cuenta';
  end if;

  select estado into v_verif from public.tutor_verificacion where tutor_id = auth.uid();
  if v_verif is null then raise exception 'Antes de solicitar, registra tu carnet de identidad (anverso y reverso).'; end if;
  if v_verif = 'rechazado' then raise exception 'Tu registro fue observado por dirección. Acércate al colegio.'; end if;

  select e.colegio_id into v_colegio from public.estudiantes e
  join public.usuarios u on u.id = e.id
  where e.id = p_estudiante_id and u.activo = true and e.estado = 'activo';
  if v_colegio is null then raise exception 'El estudiante no está activo'; end if;

  if p_inicio is null or p_fin is null or p_fin < p_inicio then raise exception 'Fechas no válidas'; end if;
  if p_inicio < v_hoy then raise exception 'No se puede solicitar licencia para días pasados'; end if;
  if (p_fin - p_inicio) + 1 > 5 then raise exception 'La licencia puede ser de 5 días como máximo'; end if;
  if p_motivo = 'emergencia' and (p_inicio <> v_hoy or p_fin <> v_hoy) then
    raise exception 'Una emergencia solo se puede solicitar para el día de hoy';
  end if;
  if p_motivo = 'emergencia' and coalesce(p_comprobante,'') = '' then
    raise exception 'Para una emergencia debes adjuntar un comprobante';
  end if;
  if p_comprobante is not null and split_part(p_comprobante,'/',1) <> auth.uid()::text then
    raise exception 'Ruta de archivo no válida';
  end if;

  if exists (select 1 from public.licencias where estudiante_id = p_estudiante_id and estado = 'pendiente') then
    raise exception 'Ya tienes una solicitud pendiente para este estudiante';
  end if;

  select count(*) into v_mes from public.licencias
  where estudiante_id = p_estudiante_id and estado in ('pendiente','aprobada')
    and date_trunc('month', fecha_inicio) = date_trunc('month', p_inicio);
  if v_mes >= 4 then raise exception 'Se alcanzó el límite de 4 licencias en el mes para este estudiante'; end if;

  begin
    insert into public.licencias (colegio_id, estudiante_id, tutor_id, motivo, fecha_inicio, fecha_fin, descripcion, comprobante)
    values (v_colegio, p_estudiante_id, auth.uid(), p_motivo, p_inicio, p_fin, trim(p_descripcion), nullif(p_comprobante,''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una solicitud pendiente para este estudiante';
  end;
  return v_id;
end $$;

-- El tutor cancela una solicitud suya aún pendiente
create or replace function public.cancelar_licencia(p_id uuid)
returns boolean language plpgsql security definer
set search_path to 'public'
as $$
begin
  update public.licencias set estado = 'cancelada'
  where id = p_id and tutor_id = auth.uid() and estado = 'pendiente';
  if not found then raise exception 'Solo puedes cancelar solicitudes pendientes'; end if;
  return true;
end $$;

-- Dirección aprueba / rechaza
create or replace function public.resolver_licencia(p_id uuid, p_aprobar boolean,
                                                    p_motivo text default null, p_nota text default null)
returns boolean language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not tiene_permiso('licencias.aprobar') then raise exception 'Sin permiso para resolver licencias'; end if;
  if not p_aprobar and p_motivo is null then raise exception 'Elige un motivo de rechazo'; end if;
  update public.licencias
    set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
        motivo_respuesta = case when p_aprobar then null else p_motivo end,
        nota_respuesta = nullif(trim(coalesce(p_nota,'')),''),
        resuelto_por = auth.uid(), resuelto_en = now()
  where id = p_id and colegio_id = mi_colegio_id() and estado = 'pendiente';
  if not found then raise exception 'La licencia no existe o ya fue resuelta'; end if;
  return true;
end $$;

revoke execute on function
  public.registrar_verificacion_tutor(text,text,text), public.revisar_vinculacion(uuid,boolean,text,text),
  public.solicitar_licencia(uuid,text,date,date,text,text), public.cancelar_licencia(uuid),
  public.resolver_licencia(uuid,boolean,text,text) from public, anon;

grant execute on function public.hoy_bolivia(), public.tiene_permiso(text),
  public.registrar_verificacion_tutor(text,text,text), public.revisar_vinculacion(uuid,boolean,text,text),
  public.solicitar_licencia(uuid,text,date,date,text,text), public.cancelar_licencia(uuid),
  public.resolver_licencia(uuid,boolean,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Bucket privado para carnets y comprobantes: <tutor_id>/carnet/... y <tutor_id>/licencias/...
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-tutores', 'documentos-tutores', false, 2097152,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists doc_tutor_insert on storage.objects;
create policy doc_tutor_insert on storage.objects for insert
  with check (bucket_id = 'documentos-tutores' and es_tutor()
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists doc_tutor_select on storage.objects;
create policy doc_tutor_select on storage.objects for select
  using (bucket_id = 'documentos-tutores' and (
           (storage.foldername(name))[1] = auth.uid()::text
           or ((((storage.foldername(name))[2] = 'carnet'    and tiene_permiso('vinculos.revisar'))
                or ((storage.foldername(name))[2] = 'licencias' and tiene_permiso('licencias.aprobar')))
               and exists (select 1 from public.tutores_familia tf
                           where tf.id::text = (storage.foldername(name))[1] and tf.colegio_id = mi_colegio_id()))
         ));

drop policy if exists doc_tutor_delete on storage.objects;
create policy doc_tutor_delete on storage.objects for delete
  using (bucket_id = 'documentos-tutores' and (
           (storage.foldername(name))[1] = auth.uid()::text
           or (tiene_permiso('vinculos.revisar')
               and exists (select 1 from public.tutores_familia tf
                           where tf.id::text = (storage.foldername(name))[1] and tf.colegio_id = mi_colegio_id()))
         ));

commit;
