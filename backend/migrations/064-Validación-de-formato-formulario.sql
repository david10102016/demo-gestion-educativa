-- ============================================================
-- MIGRACIÓN 064: Validación de formato de nombre/teléfono/email
-- (backend, NOT VALID -- no toca datos existentes)
--
-- NOT VALID: exige la regla en cualquier INSERT/UPDATE nuevo desde
-- este momento, pero NO revisa ni rechaza las filas que ya existen
-- en producción. Cero riesgo de que la migración falle por datos
-- sucios cargados antes de esta fecha.
--
-- Complementa (no reemplaza) la validación de frontend ya aplicada
-- en registro-tutor.html, admin/director.js e importar-estudiantes.js
-- vía js/utils/validaciones.js -- esta es la que no se puede saltar
-- llamando a la API directo.
--
-- ── OBSERVACIÓN IMPORTANTE, por qué son 6 constraints y no 3 ──
-- Una primera versión de esta migración solo tocaba `usuarios`
-- (nombre_completo, telefono, email). Se revisó el código real antes
-- de aplicarla y se encontró que eso dejaba el hueco abierto en los
-- dos campos que originalmente motivaron esta revisión:
--
--   - El teléfono del formulario público de registro de tutor
--     (registro-tutor.html) NO se guarda en `usuarios.telefono`.
--     Se rastreó `registrarTutorDesdeWeb()` en pagos.js, que llama a
--     `crearPerfilTutor(userId, { telefono })`, la cual inserta en
--     `tutores_familia.telefono` -- una tabla distinta.
--   - El teléfono/nombre del tutor que el director carga en la ficha
--     de un estudiante (campos est-tutor / est-telefono-tutor en
--     director.js) tampoco vive en `usuarios` -- se guarda en
--     `estudiantes.nombre_tutor` y `estudiantes.telefono_tutor`.
--
-- Sin los 3 constraints adicionales sobre `tutores_familia` y
-- `estudiantes`, el frontend hubiera validado bien (buena experiencia),
-- pero el candado real de backend solo habría protegido el teléfono/
-- nombre de un director, profesor o secretaria -- exactamente el
-- registro público de tutor (el más expuesto, sin login previo) y la
-- ficha de estudiante hubieran seguido siendo 100% saltables llamando
-- a la API directo, sin ningún constraint real. Por eso esta versión
-- final incluye las 6 reglas en un solo script.
-- ============================================================

-- ── usuarios (director, profesor, secretaria, tutor, superadmin) ──
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_nombre_formato_check
  CHECK (nombre_completo ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü''\-\s]+$')
  NOT VALID;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_telefono_formato_check
  CHECK (telefono IS NULL OR telefono ~ '^\+?[0-9]{7,15}$')
  NOT VALID;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_email_formato_check
  CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')
  NOT VALID;

-- ── tutores_familia (teléfono cargado en el registro público) ──
ALTER TABLE public.tutores_familia
  ADD CONSTRAINT tutores_familia_telefono_formato_check
  CHECK (telefono IS NULL OR telefono ~ '^\+?[0-9]{7,15}$')
  NOT VALID;

-- ── estudiantes (datos de contacto del tutor cargados por el director) ──
ALTER TABLE public.estudiantes
  ADD CONSTRAINT estudiantes_nombre_tutor_formato_check
  CHECK (nombre_tutor IS NULL OR nombre_tutor ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü''\-\s]+$')
  NOT VALID;

ALTER TABLE public.estudiantes
  ADD CONSTRAINT estudiantes_telefono_tutor_formato_check
  CHECK (telefono_tutor IS NULL OR telefono_tutor ~ '^\+?[0-9]{7,15}$')
  NOT VALID;

-- ============================================================
-- Nota: para ver, más adelante y sin apuro, cuántas filas ya
-- existentes violarían cada regla (NO se corrigen ni se tocan
-- solas por esta migración), correr por separado:
--
--   SELECT id, nombre_completo FROM public.usuarios
--   WHERE NOT (nombre_completo ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü''\-\s]+$');
--
--   SELECT id, telefono FROM public.usuarios
--   WHERE telefono IS NOT NULL AND NOT (telefono ~ '^\+?[0-9]{7,15}$');
--
--   SELECT id, email FROM public.usuarios
--   WHERE NOT (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');
--
--   SELECT id, telefono FROM public.tutores_familia
--   WHERE telefono IS NOT NULL AND NOT (telefono ~ '^\+?[0-9]{7,15}$');
--
--   SELECT id, nombre_tutor FROM public.estudiantes
--   WHERE nombre_tutor IS NOT NULL AND NOT (nombre_tutor ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü''\-\s]+$');
--
--   SELECT id, telefono_tutor FROM public.estudiantes
--   WHERE telefono_tutor IS NOT NULL AND NOT (telefono_tutor ~ '^\+?[0-9]{7,15}$');
-- ============================================================