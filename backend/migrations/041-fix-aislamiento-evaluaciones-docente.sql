-- ─────────────────────────────────────────────────────────
-- 041 — Corrige aislamiento multitenant en evaluaciones_docente
-- La restricción evaluaciones_docente_año_key era UNIQUE(año),
-- sin colegio_id, así que solo podía existir UNA fila por año
-- en TODO el sistema. Buena Fe activó su evaluación 2026 primero
-- y ocupó el único lugar disponible; San Juan (Lic. Morales) no
-- podía activar la suya, fallando con
-- "new row violates row-level security policy (USING expression)
-- for table evaluaciones_docente" al intentar un upsert que en
-- realidad chocaba con la fila ajena de Buena Fe.
--
-- Se agregó la columna colegio_id (antes el aislamiento dependía
-- solo de activada_por -> usuarios.colegio_id, sin columna directa),
-- se migró el dato existente, y se cambió la restricción a
-- UNIQUE(año, colegio_id) para que cada colegio tenga su propia fila.
--
-- Requiere cambio en paralelo en frontend/js/admin/director.js
-- (función activarEvaluacion): onConflict 'año' -> 'año,colegio_id',
-- y se agrega colegio_id + activada_por al upsert.
--
-- Verificado en vivo: Lic. Morales (San Juan) activó su evaluación
-- 2026 sin problema, sin afectar la de Buena Fe.
-- ─────────────────────────────────────────────────────────

ALTER TABLE public.evaluaciones_docente ADD COLUMN colegio_id UUID REFERENCES public.colegios(id);

UPDATE public.evaluaciones_docente e
SET colegio_id = u.colegio_id
FROM public.usuarios u
WHERE u.id = e.activada_por;

ALTER TABLE public.evaluaciones_docente ALTER COLUMN colegio_id SET NOT NULL;

ALTER TABLE public.evaluaciones_docente
DROP CONSTRAINT evaluaciones_docente_año_key;

ALTER TABLE public.evaluaciones_docente
ADD CONSTRAINT evaluaciones_docente_año_colegio_key UNIQUE (año, colegio_id);