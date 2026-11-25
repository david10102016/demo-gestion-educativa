-- ============================================================
-- MIGRACIÓN 003: ROW LEVEL SECURITY — 3 ROLES CON AUTH
-- Director, Profesor y Estudiante usan auth.uid()
-- Sin USING(true) en escritura. Sin anon con acceso de escritura.
-- ============================================================

-- -------------------------------------------------------
-- FUNCIONES HELPER para RLS (evitar repetición)
-- -------------------------------------------------------

-- Retorna true si el usuario autenticado es director
CREATE OR REPLACE FUNCTION public.es_director()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'director' AND activo = true
  );
$$;

-- Retorna true si el usuario autenticado es profesor
CREATE OR REPLACE FUNCTION public.es_profesor()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'profesor' AND activo = true
  );
$$;

-- Retorna true si el usuario autenticado es estudiante
CREATE OR REPLACE FUNCTION public.es_estudiante()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'estudiante' AND activo = true
  );
$$;

-- Retorna true si el profesor está asignado a ese curso
CREATE OR REPLACE FUNCTION public.profesor_asignado_curso(p_curso_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor
    WHERE profesor_id = auth.uid() AND curso_id = p_curso_id AND activo = true
  );
$$;

-- Retorna true si el profesor está asignado a esa materia
CREATE OR REPLACE FUNCTION public.profesor_asignado_materia(p_materia_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor
    WHERE profesor_id = auth.uid() AND materia_id = p_materia_id AND activo = true
  );
$$;

-- -------------------------------------------------------
-- HABILITAR RLS EN TODAS LAS TABLAS
-- -------------------------------------------------------
ALTER TABLE public.usuarios                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colegios                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cursos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materias                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estudiantes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_profesor     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inscripciones_tecnicas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calificaciones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistencias               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fichas_seguimiento_ser    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluaciones_docente      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respuestas_evaluacion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_vinculos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_gestion            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_dimensiones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_categorias_ser     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_subcriterios_ser   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_escala_ser         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_preguntas_docente  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_notificaciones     ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------
-- USUARIOS
-- -------------------------------------------------------
-- Cualquier usuario autenticado ve su propio perfil
CREATE POLICY "usuarios_select_propio" ON public.usuarios
  FOR SELECT USING (id = auth.uid());

-- Director ve todos los usuarios
CREATE POLICY "usuarios_select_director" ON public.usuarios
  FOR SELECT USING (public.es_director());

-- Director gestiona usuarios
CREATE POLICY "usuarios_insert_director" ON public.usuarios
  FOR INSERT WITH CHECK (public.es_director());

CREATE POLICY "usuarios_update_director" ON public.usuarios
  FOR UPDATE USING (public.es_director());

-- -------------------------------------------------------
-- COLEGIOS
-- -------------------------------------------------------
-- Todos los autenticados leen el colegio
CREATE POLICY "colegios_select_all" ON public.colegios
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Solo director modifica
CREATE POLICY "colegios_write_director" ON public.colegios
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- CURSOS
-- -------------------------------------------------------
CREATE POLICY "cursos_select_all" ON public.cursos
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "cursos_write_director" ON public.cursos
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- MATERIAS
-- -------------------------------------------------------
CREATE POLICY "materias_select_all" ON public.materias
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "materias_write_director" ON public.materias
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- ESTUDIANTES
-- -------------------------------------------------------
-- Estudiante ve solo su propio perfil
CREATE POLICY "estudiantes_select_propio" ON public.estudiantes
  FOR SELECT USING (id = auth.uid());

-- Profesor ve estudiantes de sus cursos
CREATE POLICY "estudiantes_select_profesor" ON public.estudiantes
  FOR SELECT USING (
    public.es_profesor() AND
    EXISTS (
      SELECT 1 FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.curso_id = estudiantes.curso_id
        AND ap.activo = true
    )
  );

-- Director ve y gestiona todos
CREATE POLICY "estudiantes_all_director" ON public.estudiantes
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- ASIGNACIONES PROFESOR
-- -------------------------------------------------------
CREATE POLICY "asignaciones_select_profesor" ON public.asignaciones_profesor
  FOR SELECT USING (
    profesor_id = auth.uid() OR public.es_director()
  );

CREATE POLICY "asignaciones_write_director" ON public.asignaciones_profesor
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- INSCRIPCIONES TECNICAS
-- -------------------------------------------------------
CREATE POLICY "inscripciones_select" ON public.inscripciones_tecnicas
  FOR SELECT USING (
    estudiante_id = auth.uid()
    OR public.es_profesor()
    OR public.es_director()
  );

CREATE POLICY "inscripciones_write_director" ON public.inscripciones_tecnicas
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- ACTIVIDADES
-- -------------------------------------------------------
-- Todos ven actividades de sus cursos
CREATE POLICY "actividades_select_all" ON public.actividades
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Profesor crea/edita en sus cursos asignados
CREATE POLICY "actividades_write_profesor" ON public.actividades
  FOR INSERT WITH CHECK (
    public.es_profesor() AND
    public.profesor_asignado_curso(curso_id)
  );

CREATE POLICY "actividades_update_profesor" ON public.actividades
  FOR UPDATE USING (
    (public.es_profesor() AND creado_por = auth.uid())
    OR public.es_director()
  );

CREATE POLICY "actividades_delete_director" ON public.actividades
  FOR DELETE USING (public.es_director());

-- -------------------------------------------------------
-- NOTAS
-- -------------------------------------------------------
-- Estudiante ve sus propias notas
CREATE POLICY "notas_select_estudiante" ON public.notas
  FOR SELECT USING (estudiante_id = auth.uid());

-- Profesor ve notas de sus cursos
CREATE POLICY "notas_select_profesor" ON public.notas
  FOR SELECT USING (
    public.es_profesor() AND
    EXISTS (
      SELECT 1 FROM public.actividades a
      JOIN public.asignaciones_profesor ap
        ON ap.materia_id = a.materia_id AND ap.curso_id = a.curso_id
      WHERE a.id = notas.actividad_id
        AND ap.profesor_id = auth.uid()
        AND ap.activo = true
    )
  );

-- Director ve todas
CREATE POLICY "notas_select_director" ON public.notas
  FOR SELECT USING (public.es_director());

-- Notas se escriben SOLO via RPC (no acceso directo)
-- La RPC usa SECURITY DEFINER y valida la asignación
-- No se otorga INSERT/UPDATE/DELETE directamente

-- -------------------------------------------------------
-- CALIFICACIONES
-- -------------------------------------------------------
CREATE POLICY "calificaciones_select_estudiante" ON public.calificaciones
  FOR SELECT USING (estudiante_id = auth.uid());

CREATE POLICY "calificaciones_select_profesor" ON public.calificaciones
  FOR SELECT USING (
    public.es_profesor() AND
    EXISTS (
      SELECT 1 FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = calificaciones.materia_id
        AND ap.activo = true
    )
  );

CREATE POLICY "calificaciones_select_director" ON public.calificaciones
  FOR SELECT USING (public.es_director());

-- Escritura SOLO via RPC (publish_ficha y rpc_upsert_calificacion)

-- -------------------------------------------------------
-- ASISTENCIAS
-- -------------------------------------------------------
CREATE POLICY "asistencias_select_estudiante" ON public.asistencias
  FOR SELECT USING (estudiante_id = auth.uid());

CREATE POLICY "asistencias_select_profesor" ON public.asistencias
  FOR SELECT USING (
    public.es_profesor() AND
    public.profesor_asignado_curso(curso_id)
  );

CREATE POLICY "asistencias_select_director" ON public.asistencias
  FOR SELECT USING (public.es_director());

CREATE POLICY "asistencias_write_profesor" ON public.asistencias
  FOR INSERT WITH CHECK (
    public.es_profesor() AND
    public.profesor_asignado_curso(curso_id)
  );

CREATE POLICY "asistencias_update_profesor" ON public.asistencias
  FOR UPDATE USING (
    (public.es_profesor() AND public.profesor_asignado_curso(curso_id))
    OR public.es_director()
  );

-- -------------------------------------------------------
-- FICHAS SER
-- -------------------------------------------------------
CREATE POLICY "fichas_select_estudiante" ON public.fichas_seguimiento_ser
  FOR SELECT USING (
    estudiante_id = auth.uid() AND publicada = true
  );

CREATE POLICY "fichas_select_profesor" ON public.fichas_seguimiento_ser
  FOR SELECT USING (
    public.es_profesor() AND profesor_id = auth.uid()
  );

CREATE POLICY "fichas_select_director" ON public.fichas_seguimiento_ser
  FOR SELECT USING (public.es_director());

-- Fichas se escriben SOLO via RPC
-- No se otorga INSERT/UPDATE directo

-- -------------------------------------------------------
-- EVALUACIONES DOCENTE
-- -------------------------------------------------------
CREATE POLICY "eval_docente_select_all" ON public.evaluaciones_docente
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "eval_docente_write_director" ON public.evaluaciones_docente
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- RESPUESTAS EVALUACION
-- -------------------------------------------------------
-- Estudiante solo ve las suyas
CREATE POLICY "respuestas_select_estudiante" ON public.respuestas_evaluacion
  FOR SELECT USING (estudiante_id = auth.uid());

-- Director ve todas
CREATE POLICY "respuestas_select_director" ON public.respuestas_evaluacion
  FOR SELECT USING (public.es_director());

-- Escritura: estudiante inserta UNA VEZ por evaluacion+profesor (UNIQUE lo garantiza)
CREATE POLICY "respuestas_insert_estudiante" ON public.respuestas_evaluacion
  FOR INSERT WITH CHECK (
    public.es_estudiante() AND
    estudiante_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.evaluaciones_docente e
      WHERE e.id = evaluacion_id AND e.activa = true
    )
  );

-- -------------------------------------------------------
-- TELEGRAM VINCULOS
-- -------------------------------------------------------
CREATE POLICY "telegram_select_estudiante" ON public.telegram_vinculos
  FOR SELECT USING (estudiante_id = auth.uid() OR public.es_director());

CREATE POLICY "telegram_write_director" ON public.telegram_vinculos
  FOR ALL USING (public.es_director());

-- -------------------------------------------------------
-- CONFIGURACIONES — Lectura para todos, escritura solo director
-- -------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'config_gestion','config_dimensiones','config_categorias_ser',
    'config_subcriterios_ser','config_escala_ser',
    'config_preguntas_docente','config_notificaciones'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "config_select_all_%I" ON public.%I
       FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format(
      'CREATE POLICY "config_write_director_%I" ON public.%I
       FOR ALL USING (public.es_director())', t, t);
  END LOOP;
END$$;

-- -------------------------------------------------------
-- AUDIT LOGS — Solo director lee
-- -------------------------------------------------------
CREATE POLICY "audit_select_director" ON public.audit_logs
  FOR SELECT USING (public.es_director());

-- Escritura via funciones SECURITY DEFINER únicamente
