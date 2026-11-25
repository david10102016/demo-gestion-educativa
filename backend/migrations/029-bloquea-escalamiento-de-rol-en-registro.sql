-- 1. Trigger corregido: nunca confía en el rol que manda el cliente.
--    Toda cuenta nueva nace como 'tutor' — el único rol de auto-registro público real.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, nombre_completo, rol)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', NEW.email),
    'tutor'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Función segura para que un director/superadmin ascienda a un usuario
--    ya creado (por signUp) al rol correcto, validando quién llama.
CREATE OR REPLACE FUNCTION public.asignar_rol_privilegiado(
  p_usuario_id UUID,
  p_rol        TEXT,
  p_colegio_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT (public.es_director() OR public.es_superadmin()) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF p_rol NOT IN ('profesor', 'secretaria', 'director') THEN
    RAISE EXCEPTION 'Rol no permitido para esta función';
  END IF;

  -- Un director común solo puede crear roles dentro de su propio colegio
  IF public.es_director() AND NOT public.es_superadmin() THEN
    IF p_rol = 'director' THEN
      RAISE EXCEPTION 'Sin permisos para crear otro director';
    END IF;
    UPDATE public.usuarios
    SET rol = p_rol, colegio_id = public.mi_colegio_id(), activo = true
    WHERE id = p_usuario_id;
  ELSE
    UPDATE public.usuarios
    SET rol = p_rol, colegio_id = COALESCE(p_colegio_id, public.mi_colegio_id()), activo = true
    WHERE id = p_usuario_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.asignar_rol_privilegiado(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignar_rol_privilegiado(UUID, TEXT, UUID) TO authenticated;