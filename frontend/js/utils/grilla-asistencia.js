// js/utils/grilla-asistencia.js
// Piezas COMPARTIDAS de la grilla de asistencia estudiante × día (sin acceso a datos):
//   · el historial mensual del profesor (profesor/asistencia-mensual.js)
//   · la asistencia de solo lectura del asesor de curso (profesor/asesor-curso.js)
// Aquí solo hay HTML, colores, totales y exportación a Excel.
import { escapeHtml } from './sanitize.js'

export const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
export const LETRA = { presente: 'P', falta: 'F', retraso: 'R', licencia: 'L' }
export const NOMBRE_ESTADO = { P: 'Presente', F: 'Falta', R: 'Retraso', L: 'Licencia' }
export const COLORES = {
  P: ['#dcfce7', '#166534'], F: ['#fee2e2', '#991b1b'],
  R: ['#fef3c7', '#92400e'], L: ['#e0e7ff', '#3730a3'], '': ['#f1f5f9', '#94a3b8'],
}

export const pad = (n) => String(n).padStart(2, '0')

/** Primer y último día de un mes (mes 0-11) como 'YYYY-MM-DD'. */
export function rangoMes(anio, mes) {
  const ultimo = new Date(anio, mes + 1, 0).getDate()
  return { desde: `${anio}-${pad(mes + 1)}-01`, hasta: `${anio}-${pad(mes + 1)}-${pad(ultimo)}` }
}

/** Nombre de archivo seguro (sin tildes ni símbolos). */
export function limpiarNombreArchivo(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_')
}

/** Totales P/F/R/L de un estudiante. celdas: { 'estId|fecha': { l, obs, qr? } }  (qr = texto de llegada por QR) */
export function totalesAlumno(estId, fechas, celdas) {
  const t = { P: 0, F: 0, R: 0, L: 0 }
  for (const f of fechas) {
    const c = celdas[`${estId}|${f}`]
    if (c?.l) t[c.l]++
  }
  return t
}

/**
 * Barra superior: título + navegación de mes + búsqueda + exportar.
 * fn = nombres de funciones globales: { nav(delta), ir('YYYY-MM'), buscar(texto), exportar() }.
 */
export function htmlBarraMes({ anio, mes, ids, fn }) {
  return `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div id="${ids.titulo}"></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="${fn.nav}(-1)" aria-label="Mes anterior">‹</button>
        <input type="month" id="${ids.mes}" value="${anio}-${pad(mes + 1)}" style="width:170px;" onchange="${fn.ir}(this.value)">
        <button type="button" class="btn btn-secondary btn-sm" onclick="${fn.nav}(1)" aria-label="Mes siguiente">›</button>
        <input type="search" placeholder="Buscar estudiante..." style="width:200px;" oninput="${fn.buscar}(this.value)">
        <button type="button" class="btn btn-secondary" onclick="${fn.exportar}()">Exportar Excel</button>
      </div>
    </div>
    <div id="${ids.resultado}"></div>
    <div id="${ids.detalle}" style="margin-top:12px;"></div>`
}

/**
 * Grilla estudiante × día.
 * datos: { estudiantes: [{id, nombre, movido?}], fechas: ['YYYY-MM-DD'], celdas }
 * onClick: nombre de función global que recibe (estudianteId, fecha) al tocar una marca.
 */
export function htmlGrilla({ estudiantes, fechas, celdas }, { filtro = '', onClick }) {
  const q = filtro.trim().toLowerCase()
  const lista = estudiantes.filter(e => !q || e.nombre.toLowerCase().includes(q))

  const cab = fechas.map(f => {
    const [y, m, d] = f.split('-').map(Number)
    return `<th style="padding:4px 6px;text-align:center;font-size:11px;white-space:nowrap;">${pad(d)}<br><span style="font-weight:400;color:var(--color-text-3);">${DIAS[new Date(y, m - 1, d).getDay()]}</span></th>`
  }).join('')

  const filas = lista.map((e, i) => {
    const t = totalesAlumno(e.id, fechas, celdas)
    const tds = fechas.map(f => {
      const c = celdas[`${e.id}|${f}`]
      const l = c?.l ?? ''
      const [bg, fg] = COLORES[l]
      const tip = [c?.qr, c?.obs ? 'Con observación' : ''].filter(Boolean).join(' · ')
      return `<td style="padding:2px;text-align:center;">
        <button type="button" data-est="${escapeHtml(e.id)}" data-f="${f}" onclick="${onClick}(this.dataset.est, this.dataset.f)"${tip ? ` title="${escapeHtml(tip)}"` : ''}
          style="width:32px;height:26px;border:0;border-radius:6px;background:${bg};color:${fg};font-weight:700;font-size:12px;cursor:pointer;${c?.obs ? 'outline:1px dashed #64748b;' : ''}">${l || '—'}</button></td>`
    }).join('')
    const aviso = e.movido
      ? ' <span class="text-sm" style="font-weight:400;color:#92400e;" title="Tiene asistencia registrada en este curso, pero hoy pertenece a otro curso o paralelo">(cambió de curso)</span>'
      : ''
    return `<tr>
      <td style="padding:4px 8px;color:var(--color-text-3);">${i + 1}</td>
      <td style="padding:4px 8px;white-space:nowrap;font-weight:600;position:sticky;left:0;background:var(--color-surface,#fff);">${escapeHtml(e.nombre)}${aviso}</td>
      ${tds}
      <td style="text-align:center;font-weight:700;color:#166534;">${t.P}</td>
      <td style="text-align:center;font-weight:700;color:#991b1b;">${t.F}</td>
      <td style="text-align:center;font-weight:700;color:#92400e;">${t.R}</td>
      <td style="text-align:center;font-weight:700;color:#3730a3;">${t.L}</td>
    </tr>`
  }).join('')

  return `
    <div style="overflow-x:auto;border:1px solid var(--color-border);border-radius:10px;">
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr style="background:var(--color-surface-2,#f8fafc);">
          <th style="padding:4px 8px;">#</th>
          <th style="padding:4px 8px;text-align:left;position:sticky;left:0;background:var(--color-surface-2,#f8fafc);">Estudiante</th>
          ${cab}
          <th style="padding:4px 8px;color:#166534;">P</th><th style="padding:4px 8px;color:#991b1b;">F</th>
          <th style="padding:4px 8px;color:#92400e;">R</th><th style="padding:4px 8px;color:#3730a3;">L</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div class="text-sm text-muted" style="margin-top:6px;">Mostrando ${lista.length} de ${estudiantes.length} estudiantes</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:12px;">
      ${['P', 'F', 'R', 'L', ''].map(l => `<span><span style="display:inline-block;min-width:22px;text-align:center;padding:2px 6px;border-radius:6px;background:${COLORES[l][0]};color:${COLORES[l][1]};font-weight:700;">${l || '—'}</span> ${NOMBRE_ESTADO[l] ?? 'Sin registrar'}</span>`).join('')}
      <span class="text-muted">Toca una marca para ver su detalle.</span>
    </div>`
}

/** Tarjeta de detalle de una marca. */
export function htmlDetalleMarca(estudiante, fecha, celda, textoVacio = 'Sin observación registrada.') {
  const [y, m, d] = fecha.split('-')
  return `
    <div class="card" style="padding:12px 16px;">
      <strong>${escapeHtml(estudiante?.nombre ?? '')}</strong> · ${d}/${m}/${y} ·
      <strong>${celda?.l ? NOMBRE_ESTADO[celda.l] : 'Sin registrar'}</strong>
      ${celda?.qr ? `<div class="text-sm" style="margin-top:4px;font-weight:600;color:#0369a1;">⏱ ${escapeHtml(celda.qr)}</div>` : ''}
      <div class="text-sm text-muted" style="margin-top:4px;">${celda?.obs ? escapeHtml(celda.obs) : textoVacio}</div>
    </div>`
}

/** Exporta la grilla a Excel (requiere la librería global XLSX). */
export function exportarGrillaExcel({ estudiantes, fechas, celdas }, { titulo, subtitulo, hoja, archivo }) {
  if (typeof XLSX === 'undefined') throw new Error('La librería de Excel no está cargada')
  const cab = ['N°', 'Estudiante', ...fechas.map(f => f.slice(8) + '/' + f.slice(5, 7)), 'P', 'F', 'R', 'L']
  const filas = estudiantes.map((e, i) => {
    const t = totalesAlumno(e.id, fechas, celdas)
    return [i + 1, e.nombre + (e.movido ? ' (cambió de curso)' : ''), ...fechas.map(f => celdas[`${e.id}|${f}`]?.l ?? ''), t.P, t.F, t.R, t.L]
  })
  const ws = XLSX.utils.aoa_to_sheet([[titulo], [subtitulo], [], cab, ...filas])
  // Comentario (visible al pasar el cursor; no se imprime) en las marcas tomadas por QR
  estudiantes.forEach((e, i) => fechas.forEach((f, j) => {
    const c = celdas[`${e.id}|${f}`]
    if (!c?.qr) return
    const ref = XLSX.utils.encode_cell({ r: 4 + i, c: 2 + j })
    if (!ws[ref]) return
    ws[ref].c = [{ a: 'Sistema', t: c.qr }]
    ws[ref].c.hidden = true
  }))
  ws['!cols'] = [{ wch: 4 }, { wch: 34 }, ...fechas.map(() => ({ wch: 5 })), { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 4 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, String(hoja).slice(0, 31))
  XLSX.writeFile(wb, archivo)
}
