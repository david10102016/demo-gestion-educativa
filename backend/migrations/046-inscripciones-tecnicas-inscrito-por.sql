-- 046-inscripciones-tecnicas-inscrito-por.sql
-- ─────────────────────────────────────────────────────────
-- 046 — Agrega columna faltante inscrito_por en inscripciones_tecnicas
--
-- Problema: el módulo de "Carreras técnicas" (director.js /
-- carreras-tecnicas.js), al guardar inscripciones importadas desde
-- Excel, envía un payload con el campo `inscrito_por` (id del director
-- que hizo la importación). La tabla `inscripciones_tecnicas` nunca
-- tuvo esa columna — el guardado fallaba con PGRST204 ("Could not
-- find the 'inscrito_por' column"). El código quedó escrito
-- anticipando la columna, pero la migración que la crea nunca se
-- aplicó.
--
-- Confirmado contra information_schema.columns en vivo: la tabla solo
-- tiene id, estudiante_id, materia_id, curso_id, activo, created_at.
--
-- Solución: agregar la columna, con el mismo patrón que ya usa el
-- resto del sistema para este tipo de campo de auditoría
-- (creado_por en actividades/notas, registrado_por en
-- asistencias/pagos_mensualidad): uuid nullable + FK a usuarios(id).
-- Nullable a propósito, para no romper filas ya existentes que no
-- tienen ese dato.
--
-- Cambio puramente aditivo: agrega una columna nueva, no toca RLS,
-- no toca datos existentes, no afecta ninguna otra funcionalidad.
-- ─────────────────────────────────────────────────────────

ALTER TABLE public.inscripciones_tecnicas
  ADD COLUMN IF NOT EXISTS inscrito_por uuid;

ALTER TABLE public.inscripciones_tecnicas
  ADD CONSTRAINT inscripciones_tecnicas_inscrito_por_fkey
  FOREIGN KEY (inscrito_por) REFERENCES public.usuarios(id);

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'inscripciones_tecnicas';
-- -> debe aparecer inscrito_por (uuid)
--
-- Probar en vivo: reimportar el mismo Excel de carreras técnicas y
-- guardar -> debe guardar sin el error PGRST204.
-- ─────────────────────────────────────────────────────────