-- ============================================================
-- MIGRACIÓN 067: Separar asistencia por sesión (regular / técnica)
--
-- CONTEXTO:
--   En el turno regular (mañana), el estudiante permanece en el
--   colegio toda la jornada; que varios profesores de materias
--   regulares compartan una sola fila de asistencia por día es
--   correcto, porque todos describen el mismo hecho.
--
--   El problema aparece con la tarde: los estudiantes inscritos en
--   una carrera técnica (o en "Técnica Tecnológica General") asisten
--   en un turno aparte, que no es continuación de la mañana. Como
--   hoy `asistencias` tiene una sola fila por (estudiante_id, fecha),
--   sin distinguir turno, la asistencia de la tarde reemplazaba por
--   completo la de la mañana (o al revés), perdiendo una de las dos
--   sin dejar rastro -- incluida la observación de una excepción, si
--   la hubo (ej. un estudiante que se retiró por fiebre a media
--   mañana).
--
-- SOLUCIÓN:
--   Agregar una columna `sesion` ('regular' | 'tecnica') y mover la
--   restricción de unicidad de (estudiante_id, fecha) a
--   (estudiante_id, fecha, sesion). El turno regular sigue
--   funcionando exactamente igual que hoy (una fila por día, varios
--   profesores comparten la misma); la sesión técnica de la tarde
--   gana su propia fila, separada, sin pisar ni ser pisada por la
--   de la mañana.
--
-- POR QUÉ ES SEGURA DE APLICAR (verificado en vivo antes de aplicar):
--   - La columna nace con DEFAULT 'regular': toda fila existente
--     queda clasificada como turno regular automáticamente, sin
--     intervención manual y sin cambiar su sentido.
--   - Se confirmó contra la base real que la restricción única
--     actual se llama exactamente `asistencias_estudiante_id_fecha_key`
--     (pg_constraint), así que el DROP no falla por nombre.
--   - Se confirmó que hoy no existe ninguna fila duplicada por
--     (estudiante_id, fecha) -- por lo tanto no puede haber colisión
--     al crear la restricción compuesta nueva.
--   - Se revisaron las 7 políticas RLS vigentes sobre `asistencias`
--     (select_director, select_estudiante, select_profesor,
--     update_profesor, write_profesor, bloquear_asistencias_*):
--     ninguna referencia la restricción única ni la columna nueva;
--     todas filtran por curso_id / colegio_id / estudiante_id /
--     config_gestion. El aislamiento multitenant no se toca, y no
--     hace falta crear ni modificar ninguna política.
--   - No se borra ninguna columna, fila ni tabla. No afecta a otras
--     tablas del esquema.
--
-- REGLA PARA DECIDIR LA SESIÓN (aplicada en el frontend, no en SQL):
--   sesion = 'tecnica' si la materia es una carrera técnica específica
--   (materias.es_tecnica = true) o es "Técnica Tecnológica General"
--   (que en la tabla figura como regular, es_tecnica = false, pero se
--   cursa en la tarde). Cualquier otra materia -> 'regular'.
--
-- ARCHIVOS QUE SE TOCAN FUERA DE ESTA MIGRACIÓN:
--   frontend/js/profesor/profesor.js -- 5 puntos: el botón "Guardar
--   asistencia" (pasa esTecnica), guardarAsistencia() (firma, payload
--   y onConflict), las 2 consultas que cargan asistencia guardada
--   (agregan .eq('sesion', ...)), y cargarFaltasMesEstudiantes()
--   (agrega el mismo filtro). Ningún otro archivo del sistema asume
--   una sola fila por día -- director.js, estudiante.js, calculos.js,
--   export-excel.js y notificaciones.js solo suman/cuentan filas por
--   rango de fecha, así que empiezan a ver ambas sesiones como
--   eventos reales separados sin romperse.
-- ============================================================

ALTER TABLE public.asistencias
  ADD COLUMN IF NOT EXISTS sesion TEXT NOT NULL DEFAULT 'regular'
  CHECK (sesion IN ('regular', 'tecnica'));

ALTER TABLE public.asistencias
  DROP CONSTRAINT IF EXISTS asistencias_estudiante_id_fecha_key;

ALTER TABLE public.asistencias
  ADD CONSTRAINT asistencias_estudiante_id_fecha_sesion_key
  UNIQUE (estudiante_id, fecha, sesion);

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. select column_name, column_default from information_schema.columns
--    where table_name = 'asistencias' and column_name = 'sesion';
--    -> debe existir, default 'regular'.
--
-- 2. select sesion, count(*) from asistencias group by sesion;
--    -> el 100% de las filas existentes debe caer en 'regular'.
--
-- 3. select conname from pg_constraint
--    where conrelid = 'public.asistencias'::regclass and contype = 'u';
--    -> debe mostrar asistencias_estudiante_id_fecha_sesion_key,
--       ya no la vieja asistencias_estudiante_id_fecha_key.
--
-- 4. Guardar asistencia regular y técnica el mismo día para el mismo
--    estudiante desde el frontend ya corregido -> deben convivir como
--    2 filas distintas, ninguna pisa a la otra.
-- ─────────────────────────────────────────────────────────