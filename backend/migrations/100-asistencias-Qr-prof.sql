-- ============================================================
-- MIGRACIÓN 100: Asistencia del profesor por QR (aditiva)
--
-- QUÉ HACE
--   El profesor puede llamar lista de su materia escaneando la credencial QR
--   del estudiante, como alternativa al método manual (que NO cambia).
--   · La hora de inicio la fija el SERVIDOR (hora de Bolivia) en el PRIMER escaneo.
--   · Tolerancia 7 minutos desde ese inicio: dentro = Presente; después = Retraso.
--   · Minutos de retraso = desde la hora de inicio (ej. inicio 14:10, llega 14:25 → 15 min).
--   · Mismo estudiante escaneado dos veces en la misma llamada: se conserva el primero.
--   · Se guarda en la MISMA tabla asistencias_materia (una sola lista por
--     estudiante/fecha/sesión/profesor/materia): QR y manual no se duplican;
--     prevalece la última acción (el frontend avisa antes de reemplazar).
--
-- CAMBIOS (solo agrega; no borra ni modifica datos existentes)
--   1. asistencias_materia: 4 columnas nuevas, opcionales
--        metodo ('manual' | 'qr', por defecto 'manual'), hora_llegada,
--        minutos_retraso, llamada_id
--      Los registros existentes quedan como 'manual', sin hora.
--   2. Tabla nueva asistencia_qr_llamadas: cada vez que el profesor abre el QR.
--   3. Funciones nuevas: abrir_llamada_qr, registrar_asistencia_qr, cerrar_llamada_qr.
--      Validan lo mismo que la política asistencias_materia_write_profesor:
--      el profesor debe tener asignada esa materia en el curso del estudiante.
--      Además: el estudiante debe ser de la lista (curso, o inscripción técnica),
--      la llamada debe ser de HOY y del mismo profesor.
--
-- NO TOCA: portería (asistencia_porteria, porteria_qr, registrar_porteria),
--          políticas existentes, vistas de resumen, notas.
-- ============================================================

BEGIN;

-- ── 1. Columnas nuevas en asistencias_materia ───────────────
ALTER TABLE public.asistencias_materia
  ADD COLUMN IF NOT EXISTS metodo          text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS hora_llegada    timestamptz,
  ADD COLUMN IF NOT EXISTS minutos_retraso integer,
  ADD COLUMN IF NOT EXISTS llamada_id      uuid;

ALTER TABLE public.asistencias_materia
  DROP CONSTRAINT IF EXISTS asistencias_materia_metodo_check;
ALTER TABLE public.asistencias_materia
  ADD CONSTRAINT asistencias_materia_metodo_check CHECK (metodo IN ('manual', 'qr'));

ALTER TABLE public.asistencias_materia
  DROP CONSTRAINT IF EXISTS asistencias_materia_minutos_retraso_check;
ALTER TABLE public.asistencias_materia
  ADD CONSTRAINT asistencias_materia_minutos_retraso_check CHECK (minutos_retraso IS NULL OR minutos_retraso >= 0);

-- ── 2. Llamadas de lista por QR ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.asistencia_qr_llamadas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id      uuid NOT NULL,
  profesor_id     uuid NOT NULL,
  curso_id        uuid NOT NULL,                                -- curso elegido en pantalla
  materia_id      uuid NOT NULL,
  sesion          text NOT NULL CHECK (sesion IN ('regular', 'tecnica')),
  fecha           date NOT NULL,                                -- fecha de Bolivia
  abierta_at      timestamptz NOT NULL DEFAULT now(),           -- se abrió la cámara
  inicio          timestamptz,                                  -- PRIMER escaneo (fija el servidor)
  tolerancia_min  integer NOT NULL DEFAULT 7 CHECK (tolerancia_min >= 0),
  cerrada_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qr_llamadas_prof_fecha
  ON public.asistencia_qr_llamadas (profesor_id, fecha);

-- SIN claves foráneas a propósito (mismo criterio que la corrección de la 095): con FK, PostgREST
-- vería relaciones nuevas entre usuarios/cursos/materias y podrían fallar consultas existentes
-- con "more than one relationship". La integridad la garantizan las funciones de abajo.

ALTER TABLE public.asistencia_qr_llamadas ENABLE ROW LEVEL SECURITY;

-- Solo lectura: el profesor ve sus llamadas; el director las de su colegio.
-- Nadie inserta/edita directo: solo a través de las funciones.
DROP POLICY IF EXISTS qr_llamadas_select_profesor ON public.asistencia_qr_llamadas;
CREATE POLICY qr_llamadas_select_profesor ON public.asistencia_qr_llamadas
  FOR SELECT USING (profesor_id = auth.uid());

DROP POLICY IF EXISTS qr_llamadas_select_director ON public.asistencia_qr_llamadas;
CREATE POLICY qr_llamadas_select_director ON public.asistencia_qr_llamadas
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.usuarios u
             WHERE u.id = auth.uid() AND u.rol = 'director'
               AND u.colegio_id = asistencia_qr_llamadas.colegio_id)
  );

-- ── 3a. Abrir llamada (al abrir la cámara; aún NO corre el tiempo) ──
CREATE OR REPLACE FUNCTION public.abrir_llamada_qr(
  p_curso_id   uuid,
  p_materia_id uuid,
  p_sesion     text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_colegio uuid;
  v_fecha   date := (now() AT TIME ZONE 'America/La_Paz')::date;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  IF p_sesion NOT IN ('regular', 'tecnica') THEN RAISE EXCEPTION 'Sesión no válida'; END IF;

  SELECT u.colegio_id INTO v_colegio
    FROM public.usuarios u WHERE u.id = v_uid AND u.rol = 'profesor' AND u.activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo un profesor puede llamar lista por QR'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.asignaciones_profesor ap
                  WHERE ap.profesor_id = v_uid AND ap.curso_id = p_curso_id
                    AND ap.materia_id = p_materia_id AND ap.activo = true) THEN
    RAISE EXCEPTION 'No tiene asignada esta materia en este curso';
  END IF;

  INSERT INTO public.asistencia_qr_llamadas (colegio_id, profesor_id, curso_id, materia_id, sesion, fecha)
  VALUES (v_colegio, v_uid, p_curso_id, p_materia_id, p_sesion, v_fecha)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('llamada_id', v_id, 'fecha', v_fecha, 'tolerancia_min', 7,
                            'ahora', now());
END $$;

-- ── 3b. Registrar un escaneo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_asistencia_qr(
  p_llamada_id uuid,
  p_codigo     text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_ll      public.asistencia_qr_llamadas%ROWTYPE;
  v_ahora   timestamptz := now();
  v_hoy     date := (now() AT TIME ZONE 'America/La_Paz')::date;
  v_est     uuid;
  v_curso   uuid;
  v_nombre  text;
  v_cnom    text;
  v_prev    public.asistencias_materia%ROWTYPE;
  v_min     integer;
  v_estado  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;

  -- Llamada del mismo profesor, de hoy y abierta (bloqueada para fijar el inicio sin carreras)
  SELECT * INTO v_ll FROM public.asistencia_qr_llamadas
   WHERE id = p_llamada_id AND profesor_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Llamada no encontrada'; END IF;
  IF v_ll.cerrada_at IS NOT NULL THEN RAISE EXCEPTION 'La llamada ya fue cerrada'; END IF;
  IF v_ll.fecha <> v_hoy THEN RAISE EXCEPTION 'La llamada no es de hoy'; END IF;

  -- Código → estudiante (solo del colegio del profesor, QR activo, estudiante activo)
  SELECT q.estudiante_id INTO v_est
    FROM public.porteria_qr q
   WHERE q.codigo = p_codigo AND q.activo AND q.colegio_id = v_ll.colegio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QR no válido o anulado'; END IF;

  SELECT e.curso_id, u.nombre_completo, c.nombre_completo
    INTO v_curso, v_nombre, v_cnom
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id
    LEFT JOIN public.cursos c ON c.id = e.curso_id
   WHERE e.id = v_est AND e.colegio_id = v_ll.colegio_id AND u.activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estudiante no encontrado o inactivo'; END IF;

  -- ¿Es de esta lista?
  IF v_ll.sesion = 'regular' THEN
    IF v_curso IS DISTINCT FROM v_ll.curso_id THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'otro_curso', 'nombre', v_nombre, 'curso', v_cnom);
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.inscripciones_tecnicas it
                    WHERE it.estudiante_id = v_est AND it.materia_id = v_ll.materia_id AND it.activo = true) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'no_inscrito', 'nombre', v_nombre, 'curso', v_cnom);
    END IF;
  END IF;

  -- Mismo permiso que el método manual (política asistencias_materia_write_profesor)
  IF NOT EXISTS (SELECT 1 FROM public.asignaciones_profesor ap
                  WHERE ap.profesor_id = v_uid AND ap.curso_id = v_curso
                    AND ap.materia_id = v_ll.materia_id AND ap.activo = true) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sin_asignacion', 'nombre', v_nombre, 'curso', v_cnom);
  END IF;

  -- Ya escaneado en ESTA llamada → se conserva el primero
  SELECT * INTO v_prev FROM public.asistencias_materia
   WHERE estudiante_id = v_est AND fecha = v_ll.fecha AND sesion = v_ll.sesion
     AND profesor_id = v_uid AND materia_id = v_ll.materia_id
     AND llamada_id = v_ll.id AND hora_llegada IS NOT NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'repetido', true, 'estudiante_id', v_est,
      'nombre', v_nombre, 'curso', v_cnom, 'estado', v_prev.estado,
      'hora', to_char(v_prev.hora_llegada AT TIME ZONE 'America/La_Paz', 'HH24:MI'),
      'minutos', v_prev.minutos_retraso,
      'inicio', to_char(v_ll.inicio AT TIME ZONE 'America/La_Paz', 'HH24:MI'));
  END IF;

  -- Primer escaneo: fija la hora de inicio (servidor)
  IF v_ll.inicio IS NULL THEN
    UPDATE public.asistencia_qr_llamadas SET inicio = v_ahora WHERE id = v_ll.id;
    v_ll.inicio := v_ahora;
  END IF;

  v_min := floor(extract(epoch FROM (v_ahora - v_ll.inicio)) / 60)::int;
  IF v_ahora <= v_ll.inicio + make_interval(mins => v_ll.tolerancia_min) THEN
    v_estado := 'presente';
  ELSE
    v_estado := 'retraso';
  END IF;

  INSERT INTO public.asistencias_materia
    (estudiante_id, curso_id, materia_id, profesor_id, fecha, sesion, estado,
     metodo, hora_llegada, minutos_retraso, llamada_id)
  VALUES
    (v_est, v_curso, v_ll.materia_id, v_uid, v_ll.fecha, v_ll.sesion, v_estado,
     'qr', v_ahora, CASE WHEN v_estado = 'retraso' THEN v_min END, v_ll.id)
  ON CONFLICT (estudiante_id, fecha, sesion, profesor_id, materia_id) DO UPDATE
    SET curso_id = EXCLUDED.curso_id, estado = EXCLUDED.estado, metodo = 'qr',
        hora_llegada = EXCLUDED.hora_llegada, minutos_retraso = EXCLUDED.minutos_retraso,
        llamada_id = EXCLUDED.llamada_id;

  RETURN jsonb_build_object('ok', true, 'repetido', false, 'estudiante_id', v_est,
    'nombre', v_nombre, 'curso', v_cnom, 'estado', v_estado,
    'hora', to_char(v_ahora AT TIME ZONE 'America/La_Paz', 'HH24:MI'),
    'minutos', CASE WHEN v_estado = 'retraso' THEN v_min END,
    'inicio', to_char(v_ll.inicio AT TIME ZONE 'America/La_Paz', 'HH24:MI'),
    'fin_tolerancia', to_char((v_ll.inicio + make_interval(mins => v_ll.tolerancia_min)) AT TIME ZONE 'America/La_Paz', 'HH24:MI'));
END $$;

-- ── 3c. Cerrar llamada (después de confirmar ausentes) ──────
CREATE OR REPLACE FUNCTION public.cerrar_llamada_qr(p_llamada_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.asistencia_qr_llamadas
     SET cerrada_at = now()
   WHERE id = p_llamada_id AND profesor_id = auth.uid() AND cerrada_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.abrir_llamada_qr(uuid, uuid, text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_asistencia_qr(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cerrar_llamada_qr(uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_llamada_qr(uuid, uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_asistencia_qr(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_llamada_qr(uuid)             TO authenticated;

COMMIT;

-- ── Verificación (correr después) ───────────────────────────
-- select column_name, data_type, column_default from information_schema.columns
--  where table_schema='public' and table_name='asistencias_materia'
--    and column_name in ('metodo','hora_llegada','minutos_retraso','llamada_id');
-- select metodo, count(*) from public.asistencias_materia group by metodo;   -- todo 'manual'