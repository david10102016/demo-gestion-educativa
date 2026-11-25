-- 027 — Bloquea con un trigger que comunicado_id y estudiante_id
-- se puedan modificar en cualquier UPDATE sobre comunicados_estudiante,
-- sin importar qué política RLS lo autorice. Solo permite tocar
-- leido_at (o cualquier otra columna nueva que se agregue a futuro).

CREATE OR REPLACE FUNCTION public.proteger_comunicado_estudiante()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.comunicado_id  <> OLD.comunicado_id
     OR NEW.estudiante_id <> OLD.estudiante_id THEN
    RAISE EXCEPTION 'No se puede modificar comunicado_id ni estudiante_id de un registro existente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proteger_comunicado_estudiante ON public.comunicados_estudiante;
CREATE TRIGGER trg_proteger_comunicado_estudiante
BEFORE UPDATE ON public.comunicados_estudiante
FOR EACH ROW EXECUTE FUNCTION public.proteger_comunicado_estudiante();