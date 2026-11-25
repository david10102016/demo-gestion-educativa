-- ============================================================
-- MIGRACIÓN 001: SCHEMA PRINCIPAL
-- Sistema de Gestión Educativa — Nuevo proyecto desde cero
-- Todos los roles usan Supabase Auth (auth.users)
-- ============================================================

-- -------------------------------------------------------
-- EXTENSIONES
-- -------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------
-- TABLA: usuarios
-- Espejo de auth.users con datos del perfil educativo
-- Se sincroniza automáticamente via trigger
-- -------------------------------------------------------
CREATE TABLE public.usuarios (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rol         TEXT NOT NULL CHECK (rol IN ('director','profesor','estudiante')),
  nombre_completo TEXT NOT NULL,
  email       TEXT NOT NULL,
  telefono    TEXT,
  foto_url    TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  colegio_id  UUID,                          -- se llena después de crear colegios
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.usuarios IS 'Perfil educativo de cada usuario. Sincronizado con auth.users via trigger.';

-- -------------------------------------------------------
-- TABLA: colegios
-- Datos institucionales — el director los completa en configuraciones
-- -------------------------------------------------------
CREATE TABLE public.colegios (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  TEXT NOT NULL DEFAULT 'Mi Colegio',
  sigla                   TEXT,
  direccion               TEXT,
  municipio               TEXT,
  departamento            TEXT,
  telefono                TEXT,
  email                   TEXT,
  logo_url                TEXT,
  director_nombre         TEXT,
  resolucion_ministerial  TEXT,
  año_fundacion           INT,
  activo                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.colegios IS 'Datos institucionales. El director los configura desde el panel.';

-- -------------------------------------------------------
-- TABLA: cursos
-- -------------------------------------------------------
CREATE TABLE public.cursos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id      UUID REFERENCES public.colegios(id),
  nivel           TEXT NOT NULL CHECK (nivel IN ('Primaria','Secundaria')),
  grado           INT  NOT NULL CHECK (grado BETWEEN 1 AND 6),
  paralelo        TEXT NOT NULL,
  nombre_completo TEXT GENERATED ALWAYS AS (
    grado::TEXT || '° ' || nivel || ' ' || paralelo
  ) STORED,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.cursos IS '36 cursos base: Primaria/Secundaria × 6 grados × 3 paralelos';

-- -------------------------------------------------------
-- TABLA: materias
-- -------------------------------------------------------
CREATE TABLE public.materias (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id       UUID REFERENCES public.colegios(id),
  nombre           TEXT NOT NULL,
  nivel            TEXT NOT NULL CHECK (nivel IN ('Primaria','Secundaria','Ambos')),
  campo_saberes    TEXT CHECK (campo_saberes IN (
                     'COMUNIDAD Y SOCIEDAD',
                     'CIENCIA TECNOLOGÍA Y PRODUCCIÓN',
                     'VIDA TIERRA TERRITORIO',
                     'COSMOS Y PENSAMIENTO'
                   )),
  es_tecnica       BOOLEAN NOT NULL DEFAULT false,
  aplica_desde     TEXT,                     -- '4to' para carreras técnicas
  activo           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.materias IS 'Materias base del plan de estudios boliviano.';

-- -------------------------------------------------------
-- TABLA: estudiantes
-- Datos adicionales del perfil estudiantil
-- -------------------------------------------------------
CREATE TABLE public.estudiantes (
  id               UUID PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  carnet           TEXT NOT NULL UNIQUE,
  curso_id         UUID REFERENCES public.cursos(id),
  colegio_id       UUID REFERENCES public.colegios(id),
  fecha_nacimiento DATE,
  direccion        TEXT,
  nombre_tutor     TEXT,
  telefono_tutor   TEXT,
  email_tutor      TEXT,
  foto_url         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.estudiantes IS 'Datos complementarios del estudiante, vinculados a usuarios.';

-- -------------------------------------------------------
-- TABLA: asignaciones_profesor
-- Qué profesor enseña qué materia en qué curso
-- -------------------------------------------------------
CREATE TABLE public.asignaciones_profesor (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profesor_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  materia_id  UUID NOT NULL REFERENCES public.materias(id) ON DELETE CASCADE,
  curso_id    UUID NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profesor_id, materia_id, curso_id)
);
COMMENT ON TABLE public.asignaciones_profesor IS 'Asignación de profesores a materias y cursos.';

-- -------------------------------------------------------
-- TABLA: inscripciones_tecnicas
-- Para materias de carreras técnicas (optativas)
-- -------------------------------------------------------
CREATE TABLE public.inscripciones_tecnicas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  materia_id   UUID NOT NULL REFERENCES public.materias(id) ON DELETE CASCADE,
  curso_id     UUID REFERENCES public.cursos(id),
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(estudiante_id, materia_id)
);

-- -------------------------------------------------------
-- TABLA: actividades
-- Las actividades que el profesor crea por dimensión
-- tipo referencia la dimensión (hacer, saber, etc.)
-- max_puntos viene de la configuración de dimensiones
-- -------------------------------------------------------
CREATE TABLE public.actividades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      TEXT NOT NULL,
  descripcion TEXT,
  tipo        TEXT NOT NULL,               -- código de dimensión: 'hacer','saber','ser','decidir'
  max_puntos  NUMERIC(5,2) NOT NULL,
  curso_id    UUID REFERENCES public.cursos(id),
  materia_id  UUID REFERENCES public.materias(id),
  trimestre   INT NOT NULL,               -- periodo (1,2,3 por defecto)
  fecha_limite DATE,
  creado_por  UUID REFERENCES public.usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.actividades IS 'Actividades evaluables. max_puntos y trimestre vienen de config_gestion.';

-- -------------------------------------------------------
-- TABLA: notas
-- Nota de un estudiante en una actividad
-- -------------------------------------------------------
CREATE TABLE public.notas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actividad_id UUID NOT NULL REFERENCES public.actividades(id) ON DELETE CASCADE,
  estudiante_id UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  valor        NUMERIC(5,2) NOT NULL,
  creado_por   UUID REFERENCES public.usuarios(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(actividad_id, estudiante_id)
);

-- -------------------------------------------------------
-- TABLA: calificaciones
-- Notas directas: SER (de ficha) y DECIDIR (autoevaluación)
-- HACER y SABER se calculan desde notas + actividades
-- -------------------------------------------------------
CREATE TABLE public.calificaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  materia_id    UUID NOT NULL REFERENCES public.materias(id) ON DELETE CASCADE,
  trimestre     INT NOT NULL,
  nota_ser      NUMERIC(5,2),
  nota_decidir  NUMERIC(5,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(estudiante_id, materia_id, trimestre)
);
COMMENT ON TABLE public.calificaciones IS 'SER y DECIDIR directos. HACER y SABER se calculan desde notas.';

-- -------------------------------------------------------
-- TABLA: asistencias
-- -------------------------------------------------------
CREATE TABLE public.asistencias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  curso_id      UUID NOT NULL REFERENCES public.cursos(id),
  fecha         DATE NOT NULL,
  estado        TEXT NOT NULL CHECK (estado IN ('presente','falta','retraso','licencia')),
  observaciones TEXT,
  registrado_por UUID REFERENCES public.usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(estudiante_id, fecha)
);

-- -------------------------------------------------------
-- TABLA: fichas_seguimiento_ser
-- Evaluación detallada de la dimensión SER
-- Los subcriterios son dinámicos (config_subcriterios_ser)
-- Los valores se guardan como JSONB para ser flexibles
-- -------------------------------------------------------
CREATE TABLE public.fichas_seguimiento_ser (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id  UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  materia_id     UUID NOT NULL REFERENCES public.materias(id) ON DELETE CASCADE,
  curso_id       UUID REFERENCES public.cursos(id),
  profesor_id    UUID NOT NULL REFERENCES public.usuarios(id),
  trimestre      INT NOT NULL,
  año            INT NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Valores de subcriterios como JSONB: {"sub_uuid": 10, "sub_uuid2": 7, ...}
  valores        JSONB NOT NULL DEFAULT '{}',
  -- Observaciones por categoría como JSONB: {"cat_uuid": "texto obs", ...}
  observaciones  JSONB NOT NULL DEFAULT '{}',
  obs_general    TEXT,
  nota_calculada NUMERIC(5,2) NOT NULL,
  publicada      BOOLEAN NOT NULL DEFAULT false,
  fecha_publicacion TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.fichas_seguimiento_ser IS 'Ficha SER con subcriterios dinámicos en JSONB. Sin columnas s1..s10 fijas.';

-- -------------------------------------------------------
-- TABLA: evaluaciones_docente
-- Control de períodos de evaluación
-- -------------------------------------------------------
CREATE TABLE public.evaluaciones_docente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  año           INT NOT NULL,
  activa        BOOLEAN NOT NULL DEFAULT false,
  activada_por  UUID REFERENCES public.usuarios(id),
  fecha_apertura TIMESTAMPTZ DEFAULT NOW(),
  fecha_cierre  TIMESTAMPTZ,
  UNIQUE(año)
);

-- -------------------------------------------------------
-- TABLA: respuestas_evaluacion
-- Respuestas de estudiantes evaluando profesores
-- Las preguntas son dinámicas (config_preguntas_docente)
-- -------------------------------------------------------
CREATE TABLE public.respuestas_evaluacion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluacion_id UUID NOT NULL REFERENCES public.evaluaciones_docente(id),
  profesor_id   UUID NOT NULL REFERENCES public.usuarios(id),
  estudiante_id UUID NOT NULL REFERENCES public.estudiantes(id),
  -- Respuestas dinámicas: {"pregunta_uuid": 3, "pregunta_uuid2": 4, ...}
  respuestas    JSONB NOT NULL DEFAULT '{}',
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(evaluacion_id, profesor_id, estudiante_id)
);
COMMENT ON TABLE public.respuestas_evaluacion IS 'Sin columnas p1..p8 fijas. Las preguntas son dinámicas en JSONB.';

-- -------------------------------------------------------
-- TABLA: telegram_vinculos
-- -------------------------------------------------------
CREATE TABLE public.telegram_vinculos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id       UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  codigo_vinculacion  TEXT NOT NULL UNIQUE,
  chat_id             BIGINT,
  tipo_usuario        TEXT CHECK (tipo_usuario IN ('estudiante','padre','madre','tutor')),
  vinculado           BOOLEAN NOT NULL DEFAULT false,
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vinculado_at        TIMESTAMPTZ
);

-- -------------------------------------------------------
-- TABLA: notificaciones_log
-- -------------------------------------------------------
CREATE TABLE public.notificaciones_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estudiante_id UUID REFERENCES public.estudiantes(id),
  tipo          TEXT NOT NULL,
  mensaje       TEXT NOT NULL,
  chat_id       BIGINT,
  enviado       BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- TABLA: audit_logs
-- -------------------------------------------------------
CREATE TABLE public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES public.usuarios(id),
  actor_rol   TEXT,
  accion      TEXT NOT NULL,
  tabla       TEXT NOT NULL,
  registro_id UUID,
  datos_antes JSONB,
  datos_despues JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
