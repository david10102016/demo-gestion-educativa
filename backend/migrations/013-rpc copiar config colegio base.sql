-- ============================================================
-- MIGRACIÓN 013: Fix constraints multitenant + RPC copiar_config_colegio_base
-- 
-- PROBLEMA: Varias tablas de configuración tenían constraints únicas
-- sin considerar colegio_id, lo que impedía que múltiples colegios
-- tuvieran sus propios registros de configuración.
--
-- SOLUCIÓN: 
-- 1. Reemplazar constraints únicas globales por constraints únicas por colegio
-- 2. Crear RPC que copia toda la configuración base al crear un colegio nuevo
--
-- NOTA: nombre_completo en cursos es columna GENERADA (ALWAYS), 
-- no se inserta manualmente — la BD la calcula sola.
-- ============================================================

-- ── Fix constraints ──────────────────────────────────────────

ALTER TABLE public.config_gestion DROP CONSTRAINT IF EXISTS config_gestion_año_key;
ALTER TABLE public.config_gestion ADD CONSTRAINT config_gestion_año_colegio_key UNIQUE (año, colegio_id);

ALTER TABLE public.config_escala_ser DROP CONSTRAINT IF EXISTS config_escala_ser_año_valor_numerico_key;
ALTER TABLE public.config_escala_ser ADD CONSTRAINT config_escala_ser_año_valor_colegio_key UNIQUE (año, valor_numerico, colegio_id);

ALTER TABLE public.config_categorias_ser DROP CONSTRAINT IF EXISTS config_categorias_ser_año_nombre_key;
ALTER TABLE public.config_categorias_ser ADD CONSTRAINT config_categorias_ser_año_nombre_colegio_key UNIQUE (año, nombre, colegio_id);

ALTER TABLE public.config_preguntas_docente DROP CONSTRAINT IF EXISTS config_preguntas_docente_año_orden_key;
ALTER TABLE public.config_preguntas_docente ADD CONSTRAINT config_preguntas_docente_año_orden_colegio_key UNIQUE (año, orden, colegio_id);

ALTER TABLE public.config_notificaciones DROP CONSTRAINT IF EXISTS config_notificaciones_tipo_key;
ALTER TABLE public.config_notificaciones ADD CONSTRAINT config_notificaciones_tipo_colegio_key UNIQUE (tipo, colegio_id);

-- ── RPC copiar_config_colegio_base ───────────────────────────

CREATE OR REPLACE FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_base UUID := '00000000-0000-0000-0000-000000000001';
  v_gestion_nueva_id UUID;
  v_categoria RECORD;
  v_categoria_nueva_id UUID;
  v_paso TEXT := 'inicio';
BEGIN

  -- 1. Copiar cursos (nombre_completo es columna generada, no se inserta)
  v_paso := 'cursos';
  INSERT INTO public.cursos (nivel, grado, paralelo, activo, colegio_id)
  SELECT nivel, grado, paralelo, activo, nuevo_colegio_id
  FROM public.cursos WHERE colegio_id = v_colegio_base;

  -- 2. Copiar materias
  v_paso := 'materias';
  INSERT INTO public.materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
  SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, nuevo_colegio_id
  FROM public.materias WHERE colegio_id = v_colegio_base;

  -- 3. Copiar config_gestion y obtener el nuevo id
  v_paso := 'config_gestion';
  INSERT INTO public.config_gestion (
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, colegio_id
  )
  SELECT
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, nuevo_colegio_id
  FROM public.config_gestion WHERE colegio_id = v_colegio_base
  RETURNING id INTO v_gestion_nueva_id;

  -- 4. Copiar config_dimensiones usando el nuevo gestion_id
  v_paso := 'config_dimensiones';
  INSERT INTO public.config_dimensiones (
    gestion_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, colegio_id
  )
  SELECT
    v_gestion_nueva_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, nuevo_colegio_id
  FROM public.config_dimensiones WHERE colegio_id = v_colegio_base;

  -- 5. Copiar config_escala_ser
  v_paso := 'config_escala_ser';
  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id)
  SELECT año, valor_numerico, etiqueta, color, orden, nuevo_colegio_id
  FROM public.config_escala_ser WHERE colegio_id = v_colegio_base;

  -- 6. Copiar config_categorias_ser y subcriterios manteniendo la relación categoria_id
  v_paso := 'config_categorias_ser';
  FOR v_categoria IN SELECT * FROM public.config_categorias_ser WHERE colegio_id = v_colegio_base
  LOOP
    INSERT INTO public.config_categorias_ser (año, nombre, orden, activo, colegio_id)
    VALUES (v_categoria.año, v_categoria.nombre, v_categoria.orden, v_categoria.activo, nuevo_colegio_id)
    RETURNING id INTO v_categoria_nueva_id;

    INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, activo, colegio_id)
    SELECT v_categoria_nueva_id, año, texto, descripcion, orden, activo, nuevo_colegio_id
    FROM public.config_subcriterios_ser WHERE categoria_id = v_categoria.id;
  END LOOP;

  -- 7. Copiar config_preguntas_docente
  v_paso := 'config_preguntas_docente';
  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, activo, colegio_id)
  SELECT año, texto, escala_min, escala_max, orden, activo, nuevo_colegio_id
  FROM public.config_preguntas_docente WHERE colegio_id = v_colegio_base;

  -- 8. Copiar config_notificaciones
  v_paso := 'config_notificaciones';
  INSERT INTO public.config_notificaciones (tipo, nombre_display, plantilla, umbral_faltas, activo, colegio_id)
  SELECT tipo, nombre_display, plantilla, umbral_faltas, activo, nuevo_colegio_id
  FROM public.config_notificaciones WHERE colegio_id = v_colegio_base;

  RETURN jsonb_build_object('ok', true, 'colegio_id', nuevo_colegio_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'paso', v_paso);
END;
$$;

GRANT EXECUTE ON FUNCTION public.copiar_config_colegio_base TO authenticated;