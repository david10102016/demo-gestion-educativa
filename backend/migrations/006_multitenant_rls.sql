-- ============================================================
-- 006 — Aislamiento Multi-Colegio (RLS)
--
-- Qué hace:
-- Implementa aislamiento completo por colegio usando Row Level
-- Security. El sistema soporta N colegios en la misma base de
-- datos sin que los datos se mezclen entre ellos.
--
-- Cambios aplicados:
-- - Nueva función mi_colegio_id()
-- - Columna colegio_id agregada a 7 tablas de configuración
-- - 63 políticas RLS actualizadas en 27 tablas
--
-- Para agregar un colegio nuevo:
-- 1. Insertar en la tabla colegios
-- 2. Crear el usuario director en Supabase Auth
-- 3. Insertar en usuarios con rol = 'director' y colegio_id
--    El RLS se encarga del resto automáticamente.
-- ============================================================
-- ============================================================
-- SCRIPT: AISLAMIENTO MULTI-COLEGIO
-- Propósito: Cada colegio opera de forma completamente independiente
-- Fecha: 2026-06-05
-- REQUISITO: Tener backup antes de ejecutar
-- Ejecutar completo en Supabase SQL Editor
-- ============================================================


-- ============================================================
-- PASO 1: FUNCIÓN HELPER — mi_colegio_id()
-- Devuelve el colegio_id del usuario autenticado
-- Base de todo el aislamiento
-- ============================================================

CREATE OR REPLACE FUNCTION public.mi_colegio_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT colegio_id FROM public.usuarios WHERE id = auth.uid();
$$;


-- ============================================================
-- PASO 2: AGREGAR colegio_id A TABLAS DE CONFIGURACIÓN
-- Estas tablas no tenían la columna — se agrega y se asigna
-- el colegio actual a todos los registros existentes
-- ============================================================

-- config_gestion
ALTER TABLE public.config_gestion
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_gestion
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_gestion
  ALTER COLUMN colegio_id SET NOT NULL;

-- config_dimensiones
ALTER TABLE public.config_dimensiones
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_dimensiones
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_dimensiones
  ALTER COLUMN colegio_id SET NOT NULL;

-- config_categorias_ser
ALTER TABLE public.config_categorias_ser
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_categorias_ser
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_categorias_ser
  ALTER COLUMN colegio_id SET NOT NULL;

-- config_escala_ser
ALTER TABLE public.config_escala_ser
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_escala_ser
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_escala_ser
  ALTER COLUMN colegio_id SET NOT NULL;

-- config_subcriterios_ser
ALTER TABLE public.config_subcriterios_ser
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_subcriterios_ser
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_subcriterios_ser
  ALTER COLUMN colegio_id SET NOT NULL;

-- config_preguntas_docente
ALTER TABLE public.config_preguntas_docente
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_preguntas_docente
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_preguntas_docente
  ALTER COLUMN colegio_id SET NOT NULL;

-- config_notificaciones
ALTER TABLE public.config_notificaciones
  ADD COLUMN IF NOT EXISTS colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.config_notificaciones
  SET colegio_id = '00000000-0000-0000-0000-000000000001'
  WHERE colegio_id IS NULL;

ALTER TABLE public.config_notificaciones
  ALTER COLUMN colegio_id SET NOT NULL;


-- ============================================================
-- PASO 3: HABILITAR RLS EN TABLAS DE CONFIGURACIÓN
-- Las tablas nuevas con colegio_id necesitan RLS activado
-- ============================================================

ALTER TABLE public.config_gestion            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_dimensiones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_categorias_ser     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_escala_ser         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_subcriterios_ser   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_preguntas_docente  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_notificaciones     ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- PASO 4: ACTUALIZAR POLÍTICAS RLS EXISTENTES
-- Se eliminan las políticas que no filtraban por colegio
-- y se reemplazan por versiones que sí aíslan
-- ============================================================

-- -------------------------------------------------------
-- COLEGIOS
-- Cada usuario solo ve su propio colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "colegios_select_all" ON public.colegios;
CREATE POLICY "colegios_select_propio" ON public.colegios
  FOR SELECT USING (id = public.mi_colegio_id());

DROP POLICY IF EXISTS "colegios_write_director" ON public.colegios;
CREATE POLICY "colegios_write_director" ON public.colegios
  FOR ALL USING (public.es_director() AND id = public.mi_colegio_id());

-- -------------------------------------------------------
-- USUARIOS
-- Director solo ve usuarios de su colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "usuarios_select_director" ON public.usuarios;
CREATE POLICY "usuarios_select_director" ON public.usuarios
  FOR SELECT USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "usuarios_insert_director" ON public.usuarios;
CREATE POLICY "usuarios_insert_director" ON public.usuarios
  FOR INSERT WITH CHECK (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "usuarios_update_director" ON public.usuarios;
CREATE POLICY "usuarios_update_director" ON public.usuarios
  FOR UPDATE USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- Profesor ve solo usuarios de estudiantes de sus cursos en su colegio
DROP POLICY IF EXISTS "usuarios_select_profesor_estudiantes" ON public.usuarios;
CREATE POLICY "usuarios_select_profesor_estudiantes" ON public.usuarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      JOIN public.asignaciones_profesor ap ON ap.curso_id = e.curso_id
      WHERE e.id = usuarios.id
        AND ap.profesor_id = auth.uid()
        AND ap.activo = true
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- CURSOS
-- Solo cursos del propio colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "cursos_select_all" ON public.cursos;
CREATE POLICY "cursos_select_colegio" ON public.cursos
  FOR SELECT USING (colegio_id = public.mi_colegio_id());

DROP POLICY IF EXISTS "cursos_write_director" ON public.cursos;
CREATE POLICY "cursos_write_director" ON public.cursos
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- MATERIAS
-- Solo materias del propio colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "materias_select_all" ON public.materias;
CREATE POLICY "materias_select_colegio" ON public.materias
  FOR SELECT USING (colegio_id = public.mi_colegio_id());

DROP POLICY IF EXISTS "materias_write_director" ON public.materias;
CREATE POLICY "materias_write_director" ON public.materias
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- ESTUDIANTES
-- Aislados por colegio para todos los roles
-- -------------------------------------------------------
DROP POLICY IF EXISTS "estudiantes_all_director" ON public.estudiantes;
CREATE POLICY "estudiantes_all_director" ON public.estudiantes
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "estudiantes_select_profesor" ON public.estudiantes;
CREATE POLICY "estudiantes_select_profesor" ON public.estudiantes
  FOR SELECT USING (
    public.es_profesor() AND
    colegio_id = public.mi_colegio_id() AND
    EXISTS (
      SELECT 1 FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.curso_id = estudiantes.curso_id
        AND ap.activo = true
    )
  );

-- Tutor solo ve estudiantes vinculados de su colegio
DROP POLICY IF EXISTS "estudiantes_select_tutor" ON public.estudiantes;
CREATE POLICY "estudiantes_select_tutor" ON public.estudiantes
  FOR SELECT USING (
    colegio_id = public.mi_colegio_id() AND
    EXISTS (
      SELECT 1 FROM public.tutor_estudiante te
      WHERE te.tutor_id = auth.uid()
        AND te.estudiante_id = estudiantes.id
        AND te.activo = true
    )
  );

-- -------------------------------------------------------
-- ACTIVIDADES
-- Aisladas por colegio via curso_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "actividades_select_all" ON public.actividades;
CREATE POLICY "actividades_select_colegio" ON public.actividades
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = actividades.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "actividades_write_profesor" ON public.actividades;
CREATE POLICY "actividades_write_profesor" ON public.actividades
  FOR INSERT WITH CHECK (
    public.es_profesor() AND
    public.profesor_asignado_curso(curso_id) AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = curso_id AND c.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "actividades_update_profesor" ON public.actividades;
CREATE POLICY "actividades_update_profesor" ON public.actividades
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = actividades.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    ) AND (
      (public.es_profesor() AND creado_por = auth.uid())
      OR public.es_director()
    )
  );

DROP POLICY IF EXISTS "actividades_delete_director" ON public.actividades;
CREATE POLICY "actividades_delete_director" ON public.actividades
  FOR DELETE USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = actividades.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- ASIGNACIONES PROFESOR
-- Solo asignaciones de cursos del propio colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "asignaciones_select_profesor" ON public.asignaciones_profesor;
CREATE POLICY "asignaciones_select_profesor" ON public.asignaciones_profesor
  FOR SELECT USING (
    (profesor_id = auth.uid() OR public.es_director()) AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = asignaciones_profesor.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "asignaciones_write_director" ON public.asignaciones_profesor;
CREATE POLICY "asignaciones_write_director" ON public.asignaciones_profesor
  FOR ALL USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = asignaciones_profesor.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- ASISTENCIAS
-- Aisladas por colegio via curso_id y estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "asistencias_select_director" ON public.asistencias;
CREATE POLICY "asistencias_select_director" ON public.asistencias
  FOR SELECT USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = asistencias.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "asistencias_select_profesor" ON public.asistencias;
CREATE POLICY "asistencias_select_profesor" ON public.asistencias
  FOR SELECT USING (
    public.es_profesor() AND
    public.profesor_asignado_curso(curso_id) AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = asistencias.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "asistencias_write_profesor" ON public.asistencias;
CREATE POLICY "asistencias_write_profesor" ON public.asistencias
  FOR INSERT WITH CHECK (
    public.es_profesor() AND
    public.profesor_asignado_curso(curso_id) AND
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = curso_id AND c.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "asistencias_update_profesor" ON public.asistencias;
CREATE POLICY "asistencias_update_profesor" ON public.asistencias
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.cursos c
      WHERE c.id = asistencias.curso_id
        AND c.colegio_id = public.mi_colegio_id()
    ) AND (
      (public.es_profesor() AND public.profesor_asignado_curso(curso_id))
      OR public.es_director()
    )
  );

-- -------------------------------------------------------
-- NOTAS
-- Aisladas por colegio via estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "notas_select_director" ON public.notas;
CREATE POLICY "notas_select_director" ON public.notas
  FOR SELECT USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = notas.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "notas_select_profesor" ON public.notas;
CREATE POLICY "notas_select_profesor" ON public.notas
  FOR SELECT USING (
    public.es_profesor() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = notas.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.actividades a
      JOIN public.asignaciones_profesor ap
        ON ap.materia_id = a.materia_id AND ap.curso_id = a.curso_id
      WHERE a.id = notas.actividad_id
        AND ap.profesor_id = auth.uid()
        AND ap.activo = true
    )
  );

-- -------------------------------------------------------
-- CALIFICACIONES
-- Aisladas por colegio via estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "calificaciones_select_director" ON public.calificaciones;
CREATE POLICY "calificaciones_select_director" ON public.calificaciones
  FOR SELECT USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = calificaciones.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "calificaciones_select_profesor" ON public.calificaciones;
CREATE POLICY "calificaciones_select_profesor" ON public.calificaciones
  FOR SELECT USING (
    public.es_profesor() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = calificaciones.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    ) AND
    EXISTS (
      SELECT 1 FROM public.asignaciones_profesor ap
      WHERE ap.profesor_id = auth.uid()
        AND ap.materia_id = calificaciones.materia_id
        AND ap.activo = true
    )
  );

-- -------------------------------------------------------
-- FICHAS SEGUIMIENTO SER
-- Aisladas por colegio via estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "fichas_select_director" ON public.fichas_seguimiento_ser;
CREATE POLICY "fichas_select_director" ON public.fichas_seguimiento_ser
  FOR SELECT USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = fichas_seguimiento_ser.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "fichas_select_profesor" ON public.fichas_seguimiento_ser;
CREATE POLICY "fichas_select_profesor" ON public.fichas_seguimiento_ser
  FOR SELECT USING (
    public.es_profesor() AND
    profesor_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = fichas_seguimiento_ser.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- INSCRIPCIONES TECNICAS
-- Aisladas por colegio via estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "inscripciones_select" ON public.inscripciones_tecnicas;
CREATE POLICY "inscripciones_select" ON public.inscripciones_tecnicas
  FOR SELECT USING (
    estudiante_id = auth.uid() OR
    (
      (public.es_profesor() OR public.es_director()) AND
      EXISTS (
        SELECT 1 FROM public.estudiantes e
        WHERE e.id = inscripciones_tecnicas.estudiante_id
          AND e.colegio_id = public.mi_colegio_id()
      )
    )
  );

DROP POLICY IF EXISTS "inscripciones_write_director" ON public.inscripciones_tecnicas;
CREATE POLICY "inscripciones_write_director" ON public.inscripciones_tecnicas
  FOR ALL USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = inscripciones_tecnicas.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- TUTORES FAMILIA
-- Aislados por colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "tutores_select_director" ON public.tutores_familia;
CREATE POLICY "tutores_select_director" ON public.tutores_familia
  FOR SELECT USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "tutores_select_secretaria" ON public.tutores_familia;
CREATE POLICY "tutores_select_secretaria" ON public.tutores_familia
  FOR SELECT USING (
    public.es_secretaria() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "tutores_insert_director" ON public.tutores_familia;
CREATE POLICY "tutores_insert_director" ON public.tutores_familia
  FOR INSERT WITH CHECK (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- TUTOR_ESTUDIANTE
-- Aislado por colegio via estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "tutor_estudiante_select_director" ON public.tutor_estudiante;
CREATE POLICY "tutor_estudiante_select_director" ON public.tutor_estudiante
  FOR SELECT USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = tutor_estudiante.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "tutor_estudiante_select_secretaria" ON public.tutor_estudiante;
CREATE POLICY "tutor_estudiante_select_secretaria" ON public.tutor_estudiante
  FOR SELECT USING (
    public.es_secretaria() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = tutor_estudiante.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "tutor_estudiante_update_director" ON public.tutor_estudiante;
CREATE POLICY "tutor_estudiante_update_director" ON public.tutor_estudiante
  FOR UPDATE USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = tutor_estudiante.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- PAGOS MENSUALIDAD
-- Aislados por colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "pagos_select_director" ON public.pagos_mensualidad;
CREATE POLICY "pagos_select_director" ON public.pagos_mensualidad
  FOR SELECT USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "pagos_select_secretaria" ON public.pagos_mensualidad;
CREATE POLICY "pagos_select_secretaria" ON public.pagos_mensualidad
  FOR SELECT USING (
    public.es_secretaria() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "pagos_update_director" ON public.pagos_mensualidad;
CREATE POLICY "pagos_update_director" ON public.pagos_mensualidad
  FOR UPDATE USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "pagos_update_secretaria" ON public.pagos_mensualidad;
CREATE POLICY "pagos_update_secretaria" ON public.pagos_mensualidad
  FOR UPDATE USING (
    public.es_secretaria() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- REVISIONES PAGO
-- Aisladas por colegio via pago_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "revisiones_select_director" ON public.revisiones_pago;
CREATE POLICY "revisiones_select_director" ON public.revisiones_pago
  FOR SELECT USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.pagos_mensualidad p
      WHERE p.id = revisiones_pago.pago_id
        AND p.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "revisiones_select_secretaria" ON public.revisiones_pago;
CREATE POLICY "revisiones_select_secretaria" ON public.revisiones_pago
  FOR SELECT USING (
    public.es_secretaria() AND
    EXISTS (
      SELECT 1 FROM public.pagos_mensualidad p
      WHERE p.id = revisiones_pago.pago_id
        AND p.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "revisiones_insert_director" ON public.revisiones_pago;
CREATE POLICY "revisiones_insert_director" ON public.revisiones_pago
  FOR INSERT WITH CHECK (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.pagos_mensualidad p
      WHERE p.id = pago_id
        AND p.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "revisiones_insert_secretaria" ON public.revisiones_pago;
CREATE POLICY "revisiones_insert_secretaria" ON public.revisiones_pago
  FOR INSERT WITH CHECK (
    public.es_secretaria() AND
    EXISTS (
      SELECT 1 FROM public.pagos_mensualidad p
      WHERE p.id = pago_id
        AND p.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- BECAS ESTUDIANTE
-- Aisladas por colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "becas_select_director" ON public.becas_estudiante;
CREATE POLICY "becas_select_director" ON public.becas_estudiante
  FOR SELECT USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "becas_select_secretaria" ON public.becas_estudiante;
CREATE POLICY "becas_select_secretaria" ON public.becas_estudiante
  FOR SELECT USING (
    public.es_secretaria() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "becas_insert_director" ON public.becas_estudiante;
CREATE POLICY "becas_insert_director" ON public.becas_estudiante
  FOR INSERT WITH CHECK (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "becas_update_director" ON public.becas_estudiante;
CREATE POLICY "becas_update_director" ON public.becas_estudiante
  FOR UPDATE USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- CONFIG MENSUALIDAD
-- Aislada por colegio
-- -------------------------------------------------------
DROP POLICY IF EXISTS "config_mensualidad_select_todos" ON public.config_mensualidad;
CREATE POLICY "config_mensualidad_select_colegio" ON public.config_mensualidad
  FOR SELECT USING (colegio_id = public.mi_colegio_id());

DROP POLICY IF EXISTS "config_mensualidad_insert_director" ON public.config_mensualidad;
CREATE POLICY "config_mensualidad_insert_director" ON public.config_mensualidad
  FOR INSERT WITH CHECK (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

DROP POLICY IF EXISTS "config_mensualidad_update_director" ON public.config_mensualidad;
CREATE POLICY "config_mensualidad_update_director" ON public.config_mensualidad
  FOR UPDATE USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- TABLAS DE CONFIGURACIÓN (recién modificadas con colegio_id)
-- -------------------------------------------------------

-- config_gestion
DROP POLICY IF EXISTS "config_select_all_config_gestion" ON public.config_gestion;
DROP POLICY IF EXISTS "config_write_director_config_gestion" ON public.config_gestion;
CREATE POLICY "config_gestion_select" ON public.config_gestion
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_gestion_write_director" ON public.config_gestion
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- config_dimensiones
DROP POLICY IF EXISTS "config_select_all_config_dimensiones" ON public.config_dimensiones;
DROP POLICY IF EXISTS "config_write_director_config_dimensiones" ON public.config_dimensiones;
CREATE POLICY "config_dimensiones_select" ON public.config_dimensiones
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_dimensiones_write_director" ON public.config_dimensiones
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- config_categorias_ser
DROP POLICY IF EXISTS "config_select_all_config_categorias_ser" ON public.config_categorias_ser;
DROP POLICY IF EXISTS "config_write_director_config_categorias_ser" ON public.config_categorias_ser;
CREATE POLICY "config_categorias_ser_select" ON public.config_categorias_ser
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_categorias_ser_write_director" ON public.config_categorias_ser
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- config_escala_ser
DROP POLICY IF EXISTS "config_select_all_config_escala_ser" ON public.config_escala_ser;
DROP POLICY IF EXISTS "config_write_director_config_escala_ser" ON public.config_escala_ser;
CREATE POLICY "config_escala_ser_select" ON public.config_escala_ser
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_escala_ser_write_director" ON public.config_escala_ser
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- config_subcriterios_ser
DROP POLICY IF EXISTS "config_select_all_config_subcriterios_ser" ON public.config_subcriterios_ser;
DROP POLICY IF EXISTS "config_write_director_config_subcriterios_ser" ON public.config_subcriterios_ser;
CREATE POLICY "config_subcriterios_ser_select" ON public.config_subcriterios_ser
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_subcriterios_ser_write_director" ON public.config_subcriterios_ser
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- config_preguntas_docente
DROP POLICY IF EXISTS "config_select_all_config_preguntas_docente" ON public.config_preguntas_docente;
DROP POLICY IF EXISTS "config_write_director_config_preguntas_docente" ON public.config_preguntas_docente;
CREATE POLICY "config_preguntas_docente_select" ON public.config_preguntas_docente
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_preguntas_docente_write_director" ON public.config_preguntas_docente
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- config_notificaciones
DROP POLICY IF EXISTS "config_select_all_config_notificaciones" ON public.config_notificaciones;
DROP POLICY IF EXISTS "config_write_director_config_notificaciones" ON public.config_notificaciones;
CREATE POLICY "config_notificaciones_select" ON public.config_notificaciones
  FOR SELECT USING (colegio_id = public.mi_colegio_id());
CREATE POLICY "config_notificaciones_write_director" ON public.config_notificaciones
  FOR ALL USING (
    public.es_director() AND colegio_id = public.mi_colegio_id()
  );

-- -------------------------------------------------------
-- EVALUACIONES DOCENTE
-- Aisladas por colegio via creado_por -> usuarios.colegio_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "eval_docente_select_all" ON public.evaluaciones_docente;
CREATE POLICY "eval_docente_select_colegio" ON public.evaluaciones_docente
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = evaluaciones_docente.activada_por
        AND u.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "eval_docente_write_director" ON public.evaluaciones_docente;
CREATE POLICY "eval_docente_write_director" ON public.evaluaciones_docente
  FOR ALL USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = evaluaciones_docente.activada_por
        AND u.colegio_id = public.mi_colegio_id()
    )
  );

-- -------------------------------------------------------
-- TELEGRAM VINCULOS
-- Aislados por colegio via estudiante_id
-- -------------------------------------------------------
DROP POLICY IF EXISTS "telegram_select_estudiante" ON public.telegram_vinculos;
CREATE POLICY "telegram_select_estudiante" ON public.telegram_vinculos
  FOR SELECT USING (
    (estudiante_id = auth.uid() OR public.es_director()) AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = telegram_vinculos.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );

DROP POLICY IF EXISTS "telegram_write_director" ON public.telegram_vinculos;
CREATE POLICY "telegram_write_director" ON public.telegram_vinculos
  FOR ALL USING (
    public.es_director() AND
    EXISTS (
      SELECT 1 FROM public.estudiantes e
      WHERE e.id = telegram_vinculos.estudiante_id
        AND e.colegio_id = public.mi_colegio_id()
    )
  );


-- ============================================================
-- PASO 5: PROCEDIMIENTO PARA AGREGAR UN COLEGIO NUEVO
-- Ejecutar esto cada vez que se incorpore un nuevo colegio
-- Reemplazar los valores entre < > con los datos reales
-- ============================================================

/*
-- 1. Insertar el colegio
INSERT INTO public.colegios (id, nombre, sigla, direccion, municipio, departamento, activo)
VALUES (
  gen_random_uuid(),
  '<NOMBRE DEL COLEGIO>',
  '<SIGLA>',
  '<DIRECCION>',
  '<MUNICIPIO>',
  '<DEPARTAMENTO>',
  true
);

-- 2. Crear el usuario director en Supabase Auth primero (desde el dashboard Auth)
--    Luego insertar en la tabla usuarios con el UUID que generó Auth:
INSERT INTO public.usuarios (id, rol, nombre_completo, email, activo, colegio_id)
VALUES (
  '<UUID_DEL_AUTH>',
  'director',
  '<NOMBRE DIRECTOR>',
  '<EMAIL>',
  true,
  '<UUID_DEL_COLEGIO_INSERTADO>'
);
*/

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================