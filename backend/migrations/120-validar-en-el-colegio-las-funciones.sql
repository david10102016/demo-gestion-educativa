-- ============================================================
-- 120 — Validar el colegio en las funciones de escritura de notas, calificaciones y fichas
--
-- Problema:
--   rpc_upsert_nota, rpc_delete_nota, rpc_upsert_calificacion y rpc_publish_ficha son SECURITY DEFINER
--   (se saltan la RLS) y aceptan a cualquier usuario con es_director() sin comprobar que el registro
--   (actividad, estudiante o ficha) pertenezca al colegio de quien llama. Un director de un colegio
--   podía, llamando a la API con identificadores de otro colegio, crear, modificar o borrar notas,
--   guardar calificaciones SER/Decidir y publicar fichas de seguimiento ajenas.
--   rpc_upsert_notas_bulk quedaba expuesta por delegar en rpc_upsert_nota.
--
-- Evidencia (20-nov-2026, producción, prueba con rollback forzado, director de Gloria II con
-- identificadores de otro colegio):
--   rpc_delete_nota           PERMITIDO (nota ajena eliminada)
--   rpc_upsert_calificacion   PERMITIDO
--   rpc_publish_ficha         PERMITIDO
--   rpc_upsert_nota / rpc_upsert_notas_bulk: pasaron los controles de permisos, actividad y curso;
--   solo las frenó el valor de prueba fuera de rango (0 - 40).
--   Profesor, estudiante, secretaria y regente: bloqueados. El código en producción era idéntico
--   al de las migraciones.
--
-- Solución:
--   Cada función comprueba el colegio antes de escribir:
--     rpc_upsert_nota / rpc_delete_nota : el colegio de la actividad (por su curso o, si no tiene
--       curso, por su materia) debe ser mi_colegio_id(); si no, "Actividad no encontrada".
--     rpc_upsert_calificacion           : estudiante y materia deben ser de mi_colegio_id().
--     rpc_publish_ficha                 : el estudiante de la ficha debe ser de mi_colegio_id();
--       la comprobación va antes del bloqueo FOR UPDATE.
--   El resto de cada función queda idéntico.
--
-- Qué NO cambia:
--   - Profesores y directores del colegio dueño del registro siguen trabajando igual.
--   - rpc_upsert_notas_bulk no se modifica: hereda la validación de rpc_upsert_nota.
--   - No se tocan políticas RLS, tablas ni datos.
--
-- Verificación después de aplicar:
--   Repetir la prueba de funciones con el director de otro colegio y identificadores ajenos:
--   rpc_delete_nota, rpc_upsert_calificacion, rpc_upsert_nota, rpc_upsert_notas_bulk y
--   rpc_publish_ficha deben quedar bloqueadas. Y probar en la app, como profesor y como director
--   del propio colegio, guardar una nota y una calificación.
--
-- Revertir (solo si hiciera falta; reabre la brecha):
--   Reaplicar las definiciones anteriores de las cuatro funciones. Conviene guardar antes el
--   resultado de: select proname, pg_get_functiondef(oid) from pg_proc
--   where pronamespace = 'public'::regnamespace and proname in ('rpc_upsert_nota','rpc_delete_nota',
--   'rpc_upsert_calificacion','rpc_publish_ficha');
-- ============================================================
BEGIN;

-- ── rpc_upsert_nota ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_upsert_nota(p_actividad_id uuid, p_estudiante_id uuid, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_actividad   RECORD;
  v_asignado    BOOLEAN;
  v_en_curso    BOOLEAN;
  v_nota_id     UUID;
  v_old_valor   NUMERIC;
  v_colegio_act UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos para registrar notas';
  END IF;

  SELECT * INTO v_actividad FROM public.actividades WHERE id = p_actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- 115: la actividad debe pertenecer al colegio de quien llama
  SELECT COALESCE(
           (SELECT c.colegio_id FROM public.cursos c WHERE c.id = v_actividad.curso_id),
           (SELECT m.colegio_id FROM public.materias m WHERE m.id = v_actividad.materia_id))
    INTO v_colegio_act;
  IF v_colegio_act IS DISTINCT FROM public.mi_colegio_id() THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- El estudiante debe pertenecer al curso de la actividad
  SELECT EXISTS(
    SELECT 1 FROM public.estudiantes
    WHERE id = p_estudiante_id AND curso_id = v_actividad.curso_id
  ) INTO v_en_curso;

  IF NOT v_en_curso THEN
    RAISE EXCEPTION 'El estudiante no pertenece al curso de esta actividad';
  END IF;

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

  IF p_valor < 0 OR p_valor > v_actividad.max_puntos THEN
    RAISE EXCEPTION 'Valor % fuera de rango (0 - %)', p_valor, v_actividad.max_puntos;
  END IF;

  SELECT valor INTO v_old_valor FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  INSERT INTO public.notas (actividad_id, estudiante_id, valor, creado_por)
  VALUES (p_actividad_id, p_estudiante_id, p_valor, auth.uid())
  ON CONFLICT (actividad_id, estudiante_id)
  DO UPDATE SET valor = EXCLUDED.valor
  RETURNING id INTO v_nota_id;

  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id, datos_antes, datos_despues)
  VALUES (
    auth.uid(), 'profesor', 'upsert_nota', 'notas', v_nota_id,
    jsonb_build_object('valor', v_old_valor),
    jsonb_build_object('valor', p_valor)
  );

  RETURN jsonb_build_object('ok', true, 'nota_id', v_nota_id, 'valor', p_valor);
END;
$function$;

-- ── rpc_delete_nota ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_actividad   RECORD;
  v_asignado    BOOLEAN;
  v_nota_id     UUID;
  v_old_valor   NUMERIC;
  v_colegio_act UUID;
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

  -- 115: la actividad debe pertenecer al colegio de quien llama
  SELECT COALESCE(
           (SELECT c.colegio_id FROM public.cursos c WHERE c.id = v_actividad.curso_id),
           (SELECT m.colegio_id FROM public.materias m WHERE m.id = v_actividad.materia_id))
    INTO v_colegio_act;
  IF v_colegio_act IS DISTINCT FROM public.mi_colegio_id() THEN
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
$function$;

-- ── rpc_upsert_calificacion ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric DEFAULT NULL::numeric, p_nota_decidir numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_asignado  BOOLEAN;
  v_pesos     RECORD;
  v_cal_id    UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  -- 115: estudiante y materia deben pertenecer al colegio de quien llama
  IF NOT EXISTS (
    SELECT 1
    FROM public.estudiantes e
    JOIN public.materias m ON m.id = p_materia_id
    WHERE e.id = p_estudiante_id
      AND e.colegio_id = public.mi_colegio_id()
      AND m.colegio_id = public.mi_colegio_id()
  ) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor ap
      JOIN public.estudiantes e ON e.curso_id = ap.curso_id
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = p_materia_id
        AND ap.activo = true
        AND e.id = p_estudiante_id
    ) INTO v_asignado;
    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia para este estudiante';
    END IF;
  END IF;

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
$function$;

-- ── rpc_publish_ficha ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_publish_ficha(p_ficha_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_ficha RECORD;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  -- 115: la ficha debe ser de un estudiante del colegio de quien llama (antes de bloquear la fila)
  IF NOT EXISTS (
    SELECT 1
    FROM public.fichas_seguimiento_ser f
    JOIN public.estudiantes e ON e.id = f.estudiante_id
    WHERE f.id = p_ficha_id
      AND e.colegio_id = public.mi_colegio_id()
  ) THEN
    RAISE EXCEPTION 'Ficha no encontrada';
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
$function$;

COMMIT;