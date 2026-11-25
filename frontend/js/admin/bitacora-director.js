// js/admin/bitacora-director.js
// Vista del director sobre la bitácora docente: quién registró hoy
// (comparado contra asignaciones_profesor), historial de todo el
// colegio con filtros, comentario por registro, exportar a Excel.
// Exporta: initBitacoraDirector()
// No requiere perfil como parámetro: RLS (colegio_id = mi_colegio_id())
// ya scoping todo, mismo patrón que carreras-tecnicas.js / reportes-director.js.
// ─────────────────────────────────────────────────────────
import { supabase } from '../config/supabase-config.js'
import { Config }   from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, fechaLocal } from '../utils/ui.js'

function escapeHTML(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

let _bdInitDone = false
let _historialColegio = []

export function initBitacoraDirector() {
  if (_bdInitDone) return
  _bdInitDone = true
  _renderShell()
  _cargarHoy()
  _cargarHistorial()
}

function _renderShell() {
  const panel = document.getElementById('panel-bitacora-director')
  if (!panel) return
  panel.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h3 style="margin-top:0;">Hoy — ${fechaLocal()}</h3>
        <button class="btn btn-sm" onclick="window._bdToggleHoy()" id="bd-toggle-hoy-btn">Ver detalle por profesor ▾</button>
      </div>
      <div id="bd-resumen-hoy" style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;"></div>
      <div id="bd-hoy-tabla" style="display:none;"></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Historial del colegio</h3>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;">
        <div><label>Desde</label><input type="date" id="bd-hist-desde" value="${fechaLocal()}"></div>
        <div><label>Hasta</label><input type="date" id="bd-hist-hasta" value="${fechaLocal()}"></div>
        <button class="btn" onclick="window._bdFiltrarHistorial()">Filtrar</button>
        <button class="btn btn-amarillo" onclick="window._bdExportar()">📊 Exportar Excel</button>
      </div>
      <div id="bd-historial-tabla"></div>
    </div>
  `
  window._bdFiltrarHistorial = () => _cargarHistorial()
  window._bdExportar = _exportarExcel
  window._bdGuardarObservacion = _guardarObservacion
  window._bdToggleHoy = () => {
    const tabla = document.getElementById('bd-hoy-tabla')
    const btn = document.getElementById('bd-toggle-hoy-btn')
    const abierto = tabla.style.display !== 'none'
    tabla.style.display = abierto ? 'none' : 'block'
    btn.textContent = abierto ? 'Ver detalle por profesor ▾' : 'Ocultar detalle ▴'
  }
}

// ─── HOY: quién registró vs. quién tenía que registrar ───
async function _cargarHoy() {
  const hoy = fechaLocal()

  const [{ data: asignaciones, error: e1 }, { data: registros, error: e2 }] = await Promise.all([
    supabase.from('asignaciones_profesor')
      .select('profesor_id, curso_id, materia_id, profesor:usuarios(nombre_completo), curso:cursos(nombre_completo), materia:materias(nombre)')
      .eq('activo', true),
    supabase.from('bitacora_docente')
      .select('profesor_id, curso_id, materia_id, tema, estado')
      .eq('fecha', hoy)
  ])
  if (e1 || e2) { console.error(e1 || e2); toast('No se pudo cargar la bitácora de hoy', 'error'); return }

  const registradosSet = new Set((registros ?? []).map(r => `${r.profesor_id}_${r.curso_id}_${r.materia_id}`))
  const faltantes = (asignaciones ?? []).filter(a => !registradosSet.has(`${a.profesor_id}_${a.curso_id}_${a.materia_id}`))

  document.getElementById('bd-resumen-hoy').innerHTML = `
    <div style="background:#d1fae5;color:#065f46;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;">✓ ${registros?.length ?? 0} registrados</div>
    <div style="background:#e5e7eb;color:#374151;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;">○ ${faltantes.length} asignaciones sin bitácora hoy</div>
  `

  const porProfesor = {}
  faltantes.forEach(f => {
    const id = f.profesor_id
    if (!porProfesor[id]) porProfesor[id] = { nombre: f.profesor?.nombre_completo, items: [] }
    porProfesor[id].items.push(`${f.curso?.nombre_completo} — ${f.materia?.nombre}`)
  })
  const totalPorProfesor = {}
  ;(asignaciones ?? []).forEach(a => {
    totalPorProfesor[a.profesor_id] = (totalPorProfesor[a.profesor_id] ?? 0) + 1
  })
  const registradosPorProfesor = {}
  ;(registros ?? []).forEach(r => {
    registradosPorProfesor[r.profesor_id] = (registradosPorProfesor[r.profesor_id] ?? 0) + 1
  })
  const agrupados = Object.entries(porProfesor).map(([id, p]) => ({
    ...p,
    total: totalPorProfesor[id] ?? p.items.length,
    hechas: registradosPorProfesor[id] ?? 0
  }))

  document.getElementById('bd-hoy-tabla').innerHTML = !agrupados.length
    ? `<p style="color:#6b7280;">Todos los profesores con clase hoy ya registraron su bitácora.</p>`
    : `
      <p style="color:#6b7280;font-size:12px;margin-bottom:10px;">Este es el número total de asignaciones activas del profesor.</p>
      <div class="table-wrapper"><table style="width:100%;">
        <thead><tr><th>Profesor</th><th>Pendientes</th></tr></thead>
        <tbody>
          ${agrupados.map(p => `
            <tr>
              <td>${escapeHTML(p.nombre)}<br><span style="font-size:11px;color:#6b7280;">${p.hechas} de ${p.total} registradas hoy</span></td>
              <td>${p.items.map(i => escapeHTML(i)).join(', ')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    `
}
// ─── HISTORIAL DEL COLEGIO ────────────────────────────────
async function _cargarHistorial() {
  const desde = document.getElementById('bd-hist-desde')?.value || null
  const hasta = document.getElementById('bd-hist-hasta')?.value || fechaLocal()

  let q = supabase.from('bitacora_docente')
    .select('id, fecha, created_at, tema, tipo_actividad, estado, detalle, observacion_director, profesor:usuarios(nombre_completo), curso:cursos(nombre_completo), materia:materias(nombre)')
    .order('fecha', { ascending: false })
  if (desde) q = q.gte('fecha', desde)
  if (hasta) q = q.lte('fecha', hasta)

  const { data, error } = await q
  if (error) { console.error(error); return }
  _historialColegio = data ?? []
  _renderHistorial()
}

function _chipTardio(h) {
  const fechaCarga = fechaLocal(new Date(h.created_at))
  if (fechaCarga === h.fecha) return ''
  return `<div style="margin-top:3px;"><span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:2px 7px;border-radius:20px;">⚠ Cargado el ${fechaCarga}</span></div>`
}

function _renderHistorial() {
  const cont = document.getElementById('bd-historial-tabla')
  if (!cont) return
  if (!_historialColegio.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📔</div><div class="empty-state-title">Sin registros en este rango de fechas</div></div>`
    return
  }
  cont.innerHTML = `
    <table class="tabla-simple" style="width:100%;">
      <thead><tr>
        <th>Fecha</th><th>Profesor</th><th>Curso</th><th>Materia</th><th>Tema</th><th>Estado</th><th>Comentario</th>
      </tr></thead>
      <tbody>
        ${_historialColegio.map(h => `
          <tr>
            <td>${escapeHTML(h.fecha)}${_chipTardio(h)}</td>
            <td>${escapeHTML(h.profesor?.nombre_completo)}</td>
            <td>${escapeHTML(h.curso?.nombre_completo)}</td>
            <td>${escapeHTML(h.materia?.nombre)}</td>
            <td>${escapeHTML(h.tema)}</td>
            <td>${h.estado === 'culminado' ? '✅ Terminado' : '⏳ Pendiente'}</td>
            <td>
              <div style="display:flex;gap:6px;">
                <input type="text" value="${escapeHTML(h.observacion_director)}" data-obs="${escapeHTML(h.id)}" placeholder="Agregar comentario..." autocomplete="off" name="bitacora-obs-${escapeHTML(h.id)}" style="min-width:160px;">
                <button class="btn btn-sm" onclick="window._bdGuardarObservacion('${escapeHTML(h.id)}')">Guardar</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

async function _guardarObservacion(id) {
  const input = document.querySelector(`input[data-obs="${id}"]`)
  if (!input) return
  const { error } = await supabase.from('bitacora_docente')
    .update({ observacion_director: input.value.trim() || null })
    .eq('id', id)
  if (error) { toast('No se pudo guardar el comentario: ' + error.message, 'error'); return }
  toast('Comentario guardado', 'success')
}

async function _exportarExcel() {
  if (typeof ExcelJS === 'undefined') { toast('No se pudo cargar el generador de Excel', 'error'); return }
  if (!_historialColegio.length) { toast('No hay registros para exportar', 'warning'); return }

  const header = ['Fecha', 'Profesor', 'Curso', 'Materia', 'Tema', 'Tipo de actividad', 'Estado', 'Detalle', 'Comentario del director']

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Bitácora')
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  sheet.columns = header.map(() => ({ width: 20 }))

  const rowTitulo = sheet.addRow([`Bitácora docente — Gestión ${Config.año}`])
  sheet.mergeCells(1, 1, 1, header.length)
  rowTitulo.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  rowTitulo.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  rowTitulo.getCell(1).alignment = { horizontal: 'center' }

  sheet.addRow([])

  const rowHeader = sheet.addRow(header)
  rowHeader.eachCell(cell => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } }
  })

  _historialColegio.forEach((h, index) => {
    const row = sheet.addRow([
      h.fecha, h.profesor?.nombre_completo ?? '', h.curso?.nombre_completo ?? '', h.materia?.nombre ?? '',
      h.tema, h.tipo_actividad, h.estado === 'culminado' ? 'Terminado' : 'Pendiente',
      h.detalle ?? '', h.observacion_director ?? ''
    ])
    row.eachCell(cell => {
      cell.font = { name: 'Arial', size: 9 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF9F9F9' } }
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `bitacora_colegio_${Config.año}.xlsx`; a.click()
  URL.revokeObjectURL(url)
}
