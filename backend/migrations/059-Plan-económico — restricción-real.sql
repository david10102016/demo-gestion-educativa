-- ============================================================
-- MIGRACIÓN 059: Plan económico — restricción real (no solo UI)
--
-- Contexto: la 058 agregó colegios.plan y lo expone en
-- get_config_año(), pero nada a nivel de base de datos impedía
-- que:
--   a) el director activara usa_carreras_tecnicas /
--      permite_entrega_tareas sin estar en plan avanzado
--      (solo el frontend lo ocultaba)
--   b) un estudiante subiera una entrega llamando directo al
--      endpoint REST de Supabase, sin pasar por el botón del
--      frontend, aunque permite_entrega_tareas estuviera en false
--
-- Alcance de esta migración: SOLO permite_entrega_tareas.
-- usa_carreras_tecnicas queda protegido para que el director no
-- pueda encenderlo sin plan avanzado (parte 1), pero sigue sin
-- gobernar acceso a actividades/notas técnicas -- eso no existe
-- hoy en ninguna policy y no se agrega aquí. Pendiente aparte si
-- se decide.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Nadie puede prender los toggles de config_gestion sin plan
--    avanzado (director incluido). Mismo patrón que
--    proteger_plan_colegio (058).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_toggles_plan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  SELECT plan INTO v_plan FROM public.colegios WHERE id = NEW.colegio_id;

  IF (
       (NEW.usa_carreras_tecnicas AND NOT OLD.usa_carreras_tecnicas)
       OR (NEW.permite_entrega_tareas AND NOT OLD.permite_entrega_tareas)
     )
     AND v_plan IS DISTINCT FROM 'avanzado' THEN
    RAISE EXCEPTION 'Esta función requiere el plan avanzado.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_toggles_plan ON public.config_gestion;
CREATE TRIGGER trg_proteger_toggles_plan
  BEFORE UPDATE ON public.config_gestion
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_toggles_plan();

-- ------------------------------------------------------------
-- 2. Downgrade automático: si el superadmin baja el colegio de
--    avanzado a básico, los toggles se apagan solos en el mismo
--    UPDATE -- no queda función pagada activa "por olvido".
--    Se reemplaza la función de la 058 agregando este bloque.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_plan_colegio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar el plan de un colegio';
  END IF;

  IF NEW.plan = 'basico' AND OLD.plan = 'avanzado' THEN
    UPDATE public.config_gestion
    SET usa_carreras_tecnicas = false,
        permite_entrega_tareas = false
    WHERE colegio_id = NEW.id
      AND estado = 'activo';
  END IF;

  RETURN NEW;
END;
$$;
-- El trigger trg_proteger_plan_colegio ya apunta a esta función
-- desde la 058, no hace falta recrearlo.

-- ------------------------------------------------------------
-- 3. entregas_tareas: la vía directa a la API queda cerrada.
--    Se extiende el WITH CHECK vigente desde la 051 (intacto,
--    curso normal + inscripción técnica) agregando la condición
--    de plan. Es aditivo: todo lo que pasaba antes sigue pasando,
--    y además debe cumplir permite_entrega_tareas = true.
--
--    IMPORTANTE: no basta con revisar config_gestion.permite_
--    entrega_tareas -- ese campo se puede copiar en true en un
--    INSERT (copiar_config_colegio_base / provisión de colegio
--    nuevo), y proteger_toggles_plan solo corre en UPDATE, así
--    que un INSERT nunca pasa por ese candado. Por eso se agrega
--    también colegios.plan = 'avanzado' directo en la policy: no
--    importa cómo haya quedado el espejo en config_gestion, si
--    el colegio no está en avanzado, no entra.
-- ------------------------------------------------------------
ALTER POLICY entrega_estudiante_own
ON public.entregas_tareas
WITH CHECK (
  estudiante_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.config_gestion cg
    JOIN public.colegios col ON col.id = cg.colegio_id
    WHERE cg.colegio_id = public.mi_colegio_id()
      AND cg.estado = 'activo'
      AND cg.permite_entrega_tareas = true
      AND col.plan = 'avanzado'
  )
  AND EXISTS (
    SELECT 1
    FROM public.actividades a
    JOIN public.materias m ON m.id = a.materia_id
    WHERE a.id = entregas_tareas.actividad_id
      AND (
        (m.es_tecnica IS NOT TRUE AND EXISTS (
          SELECT 1 FROM public.estudiantes e
          WHERE e.id = entregas_tareas.estudiante_id
            AND e.curso_id = a.curso_id
        ))
        OR
        (m.es_tecnica IS TRUE AND EXISTS (
          SELECT 1 FROM public.inscripciones_tecnicas it
          WHERE it.estudiante_id = entregas_tareas.estudiante_id
            AND it.materia_id = a.materia_id
            AND it.activo = true
        ))
      )
  )
);

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. Director de un colegio en plan básico intenta poner
--    permite_entrega_tareas = true desde el panel
--    -> debe fallar con "Esta función requiere el plan avanzado."
--
-- 2. Con permite_entrega_tareas = false, un estudiante de ese
--    colegio intenta POST /rest/v1/entregas_tareas directo
--    (Postman/curl, no el frontend) con una actividad válida
--    de su propio curso -> debe dar 403/42501.
--
-- 3. Superadmin sube el colegio a avanzado, director activa
--    permite_entrega_tareas -> UPDATE pasa. Estudiante repite
--    el mismo POST -> ahora debe dar 201.
--
-- 4. Flujo legítimo ya probado en 044/051 (curso normal y
--    materia técnica vía inscripciones_tecnicas) con el plan
--    en avanzado -> debe seguir dando 201 sin cambios.
--
-- 5. Superadmin baja el colegio de avanzado a básico
--    -> select usa_carreras_tecnicas, permite_entrega_tareas
--       from config_gestion where colegio_id = '<uuid>'
--    debe mostrar ambos en false automáticamente.
--    Estudiante repite el POST del punto 3 -> vuelve a dar 403.
--
-- 6. Colegio nuevo provisionado con copiar_config_colegio_base()
--    (plan básico por default). Verificar manualmente:
--    select permite_entrega_tareas from config_gestion
--    where colegio_id = '<uuid-colegio-nuevo>';
--    Si la plantilla trae ese campo en true (heredado de Buena
--    Fe vía la 057), el INSERT lo copia igual -- eso es
--    esperado y no lo bloquea nada. Lo que sí debe bloquear
--    la policy es el POST de entregas_tareas de un estudiante
--    de ese colegio nuevo -> debe dar 403, porque colegios.plan
--    sigue en 'basico' aunque el espejo diga true.
-- ─────────────────────────────────────────────────────────