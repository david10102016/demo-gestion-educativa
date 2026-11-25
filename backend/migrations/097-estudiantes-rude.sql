-- 100-estudiantes-rude.sql
-- Agrega el código RUDE (Registro Único de Estudiantes) a public.estudiantes.
-- MIGRACIÓN ADITIVA: no modifica ni elimina datos. Los estudiantes existentes quedan con rude = NULL.
-- Verificado en vivo contra Supabase (2 nov 2026): la columna no existía, y no hay vistas, triggers,
-- funciones ni políticas RLS que dependan de las columnas de estudiantes.
-- Idempotente: se puede ejecutar más de una vez sin efectos adicionales.

BEGIN;

ALTER TABLE public.estudiantes
  ADD COLUMN IF NOT EXISTS rude TEXT;

-- Formato: alfanumérico, 8 a 30 caracteres (el RUDE del SIE tiene entre 14 y 18)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'estudiantes_rude_formato_check'
      AND conrelid = 'public.estudiantes'::regclass
  ) THEN
    ALTER TABLE public.estudiantes
      ADD CONSTRAINT estudiantes_rude_formato_check
      CHECK (rude IS NULL OR rude ~ '^[A-Za-z0-9]{8,30}$');
  END IF;
END $$;

-- Un RUDE no se repite dentro del mismo colegio (los NULL no cuentan)
CREATE UNIQUE INDEX IF NOT EXISTS estudiantes_rude_colegio_key
  ON public.estudiantes (colegio_id, rude)
  WHERE rude IS NOT NULL;

COMMENT ON COLUMN public.estudiantes.rude IS
  'Código RUDE del SIE. Opcional; único por colegio.';

COMMIT;

-- Verificación posterior (solo lectura):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='estudiantes' AND column_name='rude';
-- SELECT indexname FROM pg_indexes WHERE tablename='estudiantes' AND indexname='estudiantes_rude_colegio_key';