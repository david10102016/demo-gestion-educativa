-- ─────────────────────────────────────────────────────────
-- 040 — RPC para eliminar notas
-- Problema: profesor intenta eliminar notas desde frontend con DELETE directo,
-- pero RLS solo permite escritura via RPC. No había RPC de DELETE.
-- Solución: crear rpc_delete_nota() con permisos y auditoría
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_delete_nota(
  p_actividad_id  UUID,
  p_estudiante_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actividad   RECORD;
  v_asignado    BOOLEAN;
  v_nota_id     UUID;
  v_old_valor   NUMERIC;
BEGIN
  -- Verificar que el llamante es profesor o director
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos para eliminar notas';
  END IF;

  -- Obtener actividad
  SELECT * INTO v_actividad FROM public.actividades WHERE id = p_actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- Si es profesor, verificar asignación
  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor
      WHERE profesor_id = auth.uid()
        AND materia_id = v_actividad.materia_id
        AND curso_id = v_actividad.curso_id
        AND activo = true
    ) INTO v_asignado;

    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia/curso';
    END IF;
  END IF;

  -- Obtener nota y su valor para auditoría, luego eliminarla
  SELECT id, valor INTO v_nota_id, v_old_valor FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  IF NOT FOUND THEN
    -- No existe nota, retorna ok sin error
    RETURN jsonb_build_object('ok', true, 'message', 'Nota no encontrada, nada que eliminar');
  END IF;

  -- Eliminar
  DELETE FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  -- Auditoría
  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id, datos_antes, datos_despues)
  VALUES (
    auth.uid(), 'profesor', 'delete_nota', 'notas', v_nota_id,
    jsonb_build_object('valor', v_old_valor),
    jsonb_build_object('valor', NULL)
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Nota eliminada', 'valor_anterior', v_old_valor);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_nota TO authenticated;

COMMENT ON FUNCTION public.rpc_delete_nota IS 'Elimina una nota de un estudiante en una actividad. Solo acceso vía RPC, con validación de asignación profesor y auditoría.';
