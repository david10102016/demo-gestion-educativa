-- ============================================================
-- MIGRACIÓN 075: Asistencia independiente por profesor (v5 final)
-- Script único — tabla, 2 vistas y RLS, todo en una ejecución.
-- Corrección de seguridad: el SELECT del profesor ahora exige
-- asistencias_materia.profesor_id = auth.uid()
-- ============================================================

-- ── 1. Tabla nueva, aditiva. asistencias (vieja) no se toca. ──
CREATE TABLE public.asistencias_materia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id   uuid NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  curso_id        uuid NOT NULL REFERENCES public.cursos(id),
  materia_id      uuid NOT NULL REFERENCES public.materias(id),
  profesor_id     uuid NOT NULL REFERENCES public.usuarios(id),
  fecha           date NOT NULL,
  sesion          text NOT NULL CHECK (sesion IN ('regular','tecnica')),
  estado          text NOT NULL CHECK (estado IN ('presente','falta','retraso','licencia')),
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (estudiante_id, fecha, sesion, profesor_id, materia_id)
);

-- ── 2. Vista general — director, estudiante, tutor.
--    Incluye la materia responsable cuando el resumen no es "presente". ──
CREATE OR REPLACE VIEW public.asistencia_resumen_diario
WITH (security_invoker = 'true') AS
WITH resumen AS (
  SELECT
    estudiante_id,
    curso_id,
    fecha,
    sesion,
    CASE
      WHEN bool_or(estado = 'falta')    THEN 'falta'
      WHEN bool_or(estado = 'licencia') THEN 'licencia'
      WHEN bool_or(estado = 'retraso')  THEN 'retraso'
      ELSE 'presente'
    END AS estado_resumen,
    count(*) AS materias_registradas
  FROM public.asistencias_materia
  GROUP BY estudiante_id, curso_id, fecha, sesion
)
SELECT
  r.*,
  CASE
    WHEN r.estado_resumen <> 'presente' THEN (
      SELECT string_agg(m.nombre, ', ' ORDER BY m.nombre)
      FROM public.asistencias_materia am
      JOIN public.materias m ON m.id = am.materia_id
      WHERE am.estudiante_id = r.estudiante_id
        AND am.fecha         = r.fecha
        AND am.sesion        = r.sesion
        AND am.estado        = r.estado_resumen
    )
  END AS materia_excepcion
FROM resumen r;

-- ── 3. Vista por profesor — cada profesor ve el resumen solo
--    entre sus propias materias, nunca las de otro docente. ──
CREATE OR REPLACE VIEW public.asistencia_resumen_profesor
WITH (security_invoker = 'true') AS
SELECT
  estudiante_id,
  curso_id,
  profesor_id,
  fecha,
  sesion,
  CASE
    WHEN bool_or(estado = 'falta')    THEN 'falta'
    WHEN bool_or(estado = 'licencia') THEN 'licencia'
    WHEN bool_or(estado = 'retraso')  THEN 'retraso'
    ELSE 'presente'
  END AS estado_resumen
FROM public.asistencias_materia
GROUP BY estudiante_id, curso_id, profesor_id, fecha, sesion;

-- ── 4. RLS ──
ALTER TABLE public.asistencias_materia ENABLE ROW LEVEL SECURITY;

CREATE POLICY asistencias_materia_select_estudiante
  ON public.asistencias_materia
  FOR SELECT
  USING (estudiante_id = auth.uid());

CREATE POLICY asistencias_materia_select_tutor
  ON public.asistencias_materia
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.tutor_estudiante te
      WHERE te.tutor_id      = auth.uid()
        AND te.estudiante_id = asistencias_materia.estudiante_id
        AND te.activo        = true
    )
  );

-- ★ CORREGIDA: ahora exige que la fila sea del profesor autenticado
CREATE POLICY asistencias_materia_select_profesor
  ON public.asistencias_materia
  FOR SELECT
  USING (
    profesor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.curso_id    = asistencias_materia.curso_id
        AND ap.materia_id  = asistencias_materia.materia_id
        AND ap.activo      = true
    )
  );

CREATE POLICY asistencias_materia_select_director
  ON public.asistencias_materia
  FOR SELECT
  USING (
    public.es_director()
    AND EXISTS (
      SELECT 1
      FROM public.cursos c
      WHERE c.id         = asistencias_materia.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

CREATE POLICY asistencias_materia_write_profesor
  ON public.asistencias_materia
  FOR ALL
  USING (
    profesor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.curso_id    = asistencias_materia.curso_id
        AND ap.materia_id  = asistencias_materia.materia_id
        AND ap.activo      = true
    )
  )
  WITH CHECK (
    profesor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.curso_id    = asistencias_materia.curso_id
        AND ap.materia_id  = asistencias_materia.materia_id
        AND ap.activo      = true
    )
  );