// js/pagos/reportes-pagos.js
// Reportes de pagos para el panel del director.
// Se integra en dashboard-director.html como una sección nueva.
// Sigue el mismo patrón que reportes-director.js
import { supabase }          from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import {
  cargarConfigPagos,
  ConfigPagos,
  MESES_LABELS,
  ESTADOS_PAGO,
  formatBs,
  obtenerColegioId
} from '../config/config-pagos.js'
import {
  resumenGeneralPagos,
  obtenerMorosos,
  obtenerBecas,
  asignarBeca,
  revocarBeca,
  pagosPorCurso
} from './pagos.js'

// ── Estado del módulo ──
let colegioId  = null
let añoActual  = new Date().getFullYear()
let cursos     = []
let morososData = []

// -------------------------------------------------------
// INIT — llamar desde director.js al navegar a la sección
// -------------------------------------------------------
export async function initReportesPagos() {
  if (!colegioId) colegioId = await obtenerColegioId()
  await cargarConfigPagos(añoActual)
  await cargarCursos()
  await renderResumenGeneral()
  await renderMorosos()
  await renderBecas()
  renderSelectorCursos()
  await renderConfigMensualidad()
}

// ── Cargar cursos del colegio ──
async function cargarCursos() {
  const { data } = await supabase
    .from('cursos')
    .select('id, nombre_completo, nivel, grado, paralelo')
    .eq('colegio_id', colegioId)
    .eq('activo', true)
    .order('nivel').order('grado').order('paralelo')

  cursos = data ?? []
}

// -------------------------------------------------------
// RESUMEN GENERAL — meta vs cobrado
// -------------------------------------------------------
async function renderResumenGeneral() {
  const resumen = await resumenGeneralPagos(añoActual, colegioId)

  // Calcular meta total del año
  const { data: estudiantes } = await supabase
    .from('estudiantes')
    .select('id, cursos!inner(nivel)')
    .eq('colegio_id', colegioId)

  let metaTotal = 0
  for (const est of (estudiantes ?? [])) {
    const nivel = est.cursos?.nivel
    metaTotal += ConfigPagos.totalAnual(nivel)
  }

  const porcentaje = metaTotal > 0
    ? Math.round((resumen.totalCobrado / metaTotal) * 100)
    : 0

  const el = document.getElementById('pagos-resumen-general')
  if (!el) return

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
      <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;padding:20px;">
        <div style="font-size:0.75rem;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Meta anual ${añoActual}</div>
        <div style="font-size:1.6rem;font-weight:700;color:var(--color-text-primary);">${formatBs(metaTotal)}</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px;">
        <div style="font-size:0.75rem;color:#166534;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Cobrado a la fecha</div>
        <div style="font-size:1.6rem;font-weight:700;color:#16a34a;">${formatBs(resumen.totalCobrado)}</div>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:20px;">
        <div style="font-size:0.75rem;color:#991b1b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Pendiente por cobrar</div>
        <div style="font-size:1.6rem;font-weight:700;color:#ef4444;">${formatBs(metaTotal - resumen.totalCobrado)}</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:20px;">
        <div style="font-size:0.75rem;color:#1e40af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Pagos pendientes revisión</div>
        <div style="font-size:1.6rem;font-weight:700;color:#2563eb;">${resumen.cantPendientes}</div>
      </div>
    </div>
    <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-size:0.875rem;font-weight:600;color:var(--color-text-primary);">Progreso de cobro ${añoActual}</span>
        <span style="font-size:1.1rem;font-weight:700;color:${porcentaje >= 80 ? '#16a34a' : porcentaje >= 50 ? '#f59e0b' : '#ef4444'};">${porcentaje}%</span>
      </div>
      <div style="background:var(--color-border);border-radius:99px;height:12px;overflow:hidden;">
        <div style="height:100%;width:${porcentaje}%;background:${porcentaje >= 80 ? '#16a34a' : porcentaje >= 50 ? '#f59e0b' : '#ef4444'};border-radius:99px;transition:width 0.8s ease;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:0.75rem;color:var(--color-text-secondary);">
        <span>0 Bs</span>
        <span>${formatBs(metaTotal)}</span>
      </div>
    </div>
  `
}

// -------------------------------------------------------
// REPORTE POR CURSO
// -------------------------------------------------------
export async function renderReporteCurso() {
  const cursoId = document.getElementById('pagos-filtro-curso')?.value
  const mes     = parseInt(document.getElementById('pagos-filtro-mes')?.value ?? '0')

  if (!cursoId) { toast('Selecciona un curso', 'warning'); return }

  mostrarLoader('Cargando reporte...')
  try {
    const { data: estudiantes } = await supabase
      .from('estudiantes')
      .select(`
        id, carnet,
        usuarios!inner(nombre_completo),
        cursos!inner(nombre_completo, nivel),
        pagos_mensualidad(mes, estado, monto_bs, año)
      `)
      .eq('curso_id', cursoId)

    const mesesFiltro = mes ? [mes] : null
    const el = document.getElementById('pagos-tabla-curso')
    if (!el) return

    if (!estudiantes?.length) {
      el.innerHTML = `<p style="color:var(--color-text-secondary);">No hay estudiantes en este curso.</p>`
      return
    }

    const nivel        = estudiantes[0].cursos?.nivel
    const mesesActivos = mesesFiltro ?? ConfigPagos.mesesActivos(nivel)

    // Cabecera
    const headers = mesesActivos.map(m =>
      `<th style="text-align:center;">${MESES_LABELS[m]?.substring(0,3)}</th>`
    ).join('') + '<th>Estado</th>'

    const filas = estudiantes.map(est => {
      const pagosAño = (est.pagos_mensualidad ?? []).filter(p => p.año === añoActual)

      const celdas = mesesActivos.map(mes => {
        // Un mes puede tener un pago rechazado y otro nuevo (119): manda el vigente
        const delMes = pagosAño.filter(p => p.mes === mes)
        const pago = delMes.find(p => p.estado === 'aprobado')
                  ?? delMes.find(p => p.estado === 'pendiente' || p.estado === 'en_revision')
                  ?? delMes[0]
        if (!pago) return `<td style="text-align:center;color:var(--color-text-secondary);">—</td>`
        const color = pago.estado === 'aprobado' ? '#10b981'
                    : pago.estado === 'rechazado' ? '#ef4444' : '#f59e0b'
        const icon  = pago.estado === 'aprobado' ? '✓'
                    : pago.estado === 'rechazado' ? '✕' : '●'
        return `<td style="text-align:center;color:${color};font-weight:700;" title="${ESTADOS_PAGO[pago.estado]?.label}">${icon}</td>`
      }).join('')

      const aprobados   = pagosAño.filter(p => p.estado === 'aprobado' && mesesActivos.includes(p.mes)).length
      const totalMeses  = mesesActivos.length
      const alDia       = aprobados === totalMeses
      const estadoBadge = alDia
        ? `<span style="color:#10b981;font-weight:600;">Al día ✓</span>`
        : `<span style="color:#ef4444;font-weight:600;">Debe ${totalMeses - aprobados}</span>`

      return `
        <tr>
          <td>${escapeHtml(est.usuarios.nombre_completo)}</td>
          <td style="color:var(--color-text-secondary);font-size:0.8rem;">${est.carnet}</td>
          ${celdas}
          <td>${estadoBadge}</td>
        </tr>`
    }).join('')

    el.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Estudiante</th>
              <th>Carnet</th>
              ${headers}
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;">
        <button class="btn btn-sm btn-amarillo" onclick="window.exportarPagosCursoExcel()">
          Exportar Excel
        </button>
      </div>
    `
  } catch(e) {
    toast('Error cargando el reporte', 'error')
    console.error(e)
  } finally {
    ocultarLoader()
  }
}

// ── Exportar reporte de curso a Excel ──
window.exportarPagosCursoExcel = function() {
  const tabla = document.querySelector('#pagos-tabla-curso table')
  if (!tabla) { toast('No hay datos para exportar', 'warning'); return }

  const wb  = XLSX.utils.book_new()
  const ws  = XLSX.utils.table_to_sheet(tabla)
  XLSX.utils.book_append_sheet(wb, ws, 'Pagos')
  XLSX.writeFile(wb, `pagos_curso_${añoActual}.xlsx`)
}

// -------------------------------------------------------
// MOROSOS
// -------------------------------------------------------
async function renderMorosos() {
  const el = document.getElementById('pagos-morosos')
  if (!el) return

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <select id="morosos-filtro-curso" style="padding:8px 12px;border-radius:10px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text-primary);font-size:0.875rem;">
        <option value="">Todos los cursos</option>
        ${cursos.map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="window.filtrarMorosos()">Ver morosos</button>
    </div>
    <div id="morosos-resultado"></div>
  `
}

window.filtrarMorosos = async function() {
  const cursoId = document.getElementById('morosos-filtro-curso').value
  const el = document.getElementById('morosos-resultado')
  if (!el) return

  mostrarLoader('Cargando morosos...')
  try {
    let datos = await obtenerMorosos(añoActual, colegioId)

    if (cursoId) {
      const curso = cursos.find(c => c.id === cursoId)
      datos = datos.filter(m => m.curso === curso?.nombre_completo)
    }

    morososData = datos

    if (!datos.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--color-text-secondary);">
          <div style="font-size:2rem;margin-bottom:8px;">🎉</div>
          <p>Todos los estudiantes están al día</p>
        </div>`
      return
    }

    el.innerHTML = `
      <p style="font-size:0.8rem;color:var(--color-text-secondary);margin-bottom:12px;">
        ${datos.length} estudiante${datos.length !== 1 ? 's' : ''} con pagos pendientes
      </p>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Estudiante</th>
              <th>Curso</th>
              <th>Meses adeudados</th>
              <th style="text-align:right;">Deuda total</th>
            </tr>
          </thead>
          <tbody>
            ${datos.map(m => `
              <tr>
                <td><strong>${escapeHtml(m.nombre)}</strong><br><small style="color:var(--color-text-secondary);">${m.carnet}</small></td>
                <td>${escapeHtml(m.curso)}</td>
                <td>${m.mesesDeuda.map(mes => MESES_LABELS[mes]?.substring(0,3)).join(', ')}</td>
                <td style="text-align:right;font-weight:700;color:#ef4444;">${formatBs(m.deudaTotal)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:12px;">
        <button class="btn btn-sm btn-amarillo" onclick="window.exportarMorososExcel()">Exportar Excel</button>
      </div>`
  } catch(e) {
    toast('Error cargando morosos', 'error')
    console.error(e)
  } finally {
    ocultarLoader()
  }
}

window.exportarMorososExcel = function() {
  if (!morososData.length) return
  const rows = morososData.map(m => ({
    Estudiante:  m.nombre,
    Carnet:      m.carnet,
    Curso:       m.curso,
    'Meses que debe': m.mesesDeuda.map(mes => MESES_LABELS[mes]).join(', '),
    'Deuda Bs':  m.deudaTotal
  }))
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Morosos')
  XLSX.writeFile(wb, `morosos_${añoActual}.xlsx`)
}

// -------------------------------------------------------
// BECAS
// -------------------------------------------------------
async function renderBecas() {
  const becas = await obtenerBecas(añoActual, colegioId)
  const el    = document.getElementById('pagos-becas-lista')
  if (!el) return

  if (!becas.length) {
    el.innerHTML = `<p style="color:var(--color-text-secondary);font-size:0.875rem;">No hay becas asignadas para ${añoActual}.</p>`
    return
  }

  el.innerHTML = becas.map(b => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;margin-bottom:8px;">
      <div style="flex:1;">
        <div style="font-weight:600;font-size:0.875rem;">${escapeHtml(b.estudiantes.usuarios.nombre_completo)}</div>
        <div style="font-size:0.78rem;color:var(--color-text-secondary);">
          ${escapeHtml(b.estudiantes.cursos?.nombre_completo ?? '—')} ·
          Beca ${b.porcentaje}%
          ${b.motivo ? `· ${escapeHtml(b.motivo)}` : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="window.revocarBecaDir('${b.estudiantes.id}')">
        Revocar
      </button>
    </div>
  `).join('')
}

// ── Asignar beca desde el director ──
window.abrirAsignarBeca = function() {
  document.getElementById('modal-asignar-beca')?.classList.remove('hidden')
  cargarEstudiantesParaBeca()
}

async function cargarEstudiantesParaBeca() {
  const { data: cursos } = await supabase
    .from('cursos')
    .select('id, nombre_completo')
    .eq('colegio_id', colegioId)
    .eq('activo', true)
    .order('nivel').order('grado').order('paralelo')

  const sel = document.getElementById('beca-curso-sel')
  if (!sel) return
  sel.innerHTML = '<option value="">Seleccionar curso...</option>'
  ;(cursos ?? []).forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.nombre_completo
    sel.appendChild(opt)
  })

  document.getElementById('beca-estudiante-sel').innerHTML =
    '<option value="">Selecciona un curso primero...</option>'
}

window.filtrarEstudiantesBeca = async function() {
  const cursoId = document.getElementById('beca-curso-sel').value
  const sel = document.getElementById('beca-estudiante-sel')
  if (!cursoId) {
    sel.innerHTML = '<option value="">Selecciona un curso primero...</option>'
    return
  }

  const { data } = await supabase
    .from('estudiantes')
    .select('id, usuarios!inner(nombre_completo)')
    .eq('curso_id', cursoId)
    .order('usuarios(nombre_completo)')

  sel.innerHTML = '<option value="">Seleccionar estudiante...</option>'
  ;(data ?? []).forEach(est => {
    const opt = document.createElement('option')
    opt.value = est.id
    opt.textContent = est.usuarios.nombre_completo
    sel.appendChild(opt)
  })
}

window.guardarBeca = async function() {
  const estudianteId = document.getElementById('beca-estudiante-sel')?.value
  const porcentaje   = parseFloat(document.getElementById('beca-porcentaje')?.value ?? '100')
  const motivo       = document.getElementById('beca-motivo')?.value?.trim()

  if (!estudianteId) { toast('Selecciona un estudiante', 'warning'); return }
  if (isNaN(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
    toast('El porcentaje debe estar entre 1 y 100', 'warning'); return
  }

  mostrarLoader('Asignando beca...')
  try {
    await asignarBeca(estudianteId, añoActual, porcentaje, motivo)
    toast('Beca asignada correctamente', 'success')
    document.getElementById('modal-asignar-beca')?.classList.add('hidden')
    await renderBecas()
  } catch(e) {
    toast(e.message ?? 'Error al asignar beca', 'error')
  } finally {
    ocultarLoader()
  }
}

window.revocarBecaDir = async function(estudianteId) {
  const ok = await window.confirmar?.('Revocar beca', '¿Deseas revocar la beca de este estudiante?', 'Revocar', 'Cancelar')
  if (!ok) return

  mostrarLoader('Revocando beca...')
  try {
    await revocarBeca(estudianteId, añoActual)
    toast('Beca revocada', 'success')
    await renderBecas()
  } catch(e) {
    toast(e.message ?? 'Error al revocar la beca', 'error')
  } finally {
    ocultarLoader()
  }
}

// -------------------------------------------------------
// CONFIG MENSUALIDAD — el director configura montos
// -------------------------------------------------------
export async function renderConfigMensualidad() {
  const { data: config } = await supabase
    .from('config_mensualidad')
    .select('*')
    .eq('año', añoActual)
    .order('nivel').order('mes')

  const el = document.getElementById('pagos-config-mensualidad')
  if (!el) return

  const niveles = ['Primaria', 'Secundaria', 'Inicial']
  const mesesDefault = [2,3,4,5,6,7,8,9,10,11]

  el.innerHTML = niveles.map(nivel => {
    const filas = mesesDefault.map(mes => {
      const reg   = config?.find(c => c.nivel === nivel && c.mes === mes)
      const monto = reg?.monto_bs ?? ''
      return `
        <tr>
          <td>${MESES_LABELS[mes]}</td>
          <td>
            <input type="number" step="0.01" min="0"
              class="config-monto-input"
              data-nivel="${nivel}" data-mes="${mes}"
              value="${monto}"
              placeholder="0.00"
              style="width:120px;padding:6px 10px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text-primary);">
          </td>
          <td>
            <input type="checkbox" class="config-activo-check"
              data-nivel="${nivel}" data-mes="${mes}"
              ${reg?.activo !== false ? 'checked' : ''}>
          </td>
        </tr>`
    }).join('')

    return `
      <div style="margin-bottom:24px;">
        <h4 style="margin:0 0 10px;font-size:0.95rem;font-weight:600;">${nivel}</h4>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Mes</th><th>Monto (Bs)</th><th>Activo</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>`
  }).join('') + `
    <button class="btn btn-primary" onclick="window.guardarConfigMensualidad()">
      Guardar configuración
    </button>`
}

window.guardarConfigMensualidad = async function() {
  const inputs = document.querySelectorAll('.config-monto-input')
  const registros = []

  inputs.forEach(input => {
    const nivel  = input.dataset.nivel
    const mes    = parseInt(input.dataset.mes)
    const monto  = parseFloat(input.value)
    const activo = document.querySelector(
      `.config-activo-check[data-nivel="${nivel}"][data-mes="${mes}"]`
    )?.checked ?? true

    if (!isNaN(monto) && monto >= 0) {
      registros.push({ nivel, mes, monto_bs: monto, activo })
    }
  })

  mostrarLoader('Guardando configuración...')
  try {
    for (const reg of registros) {
      await supabase
        .from('config_mensualidad')
        .upsert({
          colegio_id: colegioId,
          gestion_id: await obtenerGestionId(),
          año:        añoActual,
          nivel:      reg.nivel,
          mes:        reg.mes,
          monto_bs:   reg.monto_bs,
          activo:     reg.activo
        }, { onConflict: 'colegio_id,año,nivel,mes' })
    }

    // Invalidar caché
    const { invalidarConfigPagosCache } = await import('../config/config-pagos.js')
    invalidarConfigPagosCache(añoActual)
    await cargarConfigPagos(añoActual)

    toast('Configuración guardada correctamente', 'success')
  } catch(e) {
    toast('Error al guardar la configuración', 'error')
    console.error(e)
  } finally {
    ocultarLoader()
  }
}

// ── Obtener gestion_id del año actual ──
async function obtenerGestionId() {
  const { data } = await supabase
    .from('config_gestion')
    .select('id')
    .eq('año', añoActual)
    .single()
  return data?.id ?? null
}

// ── Selector de cursos para el reporte ──
function renderSelectorCursos() {
  const sel = document.getElementById('pagos-filtro-curso')
  if (!sel) return
  sel.innerHTML = '<option value="">Seleccionar curso...</option>'
  cursos.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.nombre_completo
    sel.appendChild(opt)
  })
}