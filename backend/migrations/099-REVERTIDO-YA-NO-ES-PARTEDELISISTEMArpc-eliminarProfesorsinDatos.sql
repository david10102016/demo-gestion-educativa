-- ============================================================
-- REVERTIDA: no aplicar. Desactivar cubre el caso de uso; el borrado duro chocaba con varias FK
-- (actividades, bitácora, SER, comunicados, etc.) y no justifica el mantenimiento en producción multitenant.
-- MIGRACIÓN 099: RPC eliminar_profesor , se asigno el 099 porque ya no forma parte del sistema
-- Aditivo. No modifica tablas ni vistas existentes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.eliminar_profesor(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_llamante   public.usuarios%ROWTYPE;
  v_objetivo   public.usuarios%ROWTYPE;
  v_n_asis     int;
  v_n_notas    int;
BEGIN
  -- 1) Quién llama
  SELECT * INTO v_llamante
  FROM public.usuarios
  WHERE id = auth.uid();

  IF NOT FOUND OR v_llamante.activo IS NOT TRUE
     OR v_llamante.rol NOT IN ('director', 'superadmin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos');
  END IF;

  -- 2) Objetivo
  SELECT * INTO v_objetivo
  FROM public.usuarios
  WHERE id = p_usuario_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuario no encontrado');
  END IF;

  IF v_objetivo.rol IS DISTINCT FROM 'profesor' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo se pueden eliminar profesores');
  END IF;

  -- 3) Multitenant: director solo su colegio
  IF v_llamante.rol = 'director'
     AND v_objetivo.colegio_id IS DISTINCT FROM v_llamante.colegio_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos sobre ese usuario');
  END IF;

  -- 4) ¿Tiene asistencias?
  SELECT count(*) INTO v_n_asis
  FROM public.asistencias_materia
  WHERE profesor_id = p_usuario_id;

  -- 5) ¿Tiene notas en actividades que creó?
  SELECT count(*) INTO v_n_notas
  FROM public.notas n
  WHERE n.actividad_id IN (
    SELECT a.id FROM public.actividades a WHERE a.creado_por = p_usuario_id
  );

  IF v_n_asis > 0 OR v_n_notas > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Tiene asistencias o notas registradas. Solo puede desactivarlo.'
    );
  END IF;

  -- 6) Asignaciones
  DELETE FROM public.asignaciones_profesor
  WHERE profesor_id = p_usuario_id;

  -- 7) Perfil
  DELETE FROM public.usuarios
  WHERE id = p_usuario_id;

  -- 8) Auth
  DELETE FROM auth.users
  WHERE id = p_usuario_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_profesor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_profesor(uuid) TO authenticated;

COMMENT ON FUNCTION public.eliminar_profesor(uuid) IS
  'Elimina profesor sin datos (asistencias/notas). Director solo su colegio. También borra auth.users.';