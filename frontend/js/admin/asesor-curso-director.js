// js/admin/asesor-curso-director.js
// Sección "Asesor de curso" del director (dentro de Asignaciones).
// Un asesor por curso y un curso por asesor en la gestión; se puede cambiar o retirar
// (el historial queda guardado). Solo usa las funciones seguras de la migración 079.
import { supabase } from '../config/supabase-config.js'
import { toast, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'

const cont = () => document.getElementById('asesor-curso-container')

export async function iniciarAsesorCursoDirector() {
  const c = cont(); if (!c) return
  try {
    const [rCursos, rProfs, rAses] = await Promise.all([
      supabase.from('cursos').select('id, nombre_completo, nivel, grado, paralelo').eq('activo', true).order('nivel').order('grado').order('paralelo'),
      supabase.from('usuarios').select('id, nombre_completo').eq('rol', 'profesor').eq('activo', true).order('nombre_completo'),
      supabase.from('asesor_curso').select('id, curso_id, profesor_id, año, activo, asignado_en, desactivado_en').order('asignado_en', { ascending: false }),
    ])
    if (rAses.error) {
      c.innerHTML = '<div class="text-sm text-muted">La función de asesor de curso aún no está habilitada en la base de datos.</div>'
      return
    }
    const cursos = rCursos.data ?? [], profs = rProfs.data ?? [], hist = rAses.data ?? []
    const nombreProf = Object.fromEntries(profs.map(p => [p.id, p.nombre_completo]))
    const nombreCurso = Object.fromEntries(cursos.map(x => [x.id, x.nombre_completo]))
    const vigentes = hist.filter(a => a.activo)
    const porCurso = Object.fromEntries(vigentes.map(a => [a.curso_id, a]))
    const ocupados = new Set(vigentes.map(a => a.profesor_id))

    // Agrupado por nivel (Primaria, Secundaria...) con una fila de título
    let nivelPrevio = null
    const filas = cursos.map(cu => {
      const titulo = cu.nivel !== nivelPrevio
        ? `<tr><td colspan="4" style="background:var(--color-surface-2);font-weight:700;color:var(--color-primary);padding:8px 14px;">${escapeHtml(cu.nivel ?? 'Sin nivel')}</td></tr>`
        : ''
      nivelPrevio = cu.nivel
      const a = porCurso[cu.id]
      const opciones = profs.map(p => {
        const otro = ocupados.has(p.id) && a?.profesor_id !== p.id
        return `<option value="${p.id}" ${a?.profesor_id === p.id ? 'selected' : ''} ${otro ? 'disabled' : ''}>${escapeHtml(p.nombre_completo)}${otro ? ' (ya es asesor)' : ''}</option>`
      }).join('')
      return `${titulo}<tr>
        <td><strong>${escapeHtml(cu.nombre_completo)}</strong></td>
        <td>${a ? escapeHtml(nombreProf[a.profesor_id] ?? '—') : '<span class="text-muted">Sin asesor</span>'}</td>
        <td><select id="ases-${cu.id}" style="min-width:200px;"><option value="">Selecciona profesor</option>${opciones}</select></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary btn-sm" onclick="window._asesAsignar('${cu.id}')">${a ? 'Cambiar' : 'Asignar'}</button>
          ${a ? `<button class="btn btn-danger btn-sm" onclick="window._asesRetirar('${cu.id}')">Retirar</button>` : ''}
        </td></tr>`
    }).join('')

    const filasHist = hist.map(a => `<tr>
      <td>${escapeHtml(nombreCurso[a.curso_id] ?? '—')}</td><td>${escapeHtml(nombreProf[a.profesor_id] ?? '—')}</td>
      <td>${a['año']}</td><td>${new Date(a.asignado_en).toLocaleDateString('es-BO')}</td>
      <td>${a.activo ? '<span class="badge badge-success">Vigente</span>' : `<span class="badge badge-error">Retirado ${a.desactivado_en ? new Date(a.desactivado_en).toLocaleDateString('es-BO') : ''}</span>`}</td></tr>`).join('')

    c.innerHTML = `
      <div class="card" style="padding:0;margin-top:24px;">
        <div style="padding:14px 18px;">
          <h3 style="margin:0;">Asesor de curso</h3>
          <div class="text-sm text-muted">Un profesor por curso y un curso por profesor. El asesor ve (solo lectura) las notas finales, la asistencia y las libretas de su curso. Si se retira del colegio, asigna a otro aquí.</div>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Curso</th><th>Asesor actual</th><th>Profesor</th><th>Acciones</th></tr></thead>
          <tbody>${filas}</tbody></table></div>
        <details style="padding:12px 18px;"><summary style="cursor:pointer;font-weight:600;">Historial de asesores</summary>
          <div class="table-wrapper"><table><thead><tr><th>Curso</th><th>Profesor</th><th>Gestión</th><th>Desde</th><th>Estado</th></tr></thead>
          <tbody>${filasHist || '<tr><td colspan="5" class="text-muted">Sin registros</td></tr>'}</tbody></table></div>
        </details>
      </div>`
  } catch (err) {
    console.error(err)
    c.innerHTML = '<div class="text-sm text-muted">No se pudo cargar el asesor de curso.</div>'
  }
}

window._asesAsignar = async function (cursoId) {
  const profId = document.getElementById(`ases-${cursoId}`)?.value
  if (!profId) { toast('Selecciona un profesor', 'warning'); return }
  const { error } = await supabase.rpc('asignar_asesor_curso', { p_curso_id: cursoId, p_profesor_id: profId })
  if (error) { toast(error.message, 'error'); return }
  toast('Asesor asignado', 'success')
  iniciarAsesorCursoDirector()
}

window._asesRetirar = async function (cursoId) {
  if (!await confirmar('Retirar asesor', '¿Retirar al asesor de este curso? Dejará de ver sus datos; el historial se conserva.')) return
  const { error } = await supabase.rpc('retirar_asesor_curso', { p_curso_id: cursoId })
  if (error) { toast(error.message, 'error'); return }
  toast('Asesor retirado', 'success')
  iniciarAsesorCursoDirector()
}