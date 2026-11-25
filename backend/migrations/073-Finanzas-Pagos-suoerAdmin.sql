-- ============================================================
-- MIGRACIÓN 073: Finanzas/Pagos — candado real + control exclusivo
-- del superadmin + exposición en get_config_año()
--
-- Esta migración junta dos partes que dependen una de la otra,
-- pensadas para aplicarse juntas en una sola ejecución:
--
--   PARTE A — Candado real (backend)
--   PARTE B — Exponer el interruptor al frontend (backend también,
--             pero es la pieza que el JS necesita para poder ocultar
--             el botón "Pagos" -- sin esto, la base queda protegida
--             pero el botón se sigue viendo en pantalla igual)
--
-- Contexto general: de los 4 beneficios del plan avanzado (carreras
-- técnicas, entrega de tareas, comunicados, Finanzas), Finanzas era
-- el único sin ningún candado real -- las 3 policies de
-- pagos_mensualidad no revisaban plan en ninguna parte, solo había
-- un `if` de frontend sin respaldo de base de datos.
--
-- Además, hace falta un caso puntual distinto al resto: un colegio
-- que ya está en plan avanzado, pero contrata un sistema de
-- contabilidad aparte y no corresponde darle Finanzas. Para eso no
-- alcanza con el plan solo -- hace falta un interruptor
-- independiente, exclusivo del superadmin, que ni el director ni la
-- secretaria puedan tocar.
--
-- Carreras técnicas, entrega de tareas y comunicados no se tocan en
-- esta migración -- quedan para una revisión aparte, más adelante.
-- ============================================================


-- ============================================================
-- PARTE A — Candado real + interruptor protegido
-- ============================================================

ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS finanzas_habilitado BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.proteger_plan_colegio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.plan IS DISTINCT FROM OLD.plan
      OR NEW.finanzas_habilitado IS DISTINCT FROM OLD.finanzas_habilitado)
     AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar el plan o el acceso a Finanzas de un colegio';
  END IF;

  IF NEW.plan = 'basico' AND OLD.plan = 'avanzado' THEN
    UPDATE public.config_gestion
    SET usa_carreras_tecnicas = false, permite_entrega_tareas = false
    WHERE colegio_id = NEW.id AND estado = 'activo';
  END IF;

  RETURN NEW;
END;
$$;
-- trg_proteger_plan_colegio ya apunta a esta función desde la 058, no se recrea el trigger.

DROP POLICY IF EXISTS pagos_insert_secretaria ON public.pagos_mensualidad;
CREATE POLICY pagos_insert_secretaria ON public.pagos_mensualidad
FOR INSERT WITH CHECK (
  public.es_secretaria()
  AND EXISTS (
    SELECT 1 FROM public.estudiantes e
    WHERE e.id = pagos_mensualidad.estudiante_id AND e.colegio_id = public.mi_colegio_id()
  )
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id() AND c.plan = 'avanzado' AND c.finanzas_habilitado = true
  )
);

DROP POLICY IF EXISTS pagos_update_secretaria ON public.pagos_mensualidad;
CREATE POLICY pagos_update_secretaria ON public.pagos_mensualidad
FOR UPDATE USING (
  public.es_secretaria() AND colegio_id = public.mi_colegio_id()
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id() AND c.plan = 'avanzado' AND c.finanzas_habilitado = true
  )
);

DROP POLICY IF EXISTS pagos_update_director ON public.pagos_mensualidad;
CREATE POLICY pagos_update_director ON public.pagos_mensualidad
FOR UPDATE USING (
  public.es_director() AND colegio_id = public.mi_colegio_id()
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id() AND c.plan = 'avanzado' AND c.finanzas_habilitado = true
  )
);


-- ============================================================
-- PARTE B — Exponer finanzas_habilitado en get_config_año()
--
-- Sin esto, la columna existe y protege la base, pero el frontend
-- nunca se entera de su valor -- window.APP_CONFIG se llena con
-- esta función al iniciar sesión, y no tenía este campo. Mismo
-- patrón ya usado para exponer 'plan' en la 058.
-- ============================================================

CREATE OR REPLACE FUNCTION public."get_config_año"("p_año" integer DEFAULT (EXTRACT(year FROM now()))::integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_gestion              RECORD;
  v_dimensiones          JSONB;
  v_subcriterios         JSONB;
  v_escala               JSONB;
  v_periodos             JSONB;
  v_plan                 TEXT;
  v_finanzas_habilitado  BOOLEAN;
BEGIN
  SELECT * INTO v_gestion FROM public.config_gestion
  WHERE año = p_año AND colegio_id = mi_colegio_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Gestión no encontrada para año ' || p_año);
  END IF;

  SELECT plan, finanzas_habilitado INTO v_plan, v_finanzas_habilitado
  FROM public.colegios WHERE id = mi_colegio_id();

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
    'finanzas_habilitado',    COALESCE(v_finanzas_habilitado, true),
    'dimensiones',            COALESCE(v_dimensiones, '[]'::JSONB),
    'subcriterios_ser',       COALESCE(v_subcriterios, '[]'::JSONB),
    'escala_ser',             COALESCE(v_escala, '[]'::JSONB),
    'periodos',               COALESCE(v_periodos, '[]'::JSONB)
  );
END;
$$;


-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. select finanzas_habilitado from colegios; → true en todos,
--    sin cambio de comportamiento para nadie hoy.
-- 2. Colegio en básico: intento de INSERT/UPDATE en
--    pagos_mensualidad → sigue rechazado.
-- 3. Superadmin apaga finanzas_habilitado en un colegio avanzado →
--    secretaria/director de ese colegio ya no pueden insertar ni
--    actualizar pagos (403); las demás funcionalidades no se tocan.
-- 4. Director del colegio afectado intenta revertirlo por su cuenta
--    (UPDATE colegios SET finanzas_habilitado = true) → rechazado
--    por el trigger.
-- 5. select get_config_año(); (logueado como director o secretaria)
--    → el jsonb de salida ya trae la clave finanzas_habilitado.
-- ─────────────────────────────────────────────────────────