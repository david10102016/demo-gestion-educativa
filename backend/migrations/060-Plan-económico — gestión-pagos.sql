-- ============================================================
-- MIGRACIÓN 060: Plan económico — gestión de pagos + colegio
-- nuevo sin heredar flags de la plantilla
--
-- Esta migración junta dos cambios independientes entre sí
-- (no dependen uno del otro, se pueden pegar y correr juntos
-- en una sola ejecución del SQL Editor):
--
--   PARTE A — Gestión de pagos requiere plan avanzado
--   PARTE B — Colegio nuevo nace con los flags apagados
--
-- Contexto general (por si se retoma este archivo más adelante):
-- el sistema cobra a los colegios por plan (colegios.plan:
-- básico/avanzado). La 058 agregó esa columna, controlada solo
-- por el superadmin. La 059 cerró el primer candado real: nadie
-- puede prender usa_carreras_tecnicas / permite_entrega_tareas
-- sin plan avanzado, y si el superadmin baja un colegio de
-- avanzado a básico, ambos toggles se apagan solos en el mismo
-- UPDATE. Esta es la tercera y cuarta pieza del mismo patrón.
-- ============================================================


-- ============================================================
-- PARTE A — Plan avanzado requerido para gestión de pagos
-- ============================================================
--
-- Qué hace: hoy el toggle de plan no restringe nada en el módulo
-- de pagos/mensualidad — colegios.plan existe pero ninguna policy
-- lo revisa. Un colegio en básico podría aprobar pagos, registrar
-- pagos en efectivo, o (aunque hoy sin uso en el frontend) editar
-- pagos desde el rol director, exactamente igual que uno en
-- avanzado. Esta parte cierra eso.
--
-- Se confirmó contra el código real que el director solo consulta
-- reportes (resumenGeneralPagos, pagosPorCurso) y nunca aprueba ni
-- edita pagos desde ninguna pantalla — quien lo hace es secretaría
-- (revisarPago(), registrarPagoEfectivo()). La policy
-- pagos_update_director sí existe en la base y sí permite editar,
-- pero no la usa ningún archivo del frontend: es una puerta
-- abierta sin nadie que la use hoy. Se cierra igual, por las
-- dudas, con el mismo candado que las otras dos.
--
-- Qué NO se toca, y por qué:
--   - pagos_select_director / pagos_select_secretaria: son solo
--     lectura, no hay nada que pagar de más por ver un reporte.
--   - pagos_insert_tutor / pagos_select_tutor: son del flujo del
--     tutor (padre de familia subiendo su comprobante), un flujo
--     completamente aparte que no debe verse afectado por el plan
--     del colegio — un padre puede pagar la mensualidad de su
--     hijo sin importar si el colegio contrató o no las funciones
--     administrativas avanzadas.
--
-- Aislamiento multi-tenant: no cambia. Las tres políticas ya
-- filtraban por mi_colegio_id(); el chequeo de plan que se agrega
-- está anclado al mismo mi_colegio_id(), no compara contra otro
-- colegio.
--
-- Riesgo de romper algo: ninguno. Es 100% aditivo — se agrega un
-- AND EXISTS(...) a cada política existente sin quitar ninguna
-- condición previa. Se verificó que ninguna de las dos políticas
-- de UPDATE tenía WITH CHECK antes (se crearon así desde la
-- migración 006), así que ALTER POLICY tampoco borra nada que no
-- se esté viendo acá.
--
-- Efecto para el usuario final una vez aplicada esta parte:
--   - Colegio en avanzado: sin cambios, todo sigue como está.
--   - Colegio en básico: la base rechaza el INSERT/UPDATE con un
--     error de Postgres. Sin el parche de frontend correspondiente
--     (dashboard-secretaria.html + tutores.js, ya aplicado aparte
--     en esta misma ronda), la secretaría vería el error crudo en
--     vez de un aviso amigable — pero funcionalmente queda
--     bloqueado igual.
-- ============================================================

ALTER POLICY pagos_insert_secretaria
ON public.pagos_mensualidad
WITH CHECK (
  public.es_secretaria()
  AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = pagos_mensualidad.estudiante_id
      AND e.colegio_id = public.mi_colegio_id()
  )
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id()
      AND c.plan = 'avanzado'
  )
);

ALTER POLICY pagos_update_secretaria
ON public.pagos_mensualidad
USING (
  public.es_secretaria()
  AND colegio_id = public.mi_colegio_id()
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id()
      AND c.plan = 'avanzado'
  )
);

ALTER POLICY pagos_update_director
ON public.pagos_mensualidad
USING (
  public.es_director()
  AND colegio_id = public.mi_colegio_id()
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id()
      AND c.plan = 'avanzado'
  )
);


-- ============================================================
-- PARTE B — Colegio nuevo no hereda usa_carreras_tecnicas ni
-- permite_entrega_tareas de la plantilla
-- ============================================================
--
-- Contexto: copiar_config_colegio_base() se ejecuta una sola vez,
-- solo el superadmin puede llamarla (candado propio dentro de la
-- función), y solo en el momento exacto en que se provisiona un
-- colegio cliente nuevo. Hasta ahora copiaba usa_carreras_tecnicas
-- y permite_entrega_tareas tal cual estuvieran en el colegio
-- plantilla ("PLANTILLA BASE — NO USAR PARA LOGIN").
--
-- Se consultó en vivo el valor real de la plantilla:
--   usa_carreras_tecnicas = false, permite_entrega_tareas = false
-- Es decir, hoy este cambio es un no-op observable: el resultado
-- para un colegio nuevo es exactamente el mismo antes y después
-- de aplicar esta migración. Lo que cambia es que deja de
-- depender de que nadie edite la plantilla sin querer (por
-- ejemplo, para armar una demo y olvidarse de apagarlo después) —
-- ahora los dos campos quedan fijos en false sin importar qué
-- tenga la plantilla en ese momento, ni qué plan elija el
-- superadmin para el colegio nuevo.
--
-- Esto refuerza una regla de negocio que ya rige en el resto del
-- sistema: activar una función premium nunca es automático. Ni
-- siquiera si el colegio se crea directamente en plan avanzado,
-- el director tiene que prender el toggle a mano — igual que
-- cualquier colegio existente al que le suben el plan.
--
-- Riesgo de romper algo: ninguno.
--   - copiar_config_colegio_base() tiene su propio candado
--     anti-duplicados (IF EXISTS cursos WHERE colegio_id = ...
--     RETURN error), así que nunca puede volver a correr sobre
--     un colegio que ya existe. No toca ningún dato de colegios
--     ya creados, ni de los que están en producción hoy.
--   - Es un CREATE OR REPLACE de la misma función, misma firma,
--     mismo GRANT — no rompe ninguna llamada existente desde el
--     frontend (superadmin.js sigue invocándola exactamente igual).
--   - No toca cursos, materias, config_dimensiones,
--     config_escala_ser, config_categorias_ser,
--     config_subcriterios_ser, config_preguntas_docente ni
--     config_notificaciones — todo eso se sigue copiando de la
--     plantilla exactamente igual que antes.
-- ============================================================

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

  -- ── ÚNICO CAMBIO REAL DE LA PARTE B ──
  -- usa_carreras_tecnicas y permite_entrega_tareas ya no se copian
  -- de la plantilla: se fijan en false explícitamente.
  v_paso := 'config_gestion';
  INSERT INTO public.config_gestion (
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, colegio_id
  )
  SELECT
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, false, false, nuevo_colegio_id
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


-- ─────────────────────────────────────────────────────────
-- Verificación post-migración (correr después de aplicar):
--
-- PARTE A:
-- 1. Colegio en básico: secretaría intenta aprobar/rechazar un
--    pago o registrar uno en efectivo -> debe fallar (403/42501).
-- 2. Colegio en avanzado: mismas acciones -> deben pasar igual
--    que siempre.
-- 3. Tutor de cualquier colegio (básico o avanzado) sube su
--    comprobante -> sin cambios, sigue funcionando.
-- 4. Director de cualquier plan consulta reportes de pagos ->
--    sin cambios, ve todo completo.
--
-- PARTE B:
-- 5. Crear un colegio de prueba nuevo (cualquier plan elegido) ->
--    select usa_carreras_tecnicas, permite_entrega_tareas from
--    config_gestion where colegio_id = '<uuid-nuevo>';
--    debe mostrar ambos en false.
-- ─────────────────────────────────────────────────────────