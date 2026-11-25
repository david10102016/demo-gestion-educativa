// js/licencias/licencias-profesor.js
// Precarga de licencias aprobadas en la lista de asistencia del profesor.
// Solo marca "Licencia" en los estudiantes que AÚN NO tienen registro guardado ese día;
// el profesor confirma al pulsar "Guardar asistencia" (y puede cambiarla antes).
import { licenciasAprobadasDelDia, MOTIVOS } from './licencias-api.js'
import { escapeHtml as esc } from '../utils/sanitize.js'

export async function aplicarLicenciasEnLista(fecha, estudianteIds, regMap = {}) {
  let mapa = {}
  try { mapa = await licenciasAprobadasDelDia(estudianteIds, fecha) } catch (_) { return }
  const ids = Object.keys(mapa)
  if (!ids.length) return
  let precargadas = 0
  ids.forEach(id => {
    const lic = mapa[id]
    const motivo = (MOTIVOS[lic.motivo] ?? '').replace(/^\S+\s/, '')
    const radio = document.querySelector(`.asis-radio[data-est="${CSS.escape(id)}"][value="licencia"]`)
    if (!radio) return
    const fila = radio.closest('tr')
    const nom = fila?.querySelector('.asis-nom')
    if (nom && !fila.querySelector('.lic-etq')) {
      nom.insertAdjacentHTML('afterend', ` <span class="badge badge-amarillo lic-etq" title="Licencia aprobada por dirección" style="font-size:10px;">📋 Licencia aprobada · ${esc(motivo)}</span>`)
    }
    if (regMap[id]) return                       // ya guardado: no se toca lo que decidió el profesor
    radio.checked = true
    radio.dispatchEvent(new Event('change', { bubbles: true }))
    const obs = document.querySelector(`.asis-obs[data-est="${CSS.escape(id)}"]`)
    if (obs && !obs.value) obs.value = `Licencia aprobada: ${motivo}`
    precargadas++
  })
  window.actualizarContadoresAsistencia?.()
  if (precargadas) {
    const tabla = document.getElementById('tbody-asistencia')?.closest('.card')
    tabla?.insertAdjacentHTML('afterbegin', `<div style="background:#fef9c3;color:#78350f;border-radius:10px;padding:8px 12px;font-size:12.5px;margin-bottom:10px;">
      📋 ${precargadas} estudiante${precargadas !== 1 ? 's tienen' : ' tiene'} licencia aprobada por dirección: se marcó <b>Licencia</b>. Revisa y pulsa <b>Guardar asistencia</b>.</div>`)
  }
}
