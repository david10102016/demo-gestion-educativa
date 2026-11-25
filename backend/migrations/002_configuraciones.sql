-- ============================================================
-- MIGRACIÓN 002: MÓDULO DE CONFIGURACIONES DINÁMICAS
-- Todo lo que era hardcodeado ahora es configurable
-- ============================================================

-- -------------------------------------------------------
-- TABLA: config_gestion
-- Año académico activo, periodos, nota mínima
-- Reemplaza: trimestre CHECK(1..3), >= 51, 'APROBADO'
-- -------------------------------------------------------
CREATE TABLE public.config_gestion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  año                     INT  NOT NULL UNIQUE,
  estado                  TEXT NOT NULL DEFAULT 'activo'
                            CHECK (estado IN ('planificacion','activo','cerrado')),
  cantidad_periodos       INT  NOT NULL DEFAULT 3 CHECK (cantidad_periodos BETWEEN 1 AND 6),
  nombre_periodo          TEXT NOT NULL DEFAULT 'Trimestre',
  nota_minima_aprobacion  NUMERIC(5,2) NOT NULL DEFAULT 51,
  escala_maxima           NUMERIC(5,2) NOT NULL DEFAULT 100,
  etiqueta_aprobado       TEXT NOT NULL DEFAULT 'APROBADO',
  etiqueta_reprobado      TEXT NOT NULL DEFAULT 'REPROBADO',
  activado_por            UUID REFERENCES public.usuarios(id),
  fecha_apertura          TIMESTAMPTZ DEFAULT NOW(),
  fecha_cierre            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.config_gestion IS 'Gestión académica anual. Reemplaza valores hardcodeados de periodos y aprobación.';

-- Vista rápida de gestión activa
CREATE OR REPLACE VIEW public.gestion_activa AS
  SELECT * FROM public.config_gestion WHERE estado = 'activo' LIMIT 1;

-- -------------------------------------------------------
-- TABLA: config_dimensiones
-- Pesos de evaluación por año
-- Reemplaza: hacer=40, saber=45, ser=10, decidir=5 fijos
-- -------------------------------------------------------
CREATE TABLE public.config_dimensiones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestion_id      UUID NOT NULL REFERENCES public.config_gestion(id) ON DELETE CASCADE,
  año             INT  NOT NULL,
  codigo          TEXT NOT NULL,        -- 'hacer','saber','ser','decidir' u otros
  nombre_display  TEXT NOT NULL,        -- 'HACER','SABER','SER','DECIDIR'
  descripcion     TEXT,
  peso_maximo     NUMERIC(5,2) NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN (
                    'actividades',      -- promedio de notas de actividades
                    'ficha',            -- viene de ficha_seguimiento_ser
                    'directo'           -- ingreso directo (autoevaluación)
                  )),
  orden           INT NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gestion_id, codigo)
);
COMMENT ON TABLE public.config_dimensiones IS 'Pesos de dimensiones por año. Reemplaza 40/45/10/5 hardcodeados.';

-- -------------------------------------------------------
-- TABLA: config_categorias_ser
-- Categorías de la ficha SER (Responsabilidad, etc.)
-- -------------------------------------------------------
CREATE TABLE public.config_categorias_ser (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  año             INT  NOT NULL,
  nombre          TEXT NOT NULL,
  orden           INT  NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(año, nombre)
);

-- -------------------------------------------------------
-- TABLA: config_subcriterios_ser
-- Subcriterios individuales de la ficha SER
-- Reemplaza: columnas s1..s10 fijas y array CRITERIOS_SER en JS
-- -------------------------------------------------------
CREATE TABLE public.config_subcriterios_ser (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.config_categorias_ser(id) ON DELETE CASCADE,
  año          INT  NOT NULL,
  texto        TEXT NOT NULL,
  descripcion  TEXT,
  orden        INT  NOT NULL DEFAULT 0,
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.config_subcriterios_ser IS 'Subcriterios dinámicos. Reemplaza s1..s10 fijos en SQL y JS.';

-- -------------------------------------------------------
-- TABLA: config_escala_ser
-- Escala de valoración: Nunca=2, Casi Siempre=7, Siempre=10
-- Reemplaza: CHECK (valor IN (2,7,10)) en fichas_seguimiento_ser
-- -------------------------------------------------------
CREATE TABLE public.config_escala_ser (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  año            INT  NOT NULL,
  valor_numerico NUMERIC(5,2) NOT NULL,
  etiqueta       TEXT NOT NULL,
  color          TEXT DEFAULT 'gray',   -- 'green','yellow','red' para UI
  orden          INT  NOT NULL DEFAULT 0,
  UNIQUE(año, valor_numerico)
);
COMMENT ON TABLE public.config_escala_ser IS 'Escala SER dinámica. Reemplaza CHECK(IN(2,7,10)) hardcodeado.';

-- -------------------------------------------------------
-- TABLA: config_preguntas_docente
-- Preguntas de evaluación docente dinámicas
-- Reemplaza: columnas p1..p8 fijas en respuestas_evaluacion
-- -------------------------------------------------------
CREATE TABLE public.config_preguntas_docente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  año           INT  NOT NULL,
  texto         TEXT NOT NULL,
  escala_min    INT  NOT NULL DEFAULT 1,
  escala_max    INT  NOT NULL DEFAULT 4,
  orden         INT  NOT NULL DEFAULT 0,
  activo        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(año, orden)
);
COMMENT ON TABLE public.config_preguntas_docente IS 'Preguntas dinámicas. Reemplaza columnas p1..p8 fijas.';

-- -------------------------------------------------------
-- TABLA: config_notificaciones
-- Plantillas de mensajes Telegram editables por director
-- -------------------------------------------------------
CREATE TABLE public.config_notificaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            TEXT NOT NULL UNIQUE,
  nombre_display  TEXT NOT NULL,
  plantilla       TEXT NOT NULL,
  umbral_faltas   INT  DEFAULT 3,
  activo          BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.config_notificaciones IS 'Plantillas Telegram editables. Reemplaza constantes hardcodeadas en JS.';
