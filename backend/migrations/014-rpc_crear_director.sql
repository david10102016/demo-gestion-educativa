CREATE OR REPLACE FUNCTION public.rpc_crear_director(
  p_id         UUID,
  p_nombre     TEXT,
  p_email      TEXT,
  p_colegio_id UUID
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, auth
AS $$
  INSERT INTO public.usuarios (id, nombre_completo, email, rol, activo, colegio_id)
  VALUES (p_id, p_nombre, p_email, 'director', true, p_colegio_id)
  ON CONFLICT (id) DO UPDATE SET
    colegio_id      = p_colegio_id,
    rol             = 'director',
    activo          = true,
    nombre_completo = p_nombre;
$$;