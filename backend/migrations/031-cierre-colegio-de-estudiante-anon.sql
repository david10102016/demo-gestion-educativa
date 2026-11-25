-- 031 — Cierra colegio_de_estudiante() para anon/PUBLIC.
-- A diferencia de las otras RPC cerradas en la migración 023, esta
-- función SÍ se usa dentro de políticas RLS existentes (tutor_estudiante_select_director,
-- tutor_estudiante_select_secretaria), así que el permiso de authenticated
-- se mantiene intacto — solo se cierra el acceso sin sesión.
--
-- Hallazgo: la función no compara contra auth.uid() en ningún punto,
-- a diferencia de profesor_asignado_curso/profesor_asignado_materia/
-- profesor_es_tutor_de_estudiante (esas tres sí lo hacen, y por eso
-- ya son inofensivas para anon: siempre devuelven false sin sesión).
-- Confirmado con curl sin ningún token: devolvía el colegio_id real
-- de un estudiante real, solo mandando su UUID.
--
-- Después del fix: {"code":"42501","message":"permission denied
-- for function colegio_de_estudiante"}

REVOKE EXECUTE ON FUNCTION public.colegio_de_estudiante(uuid) FROM PUBLIC, anon;