-- ─────────────────────────────────────────────────────────
-- 044 — entregas_tareas: estudiante podía adjuntar entrega a
-- actividad de OTRO curso/colegio
--
-- Hallazgo: "entrega_estudiante_own" (única política de escritura
-- para el estudiante) solo validaba estudiante_id = auth.uid(),
-- sin verificar que actividad_id perteneciera a una actividad de
-- su propio curso. Un estudiante podía insertar una fila en
-- entregas_tareas apuntando a la actividad de otro curso (incluso
-- de otro colegio), con solo conocer el UUID de esa actividad.
--
-- Prueba real (token real de estudiante, Rodrigo — curso 3° Sec. A):
-- POST /rest/v1/entregas_tareas con actividad_id de "4° Secundaria B"
-- (curso ajeno) -> 201 Created. Confirmado y limpiado tras la prueba.
--
-- Fix: se agrega EXISTS (actividad.curso_id = estudiante.curso_id)
-- al WITH CHECK de la política existente. Como el flujo real
-- (subirEntrega en entrega-tareas.js) arma actividad_id siempre a
-- partir del propio curso del estudiante, esto no afecta el uso
-- legítimo -- solo bloquea el caso donde actividad_id no matchea
-- el curso real del estudiante (incluyendo el caso actividad_id
-- nulo, que el flujo normal nunca produce).
--
-- Solo se modifica WITH CHECK (no USING): la app usa upsert con
-- onConflict, así que el WITH CHECK ya cubre tanto el INSERT como
-- la rama de UPDATE del upsert. USING no necesita cambio porque
-- solo gobierna qué filas ya existentes puede tocar el estudiante
-- (las suyas), sin relación con este hallazgo.
--
-- Verificación pendiente (mismo protocolo de hoy):
-- 1. Repetir el mismo ataque (estudiante, actividad de otro curso)
--    -> debe dar 403/42501.
-- 2. Flujo legítimo: el mismo estudiante subiendo una entrega real
--    a una actividad de su propio curso -> debe seguir dando 201.
-- ─────────────────────────────────────────────────────────

alter policy "entrega_estudiante_own"
on public.entregas_tareas
with check (
  estudiante_id = auth.uid()
  and exists (
    select 1
    from public.actividades a
    join public.estudiantes e on e.curso_id = a.curso_id
    where a.id = entregas_tareas.actividad_id
      and e.id = entregas_tareas.estudiante_id
  )
);