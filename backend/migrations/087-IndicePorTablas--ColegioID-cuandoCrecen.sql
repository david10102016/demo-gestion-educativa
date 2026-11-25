-- =====================================================================
-- MIGRACIÓN 087: Índices por colegio_id en tablas que crecen
-- ---------------------------------------------------------------------
-- QUÉ HACE:
--   Crea un índice sobre la columna colegio_id en 7 tablas que crecen
--   con cada colegio y cada estudiante: estudiantes, usuarios, cursos,
--   materias, pagos_mensualidad, tutores_familia y bitacora_docente.
--
-- POR QUÉ ES ADITIVA (NO ROMPE NADA):
--   - Un índice es una estructura aparte; no modifica ni borra filas.
--   - No cambia columnas, políticas RLS, funciones ni el frontend.
--   - Las consultas devuelven exactamente los mismos resultados.
--   - IF NOT EXISTS evita error si el índice ya existiera.
--   - Se puede revertir con DROP INDEX sin afectar los datos.
--
-- MEJORA ESPERADA:
--   Cada consulta filtra por colegio (RLS multitenant). Sin índice,
--   PostgreSQL recorre toda la tabla; con índice va directo a las
--   filas del colegio. Hoy (unos 800 estudiantes) la diferencia es
--   mínima; al sumar colegios y miles de estudiantes, mantiene las
--   pantallas rápidas sin importar cuánto crezca la plataforma.
--
-- COSTO:
--   Ocupa poco espacio y hace levemente más lenta cada escritura;
--   imperceptible con el volumen actual. Las tablas de configuración
--   no se indexan porque tienen pocas filas por colegio.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_estudiantes_colegio       ON public.estudiantes(colegio_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_colegio          ON public.usuarios(colegio_id);
CREATE INDEX IF NOT EXISTS idx_cursos_colegio            ON public.cursos(colegio_id);
CREATE INDEX IF NOT EXISTS idx_materias_colegio          ON public.materias(colegio_id);
CREATE INDEX IF NOT EXISTS idx_pagos_mensualidad_colegio ON public.pagos_mensualidad(colegio_id);
CREATE INDEX IF NOT EXISTS idx_tutores_familia_colegio   ON public.tutores_familia(colegio_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_docente_colegio  ON public.bitacora_docente(colegio_id);