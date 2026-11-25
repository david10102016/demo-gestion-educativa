-- ─────────────────────────────────────────────────────────
-- 036 — Fix aislamiento multitenant en get_config_año()
-- Los bloques de v_subcriterios (config_categorias_ser /
-- config_subcriterios_ser) y v_escala (config_escala_ser)
-- filtraban solo por año, sin colegio_id, pese a que ambas
-- tablas lo tienen. Resultado: la función devolvía la escala
-- de valoración y los subcriterios SER de TODOS los colegios
-- mezclados para el año activo, no solo los del colegio propio.
--
-- Prueba: con Buena Fe, Mariscal Sucre y San Juan compartiendo
-- año 2026 y misma config base (copiada por
-- copiar_config_colegio_base), el panel de Configuración
-- mostraba 9 badges de escala (3 valores × 3 colegios) en vez
-- de 3. Invisible hasta ahora solo porque los 3 colegios tenían
-- valores idénticos sin personalizar.
--
-- Riesgo real: en cuanto un director personalice su escala o
-- sus subcriterios SER, los otros colegios verían (y podrían
-- calificar fichas con) valores ajenos a su propia gestión.
--
-- Fix: CREATE OR REPLACE de la función, agregando
-- "AND colegio_id = mi_colegio_id()" a ambos bloques
-- (v_subcriterios y v_escala). El bloque v_dimensiones no
-- necesitaba cambio, ya filtraba por gestion_id (único por
-- colegio). Aditivo, no toca tablas ni RLS.
--
-- Verificado en vivo: logueado como director de Buena Fe y de
-- San Juan, cada uno ve ahora solo su propia escala (3 badges),
-- sin mezcla entre colegios.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public."get_config_año"("p_año" integer DEFAULT (EXTRACT(year FROM now()))::integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_gestion      RECORD;
  v_dimensiones  JSONB;
  v_subcriterios JSONB;
  v_escala       JSONB;
  v_periodos     JSONB;
BEGIN
  SELECT * INTO v_gestion FROM public.config_gestion
  WHERE año = p_año AND colegio_id = mi_colegio_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Gestión no encontrada para año ' || p_año);
  END IF;

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
    'dimensiones',            COALESCE(v_dimensiones, '[]'::JSONB),
    'subcriterios_ser',       COALESCE(v_subcriterios, '[]'::JSONB),
    'escala_ser',             COALESCE(v_escala, '[]'::JSONB),
    'periodos',               COALESCE(v_periodos, '[]'::JSONB)
  );
END;
$$;