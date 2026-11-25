-- ============================================================
-- MIGRACIÓN 074: Rúbricas de calificación (Hacer / Saber)
-- Versión final v5 — corrige la rama técnica de
-- rubrica_criterios_select: retira una condición que no
-- verificaba nada del profesor puntual (solo si existía algún
-- inscrito activo en general), heredada sin ajustar de
-- rubrica_calif_select en v4. Para materia técnica alcanza con
-- que el profesor tenga asignación activa en esa materia, sin
-- exigir curso (una técnica no está atada a un solo curso).
-- ============================================================

CREATE TABLE public.rubrica_plantillas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id   uuid REFERENCES public.colegios(id),
  tipo         text NOT NULL CHECK (tipo IN ('hacer','saber')),
  nombre       text NOT NULL,
  criterios    jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rubrica_criterios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id  uuid NOT NULL REFERENCES public.actividades(id) ON DELETE CASCADE,
  nombre        text NOT NULL,
  descripcion   text,
  puntos_max    numeric NOT NULL,
  porcentaje    numeric NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  niveles       jsonb NOT NULL,
  orden         int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rubrica_calificaciones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id           uuid NOT NULL REFERENCES public.notas(id) ON DELETE CASCADE,
  criterio_id       uuid NOT NULL REFERENCES public.rubrica_criterios(id) ON DELETE CASCADE,
  puntos_obtenidos  numeric NOT NULL,
  UNIQUE (nota_id, criterio_id)
);

ALTER TABLE public.rubrica_plantillas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubrica_criterios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubrica_calificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY rubrica_plantillas_select ON public.rubrica_plantillas
FOR SELECT USING (colegio_id IS NULL OR colegio_id = public.mi_colegio_id());

-- Director: acceso total dentro de su colegio.
-- Estudiante: solo su propio curso (regular) o su inscripción activa (técnica).
-- Profesor: solo su asignación real -- curso+materia si es regular,
-- materia sin exigir curso si es técnica (CORREGIDO en v5: se retiró
-- la condición sin sentido sobre inscripciones_tecnicas que había en v4).
CREATE POLICY rubrica_criterios_select ON public.rubrica_criterios
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.actividades a
    JOIN public.materias m ON m.id = a.materia_id
    JOIN public.cursos c ON c.id = a.curso_id
    WHERE a.id = rubrica_criterios.actividad_id
      AND c.colegio_id = public.mi_colegio_id()
      AND (
        public.es_director()
        OR (public.es_estudiante() AND m.es_tecnica IS NOT TRUE AND EXISTS (
              SELECT 1 FROM public.estudiantes e
              WHERE e.id = auth.uid() AND e.curso_id = a.curso_id
            ))
        OR (public.es_estudiante() AND m.es_tecnica IS TRUE AND EXISTS (
              SELECT 1 FROM public.inscripciones_tecnicas it
              WHERE it.estudiante_id = auth.uid() AND it.materia_id = a.materia_id AND it.activo = true
            ))
        OR EXISTS (
              SELECT 1 FROM public.asignaciones_profesor ap
              WHERE ap.profesor_id = auth.uid()
                AND ap.materia_id = a.materia_id
                AND ap.activo = true
                AND (m.es_tecnica IS NOT TRUE AND ap.curso_id = a.curso_id OR m.es_tecnica IS TRUE)
            )
      )
  )
);

CREATE POLICY rubrica_criterios_write_profesor ON public.rubrica_criterios
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.actividades a
    JOIN public.cursos c ON c.id = a.curso_id
    WHERE a.id = rubrica_criterios.actividad_id
      AND a.creado_por = auth.uid()
      AND c.colegio_id = public.mi_colegio_id())
);

-- Profesor: solo el desglose de sus propias asignaciones reales (mismo
-- patrón que notas_select_profesor). Director: alcance total en su
-- colegio, igual que ya tiene sobre notas. Estudiante: solo lo suyo.
CREATE POLICY rubrica_calif_select ON public.rubrica_calificaciones
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.notas n
    JOIN public.actividades a ON a.id = n.actividad_id
    JOIN public.materias m ON m.id = a.materia_id
    JOIN public.cursos c ON c.id = a.curso_id
    WHERE n.id = rubrica_calificaciones.nota_id
      AND (
        n.estudiante_id = auth.uid()
        OR (public.es_director() AND c.colegio_id = public.mi_colegio_id())
        OR EXISTS (
          SELECT 1 FROM public.asignaciones_profesor ap
          WHERE ap.profesor_id = auth.uid()
            AND ap.materia_id = a.materia_id
            AND ap.activo = true
            AND (
              (m.es_tecnica IS NOT TRUE AND ap.curso_id = a.curso_id)
              OR (m.es_tecnica IS TRUE AND EXISTS (
                    SELECT 1 FROM public.inscripciones_tecnicas it
                    WHERE it.estudiante_id = n.estudiante_id
                      AND it.materia_id = a.materia_id AND it.activo = true
                  ))
            )
        )
      )
  )
);

CREATE POLICY rubrica_calif_write_profesor ON public.rubrica_calificaciones
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.notas n
    JOIN public.actividades a ON a.id = n.actividad_id
    JOIN public.cursos c ON c.id = a.curso_id
    WHERE n.id = rubrica_calificaciones.nota_id
      AND a.creado_por = auth.uid()
      AND c.colegio_id = public.mi_colegio_id())
);

-- ── Trigger 1: bloquea cambios estructurales una vez que hay notas,
-- permite seguir editando texto (nombre/descripción/orden). Actúa
-- como respaldo a nivel de tabla, en caso de una escritura directa
-- que no pase por guardar_rubrica_criterios(). ──
CREATE OR REPLACE FUNCTION public.proteger_rubrica_calificada()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actividad_id       uuid := COALESCE(NEW.actividad_id, OLD.actividad_id);
  v_tiene_notas        boolean;
  v_niveles_pct_old    jsonb;
  v_niveles_pct_new    jsonb;
  v_cambio_estructural boolean := false;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.notas WHERE actividad_id = v_actividad_id)
    INTO v_tiene_notas;

  IF NOT v_tiene_notas THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('INSERT','DELETE') THEN
    v_cambio_estructural := true;
  ELSE
    IF NEW.porcentaje IS DISTINCT FROM OLD.porcentaje
       OR NEW.puntos_max IS DISTINCT FROM OLD.puntos_max THEN
      v_cambio_estructural := true;
    ELSE
      SELECT jsonb_agg((elem->>'porcentaje')::numeric ORDER BY (elem->>'porcentaje')::numeric)
        INTO v_niveles_pct_old FROM jsonb_array_elements(OLD.niveles) elem;
      SELECT jsonb_agg((elem->>'porcentaje')::numeric ORDER BY (elem->>'porcentaje')::numeric)
        INTO v_niveles_pct_new FROM jsonb_array_elements(NEW.niveles) elem;
      IF v_niveles_pct_old IS DISTINCT FROM v_niveles_pct_new THEN
        v_cambio_estructural := true;
      END IF;
    END IF;
  END IF;

  IF v_cambio_estructural THEN
    RAISE EXCEPTION 'No se puede modificar el porcentaje, puntos o niveles: la actividad ya tiene notas cargadas. Solo se permite editar nombre/descripción.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_proteger_rubrica_calificada
  BEFORE INSERT OR UPDATE OR DELETE ON public.rubrica_criterios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_rubrica_calificada();

-- ── Trigger 2: valida que los criterios de una misma actividad sumen
-- 100%. Diferido a fin de transacción, respaldo real a nivel de
-- tabla por si algo escribe directo sin pasar por la función. ──
CREATE OR REPLACE FUNCTION public.validar_suma_rubrica()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actividad_id uuid := COALESCE(NEW.actividad_id, OLD.actividad_id);
  v_suma         numeric;
  v_total_filas  int;
BEGIN
  SELECT count(*), sum(porcentaje) INTO v_total_filas, v_suma
  FROM public.rubrica_criterios WHERE actividad_id = v_actividad_id;

  IF v_total_filas = 0 THEN
    RETURN NULL;
  END IF;

  IF v_suma IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'Los criterios de esta actividad suman %, deben sumar exactamente 100', v_suma;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_validar_suma_rubrica
  AFTER INSERT OR UPDATE OR DELETE ON public.rubrica_criterios
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validar_suma_rubrica();

-- ── Función: si NO hay notas, reemplaza el conjunto completo de
-- criterios (agregar/quitar/editar libremente). Si SÍ hay notas,
-- exige el "id" de cada criterio existente, rechaza si se intenta
-- agregar/quitar uno o cambiar porcentaje/puntos/niveles, y si todo
-- eso coincide, actualiza solo el texto (nombre, descripción,
-- descripciones de nivel, orden) de cada fila. ──
CREATE OR REPLACE FUNCTION public.guardar_rubrica_criterios(
  p_actividad_id uuid,
  p_criterios jsonb
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_colegio_id      uuid;
  v_creado_por      uuid;
  v_tiene_notas     boolean;
  v_suma            numeric;
  v_item            jsonb;
  v_existente       RECORD;
  v_ids_payload     uuid[];
  v_ids_existentes  uuid[];
  v_niveles_pct_old jsonb;
  v_niveles_pct_new jsonb;
BEGIN
  SELECT c.colegio_id, a.creado_por INTO v_colegio_id, v_creado_por
  FROM public.actividades a JOIN public.cursos c ON c.id = a.curso_id
  WHERE a.id = p_actividad_id;

  IF v_colegio_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Actividad no encontrada');
  END IF;

  IF v_creado_por <> auth.uid() OR v_colegio_id <> public.mi_colegio_id() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos sobre esta actividad');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.notas WHERE actividad_id = p_actividad_id)
    INTO v_tiene_notas;

  -- ══════════════════════════════════════════════════════
  -- CASO A: todavía no hay notas -- reemplazo libre y completo.
  -- ══════════════════════════════════════════════════════
  IF NOT v_tiene_notas THEN
    SELECT sum((item->>'porcentaje')::numeric) INTO v_suma
    FROM jsonb_array_elements(p_criterios) item;

    IF v_suma IS DISTINCT FROM 100 THEN
      RETURN jsonb_build_object('ok', false, 'error', format('Los criterios suman %s, deben sumar exactamente 100', v_suma));
    END IF;

    DELETE FROM public.rubrica_criterios WHERE actividad_id = p_actividad_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
      INSERT INTO public.rubrica_criterios (actividad_id, nombre, descripcion, puntos_max, porcentaje, niveles, orden)
      VALUES (
        p_actividad_id,
        v_item->>'nombre',
        v_item->>'descripcion',
        (v_item->>'puntos_max')::numeric,
        (v_item->>'porcentaje')::numeric,
        v_item->'niveles',
        COALESCE((v_item->>'orden')::int, 0)
      );
    END LOOP;

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ══════════════════════════════════════════════════════
  -- CASO B: ya hay notas -- solo texto. Cada item debe traer el
  -- "id" del criterio existente que está editando.
  -- ══════════════════════════════════════════════════════
  SELECT array_agg((item->>'id')::uuid) INTO v_ids_payload
  FROM jsonb_array_elements(p_criterios) item
  WHERE item->>'id' IS NOT NULL;

  SELECT array_agg(id) INTO v_ids_existentes
  FROM public.rubrica_criterios WHERE actividad_id = p_actividad_id;

  IF v_ids_payload IS NULL
     OR jsonb_array_length(p_criterios) <> COALESCE(array_length(v_ids_existentes, 1), 0)
     OR EXISTS (SELECT 1 FROM unnest(v_ids_existentes) e WHERE e <> ALL(v_ids_payload))
  THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'No se puede agregar ni quitar criterios: la actividad ya tiene notas cargadas. Solo se puede editar el texto de los criterios existentes.');
  END IF;

  -- Validar que ningún criterio traiga un cambio estructural antes
  -- de escribir nada.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
    SELECT * INTO v_existente FROM public.rubrica_criterios WHERE id = (v_item->>'id')::uuid;

    IF (v_item->>'puntos_max')::numeric IS DISTINCT FROM v_existente.puntos_max
       OR (v_item->>'porcentaje')::numeric IS DISTINCT FROM v_existente.porcentaje THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'No se puede modificar el porcentaje ni los puntos: la actividad ya tiene notas cargadas.');
    END IF;

    SELECT jsonb_agg((elem->>'porcentaje')::numeric ORDER BY (elem->>'porcentaje')::numeric)
      INTO v_niveles_pct_old FROM jsonb_array_elements(v_existente.niveles) elem;
    SELECT jsonb_agg((elem->>'porcentaje')::numeric ORDER BY (elem->>'porcentaje')::numeric)
      INTO v_niveles_pct_new FROM jsonb_array_elements(v_item->'niveles') elem;

    IF v_niveles_pct_old IS DISTINCT FROM v_niveles_pct_new THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'No se pueden modificar los porcentajes de los niveles: la actividad ya tiene notas cargadas.');
    END IF;
  END LOOP;

  -- Todo estructural coincide -- son solo cambios de texto.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_criterios) LOOP
    UPDATE public.rubrica_criterios
    SET nombre      = v_item->>'nombre',
        descripcion = v_item->>'descripcion',
        niveles     = v_item->'niveles',
        orden       = COALESCE((v_item->>'orden')::int, orden),
        updated_at  = now()
    WHERE id = (v_item->>'id')::uuid;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.guardar_rubrica_criterios TO authenticated;

-- ------------------------------------------------------------
-- Carga de las plantillas base — Hacer y Saber, definitivas.
-- ------------------------------------------------------------
INSERT INTO public.rubrica_plantillas (colegio_id, tipo, nombre, criterios)
VALUES
(NULL, 'hacer', 'Plantilla base — Hacer', '[
  {"nombre":"Ejecución del procedimiento","porcentaje":35,"niveles":[
    {"porcentaje":0,"descripcion":"No realizó la actividad / no desarrolla nada"},
    {"porcentaje":55,"descripcion":"Sigue el procedimiento de forma desorganizada, con errores en la técnica"},
    {"porcentaje":65,"descripcion":"Sigue el procedimiento básico, con algunos pasos correctos"},
    {"porcentaje":75,"descripcion":"Sigue el procedimiento con claridad, con manejo adecuado de la técnica"},
    {"porcentaje":85,"descripcion":"Ejecuta el procedimiento con buen dominio de la técnica y herramientas"},
    {"porcentaje":100,"descripcion":"Domina por completo el procedimiento y la técnica correspondiente"}
  ]},
  {"nombre":"Calidad del resultado final","porcentaje":35,"niveles":[
    {"porcentaje":0,"descripcion":"No entregó ningún resultado"},
    {"porcentaje":55,"descripcion":"El resultado no cumple lo esencial de lo solicitado"},
    {"porcentaje":65,"descripcion":"El resultado cumple parcialmente, con fallas evidentes"},
    {"porcentaje":75,"descripcion":"El resultado cumple lo solicitado, con calidad aceptable"},
    {"porcentaje":85,"descripcion":"El resultado cumple con buen nivel de calidad y funcionalidad"},
    {"porcentaje":100,"descripcion":"El resultado es sobresaliente, cumple y supera lo esperado"}
  ]},
  {"nombre":"Uso de materiales y recursos","porcentaje":15,"niveles":[
    {"porcentaje":0,"descripcion":"No utilizó los materiales o recursos requeridos"},
    {"porcentaje":55,"descripcion":"Uso desordenado, con desperdicio notorio de materiales"},
    {"porcentaje":65,"descripcion":"Uso aceptable, con algo de desperdicio o desorden"},
    {"porcentaje":75,"descripcion":"Uso adecuado y ordenado de los materiales disponibles"},
    {"porcentaje":85,"descripcion":"Aprovecha bien los recursos, con orden y sin desperdicio"},
    {"porcentaje":100,"descripcion":"Aprovecha los recursos de forma óptima y ejemplar"}
  ]},
  {"nombre":"Independencia en la ejecución","porcentaje":15,"niveles":[
    {"porcentaje":0,"descripcion":"No realizó la actividad"},
    {"porcentaje":55,"descripcion":"Necesitó indicación constante, paso a paso, para avanzar"},
    {"porcentaje":65,"descripcion":"Necesitó indicaciones frecuentes durante el proceso"},
    {"porcentaje":75,"descripcion":"Trabajó con poca guía, resolviendo la mayoría por su cuenta"},
    {"porcentaje":85,"descripcion":"Trabajó de forma independiente, con guía mínima"},
    {"porcentaje":100,"descripcion":"Trabajó de forma completamente autónoma"}
  ]}
]'::jsonb),
(NULL, 'saber', 'Plantilla base — Saber', '[
  {"nombre":"Dominio del contenido","porcentaje":40,"niveles":[
    {"porcentaje":0,"descripcion":"No demuestra conocimiento del tema"},
    {"porcentaje":55,"descripcion":"Conocimiento muy limitado, con errores conceptuales notorios"},
    {"porcentaje":65,"descripcion":"Conoce lo básico del tema, con vacíos importantes"},
    {"porcentaje":75,"descripcion":"Conoce el tema con claridad, con profundidad limitada"},
    {"porcentaje":85,"descripcion":"Domina el tema con buen nivel de profundidad"},
    {"porcentaje":100,"descripcion":"Domina el tema por completo, con profundidad sobresaliente"}
  ]},
  {"nombre":"Aplicación del conocimiento a un caso nuevo","porcentaje":30,"niveles":[
    {"porcentaje":0,"descripcion":"No logra aplicar el conocimiento a ninguna situación"},
    {"porcentaje":55,"descripcion":"Solo repite lo memorizado, sin aplicarlo a algo nuevo"},
    {"porcentaje":65,"descripcion":"Aplica el conocimiento de forma parcial o con ayuda"},
    {"porcentaje":75,"descripcion":"Aplica el conocimiento correctamente a situaciones similares"},
    {"porcentaje":85,"descripcion":"Aplica el conocimiento con soltura a situaciones nuevas"},
    {"porcentaje":100,"descripcion":"Aplica el conocimiento de forma sobresaliente a cualquier situación nueva"}
  ]},
  {"nombre":"Precisión de la respuesta","porcentaje":20,"niveles":[
    {"porcentaje":0,"descripcion":"No responde o responde algo no relacionado"},
    {"porcentaje":55,"descripcion":"Responde con errores conceptuales importantes"},
    {"porcentaje":65,"descripcion":"Responde con algunos errores, se aleja parcialmente de lo preguntado"},
    {"porcentaje":75,"descripcion":"Responde correctamente lo que se pregunta, sin desviarse"},
    {"porcentaje":85,"descripcion":"Responde con precisión y sin errores conceptuales"},
    {"porcentaje":100,"descripcion":"Responde con precisión total, exactamente lo solicitado"}
  ]},
  {"nombre":"Vocabulario técnico de la materia","porcentaje":10,"niveles":[
    {"porcentaje":0,"descripcion":"No usa ningún término propio de la materia"},
    {"porcentaje":55,"descripcion":"Usa muy pocos términos técnicos, mayormente lenguaje cotidiano"},
    {"porcentaje":65,"descripcion":"Usa algunos términos técnicos, de forma inconsistente"},
    {"porcentaje":75,"descripcion":"Usa el vocabulario técnico correcto en la mayoría de su respuesta"},
    {"porcentaje":85,"descripcion":"Usa el vocabulario técnico de forma correcta y consistente"},
    {"porcentaje":100,"descripcion":"Usa el vocabulario técnico propio de la materia con dominio total"}
  ]}
]'::jsonb);