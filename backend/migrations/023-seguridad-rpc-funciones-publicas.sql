-- ─────────────────────────────────────────────────────────
-- 023 — Seguridad en funciones RPC expuestas sin protección
-- Aditivo: no modifica tablas, políticas RLS ni datos existentes.
-- Cierra 4 funciones que eran ejecutables sin sesión (rol anon/PUBLIC):
--   update_user_password, fix_confirmation_tokens,
--   rpc_crear_director, copiar_config_colegio_base
-- ─────────────────────────────────────────────────────────

-- 1. Función auxiliar de rol que faltaba (mismo patrón que es_director(), es_profesor(), etc.)
CREATE OR REPLACE FUNCTION public.es_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'superadmin' AND activo = true
  );
$$;

-- 2. rpc_crear_director: convertida a plpgsql + candado de superadmin
CREATE OR REPLACE FUNCTION public.rpc_crear_director(p_id uuid, p_nombre text, p_email text, p_colegio_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  INSERT INTO public.usuarios (id, nombre_completo, email, rol, activo, colegio_id)
  VALUES (p_id, p_nombre, p_email, 'director', true, p_colegio_id)
  ON CONFLICT (id) DO UPDATE SET
    colegio_id      = p_colegio_id,
    rol             = 'director',
    activo          = true,
    nombre_completo = p_nombre;
END;
$$;

-- 3. copiar_config_colegio_base: candado de superadmin agregado al inicio (resto del cuerpo sin cambios)
CREATE OR REPLACE FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_colegio_base UUID := '00000000-0000-0000-0000-000000000001';
  v_gestion_nueva_id UUID;
  v_categoria RECORD;
  v_categoria_nueva_id UUID;
  v_paso TEXT := 'inicio';
BEGIN
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

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

-- 4. Permisos: cerrar todo, reabrir solo para logueados en las 2 que sí se usan
REVOKE EXECUTE ON FUNCTION public.update_user_password(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fix_confirmation_tokens() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_crear_director(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.copiar_config_colegio_base(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_crear_director(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copiar_config_colegio_base(uuid) TO authenticated;