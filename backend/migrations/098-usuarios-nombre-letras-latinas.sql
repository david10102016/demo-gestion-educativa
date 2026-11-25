-- 098-usuarios-nombre-letras-latinas.sql
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_nombre_formato_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_nombre_formato_check
  CHECK (nombre_completo ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ''\-\s]+$') NOT VALID;