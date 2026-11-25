-- ============================================================
-- 117 — Comunicados: envío "todo o nada" (parte 1) y resumen de enviados (parte 2)
--
-- PARTE 1 — Envío de comunicados "todo o nada"
--
-- Problema:
--   form-comunicado.js guardaba el comunicado y después sus destinatarios en lotes de 1000, en
--   llamadas separadas. Si un lote fallaba (red, error), intentaba borrar el comunicado, pero no
--   existe política DELETE en public.comunicados (confirmado en producción el 23-nov-2026): el
--   borrado no hacía nada y el comunicado quedaba enviado solo a una parte de los estudiantes.
--
-- Solución:
--   Función enviar_comunicado(p_comunicado jsonb, p_estudiantes uuid[]): guarda el comunicado y
--   TODOS sus destinatarios en una sola transacción. Si algo falla, no se guarda nada.
--   SECURITY INVOKER: corre con los permisos de quien la llama, así que se aplican exactamente las
--   mismas políticas de hoy (director: su colegio; profesor: estudiantes de sus asignaciones;
--   plan avanzado, migración 061). No agrega ni quita permisos.
--
-- Además (hallazgo 5, detectado al probar esta migración el 23-nov-2026):
--   La política com_est_insert_director solo comprobaba que el COMUNICADO fuera del colegio del
--   director, no que el ESTUDIANTE lo fuera. Un director, llamando a la API, podía agregar como
--   destinatarios a estudiantes de OTROS colegios, que verían ese comunicado en su bandeja.
--   Se agrega la condición: el estudiante debe ser del colegio del director.
--   (La de profesor ya lo limita con profesor_tiene_asignacion.)
--
-- Qué NO cambia:
--   Tablas, datos, demás políticas. Los comunicados ya enviados.
--
-- Uso desde el front:
--   supabase.rpc('enviar_comunicado', { p_comunicado: { colegio_id, emisor_id, tipo_emisor,
--     tipo_destinatario, destinatario_id, materia_id, destinatario_nombre, asunto, contenido,
--     categoria }, p_estudiantes: [ids] })  → devuelve el id del comunicado.
--
-- Verificación después de aplicar:
--   select has_function_privilege('anon', 'public.enviar_comunicado(jsonb, uuid[])', 'EXECUTE');           -- false
--   select has_function_privilege('authenticated', 'public.enviar_comunicado(jsonb, uuid[])', 'EXECUTE');  -- true
--
--   Prueba del hallazgo 5 (con rollback): un director no puede agregar un estudiante de otro colegio.
--
-- Revertir (solo si hiciera falta; el front volvería a necesitar los inserts por lotes):
--   DROP FUNCTION IF EXISTS public.enviar_comunicado(jsonb, uuid[]);
--   (la política del director volvería a su condición anterior; reabre el hallazgo 5)
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.enviar_comunicado(p_comunicado JSONB, p_estudiantes UUID[])
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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

COMMENT ON FUNCTION public.enviar_comunicado(JSONB, UUID[]) IS
  'Guarda un comunicado y todos sus destinatarios en una sola transacción (todo o nada). Migración 117.';

-- Hallazgo 5: el director solo puede agregar destinatarios de su propio colegio
ALTER POLICY com_est_insert_director ON public.comunicados_estudiante
  WITH CHECK (
    es_director()
    AND EXISTS (SELECT 1 FROM public.comunicados c
                WHERE c.id = comunicado_id AND c.colegio_id = mi_colegio_id())
    AND EXISTS (SELECT 1 FROM public.estudiantes e
                WHERE e.id = estudiante_id AND e.colegio_id = mi_colegio_id())
  );

REVOKE EXECUTE ON FUNCTION public.enviar_comunicado(JSONB, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enviar_comunicado(JSONB, UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.enviar_comunicado(JSONB, UUID[]) TO authenticated;

COMMIT;

-- ============================================================
-- 117 (parte 2) — Resumen de comunicados enviados (lista del director y del profesor)
-- Aplicada aparte el 23-nov-2026 y guardada en este mismo archivo (mismo tema: comunicados).
--
-- Problema:
--   La lista de enviados traía todos los comunicados sin límite (la API corta en 1000) y contaba
--   los leídos trayendo una fila por cada lector con .in() de todos los IDs. Con comunicados a todo
--   el colegio (más de 1000 destinatarios) o con muchos comunicados, el conteo salía mal o la
--   consulta fallaba. Además no contaba las lecturas del padre.
--
-- Solución:
--   Función resumen_comunicados(p_desde, p_limite): devuelve los comunicados de a páginas, del más
--   nuevo al más viejo, con los conteos ya calculados en la base:
--     total   = destinatarios (estudiantes)
--     leidos  = familias que lo leyeron: el estudiante (leido_at) O su padre (comunicados_lectura_tutor)
--   Alcance, igual que las políticas de comunicados:
--     director → los comunicados de su colegio; profesor → los suyos. Otros roles → nada.
--   SECURITY DEFINER para contar sin evaluar RLS fila por fila; el alcance va explícito en el WHERE.
--   Página máxima: 200.
--
-- Qué NO cambia: tablas, políticas, datos.
--
-- Verificación después de aplicar:
--   select has_function_privilege('anon', 'public.resumen_comunicados(integer, integer)', 'EXECUTE');           -- false
--   select has_function_privilege('authenticated', 'public.resumen_comunicados(integer, integer)', 'EXECUTE');  -- true
--
-- Revertir: DROP FUNCTION IF EXISTS public.resumen_comunicados(integer, integer);
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.resumen_comunicados(p_desde INT DEFAULT 0, p_limite INT DEFAULT 50)
RETURNS TABLE (
  id                  UUID,
  created_at          TIMESTAMPTZ,
  categoria           TEXT,
  asunto              TEXT,
  contenido           TEXT,
  tipo_destinatario   TEXT,
  destinatario_nombre TEXT,
  emisor_id           UUID,
  emisor_nombre       TEXT,
  total               BIGINT,
  leidos              BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.resumen_comunicados(INT, INT) IS
  'Comunicados enviados por página con total de destinatarios y familias que leyeron (estudiante o padre). Director: su colegio; profesor: los suyos. Migración 117.';

REVOKE EXECUTE ON FUNCTION public.resumen_comunicados(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resumen_comunicados(INT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.resumen_comunicados(INT, INT) TO authenticated;

COMMIT;