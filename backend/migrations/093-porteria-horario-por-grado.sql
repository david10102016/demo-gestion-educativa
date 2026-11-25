-- 093-porteria-horario-por-grado.sql
-- Excepciones de horario de portería por GRADO (configurables por el director).
-- Caso: Secundaria Tarde entra 13:30, pero 5° y 6° entran 14:00 (todos sus paralelos).
-- Regla al escanear: si el grado del estudiante tiene excepción en un turno, se usa esa;
-- si no, el horario del nivel (como antes). Colegios sin excepciones: sin cambios.
-- Cambios: 1 tabla nueva + RLS lectura, 2 funciones nuevas (guardar/quitar),
-- registrar_porteria reemplazada (solo cambia la búsqueda del horario).
-- No toca registros existentes.

BEGIN;

CREATE TABLE public.porteria_horarios_grado (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id     uuid NOT NULL REFERENCES public.colegios(id),
  turno          text NOT NULL CHECK (turno IN ('manana','tarde','noche')),
  nivel          text NOT NULL,
  hora_entrada   time NOT NULL,
  tolerancia_min int  NOT NULL DEFAULT 10 CHECK (tolerancia_min BETWEEN 0 AND 120),
  hora_salida    time NOT NULL CHECK (hora_salida > hora_entrada),
  activo         boolean NOT NULL DEFAULT true,
  grado          int  NOT NULL CHECK (grado BETWEEN 1 AND 6),
  UNIQUE (colegio_id, turno, nivel, grado)
);

ALTER TABLE public.porteria_horarios_grado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.porteria_horarios_grado FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.porteria_horarios_grado FROM authenticated;
GRANT SELECT ON public.porteria_horarios_grado TO authenticated;
CREATE POLICY porteria_horarios_grado_select ON public.porteria_horarios_grado
  FOR SELECT USING (
    colegio_id = public.mi_colegio_id()
    AND (public.es_director() OR public.es_regente())
  );

-- Guardar excepción: un registro por grado (mismo turno/nivel/horas para todos los grados marcados)
CREATE OR REPLACE FUNCTION public.guardar_horario_grado_porteria(
  p_turno          text,
  p_nivel          text,
  p_grados         int[],
  p_hora_entrada   time,
  p_tolerancia_min int,
  p_hora_salida    time
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_g int;
  v_n int := 0;
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF p_turno NOT IN ('manana','tarde','noche') THEN
    RAISE EXCEPTION 'Turno inválido';
  END IF;
  IF p_grados IS NULL OR cardinality(p_grados) = 0 THEN
    RAISE EXCEPTION 'Marque al menos un grado';
  END IF;
  IF p_hora_salida <= p_hora_entrada THEN
    RAISE EXCEPTION 'La hora de salida debe ser posterior a la de entrada';
  END IF;
  IF p_tolerancia_min < 0 OR p_tolerancia_min > 120 THEN
    RAISE EXCEPTION 'Tolerancia fuera de rango (0–120 min)';
  END IF;
  FOREACH v_g IN ARRAY p_grados LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cursos c
                    WHERE c.colegio_id = v_colegio AND c.nivel = p_nivel AND c.grado = v_g AND c.activo) THEN
      RAISE EXCEPTION 'No hay cursos activos de %° %', v_g, p_nivel;
    END IF;
    INSERT INTO public.porteria_horarios_grado
      (colegio_id, turno, nivel, grado, hora_entrada, tolerancia_min, hora_salida, activo)
    VALUES (v_colegio, p_turno, p_nivel, v_g, p_hora_entrada, p_tolerancia_min, p_hora_salida, true)
    ON CONFLICT (colegio_id, turno, nivel, grado) DO UPDATE
      SET hora_entrada = EXCLUDED.hora_entrada, tolerancia_min = EXCLUDED.tolerancia_min,
          hora_salida = EXCLUDED.hora_salida, activo = true;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Quitar una excepción (vuelve a regir el horario del nivel para ese grado)
CREATE OR REPLACE FUNCTION public.quitar_horario_grado_porteria(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  DELETE FROM public.porteria_horarios_grado
   WHERE id = p_id AND colegio_id = public.mi_colegio_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excepción no encontrada';
  END IF;
END;
$$;

-- registrar_porteria: igual a la 091; solo cambia la búsqueda del horario (excepción por grado primero)
CREATE OR REPLACE FUNCTION public.registrar_porteria(
  p_client_uuid uuid,
  p_tipo        text,
  p_codigo      text        DEFAULT NULL,
  p_estudiante_id uuid      DEFAULT NULL,
  p_hora        timestamptz DEFAULT NULL,
  p_metodo      text        DEFAULT 'qr',
  p_dispositivo text        DEFAULT NULL,
  p_motivo      text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio  uuid := public.mi_colegio_id();
  v_hora     timestamptz := COALESCE(p_hora, now());
  v_local    timestamp;
  v_fecha    date;
  v_t        time;
  v_est      uuid;
  v_nombre   text;
  v_foto     text;
  v_curso    text;
  v_nivel    text;
  v_grado    int;
  v_h        public.porteria_horarios%ROWTYPE;
  v_estado   text;
  v_turno    text;
  v_dup      boolean;
  v_max      int;
  v_salidas  int;
  v_metodo   text := p_metodo;
  v_id       uuid;
  v_prev     public.asistencia_porteria%ROWTYPE;
BEGIN
  IF NOT public.es_regente() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF NOT public.porteria_activa() THEN
    RAISE EXCEPTION 'Portería QR no está activada en este colegio';
  END IF;
  IF p_tipo NOT IN ('entrada','salida') THEN
    RAISE EXCEPTION 'Tipo inválido';
  END IF;
  IF v_metodo NOT IN ('qr','manual') THEN
    RAISE EXCEPTION 'Método no permitido desde el escáner';
  END IF;
  IF v_hora > now() + interval '5 minutes' OR v_hora < now() - interval '7 days' THEN
    RAISE EXCEPTION 'Hora fuera de rango';
  END IF;

  -- Idempotencia: reenvío de la cola sin internet
  IF p_client_uuid IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.asistencia_porteria
     WHERE client_uuid = p_client_uuid AND colegio_id = v_colegio;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'repetido', true,
        'registro_id', v_prev.id, 'estado', v_prev.estado,
        'tipo', v_prev.tipo, 'duplicado', v_prev.duplicado);
    END IF;
  END IF;

  -- Resolver estudiante (QR o manual)
  IF p_codigo IS NOT NULL THEN
    SELECT q.estudiante_id INTO v_est
      FROM public.porteria_qr q
     WHERE q.codigo = p_codigo AND q.activo AND q.colegio_id = v_colegio;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QR no válido o anulado';
    END IF;
    v_metodo := 'qr';
  ELSIF p_estudiante_id IS NOT NULL THEN
    v_est := p_estudiante_id;
    v_metodo := 'manual';
  ELSE
    RAISE EXCEPTION 'Falta el QR o el estudiante';
  END IF;

  SELECT u.nombre_completo, COALESCE(e.foto_url, u.foto_url),
         c.nombre_completo, c.nivel, c.grado
    INTO v_nombre, v_foto, v_curso, v_nivel, v_grado
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id
    LEFT JOIN public.cursos c ON c.id = e.curso_id
   WHERE e.id = v_est AND e.colegio_id = v_colegio AND u.activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estudiante no encontrado o inactivo';
  END IF;

  v_local := v_hora AT TIME ZONE 'America/La_Paz';
  v_fecha := v_local::date;
  v_t     := v_local::time;

  -- Evita que dos celulares escaneen al mismo estudiante en simultáneo
  PERFORM pg_advisory_xact_lock(hashtext(v_est::text));

  -- Turno: el horario activo de su nivel cuya ventana contiene la hora.
  -- Entrada → el más cercano a su hora de entrada; salida → a su hora de salida
  -- (evita que una salida 12:35 caiga en el turno tarde que entra 13:30).
  -- 093: si el GRADO del estudiante tiene una excepción en un turno, esa reemplaza
  -- al horario del nivel en ese turno (ej. Secundaria Tarde 13:30; 5° y 6° Tarde 14:00).
  SELECT h.* INTO v_h
    FROM (
      SELECT g.id, g.colegio_id, g.turno, g.nivel, g.hora_entrada, g.tolerancia_min, g.hora_salida, g.activo
        FROM public.porteria_horarios_grado g
       WHERE g.colegio_id = v_colegio AND g.nivel = v_nivel AND g.grado = v_grado AND g.activo
      UNION ALL
      SELECT n.id, n.colegio_id, n.turno, n.nivel, n.hora_entrada, n.tolerancia_min, n.hora_salida, n.activo
        FROM public.porteria_horarios n
       WHERE n.colegio_id = v_colegio AND n.nivel = v_nivel AND n.activo
         AND NOT EXISTS (SELECT 1 FROM public.porteria_horarios_grado g2
                          WHERE g2.colegio_id = v_colegio AND g2.nivel = v_nivel
                            AND g2.grado = v_grado AND g2.turno = n.turno AND g2.activo)
    ) h
   WHERE v_t >= h.hora_entrada - interval '90 minutes'
     AND v_t <= h.hora_salida  + interval '90 minutes'
   ORDER BY abs(extract(epoch FROM (v_t - CASE WHEN p_tipo = 'salida'
                                                THEN h.hora_salida ELSE h.hora_entrada END)))
   LIMIT 1;

  IF FOUND THEN
    v_turno := v_h.turno;
    IF p_tipo = 'entrada' THEN
      v_estado := CASE WHEN v_t <= v_h.hora_entrada + make_interval(mins => v_h.tolerancia_min)
                       THEN 'a_tiempo' ELSE 'atraso' END;
    ELSE
      v_estado := CASE WHEN v_t < v_h.hora_salida THEN 'salida_anticipada' ELSE 'normal' END;
    END IF;
  ELSE
    v_turno  := NULL;
    v_estado := 'fuera_de_horario';
  END IF;

  -- Doble registro (mismo tipo, <5 min): se conserva el primero
  SELECT EXISTS (
    SELECT 1 FROM public.asistencia_porteria r
     WHERE r.estudiante_id = v_est AND r.fecha = v_fecha AND r.tipo = p_tipo
       AND NOT r.duplicado
       AND abs(extract(epoch FROM (r.hora - v_hora))) < 300
  ) INTO v_dup;

  INSERT INTO public.asistencia_porteria
    (colegio_id, estudiante_id, fecha, hora, turno, tipo, estado, metodo,
     dispositivo, registrado_por, motivo, duplicado, client_uuid)
  VALUES
    (v_colegio, v_est, v_fecha, v_hora, v_turno, p_tipo, v_estado, v_metodo,
     p_dispositivo, auth.uid(), NULLIF(btrim(p_motivo), ''), v_dup, p_client_uuid)
  RETURNING id INTO v_id;

  -- Alertas automáticas
  IF v_dup THEN
    INSERT INTO public.porteria_alertas (colegio_id, estudiante_id, fecha, tipo, registro_id)
    VALUES (v_colegio, v_est, v_fecha, 'duplicado', v_id);
  ELSE
    IF v_estado = 'atraso' THEN
      INSERT INTO public.porteria_alertas (colegio_id, estudiante_id, fecha, tipo, registro_id)
      VALUES (v_colegio, v_est, v_fecha, 'atraso', v_id);
    ELSIF v_estado = 'salida_anticipada' THEN
      INSERT INTO public.porteria_alertas (colegio_id, estudiante_id, fecha, tipo, registro_id)
      VALUES (v_colegio, v_est, v_fecha, 'salida_anticipada', v_id);
    END IF;

    IF p_tipo = 'salida' THEN
      SELECT cg.porteria_max_salidas INTO v_max
        FROM public.config_gestion cg
       WHERE cg.colegio_id = v_colegio AND cg.estado = 'activo'
       ORDER BY cg.año DESC LIMIT 1;

      SELECT count(*) INTO v_salidas
        FROM public.asistencia_porteria r
       WHERE r.estudiante_id = v_est AND r.fecha = v_fecha AND r.tipo = 'salida'
         AND NOT r.duplicado AND r.turno IS NOT DISTINCT FROM v_turno;

      IF v_salidas > COALESCE(v_max, 2) AND NOT EXISTS (
        SELECT 1 FROM public.porteria_alertas a
         WHERE a.estudiante_id = v_est AND a.fecha = v_fecha AND a.tipo = 'exceso_salidas'
      ) THEN
        INSERT INTO public.porteria_alertas (colegio_id, estudiante_id, fecha, tipo, registro_id)
        VALUES (v_colegio, v_est, v_fecha, 'exceso_salidas', v_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'repetido', false, 'registro_id', v_id,
    'estudiante_id', v_est, 'nombre', v_nombre, 'foto_url', v_foto,
    'curso', v_curso, 'tipo', p_tipo, 'estado', v_estado, 'turno', v_turno,
    'hora', v_hora, 'duplicado', v_dup, 'metodo', v_metodo
  );
END;
$$;


REVOKE ALL ON FUNCTION public.guardar_horario_grado_porteria(text, text, int[], time, int, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quitar_horario_grado_porteria(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_horario_grado_porteria(text, text, int[], time, int, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quitar_horario_grado_porteria(uuid) TO authenticated;

COMMIT;