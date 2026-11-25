-- 028 — Bloquea que un tutor cambie su propio colegio_id una vez asignado.
-- Permite la primera asignación (cuando colegio_id es NULL, el caso de
-- vincular_hijo_seguro fijándolo por primera vez), pero bloquea cualquier
-- cambio posterior, sin importar qué política RLS lo autorice.
--
-- Hallazgo: tutores_update_propio solo exigía id = auth.uid(), sin
-- with_check propio (heredaba el mismo USING), permitiendo que un tutor
-- cambiara su propio colegio_id libremente. Como buscar_estudiante_por_carnet
-- y vincular_hijo_seguro (migración 020) confían en ese campo para saber
-- a qué colegio pertenece el tutor, esto podía usarse para saltarse el
-- aislamiento entre colegios armado en esas funciones.
--
-- Confirmado en vivo con curl usando token real de tutor: antes del fix,
-- PATCH cambiando colegio_id de Buena Fe a Mariscal Sucre -> éxito.
-- Después del fix, mismo PATCH -> {"code":"P0001","message":"No se puede
-- modificar el colegio asignado a este tutor"}.
-- Confirmado también que el flujo legítimo (primer hijo vinculado, colegio_id
-- pasando de NULL a un valor real) sigue funcionando sin cambios.

CREATE OR REPLACE FUNCTION public.proteger_colegio_tutor()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.colegio_id IS NOT NULL AND NEW.colegio_id <> OLD.colegio_id THEN
    RAISE EXCEPTION 'No se puede modificar el colegio asignado a este tutor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proteger_colegio_tutor ON public.tutores_familia;
CREATE TRIGGER trg_proteger_colegio_tutor
BEFORE UPDATE ON public.tutores_familia
FOR EACH ROW EXECUTE FUNCTION public.proteger_colegio_tutor();