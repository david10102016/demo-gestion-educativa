-- ============================================================================
-- instalar_demo.sql — Base de datos COMPLETA del proyecto de CUENTAS DE PRUEBA
-- Fecha: 2026-11-24
--
-- Un solo archivo, en este orden:
--   PARTE 1  Esquema public (línea base de producción del 24-nov-2026, sin datos)
--   PARTE 2  Objetos fuera de public: trigger de alta de usuarios, buckets y políticas de Storage
--   PARTE 3  Capa demo: cascada, columnas y protección, tope de 10 estudiantes,
--            credenciales internas, funciones, bucket archivos-demo y colegio plantilla
--
-- SOLO para un proyecto Supabase NUEVO y VACÍO (el del demo). NUNCA en producción.
-- No reemplaza a las migraciones: es la foto actual de la base más la capa demo.
-- Se quitaron del volcado los 12 "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin":
-- el usuario postgres no puede ejecutarlos y Supabase ya los trae en todo proyecto nuevo.
--
-- Ejecutar con psql (detiene en el primer error):
--   psql "CADENA_DE_CONEXION" -v ON_ERROR_STOP=1 -f instalar_demo.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- ############################################################################
-- PARTE 1 — Esquema public
-- ############################################################################
--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: _siguiente_email_libre(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._siguiente_email_libre(p_colegio_id uuid, p_nombre text, p_marca text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_dom    text;
  v_partes text[];
  v_p      text;
  v_ini    text := '';
  v_n      int  := 1;
  v_cand   text;
BEGIN
  SELECT dominio_correo INTO v_dom FROM public.colegios WHERE id = p_colegio_id;
  IF v_dom IS NULL THEN
    RAISE EXCEPTION 'El colegio no tiene dominio de correo configurado. Pide al superadmin que lo configure.';
  END IF;

  v_partes := regexp_split_to_array(
    trim(lower(translate(COALESCE(p_nombre, ''),
      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'))),
    '\s+');
  FOREACH v_p IN ARRAY v_partes LOOP
    IF left(v_p, 1) ~ '[a-z]' THEN v_ini := v_ini || left(v_p, 1); END IF;
  END LOOP;
  IF v_ini = '' THEN RETURN NULL; END IF;

  LOOP
    v_cand := v_ini || p_marca
              || CASE WHEN v_n = 1 THEN '' ELSE v_n::text END
              || '@' || v_dom || '.educativa.com';
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = v_cand)
          AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_cand);
    v_n := v_n + 1;
    IF v_n > 1000 THEN
      RAISE EXCEPTION 'No se pudo generar un correo libre para este nombre';
    END IF;
  END LOOP;

  RETURN v_cand;
END;
$$;


--
-- Name: abrir_llamada_qr(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.abrir_llamada_qr(p_curso_id uuid, p_materia_id uuid, p_sesion text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: anotar_motivo_porteria(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anotar_motivo_porteria(p_registro_id uuid, p_motivo text) RETURNS void
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


--
-- Name: asesor_asistencia_curso(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date) RETURNS TABLE(estudiante_id uuid, estudiante text, fecha date, sesion text, estado text, materia_excepcion text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    AND u.activo = true
  ORDER BY u.nombre_completo, r.fecha, r.sesion;
END;
$$;


--
-- Name: FUNCTION asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date) IS 'Asesor de curso: resumen diario de asistencia del curso. Solo lectura. Cero filas si no es el asesor.';


--
-- Name: asesor_datos_libreta(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asesor_datos_libreta(p_curso_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result jsonb;
  v_nivel  text;
  v_grado  integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT c.nivel, COALESCE(NULLIF(regexp_replace(c.grado::text, '\D', '', 'g'), '')::int, 0)
    INTO v_nivel, v_grado
  FROM public.cursos c
  WHERE c.id = p_curso_id AND c.colegio_id = public.mi_colegio_id();

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
        AND u.activo = true
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
        AND EXISTS (SELECT 1 FROM public.estudiantes es JOIN public.usuarios us ON us.id = es.id
                    WHERE es.id = nf.estudiante_id AND es.estado = 'activo' AND us.activo = true)
        AND (
          NOT EXISTS (SELECT 1 FROM public.materias mt
                      WHERE mt.id = nf.materia_id AND mt.es_tecnica IS TRUE)
          OR (
            v_nivel = 'Secundaria' AND v_grado >= 4
            AND EXISTS (
              SELECT 1
              FROM public.inscripciones_tecnicas it
              JOIN public.materias mt ON mt.id = it.materia_id
              WHERE it.estudiante_id = nf.estudiante_id
                AND it.materia_id    = nf.materia_id
                AND it.activo = true
                AND v_grado >= COALESCE(NULLIF(
                      NULLIF(regexp_replace(COALESCE(mt.aplica_desde, '4'), '\D', '', 'g'), '')::int,
                      0), 4)
            )
          )
        )
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


--
-- Name: FUNCTION asesor_datos_libreta(p_curso_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.asesor_datos_libreta(p_curso_id uuid) IS 'Asesor: datos para libretas del curso. Técnicas: inscripción activa, 4to–6to, aplica_desde.';


--
-- Name: asesor_notas_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asesor_notas_curso(p_curso_id uuid) RETURNS TABLE(estudiante_id uuid, estudiante text, carnet text, materia_id uuid, materia text, trimestre integer, nota_final numeric, hacer_estado text, saber_estado text, ser_estado text, decidir_estado text, puntos_posibles numeric, nota_hacer numeric, nota_saber numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_año   integer;
  v_nivel text;
  v_grado integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.es_asesor_activo_curso(p_curso_id) THEN
    RETURN;
  END IF;

  v_año := public.año_gestion_vigente();

  SELECT c.nivel, COALESCE(NULLIF(regexp_replace(c.grado::text, '\D', '', 'g'), '')::int, 0)
    INTO v_nivel, v_grado
  FROM public.cursos c
  WHERE c.id = p_curso_id AND c.colegio_id = public.mi_colegio_id();

  RETURN QUERY
  WITH dims AS (
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
           nf.trimestre::integer AS trimestre, nf.nota_final::numeric AS nota_final,
           nf.promedio_hacer::numeric AS nota_hacer, nf.promedio_saber::numeric AS nota_saber
    FROM public.notas_finales nf
    WHERE nf.curso_id = p_curso_id
      AND nf.colegio_id = public.mi_colegio_id()
      AND EXISTS (SELECT 1 FROM public.estudiantes es JOIN public.usuarios us ON us.id = es.id
                  WHERE es.id = nf.estudiante_id AND es.estado = 'activo' AND us.activo = true)
      AND (
        NOT EXISTS (SELECT 1 FROM public.materias mt
                    WHERE mt.id = nf.materia_id AND mt.es_tecnica IS TRUE)
        OR (
          v_nivel = 'Secundaria' AND v_grado >= 4
          AND EXISTS (
            SELECT 1
            FROM public.inscripciones_tecnicas it
            JOIN public.materias mt ON mt.id = it.materia_id
            WHERE it.estudiante_id = nf.estudiante_id
              AND it.materia_id    = nf.materia_id
              AND it.activo = true
              AND v_grado >= COALESCE(NULLIF(
                    NULLIF(regexp_replace(COALESCE(mt.aplica_desde, '4'), '\D', '', 'g'), '')::int,
                    0), 4)
          )
        )
      )
  ),
  marcas AS (
    SELECT n.estudiante_id, a.materia_id, a.trimestre, a.tipo
    FROM public.actividades a
    JOIN public.notas n ON n.actividad_id = a.id
    JOIN public.materias mt ON mt.id = a.materia_id
    WHERE a.tipo IN ('hacer', 'saber')
      AND (
        (mt.es_tecnica IS NOT TRUE AND a.curso_id = p_curso_id)
        OR
        (mt.es_tecnica IS TRUE
         AND EXISTS (
           SELECT 1 FROM public.estudiantes es
           WHERE es.id = n.estudiante_id
             AND es.curso_id = p_curso_id
             AND es.estado = 'activo'
         )
         AND EXISTS (
           SELECT 1 FROM public.inscripciones_tecnicas it
           WHERE it.estudiante_id = n.estudiante_id
             AND it.materia_id    = a.materia_id
             AND it.activo = true
         ))
      )
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
    )::numeric AS puntos_posibles,
    m.nota_hacer, m.nota_saber
  FROM marcado m
  CROSS JOIN dims d
  ORDER BY m.estudiante, m.estudiante_id, m.materia_id, m.trimestre;
END;
$$;


--
-- Name: asignar_asesor_curso(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid) IS 'Director: asigna o cambia el asesor de un curso. Desactiva la fila anterior (historial).';


--
-- Name: asignar_rol_privilegiado(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asignar_rol_privilegiado(p_usuario_id uuid, p_rol text, p_colegio_id uuid DEFAULT NULL::uuid) RETURNS void
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


--
-- Name: año_gestion_vigente(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."año_gestion_vigente"() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: buscar_estudiante_por_carnet(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.buscar_estudiante_por_carnet(p_carnet text, p_colegio_id uuid) RETURNS TABLE(id uuid, carnet text, nombre text, curso text, nivel text, colegio_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_intentos INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  IF p_colegio_id IS NULL THEN
    RAISE EXCEPTION 'Falta el colegio para realizar la búsqueda';
  END IF;

  SELECT COUNT(*) INTO v_intentos
  FROM public.intentos_busqueda_carnet
  WHERE tutor_id = auth.uid()
    AND created_at > NOW() - INTERVAL '1 hour';

  IF v_intentos >= 5 THEN
    RAISE EXCEPTION 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
  END IF;

  INSERT INTO public.intentos_busqueda_carnet (tutor_id) VALUES (auth.uid());

  RETURN QUERY
  SELECT e.id, e.carnet, u.nombre_completo, c.nombre_completo, c.nivel, e.colegio_id
  FROM public.estudiantes e
  JOIN public.usuarios u ON u.id = e.id
  LEFT JOIN public.cursos c ON c.id = e.curso_id
  WHERE e.carnet = TRIM(p_carnet)
    AND e.colegio_id = p_colegio_id;
END;
$$;


--
-- Name: cancelar_licencia(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancelar_licencia(p_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.licencias set estado = 'cancelada'
  where id = p_id and tutor_id = auth.uid() and estado = 'pendiente';
  if not found then raise exception 'Solo puedes cancelar solicitudes pendientes'; end if;
  return true;
end $$;


--
-- Name: cerrar_llamada_qr(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cerrar_llamada_qr(p_llamada_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.asistencia_qr_llamadas
     SET cerrada_at = now()
   WHERE id = p_llamada_id AND profesor_id = auth.uid() AND cerrada_at IS NULL;
END $$;


--
-- Name: colegio_de_estudiante(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.colegio_de_estudiante(p_estudiante_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT colegio_id FROM public.estudiantes WHERE id = p_estudiante_id;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: colegios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.colegios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text DEFAULT 'Mi Colegio'::text NOT NULL,
    sigla text,
    direccion text,
    municipio text,
    departamento text,
    telefono text,
    email text,
    logo_url text,
    director_nombre text,
    resolucion_ministerial text,
    "año_fundacion" integer,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    color_primario text DEFAULT '#4f46e5'::text,
    color_secundario text DEFAULT '#ffffff'::text,
    es_plantilla boolean DEFAULT false NOT NULL,
    plan text DEFAULT 'basico'::text NOT NULL,
    finanzas_habilitado boolean DEFAULT true NOT NULL,
    dominio_correo text,
    subdominio text,
    CONSTRAINT colegios_dominio_correo_formato CHECK (((dominio_correo IS NULL) OR (dominio_correo ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'::text))),
    CONSTRAINT colegios_plan_check CHECK ((plan = ANY (ARRAY['basico'::text, 'avanzado'::text]))),
    CONSTRAINT colegios_subdominio_formato CHECK (((subdominio IS NULL) OR (subdominio ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text))),
    CONSTRAINT colegios_subdominio_reservado CHECK (((subdominio IS NULL) OR (subdominio <> ALL (ARRAY['www'::text, 'admin'::text, 'api'::text, 'app'::text, 'login'::text, 'mail'::text, 'correo'::text, 'soporte'::text, 'ayuda'::text, 'panel'::text, 'dashboard'::text, 'static'::text, 'assets'::text, 'cdn'::text, 'staging'::text, 'test'::text]))))
);


--
-- Name: TABLE colegios; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.colegios IS 'Datos institucionales. El director los configura desde el panel.';


--
-- Name: COLUMN colegios.dominio_correo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.colegios.dominio_correo IS 'Subdominio de los correos nuevos del colegio: <iniciales>@<dominio_correo>.educativa.com. Lo escribe el superadmin al crear el colegio y solo él puede cambiarlo.';


--
-- Name: COLUMN colegios.subdominio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.colegios.subdominio IS 'Dirección web propia del colegio (ej: mariscal-sucre para mariscal-sucre.<dominio>). NO es dominio_correo, que es solo para los correos. Solo la cambia el superadmin.';


--
-- Name: colegios_publico; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.colegios_publico AS
 SELECT id,
    nombre,
    sigla,
    logo_url,
    color_primario,
    color_secundario
   FROM public.colegios
  WHERE (activo = true);


--
-- Name: colegio_por_subdominio(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.colegio_por_subdominio(p text) RETURNS SETOF public.colegios_publico
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT v.*
  FROM public.colegios_publico v
  JOIN public.colegios c ON c.id = v.id
  WHERE c.subdominio = lower(btrim(p))
  LIMIT 1
$$;


--
-- Name: comunicado_dirigido_a_mi(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.comunicado_dirigido_a_mi(p_comunicado_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comunicados_estudiante ce
    WHERE ce.comunicado_id = p_comunicado_id
      AND ce.estudiante_id = auth.uid()
  );
$$;


--
-- Name: comunicado_dirigido_a_mi_hijo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.comunicado_dirigido_a_mi_hijo(p_comunicado_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comunicados_estudiante ce
    JOIN public.tutor_estudiante te ON te.estudiante_id = ce.estudiante_id
    WHERE ce.comunicado_id = p_comunicado_id
      AND te.tutor_id = auth.uid()
  );
$$;


--
-- Name: comunicado_es_de_mi_hijo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.comunicado_es_de_mi_hijo(p_comunicado_estudiante_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comunicados_estudiante ce
    JOIN public.tutor_estudiante te ON te.estudiante_id = ce.estudiante_id
    WHERE ce.id = p_comunicado_estudiante_id
      AND te.tutor_id = auth.uid()
  );
$$;


--
-- Name: copiar_config_colegio_base(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: entregas_max_dos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entregas_max_dos() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Evita que dos subidas simultáneas pasen el límite
  perform pg_advisory_xact_lock(hashtext(new.estudiante_id::text || new.actividad_id::text));
  if (select count(*) from entregas_tareas
      where estudiante_id = new.estudiante_id and actividad_id = new.actividad_id) >= 2 then
    raise exception 'Máximo 2 archivos por entrega' using errcode = 'P0001';
  end if;
  return new;
end $$;


--
-- Name: enviar_comunicado(jsonb, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id        UUID;
  v_esperados INT;
  v_creados   INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT x) INTO v_esperados FROM unnest(p_estudiantes) AS x WHERE x IS NOT NULL;
  IF coalesce(v_esperados, 0) = 0 THEN
    RAISE EXCEPTION 'No hay estudiantes en este destino' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.comunicados
    (colegio_id, emisor_id, tipo_emisor, tipo_destinatario, destinatario_id, materia_id,
     destinatario_nombre, asunto, contenido, categoria)
  SELECT r.colegio_id, auth.uid(), r.tipo_emisor, r.tipo_destinatario, r.destinatario_id, r.materia_id,
         r.destinatario_nombre, r.asunto, r.contenido, coalesce(r.categoria, 'Informativo')
  FROM jsonb_populate_record(NULL::public.comunicados, p_comunicado) AS r
  RETURNING id INTO v_id;

  INSERT INTO public.comunicados_estudiante (comunicado_id, estudiante_id)
  SELECT v_id, x FROM (SELECT DISTINCT x FROM unnest(p_estudiantes) AS x WHERE x IS NOT NULL) s;

  GET DIAGNOSTICS v_creados = ROW_COUNT;
  IF v_creados <> v_esperados THEN
    RAISE EXCEPTION 'Envío incompleto (% de %). No se guardó nada.', v_creados, v_esperados;
  END IF;

  RETURN v_id;
END
$$;


--
-- Name: FUNCTION enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]) IS 'Guarda un comunicado y todos sus destinatarios en una sola transacción (todo o nada). Migración 117.';


--
-- Name: es_asesor_activo_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_asesor_activo_curso(p_curso_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION es_asesor_activo_curso(p_curso_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.es_asesor_activo_curso(p_curso_id uuid) IS 'True si auth.uid() es el asesor activo del curso en el año vigente de su colegio.';


--
-- Name: es_director(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_director() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'director' AND activo = true
  );
$$;


--
-- Name: es_estudiante(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_estudiante() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'estudiante' AND activo = true
  );
$$;


--
-- Name: es_profesor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_profesor() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'profesor' AND activo = true
  );
$$;


--
-- Name: es_regente(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_regente() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'regente' AND activo = true
  );
$$;


--
-- Name: es_secretaria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_secretaria() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'secretaria' AND activo = true
  );
$$;


--
-- Name: es_superadmin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_superadmin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid() AND rol = 'superadmin' AND activo = true
  );
$$;


--
-- Name: es_tutor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_tutor() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'tutor' AND activo = true
  );
$$;


--
-- Name: estado_foto_estudiante(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estado_foto_estudiante(p_estudiante_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE r record;
BEGIN
  IF NOT (public.es_director() OR public.es_regente()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  SELECT e.foto_url, e.foto_subida_at, us.nombre_completo AS por
    INTO r
    FROM public.estudiantes e
    LEFT JOIN public.usuarios us ON us.id = e.foto_subida_por
   WHERE e.id = p_estudiante_id AND e.colegio_id = public.mi_colegio_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;
  RETURN jsonb_build_object('tiene_foto', r.foto_url IS NOT NULL, 'foto_path', r.foto_url,
                            'subida_por', r.por, 'subida_at', r.foto_subida_at);
END;
$$;


--
-- Name: evaluacion_es_de_mi_colegio(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evaluacion_es_de_mi_colegio(p_evaluacion_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  select exists (
    select 1
    from evaluaciones_docente e
    join usuarios u on u.id = e.activada_por
    where e.id = p_evaluacion_id
    and u.colegio_id = mi_colegio_id()
  );
$$;


--
-- Name: fix_confirmation_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fix_confirmation_tokens() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE auth.users
  SET 
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    reauthentication_token = COALESCE(reauthentication_token, '')
  WHERE confirmation_token IS NULL
     OR recovery_token IS NULL
     OR email_change_token_new IS NULL
     OR email_change IS NULL
     OR phone_change IS NULL
     OR phone_change_token IS NULL
     OR email_change_token_current IS NULL
     OR reauthentication_token IS NULL;
END;
$$;


--
-- Name: fotos_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fotos_curso(p_curso_id uuid) RETURNS TABLE(estudiante_id uuid, nombre_completo text, foto_path text, subida_por text, subida_at timestamp with time zone, tiene_anterior boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  IF NOT (public.es_director() OR public.es_regente()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  RETURN QUERY
  SELECT e.id, u.nombre_completo, e.foto_url, us.nombre_completo, e.foto_subida_at,
         e.foto_anterior IS NOT NULL
    FROM public.estudiantes e
    JOIN public.usuarios u ON u.id = e.id
    LEFT JOIN public.usuarios us ON us.id = e.foto_subida_por
   WHERE e.curso_id = p_curso_id
     AND e.colegio_id = public.mi_colegio_id()
     AND u.activo = true
   ORDER BY u.nombre_completo;
END;
$$;


--
-- Name: generar_email_estudiante(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_email_estudiante(p_colegio_id uuid, p_nombre text) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT public._siguiente_email_libre(p_colegio_id, p_nombre, '');
$$;


--
-- Name: generar_email_profesor(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_email_profesor(p_nombre text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  RETURN public._siguiente_email_libre(public.mi_colegio_id(), p_nombre, '.prof');
END;
$$;


--
-- Name: generar_qr_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_qr_curso(p_curso_id uuid) RETURNS TABLE(estudiante_id uuid, nombre_completo text, carnet text, codigo text)
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


--
-- Name: get_config_año(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."get_config_año"("p_año" integer DEFAULT (EXTRACT(year FROM now()))::integer) RETURNS jsonb
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


--
-- Name: FUNCTION "get_config_año"("p_año" integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public."get_config_año"("p_año" integer) IS 'Devuelve toda la config del año en un solo JSONB. El frontend la carga al inicio.';


--
-- Name: guardar_foto_estudiante(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_foto_estudiante(p_estudiante_id uuid, p_path text, p_reemplazar boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_colegio uuid := public.mi_colegio_id();
  v_actual  text;
BEGIN
  IF NOT (public.es_director() OR public.es_regente()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF p_path IS NULL OR p_path NOT LIKE v_colegio::text || '/' || p_estudiante_id::text || '/%' THEN
    RAISE EXCEPTION 'Ruta de foto no válida';
  END IF;
  SELECT e.foto_url INTO v_actual
    FROM public.estudiantes e
   WHERE e.id = p_estudiante_id AND e.colegio_id = v_colegio
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;
  IF v_actual IS NOT NULL AND NOT p_reemplazar THEN
    RETURN jsonb_build_object('ok', false, 'requiere_confirmar', true);
  END IF;
  UPDATE public.estudiantes
     SET foto_anterior   = CASE WHEN v_actual IS NOT NULL THEN v_actual ELSE foto_anterior END,
         foto_url        = p_path,
         foto_subida_por = auth.uid(),
         foto_subida_at  = now()
   WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true, 'reemplazo', v_actual IS NOT NULL);
END;
$$;


--
-- Name: guardar_horario_grado_porteria(text, text, integer[], time without time zone, integer, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_horario_grado_porteria(p_turno text, p_nivel text, p_grados integer[], p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone) RETURNS integer
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


--
-- Name: guardar_horario_porteria(text, text, time without time zone, integer, time without time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_horario_porteria(p_turno text, p_nivel text, p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone, p_activo boolean DEFAULT true) RETURNS uuid
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


--
-- Name: guardar_rubrica_criterios(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guardar_rubrica_criterios(p_actividad_id uuid, p_criterios jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, nombre_completo, rol)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', NEW.email),
    'tutor'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: hoy_bolivia(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hoy_bolivia() RETURNS date
    LANGUAGE sql STABLE
    AS $$ select (now() at time zone 'America/La_Paz')::date $$;


--
-- Name: justificar_alerta_porteria(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.justificar_alerta_porteria(p_alerta_id uuid, p_motivo text) RETURNS void
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


--
-- Name: marcar_comunicado_leido_tutor(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marcar_comunicado_leido_tutor(p_ce_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_estudiante UUID;
  v_colegio    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid() AND u.rol = 'tutor' AND u.activo = true) THEN
    RAISE EXCEPTION 'Solo un tutor puede marcar esta lectura' USING ERRCODE = '42501';
  END IF;

  SELECT ce.estudiante_id, c.colegio_id
    INTO v_estudiante, v_colegio
  FROM public.comunicados_estudiante ce
  JOIN public.comunicados c ON c.id = ce.comunicado_id
  WHERE ce.id = p_ce_id;

  IF v_estudiante IS NULL THEN
    RAISE EXCEPTION 'Comunicado no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tutor_estudiante te
                 WHERE te.tutor_id = auth.uid()
                   AND te.estudiante_id = v_estudiante
                   AND te.activo = true) THEN
    RAISE EXCEPTION 'Este estudiante no está vinculado a tu cuenta' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.comunicados_lectura_tutor (comunicado_estudiante_id, tutor_id, colegio_id)
  VALUES (p_ce_id, auth.uid(), v_colegio)
  ON CONFLICT (comunicado_estudiante_id, tutor_id) DO NOTHING;
END
$$;


--
-- Name: FUNCTION marcar_comunicado_leido_tutor(p_ce_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.marcar_comunicado_leido_tutor(p_ce_id uuid) IS 'Registra que el tutor abrió el comunicado en su panel. Solo tutor activo con vínculo activo (migración 115).';


--
-- Name: marcar_egresado(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marcar_egresado(p_estudiante_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_año INT;
BEGIN
  SELECT colegio_id INTO v_colegio_estudiante FROM public.estudiantes WHERE id = p_estudiante_id;
  IF v_colegio_estudiante IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estudiante no encontrado');
  END IF;
  IF public.es_superadmin() THEN
    -- sin restricción
  ELSIF public.es_director() AND v_colegio_estudiante = public.mi_colegio_id() THEN
    -- director solo sobre estudiantes de su propio colegio
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos sobre este estudiante');
  END IF;

  SELECT año INTO v_año FROM public.config_gestion
  WHERE colegio_id = v_colegio_estudiante AND estado = 'activo' LIMIT 1;
  IF v_año IS NULL THEN v_año := EXTRACT(YEAR FROM now())::INT; END IF;

  INSERT INTO public.historial_promociones (estudiante_id, colegio_id, año, accion, estado_anterior, realizado_por)
  SELECT p_estudiante_id, v_colegio_estudiante, v_año, 'egreso', estado, auth.uid()
  FROM public.estudiantes WHERE id = p_estudiante_id;

  UPDATE public.estudiantes SET estado = 'egresado' WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: mi_asesoria_curso(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mi_asesoria_curso() RETURNS TABLE(asesor_id uuid, curso_id uuid, curso text, nivel text, grado integer, "año" integer, asignado_en timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: mi_colegio_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mi_colegio_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT colegio_id FROM usuarios WHERE id = auth.uid();
$$;


--
-- Name: mi_curso_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mi_curso_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  select curso_id from estudiantes where id = auth.uid();
$$;


--
-- Name: notas_de_mi_hijo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notas_de_mi_hijo(p_estudiante_id uuid) RETURNS TABLE(materia_id uuid, materia text, trimestre integer, promedio_hacer numeric, promedio_saber numeric, nota_ser numeric, nota_decidir numeric, nota_final numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_estado text;
begin
  if auth.uid() is null then
    raise exception 'No hay sesión activa';
  end if;

  if not exists (select 1 from public.usuarios u
                 where u.id = auth.uid() and u.rol = 'tutor' and u.activo = true) then
    raise exception 'Solo un tutor puede ver las notas de un hijo';
  end if;

  if not exists (select 1 from public.tutor_estudiante te
                 where te.tutor_id = auth.uid() and te.estudiante_id = p_estudiante_id and te.activo = true) then
    raise exception 'Este estudiante no está vinculado a tu cuenta';
  end if;

  -- Carnet del tutor: solo 'revisado' por dirección da acceso. El hint le dice a la pantalla qué mostrar.
  select tv.estado into v_estado from public.tutor_verificacion tv where tv.tutor_id = auth.uid();
  if v_estado is null then
    raise exception 'Para ver las notas primero registrá tu carnet de identidad (una sola vez).' using hint = 'sin_carnet';
  elsif v_estado = 'pendiente' then
    raise exception 'Tu carnet está en revisión por dirección. Cuando lo aprueben vas a ver las notas.' using hint = 'carnet_pendiente';
  elsif v_estado <> 'revisado' then
    raise exception 'Dirección observó tu registro. Registrá tu carnet de nuevo.' using hint = 'carnet_rechazado';
  end if;

  return query
    select nf.materia_id, nf.materia, nf.trimestre::integer,
           nf.promedio_hacer, nf.promedio_saber, nf.nota_ser, nf.nota_decidir, nf.nota_final
    from public.notas_finales nf
    where nf.estudiante_id = p_estudiante_id
      -- La vista gestion_activa toma UNA gestion cualquiera cuando se lee sin las reglas por colegio
      -- (como en esta funcion); se acota a los periodos de la gestion activa del colegio del hijo.
      and nf.trimestre <= coalesce(
            (select cg.cantidad_periodos from public.config_gestion cg
             where cg.colegio_id = nf.colegio_id and cg.estado = 'activo' limit 1), 3)
    order by nf.materia, nf.trimestre;
end
$$;


--
-- Name: porteria_activa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.porteria_activa() RETURNS boolean
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


--
-- Name: porteria_cruce_dia(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.porteria_cruce_dia(p_fecha date DEFAULT NULL::date) RETURNS TABLE(estudiante_id uuid, nombre_completo text, curso text, tipo text, detalle text)
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


--
-- Name: porteria_ingreso_hoy_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.porteria_ingreso_hoy_curso(p_curso_id uuid) RETURNS TABLE(estudiante_id uuid, hora_ingreso timestamp with time zone, estado text)
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


--
-- Name: porteria_ingreso_hoy_estudiantes(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[]) RETURNS TABLE(estudiante_id uuid, hora_ingreso timestamp with time zone, estado text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_ahora   timestamp := now() AT TIME ZONE 'America/La_Paz';
  v_hoy     date := v_ahora::date;
  v_t       time := v_ahora::time;
  v_colegio uuid := public.mi_colegio_id();
  v_dir     boolean := public.es_director();
BEGIN
  IF NOT public.porteria_activa() OR p_estudiante_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH est AS (
    SELECT e.id, c.nivel, c.grado
      FROM public.estudiantes e
      LEFT JOIN public.cursos c ON c.id = e.curso_id
     WHERE e.id = ANY (p_estudiante_ids)
       AND e.colegio_id = v_colegio
       AND (
         v_dir
         OR EXISTS (SELECT 1 FROM public.asignaciones_profesor ap
                     WHERE ap.profesor_id = auth.uid() AND ap.activo AND ap.curso_id = e.curso_id)
         OR EXISTS (SELECT 1 FROM public.inscripciones_tecnicas it
                      JOIN public.asignaciones_profesor ap
                        ON ap.materia_id = it.materia_id AND ap.profesor_id = auth.uid() AND ap.activo
                     WHERE it.estudiante_id = e.id AND it.activo)
       )
  ),
  turno_actual AS (
    SELECT est.id,
           (SELECT h.turno
              FROM (
                SELECT g.turno, g.hora_entrada, g.hora_salida
                  FROM public.porteria_horarios_grado g
                 WHERE g.colegio_id = v_colegio AND g.nivel = est.nivel AND g.grado = est.grado AND g.activo
                UNION ALL
                SELECT n.turno, n.hora_entrada, n.hora_salida
                  FROM public.porteria_horarios n
                 WHERE n.colegio_id = v_colegio AND n.nivel = est.nivel AND n.activo
                   AND NOT EXISTS (SELECT 1 FROM public.porteria_horarios_grado g2
                                    WHERE g2.colegio_id = v_colegio AND g2.nivel = est.nivel
                                      AND g2.grado = est.grado AND g2.turno = n.turno AND g2.activo)
              ) h
             WHERE v_t >= h.hora_entrada - interval '90 minutes'
               AND v_t <= h.hora_salida  + interval '90 minutes'
             ORDER BY h.hora_entrada DESC
             LIMIT 1) AS turno
      FROM est
  )
  SELECT ta.id, x.hora, x.estado
    FROM turno_actual ta
    CROSS JOIN LATERAL (
      SELECT r.hora, r.estado
        FROM public.asistencia_porteria r
       WHERE r.estudiante_id = ta.id
         AND r.colegio_id = v_colegio
         AND r.fecha = v_hoy AND r.tipo = 'entrada' AND NOT r.duplicado
         AND (ta.turno IS NULL OR r.turno = ta.turno)
       ORDER BY CASE WHEN ta.turno IS NULL THEN r.hora END DESC,
                r.hora ASC
       LIMIT 1
    ) x;
END;
$$;


--
-- Name: porteria_lista_escaner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.porteria_lista_escaner() RETURNS TABLE(estudiante_id uuid, nombre_completo text, curso text, nivel text, foto_url text, codigo text)
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


--
-- Name: porteria_resumen_dia(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.porteria_resumen_dia(p_fecha date DEFAULT NULL::date) RETURNS jsonb
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


--
-- Name: profesor_asignado_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profesor_asignado_curso(p_curso_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor
    WHERE profesor_id = auth.uid() AND curso_id = p_curso_id AND activo = true
  );
$$;


--
-- Name: profesor_asignado_materia(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profesor_asignado_materia(p_materia_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor
    WHERE profesor_id = auth.uid() AND materia_id = p_materia_id AND activo = true
  );
$$;


--
-- Name: profesor_dicta_actividad(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profesor_dicta_actividad(p_actividad_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.actividades a
    join public.asignaciones_profesor ap on ap.materia_id = a.materia_id
    where a.id = p_actividad_id
      and ap.profesor_id = auth.uid()
      and ap.activo = true
      and (a.curso_id is null or ap.curso_id = a.curso_id)  -- técnicas: curso_id null
  );
$$;


--
-- Name: profesor_es_de_mi_colegio(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profesor_es_de_mi_colegio(p_profesor_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = p_profesor_id
      AND u.colegio_id = public.mi_colegio_id()
  );
$$;


--
-- Name: profesor_es_tutor_de_estudiante(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profesor_es_tutor_de_estudiante(p_estudiante_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.estudiantes e
    JOIN public.cursos c ON c.id = e.curso_id
    WHERE e.id = p_estudiante_id
      AND c.tutor_profesor_id = auth.uid()
  );
$$;


--
-- Name: profesor_tiene_asignacion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profesor_tiene_asignacion(p_estudiante_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor ap
    JOIN public.estudiantes e ON e.curso_id = ap.curso_id
    JOIN public.materias m ON m.id = ap.materia_id
    WHERE ap.profesor_id = auth.uid()
      AND e.id = p_estudiante_id
      AND ap.activo = true
      AND (
        m.es_tecnica IS NOT TRUE
        OR EXISTS (
          SELECT 1 FROM public.inscripciones_tecnicas it
          WHERE it.estudiante_id = p_estudiante_id AND it.materia_id = ap.materia_id AND it.activo = true
        )
      )
  );
$$;


--
-- Name: promover_estudiante(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promover_estudiante(p_estudiante_id uuid, p_curso_destino_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_destino UUID;
  v_año INT;
BEGIN
  SELECT colegio_id INTO v_colegio_estudiante FROM public.estudiantes WHERE id = p_estudiante_id;
  SELECT colegio_id INTO v_colegio_destino FROM public.cursos WHERE id = p_curso_destino_id;
  IF v_colegio_estudiante IS NULL OR v_colegio_destino IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estudiante o curso destino no encontrado');
  END IF;
  IF v_colegio_estudiante <> v_colegio_destino THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El curso destino no pertenece al colegio del estudiante');
  END IF;
  IF public.es_superadmin() THEN
    -- sin restricción
  ELSIF public.es_director() AND v_colegio_estudiante = public.mi_colegio_id() THEN
    -- director solo sobre estudiantes de su propio colegio
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos sobre este estudiante');
  END IF;

  SELECT año INTO v_año FROM public.config_gestion
  WHERE colegio_id = v_colegio_estudiante AND estado = 'activo' LIMIT 1;
  IF v_año IS NULL THEN v_año := EXTRACT(YEAR FROM now())::INT; END IF;

  INSERT INTO public.historial_promociones (estudiante_id, colegio_id, año, accion, curso_anterior_id, realizado_por)
  SELECT p_estudiante_id, v_colegio_estudiante, v_año, 'promocion', curso_id, auth.uid()
  FROM public.estudiantes WHERE id = p_estudiante_id;

  UPDATE public.estudiantes SET curso_id = p_curso_destino_id WHERE id = p_estudiante_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;


--
-- Name: proteger_bitacora_columnas_director(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_bitacora_columnas_director() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.es_director() AND NOT public.es_profesor() THEN
    IF NEW.tema IS DISTINCT FROM OLD.tema
       OR NEW.tipo_actividad IS DISTINCT FROM OLD.tipo_actividad
       OR NEW.estado IS DISTINCT FROM OLD.estado
       OR NEW.detalle IS DISTINCT FROM OLD.detalle
       OR NEW.curso_id IS DISTINCT FROM OLD.curso_id
       OR NEW.materia_id IS DISTINCT FROM OLD.materia_id
       OR NEW.fecha IS DISTINCT FROM OLD.fecha
       OR NEW.profesor_id IS DISTINCT FROM OLD.profesor_id
    THEN
      RAISE EXCEPTION 'El director solo puede editar la observación, no el contenido registrado por el profesor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: proteger_colegio_tutor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_colegio_tutor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.colegio_id IS NOT NULL AND NEW.colegio_id <> OLD.colegio_id THEN
    RAISE EXCEPTION 'No se puede modificar el colegio asignado a este tutor';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: proteger_comunicado_estudiante(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_comunicado_estudiante() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.comunicado_id  <> OLD.comunicado_id
     OR NEW.estudiante_id <> OLD.estudiante_id THEN
    RAISE EXCEPTION 'No se puede modificar comunicado_id ni estudiante_id de un registro existente';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: proteger_dominio_correo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_dominio_correo() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.dominio_correo IS DISTINCT FROM OLD.dominio_correo
     AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar el dominio de correo de un colegio';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: proteger_plan_colegio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_plan_colegio() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: proteger_rol_superadmin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_rol_superadmin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.es_superadmin()
     AND (
          (TG_OP = 'INSERT' AND NEW.rol = 'superadmin')
       OR (TG_OP = 'UPDATE' AND ((NEW.rol = 'superadmin') IS DISTINCT FROM (OLD.rol = 'superadmin')))
     ) THEN
    RAISE EXCEPTION 'No autorizado: solo un superadmin puede asignar o quitar el rol superadmin.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: FUNCTION proteger_rol_superadmin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.proteger_rol_superadmin() IS 'Impide que un usuario que no es superadmin asigne o quite el rol superadmin (migración 113).';


--
-- Name: proteger_rubrica_calificada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_rubrica_calificada() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: proteger_subdominio_colegio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_subdominio_colegio() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.subdominio IS DISTINCT FROM OLD.subdominio
     AND auth.uid() IS NOT NULL
     AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar la dirección propia (subdominio) de un colegio';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: proteger_toggles_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proteger_toggles_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: quitar_horario_grado_porteria(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quitar_horario_grado_porteria(p_id uuid) RETURNS void
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


--
-- Name: regenerar_qr_estudiante(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.regenerar_qr_estudiante(p_estudiante_id uuid) RETURNS text
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


--
-- Name: registrar_asistencia_qr(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_asistencia_qr(p_llamada_id uuid, p_codigo text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: registrar_porteria(uuid, text, text, uuid, timestamp with time zone, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_porteria(p_client_uuid uuid, p_tipo text, p_codigo text DEFAULT NULL::text, p_estudiante_id uuid DEFAULT NULL::uuid, p_hora timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metodo text DEFAULT 'qr'::text, p_dispositivo text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text) RETURNS jsonb
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


--
-- Name: registrar_verificacion_tutor(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_verificacion_tutor(p_parentesco text, p_anverso text, p_reverso text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_estado text;
begin
  if auth.uid() is null or not es_tutor() then raise exception 'Solo un tutor puede registrar su carnet'; end if;
  if coalesce(p_anverso,'') = '' or coalesce(p_reverso,'') = '' then
    raise exception 'Debes adjuntar las dos caras del carnet (anverso y reverso)';
  end if;
  if split_part(p_anverso,'/',1) <> auth.uid()::text or split_part(p_reverso,'/',1) <> auth.uid()::text then
    raise exception 'Ruta de archivo no válida';
  end if;

  select estado into v_estado from public.tutor_verificacion where tutor_id = auth.uid();
  if v_estado in ('pendiente','revisado') then
    raise exception 'Tu carnet ya está registrado';
  end if;

  insert into public.tutor_verificacion (tutor_id, parentesco, ci_anverso, ci_reverso, estado)
  values (auth.uid(), p_parentesco, p_anverso, p_reverso, 'pendiente')
  on conflict (tutor_id) do update
    set parentesco = excluded.parentesco, ci_anverso = excluded.ci_anverso, ci_reverso = excluded.ci_reverso,
        estado = 'pendiente', motivo_rechazo = null, nota = null, revisado_por = null, revisado_en = null,
        updated_at = now();
  return true;
end $$;


--
-- Name: reporte_notas_periodo(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text DEFAULT NULL::text) RETURNS TABLE(estudiante_id uuid, estudiante text, carnet text, materia_id uuid, materia text, curso_id uuid, curso text, nivel text, trimestre integer, nota_final numeric, estado text, nota_hacer numeric, nota_saber numeric, ser_estado text, decidir_estado text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Solo el director puede consultar este reporte';
  END IF;

  IF public.mi_colegio_id() IS NULL THEN
    RAISE EXCEPTION 'El director no tiene colegio asignado';
  END IF;

  IF p_trimestre IS NULL OR p_trimestre < 1 THEN
    RAISE EXCEPTION 'Trimestre inválido';
  END IF;

  RETURN QUERY
  WITH cal AS (
    SELECT c.estudiante_id, c.materia_id, c.trimestre,
           bool_or(c.nota_ser IS NOT NULL)     AS ser_ok,
           bool_or(c.nota_decidir IS NOT NULL) AS decidir_ok
    FROM public.calificaciones c
    WHERE c.trimestre = p_trimestre
    GROUP BY c.estudiante_id, c.materia_id, c.trimestre
  )
  SELECT DISTINCT ON (nf.estudiante_id, nf.materia_id)
    nf.estudiante_id,
    nf.estudiante::text,
    nf.carnet::text,
    nf.materia_id,
    nf.materia::text,
    nf.curso_id,
    nf.curso::text,
    nf.nivel::text,
    nf.trimestre::integer,
    nf.nota_final::numeric,
    nf.estado::text,
    nf.promedio_hacer::numeric,
    nf.promedio_saber::numeric,
    (CASE WHEN COALESCE(c.ser_ok, false)     THEN 'calificada' ELSE 'pendiente' END)::text,
    (CASE WHEN COALESCE(c.decidir_ok, false) THEN 'calificada' ELSE 'pendiente' END)::text
  FROM public.notas_finales nf
  LEFT JOIN cal c
    ON c.estudiante_id = nf.estudiante_id
   AND c.materia_id    = nf.materia_id
   AND c.trimestre     = nf.trimestre
  WHERE nf.colegio_id = public.mi_colegio_id()
    AND nf.trimestre  = p_trimestre
    AND (nf.nota_final > 0 OR nf.promedio_hacer IS NOT NULL OR nf.promedio_saber IS NOT NULL)
    AND (p_nivel IS NULL OR btrim(p_nivel) = '' OR nf.nivel = p_nivel)
  ORDER BY
    nf.estudiante_id,
    nf.materia_id,
    nf.nota_final DESC;
END;
$$;


--
-- Name: resolver_licencia(uuid, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolver_licencia(p_id uuid, p_aprobar boolean, p_motivo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not tiene_permiso('licencias.aprobar') then raise exception 'Sin permiso para resolver licencias'; end if;
  if not p_aprobar and p_motivo is null then raise exception 'Elige un motivo de rechazo'; end if;
  update public.licencias
    set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
        motivo_respuesta = case when p_aprobar then null else p_motivo end,
        nota_respuesta = nullif(trim(coalesce(p_nota,'')),''),
        resuelto_por = auth.uid(), resuelto_en = now()
  where id = p_id and colegio_id = mi_colegio_id() and estado = 'pendiente';
  if not found then raise exception 'La licencia no existe o ya fue resuelta'; end if;
  return true;
end $$;


--
-- Name: restaurar_foto_estudiante(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restaurar_foto_estudiante(p_estudiante_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  IF NOT public.es_director() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  UPDATE public.estudiantes
     SET foto_url = foto_anterior, foto_anterior = foto_url,
         foto_subida_por = auth.uid(), foto_subida_at = now()
   WHERE id = p_estudiante_id
     AND colegio_id = public.mi_colegio_id()
     AND foto_anterior IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay foto anterior para restaurar';
  END IF;
END;
$$;


--
-- Name: resumen_comunicados(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resumen_comunicados(p_desde integer DEFAULT 0, p_limite integer DEFAULT 50) RETURNS TABLE(id uuid, created_at timestamp with time zone, categoria text, asunto text, contenido text, tipo_destinatario text, destinatario_nombre text, emisor_id uuid, emisor_nombre text, total bigint, leidos bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.created_at, c.categoria, c.asunto, c.contenido, c.tipo_destinatario,
         c.destinatario_nombre, c.emisor_id, u.nombre_completo,
         (SELECT count(*) FROM public.comunicados_estudiante ce WHERE ce.comunicado_id = c.id),
         (SELECT count(*) FROM public.comunicados_estudiante ce
           WHERE ce.comunicado_id = c.id
             AND (ce.leido_at IS NOT NULL
                  OR EXISTS (SELECT 1 FROM public.comunicados_lectura_tutor lt
                              WHERE lt.comunicado_estudiante_id = ce.id)))
  FROM public.comunicados c
  LEFT JOIN public.usuarios u ON u.id = c.emisor_id
  WHERE auth.uid() IS NOT NULL
    AND (
         (public.es_director() AND c.colegio_id = public.mi_colegio_id())
      OR (public.es_profesor() AND c.emisor_id = auth.uid())
    )
  ORDER BY c.created_at DESC, c.id
  OFFSET greatest(coalesce(p_desde, 0), 0)
  LIMIT  least(greatest(coalesce(p_limite, 50), 1), 200)
$$;


--
-- Name: FUNCTION resumen_comunicados(p_desde integer, p_limite integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.resumen_comunicados(p_desde integer, p_limite integer) IS 'Comunicados enviados por página con total de destinatarios y familias que leyeron (estudiante o padre). Director: su colegio; profesor: los suyos. Migración 118.';


--
-- Name: retirar_asesor_curso(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retirar_asesor_curso(p_curso_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: revisar_vinculacion(uuid, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revisar_vinculacion(p_tutor_id uuid, p_aceptar boolean, p_motivo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v record;
begin
  if not tiene_permiso('vinculos.revisar') then raise exception 'Sin permiso para revisar vinculaciones'; end if;
  select tv.* into v from public.tutor_verificacion tv
  join public.tutores_familia tf on tf.id = tv.tutor_id
  where tv.tutor_id = p_tutor_id and tf.colegio_id = mi_colegio_id();
  if v.tutor_id is null then raise exception 'Vinculación no encontrada'; end if;
  if v.estado <> 'pendiente' then raise exception 'Esta vinculación ya fue revisada'; end if;

  if p_aceptar then
    update public.tutor_verificacion
      set estado = 'revisado', revisado_por = auth.uid(), revisado_en = now(),
          ci_anverso = null, ci_reverso = null, nota = nullif(trim(coalesce(p_nota,'')),''), updated_at = now()
      where tutor_id = p_tutor_id;
  else
    if p_motivo is null or p_motivo not in ('carnet_ilegible','no_corresponde','parentesco_no_valido','presentarse_direccion','otro') then
      raise exception 'Elige un motivo de rechazo';
    end if;
    update public.tutor_verificacion
      set estado = 'rechazado', revisado_por = auth.uid(), revisado_en = now(),
          ci_anverso = null, ci_reverso = null, motivo_rechazo = p_motivo,
          nota = nullif(trim(coalesce(p_nota,'')),''), updated_at = now()
      where tutor_id = p_tutor_id;
    update public.tutor_estudiante te set activo = false
      where te.tutor_id = p_tutor_id and colegio_de_estudiante(te.estudiante_id) = mi_colegio_id();
  end if;
  return json_build_object('anverso', v.ci_anverso, 'reverso', v.ci_reverso);
end $$;


--
-- Name: rpc_crear_director(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_crear_director(p_id uuid, p_nombre text, p_email text, p_colegio_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  INSERT INTO public.usuarios (id, nombre_completo, email, rol, activo, colegio_id)
  VALUES (p_id, p_nombre, p_email, 'director', true, p_colegio_id)
  ON CONFLICT (id) DO UPDATE SET
    colegio_id      = p_colegio_id,
    rol             = 'director',
    activo          = true,
    nombre_completo = p_nombre;
END;
$$;


--
-- Name: rpc_delete_nota(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_actividad   RECORD;
  v_asignado    BOOLEAN;
  v_nota_id     UUID;
  v_old_valor   NUMERIC;
  v_colegio_act UUID;
BEGIN
  -- Verificar que el llamante es profesor o director
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos para eliminar notas';
  END IF;

  -- Obtener actividad
  SELECT * INTO v_actividad FROM public.actividades WHERE id = p_actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- 115: la actividad debe pertenecer al colegio de quien llama
  SELECT COALESCE(
           (SELECT c.colegio_id FROM public.cursos c WHERE c.id = v_actividad.curso_id),
           (SELECT m.colegio_id FROM public.materias m WHERE m.id = v_actividad.materia_id))
    INTO v_colegio_act;
  IF v_colegio_act IS DISTINCT FROM public.mi_colegio_id() THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- Si es profesor, verificar asignación
  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor
      WHERE profesor_id = auth.uid()
        AND materia_id = v_actividad.materia_id
        AND curso_id = v_actividad.curso_id
        AND activo = true
    ) INTO v_asignado;

    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia/curso';
    END IF;
  END IF;

  -- Obtener nota y su valor para auditoría, luego eliminarla
  SELECT id, valor INTO v_nota_id, v_old_valor FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  IF NOT FOUND THEN
    -- No existe nota, retorna ok sin error
    RETURN jsonb_build_object('ok', true, 'message', 'Nota no encontrada, nada que eliminar');
  END IF;

  -- Eliminar
  DELETE FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  -- Auditoría
  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id, datos_antes, datos_despues)
  VALUES (
    auth.uid(), 'profesor', 'delete_nota', 'notas', v_nota_id,
    jsonb_build_object('valor', v_old_valor),
    jsonb_build_object('valor', NULL)
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Nota eliminada', 'valor_anterior', v_old_valor);
END;
$$;


--
-- Name: FUNCTION rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid) IS 'Elimina una nota de un estudiante en una actividad. Solo acceso vía RPC, con validación de asignación profesor y auditoría.';


--
-- Name: rpc_publish_ficha(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_publish_ficha(p_ficha_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_ficha RECORD;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  -- 115: la ficha debe ser de un estudiante del colegio de quien llama (antes de bloquear la fila)
  IF NOT EXISTS (
    SELECT 1
    FROM public.fichas_seguimiento_ser f
    JOIN public.estudiantes e ON e.id = f.estudiante_id
    WHERE f.id = p_ficha_id
      AND e.colegio_id = public.mi_colegio_id()
  ) THEN
    RAISE EXCEPTION 'Ficha no encontrada';
  END IF;

  -- Lock y lectura
  SELECT * INTO v_ficha
  FROM public.fichas_seguimiento_ser
  WHERE id = p_ficha_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha no encontrada';
  END IF;

  -- Solo el profesor dueño o director
  IF public.es_profesor() AND v_ficha.profesor_id != auth.uid() THEN
    RAISE EXCEPTION 'Solo el profesor que creó la ficha puede publicarla';
  END IF;

  -- Despublicar anteriores
  UPDATE public.fichas_seguimiento_ser
  SET publicada = false, fecha_publicacion = NULL
  WHERE estudiante_id = v_ficha.estudiante_id
    AND materia_id    = v_ficha.materia_id
    AND trimestre     = v_ficha.trimestre
    AND año           = v_ficha.año
    AND publicada     = true;

  -- Publicar actual
  UPDATE public.fichas_seguimiento_ser
  SET publicada = true, fecha_publicacion = NOW()
  WHERE id = p_ficha_id;

  -- Actualizar calificaciones
  PERFORM public.rpc_upsert_calificacion(
    v_ficha.estudiante_id,
    v_ficha.materia_id,
    v_ficha.trimestre,
    v_ficha.nota_calculada,
    NULL
  );

  -- Auditoría
  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id)
  VALUES (auth.uid(), 'profesor', 'publish_ficha', 'fichas_seguimiento_ser', p_ficha_id);

  RETURN jsonb_build_object('ok', true, 'ficha_id', p_ficha_id, 'nota_ser', v_ficha.nota_calculada);
END;
$$;


--
-- Name: rpc_upsert_calificacion(uuid, uuid, integer, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric DEFAULT NULL::numeric, p_nota_decidir numeric DEFAULT NULL::numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_asignado  BOOLEAN;
  v_max       NUMERIC;
  v_cal_id    UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  -- 115: estudiante y materia deben pertenecer al colegio de quien llama
  IF NOT EXISTS (
    SELECT 1
    FROM public.estudiantes e
    JOIN public.materias m ON m.id = p_materia_id
    WHERE e.id = p_estudiante_id
      AND e.colegio_id = public.mi_colegio_id()
      AND m.colegio_id = public.mi_colegio_id()
  ) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor ap
      JOIN public.estudiantes e ON e.curso_id = ap.curso_id
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = p_materia_id
        AND ap.activo = true
        AND e.id = p_estudiante_id
    ) INTO v_asignado;
    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia para este estudiante';
    END IF;
  END IF;

  -- 123: peso del colegio de quien llama y de su gestión vigente
  IF p_nota_ser IS NOT NULL THEN
    SELECT d.peso_maximo INTO v_max FROM public.config_dimensiones d
    WHERE d.colegio_id = public.mi_colegio_id()
      AND d.codigo = 'ser'
      AND d.año = public.año_gestion_vigente()
    LIMIT 1;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'No hay configuración de la dimensión SER para la gestión vigente';
    END IF;
    IF p_nota_ser < 0 OR p_nota_ser > v_max THEN
      RAISE EXCEPTION 'Nota SER fuera de rango';
    END IF;
  END IF;

  IF p_nota_decidir IS NOT NULL THEN
    v_max := NULL;
    SELECT d.peso_maximo INTO v_max FROM public.config_dimensiones d
    WHERE d.colegio_id = public.mi_colegio_id()
      AND d.codigo = 'decidir'
      AND d.año = public.año_gestion_vigente()
    LIMIT 1;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'No hay configuración de la dimensión DECIDIR para la gestión vigente';
    END IF;
    IF p_nota_decidir < 0 OR p_nota_decidir > v_max THEN
      RAISE EXCEPTION 'Nota DECIDIR fuera de rango';
    END IF;
  END IF;

  INSERT INTO public.calificaciones (estudiante_id, materia_id, trimestre, nota_ser, nota_decidir)
  VALUES (p_estudiante_id, p_materia_id, p_trimestre, p_nota_ser, p_nota_decidir)
  ON CONFLICT (estudiante_id, materia_id, trimestre)
  DO UPDATE SET
    nota_ser     = COALESCE(EXCLUDED.nota_ser, calificaciones.nota_ser),
    nota_decidir = COALESCE(EXCLUDED.nota_decidir, calificaciones.nota_decidir),
    updated_at   = NOW()
  RETURNING id INTO v_cal_id;

  RETURN jsonb_build_object('ok', true, 'calificacion_id', v_cal_id);
END;
$$;


--
-- Name: rpc_upsert_nota(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_upsert_nota(p_actividad_id uuid, p_estudiante_id uuid, p_valor numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_actividad   RECORD;
  v_asignado    BOOLEAN;
  v_en_curso    BOOLEAN;
  v_nota_id     UUID;
  v_old_valor   NUMERIC;
  v_colegio_act UUID;
BEGIN
  IF NOT (public.es_profesor() OR public.es_director()) THEN
    RAISE EXCEPTION 'Sin permisos para registrar notas';
  END IF;

  SELECT * INTO v_actividad FROM public.actividades WHERE id = p_actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- 115: la actividad debe pertenecer al colegio de quien llama
  SELECT COALESCE(
           (SELECT c.colegio_id FROM public.cursos c WHERE c.id = v_actividad.curso_id),
           (SELECT m.colegio_id FROM public.materias m WHERE m.id = v_actividad.materia_id))
    INTO v_colegio_act;
  IF v_colegio_act IS DISTINCT FROM public.mi_colegio_id() THEN
    RAISE EXCEPTION 'Actividad no encontrada';
  END IF;

  -- El estudiante debe pertenecer al curso de la actividad
  SELECT EXISTS(
    SELECT 1 FROM public.estudiantes
    WHERE id = p_estudiante_id AND curso_id = v_actividad.curso_id
  ) INTO v_en_curso;

  IF NOT v_en_curso THEN
    RAISE EXCEPTION 'El estudiante no pertenece al curso de esta actividad';
  END IF;

  IF public.es_profesor() THEN
    SELECT EXISTS(
      SELECT 1 FROM public.asignaciones_profesor
      WHERE profesor_id = auth.uid()
        AND materia_id = v_actividad.materia_id
        AND curso_id = v_actividad.curso_id
        AND activo = true
    ) INTO v_asignado;

    IF NOT v_asignado THEN
      RAISE EXCEPTION 'Profesor no asignado a esta materia/curso';
    END IF;
  END IF;

  IF p_valor < 0 OR p_valor > v_actividad.max_puntos THEN
    RAISE EXCEPTION 'Valor % fuera de rango (0 - %)', p_valor, v_actividad.max_puntos;
  END IF;

  SELECT valor INTO v_old_valor FROM public.notas
  WHERE actividad_id = p_actividad_id AND estudiante_id = p_estudiante_id;

  INSERT INTO public.notas (actividad_id, estudiante_id, valor, creado_por)
  VALUES (p_actividad_id, p_estudiante_id, p_valor, auth.uid())
  ON CONFLICT (actividad_id, estudiante_id)
  DO UPDATE SET valor = EXCLUDED.valor
  RETURNING id INTO v_nota_id;

  INSERT INTO public.audit_logs (actor_id, actor_rol, accion, tabla, registro_id, datos_antes, datos_despues)
  VALUES (
    auth.uid(), 'profesor', 'upsert_nota', 'notas', v_nota_id,
    jsonb_build_object('valor', v_old_valor),
    jsonb_build_object('valor', p_valor)
  );

  RETURN jsonb_build_object('ok', true, 'nota_id', v_nota_id, 'valor', p_valor);
END;
$$;


--
-- Name: rpc_upsert_notas_bulk(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_upsert_notas_bulk(p_actividad_id uuid, p_notas jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_item    JSONB;
  v_results JSONB := '[]'::JSONB;
  v_res     JSONB;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_notas)
  LOOP
    v_res := public.rpc_upsert_nota(
      p_actividad_id,
      (v_item->>'estudiante_id')::UUID,
      (v_item->>'valor')::NUMERIC
    );
    v_results := v_results || jsonb_build_array(v_res);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'resultados', v_results, 'total', jsonb_array_length(p_notas));
END;
$$;


--
-- Name: set_actualizado_en(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_actualizado_en() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: solicitar_licencia(uuid, text, date, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.solicitar_licencia(p_estudiante_id uuid, p_motivo text, p_inicio date, p_fin date, p_descripcion text, p_comprobante text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_hoy date := hoy_bolivia();
  v_colegio uuid; v_verif text; v_id uuid; v_mes int;
begin
  if auth.uid() is null or not es_tutor() then raise exception 'Solo un tutor puede solicitar licencias'; end if;

  if not exists (select 1 from public.tutor_estudiante
                 where tutor_id = auth.uid() and estudiante_id = p_estudiante_id and activo = true) then
    raise exception 'Este estudiante no está vinculado a tu cuenta';
  end if;

  select estado into v_verif from public.tutor_verificacion where tutor_id = auth.uid();
  if v_verif is null then raise exception 'Antes de solicitar, registra tu carnet de identidad (anverso y reverso).'; end if;
  if v_verif = 'rechazado' then raise exception 'Tu registro fue observado por dirección. Acércate al colegio.'; end if;

  select e.colegio_id into v_colegio from public.estudiantes e
  join public.usuarios u on u.id = e.id
  where e.id = p_estudiante_id and u.activo = true and e.estado = 'activo';
  if v_colegio is null then raise exception 'El estudiante no está activo'; end if;

  if p_inicio is null or p_fin is null or p_fin < p_inicio then raise exception 'Fechas no válidas'; end if;
  if p_inicio < v_hoy then raise exception 'No se puede solicitar licencia para días pasados'; end if;
  if (p_fin - p_inicio) + 1 > 5 then raise exception 'La licencia puede ser de 5 días como máximo'; end if;
  if p_motivo = 'emergencia' and (p_inicio <> v_hoy or p_fin <> v_hoy) then
    raise exception 'Una emergencia solo se puede solicitar para el día de hoy';
  end if;
  if p_motivo = 'emergencia' and coalesce(p_comprobante,'') = '' then
    raise exception 'Para una emergencia debes adjuntar un comprobante';
  end if;
  if p_comprobante is not null and split_part(p_comprobante,'/',1) <> auth.uid()::text then
    raise exception 'Ruta de archivo no válida';
  end if;

  if exists (select 1 from public.licencias where estudiante_id = p_estudiante_id and estado = 'pendiente') then
    raise exception 'Ya tienes una solicitud pendiente para este estudiante';
  end if;

  select count(*) into v_mes from public.licencias
  where estudiante_id = p_estudiante_id and estado in ('pendiente','aprobada')
    and date_trunc('month', fecha_inicio) = date_trunc('month', p_inicio);
  if v_mes >= 4 then raise exception 'Se alcanzó el límite de 4 licencias en el mes para este estudiante'; end if;

  begin
    insert into public.licencias (colegio_id, estudiante_id, tutor_id, motivo, fecha_inicio, fecha_fin, descripcion, comprobante)
    values (v_colegio, p_estudiante_id, auth.uid(), p_motivo, p_inicio, p_fin, trim(p_descripcion), nullif(p_comprobante,''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una solicitud pendiente para este estudiante';
  end;
  return v_id;
end $$;


--
-- Name: sync_curso_inscripciones_tecnicas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_curso_inscripciones_tecnicas() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.curso_id is distinct from old.curso_id then
    update public.inscripciones_tecnicas
       set curso_id = new.curso_id
     where estudiante_id = new.id
       and activo = true;
  end if;
  return new;
end;
$$;


--
-- Name: tiene_permiso(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tiene_permiso(p_permiso text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  select public.es_director() or exists (
    select 1 from public.permisos_usuario pu
    join public.usuarios u on u.id = pu.usuario_id
    where pu.usuario_id = auth.uid() and pu.permiso = p_permiso
      and u.activo = true and u.rol in ('secretaria','regente')
      and pu.colegio_id = u.colegio_id
  );
$$;


--
-- Name: trg_actividad_fecha_cambiada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_actividad_fecha_cambiada() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.fecha_limite is distinct from old.fecha_limite
     or new.hora_limite is distinct from old.hora_limite then
    new.fecha_cambiada_en := now();
  end if;
  return new;
end $$;


--
-- Name: trg_nota_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_nota_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.valor is distinct from old.valor then new.updated_at := now(); end if;
  return new;
end $$;


--
-- Name: trg_validar_rango_nota(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_validar_rango_nota() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_max numeric;
BEGIN
  SELECT a.max_puntos INTO v_max FROM public.actividades a WHERE a.id = NEW.actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actividad no encontrada' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.valor < 0 OR (v_max IS NOT NULL AND NEW.valor > v_max) THEN
    RAISE EXCEPTION 'Valor % fuera de rango (0 - %)', NEW.valor, v_max USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tutoriales_rol_actual(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutoriales_rol_actual() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT u.rol
  FROM public.usuarios u
  WHERE u.id = auth.uid() AND u.activo = true;
$$;


--
-- Name: tutoriales_videos_validos(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutoriales_videos_validos(v jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'array' THEN false
    WHEN jsonb_array_length(v) > 5 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) e
      WHERE jsonb_typeof(e) <> 'object'
         OR coalesce(jsonb_typeof(e->'url'), '') <> 'string'
         OR coalesce(e->>'url', '') !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^[:space:]"''<>\\`]*)?$'
         OR char_length(coalesce(e->>'url', '')) > 500
         OR (e->'titulo' IS NOT NULL AND (jsonb_typeof(e->'titulo') <> 'string'
                                          OR char_length(e->>'titulo') > 60))
    )
  END;
$_$;


--
-- Name: update_user_password(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_password(p_user_id uuid, p_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;


--
-- Name: usuario_activo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usuario_activo(p_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select case when auth.uid() is null then false
             else coalesce((select activo from public.usuarios where id = p_id), false) end $$;


--
-- Name: validar_suma_rubrica(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validar_suma_rubrica() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: vincular_hijo_seguro(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vincular_hijo_seguro(p_estudiante_id uuid, p_parentesco text DEFAULT 'padre'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_tutor      UUID;
  v_existe             UUID;
  v_total_tutores      INT;
  v_verif              TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  -- NUEVO (101): antes de vincular, el tutor debe registrar su carnet (una sola vez por cuenta)
  SELECT estado INTO v_verif FROM public.tutor_verificacion WHERE tutor_id = auth.uid();
  IF v_verif IS NULL THEN
    RAISE EXCEPTION 'Antes de vincular, registra tu carnet de identidad (anverso y reverso).';
  ELSIF v_verif = 'rechazado' THEN
    RAISE EXCEPTION 'Tu registro fue observado por dirección. Vuelve a registrar tu carnet o acércate al colegio.';
  END IF;

  SELECT colegio_id INTO v_colegio_estudiante
  FROM public.estudiantes WHERE id = p_estudiante_id;

  IF v_colegio_estudiante IS NULL THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;

  SELECT colegio_id INTO v_colegio_tutor
  FROM public.tutores_familia WHERE id = auth.uid();

  IF v_colegio_tutor IS NULL THEN
    UPDATE public.tutores_familia SET colegio_id = v_colegio_estudiante WHERE id = auth.uid();
    UPDATE public.usuarios        SET colegio_id = v_colegio_estudiante WHERE id = auth.uid();
  ELSIF v_colegio_tutor <> v_colegio_estudiante THEN
    RAISE EXCEPTION 'Este estudiante pertenece a otro colegio y no puede vincularse a tu cuenta.';
  END IF;

  SELECT te.id INTO v_existe
  FROM public.tutor_estudiante te
  WHERE te.tutor_id = auth.uid() AND te.estudiante_id = p_estudiante_id;

  IF v_existe IS NOT NULL THEN
    RAISE EXCEPTION 'Este estudiante ya está vinculado a tu cuenta';
  END IF;

  SELECT COUNT(*) INTO v_total_tutores
  FROM public.tutor_estudiante
  WHERE estudiante_id = p_estudiante_id AND activo = true;

  IF v_total_tutores >= 2 THEN
    RAISE EXCEPTION 'Este estudiante ya tiene el máximo de tutores permitidos. Si necesitas vincular a un tercer familiar (ej. tutor legal), contacta a dirección del colegio.';
  END IF;

  INSERT INTO public.tutor_estudiante (tutor_id, estudiante_id, parentesco)
  VALUES (auth.uid(), p_estudiante_id, p_parentesco);

  RETURN TRUE;
END;
$$;


--
-- Name: actividades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actividades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    tipo text NOT NULL,
    max_puntos numeric(5,2) NOT NULL,
    curso_id uuid,
    materia_id uuid,
    trimestre integer NOT NULL,
    fecha_limite date,
    creado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archivo_consigna_url text,
    hora_limite time without time zone,
    fecha_cambiada_en timestamp with time zone,
    permite_entrega_tardia boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE actividades; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.actividades IS 'Actividades evaluables. max_puntos y trimestre vienen de config_gestion.';


--
-- Name: COLUMN actividades.permite_entrega_tardia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.actividades.permite_entrega_tardia IS 'true = el estudiante puede subir su entrega después de fecha_limite/hora_limite; se marca como tardía en pantalla. false = se cierra al vencer (comportamiento original).';


--
-- Name: asesor_curso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asesor_curso (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    profesor_id uuid NOT NULL,
    "año" integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    asignado_por uuid,
    asignado_en timestamp with time zone DEFAULT now() NOT NULL,
    desactivado_en timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "asesor_curso_año_positivo" CHECK ((("año" >= 2000) AND ("año" <= 2100)))
);


--
-- Name: TABLE asesor_curso; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.asesor_curso IS 'Asesor de curso (1 activo por curso/año y 1 curso activo por profesor/año). Historial por desactivación, sin borrado.';


--
-- Name: asignaciones_profesor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asignaciones_profesor (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profesor_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE asignaciones_profesor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.asignaciones_profesor IS 'Asignación de profesores a materias y cursos.';


--
-- Name: asistencia_porteria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asistencia_porteria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    fecha date NOT NULL,
    hora timestamp with time zone NOT NULL,
    turno text,
    tipo text NOT NULL,
    estado text NOT NULL,
    metodo text NOT NULL,
    dispositivo text,
    registrado_por uuid,
    motivo text,
    duplicado boolean DEFAULT false NOT NULL,
    client_uuid uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asistencia_porteria_estado_check CHECK ((estado = ANY (ARRAY['a_tiempo'::text, 'atraso'::text, 'salida_anticipada'::text, 'normal'::text, 'fuera_de_horario'::text]))),
    CONSTRAINT asistencia_porteria_metodo_check CHECK ((metodo = ANY (ARRAY['qr'::text, 'manual'::text, 'carnet'::text, 'nfc'::text, 'tarjeta'::text, 'huella'::text, 'facial'::text]))),
    CONSTRAINT asistencia_porteria_tipo_check CHECK ((tipo = ANY (ARRAY['entrada'::text, 'salida'::text]))),
    CONSTRAINT asistencia_porteria_turno_check CHECK ((turno = ANY (ARRAY['manana'::text, 'tarde'::text, 'noche'::text])))
);


--
-- Name: asistencia_qr_llamadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asistencia_qr_llamadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    profesor_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    sesion text NOT NULL,
    fecha date NOT NULL,
    abierta_at timestamp with time zone DEFAULT now() NOT NULL,
    inicio timestamp with time zone,
    tolerancia_min integer DEFAULT 7 NOT NULL,
    cerrada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asistencia_qr_llamadas_sesion_check CHECK ((sesion = ANY (ARRAY['regular'::text, 'tecnica'::text]))),
    CONSTRAINT asistencia_qr_llamadas_tolerancia_min_check CHECK ((tolerancia_min >= 0))
);


--
-- Name: asistencias_materia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asistencias_materia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    profesor_id uuid NOT NULL,
    fecha date NOT NULL,
    sesion text NOT NULL,
    estado text NOT NULL,
    observaciones text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metodo text DEFAULT 'manual'::text NOT NULL,
    hora_llegada timestamp with time zone,
    minutos_retraso integer,
    llamada_id uuid,
    CONSTRAINT asistencias_materia_estado_check CHECK ((estado = ANY (ARRAY['presente'::text, 'falta'::text, 'retraso'::text, 'licencia'::text]))),
    CONSTRAINT asistencias_materia_metodo_check CHECK ((metodo = ANY (ARRAY['manual'::text, 'qr'::text]))),
    CONSTRAINT asistencias_materia_minutos_retraso_check CHECK (((minutos_retraso IS NULL) OR (minutos_retraso >= 0))),
    CONSTRAINT asistencias_materia_sesion_check CHECK ((sesion = ANY (ARRAY['regular'::text, 'tecnica'::text])))
);


--
-- Name: materias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid,
    nombre text NOT NULL,
    nivel text NOT NULL,
    campo_saberes text,
    es_tecnica boolean DEFAULT false NOT NULL,
    aplica_desde text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT materias_campo_saberes_check CHECK ((campo_saberes = ANY (ARRAY['COMUNIDAD Y SOCIEDAD'::text, 'CIENCIA TECNOLOGÍA Y PRODUCCIÓN'::text, 'VIDA TIERRA TERRITORIO'::text, 'COSMOS Y PENSAMIENTO'::text]))),
    CONSTRAINT materias_nivel_check CHECK ((nivel = ANY (ARRAY['Primaria'::text, 'Secundaria'::text, 'Ambos'::text])))
);


--
-- Name: TABLE materias; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.materias IS 'Materias base del plan de estudios boliviano.';


--
-- Name: asistencia_resumen_diario; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.asistencia_resumen_diario WITH (security_invoker='true') AS
 WITH resumen AS (
         SELECT asistencias_materia.estudiante_id,
            asistencias_materia.curso_id,
            asistencias_materia.fecha,
            asistencias_materia.sesion,
                CASE
                    WHEN bool_or((asistencias_materia.estado = 'falta'::text)) THEN 'falta'::text
                    WHEN bool_or((asistencias_materia.estado = 'licencia'::text)) THEN 'licencia'::text
                    WHEN bool_or((asistencias_materia.estado = 'retraso'::text)) THEN 'retraso'::text
                    ELSE 'presente'::text
                END AS estado_resumen,
            count(*) AS materias_registradas
           FROM public.asistencias_materia
          GROUP BY asistencias_materia.estudiante_id, asistencias_materia.curso_id, asistencias_materia.fecha, asistencias_materia.sesion
        )
 SELECT estudiante_id,
    curso_id,
    fecha,
    sesion,
    estado_resumen,
    materias_registradas,
        CASE
            WHEN (estado_resumen <> 'presente'::text) THEN ( SELECT string_agg(m.nombre, ', '::text ORDER BY m.nombre) AS string_agg
               FROM (public.asistencias_materia am
                 JOIN public.materias m ON ((m.id = am.materia_id)))
              WHERE ((am.estudiante_id = r.estudiante_id) AND (am.fecha = r.fecha) AND (am.sesion = r.sesion) AND (am.estado = r.estado_resumen)))
            ELSE NULL::text
        END AS materia_excepcion
   FROM resumen r;


--
-- Name: asistencia_resumen_profesor; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.asistencia_resumen_profesor WITH (security_invoker='true') AS
 SELECT estudiante_id,
    curso_id,
    profesor_id,
    fecha,
    sesion,
        CASE
            WHEN bool_or((estado = 'falta'::text)) THEN 'falta'::text
            WHEN bool_or((estado = 'licencia'::text)) THEN 'licencia'::text
            WHEN bool_or((estado = 'retraso'::text)) THEN 'retraso'::text
            ELSE 'presente'::text
        END AS estado_resumen
   FROM public.asistencias_materia
  GROUP BY estudiante_id, curso_id, profesor_id, fecha, sesion;


--
-- Name: asistencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asistencias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    fecha date NOT NULL,
    estado text NOT NULL,
    observaciones text,
    registrado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sesion text DEFAULT 'regular'::text NOT NULL,
    CONSTRAINT asistencias_estado_check CHECK ((estado = ANY (ARRAY['presente'::text, 'falta'::text, 'retraso'::text, 'licencia'::text]))),
    CONSTRAINT asistencias_sesion_check CHECK ((sesion = ANY (ARRAY['regular'::text, 'tecnica'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_rol text,
    accion text NOT NULL,
    tabla text NOT NULL,
    registro_id uuid,
    datos_antes jsonb,
    datos_despues jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: becas_estudiante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.becas_estudiante (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    colegio_id uuid NOT NULL,
    "año" integer NOT NULL,
    porcentaje numeric(5,2) DEFAULT 100 NOT NULL,
    motivo text,
    asignado_por uuid,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT becas_estudiante_porcentaje_check CHECK (((porcentaje >= (0)::numeric) AND (porcentaje <= (100)::numeric)))
);


--
-- Name: TABLE becas_estudiante; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.becas_estudiante IS 'Becas asignadas manualmente por el director. 100% = no paga ese año.';


--
-- Name: bitacora_docente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bitacora_docente (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    profesor_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    fecha date NOT NULL,
    tema text NOT NULL,
    tipo_actividad text NOT NULL,
    estado text DEFAULT 'culminado'::text NOT NULL,
    detalle text,
    observacion_director text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bitacora_docente_estado_check CHECK ((estado = ANY (ARRAY['culminado'::text, 'pendiente'::text]))),
    CONSTRAINT bitacora_docente_fecha_no_futura CHECK ((fecha <= CURRENT_DATE))
);


--
-- Name: calificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calificaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    trimestre integer NOT NULL,
    nota_ser numeric(5,2),
    nota_decidir numeric(5,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE calificaciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.calificaciones IS 'SER y DECIDIR directos. HACER y SABER se calculan desde notas.';


--
-- Name: comunicados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comunicados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    emisor_id uuid NOT NULL,
    tipo_emisor text NOT NULL,
    tipo_destinatario text NOT NULL,
    destinatario_id uuid,
    materia_id uuid,
    asunto text NOT NULL,
    contenido text NOT NULL,
    categoria text DEFAULT 'Informativo'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    destinatario_nombre text,
    CONSTRAINT comunicados_categoria_check CHECK ((categoria = ANY (ARRAY['Citación'::text, 'Informativo'::text, 'Urgente'::text]))),
    CONSTRAINT comunicados_tipo_destinatario_check CHECK ((tipo_destinatario = ANY (ARRAY['estudiante'::text, 'curso'::text, 'colegio'::text]))),
    CONSTRAINT comunicados_tipo_emisor_check CHECK ((tipo_emisor = ANY (ARRAY['director'::text, 'profesor'::text])))
);


--
-- Name: comunicados_estudiante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comunicados_estudiante (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comunicado_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    leido_at timestamp with time zone
);


--
-- Name: comunicados_lectura_tutor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comunicados_lectura_tutor (
    comunicado_estudiante_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    colegio_id uuid NOT NULL,
    leido_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE comunicados_lectura_tutor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.comunicados_lectura_tutor IS 'Lectura de comunicados desde la cuenta del tutor (padre). Se escribe solo con marcar_comunicado_leido_tutor (migración 115).';


--
-- Name: config_categorias_ser; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_categorias_ser (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "año" integer NOT NULL,
    nombre text NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    colegio_id uuid NOT NULL
);


--
-- Name: config_dimensiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_dimensiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gestion_id uuid NOT NULL,
    "año" integer NOT NULL,
    codigo text NOT NULL,
    nombre_display text NOT NULL,
    descripcion text,
    peso_maximo numeric(5,2) NOT NULL,
    tipo text NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    colegio_id uuid NOT NULL,
    CONSTRAINT config_dimensiones_tipo_check CHECK ((tipo = ANY (ARRAY['actividades'::text, 'ficha'::text, 'directo'::text])))
);


--
-- Name: TABLE config_dimensiones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_dimensiones IS 'Pesos de dimensiones por año. Reemplaza 40/45/10/5 hardcodeados.';


--
-- Name: config_escala_ser; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_escala_ser (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "año" integer NOT NULL,
    valor_numerico numeric(5,2) NOT NULL,
    etiqueta text NOT NULL,
    color text DEFAULT 'gray'::text,
    orden integer DEFAULT 0 NOT NULL,
    colegio_id uuid NOT NULL
);


--
-- Name: TABLE config_escala_ser; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_escala_ser IS 'Escala SER dinámica. Reemplaza CHECK(IN(2,7,10)) hardcodeado.';


--
-- Name: config_gestion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_gestion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "año" integer NOT NULL,
    estado text DEFAULT 'activo'::text NOT NULL,
    cantidad_periodos integer DEFAULT 3 NOT NULL,
    nombre_periodo text DEFAULT 'Trimestre'::text NOT NULL,
    nota_minima_aprobacion numeric(5,2) DEFAULT 51 NOT NULL,
    escala_maxima numeric(5,2) DEFAULT 100 NOT NULL,
    etiqueta_aprobado text DEFAULT 'APROBADO'::text NOT NULL,
    etiqueta_reprobado text DEFAULT 'REPROBADO'::text NOT NULL,
    activado_por uuid,
    fecha_apertura timestamp with time zone DEFAULT now(),
    fecha_cierre timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bloqueada boolean DEFAULT false,
    trimestre_activo integer DEFAULT 1 NOT NULL,
    usa_carreras_tecnicas boolean DEFAULT false NOT NULL,
    permite_entrega_tareas boolean DEFAULT false NOT NULL,
    colegio_id uuid NOT NULL,
    usa_porteria boolean DEFAULT false NOT NULL,
    porteria_max_salidas integer DEFAULT 2 NOT NULL,
    CONSTRAINT config_gestion_cantidad_periodos_check CHECK (((cantidad_periodos >= 1) AND (cantidad_periodos <= 6))),
    CONSTRAINT config_gestion_estado_check CHECK ((estado = ANY (ARRAY['planificacion'::text, 'activo'::text, 'cerrado'::text]))),
    CONSTRAINT config_gestion_porteria_max_salidas_check CHECK (((porteria_max_salidas >= 1) AND (porteria_max_salidas <= 20)))
);


--
-- Name: TABLE config_gestion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_gestion IS 'Gestión académica anual. Reemplaza valores hardcodeados de periodos y aprobación.';


--
-- Name: COLUMN config_gestion.usa_carreras_tecnicas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.config_gestion.usa_carreras_tecnicas IS 'Si true, el colegio usa carreras técnicas especializadas (Sistemas, Gastronomía, etc.)
   en 4to/5to/6to secundaria. Si false, todos los cursos llevan Técnica Tecnológica General.';


--
-- Name: COLUMN config_gestion.permite_entrega_tareas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.config_gestion.permite_entrega_tareas IS 'Si true, el profesor ve el contador de entregas en cada actividad y
   el estudiante puede subir archivos PDF/imagen desde su panel.';


--
-- Name: config_mensualidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_mensualidad (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    gestion_id uuid NOT NULL,
    "año" integer NOT NULL,
    nivel text NOT NULL,
    mes integer NOT NULL,
    monto_bs numeric(8,2) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT config_mensualidad_mes_check CHECK (((mes >= 1) AND (mes <= 12))),
    CONSTRAINT config_mensualidad_nivel_check CHECK ((nivel = ANY (ARRAY['Primaria'::text, 'Secundaria'::text, 'Inicial'::text])))
);


--
-- Name: TABLE config_mensualidad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_mensualidad IS 'Monto de mensualidad por nivel y mes. El director configura al inicio de cada gestión.';


--
-- Name: config_notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_notificaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo text NOT NULL,
    nombre_display text NOT NULL,
    plantilla text NOT NULL,
    umbral_faltas integer DEFAULT 3,
    activo boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    colegio_id uuid NOT NULL
);


--
-- Name: TABLE config_notificaciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_notificaciones IS 'Plantillas Telegram editables. Reemplaza constantes hardcodeadas en JS.';


--
-- Name: config_preguntas_docente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_preguntas_docente (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "año" integer NOT NULL,
    texto text NOT NULL,
    escala_min integer DEFAULT 1 NOT NULL,
    escala_max integer DEFAULT 4 NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    colegio_id uuid NOT NULL
);


--
-- Name: TABLE config_preguntas_docente; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_preguntas_docente IS 'Preguntas dinámicas. Reemplaza columnas p1..p8 fijas.';


--
-- Name: config_subcriterios_ser; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_subcriterios_ser (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    categoria_id uuid NOT NULL,
    "año" integer NOT NULL,
    texto text NOT NULL,
    descripcion text,
    orden integer DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    colegio_id uuid NOT NULL
);


--
-- Name: TABLE config_subcriterios_ser; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.config_subcriterios_ser IS 'Subcriterios dinámicos. Reemplaza s1..s10 fijos en SQL y JS.';


--
-- Name: cursos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cursos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid,
    nivel text NOT NULL,
    grado integer NOT NULL,
    paralelo text NOT NULL,
    nombre_completo text GENERATED ALWAYS AS ((((((grado)::text || '° '::text) || nivel) || ' '::text) || paralelo)) STORED,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tutor_profesor_id uuid,
    CONSTRAINT cursos_grado_check CHECK (((grado >= 1) AND (grado <= 6))),
    CONSTRAINT cursos_nivel_check CHECK ((nivel = ANY (ARRAY['Primaria'::text, 'Secundaria'::text])))
);


--
-- Name: TABLE cursos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cursos IS '36 cursos base: Primaria/Secundaria × 6 grados × 3 paralelos';


--
-- Name: entregas_tareas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entregas_tareas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actividad_id uuid,
    estudiante_id uuid NOT NULL,
    archivo_url text NOT NULL,
    archivo_nombre text NOT NULL,
    archivo_tipo text,
    tamano_bytes bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    materia_id uuid,
    trimestre integer
);


--
-- Name: TABLE entregas_tareas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.entregas_tareas IS 'Archivos subidos por estudiantes como entrega de actividades.
   Un estudiante puede tener una sola entrega por actividad (se reemplaza).';


--
-- Name: estudiantes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estudiantes (
    id uuid NOT NULL,
    carnet text NOT NULL,
    curso_id uuid,
    colegio_id uuid,
    fecha_nacimiento date,
    direccion text,
    nombre_tutor text,
    telefono_tutor text,
    email_tutor text,
    foto_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    estado text DEFAULT 'activo'::text NOT NULL,
    foto_subida_por uuid,
    foto_subida_at timestamp with time zone,
    foto_anterior text,
    rude text,
    CONSTRAINT estudiantes_estado_check CHECK ((estado = ANY (ARRAY['activo'::text, 'egresado'::text, 'retirado'::text]))),
    CONSTRAINT estudiantes_rude_formato_check CHECK (((rude IS NULL) OR (rude ~ '^[A-Za-z0-9]{8,30}$'::text)))
);


--
-- Name: TABLE estudiantes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.estudiantes IS 'Datos complementarios del estudiante, vinculados a usuarios.';


--
-- Name: COLUMN estudiantes.rude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estudiantes.rude IS 'Código RUDE del SIE. Opcional; único por colegio.';


--
-- Name: evaluaciones_docente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluaciones_docente (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "año" integer NOT NULL,
    activa boolean DEFAULT false NOT NULL,
    activada_por uuid,
    fecha_apertura timestamp with time zone DEFAULT now(),
    fecha_cierre timestamp with time zone,
    colegio_id uuid NOT NULL
);


--
-- Name: fichas_seguimiento_ser; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fichas_seguimiento_ser (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    curso_id uuid,
    profesor_id uuid NOT NULL,
    trimestre integer NOT NULL,
    "año" integer DEFAULT EXTRACT(year FROM now()) NOT NULL,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    valores jsonb DEFAULT '{}'::jsonb NOT NULL,
    observaciones jsonb DEFAULT '{}'::jsonb NOT NULL,
    obs_general text,
    nota_calculada numeric(5,2) NOT NULL,
    publicada boolean DEFAULT false NOT NULL,
    fecha_publicacion timestamp with time zone,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE fichas_seguimiento_ser; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fichas_seguimiento_ser IS 'Ficha SER con subcriterios dinámicos en JSONB. Sin columnas s1..s10 fijas.';


--
-- Name: gestion_activa; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gestion_activa WITH (security_invoker='true') AS
 SELECT id,
    "año",
    estado,
    cantidad_periodos,
    nombre_periodo,
    nota_minima_aprobacion,
    escala_maxima,
    etiqueta_aprobado,
    etiqueta_reprobado,
    activado_por,
    fecha_apertura,
    fecha_cierre,
    created_at
   FROM public.config_gestion
  WHERE (estado = 'activo'::text)
 LIMIT 1;


--
-- Name: historial_promociones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_promociones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    colegio_id uuid NOT NULL,
    "año" integer NOT NULL,
    accion text NOT NULL,
    curso_anterior_id uuid,
    estado_anterior text,
    realizado_por uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT historial_promociones_accion_check CHECK ((accion = ANY (ARRAY['promocion'::text, 'egreso'::text])))
);


--
-- Name: inscripciones_tecnicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inscripciones_tecnicas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    materia_id uuid NOT NULL,
    curso_id uuid,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    inscrito_por uuid
);


--
-- Name: intentos_busqueda_carnet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intentos_busqueda_carnet (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: licencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licencias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    motivo text NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_fin date NOT NULL,
    descripcion text NOT NULL,
    comprobante text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    motivo_respuesta text,
    nota_respuesta text,
    resuelto_por uuid,
    resuelto_en timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT licencias_check CHECK ((fecha_fin >= fecha_inicio)),
    CONSTRAINT licencias_descripcion_check CHECK (((char_length(descripcion) >= 5) AND (char_length(descripcion) <= 300))),
    CONSTRAINT licencias_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'cancelada'::text]))),
    CONSTRAINT licencias_motivo_check CHECK ((motivo = ANY (ARRAY['emergencia'::text, 'salud'::text, 'viaje'::text, 'academico'::text, 'otro'::text]))),
    CONSTRAINT licencias_motivo_respuesta_check CHECK (((motivo_respuesta IS NULL) OR (motivo_respuesta = ANY (ARRAY['comprobante_ilegible'::text, 'fuera_de_plazo'::text, 'falta_comprobante'::text, 'limite_mes'::text, 'presentarse_direccion'::text, 'otro'::text])))),
    CONSTRAINT licencias_nota_respuesta_check CHECK (((nota_respuesta IS NULL) OR (char_length(nota_respuesta) <= 200)))
);


--
-- Name: notas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actividad_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    valor numeric(5,2) NOT NULL,
    creado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    observaciones text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id uuid NOT NULL,
    rol text NOT NULL,
    nombre_completo text NOT NULL,
    email text NOT NULL,
    telefono text,
    foto_url text,
    activo boolean DEFAULT true NOT NULL,
    colegio_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usuarios_rol_check CHECK ((rol = ANY (ARRAY['director'::text, 'profesor'::text, 'estudiante'::text, 'secretaria'::text, 'tutor'::text, 'superadmin'::text, 'regente'::text])))
);


--
-- Name: TABLE usuarios; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.usuarios IS 'Perfil educativo de cada usuario. Sincronizado con auth.users via trigger.';


--
-- Name: notas_finales; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.notas_finales WITH (security_invoker='true') AS
 SELECT e.id AS estudiante_id,
    e.carnet,
    u.nombre_completo AS estudiante,
    m.id AS materia_id,
    m.nombre AS materia,
    t.periodo AS trimestre,
    e.colegio_id,
    ( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer'::text) AND ((m.es_tecnica IS NOT TRUE) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                   FROM public.inscripciones_tecnicas it
                  WHERE ((it.estudiante_id = e.id) AND (it.materia_id = m.id) AND (it.activo = true)))))))) AS promedio_hacer,
    ( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber'::text) AND ((m.es_tecnica IS NOT TRUE) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                   FROM public.inscripciones_tecnicas it
                  WHERE ((it.estudiante_id = e.id) AND (it.materia_id = m.id) AND (it.activo = true)))))))) AS promedio_saber,
    c.nota_ser,
    c.nota_decidir,
    (((COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer'::text) AND ((m.es_tecnica IS NOT TRUE) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                   FROM public.inscripciones_tecnicas it
                  WHERE ((it.estudiante_id = e.id) AND (it.materia_id = m.id) AND (it.activo = true)))))))), (0)::numeric) + COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
           FROM ((public.actividades a
             JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
             JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
          WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber'::text) AND ((m.es_tecnica IS NOT TRUE) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                   FROM public.inscripciones_tecnicas it
                  WHERE ((it.estudiante_id = e.id) AND (it.materia_id = m.id) AND (it.activo = true)))))))), (0)::numeric)) + COALESCE(c.nota_ser, (0)::numeric)) + COALESCE(c.nota_decidir, (0)::numeric)) AS nota_final,
        CASE
            WHEN (round((((COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
               FROM ((public.actividades a
                 JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
                 JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
              WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'hacer'::text) AND ((m.es_tecnica IS NOT TRUE) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                       FROM public.inscripciones_tecnicas it
                      WHERE ((it.estudiante_id = e.id) AND (it.materia_id = m.id) AND (it.activo = true)))))))), (0)::numeric) + COALESCE(( SELECT round(avg((((n.valor)::numeric / NULLIF(a.max_puntos, (0)::numeric)) * d.peso_maximo)), 2) AS round
               FROM ((public.actividades a
                 JOIN public.notas n ON (((n.actividad_id = a.id) AND (n.estudiante_id = e.id))))
                 JOIN public.config_dimensiones d ON (((d.codigo = a.tipo) AND (d."año" = (EXTRACT(year FROM now()))::integer) AND (d.colegio_id = e.colegio_id))))
              WHERE ((a.materia_id = m.id) AND (a.trimestre = t.periodo) AND (a.tipo = 'saber'::text) AND ((m.es_tecnica IS NOT TRUE) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                       FROM public.inscripciones_tecnicas it
                      WHERE ((it.estudiante_id = e.id) AND (it.materia_id = m.id) AND (it.activo = true)))))))), (0)::numeric)) + COALESCE(c.nota_ser, (0)::numeric)) + COALESCE(c.nota_decidir, (0)::numeric)), 0) >= ( SELECT gestion_activa.nota_minima_aprobacion
               FROM public.gestion_activa
             LIMIT 1)) THEN ( SELECT gestion_activa.etiqueta_aprobado
               FROM public.gestion_activa
             LIMIT 1)
            ELSE ( SELECT gestion_activa.etiqueta_reprobado
               FROM public.gestion_activa
             LIMIT 1)
        END AS estado,
    cu.id AS curso_id,
    cu.nombre_completo AS curso,
    cu.nivel
   FROM (((((public.estudiantes e
     JOIN public.usuarios u ON ((u.id = e.id)))
     JOIN public.cursos cu ON ((cu.id = e.curso_id)))
     CROSS JOIN LATERAL ( SELECT materias.id,
            materias.colegio_id,
            materias.nombre,
            materias.nivel,
            materias.campo_saberes,
            materias.es_tecnica,
            materias.aplica_desde,
            materias.activo,
            materias.created_at
           FROM public.materias
          WHERE ((materias.activo = true) AND (materias.nivel = cu.nivel) AND (materias.colegio_id = e.colegio_id))) m)
     CROSS JOIN ( SELECT generate_series.generate_series AS periodo
           FROM generate_series(1, ( SELECT COALESCE(gestion_activa.cantidad_periodos, 3) AS "coalesce"
                   FROM public.gestion_activa
                 LIMIT 1)) generate_series(generate_series)) t)
     LEFT JOIN public.calificaciones c ON (((c.estudiante_id = e.id) AND (c.materia_id = m.id) AND (c.trimestre = t.periodo))));


--
-- Name: notificaciones_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid,
    tipo text NOT NULL,
    mensaje text NOT NULL,
    chat_id bigint,
    enviado boolean DEFAULT false NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: novedades_asistencia_dia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.novedades_asistencia_dia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    curso_id uuid NOT NULL,
    colegio_id uuid NOT NULL,
    fecha date NOT NULL,
    tipo text NOT NULL,
    observaciones text,
    registrado_por uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT novedades_asistencia_dia_fecha_no_futura CHECK ((fecha <= CURRENT_DATE)),
    CONSTRAINT novedades_asistencia_dia_tipo_check CHECK ((tipo = ANY (ARRAY['en_direccion'::text, 'no_ingreso'::text])))
);


--
-- Name: TABLE novedades_asistencia_dia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.novedades_asistencia_dia IS 'Novedad institucional del día (en dirección / no ingresó). Independiente de la asistencia por materia del profesor.';


--
-- Name: pagos_mensualidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos_mensualidad (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    tutor_id uuid,
    colegio_id uuid NOT NULL,
    "año" integer NOT NULL,
    mes integer NOT NULL,
    monto_bs numeric(8,2) NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    comprobante_url text,
    comprobante_nombre text,
    observacion_tutor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    numero_transaccion text,
    monto_declarado numeric,
    nombre_pagador text,
    registrado_por uuid,
    CONSTRAINT pagos_mensualidad_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'en_revision'::text, 'aprobado'::text, 'rechazado'::text]))),
    CONSTRAINT pagos_mensualidad_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);


--
-- Name: TABLE pagos_mensualidad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pagos_mensualidad IS 'Un registro por estudiante por mes. Varios registros pueden compartir comprobante_url si el tutor pagó varios hijos juntos.';


--
-- Name: permisos_usuario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permisos_usuario (
    usuario_id uuid NOT NULL,
    colegio_id uuid NOT NULL,
    permiso text NOT NULL,
    otorgado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permisos_usuario_permiso_check CHECK ((permiso = ANY (ARRAY['licencias.aprobar'::text, 'vinculos.revisar'::text])))
);


--
-- Name: porteria_alertas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porteria_alertas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    fecha date NOT NULL,
    tipo text NOT NULL,
    registro_id uuid,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    justificacion text,
    justificado_por uuid,
    justificado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT porteria_alertas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'justificada'::text]))),
    CONSTRAINT porteria_alertas_tipo_check CHECK ((tipo = ANY (ARRAY['atraso'::text, 'salida_anticipada'::text, 'exceso_salidas'::text, 'duplicado'::text, 'posible_fuga'::text, 'inconsistencia'::text])))
);


--
-- Name: porteria_horarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porteria_horarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    turno text NOT NULL,
    nivel text NOT NULL,
    hora_entrada time without time zone NOT NULL,
    tolerancia_min integer DEFAULT 10 NOT NULL,
    hora_salida time without time zone NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    CONSTRAINT porteria_horarios_check CHECK ((hora_salida > hora_entrada)),
    CONSTRAINT porteria_horarios_tolerancia_min_check CHECK (((tolerancia_min >= 0) AND (tolerancia_min <= 120))),
    CONSTRAINT porteria_horarios_turno_check CHECK ((turno = ANY (ARRAY['manana'::text, 'tarde'::text, 'noche'::text])))
);


--
-- Name: porteria_horarios_grado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porteria_horarios_grado (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    turno text NOT NULL,
    nivel text NOT NULL,
    hora_entrada time without time zone NOT NULL,
    tolerancia_min integer DEFAULT 10 NOT NULL,
    hora_salida time without time zone NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    grado integer NOT NULL,
    CONSTRAINT porteria_horarios_grado_check CHECK ((hora_salida > hora_entrada)),
    CONSTRAINT porteria_horarios_grado_grado_check CHECK (((grado >= 1) AND (grado <= 6))),
    CONSTRAINT porteria_horarios_grado_tolerancia_min_check CHECK (((tolerancia_min >= 0) AND (tolerancia_min <= 120))),
    CONSTRAINT porteria_horarios_grado_turno_check CHECK ((turno = ANY (ARRAY['manana'::text, 'tarde'::text, 'noche'::text])))
);


--
-- Name: porteria_qr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porteria_qr (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    codigo text DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    anulado_at timestamp with time zone
);


--
-- Name: respuestas_evaluacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.respuestas_evaluacion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    evaluacion_id uuid NOT NULL,
    profesor_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    respuestas jsonb DEFAULT '{}'::jsonb NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE respuestas_evaluacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.respuestas_evaluacion IS 'Sin columnas p1..p8 fijas. Las preguntas son dinámicas en JSONB.';


--
-- Name: revisiones_pago; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revisiones_pago (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pago_id uuid NOT NULL,
    revisado_por uuid NOT NULL,
    accion text NOT NULL,
    observacion text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revisiones_pago_accion_check CHECK ((accion = ANY (ARRAY['aprobado'::text, 'rechazado'::text])))
);


--
-- Name: TABLE revisiones_pago; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.revisiones_pago IS 'Auditoría de revisiones de la secretaria. Trazabilidad completa de aprobaciones y rechazos.';


--
-- Name: rubrica_calificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rubrica_calificaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nota_id uuid NOT NULL,
    criterio_id uuid NOT NULL,
    puntos_obtenidos numeric NOT NULL
);


--
-- Name: rubrica_criterios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rubrica_criterios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actividad_id uuid NOT NULL,
    nombre text NOT NULL,
    descripcion text,
    puntos_max numeric NOT NULL,
    porcentaje numeric NOT NULL,
    niveles jsonb NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rubrica_criterios_porcentaje_check CHECK (((porcentaje > (0)::numeric) AND (porcentaje <= (100)::numeric)))
);


--
-- Name: rubrica_plantillas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rubrica_plantillas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colegio_id uuid,
    tipo text NOT NULL,
    nombre text NOT NULL,
    criterios jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rubrica_plantillas_tipo_check CHECK ((tipo = ANY (ARRAY['hacer'::text, 'saber'::text])))
);


--
-- Name: tareas_vistas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tareas_vistas (
    estudiante_id uuid NOT NULL,
    actividad_id uuid NOT NULL,
    tipo text NOT NULL,
    visto_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tareas_vistas_tipo_check CHECK ((tipo = ANY (ARRAY['actividad'::text, 'nota'::text])))
);


--
-- Name: telegram_vinculos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_vinculos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estudiante_id uuid NOT NULL,
    codigo_vinculacion text NOT NULL,
    chat_id bigint,
    tipo_usuario text,
    vinculado boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    vinculado_at timestamp with time zone,
    CONSTRAINT telegram_vinculos_tipo_usuario_check CHECK ((tipo_usuario = ANY (ARRAY['estudiante'::text, 'padre'::text, 'madre'::text, 'tutor'::text])))
);


--
-- Name: tutor_estudiante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_estudiante (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    estudiante_id uuid NOT NULL,
    parentesco text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_estudiante_parentesco_check CHECK ((parentesco = ANY (ARRAY['padre'::text, 'madre'::text, 'tutor_legal'::text, 'otro'::text, 'abuelo'::text, 'abuela'::text, 'tio'::text, 'tia'::text, 'hermano'::text, 'hermana'::text])))
);


--
-- Name: TABLE tutor_estudiante; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_estudiante IS 'Vinculación tutor ↔ estudiante. El tutor ingresa el carnet del hijo para vincular.';


--
-- Name: tutor_verificacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_verificacion (
    tutor_id uuid NOT NULL,
    parentesco text NOT NULL,
    ci_anverso text,
    ci_reverso text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    revisado_por uuid,
    revisado_en timestamp with time zone,
    motivo_rechazo text,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_verificacion_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'revisado'::text, 'rechazado'::text]))),
    CONSTRAINT tutor_verificacion_nota_check CHECK (((nota IS NULL) OR (char_length(nota) <= 200))),
    CONSTRAINT tutor_verificacion_parentesco_check CHECK ((parentesco = ANY (ARRAY['padre'::text, 'madre'::text, 'tutor_legal'::text, 'otro'::text, 'abuelo'::text, 'abuela'::text, 'tio'::text, 'tia'::text, 'hermano'::text, 'hermana'::text])))
);


--
-- Name: tutores_familia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutores_familia (
    id uuid NOT NULL,
    colegio_id uuid,
    carnet text,
    telefono text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tutores_familia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutores_familia IS 'Perfil extendido del padre/tutor. Usuario base en public.usuarios con rol tutor.';


--
-- Name: tutoriales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutoriales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rol text NOT NULL,
    titulo text NOT NULL,
    aprenderas jsonb DEFAULT '[]'::jsonb NOT NULL,
    secciones jsonb DEFAULT '[]'::jsonb NOT NULL,
    videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    publicado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutoriales_aprenderas_check CHECK (((jsonb_typeof(aprenderas) = 'array'::text) AND (jsonb_array_length(aprenderas) <= 20))),
    CONSTRAINT tutoriales_orden_check CHECK ((orden >= 0)),
    CONSTRAINT tutoriales_rol_check CHECK ((rol = ANY (ARRAY['director'::text, 'profesor'::text, 'estudiante'::text, 'tutor'::text, 'secretaria'::text, 'regente'::text]))),
    CONSTRAINT tutoriales_secciones_check CHECK (((jsonb_typeof(secciones) = 'array'::text) AND (jsonb_array_length(secciones) <= 60) AND (octet_length((secciones)::text) <= 262144))),
    CONSTRAINT tutoriales_titulo_check CHECK (((char_length(btrim(titulo)) >= 3) AND (char_length(btrim(titulo)) <= 200))),
    CONSTRAINT tutoriales_videos_check CHECK (public.tutoriales_videos_validos(videos))
);


--
-- Name: actividades actividades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actividades
    ADD CONSTRAINT actividades_pkey PRIMARY KEY (id);


--
-- Name: asesor_curso asesor_curso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_curso
    ADD CONSTRAINT asesor_curso_pkey PRIMARY KEY (id);


--
-- Name: asignaciones_profesor asignaciones_profesor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones_profesor
    ADD CONSTRAINT asignaciones_profesor_pkey PRIMARY KEY (id);


--
-- Name: asignaciones_profesor asignaciones_profesor_profesor_id_materia_id_curso_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones_profesor
    ADD CONSTRAINT asignaciones_profesor_profesor_id_materia_id_curso_id_key UNIQUE (profesor_id, materia_id, curso_id);


--
-- Name: asistencia_porteria asistencia_porteria_client_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencia_porteria
    ADD CONSTRAINT asistencia_porteria_client_uuid_key UNIQUE (client_uuid);


--
-- Name: asistencia_porteria asistencia_porteria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencia_porteria
    ADD CONSTRAINT asistencia_porteria_pkey PRIMARY KEY (id);


--
-- Name: asistencia_qr_llamadas asistencia_qr_llamadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencia_qr_llamadas
    ADD CONSTRAINT asistencia_qr_llamadas_pkey PRIMARY KEY (id);


--
-- Name: asistencias asistencias_estudiante_id_fecha_sesion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_estudiante_id_fecha_sesion_key UNIQUE (estudiante_id, fecha, sesion);


--
-- Name: asistencias_materia asistencias_materia_estudiante_id_fecha_sesion_profesor_id__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias_materia
    ADD CONSTRAINT asistencias_materia_estudiante_id_fecha_sesion_profesor_id__key UNIQUE (estudiante_id, fecha, sesion, profesor_id, materia_id);


--
-- Name: asistencias_materia asistencias_materia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias_materia
    ADD CONSTRAINT asistencias_materia_pkey PRIMARY KEY (id);


--
-- Name: asistencias asistencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: becas_estudiante becas_estudiante_estudiante_id_año_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.becas_estudiante
    ADD CONSTRAINT "becas_estudiante_estudiante_id_año_key" UNIQUE (estudiante_id, "año");


--
-- Name: becas_estudiante becas_estudiante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.becas_estudiante
    ADD CONSTRAINT becas_estudiante_pkey PRIMARY KEY (id);


--
-- Name: bitacora_docente bitacora_docente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_docente
    ADD CONSTRAINT bitacora_docente_pkey PRIMARY KEY (id);


--
-- Name: bitacora_docente bitacora_docente_profesor_id_curso_id_materia_id_fecha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_docente
    ADD CONSTRAINT bitacora_docente_profesor_id_curso_id_materia_id_fecha_key UNIQUE (profesor_id, curso_id, materia_id, fecha);


--
-- Name: calificaciones calificaciones_estudiante_id_materia_id_trimestre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calificaciones
    ADD CONSTRAINT calificaciones_estudiante_id_materia_id_trimestre_key UNIQUE (estudiante_id, materia_id, trimestre);


--
-- Name: calificaciones calificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calificaciones
    ADD CONSTRAINT calificaciones_pkey PRIMARY KEY (id);


--
-- Name: colegios colegios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colegios
    ADD CONSTRAINT colegios_pkey PRIMARY KEY (id);


--
-- Name: comunicados_estudiante comunicados_estudiante_comunicado_id_estudiante_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_estudiante
    ADD CONSTRAINT comunicados_estudiante_comunicado_id_estudiante_id_key UNIQUE (comunicado_id, estudiante_id);


--
-- Name: comunicados_estudiante comunicados_estudiante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_estudiante
    ADD CONSTRAINT comunicados_estudiante_pkey PRIMARY KEY (id);


--
-- Name: comunicados_lectura_tutor comunicados_lectura_tutor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_lectura_tutor
    ADD CONSTRAINT comunicados_lectura_tutor_pkey PRIMARY KEY (comunicado_estudiante_id, tutor_id);


--
-- Name: comunicados comunicados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados
    ADD CONSTRAINT comunicados_pkey PRIMARY KEY (id);


--
-- Name: config_categorias_ser config_categorias_ser_año_nombre_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_categorias_ser
    ADD CONSTRAINT "config_categorias_ser_año_nombre_colegio_key" UNIQUE ("año", nombre, colegio_id);


--
-- Name: config_categorias_ser config_categorias_ser_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_categorias_ser
    ADD CONSTRAINT config_categorias_ser_pkey PRIMARY KEY (id);


--
-- Name: config_dimensiones config_dimensiones_gestion_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_dimensiones
    ADD CONSTRAINT config_dimensiones_gestion_id_codigo_key UNIQUE (gestion_id, codigo);


--
-- Name: config_dimensiones config_dimensiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_dimensiones
    ADD CONSTRAINT config_dimensiones_pkey PRIMARY KEY (id);


--
-- Name: config_escala_ser config_escala_ser_año_valor_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_escala_ser
    ADD CONSTRAINT "config_escala_ser_año_valor_colegio_key" UNIQUE ("año", valor_numerico, colegio_id);


--
-- Name: config_escala_ser config_escala_ser_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_escala_ser
    ADD CONSTRAINT config_escala_ser_pkey PRIMARY KEY (id);


--
-- Name: config_gestion config_gestion_año_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_gestion
    ADD CONSTRAINT "config_gestion_año_colegio_key" UNIQUE ("año", colegio_id);


--
-- Name: config_gestion config_gestion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_gestion
    ADD CONSTRAINT config_gestion_pkey PRIMARY KEY (id);


--
-- Name: config_mensualidad config_mensualidad_colegio_id_año_nivel_mes_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_mensualidad
    ADD CONSTRAINT "config_mensualidad_colegio_id_año_nivel_mes_key" UNIQUE (colegio_id, "año", nivel, mes);


--
-- Name: config_mensualidad config_mensualidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_mensualidad
    ADD CONSTRAINT config_mensualidad_pkey PRIMARY KEY (id);


--
-- Name: config_notificaciones config_notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_notificaciones
    ADD CONSTRAINT config_notificaciones_pkey PRIMARY KEY (id);


--
-- Name: config_notificaciones config_notificaciones_tipo_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_notificaciones
    ADD CONSTRAINT config_notificaciones_tipo_colegio_key UNIQUE (tipo, colegio_id);


--
-- Name: config_preguntas_docente config_preguntas_docente_año_orden_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_preguntas_docente
    ADD CONSTRAINT "config_preguntas_docente_año_orden_colegio_key" UNIQUE ("año", orden, colegio_id);


--
-- Name: config_preguntas_docente config_preguntas_docente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_preguntas_docente
    ADD CONSTRAINT config_preguntas_docente_pkey PRIMARY KEY (id);


--
-- Name: config_subcriterios_ser config_subcriterios_ser_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_subcriterios_ser
    ADD CONSTRAINT config_subcriterios_ser_pkey PRIMARY KEY (id);


--
-- Name: cursos cursos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cursos
    ADD CONSTRAINT cursos_pkey PRIMARY KEY (id);


--
-- Name: entregas_tareas entregas_tareas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entregas_tareas
    ADD CONSTRAINT entregas_tareas_pkey PRIMARY KEY (id);


--
-- Name: estudiantes estudiantes_carnet_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estudiantes
    ADD CONSTRAINT estudiantes_carnet_colegio_key UNIQUE (carnet, colegio_id);


--
-- Name: estudiantes estudiantes_nombre_tutor_formato_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.estudiantes
    ADD CONSTRAINT estudiantes_nombre_tutor_formato_check CHECK (((nombre_tutor IS NULL) OR (nombre_tutor ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü''\-\s]+$'::text))) NOT VALID;


--
-- Name: estudiantes estudiantes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estudiantes
    ADD CONSTRAINT estudiantes_pkey PRIMARY KEY (id);


--
-- Name: estudiantes estudiantes_telefono_tutor_formato_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.estudiantes
    ADD CONSTRAINT estudiantes_telefono_tutor_formato_check CHECK (((telefono_tutor IS NULL) OR (telefono_tutor ~ '^\+?[0-9]{7,15}$'::text))) NOT VALID;


--
-- Name: evaluaciones_docente evaluaciones_docente_año_colegio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluaciones_docente
    ADD CONSTRAINT "evaluaciones_docente_año_colegio_key" UNIQUE ("año", colegio_id);


--
-- Name: evaluaciones_docente evaluaciones_docente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluaciones_docente
    ADD CONSTRAINT evaluaciones_docente_pkey PRIMARY KEY (id);


--
-- Name: fichas_seguimiento_ser fichas_seguimiento_ser_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_seguimiento_ser
    ADD CONSTRAINT fichas_seguimiento_ser_pkey PRIMARY KEY (id);


--
-- Name: historial_promociones historial_promociones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_promociones
    ADD CONSTRAINT historial_promociones_pkey PRIMARY KEY (id);


--
-- Name: inscripciones_tecnicas inscripciones_tecnicas_estudiante_id_materia_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscripciones_tecnicas
    ADD CONSTRAINT inscripciones_tecnicas_estudiante_id_materia_id_key UNIQUE (estudiante_id, materia_id);


--
-- Name: inscripciones_tecnicas inscripciones_tecnicas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscripciones_tecnicas
    ADD CONSTRAINT inscripciones_tecnicas_pkey PRIMARY KEY (id);


--
-- Name: intentos_busqueda_carnet intentos_busqueda_carnet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intentos_busqueda_carnet
    ADD CONSTRAINT intentos_busqueda_carnet_pkey PRIMARY KEY (id);


--
-- Name: licencias licencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licencias
    ADD CONSTRAINT licencias_pkey PRIMARY KEY (id);


--
-- Name: materias materias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materias
    ADD CONSTRAINT materias_pkey PRIMARY KEY (id);


--
-- Name: notas notas_actividad_id_estudiante_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas
    ADD CONSTRAINT notas_actividad_id_estudiante_id_key UNIQUE (actividad_id, estudiante_id);


--
-- Name: notas notas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas
    ADD CONSTRAINT notas_pkey PRIMARY KEY (id);


--
-- Name: notificaciones_log notificaciones_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones_log
    ADD CONSTRAINT notificaciones_log_pkey PRIMARY KEY (id);


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_estudiante_id_fecha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.novedades_asistencia_dia
    ADD CONSTRAINT novedades_asistencia_dia_estudiante_id_fecha_key UNIQUE (estudiante_id, fecha);


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.novedades_asistencia_dia
    ADD CONSTRAINT novedades_asistencia_dia_pkey PRIMARY KEY (id);


--
-- Name: pagos_mensualidad pagos_mensualidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_mensualidad
    ADD CONSTRAINT pagos_mensualidad_pkey PRIMARY KEY (id);


--
-- Name: permisos_usuario permisos_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permisos_usuario
    ADD CONSTRAINT permisos_usuario_pkey PRIMARY KEY (usuario_id, permiso);


--
-- Name: porteria_alertas porteria_alertas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_alertas
    ADD CONSTRAINT porteria_alertas_pkey PRIMARY KEY (id);


--
-- Name: porteria_horarios porteria_horarios_colegio_id_turno_nivel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_horarios
    ADD CONSTRAINT porteria_horarios_colegio_id_turno_nivel_key UNIQUE (colegio_id, turno, nivel);


--
-- Name: porteria_horarios_grado porteria_horarios_grado_colegio_id_turno_nivel_grado_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_horarios_grado
    ADD CONSTRAINT porteria_horarios_grado_colegio_id_turno_nivel_grado_key UNIQUE (colegio_id, turno, nivel, grado);


--
-- Name: porteria_horarios_grado porteria_horarios_grado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_horarios_grado
    ADD CONSTRAINT porteria_horarios_grado_pkey PRIMARY KEY (id);


--
-- Name: porteria_horarios porteria_horarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_horarios
    ADD CONSTRAINT porteria_horarios_pkey PRIMARY KEY (id);


--
-- Name: porteria_qr porteria_qr_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_qr
    ADD CONSTRAINT porteria_qr_codigo_key UNIQUE (codigo);


--
-- Name: porteria_qr porteria_qr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_qr
    ADD CONSTRAINT porteria_qr_pkey PRIMARY KEY (id);


--
-- Name: respuestas_evaluacion respuestas_evaluacion_evaluacion_id_profesor_id_estudiante__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.respuestas_evaluacion
    ADD CONSTRAINT respuestas_evaluacion_evaluacion_id_profesor_id_estudiante__key UNIQUE (evaluacion_id, profesor_id, estudiante_id);


--
-- Name: respuestas_evaluacion respuestas_evaluacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.respuestas_evaluacion
    ADD CONSTRAINT respuestas_evaluacion_pkey PRIMARY KEY (id);


--
-- Name: revisiones_pago revisiones_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revisiones_pago
    ADD CONSTRAINT revisiones_pago_pkey PRIMARY KEY (id);


--
-- Name: rubrica_calificaciones rubrica_calificaciones_nota_id_criterio_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_calificaciones
    ADD CONSTRAINT rubrica_calificaciones_nota_id_criterio_id_key UNIQUE (nota_id, criterio_id);


--
-- Name: rubrica_calificaciones rubrica_calificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_calificaciones
    ADD CONSTRAINT rubrica_calificaciones_pkey PRIMARY KEY (id);


--
-- Name: rubrica_criterios rubrica_criterios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_criterios
    ADD CONSTRAINT rubrica_criterios_pkey PRIMARY KEY (id);


--
-- Name: rubrica_plantillas rubrica_plantillas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_plantillas
    ADD CONSTRAINT rubrica_plantillas_pkey PRIMARY KEY (id);


--
-- Name: tareas_vistas tareas_vistas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas_vistas
    ADD CONSTRAINT tareas_vistas_pkey PRIMARY KEY (estudiante_id, actividad_id, tipo);


--
-- Name: telegram_vinculos telegram_vinculos_codigo_vinculacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_vinculos
    ADD CONSTRAINT telegram_vinculos_codigo_vinculacion_key UNIQUE (codigo_vinculacion);


--
-- Name: telegram_vinculos telegram_vinculos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_vinculos
    ADD CONSTRAINT telegram_vinculos_pkey PRIMARY KEY (id);


--
-- Name: tutor_estudiante tutor_estudiante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_estudiante
    ADD CONSTRAINT tutor_estudiante_pkey PRIMARY KEY (id);


--
-- Name: tutor_estudiante tutor_estudiante_tutor_id_estudiante_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_estudiante
    ADD CONSTRAINT tutor_estudiante_tutor_id_estudiante_id_key UNIQUE (tutor_id, estudiante_id);


--
-- Name: tutor_verificacion tutor_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_verificacion
    ADD CONSTRAINT tutor_verificacion_pkey PRIMARY KEY (tutor_id);


--
-- Name: tutores_familia tutores_familia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutores_familia
    ADD CONSTRAINT tutores_familia_pkey PRIMARY KEY (id);


--
-- Name: tutores_familia tutores_familia_telefono_formato_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.tutores_familia
    ADD CONSTRAINT tutores_familia_telefono_formato_check CHECK (((telefono IS NULL) OR (telefono ~ '^\+?[0-9]{7,15}$'::text))) NOT VALID;


--
-- Name: tutoriales tutoriales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutoriales
    ADD CONSTRAINT tutoriales_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_formato_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_email_formato_check CHECK ((email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'::text)) NOT VALID;


--
-- Name: usuarios usuarios_nombre_formato_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_nombre_formato_check CHECK ((nombre_completo ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ''\-\s]+$'::text)) NOT VALID;


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_telefono_formato_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_telefono_formato_check CHECK (((telefono IS NULL) OR (telefono ~ '^\+?[0-9]{7,15}$'::text))) NOT VALID;


--
-- Name: asesor_curso_colegio_año_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "asesor_curso_colegio_año_idx" ON public.asesor_curso USING btree (colegio_id, "año");


--
-- Name: asesor_curso_curso_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asesor_curso_curso_idx ON public.asesor_curso USING btree (curso_id, "año");


--
-- Name: asesor_curso_profesor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asesor_curso_profesor_idx ON public.asesor_curso USING btree (profesor_id, "año");


--
-- Name: asesor_curso_un_curso_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asesor_curso_un_curso_activo ON public.asesor_curso USING btree (curso_id, "año") WHERE (activo = true);


--
-- Name: asesor_curso_un_profesor_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asesor_curso_un_profesor_activo ON public.asesor_curso USING btree (profesor_id, "año") WHERE (activo = true);


--
-- Name: asistencia_porteria_colegio_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asistencia_porteria_colegio_fecha ON public.asistencia_porteria USING btree (colegio_id, fecha);


--
-- Name: asistencia_porteria_est_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asistencia_porteria_est_fecha ON public.asistencia_porteria USING btree (estudiante_id, fecha);


--
-- Name: colegios_dominio_correo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX colegios_dominio_correo_key ON public.colegios USING btree (dominio_correo) WHERE (dominio_correo IS NOT NULL);


--
-- Name: colegios_subdominio_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX colegios_subdominio_uq ON public.colegios USING btree (subdominio) WHERE (subdominio IS NOT NULL);


--
-- Name: entregas_tareas_est_act_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entregas_tareas_est_act_idx ON public.entregas_tareas USING btree (estudiante_id, actividad_id);


--
-- Name: estudiantes_rude_colegio_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX estudiantes_rude_colegio_key ON public.estudiantes USING btree (colegio_id, rude) WHERE (rude IS NOT NULL);


--
-- Name: idx_actividades_materia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actividades_materia ON public.actividades USING btree (materia_id, trimestre);


--
-- Name: idx_asignaciones_prof; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asignaciones_prof ON public.asignaciones_profesor USING btree (profesor_id) WHERE (activo = true);


--
-- Name: idx_asistencias_curso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asistencias_curso ON public.asistencias USING btree (curso_id, fecha);


--
-- Name: idx_asistencias_est; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asistencias_est ON public.asistencias USING btree (estudiante_id, fecha);


--
-- Name: idx_bitacora_docente_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bitacora_docente_colegio ON public.bitacora_docente USING btree (colegio_id);


--
-- Name: idx_calificaciones_est; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calificaciones_est ON public.calificaciones USING btree (estudiante_id, trimestre);


--
-- Name: idx_com_est_comunicado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_com_est_comunicado ON public.comunicados_estudiante USING btree (comunicado_id);


--
-- Name: idx_com_est_estudiante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_com_est_estudiante ON public.comunicados_estudiante USING btree (estudiante_id);


--
-- Name: idx_com_est_leido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_com_est_leido ON public.comunicados_estudiante USING btree (leido_at) WHERE (leido_at IS NULL);


--
-- Name: idx_com_lect_tutor_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_com_lect_tutor_colegio ON public.comunicados_lectura_tutor USING btree (colegio_id);


--
-- Name: idx_com_lect_tutor_tutor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_com_lect_tutor_tutor ON public.comunicados_lectura_tutor USING btree (tutor_id);


--
-- Name: idx_comunicados_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comunicados_colegio ON public.comunicados USING btree (colegio_id);


--
-- Name: idx_comunicados_emisor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comunicados_emisor ON public.comunicados USING btree (emisor_id);


--
-- Name: idx_cursos_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cursos_colegio ON public.cursos USING btree (colegio_id);


--
-- Name: idx_estudiantes_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estudiantes_colegio ON public.estudiantes USING btree (colegio_id);


--
-- Name: idx_fichas_publicadas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichas_publicadas ON public.fichas_seguimiento_ser USING btree (estudiante_id, materia_id, trimestre, "año") WHERE (publicada = true);


--
-- Name: idx_intentos_tutor_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intentos_tutor_fecha ON public.intentos_busqueda_carnet USING btree (tutor_id, created_at);


--
-- Name: idx_materias_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materias_colegio ON public.materias USING btree (colegio_id);


--
-- Name: idx_notas_actividad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_actividad ON public.notas USING btree (actividad_id);


--
-- Name: idx_notas_estudiante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_estudiante ON public.notas USING btree (estudiante_id);


--
-- Name: idx_pagos_mensualidad_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_mensualidad_colegio ON public.pagos_mensualidad USING btree (colegio_id);


--
-- Name: idx_qr_llamadas_prof_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_llamadas_prof_fecha ON public.asistencia_qr_llamadas USING btree (profesor_id, fecha);


--
-- Name: idx_tutores_familia_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutores_familia_colegio ON public.tutores_familia USING btree (colegio_id);


--
-- Name: idx_tutoriales_rol_orden; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutoriales_rol_orden ON public.tutoriales USING btree (rol, orden) WHERE (publicado = true);


--
-- Name: idx_usuarios_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_colegio ON public.usuarios USING btree (colegio_id);


--
-- Name: licencias_colegio_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX licencias_colegio_estado_idx ON public.licencias USING btree (colegio_id, estado);


--
-- Name: licencias_estudiante_fechas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX licencias_estudiante_fechas_idx ON public.licencias USING btree (estudiante_id, fecha_inicio, fecha_fin);


--
-- Name: licencias_una_pendiente_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX licencias_una_pendiente_idx ON public.licencias USING btree (estudiante_id) WHERE (estado = 'pendiente'::text);


--
-- Name: novedades_asistencia_dia_colegio_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX novedades_asistencia_dia_colegio_fecha_idx ON public.novedades_asistencia_dia USING btree (colegio_id, fecha);


--
-- Name: novedades_asistencia_dia_curso_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX novedades_asistencia_dia_curso_fecha_idx ON public.novedades_asistencia_dia USING btree (curso_id, fecha);


--
-- Name: pagos_mensualidad_mes_vigente_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pagos_mensualidad_mes_vigente_uq ON public.pagos_mensualidad USING btree (estudiante_id, "año", mes) WHERE (estado <> 'rechazado'::text);


--
-- Name: porteria_alertas_colegio_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX porteria_alertas_colegio_estado ON public.porteria_alertas USING btree (colegio_id, estado, fecha);


--
-- Name: porteria_qr_colegio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX porteria_qr_colegio ON public.porteria_qr USING btree (colegio_id);


--
-- Name: porteria_qr_un_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX porteria_qr_un_activo ON public.porteria_qr USING btree (estudiante_id) WHERE activo;


--
-- Name: usuarios_email_lower_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usuarios_email_lower_key ON public.usuarios USING btree (lower(email));


--
-- Name: actividades actividad_fecha_cambiada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER actividad_fecha_cambiada BEFORE UPDATE ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.trg_actividad_fecha_cambiada();


--
-- Name: entregas_tareas entregas_max_dos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER entregas_max_dos BEFORE INSERT ON public.entregas_tareas FOR EACH ROW EXECUTE FUNCTION public.entregas_max_dos();


--
-- Name: notas nota_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER nota_updated_at BEFORE UPDATE ON public.notas FOR EACH ROW EXECUTE FUNCTION public.trg_nota_updated_at();


--
-- Name: usuarios proteger_rol_superadmin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER proteger_rol_superadmin BEFORE INSERT OR UPDATE OF rol ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.proteger_rol_superadmin();


--
-- Name: fichas_seguimiento_ser set_actualizado_en_fichas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_actualizado_en_fichas BEFORE UPDATE ON public.fichas_seguimiento_ser FOR EACH ROW EXECUTE FUNCTION public.set_actualizado_en();


--
-- Name: asesor_curso set_updated_at_asesor_curso; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_asesor_curso BEFORE UPDATE ON public.asesor_curso FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bitacora_docente set_updated_at_bitacora_docente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_bitacora_docente BEFORE UPDATE ON public.bitacora_docente FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: calificaciones set_updated_at_calificaciones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_calificaciones BEFORE UPDATE ON public.calificaciones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: colegios set_updated_at_colegios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_colegios BEFORE UPDATE ON public.colegios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: config_mensualidad set_updated_at_config_mensualidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_config_mensualidad BEFORE UPDATE ON public.config_mensualidad FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: novedades_asistencia_dia set_updated_at_novedades_asistencia_dia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_novedades_asistencia_dia BEFORE UPDATE ON public.novedades_asistencia_dia FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pagos_mensualidad set_updated_at_pagos_mensualidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_pagos_mensualidad BEFORE UPDATE ON public.pagos_mensualidad FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tutores_familia set_updated_at_tutores_familia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_tutores_familia BEFORE UPDATE ON public.tutores_familia FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tutoriales set_updated_at_tutoriales; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_tutoriales BEFORE UPDATE ON public.tutoriales FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: usuarios set_updated_at_usuarios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_usuarios BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bitacora_docente trg_proteger_bitacora_columnas_director; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_bitacora_columnas_director BEFORE UPDATE ON public.bitacora_docente FOR EACH ROW EXECUTE FUNCTION public.proteger_bitacora_columnas_director();


--
-- Name: tutores_familia trg_proteger_colegio_tutor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_colegio_tutor BEFORE UPDATE ON public.tutores_familia FOR EACH ROW EXECUTE FUNCTION public.proteger_colegio_tutor();


--
-- Name: comunicados_estudiante trg_proteger_comunicado_estudiante; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_comunicado_estudiante BEFORE UPDATE ON public.comunicados_estudiante FOR EACH ROW EXECUTE FUNCTION public.proteger_comunicado_estudiante();


--
-- Name: colegios trg_proteger_dominio_correo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_dominio_correo BEFORE UPDATE ON public.colegios FOR EACH ROW EXECUTE FUNCTION public.proteger_dominio_correo();


--
-- Name: colegios trg_proteger_plan_colegio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_plan_colegio BEFORE UPDATE ON public.colegios FOR EACH ROW EXECUTE FUNCTION public.proteger_plan_colegio();


--
-- Name: rubrica_criterios trg_proteger_rubrica_calificada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_rubrica_calificada BEFORE INSERT OR DELETE OR UPDATE ON public.rubrica_criterios FOR EACH ROW EXECUTE FUNCTION public.proteger_rubrica_calificada();


--
-- Name: colegios trg_proteger_subdominio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_subdominio BEFORE UPDATE OF subdominio ON public.colegios FOR EACH ROW EXECUTE FUNCTION public.proteger_subdominio_colegio();


--
-- Name: config_gestion trg_proteger_toggles_plan; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_toggles_plan BEFORE UPDATE ON public.config_gestion FOR EACH ROW EXECUTE FUNCTION public.proteger_toggles_plan();


--
-- Name: estudiantes trg_sync_curso_inscripciones_tecnicas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_curso_inscripciones_tecnicas AFTER UPDATE OF curso_id ON public.estudiantes FOR EACH ROW EXECUTE FUNCTION public.sync_curso_inscripciones_tecnicas();


--
-- Name: rubrica_criterios trg_validar_suma_rubrica; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_validar_suma_rubrica AFTER INSERT OR DELETE OR UPDATE ON public.rubrica_criterios DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validar_suma_rubrica();


--
-- Name: notas validar_rango_nota; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validar_rango_nota BEFORE INSERT OR UPDATE OF valor, actividad_id ON public.notas FOR EACH ROW EXECUTE FUNCTION public.trg_validar_rango_nota();


--
-- Name: actividades actividades_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actividades
    ADD CONSTRAINT actividades_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.usuarios(id);


--
-- Name: actividades actividades_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actividades
    ADD CONSTRAINT actividades_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: actividades actividades_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actividades
    ADD CONSTRAINT actividades_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id);


--
-- Name: asesor_curso asesor_curso_asignado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_curso
    ADD CONSTRAINT asesor_curso_asignado_por_fkey FOREIGN KEY (asignado_por) REFERENCES public.usuarios(id);


--
-- Name: asesor_curso asesor_curso_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_curso
    ADD CONSTRAINT asesor_curso_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id) ON DELETE CASCADE;


--
-- Name: asesor_curso asesor_curso_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_curso
    ADD CONSTRAINT asesor_curso_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id) ON DELETE CASCADE;


--
-- Name: asesor_curso asesor_curso_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_curso
    ADD CONSTRAINT asesor_curso_profesor_id_fkey FOREIGN KEY (profesor_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: asignaciones_profesor asignaciones_profesor_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones_profesor
    ADD CONSTRAINT asignaciones_profesor_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id) ON DELETE CASCADE;


--
-- Name: asignaciones_profesor asignaciones_profesor_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones_profesor
    ADD CONSTRAINT asignaciones_profesor_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id) ON DELETE CASCADE;


--
-- Name: asignaciones_profesor asignaciones_profesor_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones_profesor
    ADD CONSTRAINT asignaciones_profesor_profesor_id_fkey FOREIGN KEY (profesor_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: asistencia_porteria asistencia_porteria_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencia_porteria
    ADD CONSTRAINT asistencia_porteria_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: asistencia_porteria asistencia_porteria_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencia_porteria
    ADD CONSTRAINT asistencia_porteria_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: asistencia_porteria asistencia_porteria_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencia_porteria
    ADD CONSTRAINT asistencia_porteria_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: asistencias asistencias_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: asistencias asistencias_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: asistencias_materia asistencias_materia_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias_materia
    ADD CONSTRAINT asistencias_materia_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: asistencias_materia asistencias_materia_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias_materia
    ADD CONSTRAINT asistencias_materia_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: asistencias_materia asistencias_materia_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias_materia
    ADD CONSTRAINT asistencias_materia_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id);


--
-- Name: asistencias_materia asistencias_materia_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias_materia
    ADD CONSTRAINT asistencias_materia_profesor_id_fkey FOREIGN KEY (profesor_id) REFERENCES public.usuarios(id);


--
-- Name: asistencias asistencias_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.usuarios(id);


--
-- Name: becas_estudiante becas_estudiante_asignado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.becas_estudiante
    ADD CONSTRAINT becas_estudiante_asignado_por_fkey FOREIGN KEY (asignado_por) REFERENCES public.usuarios(id);


--
-- Name: becas_estudiante becas_estudiante_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.becas_estudiante
    ADD CONSTRAINT becas_estudiante_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: becas_estudiante becas_estudiante_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.becas_estudiante
    ADD CONSTRAINT becas_estudiante_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: bitacora_docente bitacora_docente_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_docente
    ADD CONSTRAINT bitacora_docente_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: bitacora_docente bitacora_docente_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_docente
    ADD CONSTRAINT bitacora_docente_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: bitacora_docente bitacora_docente_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_docente
    ADD CONSTRAINT bitacora_docente_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id);


--
-- Name: bitacora_docente bitacora_docente_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_docente
    ADD CONSTRAINT bitacora_docente_profesor_id_fkey FOREIGN KEY (profesor_id) REFERENCES public.usuarios(id);


--
-- Name: calificaciones calificaciones_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calificaciones
    ADD CONSTRAINT calificaciones_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: calificaciones calificaciones_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calificaciones
    ADD CONSTRAINT calificaciones_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id) ON DELETE CASCADE;


--
-- Name: comunicados comunicados_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados
    ADD CONSTRAINT comunicados_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: comunicados comunicados_emisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados
    ADD CONSTRAINT comunicados_emisor_id_fkey FOREIGN KEY (emisor_id) REFERENCES public.usuarios(id);


--
-- Name: comunicados_estudiante comunicados_estudiante_comunicado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_estudiante
    ADD CONSTRAINT comunicados_estudiante_comunicado_id_fkey FOREIGN KEY (comunicado_id) REFERENCES public.comunicados(id) ON DELETE CASCADE;


--
-- Name: comunicados_estudiante comunicados_estudiante_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_estudiante
    ADD CONSTRAINT comunicados_estudiante_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: comunicados_lectura_tutor comunicados_lectura_tutor_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_lectura_tutor
    ADD CONSTRAINT comunicados_lectura_tutor_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: comunicados_lectura_tutor comunicados_lectura_tutor_comunicado_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados_lectura_tutor
    ADD CONSTRAINT comunicados_lectura_tutor_comunicado_estudiante_id_fkey FOREIGN KEY (comunicado_estudiante_id) REFERENCES public.comunicados_estudiante(id) ON DELETE CASCADE;


--
-- Name: comunicados comunicados_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunicados
    ADD CONSTRAINT comunicados_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id);


--
-- Name: config_categorias_ser config_categorias_ser_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_categorias_ser
    ADD CONSTRAINT config_categorias_ser_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_dimensiones config_dimensiones_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_dimensiones
    ADD CONSTRAINT config_dimensiones_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_dimensiones config_dimensiones_gestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_dimensiones
    ADD CONSTRAINT config_dimensiones_gestion_id_fkey FOREIGN KEY (gestion_id) REFERENCES public.config_gestion(id) ON DELETE CASCADE;


--
-- Name: config_escala_ser config_escala_ser_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_escala_ser
    ADD CONSTRAINT config_escala_ser_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_gestion config_gestion_activado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_gestion
    ADD CONSTRAINT config_gestion_activado_por_fkey FOREIGN KEY (activado_por) REFERENCES public.usuarios(id);


--
-- Name: config_gestion config_gestion_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_gestion
    ADD CONSTRAINT config_gestion_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_mensualidad config_mensualidad_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_mensualidad
    ADD CONSTRAINT config_mensualidad_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_mensualidad config_mensualidad_gestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_mensualidad
    ADD CONSTRAINT config_mensualidad_gestion_id_fkey FOREIGN KEY (gestion_id) REFERENCES public.config_gestion(id);


--
-- Name: config_notificaciones config_notificaciones_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_notificaciones
    ADD CONSTRAINT config_notificaciones_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_preguntas_docente config_preguntas_docente_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_preguntas_docente
    ADD CONSTRAINT config_preguntas_docente_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: config_subcriterios_ser config_subcriterios_ser_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_subcriterios_ser
    ADD CONSTRAINT config_subcriterios_ser_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.config_categorias_ser(id) ON DELETE CASCADE;


--
-- Name: config_subcriterios_ser config_subcriterios_ser_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_subcriterios_ser
    ADD CONSTRAINT config_subcriterios_ser_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: cursos cursos_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cursos
    ADD CONSTRAINT cursos_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: cursos cursos_tutor_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cursos
    ADD CONSTRAINT cursos_tutor_profesor_id_fkey FOREIGN KEY (tutor_profesor_id) REFERENCES public.usuarios(id);


--
-- Name: entregas_tareas entregas_tareas_actividad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entregas_tareas
    ADD CONSTRAINT entregas_tareas_actividad_id_fkey FOREIGN KEY (actividad_id) REFERENCES public.actividades(id) ON DELETE CASCADE;


--
-- Name: entregas_tareas entregas_tareas_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entregas_tareas
    ADD CONSTRAINT entregas_tareas_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: entregas_tareas entregas_tareas_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entregas_tareas
    ADD CONSTRAINT entregas_tareas_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id) ON DELETE CASCADE;


--
-- Name: estudiantes estudiantes_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estudiantes
    ADD CONSTRAINT estudiantes_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: estudiantes estudiantes_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estudiantes
    ADD CONSTRAINT estudiantes_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: estudiantes estudiantes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estudiantes
    ADD CONSTRAINT estudiantes_id_fkey FOREIGN KEY (id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: evaluaciones_docente evaluaciones_docente_activada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluaciones_docente
    ADD CONSTRAINT evaluaciones_docente_activada_por_fkey FOREIGN KEY (activada_por) REFERENCES public.usuarios(id);


--
-- Name: evaluaciones_docente evaluaciones_docente_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluaciones_docente
    ADD CONSTRAINT evaluaciones_docente_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: fichas_seguimiento_ser fichas_seguimiento_ser_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_seguimiento_ser
    ADD CONSTRAINT fichas_seguimiento_ser_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: fichas_seguimiento_ser fichas_seguimiento_ser_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_seguimiento_ser
    ADD CONSTRAINT fichas_seguimiento_ser_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: fichas_seguimiento_ser fichas_seguimiento_ser_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_seguimiento_ser
    ADD CONSTRAINT fichas_seguimiento_ser_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id) ON DELETE CASCADE;


--
-- Name: fichas_seguimiento_ser fichas_seguimiento_ser_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_seguimiento_ser
    ADD CONSTRAINT fichas_seguimiento_ser_profesor_id_fkey FOREIGN KEY (profesor_id) REFERENCES public.usuarios(id);


--
-- Name: historial_promociones historial_promociones_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_promociones
    ADD CONSTRAINT historial_promociones_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id);


--
-- Name: inscripciones_tecnicas inscripciones_tecnicas_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscripciones_tecnicas
    ADD CONSTRAINT inscripciones_tecnicas_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: inscripciones_tecnicas inscripciones_tecnicas_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscripciones_tecnicas
    ADD CONSTRAINT inscripciones_tecnicas_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: inscripciones_tecnicas inscripciones_tecnicas_inscrito_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscripciones_tecnicas
    ADD CONSTRAINT inscripciones_tecnicas_inscrito_por_fkey FOREIGN KEY (inscrito_por) REFERENCES public.usuarios(id);


--
-- Name: inscripciones_tecnicas inscripciones_tecnicas_materia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inscripciones_tecnicas
    ADD CONSTRAINT inscripciones_tecnicas_materia_id_fkey FOREIGN KEY (materia_id) REFERENCES public.materias(id) ON DELETE CASCADE;


--
-- Name: intentos_busqueda_carnet intentos_busqueda_carnet_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intentos_busqueda_carnet
    ADD CONSTRAINT intentos_busqueda_carnet_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: materias materias_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materias
    ADD CONSTRAINT materias_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: notas notas_actividad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas
    ADD CONSTRAINT notas_actividad_id_fkey FOREIGN KEY (actividad_id) REFERENCES public.actividades(id) ON DELETE CASCADE;


--
-- Name: notas notas_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas
    ADD CONSTRAINT notas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.usuarios(id);


--
-- Name: notas notas_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas
    ADD CONSTRAINT notas_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: notificaciones_log notificaciones_log_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones_log
    ADD CONSTRAINT notificaciones_log_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id);


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.novedades_asistencia_dia
    ADD CONSTRAINT novedades_asistencia_dia_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.novedades_asistencia_dia
    ADD CONSTRAINT novedades_asistencia_dia_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.novedades_asistencia_dia
    ADD CONSTRAINT novedades_asistencia_dia_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.novedades_asistencia_dia
    ADD CONSTRAINT novedades_asistencia_dia_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: pagos_mensualidad pagos_mensualidad_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_mensualidad
    ADD CONSTRAINT pagos_mensualidad_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: pagos_mensualidad pagos_mensualidad_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_mensualidad
    ADD CONSTRAINT pagos_mensualidad_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: pagos_mensualidad pagos_mensualidad_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_mensualidad
    ADD CONSTRAINT pagos_mensualidad_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: pagos_mensualidad pagos_mensualidad_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_mensualidad
    ADD CONSTRAINT pagos_mensualidad_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutores_familia(id);


--
-- Name: porteria_alertas porteria_alertas_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_alertas
    ADD CONSTRAINT porteria_alertas_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: porteria_alertas porteria_alertas_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_alertas
    ADD CONSTRAINT porteria_alertas_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: porteria_alertas porteria_alertas_justificado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_alertas
    ADD CONSTRAINT porteria_alertas_justificado_por_fkey FOREIGN KEY (justificado_por) REFERENCES public.usuarios(id);


--
-- Name: porteria_alertas porteria_alertas_registro_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_alertas
    ADD CONSTRAINT porteria_alertas_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES public.asistencia_porteria(id) ON DELETE SET NULL;


--
-- Name: porteria_horarios porteria_horarios_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_horarios
    ADD CONSTRAINT porteria_horarios_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: porteria_horarios_grado porteria_horarios_grado_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_horarios_grado
    ADD CONSTRAINT porteria_horarios_grado_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: porteria_qr porteria_qr_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_qr
    ADD CONSTRAINT porteria_qr_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: porteria_qr porteria_qr_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porteria_qr
    ADD CONSTRAINT porteria_qr_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: respuestas_evaluacion respuestas_evaluacion_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.respuestas_evaluacion
    ADD CONSTRAINT respuestas_evaluacion_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id);


--
-- Name: respuestas_evaluacion respuestas_evaluacion_evaluacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.respuestas_evaluacion
    ADD CONSTRAINT respuestas_evaluacion_evaluacion_id_fkey FOREIGN KEY (evaluacion_id) REFERENCES public.evaluaciones_docente(id);


--
-- Name: respuestas_evaluacion respuestas_evaluacion_profesor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.respuestas_evaluacion
    ADD CONSTRAINT respuestas_evaluacion_profesor_id_fkey FOREIGN KEY (profesor_id) REFERENCES public.usuarios(id);


--
-- Name: revisiones_pago revisiones_pago_pago_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revisiones_pago
    ADD CONSTRAINT revisiones_pago_pago_id_fkey FOREIGN KEY (pago_id) REFERENCES public.pagos_mensualidad(id) ON DELETE CASCADE;


--
-- Name: revisiones_pago revisiones_pago_revisado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revisiones_pago
    ADD CONSTRAINT revisiones_pago_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES public.usuarios(id);


--
-- Name: rubrica_calificaciones rubrica_calificaciones_criterio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_calificaciones
    ADD CONSTRAINT rubrica_calificaciones_criterio_id_fkey FOREIGN KEY (criterio_id) REFERENCES public.rubrica_criterios(id) ON DELETE CASCADE;


--
-- Name: rubrica_calificaciones rubrica_calificaciones_nota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_calificaciones
    ADD CONSTRAINT rubrica_calificaciones_nota_id_fkey FOREIGN KEY (nota_id) REFERENCES public.notas(id) ON DELETE CASCADE;


--
-- Name: rubrica_criterios rubrica_criterios_actividad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_criterios
    ADD CONSTRAINT rubrica_criterios_actividad_id_fkey FOREIGN KEY (actividad_id) REFERENCES public.actividades(id) ON DELETE CASCADE;


--
-- Name: rubrica_plantillas rubrica_plantillas_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rubrica_plantillas
    ADD CONSTRAINT rubrica_plantillas_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: tareas_vistas tareas_vistas_actividad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas_vistas
    ADD CONSTRAINT tareas_vistas_actividad_id_fkey FOREIGN KEY (actividad_id) REFERENCES public.actividades(id) ON DELETE CASCADE;


--
-- Name: tareas_vistas tareas_vistas_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tareas_vistas
    ADD CONSTRAINT tareas_vistas_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: telegram_vinculos telegram_vinculos_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_vinculos
    ADD CONSTRAINT telegram_vinculos_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: tutor_estudiante tutor_estudiante_estudiante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_estudiante
    ADD CONSTRAINT tutor_estudiante_estudiante_id_fkey FOREIGN KEY (estudiante_id) REFERENCES public.estudiantes(id) ON DELETE CASCADE;


--
-- Name: tutor_estudiante tutor_estudiante_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_estudiante
    ADD CONSTRAINT tutor_estudiante_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutores_familia(id) ON DELETE CASCADE;


--
-- Name: tutores_familia tutores_familia_colegio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutores_familia
    ADD CONSTRAINT tutores_familia_colegio_id_fkey FOREIGN KEY (colegio_id) REFERENCES public.colegios(id);


--
-- Name: tutores_familia tutores_familia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutores_familia
    ADD CONSTRAINT tutores_familia_id_fkey FOREIGN KEY (id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: usuarios usuarios_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: actividades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.actividades ENABLE ROW LEVEL SECURITY;

--
-- Name: actividades actividades_delete_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY actividades_delete_director ON public.actividades FOR DELETE USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = actividades.curso_id) AND (c.colegio_id = public.mi_colegio_id()))))));


--
-- Name: actividades actividades_delete_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY actividades_delete_profesor ON public.actividades FOR DELETE USING ((public.es_profesor() AND (creado_por = auth.uid())));


--
-- Name: actividades actividades_select_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY actividades_select_colegio ON public.actividades FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = actividades.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) OR ((curso_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.materias m
  WHERE ((m.id = actividades.materia_id) AND (m.colegio_id = public.mi_colegio_id())))))));


--
-- Name: actividades actividades_update_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY actividades_update_profesor ON public.actividades FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = actividades.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND ((public.es_profesor() AND (creado_por = auth.uid())) OR public.es_director()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = actividades.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND ((public.es_profesor() AND (creado_por = auth.uid())) OR public.es_director()) AND ((materia_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.materias m
  WHERE ((m.id = actividades.materia_id) AND (m.colegio_id = public.mi_colegio_id())))))));


--
-- Name: actividades actividades_write_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY actividades_write_profesor ON public.actividades FOR INSERT WITH CHECK ((public.es_profesor() AND public.profesor_asignado_curso(curso_id) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = actividades.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND ((materia_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.materias m
  WHERE ((m.id = actividades.materia_id) AND (m.colegio_id = public.mi_colegio_id())))))));


--
-- Name: asesor_curso; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asesor_curso ENABLE ROW LEVEL SECURITY;

--
-- Name: asesor_curso asesor_curso_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asesor_curso_insert_director ON public.asesor_curso FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id()) AND (asignado_por = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asesor_curso.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND (EXISTS ( SELECT 1
   FROM public.usuarios u
  WHERE ((u.id = asesor_curso.profesor_id) AND (u.rol = 'profesor'::text) AND (u.activo = true) AND (u.colegio_id = public.mi_colegio_id()))))));


--
-- Name: asesor_curso asesor_curso_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asesor_curso_select_director ON public.asesor_curso FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: asesor_curso asesor_curso_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asesor_curso_select_profesor ON public.asesor_curso FOR SELECT USING ((public.es_profesor() AND (profesor_id = auth.uid())));


--
-- Name: asesor_curso asesor_curso_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asesor_curso_update_director ON public.asesor_curso FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id()))) WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: asignaciones_profesor; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asignaciones_profesor ENABLE ROW LEVEL SECURITY;

--
-- Name: asignaciones_profesor asignaciones_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asignaciones_select_estudiante ON public.asignaciones_profesor FOR SELECT USING ((curso_id = public.mi_curso_id()));


--
-- Name: asignaciones_profesor asignaciones_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asignaciones_select_profesor ON public.asignaciones_profesor FOR SELECT USING ((((profesor_id = auth.uid()) OR public.es_director()) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asignaciones_profesor.curso_id) AND (c.colegio_id = public.mi_colegio_id()))))));


--
-- Name: asignaciones_profesor asignaciones_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asignaciones_write_director ON public.asignaciones_profesor USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asignaciones_profesor.curso_id) AND (c.colegio_id = public.mi_colegio_id())))))) WITH CHECK ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asignaciones_profesor.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND public.profesor_es_de_mi_colegio(profesor_id) AND (EXISTS ( SELECT 1
   FROM public.materias m
  WHERE ((m.id = asignaciones_profesor.materia_id) AND (m.colegio_id = public.mi_colegio_id()))))));


--
-- Name: asistencia_porteria; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asistencia_porteria ENABLE ROW LEVEL SECURITY;

--
-- Name: asistencia_qr_llamadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asistencia_qr_llamadas ENABLE ROW LEVEL SECURITY;

--
-- Name: asistencias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asistencias ENABLE ROW LEVEL SECURITY;

--
-- Name: asistencias_materia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asistencias_materia ENABLE ROW LEVEL SECURITY;

--
-- Name: asistencias_materia asistencias_materia_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_materia_select_director ON public.asistencias_materia FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asistencias_materia.curso_id) AND (c.colegio_id = public.mi_colegio_id()))))));


--
-- Name: asistencias_materia asistencias_materia_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_materia_select_estudiante ON public.asistencias_materia FOR SELECT USING ((estudiante_id = auth.uid()));


--
-- Name: asistencias_materia asistencias_materia_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_materia_select_profesor ON public.asistencias_materia FOR SELECT USING (((profesor_id = auth.uid()) AND public.usuario_activo(estudiante_id) AND (EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.curso_id = asistencias_materia.curso_id) AND (ap.materia_id = asistencias_materia.materia_id) AND (ap.activo = true))))));


--
-- Name: asistencias_materia asistencias_materia_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_materia_select_tutor ON public.asistencias_materia FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.tutor_id = auth.uid()) AND (te.estudiante_id = asistencias_materia.estudiante_id) AND (te.activo = true)))));


--
-- Name: asistencias_materia asistencias_materia_write_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_materia_write_profesor ON public.asistencias_materia USING (((profesor_id = auth.uid()) AND public.usuario_activo(estudiante_id) AND (EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.curso_id = asistencias_materia.curso_id) AND (ap.materia_id = asistencias_materia.materia_id) AND (ap.activo = true)))))) WITH CHECK (((profesor_id = auth.uid()) AND public.usuario_activo(estudiante_id) AND (EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.curso_id = asistencias_materia.curso_id) AND (ap.materia_id = asistencias_materia.materia_id) AND (ap.activo = true))))));


--
-- Name: asistencias asistencias_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_select_director ON public.asistencias FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asistencias.curso_id) AND (c.colegio_id = public.mi_colegio_id()))))));


--
-- Name: asistencias asistencias_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_select_estudiante ON public.asistencias FOR SELECT USING ((estudiante_id = auth.uid()));


--
-- Name: asistencias asistencias_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_select_profesor ON public.asistencias FOR SELECT USING ((public.es_profesor() AND public.profesor_asignado_curso(curso_id) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asistencias.curso_id) AND (c.colegio_id = public.mi_colegio_id()))))));


--
-- Name: asistencias asistencias_update_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_update_profesor ON public.asistencias FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asistencias.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND ((public.es_profesor() AND public.profesor_asignado_curso(curso_id)) OR public.es_director()) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = asistencias.estudiante_id) AND (e.curso_id = asistencias.curso_id))))));


--
-- Name: asistencias asistencias_write_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asistencias_write_profesor ON public.asistencias FOR INSERT WITH CHECK ((public.es_profesor() AND public.profesor_asignado_curso(curso_id) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = asistencias.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = asistencias.estudiante_id) AND (e.curso_id = asistencias.curso_id))))));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_select_director ON public.audit_logs FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.usuarios u
  WHERE ((u.id = audit_logs.actor_id) AND (u.colegio_id = public.mi_colegio_id()))))));


--
-- Name: becas_estudiante; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.becas_estudiante ENABLE ROW LEVEL SECURITY;

--
-- Name: becas_estudiante becas_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY becas_insert_director ON public.becas_estudiante FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: becas_estudiante becas_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY becas_select_director ON public.becas_estudiante FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: becas_estudiante becas_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY becas_select_secretaria ON public.becas_estudiante FOR SELECT USING ((public.es_secretaria() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: becas_estudiante becas_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY becas_select_tutor ON public.becas_estudiante FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.tutor_estudiante
  WHERE ((tutor_estudiante.tutor_id = auth.uid()) AND (tutor_estudiante.estudiante_id = becas_estudiante.estudiante_id) AND (tutor_estudiante.activo = true)))));


--
-- Name: becas_estudiante becas_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY becas_update_director ON public.becas_estudiante FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: bitacora_docente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bitacora_docente ENABLE ROW LEVEL SECURITY;

--
-- Name: bitacora_docente bitacora_insert_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bitacora_insert_profesor ON public.bitacora_docente FOR INSERT WITH CHECK ((public.es_profesor() AND (profesor_id = auth.uid()) AND public.profesor_asignado_curso(curso_id) AND (EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.curso_id = bitacora_docente.curso_id) AND (ap.materia_id = bitacora_docente.materia_id) AND (ap.activo = true)))) AND (colegio_id = public.mi_colegio_id())));


--
-- Name: bitacora_docente bitacora_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bitacora_select_director ON public.bitacora_docente FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: bitacora_docente bitacora_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bitacora_select_profesor ON public.bitacora_docente FOR SELECT USING ((profesor_id = auth.uid()));


--
-- Name: bitacora_docente bitacora_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bitacora_update_director ON public.bitacora_docente FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: bitacora_docente bitacora_update_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bitacora_update_profesor ON public.bitacora_docente FOR UPDATE USING ((profesor_id = auth.uid())) WITH CHECK (((profesor_id = auth.uid()) AND public.profesor_asignado_curso(curso_id) AND (EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.curso_id = bitacora_docente.curso_id) AND (ap.materia_id = bitacora_docente.materia_id) AND (ap.activo = true)))) AND (colegio_id = public.mi_colegio_id())));


--
-- Name: asistencias bloquear_asistencias_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bloquear_asistencias_delete ON public.asistencias AS RESTRICTIVE FOR DELETE USING ((NOT (EXISTS ( SELECT 1
   FROM public.config_gestion cg
  WHERE ((cg."año" = (EXTRACT(year FROM asistencias.fecha))::integer) AND (cg.bloqueada = true))))));


--
-- Name: asistencias bloquear_asistencias_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bloquear_asistencias_insert ON public.asistencias AS RESTRICTIVE FOR INSERT WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM public.config_gestion cg
  WHERE ((cg."año" = (EXTRACT(year FROM asistencias.fecha))::integer) AND (cg.bloqueada = true))))));


--
-- Name: asistencias bloquear_asistencias_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bloquear_asistencias_update ON public.asistencias AS RESTRICTIVE FOR UPDATE USING ((NOT (EXISTS ( SELECT 1
   FROM public.config_gestion cg
  WHERE ((cg."año" = (EXTRACT(year FROM asistencias.fecha))::integer) AND (cg.bloqueada = true))))));


--
-- Name: notas bloquear_notas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bloquear_notas_delete ON public.notas AS RESTRICTIVE FOR DELETE USING ((NOT (EXISTS ( SELECT 1
   FROM (public.config_gestion cg
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
  WHERE ((cg."año" = (EXTRACT(year FROM a.fecha_limite))::integer) AND (cg.bloqueada = true))))));


--
-- Name: notas bloquear_notas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bloquear_notas_insert ON public.notas AS RESTRICTIVE FOR INSERT WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM (public.config_gestion cg
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
  WHERE ((cg."año" = (EXTRACT(year FROM a.fecha_limite))::integer) AND (cg.bloqueada = true))))));


--
-- Name: notas bloquear_notas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bloquear_notas_update ON public.notas AS RESTRICTIVE FOR UPDATE USING ((NOT (EXISTS ( SELECT 1
   FROM (public.config_gestion cg
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
  WHERE ((cg."año" = (EXTRACT(year FROM a.fecha_limite))::integer) AND (cg.bloqueada = true))))));


--
-- Name: calificaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calificaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: calificaciones calificaciones_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calificaciones_select_director ON public.calificaciones FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = calificaciones.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: calificaciones calificaciones_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calificaciones_select_estudiante ON public.calificaciones FOR SELECT USING ((estudiante_id = auth.uid()));


--
-- Name: calificaciones calificaciones_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calificaciones_select_profesor ON public.calificaciones FOR SELECT USING ((((EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = calificaciones.materia_id) AND (ap.activo = true)))) AND public.usuario_activo(estudiante_id)) OR (estudiante_id = auth.uid())));


--
-- Name: colegios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.colegios ENABLE ROW LEVEL SECURITY;

--
-- Name: colegios colegios_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY colegios_select_propio ON public.colegios FOR SELECT USING (((id = public.mi_colegio_id()) OR (EXISTS ( SELECT 1
   FROM public.usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.rol = 'superadmin'::text) AND (usuarios.activo = true))))));


--
-- Name: colegios colegios_select_publico; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY colegios_select_publico ON public.colegios FOR SELECT TO anon USING ((activo = true));


--
-- Name: colegios colegios_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY colegios_write_director ON public.colegios USING ((public.es_director() AND (id = public.mi_colegio_id())));


--
-- Name: colegios colegios_write_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY colegios_write_superadmin ON public.colegios USING ((EXISTS ( SELECT 1
   FROM public.usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.rol = 'superadmin'::text) AND (usuarios.activo = true)))));


--
-- Name: comunicados_estudiante com_est_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_insert_director ON public.comunicados_estudiante FOR INSERT WITH CHECK ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.comunicados c
  WHERE ((c.id = comunicados_estudiante.comunicado_id) AND (c.colegio_id = public.mi_colegio_id())))) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = comunicados_estudiante.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: comunicados_estudiante com_est_insert_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_insert_profesor ON public.comunicados_estudiante FOR INSERT WITH CHECK ((public.es_profesor() AND public.profesor_tiene_asignacion(estudiante_id) AND (EXISTS ( SELECT 1
   FROM public.comunicados c
  WHERE ((c.id = comunicados_estudiante.comunicado_id) AND (c.emisor_id = auth.uid()))))));


--
-- Name: comunicados_estudiante com_est_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_select_director ON public.comunicados_estudiante FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.comunicados c
  WHERE ((c.id = comunicados_estudiante.comunicado_id) AND (c.colegio_id = public.mi_colegio_id()))))));


--
-- Name: comunicados_estudiante com_est_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_select_estudiante ON public.comunicados_estudiante FOR SELECT USING ((estudiante_id = auth.uid()));


--
-- Name: comunicados_estudiante com_est_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_select_profesor ON public.comunicados_estudiante FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.comunicados c
  WHERE ((c.id = comunicados_estudiante.comunicado_id) AND (c.emisor_id = auth.uid())))));


--
-- Name: comunicados_estudiante com_est_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_select_tutor ON public.comunicados_estudiante FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.estudiante_id = comunicados_estudiante.estudiante_id) AND (te.tutor_id = auth.uid())))));


--
-- Name: comunicados_estudiante com_est_update_leido_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_update_leido_estudiante ON public.comunicados_estudiante FOR UPDATE USING ((estudiante_id = auth.uid())) WITH CHECK ((estudiante_id = auth.uid()));


--
-- Name: comunicados_estudiante com_est_update_leido_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_est_update_leido_tutor ON public.comunicados_estudiante FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.estudiante_id = comunicados_estudiante.estudiante_id) AND (te.tutor_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.estudiante_id = comunicados_estudiante.estudiante_id) AND (te.tutor_id = auth.uid())))));


--
-- Name: comunicados_lectura_tutor com_lect_tutor_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_lect_tutor_select_director ON public.comunicados_lectura_tutor FOR SELECT TO authenticated USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: comunicados_lectura_tutor com_lect_tutor_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_lect_tutor_select_profesor ON public.comunicados_lectura_tutor FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.comunicados_estudiante ce
     JOIN public.comunicados c ON ((c.id = ce.comunicado_id)))
  WHERE ((ce.id = comunicados_lectura_tutor.comunicado_estudiante_id) AND (c.emisor_id = auth.uid())))));


--
-- Name: comunicados_lectura_tutor com_lect_tutor_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_lect_tutor_select_propio ON public.comunicados_lectura_tutor FOR SELECT TO authenticated USING ((tutor_id = auth.uid()));


--
-- Name: comunicados_lectura_tutor com_lect_tutor_select_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY com_lect_tutor_select_superadmin ON public.comunicados_lectura_tutor FOR SELECT TO authenticated USING (public.es_superadmin());


--
-- Name: comunicados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comunicados ENABLE ROW LEVEL SECURITY;

--
-- Name: comunicados_estudiante; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comunicados_estudiante ENABLE ROW LEVEL SECURITY;

--
-- Name: comunicados comunicados_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comunicados_insert_director ON public.comunicados FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM public.colegios c
  WHERE ((c.id = public.mi_colegio_id()) AND (c.plan = 'avanzado'::text))))));


--
-- Name: comunicados comunicados_insert_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comunicados_insert_profesor ON public.comunicados FOR INSERT WITH CHECK ((public.es_profesor() AND (colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM public.colegios c
  WHERE ((c.id = public.mi_colegio_id()) AND (c.plan = 'avanzado'::text))))));


--
-- Name: comunicados_lectura_tutor; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comunicados_lectura_tutor ENABLE ROW LEVEL SECURITY;

--
-- Name: comunicados comunicados_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comunicados_select_director ON public.comunicados FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: comunicados comunicados_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comunicados_select_estudiante ON public.comunicados FOR SELECT USING ((public.es_estudiante() AND public.comunicado_dirigido_a_mi(id)));


--
-- Name: comunicados comunicados_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comunicados_select_profesor ON public.comunicados FOR SELECT USING ((public.es_profesor() AND (emisor_id = auth.uid())));


--
-- Name: comunicados comunicados_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comunicados_select_tutor ON public.comunicados FOR SELECT USING (public.comunicado_dirigido_a_mi_hijo(id));


--
-- Name: config_categorias_ser; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_categorias_ser ENABLE ROW LEVEL SECURITY;

--
-- Name: config_categorias_ser config_categorias_ser_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_categorias_ser_select ON public.config_categorias_ser FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_categorias_ser config_categorias_ser_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_categorias_ser_write_director ON public.config_categorias_ser USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_dimensiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_dimensiones ENABLE ROW LEVEL SECURITY;

--
-- Name: config_dimensiones config_dimensiones_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_dimensiones_select ON public.config_dimensiones FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_dimensiones config_dimensiones_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_dimensiones_write_director ON public.config_dimensiones USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_escala_ser; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_escala_ser ENABLE ROW LEVEL SECURITY;

--
-- Name: config_escala_ser config_escala_ser_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_escala_ser_select ON public.config_escala_ser FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_escala_ser config_escala_ser_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_escala_ser_write_director ON public.config_escala_ser USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_gestion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_gestion ENABLE ROW LEVEL SECURITY;

--
-- Name: config_gestion config_gestion_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_gestion_select ON public.config_gestion FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_gestion config_gestion_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_gestion_write_director ON public.config_gestion USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_mensualidad; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_mensualidad ENABLE ROW LEVEL SECURITY;

--
-- Name: config_mensualidad config_mensualidad_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_mensualidad_insert_director ON public.config_mensualidad FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_mensualidad config_mensualidad_select_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_mensualidad_select_colegio ON public.config_mensualidad FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_mensualidad config_mensualidad_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_mensualidad_update_director ON public.config_mensualidad FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_notificaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_notificaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: config_notificaciones config_notificaciones_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_notificaciones_select ON public.config_notificaciones FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_notificaciones config_notificaciones_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_notificaciones_write_director ON public.config_notificaciones USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_preguntas_docente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_preguntas_docente ENABLE ROW LEVEL SECURITY;

--
-- Name: config_preguntas_docente config_preguntas_docente_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_preguntas_docente_select ON public.config_preguntas_docente FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_preguntas_docente config_preguntas_docente_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_preguntas_docente_write_director ON public.config_preguntas_docente USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: config_subcriterios_ser; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_subcriterios_ser ENABLE ROW LEVEL SECURITY;

--
-- Name: config_subcriterios_ser config_subcriterios_ser_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_subcriterios_ser_select ON public.config_subcriterios_ser FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: config_subcriterios_ser config_subcriterios_ser_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_subcriterios_ser_write_director ON public.config_subcriterios_ser USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: cursos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cursos ENABLE ROW LEVEL SECURITY;

--
-- Name: cursos cursos_select_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cursos_select_colegio ON public.cursos FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: cursos cursos_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cursos_write_director ON public.cursos USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: entregas_tareas entrega_estudiante_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entrega_estudiante_own ON public.entregas_tareas TO authenticated USING ((estudiante_id = auth.uid())) WITH CHECK (((estudiante_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (public.config_gestion cg
     JOIN public.colegios col ON ((col.id = cg.colegio_id)))
  WHERE ((cg.colegio_id = public.mi_colegio_id()) AND (cg.estado = 'activo'::text) AND (cg.permite_entrega_tareas = true) AND (col.plan = 'avanzado'::text)))) AND (EXISTS ( SELECT 1
   FROM (public.actividades a
     JOIN public.materias m ON ((m.id = a.materia_id)))
  WHERE ((a.id = entregas_tareas.actividad_id) AND (((m.es_tecnica IS NOT TRUE) AND (EXISTS ( SELECT 1
           FROM public.estudiantes e
          WHERE ((e.id = entregas_tareas.estudiante_id) AND (e.curso_id = a.curso_id))))) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
           FROM public.inscripciones_tecnicas it
          WHERE ((it.estudiante_id = entregas_tareas.estudiante_id) AND (it.materia_id = a.materia_id) AND (it.activo = true)))))))))));


--
-- Name: entregas_tareas entrega_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entrega_select_director ON public.entregas_tareas FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = entregas_tareas.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: entregas_tareas entrega_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entrega_select_profesor ON public.entregas_tareas FOR SELECT USING ((public.es_profesor() AND public.profesor_tiene_asignacion(estudiante_id) AND public.profesor_dicta_actividad(actividad_id)));


--
-- Name: entregas_tareas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entregas_tareas ENABLE ROW LEVEL SECURITY;

--
-- Name: estudiantes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estudiantes ENABLE ROW LEVEL SECURITY;

--
-- Name: estudiantes estudiantes_all_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estudiantes_all_director ON public.estudiantes USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: estudiantes estudiantes_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estudiantes_select_profesor ON public.estudiantes FOR SELECT USING ((public.es_profesor() AND (colegio_id = public.mi_colegio_id()) AND public.usuario_activo(id) AND (EXISTS ( SELECT 1
   FROM public.asignaciones_profesor ap
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.curso_id = estudiantes.curso_id) AND (ap.activo = true))))));


--
-- Name: estudiantes estudiantes_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estudiantes_select_propio ON public.estudiantes FOR SELECT USING ((id = auth.uid()));


--
-- Name: estudiantes estudiantes_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estudiantes_select_secretaria ON public.estudiantes FOR SELECT USING ((public.es_secretaria() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: estudiantes estudiantes_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estudiantes_select_tutor ON public.estudiantes FOR SELECT USING (((colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.tutor_id = auth.uid()) AND (te.estudiante_id = estudiantes.id) AND (te.activo = true))))));


--
-- Name: evaluaciones_docente eval_docente_select_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY eval_docente_select_colegio ON public.evaluaciones_docente FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.usuarios u
  WHERE ((u.id = evaluaciones_docente.activada_por) AND (u.colegio_id = public.mi_colegio_id())))));


--
-- Name: evaluaciones_docente eval_docente_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY eval_docente_write_director ON public.evaluaciones_docente USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.usuarios u
  WHERE ((u.id = evaluaciones_docente.activada_por) AND (u.colegio_id = public.mi_colegio_id()))))));


--
-- Name: evaluaciones_docente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluaciones_docente ENABLE ROW LEVEL SECURITY;

--
-- Name: fichas_seguimiento_ser fichas_insert_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fichas_insert_profesor ON public.fichas_seguimiento_ser FOR INSERT WITH CHECK ((public.es_profesor() AND (profesor_id = auth.uid()) AND public.profesor_tiene_asignacion(estudiante_id)));


--
-- Name: fichas_seguimiento_ser; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fichas_seguimiento_ser ENABLE ROW LEVEL SECURITY;

--
-- Name: fichas_seguimiento_ser fichas_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fichas_select_director ON public.fichas_seguimiento_ser FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = fichas_seguimiento_ser.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: fichas_seguimiento_ser fichas_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fichas_select_estudiante ON public.fichas_seguimiento_ser FOR SELECT USING (((estudiante_id = auth.uid()) AND (publicada = true)));


--
-- Name: fichas_seguimiento_ser fichas_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fichas_select_profesor ON public.fichas_seguimiento_ser FOR SELECT USING ((public.es_profesor() AND (profesor_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = fichas_seguimiento_ser.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: fichas_seguimiento_ser fichas_update_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fichas_update_profesor ON public.fichas_seguimiento_ser FOR UPDATE USING ((public.es_profesor() AND (profesor_id = auth.uid()) AND public.profesor_tiene_asignacion(estudiante_id)));


--
-- Name: historial_promociones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.historial_promociones ENABLE ROW LEVEL SECURITY;

--
-- Name: historial_promociones historial_promociones_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY historial_promociones_select ON public.historial_promociones FOR SELECT USING ((public.es_superadmin() OR (public.es_director() AND (colegio_id = public.mi_colegio_id()))));


--
-- Name: inscripciones_tecnicas inscripciones_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscripciones_select ON public.inscripciones_tecnicas FOR SELECT USING (((estudiante_id = auth.uid()) OR (public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = inscripciones_tecnicas.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))) OR (public.es_profesor() AND public.usuario_activo(estudiante_id) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = inscripciones_tecnicas.estudiante_id) AND (e.colegio_id = public.mi_colegio_id())))))));


--
-- Name: inscripciones_tecnicas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inscripciones_tecnicas ENABLE ROW LEVEL SECURITY;

--
-- Name: inscripciones_tecnicas inscripciones_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inscripciones_write_director ON public.inscripciones_tecnicas USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = inscripciones_tecnicas.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: intentos_busqueda_carnet; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intentos_busqueda_carnet ENABLE ROW LEVEL SECURITY;

--
-- Name: licencias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.licencias ENABLE ROW LEVEL SECURITY;

--
-- Name: licencias licencias_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY licencias_select_estudiante ON public.licencias FOR SELECT USING (((estado = 'aprobada'::text) AND (estudiante_id = auth.uid())));


--
-- Name: licencias licencias_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY licencias_select_profesor ON public.licencias FOR SELECT USING (((estado = 'aprobada'::text) AND public.es_profesor() AND (colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM (public.estudiantes e
     JOIN public.asignaciones_profesor ap ON ((ap.curso_id = e.curso_id)))
  WHERE ((e.id = licencias.estudiante_id) AND (ap.profesor_id = auth.uid()) AND (ap.activo = true))))));


--
-- Name: licencias licencias_select_regente; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY licencias_select_regente ON public.licencias FOR SELECT USING (((estado = 'aprobada'::text) AND public.es_regente() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: licencias licencias_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY licencias_select_staff ON public.licencias FOR SELECT USING ((public.tiene_permiso('licencias.aprobar'::text) AND (colegio_id = public.mi_colegio_id())));


--
-- Name: licencias licencias_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY licencias_select_tutor ON public.licencias FOR SELECT USING ((tutor_id = auth.uid()));


--
-- Name: materias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.materias ENABLE ROW LEVEL SECURITY;

--
-- Name: materias materias_select_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY materias_select_colegio ON public.materias FOR SELECT USING ((colegio_id = public.mi_colegio_id()));


--
-- Name: materias materias_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY materias_write_director ON public.materias USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: notas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas ENABLE ROW LEVEL SECURITY;

--
-- Name: notas notas_insert_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_insert_profesor ON public.notas FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.asignaciones_profesor ap
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
     JOIN public.materias m ON ((m.id = a.materia_id)))
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.activo = true) AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id) AND (EXISTS ( SELECT 1
           FROM public.estudiantes e
          WHERE ((e.id = notas.estudiante_id) AND (e.curso_id = a.curso_id))))) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
           FROM public.inscripciones_tecnicas it
          WHERE ((it.estudiante_id = notas.estudiante_id) AND (it.materia_id = a.materia_id) AND (it.activo = true))))))))));


--
-- Name: notas notas_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_select_director ON public.notas FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = notas.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: notas notas_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_select_estudiante ON public.notas FOR SELECT USING ((estudiante_id = auth.uid()));


--
-- Name: notas notas_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_select_profesor ON public.notas FOR SELECT USING ((public.usuario_activo(estudiante_id) AND (EXISTS ( SELECT 1
   FROM ((public.asignaciones_profesor ap
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
     JOIN public.materias m ON ((m.id = a.materia_id)))
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.activo = true) AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id)) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
           FROM public.inscripciones_tecnicas it
          WHERE ((it.estudiante_id = notas.estudiante_id) AND (it.materia_id = a.materia_id) AND (it.activo = true)))))))))));


--
-- Name: notas notas_select_profesor_traslado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_select_profesor_traslado ON public.notas FOR SELECT TO authenticated USING ((public.usuario_activo(estudiante_id) AND (EXISTS ( SELECT 1
   FROM (((public.actividades a
     JOIN public.materias m ON ((m.id = a.materia_id)))
     JOIN public.estudiantes e ON ((e.id = notas.estudiante_id)))
     JOIN public.asignaciones_profesor ap ON (((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.curso_id = e.curso_id) AND (ap.activo = true))))
  WHERE ((a.id = notas.actividad_id) AND (m.es_tecnica IS NOT TRUE))))));


--
-- Name: notas notas_update_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_update_profesor ON public.notas FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ((public.asignaciones_profesor ap
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
     JOIN public.materias m ON ((m.id = a.materia_id)))
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.activo = true) AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id) AND (EXISTS ( SELECT 1
           FROM public.estudiantes e
          WHERE ((e.id = notas.estudiante_id) AND (e.curso_id = a.curso_id))))) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
           FROM public.inscripciones_tecnicas it
          WHERE ((it.estudiante_id = notas.estudiante_id) AND (it.materia_id = a.materia_id) AND (it.activo = true)))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.asignaciones_profesor ap
     JOIN public.actividades a ON ((a.id = notas.actividad_id)))
     JOIN public.materias m ON ((m.id = a.materia_id)))
  WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.activo = true) AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id) AND (EXISTS ( SELECT 1
           FROM public.estudiantes e
          WHERE ((e.id = notas.estudiante_id) AND (e.curso_id = a.curso_id))))) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
           FROM public.inscripciones_tecnicas it
          WHERE ((it.estudiante_id = notas.estudiante_id) AND (it.materia_id = a.materia_id) AND (it.activo = true))))))))));


--
-- Name: notificaciones_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notificaciones_log ENABLE ROW LEVEL SECURITY;

--
-- Name: notificaciones_log notificaciones_log_acta_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificaciones_log_acta_insert ON public.notificaciones_log FOR INSERT WITH CHECK (((tipo = 'acta_junta'::text) AND (((mensaje)::jsonb ->> 'profesor_id'::text) = (auth.uid())::text)));


--
-- Name: notificaciones_log notificaciones_log_acta_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificaciones_log_acta_select ON public.notificaciones_log FOR SELECT USING (((tipo = 'acta_junta'::text) AND (((mensaje)::jsonb ->> 'profesor_id'::text) = (auth.uid())::text)));


--
-- Name: notificaciones_log notificaciones_log_acta_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificaciones_log_acta_update ON public.notificaciones_log FOR UPDATE USING (((tipo = 'acta_junta'::text) AND (((mensaje)::jsonb ->> 'profesor_id'::text) = (auth.uid())::text))) WITH CHECK (((tipo = 'acta_junta'::text) AND (((mensaje)::jsonb ->> 'profesor_id'::text) = (auth.uid())::text)));


--
-- Name: novedades_asistencia_dia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.novedades_asistencia_dia ENABLE ROW LEVEL SECURITY;

--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_delete_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY novedades_asistencia_dia_delete_director ON public.novedades_asistencia_dia FOR DELETE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY novedades_asistencia_dia_insert_director ON public.novedades_asistencia_dia FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id()) AND (registrado_por = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = novedades_asistencia_dia.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = novedades_asistencia_dia.estudiante_id) AND (e.curso_id = novedades_asistencia_dia.curso_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY novedades_asistencia_dia_select_director ON public.novedades_asistencia_dia FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: novedades_asistencia_dia novedades_asistencia_dia_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY novedades_asistencia_dia_update_director ON public.novedades_asistencia_dia FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id()))) WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id()) AND (registrado_por = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.cursos c
  WHERE ((c.id = novedades_asistencia_dia.curso_id) AND (c.colegio_id = public.mi_colegio_id())))) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = novedades_asistencia_dia.estudiante_id) AND (e.curso_id = novedades_asistencia_dia.curso_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: pagos_mensualidad pagos_insert_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_insert_secretaria ON public.pagos_mensualidad FOR INSERT WITH CHECK ((public.es_secretaria() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = pagos_mensualidad.estudiante_id) AND (e.colegio_id = public.mi_colegio_id())))) AND (EXISTS ( SELECT 1
   FROM public.colegios c
  WHERE ((c.id = public.mi_colegio_id()) AND (c.plan = 'avanzado'::text) AND (c.finanzas_habilitado = true))))));


--
-- Name: pagos_mensualidad pagos_insert_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_insert_tutor ON public.pagos_mensualidad FOR INSERT WITH CHECK (((tutor_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.tutor_estudiante
  WHERE ((tutor_estudiante.tutor_id = auth.uid()) AND (tutor_estudiante.estudiante_id = pagos_mensualidad.estudiante_id) AND (tutor_estudiante.activo = true)))) AND (estado = 'pendiente'::text)));


--
-- Name: pagos_mensualidad; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos_mensualidad ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos_mensualidad pagos_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_select_director ON public.pagos_mensualidad FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: pagos_mensualidad pagos_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_select_secretaria ON public.pagos_mensualidad FOR SELECT USING ((public.es_secretaria() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: pagos_mensualidad pagos_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_select_tutor ON public.pagos_mensualidad FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.estudiante_id = pagos_mensualidad.estudiante_id) AND (te.tutor_id = auth.uid()) AND (te.activo = true)))));


--
-- Name: pagos_mensualidad pagos_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_update_director ON public.pagos_mensualidad FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM public.colegios c
  WHERE ((c.id = public.mi_colegio_id()) AND (c.plan = 'avanzado'::text) AND (c.finanzas_habilitado = true))))));


--
-- Name: pagos_mensualidad pagos_update_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pagos_update_secretaria ON public.pagos_mensualidad FOR UPDATE USING ((public.es_secretaria() AND (colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM public.colegios c
  WHERE ((c.id = public.mi_colegio_id()) AND (c.plan = 'avanzado'::text) AND (c.finanzas_habilitado = true))))));


--
-- Name: permisos_usuario permisos_delete_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permisos_delete_director ON public.permisos_usuario FOR DELETE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: permisos_usuario permisos_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permisos_insert_director ON public.permisos_usuario FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id()) AND (EXISTS ( SELECT 1
   FROM public.usuarios u
  WHERE ((u.id = permisos_usuario.usuario_id) AND (u.colegio_id = public.mi_colegio_id()) AND (u.rol = ANY (ARRAY['secretaria'::text, 'regente'::text])))))));


--
-- Name: permisos_usuario permisos_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permisos_select_director ON public.permisos_usuario FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: permisos_usuario permisos_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permisos_select_propio ON public.permisos_usuario FOR SELECT USING ((usuario_id = auth.uid()));


--
-- Name: permisos_usuario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permisos_usuario ENABLE ROW LEVEL SECURITY;

--
-- Name: porteria_alertas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.porteria_alertas ENABLE ROW LEVEL SECURITY;

--
-- Name: porteria_alertas porteria_alertas_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_alertas_select_director ON public.porteria_alertas FOR SELECT USING (((colegio_id = public.mi_colegio_id()) AND public.es_director()));


--
-- Name: porteria_alertas porteria_alertas_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_alertas_select_estudiante ON public.porteria_alertas FOR SELECT USING (((estudiante_id = auth.uid()) AND (tipo <> 'duplicado'::text)));


--
-- Name: porteria_alertas porteria_alertas_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_alertas_select_tutor ON public.porteria_alertas FOR SELECT USING (((tipo <> 'duplicado'::text) AND (EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.estudiante_id = porteria_alertas.estudiante_id) AND (te.tutor_id = auth.uid()) AND (te.activo = true))))));


--
-- Name: porteria_horarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.porteria_horarios ENABLE ROW LEVEL SECURITY;

--
-- Name: porteria_horarios_grado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.porteria_horarios_grado ENABLE ROW LEVEL SECURITY;

--
-- Name: porteria_horarios_grado porteria_horarios_grado_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_horarios_grado_select ON public.porteria_horarios_grado FOR SELECT USING (((colegio_id = public.mi_colegio_id()) AND (public.es_director() OR public.es_regente())));


--
-- Name: porteria_horarios porteria_horarios_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_horarios_select ON public.porteria_horarios FOR SELECT USING (((colegio_id = public.mi_colegio_id()) AND (public.es_director() OR public.es_regente())));


--
-- Name: porteria_qr; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.porteria_qr ENABLE ROW LEVEL SECURITY;

--
-- Name: porteria_qr porteria_qr_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_qr_select_director ON public.porteria_qr FOR SELECT USING (((colegio_id = public.mi_colegio_id()) AND public.es_director()));


--
-- Name: asistencia_porteria porteria_reg_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_reg_select_director ON public.asistencia_porteria FOR SELECT USING (((colegio_id = public.mi_colegio_id()) AND public.es_director()));


--
-- Name: asistencia_porteria porteria_reg_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_reg_select_estudiante ON public.asistencia_porteria FOR SELECT USING (((estudiante_id = auth.uid()) AND (NOT duplicado)));


--
-- Name: asistencia_porteria porteria_reg_select_regente; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_reg_select_regente ON public.asistencia_porteria FOR SELECT USING ((public.es_regente() AND (registrado_por = auth.uid()) AND (created_at > (now() - '24:00:00'::interval))));


--
-- Name: asistencia_porteria porteria_reg_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY porteria_reg_select_tutor ON public.asistencia_porteria FOR SELECT USING (((NOT duplicado) AND (EXISTS ( SELECT 1
   FROM public.tutor_estudiante te
  WHERE ((te.estudiante_id = asistencia_porteria.estudiante_id) AND (te.tutor_id = auth.uid()) AND (te.activo = true))))));


--
-- Name: asistencia_qr_llamadas qr_llamadas_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qr_llamadas_select_director ON public.asistencia_qr_llamadas FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.usuarios u
  WHERE ((u.id = auth.uid()) AND (u.rol = 'director'::text) AND (u.colegio_id = asistencia_qr_llamadas.colegio_id)))));


--
-- Name: asistencia_qr_llamadas qr_llamadas_select_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qr_llamadas_select_profesor ON public.asistencia_qr_llamadas FOR SELECT USING ((profesor_id = auth.uid()));


--
-- Name: respuestas_evaluacion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.respuestas_evaluacion ENABLE ROW LEVEL SECURITY;

--
-- Name: respuestas_evaluacion respuestas_insert_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY respuestas_insert_estudiante ON public.respuestas_evaluacion FOR INSERT WITH CHECK ((public.es_estudiante() AND (estudiante_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.evaluaciones_docente e
  WHERE ((e.id = respuestas_evaluacion.evaluacion_id) AND (e.activa = true)))) AND (EXISTS ( SELECT 1
   FROM (public.asignaciones_profesor ap
     JOIN public.estudiantes est ON ((est.curso_id = ap.curso_id)))
  WHERE ((ap.profesor_id = respuestas_evaluacion.profesor_id) AND (est.id = auth.uid()) AND (ap.activo = true)))) AND public.evaluacion_es_de_mi_colegio(evaluacion_id)));


--
-- Name: respuestas_evaluacion respuestas_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY respuestas_select_director ON public.respuestas_evaluacion FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = respuestas_evaluacion.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: respuestas_evaluacion respuestas_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY respuestas_select_estudiante ON public.respuestas_evaluacion FOR SELECT USING ((estudiante_id = auth.uid()));


--
-- Name: revisiones_pago revisiones_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revisiones_insert_director ON public.revisiones_pago FOR INSERT WITH CHECK ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.pagos_mensualidad p
  WHERE ((p.id = revisiones_pago.pago_id) AND (p.colegio_id = public.mi_colegio_id()))))));


--
-- Name: revisiones_pago revisiones_insert_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revisiones_insert_secretaria ON public.revisiones_pago FOR INSERT WITH CHECK ((public.es_secretaria() AND (EXISTS ( SELECT 1
   FROM public.pagos_mensualidad p
  WHERE ((p.id = revisiones_pago.pago_id) AND (p.colegio_id = public.mi_colegio_id()))))));


--
-- Name: revisiones_pago; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revisiones_pago ENABLE ROW LEVEL SECURITY;

--
-- Name: revisiones_pago revisiones_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revisiones_select_director ON public.revisiones_pago FOR SELECT USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.pagos_mensualidad p
  WHERE ((p.id = revisiones_pago.pago_id) AND (p.colegio_id = public.mi_colegio_id()))))));


--
-- Name: revisiones_pago revisiones_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revisiones_select_secretaria ON public.revisiones_pago FOR SELECT USING ((public.es_secretaria() AND (EXISTS ( SELECT 1
   FROM public.pagos_mensualidad p
  WHERE ((p.id = revisiones_pago.pago_id) AND (p.colegio_id = public.mi_colegio_id()))))));


--
-- Name: revisiones_pago revisiones_select_tutor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY revisiones_select_tutor ON public.revisiones_pago FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.pagos_mensualidad
  WHERE ((pagos_mensualidad.id = revisiones_pago.pago_id) AND (pagos_mensualidad.tutor_id = auth.uid())))));


--
-- Name: rubrica_calificaciones rubrica_calif_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rubrica_calif_select ON public.rubrica_calificaciones FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (((public.notas n
     JOIN public.actividades a ON ((a.id = n.actividad_id)))
     JOIN public.materias m ON ((m.id = a.materia_id)))
     JOIN public.cursos c ON ((c.id = a.curso_id)))
  WHERE ((n.id = rubrica_calificaciones.nota_id) AND ((n.estudiante_id = auth.uid()) OR (public.es_director() AND (c.colegio_id = public.mi_colegio_id())) OR (EXISTS ( SELECT 1
           FROM public.asignaciones_profesor ap
          WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.activo = true) AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id)) OR ((m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
                   FROM public.inscripciones_tecnicas it
                  WHERE ((it.estudiante_id = n.estudiante_id) AND (it.materia_id = a.materia_id) AND (it.activo = true))))))))))))));


--
-- Name: rubrica_calificaciones rubrica_calif_write_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rubrica_calif_write_profesor ON public.rubrica_calificaciones USING ((EXISTS ( SELECT 1
   FROM ((public.notas n
     JOIN public.actividades a ON ((a.id = n.actividad_id)))
     JOIN public.cursos c ON ((c.id = a.curso_id)))
  WHERE ((n.id = rubrica_calificaciones.nota_id) AND (a.creado_por = auth.uid()) AND (c.colegio_id = public.mi_colegio_id())))));


--
-- Name: rubrica_calificaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rubrica_calificaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: rubrica_criterios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rubrica_criterios ENABLE ROW LEVEL SECURITY;

--
-- Name: rubrica_criterios rubrica_criterios_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rubrica_criterios_select ON public.rubrica_criterios FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.actividades a
     JOIN public.materias m ON ((m.id = a.materia_id)))
     JOIN public.cursos c ON ((c.id = a.curso_id)))
  WHERE ((a.id = rubrica_criterios.actividad_id) AND (c.colegio_id = public.mi_colegio_id()) AND (public.es_director() OR (public.es_estudiante() AND (m.es_tecnica IS NOT TRUE) AND (EXISTS ( SELECT 1
           FROM public.estudiantes e
          WHERE ((e.id = auth.uid()) AND (e.curso_id = a.curso_id))))) OR (public.es_estudiante() AND (m.es_tecnica IS TRUE) AND (EXISTS ( SELECT 1
           FROM public.inscripciones_tecnicas it
          WHERE ((it.estudiante_id = auth.uid()) AND (it.materia_id = a.materia_id) AND (it.activo = true))))) OR (EXISTS ( SELECT 1
           FROM public.asignaciones_profesor ap
          WHERE ((ap.profesor_id = auth.uid()) AND (ap.materia_id = a.materia_id) AND (ap.activo = true) AND (((m.es_tecnica IS NOT TRUE) AND (ap.curso_id = a.curso_id)) OR (m.es_tecnica IS TRUE))))))))));


--
-- Name: rubrica_criterios rubrica_criterios_write_profesor; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rubrica_criterios_write_profesor ON public.rubrica_criterios USING ((EXISTS ( SELECT 1
   FROM (public.actividades a
     JOIN public.cursos c ON ((c.id = a.curso_id)))
  WHERE ((a.id = rubrica_criterios.actividad_id) AND (a.creado_por = auth.uid()) AND (c.colegio_id = public.mi_colegio_id())))));


--
-- Name: rubrica_plantillas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rubrica_plantillas ENABLE ROW LEVEL SECURITY;

--
-- Name: rubrica_plantillas rubrica_plantillas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rubrica_plantillas_select ON public.rubrica_plantillas FOR SELECT USING (((colegio_id IS NULL) OR (colegio_id = public.mi_colegio_id())));


--
-- Name: tareas_vistas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tareas_vistas ENABLE ROW LEVEL SECURITY;

--
-- Name: tareas_vistas tareas_vistas_insert_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tareas_vistas_insert_propio ON public.tareas_vistas FOR INSERT TO authenticated WITH CHECK ((estudiante_id = auth.uid()));


--
-- Name: tareas_vistas tareas_vistas_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tareas_vistas_select_propio ON public.tareas_vistas FOR SELECT TO authenticated USING ((estudiante_id = auth.uid()));


--
-- Name: telegram_vinculos telegram_select_estudiante; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_select_estudiante ON public.telegram_vinculos FOR SELECT USING ((((estudiante_id = auth.uid()) OR public.es_director()) AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = telegram_vinculos.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: telegram_vinculos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_vinculos ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_vinculos telegram_write_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_write_director ON public.telegram_vinculos USING ((public.es_director() AND (EXISTS ( SELECT 1
   FROM public.estudiantes e
  WHERE ((e.id = telegram_vinculos.estudiante_id) AND (e.colegio_id = public.mi_colegio_id()))))));


--
-- Name: tutor_estudiante; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_estudiante ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_estudiante tutor_estudiante_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_estudiante_select_director ON public.tutor_estudiante FOR SELECT USING ((public.es_director() AND (public.colegio_de_estudiante(estudiante_id) = public.mi_colegio_id())));


--
-- Name: tutor_estudiante tutor_estudiante_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_estudiante_select_propio ON public.tutor_estudiante FOR SELECT USING ((tutor_id = auth.uid()));


--
-- Name: tutor_estudiante tutor_estudiante_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_estudiante_select_secretaria ON public.tutor_estudiante FOR SELECT USING ((public.es_secretaria() AND (public.colegio_de_estudiante(estudiante_id) = public.mi_colegio_id())));


--
-- Name: tutor_estudiante tutor_estudiante_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutor_estudiante_update_director ON public.tutor_estudiante FOR UPDATE USING ((public.es_director() AND (public.colegio_de_estudiante(estudiante_id) = public.mi_colegio_id())));


--
-- Name: tutor_verificacion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_verificacion ENABLE ROW LEVEL SECURITY;

--
-- Name: tutores_familia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutores_familia ENABLE ROW LEVEL SECURITY;

--
-- Name: tutores_familia tutores_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutores_insert_director ON public.tutores_familia FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: tutores_familia tutores_insert_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutores_insert_propio ON public.tutores_familia FOR INSERT WITH CHECK ((id = auth.uid()));


--
-- Name: tutores_familia tutores_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutores_select_director ON public.tutores_familia FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: tutores_familia tutores_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutores_select_propio ON public.tutores_familia FOR SELECT USING ((id = auth.uid()));


--
-- Name: tutores_familia tutores_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutores_select_secretaria ON public.tutores_familia FOR SELECT USING ((public.es_secretaria() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: tutores_familia tutores_update_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutores_update_propio ON public.tutores_familia FOR UPDATE USING ((id = auth.uid()));


--
-- Name: tutoriales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutoriales ENABLE ROW LEVEL SECURITY;

--
-- Name: tutoriales tutoriales_delete_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutoriales_delete_superadmin ON public.tutoriales FOR DELETE TO authenticated USING (public.es_superadmin());


--
-- Name: tutoriales tutoriales_insert_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutoriales_insert_superadmin ON public.tutoriales FOR INSERT TO authenticated WITH CHECK (public.es_superadmin());


--
-- Name: tutoriales tutoriales_select_rol; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutoriales_select_rol ON public.tutoriales FOR SELECT TO authenticated USING (((publicado = true) AND (rol = public.tutoriales_rol_actual())));


--
-- Name: tutoriales tutoriales_select_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutoriales_select_superadmin ON public.tutoriales FOR SELECT TO authenticated USING (public.es_superadmin());


--
-- Name: tutoriales tutoriales_update_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tutoriales_update_superadmin ON public.tutoriales FOR UPDATE TO authenticated USING (public.es_superadmin()) WITH CHECK (public.es_superadmin());


--
-- Name: usuarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

--
-- Name: usuarios usuarios_insert_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_insert_director ON public.usuarios FOR INSERT WITH CHECK ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: usuarios usuarios_select_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_select_director ON public.usuarios FOR SELECT USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: usuarios usuarios_select_mismo_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_select_mismo_colegio ON public.usuarios FOR SELECT USING ((public.es_estudiante() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: usuarios usuarios_select_profesor_estudiantes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_select_profesor_estudiantes ON public.usuarios FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.estudiantes e
     JOIN public.asignaciones_profesor ap ON ((ap.curso_id = e.curso_id)))
  WHERE ((e.id = usuarios.id) AND (ap.profesor_id = auth.uid()) AND (ap.activo = true)))));


--
-- Name: usuarios usuarios_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_select_propio ON public.usuarios FOR SELECT USING ((id = auth.uid()));


--
-- Name: usuarios usuarios_select_secretaria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_select_secretaria ON public.usuarios FOR SELECT USING ((public.es_secretaria() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: usuarios usuarios_select_tutor_colegio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_select_tutor_colegio ON public.usuarios FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.tutores_familia tf
  WHERE ((tf.id = auth.uid()) AND (tf.colegio_id = usuarios.colegio_id)))));


--
-- Name: usuarios usuarios_update_director; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usuarios_update_director ON public.usuarios FOR UPDATE USING ((public.es_director() AND (colegio_id = public.mi_colegio_id())));


--
-- Name: tutor_verificacion verif_select_propio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY verif_select_propio ON public.tutor_verificacion FOR SELECT USING ((tutor_id = auth.uid()));


--
-- Name: tutor_verificacion verif_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY verif_select_staff ON public.tutor_verificacion FOR SELECT USING ((public.tiene_permiso('vinculos.revisar'::text) AND (EXISTS ( SELECT 1
   FROM public.tutores_familia tf
  WHERE ((tf.id = tutor_verificacion.tutor_id) AND (tf.colegio_id = public.mi_colegio_id()))))));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _siguiente_email_libre(p_colegio_id uuid, p_nombre text, p_marca text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._siguiente_email_libre(p_colegio_id uuid, p_nombre text, p_marca text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._siguiente_email_libre(p_colegio_id uuid, p_nombre text, p_marca text) TO service_role;


--
-- Name: FUNCTION abrir_llamada_qr(p_curso_id uuid, p_materia_id uuid, p_sesion text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.abrir_llamada_qr(p_curso_id uuid, p_materia_id uuid, p_sesion text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abrir_llamada_qr(p_curso_id uuid, p_materia_id uuid, p_sesion text) TO authenticated;
GRANT ALL ON FUNCTION public.abrir_llamada_qr(p_curso_id uuid, p_materia_id uuid, p_sesion text) TO service_role;


--
-- Name: FUNCTION anotar_motivo_porteria(p_registro_id uuid, p_motivo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.anotar_motivo_porteria(p_registro_id uuid, p_motivo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.anotar_motivo_porteria(p_registro_id uuid, p_motivo text) TO authenticated;
GRANT ALL ON FUNCTION public.anotar_motivo_porteria(p_registro_id uuid, p_motivo text) TO service_role;


--
-- Name: FUNCTION asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date) TO anon;
GRANT ALL ON FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date) TO authenticated;
GRANT ALL ON FUNCTION public.asesor_asistencia_curso(p_curso_id uuid, p_desde date, p_hasta date) TO service_role;


--
-- Name: FUNCTION asesor_datos_libreta(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.asesor_datos_libreta(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.asesor_datos_libreta(p_curso_id uuid) TO anon;
GRANT ALL ON FUNCTION public.asesor_datos_libreta(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.asesor_datos_libreta(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION asesor_notas_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.asesor_notas_curso(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.asesor_notas_curso(p_curso_id uuid) TO anon;
GRANT ALL ON FUNCTION public.asesor_notas_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.asesor_notas_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid) TO anon;
GRANT ALL ON FUNCTION public.asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.asignar_asesor_curso(p_curso_id uuid, p_profesor_id uuid) TO service_role;


--
-- Name: FUNCTION asignar_rol_privilegiado(p_usuario_id uuid, p_rol text, p_colegio_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.asignar_rol_privilegiado(p_usuario_id uuid, p_rol text, p_colegio_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.asignar_rol_privilegiado(p_usuario_id uuid, p_rol text, p_colegio_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.asignar_rol_privilegiado(p_usuario_id uuid, p_rol text, p_colegio_id uuid) TO service_role;


--
-- Name: FUNCTION "año_gestion_vigente"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public."año_gestion_vigente"() FROM PUBLIC;
GRANT ALL ON FUNCTION public."año_gestion_vigente"() TO anon;
GRANT ALL ON FUNCTION public."año_gestion_vigente"() TO authenticated;
GRANT ALL ON FUNCTION public."año_gestion_vigente"() TO service_role;


--
-- Name: FUNCTION buscar_estudiante_por_carnet(p_carnet text, p_colegio_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.buscar_estudiante_por_carnet(p_carnet text, p_colegio_id uuid) TO anon;
GRANT ALL ON FUNCTION public.buscar_estudiante_por_carnet(p_carnet text, p_colegio_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.buscar_estudiante_por_carnet(p_carnet text, p_colegio_id uuid) TO service_role;


--
-- Name: FUNCTION cancelar_licencia(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancelar_licencia(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_licencia(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancelar_licencia(p_id uuid) TO service_role;


--
-- Name: FUNCTION cerrar_llamada_qr(p_llamada_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cerrar_llamada_qr(p_llamada_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cerrar_llamada_qr(p_llamada_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cerrar_llamada_qr(p_llamada_id uuid) TO service_role;


--
-- Name: FUNCTION colegio_de_estudiante(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.colegio_de_estudiante(p_estudiante_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.colegio_de_estudiante(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.colegio_de_estudiante(p_estudiante_id uuid) TO service_role;


--
-- Name: TABLE colegios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.colegios TO anon;
GRANT ALL ON TABLE public.colegios TO authenticated;
GRANT ALL ON TABLE public.colegios TO service_role;


--
-- Name: TABLE colegios_publico; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.colegios_publico TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.colegios_publico TO authenticated;
GRANT ALL ON TABLE public.colegios_publico TO service_role;


--
-- Name: FUNCTION colegio_por_subdominio(p text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.colegio_por_subdominio(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.colegio_por_subdominio(p text) TO anon;
GRANT ALL ON FUNCTION public.colegio_por_subdominio(p text) TO authenticated;
GRANT ALL ON FUNCTION public.colegio_por_subdominio(p text) TO service_role;


--
-- Name: FUNCTION comunicado_dirigido_a_mi(p_comunicado_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.comunicado_dirigido_a_mi(p_comunicado_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.comunicado_dirigido_a_mi(p_comunicado_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.comunicado_dirigido_a_mi(p_comunicado_id uuid) TO service_role;


--
-- Name: FUNCTION comunicado_dirigido_a_mi_hijo(p_comunicado_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.comunicado_dirigido_a_mi_hijo(p_comunicado_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.comunicado_dirigido_a_mi_hijo(p_comunicado_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.comunicado_dirigido_a_mi_hijo(p_comunicado_id uuid) TO service_role;


--
-- Name: FUNCTION comunicado_es_de_mi_hijo(p_comunicado_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.comunicado_es_de_mi_hijo(p_comunicado_estudiante_id uuid) TO anon;
GRANT ALL ON FUNCTION public.comunicado_es_de_mi_hijo(p_comunicado_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.comunicado_es_de_mi_hijo(p_comunicado_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION copiar_config_colegio_base(nuevo_colegio_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id uuid) TO authenticated;


--
-- Name: FUNCTION entregas_max_dos(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.entregas_max_dos() TO anon;
GRANT ALL ON FUNCTION public.entregas_max_dos() TO authenticated;
GRANT ALL ON FUNCTION public.entregas_max_dos() TO service_role;


--
-- Name: FUNCTION enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]) TO service_role;


--
-- Name: FUNCTION es_asesor_activo_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.es_asesor_activo_curso(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.es_asesor_activo_curso(p_curso_id uuid) TO anon;
GRANT ALL ON FUNCTION public.es_asesor_activo_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.es_asesor_activo_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION es_director(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_director() TO anon;
GRANT ALL ON FUNCTION public.es_director() TO authenticated;
GRANT ALL ON FUNCTION public.es_director() TO service_role;


--
-- Name: FUNCTION es_estudiante(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_estudiante() TO anon;
GRANT ALL ON FUNCTION public.es_estudiante() TO authenticated;
GRANT ALL ON FUNCTION public.es_estudiante() TO service_role;


--
-- Name: FUNCTION es_profesor(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_profesor() TO anon;
GRANT ALL ON FUNCTION public.es_profesor() TO authenticated;
GRANT ALL ON FUNCTION public.es_profesor() TO service_role;


--
-- Name: FUNCTION es_regente(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.es_regente() FROM PUBLIC;
GRANT ALL ON FUNCTION public.es_regente() TO authenticated;
GRANT ALL ON FUNCTION public.es_regente() TO service_role;


--
-- Name: FUNCTION es_secretaria(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_secretaria() TO anon;
GRANT ALL ON FUNCTION public.es_secretaria() TO authenticated;
GRANT ALL ON FUNCTION public.es_secretaria() TO service_role;


--
-- Name: FUNCTION es_superadmin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_superadmin() TO anon;
GRANT ALL ON FUNCTION public.es_superadmin() TO authenticated;
GRANT ALL ON FUNCTION public.es_superadmin() TO service_role;


--
-- Name: FUNCTION es_tutor(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.es_tutor() TO anon;
GRANT ALL ON FUNCTION public.es_tutor() TO authenticated;
GRANT ALL ON FUNCTION public.es_tutor() TO service_role;


--
-- Name: FUNCTION estado_foto_estudiante(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estado_foto_estudiante(p_estudiante_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estado_foto_estudiante(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.estado_foto_estudiante(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION evaluacion_es_de_mi_colegio(p_evaluacion_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.evaluacion_es_de_mi_colegio(p_evaluacion_id uuid) TO anon;
GRANT ALL ON FUNCTION public.evaluacion_es_de_mi_colegio(p_evaluacion_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.evaluacion_es_de_mi_colegio(p_evaluacion_id uuid) TO service_role;


--
-- Name: FUNCTION fix_confirmation_tokens(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fix_confirmation_tokens() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fix_confirmation_tokens() TO service_role;


--
-- Name: FUNCTION fotos_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fotos_curso(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fotos_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fotos_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION generar_email_estudiante(p_colegio_id uuid, p_nombre text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generar_email_estudiante(p_colegio_id uuid, p_nombre text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generar_email_estudiante(p_colegio_id uuid, p_nombre text) TO service_role;


--
-- Name: FUNCTION generar_email_profesor(p_nombre text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generar_email_profesor(p_nombre text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generar_email_profesor(p_nombre text) TO authenticated;
GRANT ALL ON FUNCTION public.generar_email_profesor(p_nombre text) TO service_role;


--
-- Name: FUNCTION generar_qr_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generar_qr_curso(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generar_qr_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.generar_qr_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION "get_config_año"("p_año" integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public."get_config_año"("p_año" integer) TO anon;
GRANT ALL ON FUNCTION public."get_config_año"("p_año" integer) TO authenticated;
GRANT ALL ON FUNCTION public."get_config_año"("p_año" integer) TO service_role;


--
-- Name: FUNCTION guardar_foto_estudiante(p_estudiante_id uuid, p_path text, p_reemplazar boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardar_foto_estudiante(p_estudiante_id uuid, p_path text, p_reemplazar boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardar_foto_estudiante(p_estudiante_id uuid, p_path text, p_reemplazar boolean) TO authenticated;
GRANT ALL ON FUNCTION public.guardar_foto_estudiante(p_estudiante_id uuid, p_path text, p_reemplazar boolean) TO service_role;


--
-- Name: FUNCTION guardar_horario_grado_porteria(p_turno text, p_nivel text, p_grados integer[], p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardar_horario_grado_porteria(p_turno text, p_nivel text, p_grados integer[], p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardar_horario_grado_porteria(p_turno text, p_nivel text, p_grados integer[], p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.guardar_horario_grado_porteria(p_turno text, p_nivel text, p_grados integer[], p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone) TO service_role;


--
-- Name: FUNCTION guardar_horario_porteria(p_turno text, p_nivel text, p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone, p_activo boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guardar_horario_porteria(p_turno text, p_nivel text, p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone, p_activo boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guardar_horario_porteria(p_turno text, p_nivel text, p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone, p_activo boolean) TO authenticated;
GRANT ALL ON FUNCTION public.guardar_horario_porteria(p_turno text, p_nivel text, p_hora_entrada time without time zone, p_tolerancia_min integer, p_hora_salida time without time zone, p_activo boolean) TO service_role;


--
-- Name: FUNCTION guardar_rubrica_criterios(p_actividad_id uuid, p_criterios jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guardar_rubrica_criterios(p_actividad_id uuid, p_criterios jsonb) TO anon;
GRANT ALL ON FUNCTION public.guardar_rubrica_criterios(p_actividad_id uuid, p_criterios jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.guardar_rubrica_criterios(p_actividad_id uuid, p_criterios jsonb) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION hoy_bolivia(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.hoy_bolivia() TO anon;
GRANT ALL ON FUNCTION public.hoy_bolivia() TO authenticated;
GRANT ALL ON FUNCTION public.hoy_bolivia() TO service_role;


--
-- Name: FUNCTION justificar_alerta_porteria(p_alerta_id uuid, p_motivo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.justificar_alerta_porteria(p_alerta_id uuid, p_motivo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.justificar_alerta_porteria(p_alerta_id uuid, p_motivo text) TO authenticated;
GRANT ALL ON FUNCTION public.justificar_alerta_porteria(p_alerta_id uuid, p_motivo text) TO service_role;


--
-- Name: FUNCTION marcar_comunicado_leido_tutor(p_ce_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.marcar_comunicado_leido_tutor(p_ce_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.marcar_comunicado_leido_tutor(p_ce_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.marcar_comunicado_leido_tutor(p_ce_id uuid) TO service_role;


--
-- Name: FUNCTION marcar_egresado(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.marcar_egresado(p_estudiante_id uuid) TO anon;
GRANT ALL ON FUNCTION public.marcar_egresado(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.marcar_egresado(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION mi_asesoria_curso(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mi_asesoria_curso() FROM PUBLIC;
GRANT ALL ON FUNCTION public.mi_asesoria_curso() TO anon;
GRANT ALL ON FUNCTION public.mi_asesoria_curso() TO authenticated;
GRANT ALL ON FUNCTION public.mi_asesoria_curso() TO service_role;


--
-- Name: FUNCTION mi_colegio_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mi_colegio_id() TO anon;
GRANT ALL ON FUNCTION public.mi_colegio_id() TO authenticated;
GRANT ALL ON FUNCTION public.mi_colegio_id() TO service_role;


--
-- Name: FUNCTION mi_curso_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mi_curso_id() TO anon;
GRANT ALL ON FUNCTION public.mi_curso_id() TO authenticated;
GRANT ALL ON FUNCTION public.mi_curso_id() TO service_role;


--
-- Name: FUNCTION notas_de_mi_hijo(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notas_de_mi_hijo(p_estudiante_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notas_de_mi_hijo(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.notas_de_mi_hijo(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION porteria_activa(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.porteria_activa() FROM PUBLIC;
GRANT ALL ON FUNCTION public.porteria_activa() TO authenticated;
GRANT ALL ON FUNCTION public.porteria_activa() TO service_role;


--
-- Name: FUNCTION porteria_cruce_dia(p_fecha date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.porteria_cruce_dia(p_fecha date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.porteria_cruce_dia(p_fecha date) TO authenticated;
GRANT ALL ON FUNCTION public.porteria_cruce_dia(p_fecha date) TO service_role;


--
-- Name: FUNCTION porteria_ingreso_hoy_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.porteria_ingreso_hoy_curso(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.porteria_ingreso_hoy_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.porteria_ingreso_hoy_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.porteria_ingreso_hoy_estudiantes(p_estudiante_ids uuid[]) TO service_role;


--
-- Name: FUNCTION porteria_lista_escaner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.porteria_lista_escaner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.porteria_lista_escaner() TO authenticated;
GRANT ALL ON FUNCTION public.porteria_lista_escaner() TO service_role;


--
-- Name: FUNCTION porteria_resumen_dia(p_fecha date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.porteria_resumen_dia(p_fecha date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.porteria_resumen_dia(p_fecha date) TO authenticated;
GRANT ALL ON FUNCTION public.porteria_resumen_dia(p_fecha date) TO service_role;


--
-- Name: FUNCTION profesor_asignado_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profesor_asignado_curso(p_curso_id uuid) TO anon;
GRANT ALL ON FUNCTION public.profesor_asignado_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.profesor_asignado_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION profesor_asignado_materia(p_materia_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profesor_asignado_materia(p_materia_id uuid) TO anon;
GRANT ALL ON FUNCTION public.profesor_asignado_materia(p_materia_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.profesor_asignado_materia(p_materia_id uuid) TO service_role;


--
-- Name: FUNCTION profesor_dicta_actividad(p_actividad_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profesor_dicta_actividad(p_actividad_id uuid) TO anon;
GRANT ALL ON FUNCTION public.profesor_dicta_actividad(p_actividad_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.profesor_dicta_actividad(p_actividad_id uuid) TO service_role;


--
-- Name: FUNCTION profesor_es_de_mi_colegio(p_profesor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.profesor_es_de_mi_colegio(p_profesor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.profesor_es_de_mi_colegio(p_profesor_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.profesor_es_de_mi_colegio(p_profesor_id uuid) TO service_role;


--
-- Name: FUNCTION profesor_es_tutor_de_estudiante(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profesor_es_tutor_de_estudiante(p_estudiante_id uuid) TO anon;
GRANT ALL ON FUNCTION public.profesor_es_tutor_de_estudiante(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.profesor_es_tutor_de_estudiante(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION profesor_tiene_asignacion(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profesor_tiene_asignacion(p_estudiante_id uuid) TO anon;
GRANT ALL ON FUNCTION public.profesor_tiene_asignacion(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.profesor_tiene_asignacion(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION promover_estudiante(p_estudiante_id uuid, p_curso_destino_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.promover_estudiante(p_estudiante_id uuid, p_curso_destino_id uuid) TO anon;
GRANT ALL ON FUNCTION public.promover_estudiante(p_estudiante_id uuid, p_curso_destino_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.promover_estudiante(p_estudiante_id uuid, p_curso_destino_id uuid) TO service_role;


--
-- Name: FUNCTION proteger_bitacora_columnas_director(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_bitacora_columnas_director() TO anon;
GRANT ALL ON FUNCTION public.proteger_bitacora_columnas_director() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_bitacora_columnas_director() TO service_role;


--
-- Name: FUNCTION proteger_colegio_tutor(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_colegio_tutor() TO anon;
GRANT ALL ON FUNCTION public.proteger_colegio_tutor() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_colegio_tutor() TO service_role;


--
-- Name: FUNCTION proteger_comunicado_estudiante(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_comunicado_estudiante() TO anon;
GRANT ALL ON FUNCTION public.proteger_comunicado_estudiante() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_comunicado_estudiante() TO service_role;


--
-- Name: FUNCTION proteger_dominio_correo(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_dominio_correo() TO anon;
GRANT ALL ON FUNCTION public.proteger_dominio_correo() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_dominio_correo() TO service_role;


--
-- Name: FUNCTION proteger_plan_colegio(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_plan_colegio() TO anon;
GRANT ALL ON FUNCTION public.proteger_plan_colegio() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_plan_colegio() TO service_role;


--
-- Name: FUNCTION proteger_rol_superadmin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_rol_superadmin() TO anon;
GRANT ALL ON FUNCTION public.proteger_rol_superadmin() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_rol_superadmin() TO service_role;


--
-- Name: FUNCTION proteger_rubrica_calificada(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_rubrica_calificada() TO anon;
GRANT ALL ON FUNCTION public.proteger_rubrica_calificada() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_rubrica_calificada() TO service_role;


--
-- Name: FUNCTION proteger_subdominio_colegio(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.proteger_subdominio_colegio() FROM PUBLIC;
GRANT ALL ON FUNCTION public.proteger_subdominio_colegio() TO service_role;


--
-- Name: FUNCTION proteger_toggles_plan(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proteger_toggles_plan() TO anon;
GRANT ALL ON FUNCTION public.proteger_toggles_plan() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_toggles_plan() TO service_role;


--
-- Name: FUNCTION quitar_horario_grado_porteria(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.quitar_horario_grado_porteria(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.quitar_horario_grado_porteria(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.quitar_horario_grado_porteria(p_id uuid) TO service_role;


--
-- Name: FUNCTION regenerar_qr_estudiante(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.regenerar_qr_estudiante(p_estudiante_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.regenerar_qr_estudiante(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.regenerar_qr_estudiante(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION registrar_asistencia_qr(p_llamada_id uuid, p_codigo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_asistencia_qr(p_llamada_id uuid, p_codigo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_asistencia_qr(p_llamada_id uuid, p_codigo text) TO authenticated;
GRANT ALL ON FUNCTION public.registrar_asistencia_qr(p_llamada_id uuid, p_codigo text) TO service_role;


--
-- Name: FUNCTION registrar_porteria(p_client_uuid uuid, p_tipo text, p_codigo text, p_estudiante_id uuid, p_hora timestamp with time zone, p_metodo text, p_dispositivo text, p_motivo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_porteria(p_client_uuid uuid, p_tipo text, p_codigo text, p_estudiante_id uuid, p_hora timestamp with time zone, p_metodo text, p_dispositivo text, p_motivo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_porteria(p_client_uuid uuid, p_tipo text, p_codigo text, p_estudiante_id uuid, p_hora timestamp with time zone, p_metodo text, p_dispositivo text, p_motivo text) TO authenticated;
GRANT ALL ON FUNCTION public.registrar_porteria(p_client_uuid uuid, p_tipo text, p_codigo text, p_estudiante_id uuid, p_hora timestamp with time zone, p_metodo text, p_dispositivo text, p_motivo text) TO service_role;


--
-- Name: FUNCTION registrar_verificacion_tutor(p_parentesco text, p_anverso text, p_reverso text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_verificacion_tutor(p_parentesco text, p_anverso text, p_reverso text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_verificacion_tutor(p_parentesco text, p_anverso text, p_reverso text) TO authenticated;
GRANT ALL ON FUNCTION public.registrar_verificacion_tutor(p_parentesco text, p_anverso text, p_reverso text) TO service_role;


--
-- Name: FUNCTION reporte_notas_periodo(p_trimestre integer, p_nivel text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text) TO anon;
GRANT ALL ON FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text) TO authenticated;
GRANT ALL ON FUNCTION public.reporte_notas_periodo(p_trimestre integer, p_nivel text) TO service_role;


--
-- Name: FUNCTION resolver_licencia(p_id uuid, p_aprobar boolean, p_motivo text, p_nota text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolver_licencia(p_id uuid, p_aprobar boolean, p_motivo text, p_nota text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolver_licencia(p_id uuid, p_aprobar boolean, p_motivo text, p_nota text) TO authenticated;
GRANT ALL ON FUNCTION public.resolver_licencia(p_id uuid, p_aprobar boolean, p_motivo text, p_nota text) TO service_role;


--
-- Name: FUNCTION restaurar_foto_estudiante(p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restaurar_foto_estudiante(p_estudiante_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restaurar_foto_estudiante(p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.restaurar_foto_estudiante(p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION resumen_comunicados(p_desde integer, p_limite integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resumen_comunicados(p_desde integer, p_limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resumen_comunicados(p_desde integer, p_limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.resumen_comunicados(p_desde integer, p_limite integer) TO service_role;


--
-- Name: FUNCTION retirar_asesor_curso(p_curso_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retirar_asesor_curso(p_curso_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retirar_asesor_curso(p_curso_id uuid) TO anon;
GRANT ALL ON FUNCTION public.retirar_asesor_curso(p_curso_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.retirar_asesor_curso(p_curso_id uuid) TO service_role;


--
-- Name: FUNCTION revisar_vinculacion(p_tutor_id uuid, p_aceptar boolean, p_motivo text, p_nota text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revisar_vinculacion(p_tutor_id uuid, p_aceptar boolean, p_motivo text, p_nota text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revisar_vinculacion(p_tutor_id uuid, p_aceptar boolean, p_motivo text, p_nota text) TO authenticated;
GRANT ALL ON FUNCTION public.revisar_vinculacion(p_tutor_id uuid, p_aceptar boolean, p_motivo text, p_nota text) TO service_role;


--
-- Name: FUNCTION rpc_crear_director(p_id uuid, p_nombre text, p_email text, p_colegio_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_crear_director(p_id uuid, p_nombre text, p_email text, p_colegio_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_crear_director(p_id uuid, p_nombre text, p_email text, p_colegio_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.rpc_crear_director(p_id uuid, p_nombre text, p_email text, p_colegio_id uuid) TO authenticated;


--
-- Name: FUNCTION rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_delete_nota(p_actividad_id uuid, p_estudiante_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_publish_ficha(p_ficha_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_publish_ficha(p_ficha_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_publish_ficha(p_ficha_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_publish_ficha(p_ficha_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric, p_nota_decidir numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric, p_nota_decidir numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric, p_nota_decidir numeric) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_upsert_calificacion(p_estudiante_id uuid, p_materia_id uuid, p_trimestre integer, p_nota_ser numeric, p_nota_decidir numeric) TO service_role;


--
-- Name: FUNCTION rpc_upsert_nota(p_actividad_id uuid, p_estudiante_id uuid, p_valor numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_upsert_nota(p_actividad_id uuid, p_estudiante_id uuid, p_valor numeric) TO anon;
GRANT ALL ON FUNCTION public.rpc_upsert_nota(p_actividad_id uuid, p_estudiante_id uuid, p_valor numeric) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_upsert_nota(p_actividad_id uuid, p_estudiante_id uuid, p_valor numeric) TO service_role;


--
-- Name: FUNCTION rpc_upsert_notas_bulk(p_actividad_id uuid, p_notas jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_upsert_notas_bulk(p_actividad_id uuid, p_notas jsonb) TO anon;
GRANT ALL ON FUNCTION public.rpc_upsert_notas_bulk(p_actividad_id uuid, p_notas jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_upsert_notas_bulk(p_actividad_id uuid, p_notas jsonb) TO service_role;


--
-- Name: FUNCTION set_actualizado_en(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_actualizado_en() TO anon;
GRANT ALL ON FUNCTION public.set_actualizado_en() TO authenticated;
GRANT ALL ON FUNCTION public.set_actualizado_en() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION solicitar_licencia(p_estudiante_id uuid, p_motivo text, p_inicio date, p_fin date, p_descripcion text, p_comprobante text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.solicitar_licencia(p_estudiante_id uuid, p_motivo text, p_inicio date, p_fin date, p_descripcion text, p_comprobante text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.solicitar_licencia(p_estudiante_id uuid, p_motivo text, p_inicio date, p_fin date, p_descripcion text, p_comprobante text) TO authenticated;
GRANT ALL ON FUNCTION public.solicitar_licencia(p_estudiante_id uuid, p_motivo text, p_inicio date, p_fin date, p_descripcion text, p_comprobante text) TO service_role;


--
-- Name: FUNCTION sync_curso_inscripciones_tecnicas(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_curso_inscripciones_tecnicas() TO anon;
GRANT ALL ON FUNCTION public.sync_curso_inscripciones_tecnicas() TO authenticated;
GRANT ALL ON FUNCTION public.sync_curso_inscripciones_tecnicas() TO service_role;


--
-- Name: FUNCTION tiene_permiso(p_permiso text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tiene_permiso(p_permiso text) TO anon;
GRANT ALL ON FUNCTION public.tiene_permiso(p_permiso text) TO authenticated;
GRANT ALL ON FUNCTION public.tiene_permiso(p_permiso text) TO service_role;


--
-- Name: FUNCTION trg_actividad_fecha_cambiada(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_actividad_fecha_cambiada() TO anon;
GRANT ALL ON FUNCTION public.trg_actividad_fecha_cambiada() TO authenticated;
GRANT ALL ON FUNCTION public.trg_actividad_fecha_cambiada() TO service_role;


--
-- Name: FUNCTION trg_nota_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_nota_updated_at() TO anon;
GRANT ALL ON FUNCTION public.trg_nota_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.trg_nota_updated_at() TO service_role;


--
-- Name: FUNCTION trg_validar_rango_nota(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_validar_rango_nota() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_validar_rango_nota() TO service_role;


--
-- Name: FUNCTION tutoriales_rol_actual(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutoriales_rol_actual() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutoriales_rol_actual() TO authenticated;
GRANT ALL ON FUNCTION public.tutoriales_rol_actual() TO service_role;


--
-- Name: FUNCTION tutoriales_videos_validos(v jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutoriales_videos_validos(v jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutoriales_videos_validos(v jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.tutoriales_videos_validos(v jsonb) TO service_role;


--
-- Name: FUNCTION update_user_password(p_user_id uuid, p_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_user_password(p_user_id uuid, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_user_password(p_user_id uuid, p_password text) TO service_role;


--
-- Name: FUNCTION usuario_activo(p_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usuario_activo(p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.usuario_activo(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.usuario_activo(p_id uuid) TO service_role;


--
-- Name: FUNCTION validar_suma_rubrica(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validar_suma_rubrica() TO anon;
GRANT ALL ON FUNCTION public.validar_suma_rubrica() TO authenticated;
GRANT ALL ON FUNCTION public.validar_suma_rubrica() TO service_role;


--
-- Name: FUNCTION vincular_hijo_seguro(p_estudiante_id uuid, p_parentesco text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.vincular_hijo_seguro(p_estudiante_id uuid, p_parentesco text) TO anon;
GRANT ALL ON FUNCTION public.vincular_hijo_seguro(p_estudiante_id uuid, p_parentesco text) TO authenticated;
GRANT ALL ON FUNCTION public.vincular_hijo_seguro(p_estudiante_id uuid, p_parentesco text) TO service_role;


--
-- Name: TABLE actividades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.actividades TO anon;
GRANT ALL ON TABLE public.actividades TO authenticated;
GRANT ALL ON TABLE public.actividades TO service_role;


--
-- Name: TABLE asesor_curso; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asesor_curso TO authenticated;
GRANT ALL ON TABLE public.asesor_curso TO service_role;


--
-- Name: TABLE asignaciones_profesor; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asignaciones_profesor TO anon;
GRANT ALL ON TABLE public.asignaciones_profesor TO authenticated;
GRANT ALL ON TABLE public.asignaciones_profesor TO service_role;


--
-- Name: TABLE asistencia_porteria; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.asistencia_porteria TO authenticated;
GRANT ALL ON TABLE public.asistencia_porteria TO service_role;


--
-- Name: TABLE asistencia_qr_llamadas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asistencia_qr_llamadas TO anon;
GRANT ALL ON TABLE public.asistencia_qr_llamadas TO authenticated;
GRANT ALL ON TABLE public.asistencia_qr_llamadas TO service_role;


--
-- Name: TABLE asistencias_materia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asistencias_materia TO anon;
GRANT ALL ON TABLE public.asistencias_materia TO authenticated;
GRANT ALL ON TABLE public.asistencias_materia TO service_role;


--
-- Name: TABLE materias; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.materias TO anon;
GRANT ALL ON TABLE public.materias TO authenticated;
GRANT ALL ON TABLE public.materias TO service_role;


--
-- Name: TABLE asistencia_resumen_diario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asistencia_resumen_diario TO anon;
GRANT ALL ON TABLE public.asistencia_resumen_diario TO authenticated;
GRANT ALL ON TABLE public.asistencia_resumen_diario TO service_role;


--
-- Name: TABLE asistencia_resumen_profesor; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asistencia_resumen_profesor TO anon;
GRANT ALL ON TABLE public.asistencia_resumen_profesor TO authenticated;
GRANT ALL ON TABLE public.asistencia_resumen_profesor TO service_role;


--
-- Name: TABLE asistencias; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.asistencias TO anon;
GRANT ALL ON TABLE public.asistencias TO authenticated;
GRANT ALL ON TABLE public.asistencias TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE becas_estudiante; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.becas_estudiante TO anon;
GRANT ALL ON TABLE public.becas_estudiante TO authenticated;
GRANT ALL ON TABLE public.becas_estudiante TO service_role;


--
-- Name: TABLE bitacora_docente; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bitacora_docente TO anon;
GRANT ALL ON TABLE public.bitacora_docente TO authenticated;
GRANT ALL ON TABLE public.bitacora_docente TO service_role;


--
-- Name: TABLE calificaciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.calificaciones TO anon;
GRANT ALL ON TABLE public.calificaciones TO authenticated;
GRANT ALL ON TABLE public.calificaciones TO service_role;


--
-- Name: TABLE comunicados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.comunicados TO anon;
GRANT ALL ON TABLE public.comunicados TO authenticated;
GRANT ALL ON TABLE public.comunicados TO service_role;


--
-- Name: TABLE comunicados_estudiante; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.comunicados_estudiante TO anon;
GRANT ALL ON TABLE public.comunicados_estudiante TO authenticated;
GRANT ALL ON TABLE public.comunicados_estudiante TO service_role;


--
-- Name: TABLE comunicados_lectura_tutor; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.comunicados_lectura_tutor TO service_role;
GRANT SELECT ON TABLE public.comunicados_lectura_tutor TO authenticated;


--
-- Name: TABLE config_categorias_ser; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_categorias_ser TO anon;
GRANT ALL ON TABLE public.config_categorias_ser TO authenticated;
GRANT ALL ON TABLE public.config_categorias_ser TO service_role;


--
-- Name: TABLE config_dimensiones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_dimensiones TO anon;
GRANT ALL ON TABLE public.config_dimensiones TO authenticated;
GRANT ALL ON TABLE public.config_dimensiones TO service_role;


--
-- Name: TABLE config_escala_ser; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_escala_ser TO anon;
GRANT ALL ON TABLE public.config_escala_ser TO authenticated;
GRANT ALL ON TABLE public.config_escala_ser TO service_role;


--
-- Name: TABLE config_gestion; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_gestion TO anon;
GRANT ALL ON TABLE public.config_gestion TO authenticated;
GRANT ALL ON TABLE public.config_gestion TO service_role;


--
-- Name: TABLE config_mensualidad; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_mensualidad TO anon;
GRANT ALL ON TABLE public.config_mensualidad TO authenticated;
GRANT ALL ON TABLE public.config_mensualidad TO service_role;


--
-- Name: TABLE config_notificaciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_notificaciones TO anon;
GRANT ALL ON TABLE public.config_notificaciones TO authenticated;
GRANT ALL ON TABLE public.config_notificaciones TO service_role;


--
-- Name: TABLE config_preguntas_docente; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_preguntas_docente TO anon;
GRANT ALL ON TABLE public.config_preguntas_docente TO authenticated;
GRANT ALL ON TABLE public.config_preguntas_docente TO service_role;


--
-- Name: TABLE config_subcriterios_ser; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_subcriterios_ser TO anon;
GRANT ALL ON TABLE public.config_subcriterios_ser TO authenticated;
GRANT ALL ON TABLE public.config_subcriterios_ser TO service_role;


--
-- Name: TABLE cursos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cursos TO anon;
GRANT ALL ON TABLE public.cursos TO authenticated;
GRANT ALL ON TABLE public.cursos TO service_role;


--
-- Name: TABLE entregas_tareas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.entregas_tareas TO anon;
GRANT ALL ON TABLE public.entregas_tareas TO authenticated;
GRANT ALL ON TABLE public.entregas_tareas TO service_role;


--
-- Name: TABLE estudiantes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estudiantes TO anon;
GRANT ALL ON TABLE public.estudiantes TO authenticated;
GRANT ALL ON TABLE public.estudiantes TO service_role;


--
-- Name: TABLE evaluaciones_docente; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.evaluaciones_docente TO anon;
GRANT ALL ON TABLE public.evaluaciones_docente TO authenticated;
GRANT ALL ON TABLE public.evaluaciones_docente TO service_role;


--
-- Name: TABLE fichas_seguimiento_ser; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fichas_seguimiento_ser TO anon;
GRANT ALL ON TABLE public.fichas_seguimiento_ser TO authenticated;
GRANT ALL ON TABLE public.fichas_seguimiento_ser TO service_role;


--
-- Name: TABLE gestion_activa; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gestion_activa TO authenticated;
GRANT ALL ON TABLE public.gestion_activa TO service_role;


--
-- Name: TABLE historial_promociones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.historial_promociones TO anon;
GRANT ALL ON TABLE public.historial_promociones TO authenticated;
GRANT ALL ON TABLE public.historial_promociones TO service_role;


--
-- Name: TABLE inscripciones_tecnicas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inscripciones_tecnicas TO anon;
GRANT ALL ON TABLE public.inscripciones_tecnicas TO authenticated;
GRANT ALL ON TABLE public.inscripciones_tecnicas TO service_role;


--
-- Name: TABLE intentos_busqueda_carnet; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.intentos_busqueda_carnet TO anon;
GRANT ALL ON TABLE public.intentos_busqueda_carnet TO authenticated;
GRANT ALL ON TABLE public.intentos_busqueda_carnet TO service_role;


--
-- Name: TABLE licencias; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.licencias TO anon;
GRANT ALL ON TABLE public.licencias TO authenticated;
GRANT ALL ON TABLE public.licencias TO service_role;


--
-- Name: TABLE notas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notas TO anon;
GRANT ALL ON TABLE public.notas TO authenticated;
GRANT ALL ON TABLE public.notas TO service_role;


--
-- Name: TABLE usuarios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usuarios TO anon;
GRANT ALL ON TABLE public.usuarios TO authenticated;
GRANT ALL ON TABLE public.usuarios TO service_role;


--
-- Name: TABLE notas_finales; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notas_finales TO authenticated;
GRANT ALL ON TABLE public.notas_finales TO service_role;


--
-- Name: TABLE notificaciones_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notificaciones_log TO anon;
GRANT ALL ON TABLE public.notificaciones_log TO authenticated;
GRANT ALL ON TABLE public.notificaciones_log TO service_role;


--
-- Name: TABLE novedades_asistencia_dia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.novedades_asistencia_dia TO authenticated;
GRANT ALL ON TABLE public.novedades_asistencia_dia TO service_role;


--
-- Name: TABLE pagos_mensualidad; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pagos_mensualidad TO anon;
GRANT ALL ON TABLE public.pagos_mensualidad TO authenticated;
GRANT ALL ON TABLE public.pagos_mensualidad TO service_role;


--
-- Name: TABLE permisos_usuario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.permisos_usuario TO anon;
GRANT ALL ON TABLE public.permisos_usuario TO authenticated;
GRANT ALL ON TABLE public.permisos_usuario TO service_role;


--
-- Name: TABLE porteria_alertas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.porteria_alertas TO authenticated;
GRANT ALL ON TABLE public.porteria_alertas TO service_role;


--
-- Name: TABLE porteria_horarios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.porteria_horarios TO authenticated;
GRANT ALL ON TABLE public.porteria_horarios TO service_role;


--
-- Name: TABLE porteria_horarios_grado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.porteria_horarios_grado TO authenticated;
GRANT ALL ON TABLE public.porteria_horarios_grado TO service_role;


--
-- Name: TABLE porteria_qr; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.porteria_qr TO authenticated;
GRANT ALL ON TABLE public.porteria_qr TO service_role;


--
-- Name: TABLE respuestas_evaluacion; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.respuestas_evaluacion TO anon;
GRANT ALL ON TABLE public.respuestas_evaluacion TO authenticated;
GRANT ALL ON TABLE public.respuestas_evaluacion TO service_role;


--
-- Name: TABLE revisiones_pago; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.revisiones_pago TO anon;
GRANT ALL ON TABLE public.revisiones_pago TO authenticated;
GRANT ALL ON TABLE public.revisiones_pago TO service_role;


--
-- Name: TABLE rubrica_calificaciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rubrica_calificaciones TO anon;
GRANT ALL ON TABLE public.rubrica_calificaciones TO authenticated;
GRANT ALL ON TABLE public.rubrica_calificaciones TO service_role;


--
-- Name: TABLE rubrica_criterios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rubrica_criterios TO anon;
GRANT ALL ON TABLE public.rubrica_criterios TO authenticated;
GRANT ALL ON TABLE public.rubrica_criterios TO service_role;


--
-- Name: TABLE rubrica_plantillas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rubrica_plantillas TO anon;
GRANT ALL ON TABLE public.rubrica_plantillas TO authenticated;
GRANT ALL ON TABLE public.rubrica_plantillas TO service_role;


--
-- Name: TABLE tareas_vistas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tareas_vistas TO anon;
GRANT ALL ON TABLE public.tareas_vistas TO authenticated;
GRANT ALL ON TABLE public.tareas_vistas TO service_role;


--
-- Name: TABLE telegram_vinculos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_vinculos TO anon;
GRANT ALL ON TABLE public.telegram_vinculos TO authenticated;
GRANT ALL ON TABLE public.telegram_vinculos TO service_role;


--
-- Name: TABLE tutor_estudiante; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.tutor_estudiante TO anon;
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.tutor_estudiante TO authenticated;
GRANT ALL ON TABLE public.tutor_estudiante TO service_role;


--
-- Name: TABLE tutor_verificacion; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutor_verificacion TO anon;
GRANT ALL ON TABLE public.tutor_verificacion TO authenticated;
GRANT ALL ON TABLE public.tutor_verificacion TO service_role;


--
-- Name: TABLE tutores_familia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tutores_familia TO anon;
GRANT ALL ON TABLE public.tutores_familia TO authenticated;
GRANT ALL ON TABLE public.tutores_familia TO service_role;


--
-- Name: TABLE tutoriales; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.tutoriales TO authenticated;
GRANT ALL ON TABLE public.tutoriales TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- ############################################################################
-- PARTE 2 — Objetos fuera de public (auth, storage)
-- ############################################################################

-- 02_auth_storage_2026-11-24.sql
-- Línea base: objetos fuera del esquema public que pg_dump --schema=public no incluye.
-- Extraído de producción el 24-nov-2026 (pg_trigger, storage.buckets, pg_policies). Sin datos.
-- Ejecutar DESPUÉS de 01_public_2026-11-24.sql (usa handle_new_user, mi_colegio_id, es_director,
-- es_regente, es_tutor, tiene_permiso y la tabla tutores_familia del esquema public).
-- Idempotente: se puede ejecutar dos veces.

BEGIN;

SET search_path = public, storage, auth, extensions;

-- ─────────────────────────────────────────────────────────
-- 1) Trigger de alta de usuarios (auth.users → public.usuarios)
-- ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────
-- 2) Buckets
--    'tareas' queda sin políticas desde la migración 118 (consignas y entregas van a Cloudinary).
-- ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('documentos-tutores', 'documentos-tutores', false, 2097152,  '{image/jpeg,image/png,image/webp,application/pdf}'),
  ('fotos-estudiantes',  'fotos-estudiantes',  false, 512000,   '{image/jpeg}'),
  ('logos-colegios',     'logos-colegios',     true,  NULL,     NULL),
  ('tareas',             'tareas',             false, 10485760, '{application/pdf,image/jpeg,image/jpg,image/png}')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 3) Políticas de storage.objects
-- ─────────────────────────────────────────────────────────

-- documentos-tutores: carpeta propia del tutor, o personal con permiso del mismo colegio
DROP POLICY IF EXISTS doc_tutor_delete ON storage.objects;
CREATE POLICY doc_tutor_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public
USING (((bucket_id = 'documentos-tutores'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (public.tiene_permiso('vinculos.revisar'::text) AND (EXISTS ( SELECT 1
   FROM public.tutores_familia tf
  WHERE (((tf.id)::text = (storage.foldername(objects.name))[1]) AND (tf.colegio_id = public.mi_colegio_id()))))))));

DROP POLICY IF EXISTS doc_tutor_insert ON storage.objects;
CREATE POLICY doc_tutor_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public
WITH CHECK (((bucket_id = 'documentos-tutores'::text) AND public.es_tutor() AND ((storage.foldername(name))[1] = (auth.uid())::text)));

DROP POLICY IF EXISTS doc_tutor_select ON storage.objects;
CREATE POLICY doc_tutor_select ON storage.objects AS PERMISSIVE FOR SELECT TO public
USING (((bucket_id = 'documentos-tutores'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (((((storage.foldername(name))[2] = 'carnet'::text) AND public.tiene_permiso('vinculos.revisar'::text)) OR (((storage.foldername(name))[2] = 'licencias'::text) AND public.tiene_permiso('licencias.aprobar'::text))) AND (EXISTS ( SELECT 1
   FROM public.tutores_familia tf
  WHERE (((tf.id)::text = (storage.foldername(objects.name))[1]) AND (tf.colegio_id = public.mi_colegio_id()))))))));

-- fotos-estudiantes: solo director o regente, carpeta = colegio
DROP POLICY IF EXISTS fotos_est_delete ON storage.objects;
CREATE POLICY fotos_est_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
USING (((bucket_id = 'fotos-estudiantes'::text) AND (auth.uid() = owner) AND ((storage.foldername(name))[1] = (public.mi_colegio_id())::text)));

DROP POLICY IF EXISTS fotos_est_insert ON storage.objects;
CREATE POLICY fotos_est_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((bucket_id = 'fotos-estudiantes'::text) AND (public.es_director() OR public.es_regente()) AND ((storage.foldername(name))[1] = (public.mi_colegio_id())::text)));

DROP POLICY IF EXISTS fotos_est_select ON storage.objects;
CREATE POLICY fotos_est_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
USING (((bucket_id = 'fotos-estudiantes'::text) AND (public.es_director() OR public.es_regente()) AND ((storage.foldername(name))[1] = (public.mi_colegio_id())::text)));

-- logos-colegios: lectura pública (login); subida solo del director en la carpeta de su colegio
DROP POLICY IF EXISTS logos_delete ON storage.objects;
CREATE POLICY logos_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
USING (((bucket_id = 'logos-colegios'::text) AND (auth.uid() = owner)));

DROP POLICY IF EXISTS logos_read ON storage.objects;
CREATE POLICY logos_read ON storage.objects AS PERMISSIVE FOR SELECT TO public
USING ((bucket_id = 'logos-colegios'::text));

DROP POLICY IF EXISTS logos_upload ON storage.objects;
CREATE POLICY logos_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((bucket_id = 'logos-colegios'::text) AND public.es_director() AND ((storage.foldername(name))[1] = (public.mi_colegio_id())::text)));

COMMIT;


-- ############################################################################
-- PARTE 3 — Capa demo
-- ############################################################################

-- ============================================================================
-- 03_demo.sql — Capa propia del PROYECTO DEMO (no se aplica en producción)
-- Va después de 01_public y 02_auth_storage. Idempotente donde es posible.
--
-- Contiene:
--   1. Borrado en cascada en las claves foráneas (borrar un demo borra todo lo suyo)
--   2. Columnas de demo en colegios y su protección
--   3. Tope de 10 estudiantes por colegio demo
--   4. Credenciales internas de los usuarios demo (solo service_role)
--   5. Funciones públicas: demo_por_slug, demo_mi_estado, demo_listar
--   6. Funciones internas (solo service_role): crear, sembrar, registrar ingreso, eliminar
--   7. Bucket de archivos del demo (reemplaza a Cloudinary en este despliegue)
--   8. Colegio plantilla base (configuración del sistema)
-- ============================================================================

BEGIN;

SET search_path = public, extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Borrado en cascada (solo en el demo)
--    En producción las claves no borran en cascada a propósito. En el demo,
--    borrar un colegio demo (o sus usuarios) debe llevarse todo lo suyo.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tabla, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = 'public' AND c.confdeltype IN ('a', 'r')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabla, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE', r.tabla, r.conname, r.def);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Columnas de demo en colegios
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS es_demo             boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_slug           text,
  ADD COLUMN IF NOT EXISTS demo_desde          date,
  ADD COLUMN IF NOT EXISTS demo_hasta          date,
  ADD COLUMN IF NOT EXISTS demo_contacto       text,
  ADD COLUMN IF NOT EXISTS demo_creado_en      timestamptz,
  ADD COLUMN IF NOT EXISTS demo_ultimo_ingreso timestamptz,
  ADD COLUMN IF NOT EXISTS demo_roles_usados   text[]      NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE public.colegios ADD CONSTRAINT colegios_demo_slug_formato
    CHECK (demo_slug IS NULL OR demo_slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.colegios ADD CONSTRAINT colegios_demo_fechas
    CHECK (NOT es_demo OR (demo_desde IS NOT NULL AND demo_hasta IS NOT NULL AND demo_hasta >= demo_desde));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS colegios_demo_slug_uq ON public.colegios (demo_slug) WHERE demo_slug IS NOT NULL;

-- Solo el superadmin (o el servidor, sin sesión de usuario) cambia los datos del demo.
-- El director del demo puede editar nombre, logo y colores como en producción.
CREATE OR REPLACE FUNCTION public.proteger_datos_demo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.es_superadmin() AND (
       NEW.es_demo             IS DISTINCT FROM OLD.es_demo
    OR NEW.demo_slug           IS DISTINCT FROM OLD.demo_slug
    OR NEW.demo_desde          IS DISTINCT FROM OLD.demo_desde
    OR NEW.demo_hasta          IS DISTINCT FROM OLD.demo_hasta
    OR NEW.demo_contacto       IS DISTINCT FROM OLD.demo_contacto
    OR NEW.demo_creado_en      IS DISTINCT FROM OLD.demo_creado_en
    OR NEW.demo_ultimo_ingreso IS DISTINCT FROM OLD.demo_ultimo_ingreso
    OR NEW.demo_roles_usados   IS DISTINCT FROM OLD.demo_roles_usados
  ) THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar la vigencia o los datos de la prueba' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.proteger_datos_demo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_datos_demo ON public.colegios;
CREATE TRIGGER trg_proteger_datos_demo BEFORE UPDATE ON public.colegios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_datos_demo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tope de 10 estudiantes por colegio demo (lo exige la base, no solo la pantalla)
--    Bloquea la fila del colegio para que dos altas simultáneas no lleguen a 11.
--    Vale también para la Edge Function masiva (service_role no salta triggers).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tope_estudiantes_demo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_demo boolean; v_total int;
BEGIN
  IF NEW.colegio_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.colegio_id IS NOT DISTINCT FROM OLD.colegio_id THEN RETURN NEW; END IF;
  SELECT es_demo INTO v_demo FROM public.colegios WHERE id = NEW.colegio_id FOR UPDATE;
  IF NOT COALESCE(v_demo, false) THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_total FROM public.estudiantes WHERE colegio_id = NEW.colegio_id AND id <> NEW.id;
  IF v_total >= 10 THEN
    RAISE EXCEPTION 'La cuenta de prueba admite hasta 10 estudiantes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tope_estudiantes_demo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tope_estudiantes_demo ON public.estudiantes;
CREATE TRIGGER trg_tope_estudiantes_demo BEFORE INSERT OR UPDATE OF colegio_id ON public.estudiantes
  FOR EACH ROW EXECUTE FUNCTION public.tope_estudiantes_demo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Credenciales internas de los usuarios demo
--    RLS activa sin políticas y sin permisos: solo service_role (Edge Functions).
--    Las contraseñas nunca llegan al navegador.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_credenciales (
  colegio_id uuid NOT NULL REFERENCES public.colegios(id) ON DELETE CASCADE,
  clave      text NOT NULL,
  rol        text NOT NULL,
  etiqueta   text NOT NULL,
  mostrar    boolean NOT NULL DEFAULT false,
  orden      integer NOT NULL DEFAULT 0,
  usuario_id uuid NOT NULL,
  email      text NOT NULL,
  password   text NOT NULL,
  PRIMARY KEY (colegio_id, clave)
);
ALTER TABLE public.demo_credenciales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_credenciales FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Personas de cada demo (una sola fuente para la Edge Function y la siembra)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demo_personas()
RETURNS TABLE (clave text, rol text, nombre text, etiqueta text, mostrar boolean, orden int, grado int)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('director',   'director',   'Patricia Salvatierra Méndez', 'Director',          true,  1, NULL::int),
    ('profesor1',  'profesor',   'Jorge Melgar Suárez',         'Profesor de Matemática', true, 2, NULL),
    ('profesor2',  'profesor',   'Ana María Cuéllar Roca',      'Profesora de Lenguaje',  true, 3, NULL),
    ('secretaria', 'secretaria', 'Gabriela Ortiz Vaca',         'Secretaría',        true,  4, NULL),
    ('regente',    'regente',    'Marcelo Antelo Rivero',       'Regente',           true,  5, NULL),
    ('tutor',      'tutor',      'Roberto Rojas Paz',           'Padre de familia',  true,  6, NULL),
    ('est01',      'estudiante', 'Camila Rojas Vaca',           'Estudiante',        true,  7, 5),
    ('est02',      'estudiante', 'Mateo Suárez Justiniano',     'Estudiante',        false, 8, 5),
    ('est03',      'estudiante', 'Valentina Gutiérrez Añez',    'Estudiante',        false, 9, 5),
    ('est04',      'estudiante', 'Santiago Peña Cuéllar',       'Estudiante',        false, 10, 5),
    ('est05',      'estudiante', 'Luciana Mendoza Saucedo',     'Estudiante',        false, 11, 5),
    ('est06',      'estudiante', 'Sebastián Rojas Vaca',        'Estudiante',        false, 12, 6),
    ('est07',      'estudiante', 'Isabella Vargas Chávez',      'Estudiante',        false, 13, 6),
    ('est08',      'estudiante', 'Diego Flores Ribera',         'Estudiante',        false, 14, 6),
    ('est09',      'estudiante', 'Mariana Arteaga Montaño',     'Estudiante',        false, 15, 6),
    ('est10',      'estudiante', 'Joaquín Céspedes Paz',        'Estudiante',        false, 16, 6)
$$;
REVOKE ALL ON FUNCTION public.demo_personas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_personas() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Funciones públicas
-- ─────────────────────────────────────────────────────────────────────────────

-- Estado común de un colegio demo (uso interno de las funciones de abajo)
CREATE OR REPLACE FUNCTION public.demo_estado_json(p_colegio uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'colegio_id',       c.id,
    'slug',             c.demo_slug,
    'nombre',           c.nombre,
    'sigla',            c.sigla,
    'logo_url',         c.logo_url,
    'color_primario',   c.color_primario,
    'color_secundario', c.color_secundario,
    'desde',            c.demo_desde,
    'hasta',            c.demo_hasta,
    'estado', CASE
                WHEN current_date < c.demo_desde THEN 'no_iniciado'
                WHEN current_date > c.demo_hasta THEN 'vencido'
                ELSE 'vigente' END,
    'dias_restantes',   GREATEST(0, c.demo_hasta - current_date + 1),
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('clave', d.clave, 'rol', d.rol, 'etiqueta', d.etiqueta, 'nombre', u.nombre_completo)
                       ORDER BY d.orden)
      FROM public.demo_credenciales d
      LEFT JOIN public.usuarios u ON u.id = d.usuario_id
      WHERE d.colegio_id = c.id AND d.mostrar), '[]'::jsonb)
  )
  FROM public.colegios c
  WHERE c.id = p_colegio AND c.es_demo;
$$;
REVOKE ALL ON FUNCTION public.demo_estado_json(uuid) FROM PUBLIC, anon, authenticated;

-- Página de entrada: datos públicos del demo según su enlace (sin sesión)
CREATE OR REPLACE FUNCTION public.demo_por_slug(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.demo_estado_json(c.id)
  FROM public.colegios c
  WHERE c.es_demo AND c.demo_slug = lower(btrim(p_slug))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.demo_por_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.demo_por_slug(text) TO anon, authenticated, service_role;

-- Barra "Probando como": estado del demo del usuario con sesión
CREATE OR REPLACE FUNCTION public.demo_mi_estado()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.demo_estado_json(public.mi_colegio_id());
$$;
REVOKE ALL ON FUNCTION public.demo_mi_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demo_mi_estado() TO authenticated;

-- Panel del superadmin: lista de demos
CREATE OR REPLACE FUNCTION public.demo_listar()
RETURNS TABLE (
  colegio_id uuid, nombre text, slug text, contacto text, desde date, hasta date,
  estado text, dias_restantes int, creado_en timestamptz, ultimo_ingreso timestamptz,
  roles_usados text[], estudiantes int, logo_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_superadmin() THEN RAISE EXCEPTION 'Sin permisos' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT c.id, c.nombre, c.demo_slug, c.demo_contacto, c.demo_desde, c.demo_hasta,
         CASE WHEN current_date < c.demo_desde THEN 'no_iniciado'
              WHEN current_date > c.demo_hasta THEN 'vencido' ELSE 'vigente' END,
         GREATEST(0, c.demo_hasta - current_date + 1)::int,
         c.demo_creado_en, c.demo_ultimo_ingreso, c.demo_roles_usados,
         (SELECT count(*)::int FROM public.estudiantes e WHERE e.colegio_id = c.id),
         c.logo_url
  FROM public.colegios c
  WHERE c.es_demo
  ORDER BY c.demo_creado_en DESC NULLS LAST;
END $$;
REVOKE ALL ON FUNCTION public.demo_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demo_listar() TO authenticated;

-- Ampliar o cambiar la vigencia (superadmin)
CREATE OR REPLACE FUNCTION public.demo_cambiar_vigencia(p_colegio uuid, p_desde date, p_hasta date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_superadmin() THEN RAISE EXCEPTION 'Sin permisos' USING ERRCODE = '42501'; END IF;
  IF p_hasta < p_desde THEN RAISE EXCEPTION 'La fecha final no puede ser anterior a la inicial'; END IF;
  UPDATE public.colegios SET demo_desde = p_desde, demo_hasta = p_hasta
  WHERE id = p_colegio AND es_demo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demo no encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.demo_cambiar_vigencia(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demo_cambiar_vigencia(uuid, date, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Funciones internas (solo service_role: las usan las Edge Functions)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enlace legible a partir del nombre: "U.E. San José" -> "san-jose" (si existe, "san-jose-2")
CREATE OR REPLACE FUNCTION public.demo_generar_slug(p_nombre text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_base text; v_slug text; n int := 1;
  reservados text[] := ARRAY['api','assets','icons','js','css','public','index','sw','manifest','www','admin',
                             'app','login','demo','dashboard','static','cdn','registro-tutor'];
BEGIN
  v_base := lower(translate(coalesce(p_nombre, ''),
    'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ',
    'aeiouaeiouaeiouaeiouncaeiouaeiouaeiouaeiounc'));
  -- quitar prefijos habituales que no aportan al enlace
  v_base := regexp_replace(v_base, '^\s*(u\.?\s*e\.?|unidad educativa|colegio|escuela)\s+', '', 'i');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  v_base := left(v_base, 40);
  v_base := btrim(v_base, '-');
  IF length(v_base) < 3 THEN v_base := 'colegio-' || v_base; v_base := btrim(v_base, '-'); END IF;
  IF length(v_base) < 3 THEN v_base := 'colegio'; END IF;
  v_slug := v_base;
  WHILE v_slug = ANY (reservados) OR EXISTS (SELECT 1 FROM public.colegios WHERE demo_slug = v_slug) LOOP
    n := n + 1;
    v_slug := v_base || '-' || n;
  END LOOP;
  RETURN v_slug;
END $$;
REVOKE ALL ON FUNCTION public.demo_generar_slug(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_generar_slug(text) TO service_role;

-- Trimestre que corresponde a una fecha (año escolar boliviano: feb-nov)
CREATE OR REPLACE FUNCTION public.demo_trimestre_de(p_fecha date)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN extract(month FROM p_fecha) <= 5 THEN 1
              WHEN extract(month FROM p_fecha) <= 8 THEN 2
              ELSE 3 END;
$$;

-- Crea el colegio demo con la configuración de la plantilla. Devuelve id y enlace.
DROP FUNCTION IF EXISTS public.demo_crear_colegio(text, text, date, date);
CREATE OR REPLACE FUNCTION public.demo_crear_colegio(p_nombre text, p_contacto text, p_desde date, p_hasta date, p_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plantilla uuid; v_colegio uuid; v_slug text; v_gestion uuid;
  v_anio int := extract(year FROM current_date)::int;
  v_trim int := public.demo_trimestre_de(current_date);
  v_cat record; v_cat_nueva uuid;
  v_sigla text;
BEGIN
  IF coalesce(btrim(p_nombre), '') = '' THEN RAISE EXCEPTION 'El nombre del colegio es obligatorio'; END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Fechas de vigencia inválidas'; END IF;

  SELECT id INTO v_plantilla FROM public.colegios WHERE es_plantilla LIMIT 1;
  IF v_plantilla IS NULL THEN RAISE EXCEPTION 'Falta el colegio plantilla'; END IF;

  -- Al reiniciar un demo se conserva su enlace
  IF p_slug IS NOT NULL AND p_slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'
     AND NOT EXISTS (SELECT 1 FROM public.colegios WHERE demo_slug = p_slug) THEN
    v_slug := p_slug;
  ELSE
    v_slug := public.demo_generar_slug(p_nombre);
  END IF;
  v_sigla := upper(left(regexp_replace(
               (SELECT string_agg(left(w, 1), '') FROM regexp_split_to_table(btrim(p_nombre), '\s+') w
                WHERE length(w) > 2), '[^A-Za-zÁÉÍÓÚÑ]', '', 'g'), 4));

  INSERT INTO public.colegios (nombre, sigla, municipio, departamento, activo, plan, finanzas_habilitado,
                               color_primario, color_secundario,
                               es_demo, demo_slug, demo_desde, demo_hasta, demo_contacto, demo_creado_en)
  VALUES (btrim(p_nombre), nullif(v_sigla, ''), 'Santa Cruz de la Sierra', 'Santa Cruz', true, 'avanzado', true,
          '#1d4ed8', '#ffffff',
          true, v_slug, p_desde, p_hasta, nullif(btrim(coalesce(p_contacto, '')), ''), now())
  RETURNING id INTO v_colegio;

  -- Cursos del demo: dos paralelos de secundaria
  INSERT INTO public.cursos (colegio_id, nivel, grado, paralelo) VALUES
    (v_colegio, 'Secundaria', 5, 'A'),
    (v_colegio, 'Secundaria', 6, 'A');

  -- Materias de secundaria de la plantilla
  INSERT INTO public.materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
  SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, v_colegio
  FROM public.materias WHERE colegio_id = v_plantilla AND nivel IN ('Secundaria', 'Ambos');

  -- Gestión del año actual, con portería y entregas en línea activas
  INSERT INTO public.config_gestion (año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada, trimestre_activo,
    usa_carreras_tecnicas, permite_entrega_tareas, usa_porteria, porteria_max_salidas, colegio_id)
  SELECT v_anio, 'activo', cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, false, v_trim,
    false, true, true, porteria_max_salidas, v_colegio
  FROM public.config_gestion WHERE colegio_id = v_plantilla ORDER BY año DESC LIMIT 1
  RETURNING id INTO v_gestion;

  INSERT INTO public.config_dimensiones (gestion_id, año, codigo, nombre_display, descripcion, peso_maximo, tipo, orden, activo, colegio_id)
  SELECT v_gestion, v_anio, codigo, nombre_display, descripcion, peso_maximo, tipo, orden, activo, v_colegio
  FROM public.config_dimensiones WHERE colegio_id = v_plantilla;

  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id)
  SELECT v_anio, valor_numerico, etiqueta, color, orden, v_colegio
  FROM public.config_escala_ser WHERE colegio_id = v_plantilla;

  FOR v_cat IN SELECT * FROM public.config_categorias_ser WHERE colegio_id = v_plantilla ORDER BY orden LOOP
    INSERT INTO public.config_categorias_ser (año, nombre, orden, activo, colegio_id)
    VALUES (v_anio, v_cat.nombre, v_cat.orden, v_cat.activo, v_colegio)
    RETURNING id INTO v_cat_nueva;
    INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, activo, colegio_id)
    SELECT v_cat_nueva, v_anio, texto, descripcion, orden, activo, v_colegio
    FROM public.config_subcriterios_ser WHERE categoria_id = v_cat.id;
  END LOOP;

  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, activo, colegio_id)
  SELECT v_anio, texto, escala_min, escala_max, orden, activo, v_colegio
  FROM public.config_preguntas_docente WHERE colegio_id = v_plantilla;

  INSERT INTO public.config_notificaciones (tipo, nombre_display, plantilla, umbral_faltas, activo, colegio_id)
  SELECT tipo, nombre_display, plantilla, umbral_faltas, activo, v_colegio
  FROM public.config_notificaciones WHERE colegio_id = v_plantilla;

  -- Horario de portería y mensualidades (febrero a noviembre)
  INSERT INTO public.porteria_horarios (colegio_id, turno, nivel, hora_entrada, tolerancia_min, hora_salida)
  VALUES (v_colegio, 'manana', 'Secundaria', '07:30', 10, '12:30');

  INSERT INTO public.config_mensualidad (colegio_id, gestion_id, año, nivel, mes, monto_bs)
  SELECT v_colegio, v_gestion, v_anio, 'Secundaria', m, 250 FROM generate_series(2, 11) m;

  RETURN jsonb_build_object('colegio_id', v_colegio, 'slug', v_slug);
END $$;
REVOKE ALL ON FUNCTION public.demo_crear_colegio(text, text, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_crear_colegio(text, text, date, date, text) TO service_role;

-- Siembra los datos de ejemplo. p_usuarios: {"director": "<uuid>", "profesor1": ..., "est01": ...}
-- Los usuarios ya existen en auth.users (los crea la Edge Function con la API de administración);
-- el trigger handle_new_user ya creó su fila en public.usuarios.
CREATE OR REPLACE FUNCTION public.demo_sembrar(p_colegio uuid, p_usuarios jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_anio int := extract(year FROM current_date)::int;
  v_trim int := public.demo_trimestre_de(current_date);
  v_c5 uuid; v_c6 uuid;
  v_dir uuid := (p_usuarios->>'director')::uuid;
  v_p1  uuid := (p_usuarios->>'profesor1')::uuid;
  v_p2  uuid := (p_usuarios->>'profesor2')::uuid;
  v_sec uuid := (p_usuarios->>'secretaria')::uuid;
  v_reg uuid := (p_usuarios->>'regente')::uuid;
  v_tut uuid := (p_usuarios->>'tutor')::uuid;
  v_mat uuid; v_fis uuid; v_len uuid; v_soc uuid;
  p record; a record; e record;
  v_est_id uuid; v_act uuid; v_com uuid;
  v_dias date[]; v_d date; i int; t int; k int;
  v_inicio date; v_base numeric; v_valor numeric;
  v_hoy date := current_date;
  v_mes_actual int := extract(month FROM current_date)::int;
  v_comprobante text := 'data:image/svg+xml;utf8,' ||
    '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22360%22 height=%22480%22%3E' ||
    '%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23f8fafc%22/%3E' ||
    '%3Ctext x=%2250%25%22 y=%2240%25%22 font-family=%22Arial%22 font-size=%2222%22 text-anchor=%22middle%22 fill=%22%23334155%22%3EComprobante de ejemplo%3C/text%3E' ||
    '%3Ctext x=%2250%25%22 y=%2250%25%22 font-family=%22Arial%22 font-size=%2216%22 text-anchor=%22middle%22 fill=%22%2364748b%22%3ECuenta de prueba%3C/text%3E%3C/svg%3E';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.colegios WHERE id = p_colegio AND es_demo) THEN
    RAISE EXCEPTION 'Colegio demo no encontrado';
  END IF;

  PERFORM setseed(0.42);

  SELECT id INTO v_c5 FROM public.cursos WHERE colegio_id = p_colegio AND grado = 5;
  SELECT id INTO v_c6 FROM public.cursos WHERE colegio_id = p_colegio AND grado = 6;
  SELECT id INTO v_mat FROM public.materias WHERE colegio_id = p_colegio AND nombre = 'Matemática' AND nivel = 'Secundaria';
  SELECT id INTO v_fis FROM public.materias WHERE colegio_id = p_colegio AND nombre = 'Ciencias Naturales: Física';
  SELECT id INTO v_len FROM public.materias WHERE colegio_id = p_colegio AND nombre LIKE 'Comunicación y Lenguajes%' AND nivel = 'Secundaria';
  SELECT id INTO v_soc FROM public.materias WHERE colegio_id = p_colegio AND nombre = 'Ciencias Sociales' AND nivel = 'Secundaria';
  IF v_mat IS NULL OR v_fis IS NULL OR v_len IS NULL OR v_soc IS NULL THEN
    RAISE EXCEPTION 'Faltan materias de la plantilla';
  END IF;

  -- Usuarios: rol, nombre y colegio
  FOR p IN SELECT * FROM public.demo_personas() LOOP
    IF p_usuarios->>p.clave IS NULL THEN RAISE EXCEPTION 'Falta el usuario %', p.clave; END IF;
    UPDATE public.usuarios
       SET rol = p.rol, nombre_completo = p.nombre, colegio_id = p_colegio, activo = true,
           telefono = CASE WHEN p.rol IN ('tutor', 'director', 'secretaria') THEN '7' || lpad((60000000 + p.orden * 137)::text, 7, '0') END
     WHERE id = (p_usuarios->>p.clave)::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el perfil del usuario %', p.clave; END IF;
  END LOOP;

  -- Estudiantes
  FOR p IN SELECT * FROM public.demo_personas() WHERE rol = 'estudiante' ORDER BY orden LOOP
    INSERT INTO public.estudiantes (id, carnet, curso_id, colegio_id, fecha_nacimiento, estado)
    VALUES ((p_usuarios->>p.clave)::uuid,
            'D' || upper(left(replace(p_colegio::text, '-', ''), 6)) || lpad(p.orden::text, 3, '0'),
            CASE WHEN p.grado = 5 THEN v_c5 ELSE v_c6 END,
            p_colegio,
            make_date(v_anio - CASE WHEN p.grado = 5 THEN 16 ELSE 17 END, 1 + (p.orden % 12), 1 + (p.orden * 3) % 27),
            'activo');
  END LOOP;

  -- Padre de familia: hijos Camila (5°) y Sebastián (6°)
  INSERT INTO public.tutores_familia (id, colegio_id, carnet, telefono)
  VALUES (v_tut, p_colegio, '7' || lpad((abs(hashtext(p_colegio::text)) % 9000000)::text, 7, '0'), '76012345');
  INSERT INTO public.tutor_estudiante (tutor_id, estudiante_id, parentesco) VALUES
    (v_tut, (p_usuarios->>'est01')::uuid, 'padre'),
    (v_tut, (p_usuarios->>'est06')::uuid, 'padre');

  -- Permisos de la secretaría (licencias y vínculos), como en un colegio real
  INSERT INTO public.permisos_usuario (usuario_id, colegio_id, permiso, otorgado_por) VALUES
    (v_sec, p_colegio, 'licencias.aprobar', v_dir),
    (v_sec, p_colegio, 'vinculos.revisar',  v_dir);

  -- Asignaciones: profesor 1 -> Matemática y Física; profesor 2 -> Lenguaje y Sociales; en los dos cursos
  INSERT INTO public.asignaciones_profesor (profesor_id, materia_id, curso_id) VALUES
    (v_p1, v_mat, v_c5), (v_p1, v_mat, v_c6), (v_p1, v_fis, v_c5), (v_p1, v_fis, v_c6),
    (v_p2, v_len, v_c5), (v_p2, v_len, v_c6), (v_p2, v_soc, v_c5), (v_p2, v_soc, v_c6);

  -- Asesores de curso
  INSERT INTO public.asesor_curso (colegio_id, curso_id, profesor_id, año, asignado_por) VALUES
    (p_colegio, v_c5, v_p2, v_anio, v_dir),
    (p_colegio, v_c6, v_p1, v_anio, v_dir);

  -- Días hábiles recientes (los últimos 10 de lunes a viernes, hasta hoy)
  SELECT array_agg(d ORDER BY d) INTO v_dias FROM (
    SELECT d::date AS d FROM generate_series(v_hoy - 20, v_hoy, interval '1 day') d
    WHERE extract(isodow FROM d) < 6 ORDER BY d DESC LIMIT 10) x;

  -- Actividades y notas: trimestres 1 al actual
  FOR a IN
    SELECT ap.profesor_id, ap.materia_id, ap.curso_id, m.nombre AS materia
    FROM public.asignaciones_profesor ap JOIN public.materias m ON m.id = ap.materia_id
    WHERE m.colegio_id = p_colegio
  LOOP
    FOR t IN 1 .. v_trim LOOP
      v_inicio := CASE t WHEN 1 THEN make_date(v_anio, 2, 10) WHEN 2 THEN make_date(v_anio, 6, 2) ELSE make_date(v_anio, 9, 1) END;
      FOR k IN 1 .. 5 LOOP
        INSERT INTO public.actividades (titulo, descripcion, tipo, max_puntos, curso_id, materia_id, trimestre,
                                        fecha_limite, hora_limite, creado_por, permite_entrega_tardia)
        VALUES (
          CASE k
            WHEN 1 THEN 'Práctica ' || t || ': ejercicios de ' || a.materia
            WHEN 2 THEN 'Trabajo en grupo ' || t
            WHEN 3 THEN 'Exposición: ' || a.materia
            WHEN 4 THEN 'Evaluación escrita ' || t
            ELSE 'Prueba de comprensión ' || t END,
          'Actividad de ejemplo de la cuenta de prueba.',
          CASE WHEN k <= 3 THEN 'hacer' ELSE 'saber' END,
          CASE WHEN k <= 3 THEN 40 ELSE 45 END,
          a.curso_id, a.materia_id, t,
          LEAST(v_hoy - 2, v_inicio + (k * 12)),
          '23:59', a.profesor_id, false)
        RETURNING id INTO v_act;

        FOR e IN SELECT id FROM public.estudiantes WHERE curso_id = a.curso_id LOOP
          v_base := 0.55 + (abs(hashtext(e.id::text)) % 40) / 100.0;            -- rendimiento propio de cada estudiante
          v_valor := round(LEAST(1, GREATEST(0.35, v_base + (random() - 0.5) * 0.2))
                           * CASE WHEN k <= 3 THEN 40 ELSE 45 END);
          INSERT INTO public.notas (actividad_id, estudiante_id, valor, creado_por)
          VALUES (v_act, e.id, v_valor, a.profesor_id);
        END LOOP;
      END LOOP;

      -- SER y Autoevaluación (decidir) del trimestre
      FOR e IN SELECT id FROM public.estudiantes WHERE curso_id = a.curso_id LOOP
        INSERT INTO public.calificaciones (estudiante_id, materia_id, trimestre, nota_ser, nota_decidir)
        VALUES (e.id, a.materia_id, t, 7 + (abs(hashtext(e.id::text || t)) % 4), 3 + (abs(hashtext(e.id::text || a.materia_id::text)) % 3))
        ON CONFLICT (estudiante_id, materia_id, trimestre) DO NOTHING;
      END LOOP;
    END LOOP;

    -- Una tarea abierta del trimestre actual, con entrega en línea y sin nota todavía
    INSERT INTO public.actividades (titulo, descripcion, tipo, max_puntos, curso_id, materia_id, trimestre,
                                    fecha_limite, hora_limite, creado_por, permite_entrega_tardia)
    VALUES ('Tarea: investigación sobre ' || a.materia,
            'Sube tu trabajo en PDF o imagen antes de la fecha límite.',
            'hacer', 40, a.curso_id, a.materia_id, v_trim, v_hoy + 5, '23:59', a.profesor_id, true);

    -- Asistencia por materia de los últimos días hábiles
    FOREACH v_d IN ARRAY v_dias LOOP
      FOR e IN SELECT id FROM public.estudiantes WHERE curso_id = a.curso_id LOOP
        v_valor := random();
        INSERT INTO public.asistencias_materia (estudiante_id, curso_id, materia_id, profesor_id, fecha, sesion, estado,
                                                 metodo, hora_llegada, minutos_retraso)
        VALUES (e.id, a.curso_id, a.materia_id, a.profesor_id, v_d, 'regular',
                CASE WHEN v_valor < 0.06 THEN 'falta' WHEN v_valor < 0.12 THEN 'retraso' ELSE 'presente' END,
                'manual', NULL,
                CASE WHEN v_valor >= 0.06 AND v_valor < 0.12 THEN 5 + (random() * 10)::int END);
      END LOOP;
    END LOOP;

    -- Bitácora del docente
    FOR i IN 1 .. 3 LOOP
      INSERT INTO public.bitacora_docente (colegio_id, profesor_id, curso_id, materia_id, fecha, tema, tipo_actividad, estado, detalle)
      VALUES (p_colegio, a.profesor_id, a.curso_id, a.materia_id, v_dias[array_length(v_dias, 1) - i + 1],
              'Avance de ' || a.materia || ', sesión ' || i,
              CASE i WHEN 1 THEN 'Clase teórica' WHEN 2 THEN 'Práctica' ELSE 'Evaluación' END,
              CASE WHEN i = 3 THEN 'pendiente' ELSE 'culminado' END,
              'Registro de ejemplo de la cuenta de prueba.');
    END LOOP;
  END LOOP;

  -- Asistencia diaria y portería (entrada y salida) de los últimos días hábiles
  FOREACH v_d IN ARRAY v_dias LOOP
    FOR e IN SELECT id, curso_id FROM public.estudiantes WHERE colegio_id = p_colegio LOOP
      v_valor := random();
      INSERT INTO public.asistencias (estudiante_id, curso_id, fecha, estado, registrado_por)
      VALUES (e.id, e.curso_id, v_d, CASE WHEN v_valor < 0.05 THEN 'falta' WHEN v_valor < 0.12 THEN 'retraso' ELSE 'presente' END, v_reg);
      IF v_valor >= 0.05 THEN
        INSERT INTO public.asistencia_porteria (colegio_id, estudiante_id, fecha, hora, turno, tipo, estado, metodo, registrado_por)
        VALUES (p_colegio, e.id, v_d,
                (v_d + time '07:15' + (CASE WHEN v_valor < 0.12 THEN 25 ELSE (random() * 14)::int END) * interval '1 minute') AT TIME ZONE 'America/La_Paz',
                'manana', 'entrada', CASE WHEN v_valor < 0.12 THEN 'atraso' ELSE 'a_tiempo' END, 'qr', v_reg);
        IF v_d < v_hoy THEN
          INSERT INTO public.asistencia_porteria (colegio_id, estudiante_id, fecha, hora, turno, tipo, estado, metodo, registrado_por)
          VALUES (p_colegio, e.id, v_d, (v_d + time '12:32' + (random() * 8)::int * interval '1 minute') AT TIME ZONE 'America/La_Paz',
                  'manana', 'salida', 'normal', 'qr', v_reg);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Licencias del padre: una aprobada (pasada) y una pendiente (próxima)
  INSERT INTO public.licencias (colegio_id, estudiante_id, tutor_id, motivo, fecha_inicio, fecha_fin, descripcion, estado,
                                resuelto_por, resuelto_en)
  VALUES
    (p_colegio, (p_usuarios->>'est01')::uuid, v_tut, 'salud', v_dias[3], v_dias[3],
     'Consulta médica programada por la mañana.', 'aprobada', v_dir, now() - interval '6 days'),
    (p_colegio, (p_usuarios->>'est06')::uuid, v_tut, 'viaje', v_hoy + 3, v_hoy + 4,
     'Viaje familiar por un compromiso en Cochabamba.', 'pendiente', NULL, NULL);

  -- Comunicados
  INSERT INTO public.comunicados (colegio_id, emisor_id, tipo_emisor, tipo_destinatario, asunto, contenido, categoria, created_at)
  VALUES (p_colegio, v_dir, 'director', 'colegio', 'Reunión de padres de familia',
          'Se convoca a reunión general de padres de familia el próximo viernes a las 19:00 en el salón del colegio. Se tratará el avance del trimestre.',
          'Informativo', now() - interval '3 days')
  RETURNING id INTO v_com;
  INSERT INTO public.comunicados_estudiante (comunicado_id, estudiante_id, leido_at)
  SELECT v_com, id, CASE WHEN random() < 0.6 THEN now() - interval '2 days' END
  FROM public.estudiantes WHERE colegio_id = p_colegio;

  INSERT INTO public.comunicados (colegio_id, emisor_id, tipo_emisor, tipo_destinatario, destinatario_id, materia_id, asunto, contenido, categoria, destinatario_nombre, created_at)
  VALUES (p_colegio, v_p1, 'profesor', 'curso', v_c6, v_mat, 'Evaluación de Matemática',
          'La evaluación escrita será el jueves. Repasen los ejercicios de la práctica.', 'Informativo', '6° Secundaria A',
          now() - interval '1 day')
  RETURNING id INTO v_com;
  INSERT INTO public.comunicados_estudiante (comunicado_id, estudiante_id)
  SELECT v_com, id FROM public.estudiantes WHERE curso_id = v_c6;

  INSERT INTO public.comunicados (colegio_id, emisor_id, tipo_emisor, tipo_destinatario, destinatario_id, asunto, contenido, categoria, destinatario_nombre, created_at)
  VALUES (p_colegio, v_dir, 'director', 'estudiante', (p_usuarios->>'est04')::uuid, 'Citación a padres',
          'Se solicita la presencia del padre, madre o tutor en dirección para conversar sobre el rendimiento del estudiante.',
          'Citación', 'Santiago Peña Cuéllar', now() - interval '5 hours')
  RETURNING id INTO v_com;
  INSERT INTO public.comunicados_estudiante (comunicado_id, estudiante_id) VALUES (v_com, (p_usuarios->>'est04')::uuid);

  -- Pagos de mensualidades (febrero hasta el mes actual)
  FOR e IN SELECT es.id, (te.tutor_id IS NOT NULL) AS con_tutor
           FROM public.estudiantes es
           LEFT JOIN public.tutor_estudiante te ON te.estudiante_id = es.id AND te.tutor_id = v_tut
           WHERE es.colegio_id = p_colegio LOOP
    FOR i IN 2 .. LEAST(11, GREATEST(2, v_mes_actual)) LOOP
      IF e.con_tutor THEN
        IF i < LEAST(11, v_mes_actual) THEN
          INSERT INTO public.pagos_mensualidad (estudiante_id, tutor_id, colegio_id, año, mes, monto_bs, estado,
                                                comprobante_url, comprobante_nombre, numero_transaccion, monto_declarado, created_at)
          VALUES (e.id, v_tut, p_colegio, v_anio, i, 250, 'aprobado', v_comprobante, 'comprobante.svg',
                  'TRX' || v_anio || lpad(i::text, 2, '0') || right(e.id::text, 4), 250,
                  make_date(v_anio, i, 5));
        ELSE
          -- El mes actual queda en revisión: la secretaría y el director lo pueden aprobar
          INSERT INTO public.pagos_mensualidad (estudiante_id, tutor_id, colegio_id, año, mes, monto_bs, estado,
                                                comprobante_url, comprobante_nombre, observacion_tutor, numero_transaccion, monto_declarado)
          VALUES (e.id, v_tut, p_colegio, v_anio, i, 250, 'en_revision', v_comprobante, 'comprobante.svg',
                  'Pago por transferencia bancaria.', 'TRX' || v_anio || lpad(i::text, 2, '0') || '0001', 500);
        END IF;
      ELSIF random() < 0.85 AND i < v_mes_actual THEN
        -- Pagos en efectivo registrados por la secretaría (algunos meses quedan en mora)
        INSERT INTO public.pagos_mensualidad (estudiante_id, tutor_id, colegio_id, año, mes, monto_bs, estado,
                                              nombre_pagador, registrado_por, created_at)
        VALUES (e.id, NULL, p_colegio, v_anio, i, 250, 'aprobado', 'Pago en efectivo', v_sec, make_date(v_anio, i, 8));
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'estudiantes',  (SELECT count(*) FROM public.estudiantes WHERE colegio_id = p_colegio),
    'actividades',  (SELECT count(*) FROM public.actividades ac JOIN public.cursos c ON c.id = ac.curso_id WHERE c.colegio_id = p_colegio),
    'notas',        (SELECT count(*) FROM public.notas n JOIN public.estudiantes es ON es.id = n.estudiante_id WHERE es.colegio_id = p_colegio)
  );
END $$;
REVOKE ALL ON FUNCTION public.demo_sembrar(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_sembrar(uuid, jsonb) TO service_role;

-- Registro de uso (lo llama la Edge Function de entrada)
CREATE OR REPLACE FUNCTION public.demo_registrar_ingreso(p_colegio uuid, p_clave text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.colegios
     SET demo_ultimo_ingreso = now(),
         demo_roles_usados = CASE WHEN p_clave = ANY (demo_roles_usados) THEN demo_roles_usados
                                  ELSE array_append(demo_roles_usados, p_clave) END
   WHERE id = p_colegio AND es_demo;
$$;
REVOKE ALL ON FUNCTION public.demo_registrar_ingreso(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_registrar_ingreso(uuid, text) TO service_role;

-- Borra el colegio demo y todo lo suyo (la Edge Function borra antes sus usuarios de Auth)
CREATE OR REPLACE FUNCTION public.demo_eliminar_colegio(p_colegio uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.colegios WHERE id = p_colegio AND es_demo) THEN
    RAISE EXCEPTION 'Solo se pueden borrar colegios demo';
  END IF;
  DELETE FROM public.colegios WHERE id = p_colegio AND es_demo;
END $$;
REVOKE ALL ON FUNCTION public.demo_eliminar_colegio(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_eliminar_colegio(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Archivos del demo en Supabase Storage (en producción van a Cloudinary)
--    Bucket público de lectura con rutas no adivinables; se sube solo a la carpeta
--    del propio colegio. Tamaño y tipos como en producción.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('archivos-demo', 'archivos-demo', true, 10485760,
        '{application/pdf,image/jpeg,image/jpg,image/png,image/webp,text/plain}')
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS archivos_demo_insert ON storage.objects;
CREATE POLICY archivos_demo_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'archivos-demo' AND (storage.foldername(name))[1] = (public.mi_colegio_id())::text);

DROP POLICY IF EXISTS archivos_demo_delete ON storage.objects;
CREATE POLICY archivos_demo_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
USING (bucket_id = 'archivos-demo' AND (storage.foldername(name))[1] = (public.mi_colegio_id())::text);

-- Borrar desde la app (supabase-js remove) exige también lectura de la fila: solo la carpeta del propio colegio
DROP POLICY IF EXISTS archivos_demo_select ON storage.objects;
CREATE POLICY archivos_demo_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
USING (bucket_id = 'archivos-demo' AND (storage.foldername(name))[1] = (public.mi_colegio_id())::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Colegio plantilla base (configuración que copian los colegios nuevos)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pl uuid; v_g uuid; v_anio int := extract(year FROM current_date)::int; v_cat uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.colegios WHERE es_plantilla) THEN
    RAISE NOTICE 'La plantilla ya existe';
    RETURN;
  END IF;

  INSERT INTO public.colegios (nombre, sigla, municipio, departamento, activo, es_plantilla)
  VALUES ('PLANTILLA BASE — NO USAR PARA LOGIN', 'BASE', 'N/A', 'N/A', false, true)
  RETURNING id INTO v_pl;

  INSERT INTO public.cursos (colegio_id, nivel, grado, paralelo)
  SELECT v_pl, n, g, 'A' FROM unnest(ARRAY['Primaria', 'Secundaria']) n, generate_series(1, 6) g;

  INSERT INTO public.materias (colegio_id, nombre, nivel, campo_saberes, es_tecnica, aplica_desde) VALUES
    (v_pl, 'Comunicación y Lenguajes', 'Primaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Ciencias Sociales', 'Primaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Educación Física y Deportes', 'Primaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Educación Musical', 'Primaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Artes Plásticas y Visuales', 'Primaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Matemática', 'Primaria', 'CIENCIA TECNOLOGÍA Y PRODUCCIÓN', false, NULL),
    (v_pl, 'Técnica Tecnológica', 'Primaria', 'CIENCIA TECNOLOGÍA Y PRODUCCIÓN', false, NULL),
    (v_pl, 'Ciencias Naturales', 'Primaria', 'VIDA TIERRA TERRITORIO', false, NULL),
    (v_pl, 'Valores, Espiritualidad y Religiones', 'Primaria', 'COSMOS Y PENSAMIENTO', false, NULL),
    (v_pl, 'Comunicación y Lenguajes: Lengua Castellana y Originaria', 'Secundaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Lengua Extranjera', 'Secundaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Ciencias Sociales', 'Secundaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Educación Física y Deportes', 'Secundaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Educación Musical', 'Secundaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Artes Plásticas y Visuales', 'Secundaria', 'COMUNIDAD Y SOCIEDAD', false, NULL),
    (v_pl, 'Matemática', 'Secundaria', 'CIENCIA TECNOLOGÍA Y PRODUCCIÓN', false, NULL),
    (v_pl, 'Técnica Tecnológica General', 'Secundaria', 'CIENCIA TECNOLOGÍA Y PRODUCCIÓN', false, NULL),
    (v_pl, 'Ciencias Naturales: Biología - Geografía', 'Secundaria', 'VIDA TIERRA TERRITORIO', false, NULL),
    (v_pl, 'Ciencias Naturales: Física', 'Secundaria', 'VIDA TIERRA TERRITORIO', false, NULL),
    (v_pl, 'Ciencias Naturales: Química', 'Secundaria', 'VIDA TIERRA TERRITORIO', false, NULL),
    (v_pl, 'Cosmovisiones, Filosofía y Sicología', 'Secundaria', 'COSMOS Y PENSAMIENTO', false, NULL),
    (v_pl, 'Valores, Espiritualidad y Religiones', 'Secundaria', 'COSMOS Y PENSAMIENTO', false, NULL);

  INSERT INTO public.config_gestion (año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, colegio_id)
  VALUES (v_anio, 'activo', 3, 'Trimestre', 51, 100, 'APROBADO', 'REPROBADO', v_pl)
  RETURNING id INTO v_g;

  INSERT INTO public.config_dimensiones (gestion_id, año, codigo, nombre_display, peso_maximo, tipo, orden, colegio_id) VALUES
    (v_g, v_anio, 'hacer',   'HACER',   40, 'actividades', 1, v_pl),
    (v_g, v_anio, 'saber',   'SABER',   45, 'actividades', 2, v_pl),
    (v_g, v_anio, 'ser',     'SER',     10, 'ficha',       3, v_pl),
    (v_g, v_anio, 'decidir', 'DECIDIR',  5, 'directo',     4, v_pl);

  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id) VALUES
    (v_anio, 10, 'Siempre', 'green', 1, v_pl),
    (v_anio, 7, 'Casi Siempre', 'yellow', 2, v_pl),
    (v_anio, 2, 'Nunca', 'red', 3, v_pl);

  INSERT INTO public.config_categorias_ser (año, nombre, orden, colegio_id) VALUES (v_anio, 'RESPONSABILIDAD', 1, v_pl) RETURNING id INTO v_cat;
  INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, colegio_id) VALUES
    (v_cat, v_anio, 'Entrega tareas a tiempo', 'Cumple con los plazos establecidos para entrega de trabajos', 1, v_pl),
    (v_cat, v_anio, 'Cumple normas del aula', 'Respeta las reglas de convivencia establecidas en el aula', 2, v_pl);
  INSERT INTO public.config_categorias_ser (año, nombre, orden, colegio_id) VALUES (v_anio, 'PARTICIPACIÓN', 2, v_pl) RETURNING id INTO v_cat;
  INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, colegio_id) VALUES
    (v_cat, v_anio, 'Contribuye activamente en clase', 'Aporta ideas y participa en discusiones grupales', 1, v_pl),
    (v_cat, v_anio, 'Realiza preguntas pertinentes', 'Muestra curiosidad e interés con preguntas adecuadas al tema', 2, v_pl);
  INSERT INTO public.config_categorias_ser (año, nombre, orden, colegio_id) VALUES (v_anio, 'SOLIDARIDAD', 3, v_pl) RETURNING id INTO v_cat;
  INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, colegio_id) VALUES
    (v_cat, v_anio, 'Apoya a sus compañeros', 'Ayuda a otros estudiantes cuando lo necesitan', 1, v_pl),
    (v_cat, v_anio, 'Trabaja bien en equipo', 'Colabora efectivamente en trabajos y proyectos grupales', 2, v_pl);
  INSERT INTO public.config_categorias_ser (año, nombre, orden, colegio_id) VALUES (v_anio, 'RESPETO', 4, v_pl) RETURNING id INTO v_cat;
  INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, colegio_id) VALUES
    (v_cat, v_anio, 'Trata bien a sus compañeros', 'Mantiene relaciones cordiales y respetuosas con sus pares', 1, v_pl),
    (v_cat, v_anio, 'Respeta al docente', 'Muestra consideración y respeto hacia la autoridad académica', 2, v_pl);
  INSERT INTO public.config_categorias_ser (año, nombre, orden, colegio_id) VALUES (v_anio, 'PUNTUALIDAD', 5, v_pl) RETURNING id INTO v_cat;
  INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, colegio_id) VALUES
    (v_cat, v_anio, 'Llega a tiempo a clases', 'Asiste puntualmente al inicio de cada sesión de clase', 1, v_pl),
    (v_cat, v_anio, 'Asiste regularmente', 'Mantiene asistencia consistente sin faltas injustificadas', 2, v_pl);

  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, colegio_id) VALUES
    (v_anio, 'El docente explica los temas con claridad y orden', 1, 4, 1, v_pl),
    (v_anio, 'El docente demuestra dominio y conocimiento del tema', 1, 4, 2, v_pl),
    (v_anio, 'El docente trata a los estudiantes con respeto', 1, 4, 3, v_pl),
    (v_anio, 'El docente cumple con el horario de clases puntualmente', 1, 4, 4, v_pl),
    (v_anio, 'El docente evalúa de forma justa y equitativa', 1, 4, 5, v_pl),
    (v_anio, 'El docente incentiva la participación en clase', 1, 4, 6, v_pl),
    (v_anio, 'El docente usa recursos y materiales adecuados', 1, 4, 7, v_pl),
    (v_anio, 'Recomendarías a este docente a otros estudiantes', 1, 4, 8, v_pl);
END $$;

COMMIT;

-- Fin de instalar_demo.sql
