-- 096-porteria-entrada-fuera-de-horario.sql
-- Portería: una ENTRADA registrada después de la hora de salida del turno se marca
-- "fuera de horario" (antes: "atraso" con alerta, por el margen de 90 min).
-- Ejemplo: Secundaria Tarde 13:30–17:50 → entrada 19:06 = fuera de horario, sin alerta.
-- Las salidas no cambian (siguen con 90 min de margen después de la hora de salida).
-- Solo reemplaza registrar_porteria (versión 093 + este ajuste). No toca tablas ni registros.

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
     -- 096: una ENTRADA después de la hora de salida ya no es atraso → queda "fuera de horario".
     --      Las SALIDAS conservan el margen de 90 min después de la hora de salida.
     AND v_t <= CASE WHEN p_tipo = 'entrada' THEN h.hora_salida
                     ELSE h.hora_salida + interval '90 minutes' END
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