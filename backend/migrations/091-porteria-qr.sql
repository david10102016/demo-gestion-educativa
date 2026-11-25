-- =====================================================================
-- MIGRACIÓN 091: Portería QR (ingreso y salida de estudiantes)
-- ---------------------------------------------------------------------
-- Módulo OPCIONAL por colegio (switch config_gestion.usa_porteria).
-- 100% aditiva: no modifica asistencias_materia ni novedades_asistencia_dia.
--
-- Contenido:
--   1. Rol 'regente' (usuarios_rol_check + asignar_rol_privilegiado)
--   2. Switch y umbral en config_gestion
--   3. Tablas: porteria_horarios, porteria_qr, asistencia_porteria,
--              porteria_alertas
--   4. Helpers: es_regente(), porteria_activa()
--   5. RLS (lectura por rol; escritura SOLO por funciones SECURITY DEFINER)
--   6. Funciones: registrar_porteria, anotar_motivo_porteria,
--      justificar_alerta_porteria, guardar_horario_porteria,
--      generar_qr_curso, regenerar_qr_estudiante, porteria_lista_escaner,
--      porteria_ingreso_hoy_curso, porteria_resumen_dia, porteria_cruce_dia
--
-- Zona horaria de negocio: America/La_Paz (Bolivia).
-- Revertir: DROP de las 4 tablas y funciones; quitar 'regente' del CHECK.
-- Probar primero en local, como en las migraciones 088–090.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. ROL REGENTE
-- ---------------------------------------------------------------------
-- Lista vigente: 009 es la última migración que toca este CHECK.
-- Si en producción la restricción difiere, verificar con:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'usuarios_rol_check';
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY['director','profesor','estudiante','secretaria',
                          'tutor','superadmin','regente']));

-- Misma función de 029, con 'regente' permitido. Un director solo crea
-- roles dentro de su propio colegio y nunca otro director.
CREATE OR REPLACE FUNCTION public.asignar_rol_privilegiado(
  p_usuario_id UUID,
  p_rol        TEXT,
  p_colegio_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT (public.es_director() OR public.es_superadmin()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF p_rol NOT IN ('profesor', 'secretaria', 'director', 'regente') THEN
    RAISE EXCEPTION 'Rol no permitido para esta función';
  END IF;

  IF public.es_director() AND NOT public.es_superadmin() THEN
    IF p_rol = 'director' THEN
      RAISE EXCEPTION 'Sin permisos para crear otro director';
    END IF;
    UPDATE public.usuarios
       SET rol = p_rol, colegio_id = public.mi_colegio_id(), activo = true
     WHERE id = p_usuario_id;
  ELSE
    UPDATE public.usuarios
       SET rol = p_rol,
           colegio_id = COALESCE(p_colegio_id, public.mi_colegio_id()),
           activo = true
     WHERE id = p_usuario_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.asignar_rol_privilegiado(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.asignar_rol_privilegiado(UUID, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. SWITCH POR COLEGIO (sin relación con planes)
-- ---------------------------------------------------------------------
ALTER TABLE public.config_gestion
  ADD COLUMN IF NOT EXISTS usa_porteria        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS porteria_max_salidas int    NOT NULL DEFAULT 2
    CHECK (porteria_max_salidas BETWEEN 1 AND 20);

-- ---------------------------------------------------------------------
-- 3. TABLAS
-- ---------------------------------------------------------------------
CREATE TABLE public.porteria_horarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id     uuid NOT NULL REFERENCES public.colegios(id),
  turno          text NOT NULL CHECK (turno IN ('manana','tarde','noche')),
  nivel          text NOT NULL,
  hora_entrada   time NOT NULL,
  tolerancia_min int  NOT NULL DEFAULT 10 CHECK (tolerancia_min BETWEEN 0 AND 120),
  hora_salida    time NOT NULL CHECK (hora_salida > hora_entrada),
  activo         boolean NOT NULL DEFAULT true,
  UNIQUE (colegio_id, turno, nivel)
);

CREATE TABLE public.porteria_qr (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id    uuid NOT NULL REFERENCES public.colegios(id),
  estudiante_id uuid NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  codigo        text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  anulado_at    timestamptz
);
CREATE UNIQUE INDEX porteria_qr_un_activo
  ON public.porteria_qr (estudiante_id) WHERE activo;
CREATE INDEX porteria_qr_colegio ON public.porteria_qr (colegio_id);

CREATE TABLE public.asistencia_porteria (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id     uuid NOT NULL REFERENCES public.colegios(id),
  estudiante_id  uuid NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  fecha          date NOT NULL,
  hora           timestamptz NOT NULL,
  turno          text CHECK (turno IN ('manana','tarde','noche')),
  tipo           text NOT NULL CHECK (tipo IN ('entrada','salida')),
  estado         text NOT NULL CHECK (estado IN
                   ('a_tiempo','atraso','salida_anticipada','normal','fuera_de_horario')),
  metodo         text NOT NULL CHECK (metodo IN
                   ('qr','manual','carnet','nfc','tarjeta','huella','facial')),
  dispositivo    text,
  registrado_por uuid REFERENCES public.usuarios(id),
  motivo         text,
  duplicado      boolean NOT NULL DEFAULT false,
  client_uuid    uuid UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asistencia_porteria_colegio_fecha
  ON public.asistencia_porteria (colegio_id, fecha);
CREATE INDEX asistencia_porteria_est_fecha
  ON public.asistencia_porteria (estudiante_id, fecha);

CREATE TABLE public.porteria_alertas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id      uuid NOT NULL REFERENCES public.colegios(id),
  estudiante_id   uuid NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  fecha           date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN
                    ('atraso','salida_anticipada','exceso_salidas','duplicado',
                     'posible_fuga','inconsistencia')),
  registro_id     uuid REFERENCES public.asistencia_porteria(id) ON DELETE SET NULL,
  estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','justificada')),
  justificacion   text,
  justificado_por uuid REFERENCES public.usuarios(id),
  justificado_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX porteria_alertas_colegio_estado
  ON public.porteria_alertas (colegio_id, estado, fecha);

-- ---------------------------------------------------------------------
-- 4. HELPERS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_regente()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'regente' AND activo = true
  );
$$;

-- ¿El colegio del llamante tiene el módulo encendido en su gestión activa?
CREATE OR REPLACE FUNCTION public.porteria_activa()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.config_gestion cg
    WHERE cg.colegio_id = public.mi_colegio_id()
      AND cg.estado = 'activo'
      AND cg.usa_porteria = true
  );
$$;

REVOKE ALL ON FUNCTION public.es_regente()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.porteria_activa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_regente()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.porteria_activa() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS: lectura por rol. Sin políticas de escritura: solo funciones.
-- ---------------------------------------------------------------------
ALTER TABLE public.porteria_horarios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.porteria_qr         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistencia_porteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.porteria_alertas    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.porteria_horarios, public.porteria_qr,
              public.asistencia_porteria, public.porteria_alertas FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.porteria_horarios, public.porteria_qr,
              public.asistencia_porteria, public.porteria_alertas FROM authenticated;

CREATE POLICY porteria_horarios_select ON public.porteria_horarios
  FOR SELECT USING (
    colegio_id = public.mi_colegio_id()
    AND (public.es_director() OR public.es_regente())
  );

CREATE POLICY porteria_qr_select_director ON public.porteria_qr
  FOR SELECT USING (
    colegio_id = public.mi_colegio_id() AND public.es_director()
  );

CREATE POLICY porteria_reg_select_director ON public.asistencia_porteria
  FOR SELECT USING (
    colegio_id = public.mi_colegio_id() AND public.es_director()
  );

-- El regente solo ve lo que registró en las últimas 24 h (para su lista de pantalla)
CREATE POLICY porteria_reg_select_regente ON public.asistencia_porteria
  FOR SELECT USING (
    public.es_regente()
    AND registrado_por = auth.uid()
    AND created_at > now() - interval '24 hours'
  );

CREATE POLICY porteria_reg_select_estudiante ON public.asistencia_porteria
  FOR SELECT USING (estudiante_id = auth.uid() AND NOT duplicado);

CREATE POLICY porteria_reg_select_tutor ON public.asistencia_porteria
  FOR SELECT USING (
    NOT duplicado AND EXISTS (
      SELECT 1 FROM public.tutor_estudiante te
      WHERE te.estudiante_id = asistencia_porteria.estudiante_id
        AND te.tutor_id = auth.uid()
        AND te.activo = true
    )
  );

CREATE POLICY porteria_alertas_select_director ON public.porteria_alertas
  FOR SELECT USING (
    colegio_id = public.mi_colegio_id() AND public.es_director()
  );

-- Estudiante y tutor ven sus alertas y la justificación (no las de 'duplicado': uso interno)
CREATE POLICY porteria_alertas_select_estudiante ON public.porteria_alertas
  FOR SELECT USING (estudiante_id = auth.uid() AND tipo <> 'duplicado');

CREATE POLICY porteria_alertas_select_tutor ON public.porteria_alertas
  FOR SELECT USING (
    tipo <> 'duplicado' AND EXISTS (
      SELECT 1 FROM public.tutor_estudiante te
      WHERE te.estudiante_id = porteria_alertas.estudiante_id
        AND te.tutor_id = auth.uid()
        AND te.activo = true
    )
  );

-- ---------------------------------------------------------------------
-- 6. FUNCIONES
-- ---------------------------------------------------------------------

-- 6.1 Registrar ingreso/salida (regente). Idempotente por client_uuid.
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
         c.nombre_completo, c.nivel
    INTO v_nombre, v_foto, v_curso, v_nivel
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
  SELECT h.* INTO v_h
    FROM public.porteria_horarios h
   WHERE h.colegio_id = v_colegio AND h.nivel = v_nivel AND h.activo
     AND v_t >= h.hora_entrada - interval '90 minutes'
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

-- 6.2 El regente anota el motivo de un atraso/salida anticipada que él registró
CREATE OR REPLACE FUNCTION public.anotar_motivo_porteria(p_registro_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.es_regente() OR NOT public.porteria_activa() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'El motivo no puede estar vacío';
  END IF;
  UPDATE public.asistencia_porteria
     SET motivo = btrim(p_motivo)
   WHERE id = p_registro_id
     AND colegio_id = public.mi_colegio_id()
     AND registrado_por = auth.uid()
     AND motivo IS NULL
     AND created_at > now() - interval '24 hours';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se puede anotar el motivo de este registro';
  END IF;
END;
$$;

-- 6.3 Justificar alerta (solo director; queda quién, cuándo y por qué)
CREATE OR REPLACE FUNCTION public.justificar_alerta_porteria(p_alerta_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Debe indicar el motivo de la justificación';
  END IF;
  UPDATE public.porteria_alertas
     SET estado = 'justificada', justificacion = btrim(p_motivo),
         justificado_por = auth.uid(), justificado_at = now()
   WHERE id = p_alerta_id
     AND colegio_id = public.mi_colegio_id()
     AND estado = 'pendiente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alerta no encontrada o ya justificada';
  END IF;
END;
$$;

-- 6.4 Guardar horario turno × nivel (director). Rechaza cruces en el mismo nivel.
CREATE OR REPLACE FUNCTION public.guardar_horario_porteria(
  p_turno          text,
  p_nivel          text,
  p_hora_entrada   time,
  p_tolerancia_min int,
  p_hora_salida    time,
  p_activo         boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_id uuid;
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF p_turno NOT IN ('manana','tarde','noche') THEN
    RAISE EXCEPTION 'Turno inválido';
  END IF;
  IF p_hora_salida <= p_hora_entrada THEN
    RAISE EXCEPTION 'La hora de salida debe ser posterior a la de entrada';
  END IF;
  IF p_tolerancia_min < 0 OR p_tolerancia_min > 120 THEN
    RAISE EXCEPTION 'Tolerancia fuera de rango (0–120 min)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cursos c
     WHERE c.colegio_id = v_colegio AND c.nivel = p_nivel AND c.activo
  ) THEN
    RAISE EXCEPTION 'El colegio no tiene cursos activos de nivel %', p_nivel;
  END IF;

  IF p_activo AND EXISTS (
    SELECT 1 FROM public.porteria_horarios h
     WHERE h.colegio_id = v_colegio AND h.nivel = p_nivel AND h.activo
       AND h.turno <> p_turno
       AND p_hora_entrada < h.hora_salida AND h.hora_entrada < p_hora_salida
  ) THEN
    RAISE EXCEPTION 'El horario se cruza con otro turno del mismo nivel';
  END IF;

  INSERT INTO public.porteria_horarios
    (colegio_id, turno, nivel, hora_entrada, tolerancia_min, hora_salida, activo)
  VALUES
    (v_colegio, p_turno, p_nivel, p_hora_entrada, p_tolerancia_min, p_hora_salida, p_activo)
  ON CONFLICT (colegio_id, turno, nivel) DO UPDATE
    SET hora_entrada = EXCLUDED.hora_entrada,
        tolerancia_min = EXCLUDED.tolerancia_min,
        hora_salida = EXCLUDED.hora_salida,
        activo = EXCLUDED.activo
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 6.5 Generar QR faltantes de un curso y devolver los códigos (para imprimir)
CREATE OR REPLACE FUNCTION public.generar_qr_curso(p_curso_id uuid)
RETURNS TABLE (estudiante_id uuid, nombre_completo text, carnet text, codigo text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cursos c WHERE c.id = p_curso_id AND c.colegio_id = v_colegio) THEN
    RAISE EXCEPTION 'Curso no encontrado';
  END IF;

  INSERT INTO public.porteria_qr (colegio_id, estudiante_id)
  SELECT v_colegio, e.id
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id AND u.activo
   WHERE e.curso_id = p_curso_id AND e.colegio_id = v_colegio
     AND NOT EXISTS (SELECT 1 FROM public.porteria_qr q WHERE q.estudiante_id = e.id AND q.activo);

  RETURN QUERY
  SELECT e.id, u.nombre_completo, e.carnet, q.codigo
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id AND u.activo
    JOIN public.porteria_qr q ON q.estudiante_id = e.id AND q.activo
   WHERE e.curso_id = p_curso_id AND e.colegio_id = v_colegio
   ORDER BY u.nombre_completo;
END;
$$;

-- 6.6 Anular el QR vigente y emitir uno nuevo (QR perdido o filtrado)
CREATE OR REPLACE FUNCTION public.regenerar_qr_estudiante(p_estudiante_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_codigo  text;
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.estudiantes e
                  WHERE e.id = p_estudiante_id AND e.colegio_id = v_colegio) THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;
  UPDATE public.porteria_qr SET activo = false, anulado_at = now()
   WHERE estudiante_id = p_estudiante_id AND activo;
  INSERT INTO public.porteria_qr (colegio_id, estudiante_id)
  VALUES (v_colegio, p_estudiante_id)
  RETURNING codigo INTO v_codigo;
  RETURN v_codigo;
END;
$$;

-- 6.7 Lista para el escáner (y su caché sin internet)
CREATE OR REPLACE FUNCTION public.porteria_lista_escaner()
RETURNS TABLE (estudiante_id uuid, nombre_completo text, curso text,
               nivel text, foto_url text, codigo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT (public.es_regente() OR public.es_director()) OR NOT public.porteria_activa() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  RETURN QUERY
  SELECT e.id, u.nombre_completo, c.nombre_completo, c.nivel,
         COALESCE(e.foto_url, u.foto_url), q.codigo
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id AND u.activo
    LEFT JOIN public.cursos c ON c.id = e.curso_id
    LEFT JOIN public.porteria_qr q ON q.estudiante_id = e.id AND q.activo
   WHERE e.colegio_id = public.mi_colegio_id()
   ORDER BY u.nombre_completo;
END;
$$;

-- 6.8 Profesor: solo la hora de ingreso de los estudiantes de su curso, hoy
CREATE OR REPLACE FUNCTION public.porteria_ingreso_hoy_curso(p_curso_id uuid)
RETURNS TABLE (estudiante_id uuid, hora_ingreso timestamptz, estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/La_Paz')::date;
BEGIN
  IF NOT public.porteria_activa() THEN
    RETURN;   -- módulo apagado: sin datos, sin error
  END IF;
  IF NOT (
    public.es_director()
    OR EXISTS (SELECT 1 FROM public.asignaciones_profesor ap
                WHERE ap.profesor_id = auth.uid() AND ap.curso_id = p_curso_id AND ap.activo)
  ) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (r.estudiante_id) r.estudiante_id, r.hora, r.estado
    FROM public.asistencia_porteria r
    JOIN public.estudiantes e ON e.id = r.estudiante_id
   WHERE e.curso_id = p_curso_id
     AND r.colegio_id = public.mi_colegio_id()
     AND r.fecha = v_hoy AND r.tipo = 'entrada' AND NOT r.duplicado
   ORDER BY r.estudiante_id, r.hora;
END;
$$;

-- 6.9 Director: tarjetas de conteo del día + contador de alertas pendientes
CREATE OR REPLACE FUNCTION public.porteria_resumen_dia(p_fecha date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_fecha   date := COALESCE(p_fecha, (now() AT TIME ZONE 'America/La_Paz')::date);
  v_total int; v_con int; v_atr int; v_ant int; v_pend int;
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.estudiantes e JOIN public.usuarios u ON u.id = e.id AND u.activo
   WHERE e.colegio_id = v_colegio;

  SELECT count(DISTINCT r.estudiante_id) INTO v_con
    FROM public.asistencia_porteria r
   WHERE r.colegio_id = v_colegio AND r.fecha = v_fecha
     AND r.tipo = 'entrada' AND NOT r.duplicado;

  SELECT count(DISTINCT r.estudiante_id) INTO v_atr
    FROM public.asistencia_porteria r
   WHERE r.colegio_id = v_colegio AND r.fecha = v_fecha
     AND r.estado = 'atraso' AND NOT r.duplicado;

  SELECT count(DISTINCT r.estudiante_id) INTO v_ant
    FROM public.asistencia_porteria r
   WHERE r.colegio_id = v_colegio AND r.fecha = v_fecha
     AND r.estado = 'salida_anticipada' AND NOT r.duplicado;

  SELECT count(*) INTO v_pend
    FROM public.porteria_alertas a
   WHERE a.colegio_id = v_colegio AND a.estado = 'pendiente';

  RETURN jsonb_build_object(
    'fecha', v_fecha, 'total_estudiantes', v_total, 'con_ingreso', v_con,
    'sin_ingreso', GREATEST(v_total - v_con, 0), 'atrasos', v_atr,
    'salidas_anticipadas', v_ant, 'alertas_pendientes', v_pend
  );
END;
$$;

-- 6.10 Director: cruce portería vs asistencia por materia
--   posible_fuga   = entró por portería y tiene Falta en una clase
--                    (salvo novedad del día "En dirección")
--   inconsistencia = no entró por portería y el profesor lo marcó Presente
CREATE OR REPLACE FUNCTION public.porteria_cruce_dia(p_fecha date DEFAULT NULL)
RETURNS TABLE (estudiante_id uuid, nombre_completo text, curso text,
               tipo text, detalle text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_fecha   date := COALESCE(p_fecha, (now() AT TIME ZONE 'America/La_Paz')::date);
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  RETURN QUERY
  SELECT e.id, u.nombre_completo, c.nombre_completo, 'posible_fuga'::text,
         ('Faltas en clase: ' || count(am.id))::text
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id
    LEFT JOIN public.cursos c ON c.id = e.curso_id
    JOIN public.asistencias_materia am
         ON am.estudiante_id = e.id AND am.fecha = v_fecha AND am.estado = 'falta'
   WHERE e.colegio_id = v_colegio
     AND EXISTS (SELECT 1 FROM public.asistencia_porteria r
                  WHERE r.estudiante_id = e.id AND r.fecha = v_fecha
                    AND r.tipo = 'entrada' AND NOT r.duplicado)
     AND NOT EXISTS (SELECT 1 FROM public.novedades_asistencia_dia n
                      WHERE n.estudiante_id = e.id AND n.fecha = v_fecha
                        AND n.tipo = 'en_direccion')
   GROUP BY e.id, u.nombre_completo, c.nombre_completo;

  RETURN QUERY
  SELECT e.id, u.nombre_completo, c.nombre_completo, 'inconsistencia'::text,
         ('Presente en ' || count(am.id) || ' clase(s) sin ingreso por portería')::text
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id
    LEFT JOIN public.cursos c ON c.id = e.curso_id
    JOIN public.asistencias_materia am
         ON am.estudiante_id = e.id AND am.fecha = v_fecha AND am.estado = 'presente'
   WHERE e.colegio_id = v_colegio
     AND NOT EXISTS (SELECT 1 FROM public.asistencia_porteria r
                      WHERE r.estudiante_id = e.id AND r.fecha = v_fecha
                        AND r.tipo = 'entrada' AND NOT r.duplicado)
   GROUP BY e.id, u.nombre_completo, c.nombre_completo;
END;
$$;

-- Permisos: solo usuarios con sesión (cada función valida rol y colegio)
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'registrar_porteria(uuid,text,text,uuid,timestamptz,text,text,text)',
    'anotar_motivo_porteria(uuid,text)',
    'justificar_alerta_porteria(uuid,text)',
    'guardar_horario_porteria(text,text,time,int,time,boolean)',
    'generar_qr_curso(uuid)',
    'regenerar_qr_estudiante(uuid)',
    'porteria_lista_escaner()',
    'porteria_ingreso_hoy_curso(uuid)',
    'porteria_resumen_dia(date)',
    'porteria_cruce_dia(date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;