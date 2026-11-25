-- 032 — Limpieza de higiene: cierra el privilegio de tabla que quedó
-- suelto en tutor_estudiante para anon. No cambia ningún comportamiento
-- real (RLS ya bloqueaba INSERT igual, al no existir ninguna política
-- que lo autorice), pero deja el permiso a nivel de base coincidiendo
-- con la intención real, en vez de depender solo de la ausencia de política.

REVOKE INSERT ON public.tutor_estudiante FROM anon;