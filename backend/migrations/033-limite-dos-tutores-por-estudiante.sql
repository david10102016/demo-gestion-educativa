-- ─────────────────────────────────────────────────────────
-- 033 — Límite de 2 tutores por estudiante en vincular_hijo_seguro()
-- Aditivo: no modifica ninguna política RLS ni ninguna tabla, solo
-- agrega una validación adicional (COUNT + IF) dentro del cuerpo de
-- la función existente, antes del INSERT final. Mismo nombre, mismos
-- parámetros, mismo control de colegio y de duplicado que ya tenía
-- desde la migración 020 — no se toca nada de eso.
--
-- Motivo: hasta ahora un estudiante podía tener cualquier cantidad
-- de tutores vinculados por carnet, sin ningún tope. Como el carnet
-- es la única barrera de verificación (no hay control de parentesco
-- real), esto dejaba abierta la posibilidad de que alguien ajeno a
-- la familia se vinculara solo por conocer el número. Se decide fijar
-- un máximo de 2 (cubre el caso normal de padre + madre, cada uno con
-- su propia cuenta); el tercer intento queda bloqueado automáticamente,
-- sin intervención de dirección.
--
-- Casos excepcionales (un tercer tutor legítimo, ej. tutela legal de
-- un abuelo, o una vinculación hecha por error) se resuelven de forma
-- manual y puntual por el encargado del sistema, desactivando el
-- vínculo que corresponda (activo = false) para liberar el cupo — se
-- descarta a propósito construir una funcionalidad de solicitud/
-- aprobación dentro de la app para esto, por ser un caso poco
-- frecuente que no justifica agregar una tabla y políticas RLS nuevas
-- para mantener.
--
-- Verificado antes de aplicar: ningún estudiante de Buena Fe tiene
-- hoy más de 2 tutores activos, así que el límite no afecta ningún
-- vínculo legítimo ya existente.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vincular_hijo_seguro(
  p_estudiante_id UUID,
  p_parentesco    TEXT DEFAULT 'padre'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_colegio_estudiante UUID;
  v_colegio_tutor      UUID;
  v_existe             UUID;
  v_total_tutores       INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  SELECT colegio_id INTO v_colegio_estudiante
  FROM public.estudiantes WHERE id = p_estudiante_id;

  IF v_colegio_estudiante IS NULL THEN
    RAISE EXCEPTION 'Estudiante no encontrado';
  END IF;

  SELECT colegio_id INTO v_colegio_tutor
  FROM public.tutores_familia WHERE id = auth.uid();

  IF v_colegio_tutor IS NULL THEN
    UPDATE public.tutores_familia SET colegio_id = v_colegio_estudiante WHERE id = auth.uid();
    UPDATE public.usuarios        SET colegio_id = v_colegio_estudiante WHERE id = auth.uid();
  ELSIF v_colegio_tutor <> v_colegio_estudiante THEN
    RAISE EXCEPTION 'Este estudiante pertenece a otro colegio y no puede vincularse a tu cuenta.';
  END IF;

  SELECT te.id INTO v_existe
  FROM public.tutor_estudiante te
  WHERE te.tutor_id = auth.uid() AND te.estudiante_id = p_estudiante_id;

  IF v_existe IS NOT NULL THEN
    RAISE EXCEPTION 'Este estudiante ya está vinculado a tu cuenta';
  END IF;

  SELECT COUNT(*) INTO v_total_tutores
  FROM public.tutor_estudiante
  WHERE estudiante_id = p_estudiante_id AND activo = true;

  IF v_total_tutores >= 2 THEN
    RAISE EXCEPTION 'Este estudiante ya tiene el máximo de tutores permitidos. Si necesitas vincular a un tercer familiar (ej. tutor legal), contacta a dirección del colegio.';
  END IF;

  INSERT INTO public.tutor_estudiante (tutor_id, estudiante_id, parentesco)
  VALUES (auth.uid(), p_estudiante_id, p_parentesco);

  RETURN TRUE;
END;
$$;