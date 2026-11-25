--Efecto real esperado: el flujo normal del tutor (subir comprobante desde la app) sigue funcionando exactamente igual — sigue mandando estado: 'pendiente' como siempre. Lo único que cambia es que si alguien intenta el INSERT a mano con estado: "aprobado", ahora la base lo va a rechazar con un 403/42501, en vez de aceptarlo.
alter policy "pagos_insert_tutor"
on public.pagos_mensualidad
with check (
  (tutor_id = auth.uid())
  and exists (
    select 1 from tutor_estudiante
    where tutor_estudiante.tutor_id = auth.uid()
    and tutor_estudiante.estudiante_id = pagos_mensualidad.estudiante_id
    and tutor_estudiante.activo = true
  )
  and estado = 'pendiente'
);