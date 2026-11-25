-- ============================================================
-- MIGRACIÓN 004: FUNCIONES, TRIGGERS Y RPCs
-- ============================================================

-- -------------------------------------------------------
-- TRIGGER: sincronizar auth.users → public.usuarios
-- Se ejecuta al crear un usuario en Supabase Auth
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, nombre_completo, rol)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'estudiante')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -------------------------------------------------------
-- TRIGGER: updated_at automático
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_usuarios
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_colegios
  BEFORE UPDATE ON public.colegios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_calificaciones
  BEFORE UPDATE ON public.calificaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.set_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_actualizado_en_fichas
  BEFORE UPDATE ON public.fichas_seguimiento_ser
  FOR EACH ROW EXECUTE FUNCTION public.set_actualizado_en();

-- -------------------------------------------------------
-- VISTA: notas_finales
-- Calcula notas desde config_dimensiones (dinámico)
-- -------------------------------------------------------
CREATE OR REPLACE VIEW public.notas_finales AS
SELECT
  e.id                    AS estudiante_id,
  e.carnet,
  u.nombre_completo       AS estudiante,
  m.id                    AS materia_id,
  m.nombre                AS materia,
  t.periodo               AS trimestre,
  -- HACER: promedio normalizado al peso de la dimensión
  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer'
  ), 0)                   AS promedio_hacer,
  -- SABER: promedio normalizado
  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber'
  ), 0)                   AS promedio_saber,
  -- SER: de calificaciones (publicado desde ficha)
  COALESCE(c.nota_ser, 0) AS nota_ser,
  -- DECIDIR: autoevaluación directa
  COALESCE(c.nota_decidir, 0) AS nota_decidir,
  -- TOTAL
  COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer'
  ), 0)
  + COALESCE((
    SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC, 2)
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
    JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
    WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber'
  ), 0)
  + COALESCE(c.nota_ser, 0)
  + COALESCE(c.nota_decidir, 0) AS nota_final,
  -- Estado dinámico desde config_gestion
  CASE
    WHEN (
      COALESCE((SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC,2)
        FROM public.actividades a JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
        JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
        WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'hacer'), 0)
      + COALESCE((SELECT ROUND(AVG((n.valor::NUMERIC / NULLIF(a.max_puntos,0)) * d.peso_maximo)::NUMERIC,2)
        FROM public.actividades a JOIN public.notas n ON n.actividad_id = a.id AND n.estudiante_id = e.id
        JOIN public.config_dimensiones d ON d.codigo = a.tipo AND d.año = EXTRACT(YEAR FROM NOW())::INT
        WHERE a.materia_id = m.id AND a.trimestre = t.periodo AND a.tipo = 'saber'), 0)
      + COALESCE(c.nota_ser, 0)
      + COALESCE(c.nota_decidir, 0)
    ) >= (SELECT nota_minima_aprobacion FROM public.gestion_activa LIMIT 1)
    THEN (SELECT etiqueta_aprobado FROM public.gestion_activa LIMIT 1)
    ELSE (SELECT etiqueta_reprobado FROM public.gestion_activa LIMIT 1)
  END AS estado
FROM public.estudiantes e
JOIN public.usuarios u ON u.id = e.id
JOIN public.materias m ON m.activo = true
CROSS JOIN (
  SELECT generate_series AS periodo
  FROM generate_series(1, (
    SELECT COALESCE(cantidad_periodos, 3) FROM public.gestion_activa LIMIT 1
  ))
) t
LEFT JOIN public.calificaciones c
  ON c.estudiante_id = e.id AND c.materia_id = m.id AND c.trimestre = t.periodo;

COMMENT ON VIEW public.notas_finales IS 'Notas calculadas dinámicamente. Lee pesos desde config_dimensiones y aprobación desde config_gestion.';

-- -------------------------------------------------------
-- RPC: upsert_nota (SECURITY DEFINER)
-- Única forma de escribir en notas para profesores
-- Valida asignación y escribe auditoría
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_upsert_nota(
  p_actividad_id  UUID,
  p_estudiante_id UUID,
  p_valor         NUMERIC
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
    RAISE EXCEPTION 'Sin permisos para registrar notas';
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

  -- Validar rango
  IF p_valor < 0 OR p_valor > v_actividad.max_puntos THEN
    RAISE EXCEPTION 'Valor % fuera de rango (0 - %)', p_valor, v_actividad.max_puntos;
  END IF;

  -- Obtener valor anterior para auditoría
  SELECT valor INTO v_old_valor FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  -- Upsert
  INSERT INTO public.notas (actividad_id, estudiante_id, valor, creado_por)
  VALUES (p_actividad_id, p_estudiante_id, p_valor, auth.uid())
  ON CONFLICT (actividad_id, estudiante_id)
  DO UPDATE SET valor = EXCLUDED.valor
  RETURNING id INTO v_nota_id;

  -- Auditoría
  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id, datos_antes, datos_despues)
  VALUES (
    auth.uid(), 'profesor', 'upsert_nota', 'notas', v_nota_id,
    jsonb_build_object('valor', v_old_valor),
    jsonb_build_object('valor', p_valor)
  );

  RETURN jsonb_build_object('ok', true, 'nota_id', v_nota_id, 'valor', p_valor);
END;
$$;

-- -------------------------------------------------------
-- RPC: upsert_notas_bulk
-- Llama a rpc_upsert_nota para cada nota del array
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_upsert_notas_bulk(
  p_actividad_id UUID,
  p_notas        JSONB   -- [{"estudiante_id":"uuid","valor":8.5}, ...]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item    JSONB;
  v_results JSONB := '[]'::JSONB;
  v_res     JSONB;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_notas)
  LOOP
    v_res := public.rpc_upsert_nota(
      p_actividad_id,
      (v_item->>'estudiante_id')::UUID,
      (v_item->>'valor')::NUMERIC
    );
    v_results := v_results || jsonb_build_array(v_res);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'resultados', v_results, 'total', jsonb_array_length(p_notas));
END;
$$;

-- -------------------------------------------------------
-- RPC: upsert_calificacion (SER y DECIDIR)
-- Solo el profesor asignado puede actualizar
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_upsert_calificacion(
  p_estudiante_id UUID,
  p_materia_id    UUID,
  p_trimestre     INT,
  p_nota_ser      NUMERIC DEFAULT NULL,
  p_nota_decidir  NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asignado  BOOLEAN;
  v_pesos     RECORD;
  v_cal_id    UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor
      WHERE profesor_id = auth.uid()
        AND materia_id = p_materia_id AND activo = true
    ) INTO v_asignado;
    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia';
    END IF;
  END IF;

  -- Validar rangos según config
  IF p_nota_ser IS NOT NULL THEN
    SELECT peso_maximo INTO v_pesos FROM public.config_dimensiones
    WHERE codigo = 'ser' AND año = EXTRACT(YEAR FROM NOW())::INT LIMIT 1;
    IF p_nota_ser < 0 OR p_nota_ser > v_pesos.peso_maximo THEN
      RAISE EXCEPTION 'Nota SER fuera de rango';
    END IF;
  END IF;

  IF p_nota_decidir IS NOT NULL THEN
    SELECT peso_maximo INTO v_pesos FROM public.config_dimensiones
    WHERE codigo = 'decidir' AND año = EXTRACT(YEAR FROM NOW())::INT LIMIT 1;
    IF p_nota_decidir < 0 OR p_nota_decidir > v_pesos.peso_maximo THEN
      RAISE EXCEPTION 'Nota DECIDIR fuera de rango';
    END IF;
  END IF;

  INSERT INTO public.calificaciones (estudiante_id, materia_id, trimestre, nota_ser, nota_decidir)
  VALUES (p_estudiante_id, p_materia_id, p_trimestre, p_nota_ser, p_nota_decidir)
  ON CONFLICT (estudiante_id, materia_id, trimestre)
  DO UPDATE SET
    nota_ser     = COALESCE(EXCLUDED.nota_ser, calificaciones.nota_ser),
    nota_decidir = COALESCE(EXCLUDED.nota_decidir, calificaciones.nota_decidir),
    updated_at   = NOW()
  RETURNING id INTO v_cal_id;

  RETURN jsonb_build_object('ok', true, 'calificacion_id', v_cal_id);
END;
$$;

-- -------------------------------------------------------
-- RPC: publish_ficha (transacción atómica)
-- Publica ficha SER y actualiza calificaciones
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_publish_ficha(p_ficha_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ficha RECORD;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  -- Lock y lectura
  SELECT * INTO v_ficha
  FROM public.fichas_seguimiento_ser
  WHERE id = p_ficha_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha no encontrada';
  END IF;

  -- Solo el profesor dueño o director
  IF public.es_profesor() AND v_ficha.profesor_id != auth.uid() THEN
    RAISE EXCEPTION 'Solo el profesor que creó la ficha puede publicarla';
  END IF;

  -- Despublicar anteriores
  UPDATE public.fichas_seguimiento_ser
  SET publicada = false, fecha_publicacion = NULL
  WHERE estudiante_id = v_ficha.estudiante_id
    AND materia_id    = v_ficha.materia_id
    AND trimestre     = v_ficha.trimestre
    AND año           = v_ficha.año
    AND publicada     = true;

  -- Publicar actual
  UPDATE public.fichas_seguimiento_ser
  SET publicada = true, fecha_publicacion = NOW()
  WHERE id = p_ficha_id;

  -- Actualizar calificaciones
  PERFORM public.rpc_upsert_calificacion(
    v_ficha.estudiante_id,
    v_ficha.materia_id,
    v_ficha.trimestre,
    v_ficha.nota_calculada,
    NULL
  );

  -- Auditoría
  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id)
  VALUES (auth.uid(), 'profesor', 'publish_ficha', 'fichas_seguimiento_ser', p_ficha_id);

  RETURN jsonb_build_object('ok', true, 'ficha_id', p_ficha_id, 'nota_ser', v_ficha.nota_calculada);
END;
$$;

-- -------------------------------------------------------
-- RPC: get_config_año
-- Devuelve toda la configuración del año actual
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_config_año(
  p_año INT DEFAULT EXTRACT(YEAR FROM NOW())::INT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_gestion     RECORD;
  v_dimensiones JSONB;
  v_subcriterios JSONB;
  v_escala      JSONB;
  v_periodos    JSONB;
BEGIN
  SELECT * INTO v_gestion FROM public.config_gestion WHERE año = p_año LIMIT 1;

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
  WHERE c.año = p_año AND c.activo = true;

  SELECT jsonb_agg(
    jsonb_build_object(
      'valor', valor_numerico, 'etiqueta', etiqueta,
      'color', color, 'orden', orden
    ) ORDER BY orden
  ) INTO v_escala
  FROM public.config_escala_ser WHERE año = p_año;

  -- Generar lista de periodos
  SELECT jsonb_agg(
    jsonb_build_object('numero', n, 'nombre', v_gestion.nombre_periodo || ' ' || n)
    ORDER BY n
  ) INTO v_periodos
  FROM generate_series(1, v_gestion.cantidad_periodos) n;

  RETURN jsonb_build_object(
    'año',                   v_gestion.año,
    'estado',                v_gestion.estado,
    'cantidad_periodos',     v_gestion.cantidad_periodos,
    'nombre_periodo',        v_gestion.nombre_periodo,
    'nota_minima',           v_gestion.nota_minima_aprobacion,
    'escala_maxima',         v_gestion.escala_maxima,
    'etiqueta_aprobado',     v_gestion.etiqueta_aprobado,
    'etiqueta_reprobado',    v_gestion.etiqueta_reprobado,
    'dimensiones',           COALESCE(v_dimensiones, '[]'::JSONB),
    'subcriterios_ser',      COALESCE(v_subcriterios, '[]'::JSONB),
    'escala_ser',            COALESCE(v_escala, '[]'::JSONB),
    'periodos',              COALESCE(v_periodos, '[]'::JSONB)
  );
END;
$$;
COMMENT ON FUNCTION public.get_config_año IS 'Devuelve toda la config del año en un solo JSONB. El frontend la carga al inicio.';

-- -------------------------------------------------------
-- ÍNDICES DE RENDIMIENTO
-- -------------------------------------------------------
CREATE INDEX idx_notas_actividad     ON public.notas(actividad_id);
CREATE INDEX idx_notas_estudiante    ON public.notas(estudiante_id);
CREATE INDEX idx_calificaciones_est  ON public.calificaciones(estudiante_id, trimestre);
CREATE INDEX idx_asistencias_est     ON public.asistencias(estudiante_id, fecha);
CREATE INDEX idx_asistencias_curso   ON public.asistencias(curso_id, fecha);
CREATE INDEX idx_actividades_materia ON public.actividades(materia_id, trimestre);
CREATE INDEX idx_fichas_publicadas   ON public.fichas_seguimiento_ser(estudiante_id, materia_id, trimestre, año)
  WHERE publicada = true;
CREATE INDEX idx_asignaciones_prof   ON public.asignaciones_profesor(profesor_id) WHERE activo = true;

-- -------------------------------------------------------
-- PERMISOS PARA RPCs — anon puede llamarlas (auth.uid() las protege internamente)
-- -------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_upsert_nota TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_notas_bulk TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_calificacion TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_publish_ficha TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_config_año TO authenticated, anon;
