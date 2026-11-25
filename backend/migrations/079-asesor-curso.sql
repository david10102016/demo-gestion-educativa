-- ============================================================
-- MIGRACIÓN 079 (CORREGIDA): Asesor de curso
--
-- Cambios respecto a la 079 original (ver informe):
--  1. año_gestion_vigente(): ahora es POR COLEGIO (antes tomaba el año más
--     reciente de TODOS los colegios) y coincide con get_config_año().
--  2. es_asesor_activo_curso(): usa ese año por colegio; se corrige el filtro
--     de estado ('activo'), que antes nunca coincidía.
--  3. asesor_notas_curso(): pesos de dimensiones solo del colegio del asesor
--     (antes mezclaba los de otros colegios) y solo estudiantes activos.
--  4. asesor_asistencia_curso(): solo estudiantes activos.
--  5. asesor_datos_libreta(): usa estudiantes.estado='activo' (la columna
--     estudiantes.activo NO existe → la función fallaba).
--  6. Funciones auxiliares: EXECUTE solo para authenticated.
--  7. asesor_notas_curso(): reescrita para calcular las marcas en una sola
--     pasada (de ~8 s a ~2 s por curso con 76 mil notas); mismo resultado.
--
-- Un asesor por curso y un curso por asesor, por año (gestión).
-- Solo lectura en notas, asistencia y libretas del curso asignado.
-- Si el asesor se retira o cambia, el director asigna a otro;
-- la fila anterior queda en historial (activo=false), no se borra.
--
-- NO otorga SELECT directo sobre notas, actividades ni
-- asistencias_materia al profesor-asesor. Todo pasa por las
-- funciones SECURITY DEFINER de solo lectura definidas abajo.
-- ============================================================

-- ── 1. TABLA ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asesor_curso (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id   uuid NOT NULL REFERENCES public.colegios(id) ON DELETE CASCADE,
  curso_id     uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  profesor_id  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  año          integer NOT NULL,
  activo       boolean NOT NULL DEFAULT true,
  asignado_por uuid REFERENCES public.usuarios(id),
  asignado_en  timestamptz NOT NULL DEFAULT now(),
  desactivado_en timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asesor_curso_año_positivo CHECK (año >= 2000 AND año <= 2100)
);

COMMENT ON TABLE public.asesor_curso IS
  'Asesor de curso (1 activo por curso/año y 1 curso activo por profesor/año). Historial por desactivación, sin borrado.';

CREATE INDEX IF NOT EXISTS asesor_curso_colegio_año_idx
  ON public.asesor_curso (colegio_id, año);

CREATE INDEX IF NOT EXISTS asesor_curso_profesor_idx
  ON public.asesor_curso (profesor_id, año);

CREATE INDEX IF NOT EXISTS asesor_curso_curso_idx
  ON public.asesor_curso (curso_id, año);

-- Unicidad solo sobre filas activas
CREATE UNIQUE INDEX IF NOT EXISTS asesor_curso_un_curso_activo
  ON public.asesor_curso (curso_id, año)
  WHERE activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS asesor_curso_un_profesor_activo
  ON public.asesor_curso (profesor_id, año)
  WHERE activo = true;

-- Trigger updated_at (reutiliza set_updated_at si existe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS set_updated_at_asesor_curso ON public.asesor_curso;
    CREATE TRIGGER set_updated_at_asesor_curso
      BEFORE UPDATE ON public.asesor_curso
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ── 2. RLS ────────────────────────────────────────────────
ALTER TABLE public.asesor_curso ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.asesor_curso FROM PUBLIC;
REVOKE ALL ON public.asesor_curso FROM anon;

-- Director del colegio: lectura y escritura de su colegio
DROP POLICY IF EXISTS asesor_curso_select_director ON public.asesor_curso;
CREATE POLICY asesor_curso_select_director
  ON public.asesor_curso FOR SELECT
  USING (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS asesor_curso_insert_director ON public.asesor_curso;
CREATE POLICY asesor_curso_insert_director
  ON public.asesor_curso FOR INSERT
  WITH CHECK (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
    AND asignado_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = asesor_curso.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = asesor_curso.profesor_id
        AND u.rol = 'profesor'
        AND u.activo = true
        AND u.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS asesor_curso_update_director ON public.asesor_curso;
CREATE POLICY asesor_curso_update_director
  ON public.asesor_curso FOR UPDATE
  USING (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
  )
  WITH CHECK (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
  );

-- Profesor: solo lee su propia fila (activa o historial propio)
DROP POLICY IF EXISTS asesor_curso_select_profesor ON public.asesor_curso;
CREATE POLICY asesor_curso_select_profesor
  ON public.asesor_curso FOR SELECT
  USING (
    public.es_profesor()
    AND profesor_id = auth.uid()
  );

-- Nadie más escribe. Sin DELETE policy → no se puede borrar por RLS.

-- ── 3. HELPERS INTERNOS ───────────────────────────────────
-- Año vigente DEL COLEGIO del llamante. Misma regla que el frontend
-- (get_config_año: año calendario del colegio); si el colegio aún no tiene esa
-- gestión, la 'activo' más reciente de ESE colegio, luego la más reciente.
CREATE OR REPLACE FUNCTION public.año_gestion_vigente()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT cg.año FROM public.config_gestion cg
      WHERE cg.colegio_id = public.mi_colegio_id()
        AND cg.año = EXTRACT(YEAR FROM now())::integer),
    (SELECT cg.año FROM public.config_gestion cg
      WHERE cg.colegio_id = public.mi_colegio_id() AND cg.estado = 'activo'
      ORDER BY cg.año DESC LIMIT 1),
    (SELECT cg.año FROM public.config_gestion cg
      WHERE cg.colegio_id = public.mi_colegio_id()
      ORDER BY cg.año DESC LIMIT 1),
    EXTRACT(YEAR FROM now())::integer
  );
$$;

-- ¿El llamante es el asesor activo de ese curso en el año vigente?
CREATE OR REPLACE FUNCTION public.es_asesor_activo_curso(p_curso_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asesor_curso ac
    WHERE ac.curso_id    = p_curso_id
      AND ac.profesor_id = auth.uid()
      AND ac.activo      = true
      AND ac.colegio_id  = public.mi_colegio_id()
      AND ac.año         = public.año_gestion_vigente()
  );
$$;

COMMENT ON FUNCTION public.es_asesor_activo_curso(uuid) IS
  'True si auth.uid() es el asesor activo del curso en el año vigente de su colegio.';

REVOKE ALL ON FUNCTION public.es_asesor_activo_curso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.es_asesor_activo_curso(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.año_gestion_vigente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.año_gestion_vigente() TO authenticated;

-- ── 4. RPC de asignación (director) ───────────────────────
-- Asigna o cambia asesor: desactiva el anterior del curso y el
-- anterior del profesor (si tenía otro curso) y crea la nueva fila.
CREATE OR REPLACE FUNCTION public.asignar_asesor_curso(
  p_curso_id     uuid,
  p_profesor_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_colegio uuid;
  v_año     integer;
  v_id      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Solo el director puede asignar asesores de curso';
  END IF;

  v_colegio := public.mi_colegio_id();
  IF v_colegio IS NULL THEN
    RAISE EXCEPTION 'El director no tiene colegio asignado';
  END IF;

  v_año := public.año_gestion_vigente();

  -- Curso del colegio
  IF NOT EXISTS (
    SELECT 1 FROM public.cursos c
    WHERE c.id = p_curso_id AND c.colegio_id = v_colegio
  ) THEN
    RAISE EXCEPTION 'El curso no pertenece a este colegio';
  END IF;

  -- Profesor activo del colegio
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = p_profesor_id
      AND u.rol = 'profesor'
      AND u.activo = true
      AND u.colegio_id = v_colegio
  ) THEN
    RAISE EXCEPTION 'El profesor no es un profesor activo de este colegio';
  END IF;

  -- Desactivar asesor activo actual del curso (historial)
  UPDATE public.asesor_curso
  SET activo = false, desactivado_en = now()
  WHERE curso_id = p_curso_id
    AND año = v_año
    AND activo = true;

  -- Desactivar otras asignaciones activas del mismo profesor este año
  UPDATE public.asesor_curso
  SET activo = false, desactivado_en = now()
  WHERE profesor_id = p_profesor_id
    AND año = v_año
    AND activo = true;

  INSERT INTO public.asesor_curso (
    colegio_id, curso_id, profesor_id, año, activo, asignado_por
  ) VALUES (
    v_colegio, p_curso_id, p_profesor_id, v_año, true, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.asignar_asesor_curso(uuid, uuid) IS
  'Director: asigna o cambia el asesor de un curso. Desactiva la fila anterior (historial).';

REVOKE ALL ON FUNCTION public.asignar_asesor_curso(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asignar_asesor_curso(uuid, uuid) TO authenticated;

-- Retirar asesor (desactivar sin reemplazo)
CREATE OR REPLACE FUNCTION public.retirar_asesor_curso(p_curso_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Solo el director puede retirar asesores de curso';
  END IF;

  UPDATE public.asesor_curso
  SET activo = false, desactivado_en = now()
  WHERE curso_id = p_curso_id
    AND año = public.año_gestion_vigente()
    AND activo = true
    AND colegio_id = public.mi_colegio_id();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.retirar_asesor_curso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retirar_asesor_curso(uuid) TO authenticated;

-- ── 5. LECTURA SEGURA: NOTAS DEL CURSO ────────────────────
-- Por estudiante, materia y trimestre: nota final + marcas de
-- dimensiones (calificada/pendiente) + puntos aún posibles.
-- NO devuelve actividades ni comentarios.
CREATE OR REPLACE FUNCTION public.asesor_notas_curso(p_curso_id uuid)
RETURNS TABLE (
  estudiante_id   uuid,
  estudiante      text,
  carnet          text,
  materia_id      uuid,
  materia         text,
  trimestre       integer,
  nota_final      numeric,
  hacer_estado    text,   -- 'calificada' | 'pendiente'
  saber_estado    text,
  ser_estado      text,
  decidir_estado  text,
  puntos_posibles numeric -- peso de dimensiones aún pendientes
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_año integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN; -- cero filas si no es el asesor
  END IF;

  v_año := public.año_gestion_vigente();

  RETURN QUERY
  WITH dims AS (
    -- pesos SOLO del colegio del asesor
    SELECT
      MAX(CASE WHEN d.codigo = 'hacer'   THEN d.peso_maximo ELSE 0 END) AS peso_hacer,
      MAX(CASE WHEN d.codigo = 'saber'   THEN d.peso_maximo ELSE 0 END) AS peso_saber,
      MAX(CASE WHEN d.codigo = 'ser'     THEN d.peso_maximo ELSE 0 END) AS peso_ser,
      MAX(CASE WHEN d.codigo = 'decidir' THEN d.peso_maximo ELSE 0 END) AS peso_decidir
    FROM public.config_dimensiones d
    JOIN public.config_gestion g ON g.id = d.gestion_id
    WHERE g.año = v_año
      AND g.colegio_id = public.mi_colegio_id()
      AND d.activo = true
  ),
  base AS (
    SELECT nf.estudiante_id, nf.estudiante::text AS estudiante, nf.carnet::text AS carnet,
           nf.materia_id, nf.materia::text AS materia,
           nf.trimestre::integer AS trimestre, nf.nota_final::numeric AS nota_final
    FROM public.notas_finales nf
    WHERE nf.curso_id = p_curso_id
      AND nf.colegio_id = public.mi_colegio_id()
      AND EXISTS (SELECT 1 FROM public.estudiantes es
                  WHERE es.id = nf.estudiante_id AND es.estado = 'activo')
  ),
  -- Una sola pasada: qué (estudiante, materia, trimestre, tipo) ya tiene nota
  marcas AS (
    SELECT n.estudiante_id, a.materia_id, a.trimestre, a.tipo
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id
    WHERE a.curso_id = p_curso_id
      AND a.tipo IN ('hacer', 'saber')
    GROUP BY n.estudiante_id, a.materia_id, a.trimestre, a.tipo
  ),
  cal AS (
    SELECT c.estudiante_id, c.materia_id, c.trimestre,
           bool_or(c.nota_ser IS NOT NULL)     AS ser_ok,
           bool_or(c.nota_decidir IS NOT NULL) AS decidir_ok
    FROM public.calificaciones c
    WHERE c.estudiante_id IN (SELECT es.id FROM public.estudiantes es WHERE es.curso_id = p_curso_id)
    GROUP BY c.estudiante_id, c.materia_id, c.trimestre
  ),
  marcado AS (
    SELECT b.*,
      CASE WHEN mh.estudiante_id IS NOT NULL THEN 'calificada' ELSE 'pendiente' END AS hacer_estado,
      CASE WHEN ms.estudiante_id IS NOT NULL THEN 'calificada' ELSE 'pendiente' END AS saber_estado,
      CASE WHEN COALESCE(c.ser_ok, false)     THEN 'calificada' ELSE 'pendiente' END AS ser_estado,
      CASE WHEN COALESCE(c.decidir_ok, false) THEN 'calificada' ELSE 'pendiente' END AS decidir_estado
    FROM base b
    LEFT JOIN marcas mh ON mh.estudiante_id = b.estudiante_id AND mh.materia_id = b.materia_id
                       AND mh.trimestre = b.trimestre AND mh.tipo = 'hacer'
    LEFT JOIN marcas ms ON ms.estudiante_id = b.estudiante_id AND ms.materia_id = b.materia_id
                       AND ms.trimestre = b.trimestre AND ms.tipo = 'saber'
    LEFT JOIN cal c     ON c.estudiante_id  = b.estudiante_id AND c.materia_id  = b.materia_id
                       AND c.trimestre  = b.trimestre
  )
  SELECT
    m.estudiante_id, m.estudiante, m.carnet, m.materia_id, m.materia, m.trimestre, m.nota_final,
    m.hacer_estado, m.saber_estado, m.ser_estado, m.decidir_estado,
    (
      CASE WHEN m.hacer_estado   = 'pendiente' THEN COALESCE(d.peso_hacer, 0)   ELSE 0 END +
      CASE WHEN m.saber_estado   = 'pendiente' THEN COALESCE(d.peso_saber, 0)   ELSE 0 END +
      CASE WHEN m.ser_estado     = 'pendiente' THEN COALESCE(d.peso_ser, 0)     ELSE 0 END +
      CASE WHEN m.decidir_estado = 'pendiente' THEN COALESCE(d.peso_decidir, 0) ELSE 0 END
    )::numeric AS puntos_posibles
  FROM marcado m
  CROSS JOIN dims d
  ORDER BY m.estudiante, m.materia, m.trimestre;
END;
$$;

COMMENT ON FUNCTION public.asesor_notas_curso(uuid) IS
  'Asesor de curso: notas finales + marcas de dimensiones pendientes. Solo si es el asesor activo. Sin actividades ni comentarios.';

REVOKE ALL ON FUNCTION public.asesor_notas_curso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_notas_curso(uuid) TO authenticated;

-- ── 6. LECTURA SEGURA: ASISTENCIA DEL CURSO ───────────────
CREATE OR REPLACE FUNCTION public.asesor_asistencia_curso(
  p_curso_id uuid,
  p_desde    date,
  p_hasta    date
)
RETURNS TABLE (
  estudiante_id uuid,
  estudiante    text,
  fecha         date,
  sesion        text,
  estado        text,
  materia_excepcion text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN;
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_desde > p_hasta THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.estudiante_id,
    u.nombre_completo::text AS estudiante,
    r.fecha,
    r.sesion::text,
    r.estado_resumen::text AS estado,
    r.materia_excepcion::text
  FROM public.asistencia_resumen_diario r
  JOIN public.estudiantes e ON e.id = r.estudiante_id
  JOIN public.usuarios u ON u.id = e.id
  WHERE r.curso_id = p_curso_id
    AND r.fecha BETWEEN p_desde AND p_hasta
    AND e.colegio_id = public.mi_colegio_id()
    AND e.estado = 'activo'
  ORDER BY u.nombre_completo, r.fecha, r.sesion;
END;
$$;

COMMENT ON FUNCTION public.asesor_asistencia_curso(uuid, date, date) IS
  'Asesor de curso: resumen diario de asistencia del curso. Solo lectura. Cero filas si no es el asesor.';

REVOKE ALL ON FUNCTION public.asesor_asistencia_curso(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_asistencia_curso(uuid, date, date) TO authenticated;

-- ── 7. LECTURA SEGURA: DATOS PARA LIBRETAS ────────────────
CREATE OR REPLACE FUNCTION public.asesor_datos_libreta(p_curso_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'curso', (
      SELECT jsonb_build_object(
        'id', c.id,
        'nombre_completo', c.nombre_completo,
        'nivel', c.nivel,
        'grado', c.grado
      )
      FROM public.cursos c
      WHERE c.id = p_curso_id AND c.colegio_id = public.mi_colegio_id()
    ),
    'colegio', (
      SELECT jsonb_build_object(
        'nombre', col.nombre,
        'director_nombre', col.director_nombre
      )
      FROM public.colegios col
      WHERE col.id = public.mi_colegio_id()
    ),
    'estudiantes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'carnet', e.carnet,
          'nombre_completo', u.nombre_completo
        )
        ORDER BY u.nombre_completo
      )
      FROM public.estudiantes e
      JOIN public.usuarios u ON u.id = e.id
      WHERE e.curso_id = p_curso_id
        AND e.colegio_id = public.mi_colegio_id()
        AND e.estado = 'activo'
    ), '[]'::jsonb),
    'materias', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'nombre', m.nombre,
          'campo_saberes', m.campo_saberes,
          'es_tecnica', m.es_tecnica,
          'aplica_desde', m.aplica_desde,
          'nivel', m.nivel
        )
        ORDER BY m.nombre
      )
      FROM public.materias m
      JOIN public.cursos c ON c.id = p_curso_id
      WHERE m.activo = true
        AND m.colegio_id = public.mi_colegio_id()
        AND (m.nivel = c.nivel OR m.nivel = 'Ambos')
    ), '[]'::jsonb),
    'notas', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'estudiante_id', nf.estudiante_id,
          'materia_id', nf.materia_id,
          'trimestre', nf.trimestre,
          'nota_final', nf.nota_final
        )
      )
      FROM public.notas_finales nf
      WHERE nf.curso_id = p_curso_id
        AND nf.colegio_id = public.mi_colegio_id()
        AND EXISTS (SELECT 1 FROM public.estudiantes es
                    WHERE es.id = nf.estudiante_id AND es.estado = 'activo')
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.asesor_datos_libreta(uuid) IS
  'Asesor de curso: datos para armar libretas (estudiantes, materias, notas finales, colegio). Solo si es el asesor activo.';

REVOKE ALL ON FUNCTION public.asesor_datos_libreta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asesor_datos_libreta(uuid) TO authenticated;

-- ── 8. Consulta de mi curso (profesor) ────────────────────
CREATE OR REPLACE FUNCTION public.mi_asesoria_curso()
RETURNS TABLE (
  asesor_id   uuid,
  curso_id    uuid,
  curso       text,
  nivel       text,
  grado       integer,
  año         integer,
  asignado_en timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ac.id,
    ac.curso_id,
    c.nombre_completo::text,
    c.nivel::text,
    c.grado::integer,
    ac.año,
    ac.asignado_en
  FROM public.asesor_curso ac
  JOIN public.cursos c ON c.id = ac.curso_id
  WHERE ac.profesor_id = auth.uid()
    AND ac.activo = true
    AND ac.año = public.año_gestion_vigente()
    AND ac.colegio_id = public.mi_colegio_id()
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mi_asesoria_curso() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mi_asesoria_curso() TO authenticated;