-- ============================================================
-- 090 — Vista notas_finales: columna "estado" con la nota redondeada
--
-- Motivo: el sistema decide Aprobado/Reprobado con la nota oficial
-- redondeada (.5 sube): 50.50 → 51 → APROBADO. La vista seguía comparando
-- el decimal (50.50 < 51 → REPROBADO). Ninguna pantalla usa ya esa columna,
-- pero así la base dice lo mismo que el sistema.
--
-- Cambio ÚNICO: en el CASE de "estado", la suma pasa a ROUND(suma, 0).
--   · nota_final, promedios y demás columnas quedan IGUAL (con decimales).
--   · Se parte de la definición vigente en la base (no se reescribe a mano)
--     y se verifica que el reemplazo ocurra exactamente una vez.
--   · Conserva permisos y opciones de la vista. No toca datos.
-- Reversión: reaplicar la definición anterior (guardada al aplicar, ver NOTICE).
-- ============================================================

DO $mig$
DECLARE
  v_def   text;
  v_nuevo text;
  v_opts  text[];
  a1 constant text := 'WHEN (COALESCE((';
  b1 constant text := 'WHEN round((COALESCE((';
  a2 constant text := 'COALESCE(c.nota_decidir, 0::numeric)) >= (( SELECT gestion_activa.nota_minima_aprobacion';
  b2 constant text := 'COALESCE(c.nota_decidir, 0::numeric)), 0) >= (( SELECT gestion_activa.nota_minima_aprobacion';
BEGIN
  v_def := pg_get_viewdef('public.notas_finales'::regclass, true);
  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.notas_finales'::regclass;

  -- Ya aplicada: Postgres guarda el CASE como "WHEN round(COALESCE(..."
  IF position('WHEN round(COALESCE((' IN v_def) > 0 OR position(b1 IN v_def) > 0 THEN
    RAISE NOTICE '090 ya estaba aplicada: no se hace nada';
    RETURN;
  END IF;

  -- Seguridad: cada fragmento debe aparecer exactamente una vez
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     OR (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION '090: la definición de notas_finales no coincide con la esperada. No se aplicó nada.';
  END IF;

  v_nuevo := replace(replace(v_def, a1, b1), a2, b2);
  v_nuevo := regexp_replace(v_nuevo, ';\s*$', '');

  EXECUTE 'CREATE OR REPLACE VIEW public.notas_finales AS ' || v_nuevo;

  IF v_opts IS NOT NULL THEN
    EXECUTE format('ALTER VIEW public.notas_finales SET (%s)', array_to_string(v_opts, ', '));
  END IF;

  RAISE NOTICE '090 aplicada. Opciones conservadas: %', COALESCE(array_to_string(v_opts, ', '), '(ninguna)');
END
$mig$;

-- Verificación (solo lectura): debe devolver true
-- SELECT position('WHEN round(COALESCE((' IN pg_get_viewdef('public.notas_finales'::regclass, true)) > 0 AS migracion_090_ok;