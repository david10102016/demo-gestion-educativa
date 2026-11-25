-- ============================================================
-- MIGRACIÓN 077: Novedades de asistencia institucionales (director)
-- Aditivo. No modifica asistencias ni asistencias_materia.
-- ============================================================
BEGIN;

CREATE TABLE public.novedades_asistencia_dia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id  uuid NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  curso_id       uuid NOT NULL REFERENCES public.cursos(id),
  colegio_id     uuid NOT NULL REFERENCES public.colegios(id),
  fecha          date NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('en_direccion', 'no_ingreso')),
  observaciones  text,
  registrado_por uuid NOT NULL REFERENCES public.usuarios(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (estudiante_id, fecha),
  CONSTRAINT novedades_asistencia_dia_fecha_no_futura CHECK (fecha <= CURRENT_DATE)
);

CREATE INDEX novedades_asistencia_dia_colegio_fecha_idx
  ON public.novedades_asistencia_dia (colegio_id, fecha);

CREATE INDEX novedades_asistencia_dia_curso_fecha_idx
  ON public.novedades_asistencia_dia (curso_id, fecha);

CREATE TRIGGER set_updated_at_novedades_asistencia_dia
  BEFORE UPDATE ON public.novedades_asistencia_dia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.novedades_asistencia_dia IS
  'Novedad institucional del día (en dirección / no ingresó). Independiente de la asistencia por materia del profesor.';

ALTER TABLE public.novedades_asistencia_dia ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.novedades_asistencia_dia FROM anon;

CREATE POLICY novedades_asistencia_dia_select_director
  ON public.novedades_asistencia_dia
  FOR SELECT
  USING (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
  );

CREATE POLICY novedades_asistencia_dia_insert_director
  ON public.novedades_asistencia_dia
  FOR INSERT
  WITH CHECK (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
    AND registrado_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = novedades_asistencia_dia.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = novedades_asistencia_dia.estudiante_id
        AND e.curso_id = novedades_asistencia_dia.curso_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

CREATE POLICY novedades_asistencia_dia_update_director
  ON public.novedades_asistencia_dia
  FOR UPDATE
  USING (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
  )
  WITH CHECK (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
    AND registrado_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = novedades_asistencia_dia.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = novedades_asistencia_dia.estudiante_id
        AND e.curso_id = novedades_asistencia_dia.curso_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

CREATE POLICY novedades_asistencia_dia_delete_director
  ON public.novedades_asistencia_dia
  FOR DELETE
  USING (
    public.es_director()
    AND colegio_id = public.mi_colegio_id()
  );

COMMIT;