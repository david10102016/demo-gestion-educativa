-- ============================================================
-- 115 — Lectura de comunicados por el tutor (padre) en su propio panel
--
-- Problema:
--   comunicados_estudiante tiene una sola marca de lectura (leido_at) por estudiante. La pone
--   quien abre primero, desde la cuenta del estudiante o del tutor, y no se sabe quién fue.
--   El director y el profesor no pueden saber si el padre vio el comunicado en su propio panel.
--
-- Solución (aditiva, no cambia lo existente):
--   Tabla nueva comunicados_lectura_tutor: una fila por (comunicado del estudiante, tutor).
--     - Cubre a los 2 tutores posibles por estudiante (migración 033): cada uno tiene su propia marca.
--     - Funciona igual con 1 o con cientos de padres registrados después.
--   Función marcar_comunicado_leido_tutor(p_ce_id): única vía de escritura.
--     - Solo un usuario con rol tutor, activo, con vínculo activo a ese estudiante.
--     - No exige carnet validado: el padre ve los comunicados apenas vincula a su hijo.
--     - Registra solo la primera vez (ON CONFLICT DO NOTHING).
--     - NO toca leido_at: leido_at queda solo para la cuenta del estudiante. Así cada uno
--       (estudiante y padre) ve su aviso de "nuevo" hasta que lo abre él mismo.
--
-- Historial: aplicada el 23-nov-2026 (13:38 aprox.) con una versión que también ponía leido_at.
--   Corregida el mismo día con CREATE OR REPLACE de la función: si el padre abría primero, al
--   estudiante se le apagaba el aviso y el director veía "leído" sin que el estudiante lo abriera.
--   Las filas leídas por un padre antes de la corrección quedan con leido_at como estaban.
--
-- Qué se puede afirmar con este dato:
--   Una fila aquí = el comunicado se abrió desde la cuenta de ese tutor.
--   leido_at = se abrió desde la cuenta del estudiante (no distingue si fue el hijo o el padre
--   usando esa cuenta; regla de responsabilidad: las credenciales se entregan a la familia).
--
-- Qué NO cambia:
--   comunicados_estudiante, leido_at, sus políticas y la función marcarLeido del frontend.
--   Las lecturas anteriores a esta migración no se asignan a nadie.
--
-- Seguridad:
--   RLS activa. Sin políticas de INSERT/UPDATE/DELETE: se escribe solo por la función.
--   Lectura: el propio tutor, el director de su colegio, el profesor que emitió el comunicado
--   y el superadmin. Tiene colegio_id (copiado del comunicado) para aislar por colegio.
--   Sin FK hacia usuarios (criterio de la migración 101: evita relaciones ambiguas en PostgREST).
--
-- Frontend (después de aplicar, aparte):
--   - Panel del tutor: al abrir un comunicado llamar rpc('marcar_comunicado_leido_tutor', { p_ce_id }).
--   - Director y profesor: columna Estudiante (leido_at) y columna Padre (esta tabla).
--
-- Verificación después de aplicar:
--   a) RLS activa:
--      select relrowsecurity from pg_class where oid = 'public.comunicados_lectura_tutor'::regclass;  -- true
--   b) Sin escritura directa para anon/authenticated:
--      select has_table_privilege('authenticated','public.comunicados_lectura_tutor','INSERT');  -- false
--   c) La función no la ejecuta anon:
--      select has_function_privilege('anon','public.marcar_comunicado_leido_tutor(uuid)','EXECUTE');  -- false
--
-- Revertir (solo si hiciera falta; borra las marcas del padre):
--   DROP FUNCTION IF EXISTS public.marcar_comunicado_leido_tutor(uuid);
--   DROP TABLE IF EXISTS public.comunicados_lectura_tutor;
-- ============================================================
BEGIN;

-- 1. Tabla
CREATE TABLE IF NOT EXISTS public.comunicados_lectura_tutor (
  comunicado_estudiante_id UUID        NOT NULL REFERENCES public.comunicados_estudiante(id) ON DELETE CASCADE,
  tutor_id                 UUID        NOT NULL,
  colegio_id               UUID        NOT NULL REFERENCES public.colegios(id),
  leido_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comunicado_estudiante_id, tutor_id)
);

COMMENT ON TABLE public.comunicados_lectura_tutor IS
  'Lectura de comunicados desde la cuenta del tutor (padre). Se escribe solo con marcar_comunicado_leido_tutor (migración 115).';

CREATE INDEX IF NOT EXISTS idx_com_lect_tutor_colegio ON public.comunicados_lectura_tutor(colegio_id);
CREATE INDEX IF NOT EXISTS idx_com_lect_tutor_tutor   ON public.comunicados_lectura_tutor(tutor_id);

-- 2. RLS y permisos
ALTER TABLE public.comunicados_lectura_tutor ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.comunicados_lectura_tutor FROM anon, authenticated;
GRANT SELECT ON public.comunicados_lectura_tutor TO authenticated;

DROP POLICY IF EXISTS com_lect_tutor_select_propio ON public.comunicados_lectura_tutor;
CREATE POLICY com_lect_tutor_select_propio ON public.comunicados_lectura_tutor
  FOR SELECT TO authenticated
  USING (tutor_id = auth.uid());

DROP POLICY IF EXISTS com_lect_tutor_select_director ON public.comunicados_lectura_tutor;
CREATE POLICY com_lect_tutor_select_director ON public.comunicados_lectura_tutor
  FOR SELECT TO authenticated
  USING (es_director() AND colegio_id = mi_colegio_id());

DROP POLICY IF EXISTS com_lect_tutor_select_profesor ON public.comunicados_lectura_tutor;
CREATE POLICY com_lect_tutor_select_profesor ON public.comunicados_lectura_tutor
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.comunicados_estudiante ce
      JOIN public.comunicados c ON c.id = ce.comunicado_id
      WHERE ce.id = comunicados_lectura_tutor.comunicado_estudiante_id
        AND c.emisor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS com_lect_tutor_select_superadmin ON public.comunicados_lectura_tutor;
CREATE POLICY com_lect_tutor_select_superadmin ON public.comunicados_lectura_tutor
  FOR SELECT TO authenticated
  USING (es_superadmin());

-- 3. Función de escritura
CREATE OR REPLACE FUNCTION public.marcar_comunicado_leido_tutor(p_ce_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.marcar_comunicado_leido_tutor(UUID) IS
  'Registra que el tutor abrió el comunicado en su panel. Solo tutor activo con vínculo activo (migración 115).';

REVOKE EXECUTE ON FUNCTION public.marcar_comunicado_leido_tutor(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_comunicado_leido_tutor(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.marcar_comunicado_leido_tutor(UUID) TO authenticated;

COMMIT;