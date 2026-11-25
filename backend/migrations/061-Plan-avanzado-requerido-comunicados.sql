-- ============================================================
-- MIGRACIÓN 061: Plan avanzado requerido para enviar comunicados
-- (director y profesor; lectura sin cambios)
--
-- Contexto (058 / 059 / 060): cuarto candidato del mismo patrón
-- de cierre de plan por colegio. Hoy el módulo de Comunicados no
-- tiene ningún candado -- director y profesor pueden enviar sin
-- restricción, sin importar el plan del colegio.
--
-- Alcance: solo el INSERT en comunicados (crear un mensaje nuevo).
-- No se toca comunicados_estudiante (reparto a cada estudiante),
-- ninguna policy de lectura (comunicados_select_*, com_est_select_*)
-- ni las de marcar como leído (com_est_update_leido_*). Si el
-- colegio baja a básico, estudiante y tutor conservan el historial
-- de mensajes ya recibidos -- mismo criterio que "Historial" en
-- pagos (migración 060).
--
-- Nota aparte, no incluida acá: con un comunicado_id ya creado en
-- plan avanzado, en teoría se podría seguir agregando estudiantes
-- a esa lista de destinatarios vía comunicados_estudiante estando
-- en básico (com_est_insert_director / com_est_insert_profesor no
-- revisan el plan). Impacto bajo -- no crea mensajes nuevos, solo
-- reutiliza uno viejo -- se deja fuera para no complicar esta
-- migración. A decidir aparte si hace falta cerrarlo.
-- ============================================================
ALTER POLICY comunicados_insert_director
ON public.comunicados
WITH CHECK (
  public.es_director()
  AND colegio_id = public.mi_colegio_id()
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id()
      AND c.plan = 'avanzado'
  )
);
ALTER POLICY comunicados_insert_profesor
ON public.comunicados
WITH CHECK (
  public.es_profesor()
  AND colegio_id = public.mi_colegio_id()
  AND EXISTS (
    SELECT 1 FROM public.colegios c
    WHERE c.id = public.mi_colegio_id()
      AND c.plan = 'avanzado'
  )
);
-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
-- 1. Colegio en básico: director/profesor intenta enviar un
--    comunicado nuevo -> debe fallar (403/42501) a nivel de base,
--    y mostrar el toast de upgrade desde el frontend.
-- 2. Colegio en avanzado: mismas acciones -> deben pasar igual
--    que siempre.
-- 3. Estudiante y tutor de cualquier plan siguen viendo su
--    historial de comunicados recibidos y pueden marcarlos como
--    leídos -> sin cambios.
-- ─────────────────────────────────────────────────────────


