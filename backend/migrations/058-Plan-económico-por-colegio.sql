-- ============================================================
-- MIGRACIÓN 058: Plan económico por colegio — gate al botón
-- "Junta Trimestral" (reportes avanzados + certificado automático)
--
-- Alcance: solo ese botón queda condicionado al plan. El resto
-- (Exportar Excel, Bajo Rendimiento, Aprobados/Reprobados,
-- Calificar SER, Promedio Anual, actividades, etc.) se mantiene
-- libre por defecto, sin cambios.
-- ============================================================

-- 1. Columna nueva, aditiva, con default -- no afecta ninguna fila existente
ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'basico'
  CHECK (plan IN ('basico', 'avanzado'));

-- 2. Solo superadmin puede cambiar el plan de un colegio
--    (mismo patrón que proteger_colegio_tutor, migración 028)
CREATE OR REPLACE FUNCTION public.proteger_plan_colegio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar el plan de un colegio';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_plan_colegio ON public.colegios;
CREATE TRIGGER trg_proteger_plan_colegio
  BEFORE UPDATE ON public.colegios
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_plan_colegio();

-- 3. Exponer el plan en get_config_año() -- así el frontend ya lo
--    tiene disponible en window.APP_CONFIG sin una consulta aparte.
CREATE OR REPLACE FUNCTION public."get_config_año"("p_año" integer DEFAULT (EXTRACT(year FROM now()))::integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_gestion      RECORD;
  v_dimensiones  JSONB;
  v_subcriterios JSONB;
  v_escala       JSONB;
  v_periodos     JSONB;
  v_plan         TEXT;
BEGIN
  SELECT * INTO v_gestion FROM public.config_gestion
  WHERE año = p_año AND colegio_id = mi_colegio_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Gestión no encontrada para año ' || p_año);
  END IF;

  SELECT plan INTO v_plan FROM public.colegios WHERE id = mi_colegio_id();

  SELECT jsonb_agg(
    jsonb_build_object(
      'codigo', codigo, 'nombre', nombre_display,
      'peso_maximo', peso_maximo, 'tipo', tipo, 'orden', orden
    ) ORDER BY orden
  ) INTO v_dimensiones
  FROM public.config_dimensiones
  WHERE gestion_id = v_gestion.id AND activo = true;

  SELECT jsonb_agg(
    jsonb_build_object(
      'categoria_id', c.id, 'categoria', c.nombre, 'cat_orden', c.orden,
      'subcriterio_id', s.id, 'texto', s.texto,
      'descripcion', s.descripcion, 'sub_orden', s.orden
    ) ORDER BY c.orden, s.orden
  ) INTO v_subcriterios
  FROM public.config_categorias_ser c
  JOIN public.config_subcriterios_ser s ON s.categoria_id = c.id AND s.activo = true
  WHERE c.año = p_año AND c.activo = true AND c.colegio_id = mi_colegio_id();

  SELECT jsonb_agg(
    jsonb_build_object(
      'valor', valor_numerico, 'etiqueta', etiqueta,
      'color', color, 'orden', orden
    ) ORDER BY orden
  ) INTO v_escala
  FROM public.config_escala_ser
  WHERE año = p_año AND colegio_id = mi_colegio_id();

  SELECT jsonb_agg(
    jsonb_build_object('numero', n, 'nombre', v_gestion.nombre_periodo || ' ' || n)
    ORDER BY n
  ) INTO v_periodos
  FROM generate_series(1, v_gestion.cantidad_periodos) n;

  RETURN jsonb_build_object(
    'año',                    v_gestion.año,
    'estado',                 v_gestion.estado,
    'bloqueada',              v_gestion.bloqueada,
    'trimestre_activo',       v_gestion.trimestre_activo,
    'cantidad_periodos',      v_gestion.cantidad_periodos,
    'nombre_periodo',         v_gestion.nombre_periodo,
    'nota_minima',            v_gestion.nota_minima_aprobacion,
    'escala_maxima',          v_gestion.escala_maxima,
    'etiqueta_aprobado',      v_gestion.etiqueta_aprobado,
    'etiqueta_reprobado',     v_gestion.etiqueta_reprobado,
    'usa_carreras_tecnicas',  v_gestion.usa_carreras_tecnicas,
    'permite_entrega_tareas', v_gestion.permite_entrega_tareas,
    'plan',                   COALESCE(v_plan, 'basico'),
    'dimensiones',            COALESCE(v_dimensiones, '[]'::JSONB),
    'subcriterios_ser',       COALESCE(v_subcriterios, '[]'::JSONB),
    'escala_ser',             COALESCE(v_escala, '[]'::JSONB),
    'periodos',               COALESCE(v_periodos, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public."get_config_año" TO authenticated, anon;