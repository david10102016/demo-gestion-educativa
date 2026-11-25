// js/tutor/notas-hijo.js
// Notas del hijo en el panel del padre (solo lectura).
// Datos: rpc('notas_de_mi_hijo') (migracion 109). Reglas de estado y redondeo: las mismas del panel del estudiante.
import { supabase } from '../config/supabase-config.js'
import { Config, cargarConfiguracion } from '../config/config-app.js'
import { estadoTrimestre, fmtNota, tituloExacto } from '../utils/estado-notas.js'
import { asegurarCarnet } from '../licencias/tutor-licencias.js'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const COLOR = { aprobado: '#15803d', reprobado: '#b91c1c', 'en-riesgo': '#b45309', 'en-curso': '#475569', 'sin-calificar': '#94a3b8' }

function contexto() {
  return {
    trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada, notaMinima: Config.notaMinima,
    etiqAprobado: Config.etiqAprobado, etiqReprobado: Config.etiqReprobado
  }
}

// Adapta la fila de la funcion al formato que espera estado-notas.js
function adaptar(f) {
  const vacio = f.promedio_hacer == null && f.promedio_saber == null && f.nota_ser == null && f.nota_decidir == null
  return {
    ...f,
    nota_hacer: f.promedio_hacer, nota_saber: f.promedio_saber,
    nota_final: vacio ? null : f.nota_final,
    hacer_calificado: f.promedio_hacer != null, saber_calificado: f.promedio_saber != null,
    ser_calificado: f.nota_ser != null, decidir_calificado: f.nota_decidir != null
  }
}

function tabla(filas, ctx) {
  if (!filas.length) return '<p style="color:var(--color-text-3);">Todavía no hay materias con notas en este trimestre.</p>'
  const cuerpo = filas.map(f => {
    const e = estadoTrimestre(f, ctx)
    const nota = f.nota_final == null ? '—' : fmtNota(f.nota_final)
    return `<tr>
      <td>${esc(f.materia)}</td>
      <td style="text-align:center;">${fmtNota(f.nota_hacer)}</td>
      <td style="text-align:center;">${fmtNota(f.nota_saber)}</td>
      <td style="text-align:center;">${fmtNota(f.nota_ser)}</td>
      <td style="text-align:center;">${fmtNota(f.nota_decidir)}</td>
      <td style="text-align:center;font-weight:700;" title="${esc(tituloExacto(f.nota_final))}">${nota}</td>
      <td style="color:${COLOR[e.clave] ?? '#475569'};font-weight:600;">${esc(e.texto)}</td>
    </tr>`
  }).join('')
  return `<div class="table-wrapper"><table>
    <thead><tr><th>Materia</th><th>Hacer</th><th>Saber</th><th>Ser</th><th>Decidir</th><th>Nota</th><th>Estado</th></tr></thead>
    <tbody>${cuerpo}</tbody></table></div>`
}

export async function montarNotas(cont, hijos) {
  if (!cont) return
  if (!hijos?.length) {
    cont.innerHTML = '<p style="color:var(--color-text-3);">Primero vinculá a tu hijo desde <b>Vincular hijo</b>.</p>'
    return
  }
  await cargarConfiguracion()
  const ctx = contexto()
  const estado = { hijo: hijos[0].id, trim: Number(ctx.trimestreActivo) || 1 }

  async function pintar() {
    cont.innerHTML = '<p style="color:var(--color-text-3);">Cargando notas…</p>'
    const { data, error } = await supabase.rpc('notas_de_mi_hijo', { p_estudiante_id: estado.hijo })
    if (error) {
      // sin_carnet / carnet_rechazado: el padre puede registrar su carnet desde aqui; carnet_pendiente: debe esperar a dirección
      const puedeRegistrar = error.hint === 'sin_carnet' || error.hint === 'carnet_rechazado'
      cont.innerHTML = `<div style="padding:12px 14px;border-radius:10px;background:#fef3c7;color:#92400e;">${esc(error.message)}
        ${puedeRegistrar ? '<div style="margin-top:10px;"><button class="btn btn-primary btn-sm" data-registrar-carnet>Registrar mi carnet</button></div>' : ''}</div>`
      cont.querySelector('[data-registrar-carnet]')?.addEventListener('click', async () => {
        try { if (await asegurarCarnet()) pintar() } catch (e) { /* el propio flujo del carnet avisa el error */ }
      })
      return
    }
    const filas = (data ?? []).map(adaptar)
    const periodos = [...new Set(filas.map(f => Number(f.trimestre)))].sort((a, b) => a - b)
    if (!periodos.includes(estado.trim) && periodos.length) estado.trim = periodos[0]
    const chipsHijos = hijos.length > 1
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${hijos.map(h =>
          `<button class="btn ${h.id === estado.hijo ? 'btn-primary' : 'btn-secondary'}" data-hijo="${esc(h.id)}">${esc(h.nombre)}</button>`).join('')}</div>`
      : ''
    const chipsTrim = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${periodos.map(p =>
      `<button class="btn ${p === estado.trim ? 'btn-primary' : 'btn-secondary'}" data-trim="${p}">Trimestre ${p}</button>`).join('')}</div>`
    cont.innerHTML = `${chipsHijos}${chipsTrim}${tabla(filas.filter(f => Number(f.trimestre) === estado.trim), ctx)}
      <p style="font-size:12px;color:var(--color-text-3);margin-top:10px;">Las notas se actualizan cuando el profesor las carga. “En curso” significa que el trimestre todavía está abierto.</p>`
    cont.querySelectorAll('[data-hijo]').forEach(b => b.addEventListener('click', () => { estado.hijo = b.dataset.hijo; pintar() }))
    cont.querySelectorAll('[data-trim]').forEach(b => b.addEventListener('click', () => { estado.trim = Number(b.dataset.trim); pintar() }))
  }
  await pintar()
}