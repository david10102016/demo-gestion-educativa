-- ============================================================
-- MIGRACIÓN 062: Mecanismo de promoción de estudiantes
--
-- Aditiva: columna nueva con default, dos funciones nuevas que
-- nadie invoca hasta que se conecte el botón en el frontend.
-- No modifica ninguna tabla, policy ni función existente.
-- ============================================================
ALTER TABLE public.estudiantes
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo'
  CHECK (estado IN ('activo', 'egresado', 'retirado'));

CREATE OR REPLACE FUNCTION public.promover_estudiante(
  p_estudiante_id UUID,
  p_curso_destino_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_destino UUID;
BEGIN
  SELECT colegio_id INTO v_colegio_estudiante FROM public.estudiantes WHERE id = p_estudiante_id;
  SELECT colegio_id INTO v_colegio_destino FROM public.cursos WHERE id = p_curso_destino_id;
  IF v_colegio_estudiante IS NULL OR v_colegio_destino IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estudiante o curso destino no encontrado');
  END IF;
  IF v_colegio_estudiante <> v_colegio_destino THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El curso destino no pertenece al colegio del estudiante');
  END IF;
  IF public.es_superadmin() THEN
    -- sin restricción
  ELSIF public.es_director() AND v_colegio_estudiante = public.mi_colegio_id() THEN
    -- director solo sobre estudiantes de su propio colegio
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos sobre este estudiante');
  END IF;
  UPDATE public.estudiantes SET curso_id = p_curso_destino_id WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.promover_estudiante TO authenticated;

CREATE OR REPLACE FUNCTION public.marcar_egresado(p_estudiante_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_estudiante UUID;
BEGIN
  SELECT colegio_id INTO v_colegio_estudiante FROM public.estudiantes WHERE id = p_estudiante_id;
  IF v_colegio_estudiante IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estudiante no encontrado');
  END IF;
  IF public.es_superadmin() THEN
    -- sin restricción
  ELSIF public.es_director() AND v_colegio_estudiante = public.mi_colegio_id() THEN
    -- director solo sobre estudiantes de su propio colegio
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos sobre este estudiante');
  END IF;
  UPDATE public.estudiantes SET estado = 'egresado' WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.marcar_egresado TO authenticated;