-- ─────────────────────────────────────────────────────────
-- 020 — Seguridad en vinculación tutor-estudiante por carnet
-- Aditivo: no modifica tablas, políticas ni datos existentes.
-- Agrega: tabla de control de intentos + 2 funciones SECURITY DEFINER
-- ─────────────────────────────────────────────────────────

-- Tabla de control de intentos (rate limiting)
CREATE TABLE IF NOT EXISTS public.intentos_busqueda_carnet (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.intentos_busqueda_carnet ENABLE ROW LEVEL SECURITY;
-- Sin políticas: nadie accede directo a esta tabla, solo las funciones de abajo.

CREATE INDEX IF NOT EXISTS idx_intentos_tutor_fecha
  ON public.intentos_busqueda_carnet(tutor_id, created_at);

-- ─────────────────────────────────────────────────────────
-- Función: buscar_estudiante_por_carnet
-- Reemplaza el SELECT directo desde el frontend.
-- Aplica: límite de 5 intentos/hora + restricción de colegio
-- si el tutor ya tiene uno o más hijos vinculados.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.buscar_estudiante_por_carnet(p_carnet TEXT)
RETURNS TABLE (
  id         UUID,
  carnet     TEXT,
  nombre     TEXT,
  curso      TEXT,
  nivel      TEXT,
  colegio_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intentos       INT;
  v_colegio_tutor  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  SELECT COUNT(*) INTO v_intentos
  FROM public.intentos_busqueda_carnet
  WHERE tutor_id = auth.uid()
    AND created_at > NOW() - INTERVAL '1 hour';

  IF v_intentos >= 5 THEN
    RAISE EXCEPTION 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
  END IF;

  INSERT INTO public.intentos_busqueda_carnet (tutor_id) VALUES (auth.uid());

  SELECT tf.colegio_id INTO v_colegio_tutor
  FROM public.tutores_familia tf
  WHERE tf.id = auth.uid();

  RETURN QUERY
  SELECT e.id, e.carnet, u.nombre_completo, c.nombre_completo, c.nivel, e.colegio_id
  FROM public.estudiantes e
  JOIN public.usuarios u ON u.id = e.id
  LEFT JOIN public.cursos c ON c.id = e.curso_id
  WHERE e.carnet = TRIM(p_carnet)
    AND (v_colegio_tutor IS NULL OR e.colegio_id = v_colegio_tutor);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_estudiante_por_carnet(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- Función: vincular_hijo_seguro
-- Reemplaza el INSERT directo a tutor_estudiante desde el frontend.
-- Si es el primer hijo del tutor, fija su colegio_id automáticamente.
-- Si ya tiene colegio_id fijado, bloquea vínculos de otro colegio.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vincular_hijo_seguro(
  p_estudiante_id UUID,
  p_parentesco    TEXT DEFAULT 'padre'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_tutor      UUID;
  v_existe             UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
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

  INSERT INTO public.tutor_estudiante (tutor_id, estudiante_id, parentesco)
  VALUES (auth.uid(), p_estudiante_id, p_parentesco);

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vincular_hijo_seguro(UUID, TEXT) TO authenticated;