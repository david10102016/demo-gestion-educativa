-- ============================================================
-- MIGRACIÓN 018 — Módulo de Comunicados
-- Sistema de gestión escolar multitenant (gestion-educativa2027)
-- ------------------------------------------------------------
-- Implementa el módulo de comunicados internos entre director,
-- profesores y estudiantes. Incluye tablas, RLS policies,
-- funciones helper e índices de rendimiento.
--
-- CORRECCIÓN INCLUIDA (aplicada post-deploy):
--   Se añadieron dos policies SELECT que faltaban para que el
--   estudiante pueda resolver los joins de Supabase al leer
--   sus comunicados. Sin ellas el campo `comunicado` llegaba
--   null en el cliente aunque los datos existían.
--
--   INTENTO FALLIDO (NO aplicar):
--   Una policy con EXISTS cruzado entre `comunicados` y
--   `comunicados_estudiante` provocó recursión infinita
--   (código 42P17). La solución correcta es filtrar solo
--   por colegio_id usando mi_colegio_id(), delegando el
--   filtro por estudiante a la policy com_est_select_estudiante.
-- ============================================================

-- ─── CURSOS: columna tutor ────────────────────────────────
ALTER TABLE public.cursos
ADD COLUMN IF NOT EXISTS tutor_profesor_id UUID REFERENCES public.usuarios(id);

-- ─── TABLA: comunicados ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comunicados (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id          UUID NOT NULL REFERENCES public.colegios(id),
  emisor_id           UUID NOT NULL REFERENCES public.usuarios(id),
  tipo_emisor         TEXT NOT NULL CHECK (tipo_emisor IN ('director', 'profesor')),
  tipo_destinatario   TEXT NOT NULL CHECK (tipo_destinatario IN ('estudiante', 'curso', 'colegio')),
  destinatario_id     UUID,
  materia_id          UUID REFERENCES public.materias(id),
  asunto              TEXT NOT NULL,
  contenido           TEXT NOT NULL,
  categoria           TEXT NOT NULL DEFAULT 'Informativo'
                      CHECK (categoria IN ('Citación', 'Informativo', 'Urgente')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TABLA: comunicados_estudiante ────────────────────────
CREATE TABLE IF NOT EXISTS public.comunicados_estudiante (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comunicado_id   UUID NOT NULL REFERENCES public.comunicados(id) ON DELETE CASCADE,
  estudiante_id   UUID NOT NULL REFERENCES public.estudiantes(id) ON DELETE CASCADE,
  leido_at        TIMESTAMPTZ,
  UNIQUE(comunicado_id, estudiante_id)
);

-- ─── RLS ──────────────────────────────────────────────────
ALTER TABLE public.comunicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comunicados_estudiante ENABLE ROW LEVEL SECURITY;

-- ─── FUNCIONES HELPER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profesor_tiene_asignacion(p_estudiante_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asignaciones_profesor ap
    JOIN public.estudiantes e ON e.curso_id = ap.curso_id
    WHERE ap.profesor_id = auth.uid()
      AND e.id = p_estudiante_id
      AND ap.activo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.profesor_es_tutor_de_estudiante(p_estudiante_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.estudiantes e
    JOIN public.cursos c ON c.id = e.curso_id
    WHERE e.id = p_estudiante_id
      AND c.tutor_profesor_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.comunicado_es_de_mi_hijo(p_comunicado_estudiante_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comunicados_estudiante ce
    JOIN public.tutor_estudiante te ON te.estudiante_id = ce.estudiante_id
    WHERE ce.id = p_comunicado_estudiante_id
      AND te.tutor_id = auth.uid()
  );
$$;

-- ─── POLICIES: comunicados ────────────────────────────────
CREATE POLICY "comunicados_select_director"
ON public.comunicados FOR SELECT
USING (es_director() AND colegio_id = mi_colegio_id());

CREATE POLICY "comunicados_select_profesor"
ON public.comunicados FOR SELECT
USING (es_profesor() AND emisor_id = auth.uid());

CREATE POLICY "comunicados_insert_director"
ON public.comunicados FOR INSERT
WITH CHECK (es_director() AND colegio_id = mi_colegio_id());

CREATE POLICY "comunicados_insert_profesor"
ON public.comunicados FOR INSERT
WITH CHECK (es_profesor() AND colegio_id = mi_colegio_id());

-- ─── POLICIES: comunicados_estudiante ────────────────────
CREATE POLICY "com_est_select_estudiante"
ON public.comunicados_estudiante FOR SELECT
USING (estudiante_id = auth.uid());

CREATE POLICY "com_est_select_tutor"
ON public.comunicados_estudiante FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tutor_estudiante te
    WHERE te.estudiante_id = comunicados_estudiante.estudiante_id
      AND te.tutor_id = auth.uid()
  )
);

CREATE POLICY "com_est_select_director"
ON public.comunicados_estudiante FOR SELECT
USING (
  es_director() AND EXISTS (
    SELECT 1 FROM public.comunicados c
    WHERE c.id = comunicado_id
      AND c.colegio_id = mi_colegio_id()
  )
);

CREATE POLICY "com_est_select_profesor"
ON public.comunicados_estudiante FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.comunicados c
    WHERE c.id = comunicado_id
      AND c.emisor_id = auth.uid()
  )
);

CREATE POLICY "com_est_insert_director"
ON public.comunicados_estudiante FOR INSERT
WITH CHECK (
  es_director() AND EXISTS (
    SELECT 1 FROM public.comunicados c
    WHERE c.id = comunicado_id
      AND c.colegio_id = mi_colegio_id()
  )
);

CREATE POLICY "com_est_insert_profesor"
ON public.comunicados_estudiante FOR INSERT
WITH CHECK (
  es_profesor() AND
  profesor_tiene_asignacion(estudiante_id) AND
  EXISTS (
    SELECT 1 FROM public.comunicados c
    WHERE c.id = comunicado_id
      AND c.emisor_id = auth.uid()
  )
);

CREATE POLICY "com_est_update_leido_estudiante"
ON public.comunicados_estudiante FOR UPDATE
USING (estudiante_id = auth.uid())
WITH CHECK (TRUE);

CREATE POLICY "com_est_update_leido_tutor"
ON public.comunicados_estudiante FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.tutor_estudiante te
    WHERE te.estudiante_id = comunicados_estudiante.estudiante_id
      AND te.tutor_id = auth.uid()
  )
)
WITH CHECK (TRUE);

-- ─── ÍNDICES ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comunicados_colegio    ON public.comunicados(colegio_id);
CREATE INDEX IF NOT EXISTS idx_comunicados_emisor     ON public.comunicados(emisor_id);
CREATE INDEX IF NOT EXISTS idx_com_est_estudiante     ON public.comunicados_estudiante(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_com_est_comunicado     ON public.comunicados_estudiante(comunicado_id);
CREATE INDEX IF NOT EXISTS idx_com_est_leido          ON public.comunicados_estudiante(leido_at) WHERE leido_at IS NULL;

-- ============================================================
-- CORRECCIÓN POST-DEPLOY — políticas faltantes para estudiante
-- Aplicadas en sesión de debugging tras detectar que el join
-- comunicados_estudiante → comunicados devolvía null en el cliente.
-- ============================================================

-- Permite al estudiante leer comunicados de su colegio para
-- resolver el join Supabase. El filtro por destinatario ya
-- lo hace com_est_select_estudiante en comunicados_estudiante.
CREATE POLICY "comunicados_select_estudiante"
ON public.comunicados FOR SELECT
USING (
  es_estudiante()
  AND colegio_id = mi_colegio_id()
);

-- Permite al estudiante leer el registro del emisor (profesor/director)
-- en usuarios para mostrar el nombre del remitente en la bandeja.
CREATE POLICY "usuarios_select_mismo_colegio"
ON public.usuarios FOR SELECT
USING (
  es_estudiante()
  AND colegio_id = mi_colegio_id()
);
-- ============================================================
-- Columna destinatario_nombre en comunicados
-- Sistema de gestión escolar multitenant (gestion-educativa2027)
-- ------------------------------------------------------------
-- Agrega la columna destinatario_nombre a la tabla comunicados
-- para persistir el nombre legible del destinatario al momento
-- del envío, evitando joins problemáticos entre comunicados y
-- tablas polimórficas (cursos/usuarios) donde destinatario_id
-- no tiene foreign key definida.
--
-- CONTEXTO:
--   La tabla comunicados usa destinatario_id como UUID libre
--   que puede referenciar cursos o usuarios según tipo_destinatario.
--   Supabase no puede resolver el join automáticamente sin FK,
--   y resolverlo en JS requería queries adicionales por cada
--   comunicado. La solución más limpia es guardar el nombre
--   como texto plano en el momento del envío.
--
-- CAMBIOS EN CÓDIGO (aplicados junto a esta migración):
--   - comunicados.js: enviarComunicado() acepta destinatario_nombre
--   - comunicados.js: getComunicadosEnviados() lee destinatario_nombre
--     y calcula leidos_count con query separada (evita filtros
--     anidados no soportados en supabase-js v2.39)
--   - profesor.js: enviarComunicadoProf() captura el nombre desde
--     el DOM (texto del option/label seleccionado) y lo pasa
--     a enviarComunicado()
--   - comunicados-ui.js: renderTablaEnviados() muestra
--     destinatario_nombre y columna Leídos, fila clickeable
--     abre modal con contenido completo
-- ============================================================

ALTER TABLE public.comunicados
ADD COLUMN IF NOT EXISTS destinatario_nombre TEXT;