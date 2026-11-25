-- ============================================================
-- MIGRACIÓN 069: Asistencia separada por sesión (regular / técnica)
--
-- PROBLEMA:
--   asistencias tenía una sola fila por (estudiante_id, fecha), sin
--   distinguir turno. En el turno regular (mañana) esto es correcto:
--   el estudiante permanece en el colegio toda la jornada, y que varios
--   profesores de materias regulares compartan una sola fila por día
--   es coherente -- todos describen el mismo hecho.
--
--   El problema aparece en la frontera con la tarde: los estudiantes
--   inscritos en una carrera técnica específica, o en "Técnica
--   Tecnológica General" (los que no tienen carrera propia), asisten
--   en un turno aparte, que no es continuación de la mañana sino una
--   convocatoria distinta. Como compartía la misma llave
--   (estudiante_id, fecha), la asistencia de la tarde reemplazaba por
--   completo la de la mañana (o al revés), perdiendo una de las dos
--   sin dejar rastro -- incluida cualquier observación cargada.
--
-- SOLUCIÓN:
--   Separar por sesión ('regular' / 'tecnica'), no por materia
--   individual. El turno regular sigue funcionando exactamente igual
--   que antes -- varios profesores comparten una fila por día, sin
--   cambio de comportamiento. Solo la sesión técnica de la tarde gana
--   su propia fila, separada, para no pisar ni ser pisada por la de
--   la mañana. "Técnica Tecnológica General" cuenta como sesión
--   'tecnica' aunque en la tabla materias figure como regular
--   (es_tecnica = false) -- se cursa en la tarde igual que las
--   carreras específicas.
--
-- ES ADITIVA Y SEGURA:
--   Todas las filas existentes quedan como sesion = 'regular' por
--   default. Como la restricción vieja ya garantizaba una sola fila
--   por (estudiante_id, fecha), no puede haber colisión al aplicar
--   la nueva restricción de 3 columnas.
--
-- FRONTEND (frontend/js/profesor/profesor.js, ya aplicado en local,
-- pendiente de deploy a producción al momento de este comentario):
--   1. guardarAsistencia() -- agrega sesion al payload de cada fila
--      (según la regla de arriba) y cambia el onConflict a
--      ['estudiante_id','fecha','sesion'].
--   2. Las 2 consultas que cargan la asistencia ya guardada para
--      editar -- agregan .eq('sesion', sesionActual).
--   3. cargarFaltasMesEstudiantes() -- agrega .eq('sesion', ...) para
--      que el contador de faltas del mes no mezcle ambos turnos.
--
-- VERIFICADO EN VIVO (Juana Azurduy, Sistemas Informáticos, 31/07/2026):
--   24 inscritos reales, 21 presentes + 3 faltas, todas las filas con
--   sesion = 'tecnica', sin filas NULL ni mezcladas con 'regular'.
--
-- ESTADO: aplicada en Supabase. Confirmada por consulta directa antes
-- de este archivo -- se documenta acá para que quede registrada.
-- ============================================================

ALTER TABLE public.asistencias
  ADD COLUMN IF NOT EXISTS sesion TEXT NOT NULL DEFAULT 'regular'
  CHECK (sesion IN ('regular', 'tecnica'));

ALTER TABLE public.asistencias
  DROP CONSTRAINT IF EXISTS asistencias_estudiante_id_fecha_key;

ALTER TABLE public.asistencias
  ADD CONSTRAINT asistencias_estudiante_id_fecha_sesion_key
  UNIQUE (estudiante_id, fecha, sesion);