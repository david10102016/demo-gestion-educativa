// js/profesor/bitacora.js
// Bitácora docente diaria: registro del día (con precarga si ya existe)
// + historial propio con filtro de fechas + exportar a Excel.
// Exporta: iniciarBitacora()
// Depende de: supabase-config.js, config-app.js, ui.js (ya existentes)
// ─────────────────────────────────────────────────────────
import { supabase } from '../config/supabase-config.js'
import { Config }   from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, fechaLocal } from '../utils/ui.js'
import { fetchConCache } from '../utils/data-layer.js'

// ─── ESCAPE HTML (misma función usada en director.js y profesor.js) ──
function escapeHTML(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const TIPOS_ACTIVIDAD = [
  'Clase magistral', 'Práctica / ejercicios', 'Evaluación', 'Trabajo grupal',
  'Laboratorio / taller', 'Refuerzo', 'Otro'
]

let _perfil = null
let _asignaciones = []
let _historial = []

// ─── PUNTO DE ENTRADA ────────────────────────────────────
export async function iniciarBitacora(perfil) {
  _perfil = perfil
  await _cargarAsignaciones()
  _renderFormulario()
  await _cargarHistorial()
}

async function _cargarAsignaciones() {
  const r = await fetchConCache({
    key: 'asignaciones-profesor-bitacora',
    colegioId: _perfil?.colegio_id, usuarioId: _perfil?.id,
    run: () => supabase.from('asignaciones_profesor')
      .select('curso_id, materia_id, curso:cursos(nombre_completo), materia:materias(nombre)')
      .eq('profesor_id', _perfil.id).eq('activo', true)
  })
  _asignaciones = r.data ?? []
}

// ─── FORMULARIO DEL DÍA ──────────────────────────────────
function _renderFormulario() {
  const panel = document.getElementById('panel-bitacora')
  if (!panel) return

  const cursos = [...new Map(_asignaciones.map(a => [a.curso_id, a.curso])).entries()]
    .sort((a, b) => (a[1]?.nombre_completo ?? '').localeCompare(b[1]?.nombre_completo ?? '', 'es', { numeric: true }))

  panel.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-top:0;">Registro de hoy</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;">
        <div>
          <label>Fecha</label>
          <input type="date" id="bit-fecha" value="${fechaLocal()}" max="${fechaLocal()}" style="width:160px;">
        </div>
        <div>
          <label>Curso</label>
          <select id="bit-curso" style="min-width:180px;">
            <option value="">— Curso —</option>
            ${cursos.map(([id, c]) => `<option value="${escapeHTML(id)}">${escapeHTML(c?.nombre_completo)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Materia</label>
          <select id="bit-materia" style="min-width:200px;"><option value="">— Materia —</option></select>
        </div>
      </div>
      <div id="bit-form-campos" style="display:none;">
        <div style="margin-bottom:12px;">
          <label>Tema dictado</label>
          <input type="text" id="bit-tema" placeholder="¿Qué se enseñó hoy?" style="width:100%;">
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div>
            <label>Tipo de actividad</label>
            <select id="bit-tipo">
              ${TIPOS_ACTIVIDAD.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('')}
            </select>
          </div>
          <div id="bit-tipo-otro-wrap" style="display:none;">
            <label>Especifica</label>
            <input type="text" id="bit-tipo-otro" placeholder="Especifica el tipo de actividad">
          </div>
          <div>
            <label>Estado</label>
            <select id="bit-estado">
              <option value="culminado">Terminado</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:12px;">
          <label>Detalle (opcional)</label>
          <textarea id="bit-detalle" rows="2" style="width:100%;" placeholder="Observaciones adicionales..."></textarea>
        </div>
        <div id="bit-observacion-director" style="display:none;margin-bottom:12px;padding:10px 14px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
          <strong style="font-size:12px;color:#1e40af;">Comentario del director:</strong>
          <div id="bit-observacion-director-texto" style="font-size:13px;margin-top:4px;"></div>
        </div>
        <button class="btn btn-primary" id="bit-btn-guardar" onclick="window._bitacoraGuardar()">💾 Guardar registro</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Mi historial</h3>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;">
        <div><label>Desde</label><input type="date" id="bit-hist-desde"></div>
        <div><label>Hasta</label><input type="date" id="bit-hist-hasta" value="${fechaLocal()}"></div>
        <button class="btn" onclick="window._bitacoraFiltrarHistorial()">Filtrar</button>
        <button class="btn btn-amarillo" onclick="window._bitacoraExportar()">📊 Exportar Excel</button>
      </div>
      <div id="bit-historial-tabla"></div>
    </div>
  `

  document.getElementById('bit-curso').onchange = _actualizarMateriasForm
  document.getElementById('bit-materia').onchange = _cargarRegistroDelDia
  document.getElementById('bit-fecha').onchange = _cargarRegistroDelDia
  document.getElementById('bit-tipo').onchange = (e) => {
    document.getElementById('bit-tipo-otro-wrap').style.display = e.target.value === 'Otro' ? 'block' : 'none'
  }

  if (cursos.length === 1) {
    document.getElementById('bit-curso').value = cursos[0][0]
    _actualizarMateriasForm()
  }

  window._bitacoraGuardar = _guardarRegistro
  window._bitacoraFiltrarHistorial = () => _cargarHistorial()
  window._bitacoraExportar = _exportarExcel
}

function _actualizarMateriasForm() {
  const cursoId = document.getElementById('bit-curso').value
  const selMat = document.getElementById('bit-materia')
  const materias = _asignaciones.filter(a => a.curso_id === cursoId)
  selMat.innerHTML = '<option value="">— Materia —</option>'
    + materias.map(a => `<option value="${escapeHTML(a.materia_id)}">${escapeHTML(a.materia?.nombre)}</option>`).join('')
  document.getElementById('bit-form-campos').style.display = 'none'
  if (materias.length === 1) {
    selMat.value = materias[0].materia_id
    _cargarRegistroDelDia()
  }
}

// ─── PRECARGA si ya existe registro de hoy (mismo patrón que
//     guardarNotaIndividual: upsert con precarga, no vacío) ───
async function _cargarRegistroDelDia() {
  const cursoId = document.getElementById('bit-curso')?.value
  const materiaId = document.getElementById('bit-materia')?.value
  const fecha = document.getElementById('bit-fecha')?.value
  if (!cursoId || !materiaId || !fecha) {
    document.getElementById('bit-form-campos').style.display = 'none'
    return
  }
  document.getElementById('bit-form-campos').style.display = 'block'

  const { data } = await supabase.from('bitacora_docente')
    .select('*')
    .eq('profesor_id', _perfil.id).eq('curso_id', cursoId)
    .eq('materia_id', materiaId).eq('fecha', fecha)
    .maybeSingle()

  const tipoConocido = TIPOS_ACTIVIDAD.includes(data?.tipo_actividad)
  document.getElementById('bit-tema').value = data?.tema ?? ''
  document.getElementById('bit-tipo').value = tipoConocido ? data.tipo_actividad : (data ? 'Otro' : TIPOS_ACTIVIDAD[0])
  document.getElementById('bit-tipo-otro-wrap').style.display = (!tipoConocido && data) ? 'block' : 'none'
  document.getElementById('bit-tipo-otro').value = (!tipoConocido && data) ? data.tipo_actividad : ''
  document.getElementById('bit-estado').value = data?.estado ?? 'culminado'
  document.getElementById('bit-detalle').value = data?.detalle ?? ''

  const obsWrap = document.getElementById('bit-observacion-director')
  if (data?.observacion_director) {
    obsWrap.style.display = 'block'
    document.getElementById('bit-observacion-director-texto').textContent = data.observacion_director
  } else {
    obsWrap.style.display = 'none'
  }
}

async function _guardarRegistro() {
  const cursoId = document.getElementById('bit-curso').value
  const materiaId = document.getElementById('bit-materia').value
  const fecha = document.getElementById('bit-fecha').value
  const tema = document.getElementById('bit-tema').value.trim()
  const tipoSel = document.getElementById('bit-tipo').value
  const tipoOtro = document.getElementById('bit-tipo-otro').value.trim()
  const estado = document.getElementById('bit-estado').value
  const detalle = document.getElementById('bit-detalle').value.trim() || null

  if (!cursoId || !materiaId || !fecha) { toast('Selecciona curso, materia y fecha', 'warning'); return }
  if (!tema) { toast('Escribe el tema dictado', 'warning'); return }
  const tipoActividad = tipoSel === 'Otro' ? (tipoOtro || 'Otro') : tipoSel

  mostrarLoader('Guardando...')
  const { error } = await supabase.from('bitacora_docente').upsert({
    colegio_id: _perfil.colegio_id,
    profesor_id: _perfil.id,
    curso_id: cursoId,
    materia_id: materiaId,
    fecha, tema, tipo_actividad: tipoActividad, estado, detalle
  }, { onConflict: 'profesor_id,curso_id,materia_id,fecha' })
  ocultarLoader()

  if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
  toast('Registro guardado', 'success')
  await _cargarHistorial()
}

// ─── HISTORIAL PROPIO ────────────────────────────────────
async function _cargarHistorial() {
  const desde = document.getElementById('bit-hist-desde')?.value || null
  const hasta = document.getElementById('bit-hist-hasta')?.value || fechaLocal()

  let q = supabase.from('bitacora_docente')
    .select('fecha, tema, tipo_actividad, estado, detalle, observacion_director, curso:cursos(nombre_completo), materia:materias(nombre)')
    .eq('profesor_id', _perfil.id)
    .order('fecha', { ascending: false })
  if (desde) q = q.gte('fecha', desde)
  if (hasta) q = q.lte('fecha', hasta)

  const { data, error } = await q
  if (error) { console.error(error); return }
  _historial = data ?? []
  _renderHistorial()
}

function _renderHistorial() {
  const cont = document.getElementById('bit-historial-tabla')
  if (!cont) return
  if (!_historial.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📔</div><div class="empty-state-title">Sin registros en este rango de fechas</div></div>`
    return
  }
  cont.innerHTML = `
    <div class="table-wrapper"><table style="width:100%;">
      <thead><tr>
        <th>Fecha</th><th>Curso</th><th>Materia</th><th>Tema</th><th>Tipo</th><th>Estado</th><th>Comentario director</th>
      </tr></thead>
      <tbody>
        ${_historial.map(h => `
          <tr>
            <td>${escapeHTML(h.fecha)}</td>
            <td>${escapeHTML(h.curso?.nombre_completo)}</td>
            <td>${escapeHTML(h.materia?.nombre)}</td>
            <td>${escapeHTML(h.tema)}</td>
            <td>${escapeHTML(h.tipo_actividad)}</td>
            <td>${h.estado === 'culminado' ? '✅ Terminado' : '⏳ Pendiente'}</td>
            <td>${escapeHTML(h.observacion_director) || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>
  `
}

async function _exportarExcel() {
  if (typeof ExcelJS === 'undefined') { toast('No se pudo cargar el generador de Excel', 'error'); return }
  if (!_historial.length) { toast('No hay registros para exportar', 'warning'); return }

  const header = ['Fecha', 'Curso', 'Materia', 'Tema', 'Tipo de actividad', 'Estado', 'Detalle', 'Comentario del director']

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Bitácora')
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  sheet.columns = header.map(() => ({ width: 20 }))

  const rowTitulo = sheet.addRow([`Bitácora docente — Gestión ${Config.año}`])
  sheet.mergeCells(1, 1, 1, header.length)
  rowTitulo.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  rowTitulo.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  rowTitulo.getCell(1).alignment = { horizontal: 'center' }

  const rowProf = sheet.addRow([`Profesor: ${_perfil?.nombre_completo ?? ''}`])
  sheet.mergeCells(rowProf.number, 1, rowProf.number, header.length)
  rowProf.getCell(1).font = { name: 'Arial', size: 10, italic: true }

  sheet.addRow([])

  const rowHeader = sheet.addRow(header)
  rowHeader.eachCell(cell => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } }
  })

  _historial.forEach((h, index) => {
    const row = sheet.addRow([
      h.fecha, h.curso?.nombre_completo ?? '', h.materia?.nombre ?? '', h.tema,
      h.tipo_actividad, h.estado === 'culminado' ? 'Terminado' : 'Pendiente',
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
  a.href = url; a.download = `mi_bitacora_${Config.año}.xlsx`; a.click()
  URL.revokeObjectURL(url)
  
}
