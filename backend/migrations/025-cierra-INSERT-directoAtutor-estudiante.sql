-- ─────────────────────────────────────────────────────────
-- 025 — Cierra INSERT directo a tutor_estudiante desde el cliente
-- Aditivo en el sentido de que no borra datos ni modifica otras tablas,
-- pero SÍ elimina una vía de acceso existente (no es aditivo puro).
--
-- Hallazgo: tutor_estudiante_insert_propio solo verificaba
-- tutor_id = auth.uid(), sin validar colegio, carnet, ni pasar por
-- la función segura vincular_hijo_seguro() (migración 020).
-- Cualquier usuario autenticado con rol tutor podía insertar
-- directo una fila vinculándose a cualquier estudiante del sistema,
-- de cualquier colegio, sin ningún control.
--
-- tutor_estudiante_insert_director tenía el mismo defecto
-- (es_director() sin colegio_de_estudiante()), y se confirmó que
-- el director no usa esta vía en ningún punto del frontend.
--
-- Confirmado en vivo con curl usando token real de una cuenta tutor:
-- antes del fix -> insert exitoso, devolvía el vínculo creado,
-- y ese vínculo daba acceso de lectura real a la ficha del estudiante
-- (carnet, curso_id, colegio_id) de otro colegio.
-- después del fix -> error 42501 "permission denied for table
-- tutor_estudiante".
--
-- La única vía legítima de vinculación queda vincular_hijo_seguro()
-- (SECURITY DEFINER, no afectada por este REVOKE porque corre con
-- privilegios del dueño de la función, no del rol authenticated).
-- Verificado que el flujo real de un padre vinculando a su hijo
-- sigue funcionando después de este cambio.
-- ─────────────────────────────────────────────────────────

REVOKE INSERT ON public.tutor_estudiante FROM authenticated;

DROP POLICY IF EXISTS "tutor_estudiante_insert_propio" ON public.tutor_estudiante;
DROP POLICY IF EXISTS "tutor_estudiante_insert_director" ON public.tutor_estudiante;