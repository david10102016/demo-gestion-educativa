-- ============================================================
-- MIGRACIÓN 063: Historial de promociones (respaldo pre-cambio)
--
-- Aditiva: tabla nueva + una línea de INSERT dentro de las dos
-- funciones existentes de la 062 (promover_estudiante,
-- marcar_egresado), antes del UPDATE. No cambia su firma, su
-- forma de invocarlas, ni su respuesta JSONB. Cero cambios en
-- frontend/js.
--
-- El año que se guarda es el de la gestión activa en
-- config_gestion al momento de la acción (no el año calendario):
-- un cierre hecho en enero/febrero del año siguiente sigue
-- quedando registrado bajo la gestión que realmente se cerró.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.historial_promociones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id UUID NOT NULL REFERENCES public.estudiantes(id),
  colegio_id UUID NOT NULL,
  año INT NOT NULL,
  accion TEXT NOT NULL CHECK (accion IN ('promocion','egreso')),
  curso_anterior_id UUID,
  estado_anterior TEXT,
  realizado_por UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.historial_promociones ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde el panel. El INSERT lo hacen las funciones
-- SECURITY DEFINER de abajo, nunca el director ni el superadmin
-- directo -- por diseño, no hay policy de INSERT/UPDATE/DELETE.
CREATE POLICY historial_promociones_select ON public.historial_promociones
FOR SELECT USING (
  public.es_superadmin()
  OR (public.es_director() AND colegio_id = public.mi_colegio_id())
);

-- ── promover_estudiante: se agrega el INSERT antes del UPDATE ──
CREATE OR REPLACE FUNCTION public.promover_estudiante(
  p_estudiante_id UUID,
  p_curso_destino_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_destino UUID;
  v_año INT;
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

  SELECT año INTO v_año FROM public.config_gestion
  WHERE colegio_id = v_colegio_estudiante AND estado = 'activo' LIMIT 1;
  IF v_año IS NULL THEN v_año := EXTRACT(YEAR FROM now())::INT; END IF;

  INSERT INTO public.historial_promociones (estudiante_id, colegio_id, año, accion, curso_anterior_id, realizado_por)
  SELECT p_estudiante_id, v_colegio_estudiante, v_año, 'promocion', curso_id, auth.uid()
  FROM public.estudiantes WHERE id = p_estudiante_id;

  UPDATE public.estudiantes SET curso_id = p_curso_destino_id WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.promover_estudiante TO authenticated;

-- ── marcar_egresado: se agrega el INSERT antes del UPDATE ──
CREATE OR REPLACE FUNCTION public.marcar_egresado(p_estudiante_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_año INT;
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

  SELECT año INTO v_año FROM public.config_gestion
  WHERE colegio_id = v_colegio_estudiante AND estado = 'activo' LIMIT 1;
  IF v_año IS NULL THEN v_año := EXTRACT(YEAR FROM now())::INT; END IF;

  INSERT INTO public.historial_promociones (estudiante_id, colegio_id, año, accion, estado_anterior, realizado_por)
  SELECT p_estudiante_id, v_colegio_estudiante, v_año, 'egreso', estado, auth.uid()
  FROM public.estudiantes WHERE id = p_estudiante_id;

  UPDATE public.estudiantes SET estado = 'egresado' WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.marcar_egresado TO authenticated;