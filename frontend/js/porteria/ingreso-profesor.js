// js/porteria/ingreso-profesor.js
// Profesor: en la lista de asistencia de HOY pone junto al nombre la hora en que el estudiante
// pasó por portería: "🚪 Colegio 07:52" (verde a tiempo, naranja atraso, gris aún no ingresó).
// Se distingue de la hora del aula ("📷 Aula ...", QR del profesor). Solo informativo, no cambia nada.
// Si el colegio no usa portería, la RPC devuelve [] y no se dibuja nada.
import { ingresoHoyEstudiantes, horaBolivia, ESTADOS } from './porteria-api.js'

// Recibe los ids de la lista cargada (curso regular o técnica que junta A y B)
export async function mostrarIngresoPorteria(estudianteIds) {
  const filas = await ingresoHoyEstudiantes(estudianteIds)
  if (!filas?.length) return
  const mapa = new Map(filas.map(f => [f.estudiante_id, f]))
  const vistos = new Set()
  document.querySelectorAll('[data-est]').forEach(input => {
    const id = input.dataset.est
    if (vistos.has(id)) return
    vistos.add(id)
    const fila = input.closest('tr, .asis-row, li, div')
    const nom = fila?.querySelector('.asis-nom')
    if (!nom || nom.querySelector('.ing-porteria')) return
    const f = mapa.get(id)
    const e = f?.hora_ingreso ? (ESTADOS[f.estado] ?? ESTADOS.a_tiempo) : ESTADOS.sin_ingreso
    const span = document.createElement('span')
    span.className = 'ing-porteria'
    span.title = f?.hora_ingreso ? `Ingresó al colegio a las ${horaBolivia(f.hora_ingreso)}` : 'Aún no pasó por portería'
    span.style.cssText = `margin-left:6px;font-size:11px;font-weight:600;color:${e.color};white-space:nowrap;display:inline-block;`
    span.textContent = f?.hora_ingreso ? `🚪 Colegio ${horaBolivia(f.hora_ingreso)}` : '🚪 Colegio: aún no'
    nom.appendChild(span)
  })
}