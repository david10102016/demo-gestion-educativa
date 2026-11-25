-- ============================================================
-- MIGRACIÓN 057 (corregida): Plantilla base desacoplada de Buena Fe
--
-- Cambios respecto a la versión anterior, tras revisión:
--   1. UUID de la plantilla generado con gen_random_uuid() en vez de
--      un valor fijo (00000000-...-0000) -- evita cualquier colisión
--      con algún chequeo suelto en el frontend que trate ese patrón
--      como "sin colegio".
--   2. Columna nueva `es_plantilla` en `colegios` -- la función
--      copiar_config_colegio_base() ya no necesita conocer el UUID
--      de memoria: lo busca por esta bandera. Se usa también para
--      excluir la plantilla del panel de superadmin.
--   3. El snapshot completo queda protegido con un guard de
--      idempotencia -- si esta migración se corre dos veces por
--      error, la segunda vez no hace nada (no duplica cursos,
--      materias ni configuración).
-- ============================================================

-- 0. Columna para identificar la plantilla sin depender de un UUID fijo
ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS es_plantilla BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  v_colegio_base       UUID := '00000000-0000-0000-0000-000000000001'; -- Buena Fe (colegio real, solo lectura acá)
  v_plantilla_id        UUID;
  v_gestion_nueva_id     UUID;
  v_categoria            RECORD;
  v_categoria_nueva_id   UUID;
BEGIN

  -- Guard de idempotencia: si la plantilla ya existe, no hacer nada
  IF EXISTS (SELECT 1 FROM public.colegios WHERE es_plantilla = true) THEN
    RAISE NOTICE 'La plantilla ya existe, no se vuelve a crear.';
    RETURN;
  END IF;

  -- 1. Colegio-plantilla: inactivo, no aparece en el selector público,
  --    marcado con es_plantilla para que la función y el panel de
  --    superadmin lo identifiquen sin depender de un UUID fijo.
  INSERT INTO public.colegios (id, nombre, sigla, municipio, departamento, activo, es_plantilla)
  VALUES (gen_random_uuid(), 'PLANTILLA BASE — NO USAR PARA LOGIN', 'BASE', 'N/A', 'N/A', false, true)
  RETURNING id INTO v_plantilla_id;

  -- 2. Snapshot único del estado actual de Buena Fe → plantilla
  INSERT INTO public.cursos (nivel, grado, paralelo, activo, colegio_id)
  SELECT nivel, grado, paralelo, activo, v_plantilla_id
  FROM public.cursos WHERE colegio_id = v_colegio_base;

  INSERT INTO public.materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
  SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, v_plantilla_id
  FROM public.materias WHERE colegio_id = v_colegio_base;

  INSERT INTO public.config_gestion (
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, colegio_id
  )
  SELECT
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, v_plantilla_id
  FROM public.config_gestion WHERE colegio_id = v_colegio_base
  ORDER BY año DESC LIMIT 1  -- si Buena Fe tiene más de una gestión, usar solo la más reciente
  RETURNING id INTO v_gestion_nueva_id;

  INSERT INTO public.config_dimensiones (
    gestion_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, colegio_id
  )
  SELECT
    v_gestion_nueva_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, v_plantilla_id
  FROM public.config_dimensiones WHERE colegio_id = v_colegio_base;

  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id)
  SELECT año, valor_numerico, etiqueta, color, orden, v_plantilla_id
  FROM public.config_escala_ser WHERE colegio_id = v_colegio_base;

  FOR v_categoria IN SELECT * FROM public.config_categorias_ser WHERE colegio_id = v_colegio_base
  LOOP
    INSERT INTO public.config_categorias_ser (año, nombre, orden, activo, colegio_id)
    VALUES (v_categoria.año, v_categoria.nombre, v_categoria.orden, v_categoria.activo, v_plantilla_id)
    RETURNING id INTO v_categoria_nueva_id;

    INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, activo, colegio_id)
    SELECT v_categoria_nueva_id, año, texto, descripcion, orden, activo, v_plantilla_id
    FROM public.config_subcriterios_ser WHERE categoria_id = v_categoria.id;
  END LOOP;

  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, activo, colegio_id)
  SELECT año, texto, escala_min, escala_max, orden, activo, v_plantilla_id
  FROM public.config_preguntas_docente WHERE colegio_id = v_colegio_base;

  INSERT INTO public.config_notificaciones (tipo, nombre_display, plantilla, umbral_faltas, activo, colegio_id)
  SELECT tipo, nombre_display, plantilla, umbral_faltas, activo, v_plantilla_id
  FROM public.config_notificaciones WHERE colegio_id = v_colegio_base;

END $$;

-- 3. La función ahora busca la plantilla por la bandera es_plantilla,
--    no por un UUID escrito a mano -- así nunca puede desincronizarse
--    del id real que se generó arriba.
CREATE OR REPLACE FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_base UUID;
  v_gestion_nueva_id UUID;
  v_categoria RECORD;
  v_categoria_nueva_id UUID;
  v_paso TEXT := 'inicio';
BEGIN
  -- Candado de superadmin (agregado en la migración 023 — se preserva acá)
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT id INTO v_colegio_base FROM public.colegios WHERE es_plantilla = true LIMIT 1;
  IF v_colegio_base IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No existe colegio plantilla configurado.', 'paso', 'buscar_plantilla');
  END IF;

  -- Protección anti-duplicados (agregada en la migración 023 — se preserva acá)
  IF EXISTS (SELECT 1 FROM public.cursos WHERE colegio_id = nuevo_colegio_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El colegio ya tiene configuración. Operación cancelada para evitar duplicados.', 'paso', 'proteccion');
  END IF;

  v_paso := 'cursos';
  INSERT INTO public.cursos (nivel, grado, paralelo, activo, colegio_id)
  SELECT nivel, grado, paralelo, activo, nuevo_colegio_id
  FROM public.cursos WHERE colegio_id = v_colegio_base;

  v_paso := 'materias';
  INSERT INTO public.materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
  SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, nuevo_colegio_id
  FROM public.materias WHERE colegio_id = v_colegio_base;

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

  v_paso := 'config_dimensiones';
  INSERT INTO public.config_dimensiones (
    gestion_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, colegio_id
  )
  SELECT
    v_gestion_nueva_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, nuevo_colegio_id
  FROM public.config_dimensiones WHERE colegio_id = v_colegio_base;

  v_paso := 'config_escala_ser';
  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id)
  SELECT año, valor_numerico, etiqueta, color, orden, nuevo_colegio_id
  FROM public.config_escala_ser WHERE colegio_id = v_colegio_base;

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

  v_paso := 'config_preguntas_docente';
  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, activo, colegio_id)
  SELECT año, texto, escala_min, escala_max, orden, activo, nuevo_colegio_id
  FROM public.config_preguntas_docente WHERE colegio_id = v_colegio_base;

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