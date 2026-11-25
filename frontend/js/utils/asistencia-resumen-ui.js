// js/utils/asistencia-resumen-ui.js
//
// UI reutilizable del resumen de asistencia (diseño v5).
// Un solo aspecto visual para director, estudiante, tutor y profesor.
// No consulta Supabase; recibe datos ya cargados desde asistencia-materia.js.

import { etiquetaEstado } from './asistencia-materia.js'
import { escapeHtml } from './sanitize.js'

const COLOR_ESTADO = {
  falta:    { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
  licencia: { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
  retraso:  { bg: '#fefce8', border: '#fde68a', text: '#a16207' },
  presente: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
}

/**
 * Chip / badge de estado resumen.
 * @param {string} estado  falta|licencia|retraso|presente
 * @param {string} [extra] texto extra ej. "(Lenguaje)" o materia_excepcion
 */
export function htmlBadgeEstado(estado, extra = '') {
  const c = COLOR_ESTADO[estado] || COLOR_ESTADO.presente
  const label = etiquetaEstado(estado) + (extra ? ` ${extra}` : '')
  return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${c.bg};color:${c.text};border:1px solid ${c.border};">${escapeHtml(label)}</span>`
}

/**
 * Fila de detalle por materia (para desplegable o tabla).
 * @param {object} d  { materiaNombre, profesorNombre?, estado, observaciones? }
 */
export function htmlFilaDetalleMateria(d) {
  const c = COLOR_ESTADO[d.estado] || COLOR_ESTADO.presente
  const prof = d.profesorNombre ? ` · ${escapeHtml(d.profesorNombre)}` : ''
  const obs = d.observaciones
    ? `<div style="font-size:11px;color:var(--color-text-3);margin-top:2px;">${escapeHtml(d.observaciones)}</div>`
    : ''
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid var(--color-border);">
      <div style="min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--color-text);">${escapeHtml(d.materiaNombre || 'Materia')}${prof}</div>
        ${obs}
      </div>
      <span style="flex-shrink:0;font-size:12px;font-weight:600;color:${c.text};">${escapeHtml(etiquetaEstado(d.estado))}</span>
    </div>`
}

/**
 * Bloque completo: badge resumen + lista de materias (detalle).
 * @param {object} opts
 * @param {string} opts.estadoResumen
 * @param {string} [opts.materiaExcepcion]  texto de materias que provocaron el estado
 * @param {Array<{materiaNombre, profesorNombre?, estado, observaciones?}>} opts.detalle
 * @param {string} [opts.titulo]
 */
export function htmlResumenConDetalle({ estadoResumen, materiaExcepcion = '', detalle = [], titulo = '' } = {}) {
  const filas = (detalle ?? []).map(htmlFilaDetalleMateria).join('')
  const head = titulo
    ? `<div style="font-size:12px;font-weight:700;color:var(--color-text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(titulo)}</div>`
    : ''
  const extra = materiaExcepcion ? `(${materiaExcepcion})` : ''
  return `
    <div style="padding:12px 14px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;">
      ${head}
      <div style="margin-bottom:${detalle.length ? '10px' : '0'};">${htmlBadgeEstado(estadoResumen, extra)}</div>
      ${detalle.length ? `<div>${filas}</div>` : ''}
    </div>`
}

/**
 * Celdas de tabla Formato B (resumen + una celda por materia).
 * @param {string} estadoResumen
 * @param {Array<{ key: string, estado: string }>} materiasOrdenadas  key = nombre o id
 */
export function htmlCeldasFormatoB(estadoResumen, materiasOrdenadas = []) {
  const celdasMat = materiasOrdenadas.map(m =>
    `<td style="text-align:center;font-size:12px;">${escapeHtml(etiquetaEstado(m.estado))}</td>`
  ).join('')
  return `<td>${htmlBadgeEstado(estadoResumen)}</td>${celdasMat}`
}

// ─── LISTA DE ASISTENCIA AGRUPADA POR DÍA ─────────────────────
// Filas de tabla (3 columnas: N°, Estudiante, Estado) con una barra separadora
// por día que muestra la fecha completa y el resumen P/F/R/L del día.
// Pensada para listas ya ordenadas por fecha y nombre y paginadas en pantalla.

const NOMBRE_ESTADO_LISTA = { presente: 'Presente', falta: 'Falta', retraso: 'Retraso', licencia: 'Licencia' }
const BADGE_ESTADO_LISTA  = { presente: 'badge-success', falta: 'badge-error', retraso: 'badge-warning', licencia: 'badge-info' }

/**
 * Resumen por fecha y número de lista dentro de cada día.
 * @param {Array<{fecha:string, estado:string}>} filas  ordenadas por fecha y nombre
 */
export function resumenAsistenciaPorDia(filas = []) {
  const porFecha = {}
  const numeroEnDia = []
  filas.forEach((f, i) => {
    const r = porFecha[f.fecha] ??= { total: 0, presente: 0, falta: 0, retraso: 0, licencia: 0 }
    r.total++
    r[f.estado] = (r[f.estado] ?? 0) + 1
    numeroEnDia[i] = r.total
  })
  return { porFecha, numeroEnDia }
}

function _nombreDiaLargo(fecha) {
  const t = new Date(fecha + 'T12:00:00').toLocaleDateString('es-BO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Barra separadora de un día (fila de tabla que ocupa todas las columnas). */
export function htmlSeparadorDia(fecha, r = {}, { continuacion = false, colspan = 3 } = {}) {
  const n = r.total ?? 0
  return `
    <tr>
      <td colspan="${colspan}" style="background:color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));border-top:2px solid var(--color-primary);padding:10px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <strong style="font-size:14px;">📅 ${escapeHtml(_nombreDiaLargo(fecha))}${continuacion ? ' <span style="font-weight:400;color:var(--color-text-3);">(continuación)</span>' : ''}</strong>
          <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;">
            <span class="text-muted">${n} estudiante${n !== 1 ? 's' : ''}</span>
            <span class="badge badge-success">P: ${r.presente ?? 0}</span>
            <span class="badge badge-error">F: ${r.falta ?? 0}</span>
            <span class="badge badge-warning">R: ${r.retraso ?? 0}</span>
            <span class="badge badge-info">L: ${r.licencia ?? 0}</span>
          </span>
        </div>
      </td>
    </tr>`
}

/**
 * Filas <tr> de una página de la lista, con separador al cambiar de día.
 * @param {Array<{fecha, nombre, estado}>} filas  lista COMPLETA ordenada
 * @param {number} desde        índice de la primera fila de la página
 * @param {number} cantidad     filas por página
 * @param {object} [opts]
 * @param {string} [opts.onClickEstado]  nombre de función global que recibe el índice (ej. 'window.verDetalleAsisDir')
 */
export function htmlFilasAsistenciaPorDia(filas = [], desde = 0, cantidad = 50, { onClickEstado = '' } = {}) {
  const { porFecha, numeroEnDia } = resumenAsistenciaPorDia(filas)
  let html = ''
  filas.slice(desde, desde + cantidad).forEach((f, i) => {
    const idx = desde + i
    const anterior = filas[idx - 1]
    if (i === 0 || anterior?.fecha !== f.fecha) {
      html += htmlSeparadorDia(f.fecha, porFecha[f.fecha], { continuacion: i === 0 && anterior?.fecha === f.fecha })
    }
    const etiqueta = NOMBRE_ESTADO_LISTA[f.estado] ?? f.estado
    const estadoHtml = onClickEstado
      ? `<button type="button" class="badge ${BADGE_ESTADO_LISTA[f.estado] ?? 'badge-neutral'}" style="cursor:pointer;border:none;font:inherit;"
           onclick="${onClickEstado}(${idx})" title="Ver desglose por materia">${escapeHtml(etiqueta)}</button>`
      : `<span class="badge ${BADGE_ESTADO_LISTA[f.estado] ?? 'badge-neutral'}">${escapeHtml(etiqueta)}</span>`
    html += `
      <tr>
        <td class="text-muted" style="width:60px;">${numeroEnDia[idx]}</td>
        <td><strong>${escapeHtml(f.nombre)}</strong></td>
        <td>${estadoHtml}</td>
      </tr>`
  })
  return html
}