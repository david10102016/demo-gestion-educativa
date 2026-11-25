// js/utils/importar-notas-excel.js
// Importa notas desde el Excel exportado por exportarDetalleNotasExcel (hoja "Meta").
// Plan: "Importar notas desde Excel (panel profesor)" v1.1
//
// Reglas (cerradas):
//   · Solo rellena vacíos: si el sistema ya tiene nota, NO se toca.
//   · Vacío en Excel ≠ 0. El 0 solo se escribe si el profesor lo puso explícitamente.
//   · HACER/SABER  → tabla `notas` (INSERT: nunca pisa una nota existente).
//   · SER/AUTOEVAL → `rpc_upsert_calificacion` (calificaciones no tiene INSERT/UPDATE por RLS).
//   · max_puntos se valida contra la BASE, no contra el Excel.
//   · Actividad borrada / celda inválida → se omite esa columna/celda y se reporta; el resto sigue.
//   · Contexto (materia + curso + periodo) del Excel debe coincidir con el de pantalla.
// Requiere SheetJS (window.XLSX), ya cargado en dashboard-profesor.html.

import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader } from './ui.js'
import { escapeHtml } from './sanitize.js'
import { META_SHEET_NAME, META_FORMATO } from './export-excel.js'

/** Error "esperado": el archivo se rechaza con un mensaje claro para el profesor. */
class ErrorImportacion extends Error {}

const TAM_LOTE_NOTAS = 100
const CONCURRENCIA_RPC = 5
const MAX_DETALLE = 15

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const redondear2 = (n) => Math.round(n * 100) / 100

/** Celda → { vacio } | { num } | { error } */
function leerCelda(v) {
  if (v === null || v === undefined) return { vacio: true }
  if (typeof v === 'number') return Number.isFinite(v) ? { num: v } : { error: 'valor no numérico' }
  if (typeof v === 'boolean') return { error: 'valor no numérico' }
  const t = String(v).trim()
  if (t === '') return { vacio: true }
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return { error: `"${t.slice(0, 20)}" no es un número` }
  return { num: Number(t.replace(',', '.')) }
}

/** Trae todas las filas paginando (PostgREST corta en ~1000). */
async function fetchTodo(construir) {
  const PAGE = 1000
  let desde = 0
  const out = []
  for (;;) {
    const { data, error } = await construir().order('id').range(desde, desde + PAGE - 1)
    if (error) throw error
    const lote = data ?? []
    out.push(...lote)
    if (lote.length < PAGE) break
    desde += PAGE
  }
  return out
}

// ─────────────────────────────────────────────────────────
// Lectura de la hoja Meta
// ─────────────────────────────────────────────────────────
function leerMeta(XLSX, wb) {
  const ws = wb.Sheets[META_SHEET_NAME]
  if (!ws) {
    throw new ErrorImportacion(
      'Este archivo no tiene la hoja "Meta", así que no puedo saber a qué materia y actividades corresponde. ' +
      'Exportá el Excel desde el sistema (botón "Exportar Excel") y rellená ese archivo.'
    )
  }
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  const meta = { claves: {}, actividades: [], directas: [], estudiantes: [] }
  let seccion = null
  let saltarCabecera = false

  for (const r of filas) {
    const a = String(r[0] ?? '').trim()
    if (a.startsWith('#')) { seccion = a; saltarCabecera = a !== '#CLAVES'; continue }
    if (!seccion || a === '') continue
    if (saltarCabecera) { saltarCabecera = false; continue }

    if (seccion === '#CLAVES') {
      meta.claves[a] = String(r[1] ?? '').trim()
    } else if (seccion === '#ACTIVIDADES') {
      meta.actividades.push({ actividad_id: a, titulo: String(r[1] ?? ''), tipo: String(r[2] ?? '').trim(), hoja: String(r[3] ?? ''), columna: Number(r[4]) })
    } else if (seccion === '#DIRECTAS') {
      meta.directas.push({ codigo: a, campo: String(r[1] ?? '').trim(), columna: Number(r[2]), hoja: String(r[3] ?? ''), max: Number(r[4]) })
    } else if (seccion === '#ESTUDIANTES') {
      meta.estudiantes.push({ estudiante_id: a, nombre: String(r[1] ?? ''), fila: Number(r[2]) })
    }
  }

  if (meta.claves.formato !== META_FORMATO) {
    throw new ErrorImportacion('El formato de la hoja Meta no es compatible. Volvé a exportar el Excel desde el sistema.')
  }
  meta.filaCabecera = Number(meta.claves.fila_cabecera)
  if (!meta.claves.materia_id || !meta.claves.curso_id || !meta.claves.trimestre || !Number.isFinite(meta.filaCabecera)) {
    throw new ErrorImportacion('La hoja Meta está incompleta o fue modificada. Volvé a exportar el Excel desde el sistema.')
  }
  return meta
}

// ─────────────────────────────────────────────────────────
// Núcleo: valida, calcula qué escribir, escribe, devuelve reporte
// ─────────────────────────────────────────────────────────
export async function importarNotasExcel({ archivo, cursoId, materiaId, periodo, perfil, onProgreso = () => {} }) {
  const XLSX = window.XLSX
  if (typeof XLSX === 'undefined') throw new ErrorImportacion('La librería de Excel (SheetJS) no está cargada.')
  if (!cursoId || !materiaId) throw new ErrorImportacion('Seleccioná curso y materia antes de importar.')

  onProgreso('Leyendo archivo...')
  let wb
  try {
    wb = XLSX.read(new Uint8Array(await archivo.arrayBuffer()), { type: 'array' })
  } catch {
    throw new ErrorImportacion('No se pudo leer el archivo. Verificá que sea un .xlsx válido.')
  }
  const meta = leerMeta(XLSX, wb)

  // 1) Contexto debe coincidir (aunque los nombres de alumnos sean los mismos)
  const { materia_id, curso_id, trimestre } = meta.claves
  if (materia_id !== String(materiaId) || curso_id !== String(cursoId) || Number(trimestre) !== Number(periodo)) {
    throw new ErrorImportacion(
      'Este Excel no corresponde a la materia, curso o periodo seleccionados en pantalla. ' +
      'Elegí la materia/curso/periodo correctos (o exportá de nuevo) e intentá otra vez.'
    )
  }
  // Misma regla que la UI al calificar: solo el periodo activo
  if (Number(periodo) !== Number(Config.trimestreActivo)) {
    throw new ErrorImportacion(
      `Solo se pueden importar notas del ${Config.nombrePeriodo} ${Config.trimestreActivo} (activo). ` +
      `Este archivo es del ${Config.nombrePeriodo} ${periodo}.`
    )
  }

  const rep = {
    escritasNotas: 0, escritasSer: 0, escritasAuto: 0,
    omitidasConNota: 0, sinCambios: 0, omitidasVacias: 0,
    columnasOmitidas: [], filasOmitidas: [], invalidas: [], conNotaDetalle: [], errores: [], rubricaSinDesglose: [],
  }

  // 2) Datos vigentes en la base
  onProgreso('Consultando datos actuales...')
  const { data: materiaInfo, error: eMat } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  if (eMat) throw eMat
  const esTecnica = materiaInfo?.es_tecnica === true

  // Roster actual (mismo criterio que el export)
  let idsRoster
  if (esTecnica) {
    const { data, error } = await supabase.from('inscripciones_tecnicas').select('estudiante_id').eq('materia_id', materiaId).eq('activo', true)
    if (error) throw error
    idsRoster = new Set((data ?? []).map(i => i.estudiante_id))
  } else {
    const { data, error } = await supabase.from('estudiantes').select('id').eq('curso_id', cursoId)
    if (error) throw error
    idsRoster = new Set((data ?? []).map(e => e.id))
  }

  // Actividades (max_puntos vigente)
  const idsMeta = [...new Set(meta.actividades.map(a => a.actividad_id))]
  const actsDB = new Map()
  for (let i = 0; i < idsMeta.length; i += 50) {
    const { data, error } = await supabase.from('actividades')
      .select('id, titulo, tipo, max_puntos, materia_id, curso_id, trimestre')
      .in('id', idsMeta.slice(i, i + 50))
    if (error) throw error
    ;(data ?? []).forEach(a => actsDB.set(a.id, a))
  }

  // 3) Columnas de actividades válidas
  const colsValidas = []
  for (const ma of meta.actividades) {
    const etiqueta = ma.titulo || ma.actividad_id
    const db = actsDB.get(ma.actividad_id)
    const omitir = (motivo) => rep.columnasOmitidas.push({ titulo: etiqueta, motivo })

    if (!db) { omitir('la actividad ya no existe (fue borrada)'); continue }
    if (db.materia_id !== materiaId || Number(db.trimestre) !== Number(periodo) || (!esTecnica && db.curso_id !== cursoId) || db.tipo !== ma.tipo) {
      omitir('la actividad no corresponde a esta materia/curso/periodo'); continue
    }
    const ws = wb.Sheets[ma.hoja]
    if (!ws) { omitir(`no se encontró la hoja "${ma.hoja}"`); continue }
    const encabezado = ws[XLSX.utils.encode_cell({ r: meta.filaCabecera - 1, c: ma.columna - 1 })]?.v
    if (!norm(encabezado).startsWith(norm(ma.titulo))) {
      omitir('el encabezado no coincide (columna movida o editada); volvé a exportar'); continue
    }
    colsValidas.push({ ...ma, ws, max: parseFloat(db.max_puntos) })
  }

  // Directas SER / Autoevaluación
  const directasValidas = []
  for (const d of meta.directas) {
    if (!['nota_ser', 'nota_decidir'].includes(d.campo)) continue
    const ws = wb.Sheets[d.hoja]
    if (!ws) { rep.columnasOmitidas.push({ titulo: d.codigo.toUpperCase(), motivo: `no se encontró la hoja "${d.hoja}"` }); continue }
    const max = Config.dimensiones.find(x => x.codigo === d.codigo)?.peso_maximo ?? d.max
    directasValidas.push({ ...d, ws, max: parseFloat(max) })
  }

  // 4) Estudiantes válidos (en el roster actual y con la fila intacta en cada hoja)
  const estsMeta = meta.estudiantes.filter(e => {
    if (idsRoster.has(e.estudiante_id)) return true
    rep.filasOmitidas.push({ nombre: e.nombre, motivo: 'ya no pertenece a este curso/materia' })
    return false
  })
  const filaOk = (ws, est) => {
    const nombre = ws[XLSX.utils.encode_cell({ r: est.fila - 1, c: 1 })]?.v
    return norm(nombre) === norm(est.nombre)
  }
  const filaAvisada = new Set()
  const avisarFila = (est) => {
    if (filaAvisada.has(est.estudiante_id)) return
    filaAvisada.add(est.estudiante_id)
    rep.filasOmitidas.push({ nombre: est.nombre, motivo: 'la fila del Excel no coincide con el estudiante (filas movidas u ordenadas)' })
  }

  // 5) Notas / calificaciones existentes
  const existentesNotas = new Map()
  if (colsValidas.length) {
    const idsActs = colsValidas.map(c => c.actividad_id)
    for (let i = 0; i < idsActs.length; i += 50) {
      const lote = idsActs.slice(i, i + 50)
      const filas = await fetchTodo(() => supabase.from('notas').select('id, actividad_id, estudiante_id, valor').in('actividad_id', lote))
      filas.forEach(n => existentesNotas.set(`${n.actividad_id}_${n.estudiante_id}`, parseFloat(n.valor)))
    }
  }
  const existentesCal = new Map()
  if (directasValidas.length) {
    const filas = await fetchTodo(() => supabase.from('calificaciones').select('id, estudiante_id, nota_ser, nota_decidir').eq('materia_id', materiaId).eq('trimestre', periodo))
    filas.forEach(c => existentesCal.set(c.estudiante_id, c))
  }

  // 6) Clasificar cada celda (regla "solo vacíos")
  const clasificar = ({ celda, existente, max, etiqueta, nombre }) => {
    if (existente != null && !Number.isNaN(existente)) {
      // El sistema ya tiene nota: NO se modifica
      if (celda.num != null) {
        if (redondear2(celda.num) === redondear2(existente)) rep.sinCambios++
        else {
          rep.omitidasConNota++
          rep.conNotaDetalle.push({ nombre, etiqueta, excel: celda.num, sistema: existente })
        }
      } else rep.sinCambios++
      return null
    }
    if (celda.vacio) { rep.omitidasVacias++; return null }
    if (celda.error) { rep.invalidas.push({ nombre, etiqueta, motivo: celda.error }); return null }
    if (celda.num < 0 || celda.num > max) {
      rep.invalidas.push({ nombre, etiqueta, motivo: `${celda.num} fuera de rango (0–${max})` }); return null
    }
    return redondear2(celda.num)
  }

  const pendientesNotas = []
  for (const col of colsValidas) {
    for (const est of estsMeta) {
      if (!filaOk(col.ws, est)) { avisarFila(est); continue }
      const celda = leerCelda(col.ws[XLSX.utils.encode_cell({ r: est.fila - 1, c: col.columna - 1 })]?.v)
      const valor = clasificar({ celda, existente: existentesNotas.get(`${col.actividad_id}_${est.estudiante_id}`), max: col.max, etiqueta: col.titulo, nombre: est.nombre })
      if (valor != null) {
        pendientesNotas.push({ est, etiqueta: col.titulo, row: { actividad_id: col.actividad_id, estudiante_id: est.estudiante_id, valor, creado_por: perfil?.id ?? null } })
      }
    }
  }

  const pendientesCal = new Map()   // estudiante_id → { est, ser, auto }
  for (const dir of directasValidas) {
    const etiqueta = dir.codigo === 'ser' ? 'SER' : 'Autoevaluación'
    for (const est of estsMeta) {
      if (!filaOk(dir.ws, est)) { avisarFila(est); continue }
      const celda = leerCelda(dir.ws[XLSX.utils.encode_cell({ r: est.fila - 1, c: dir.columna - 1 })]?.v)
      const valor = clasificar({ celda, existente: existentesCal.get(est.estudiante_id)?.[dir.campo], max: dir.max, etiqueta, nombre: est.nombre })
      if (valor != null) {
        const p = pendientesCal.get(est.estudiante_id) ?? { est, ser: null, auto: null }
        if (dir.campo === 'nota_ser') p.ser = valor; else p.auto = valor
        pendientesCal.set(est.estudiante_id, p)
      }
    }
  }

  // Actividades con rúbrica (solo informativo: NO se bloquea nada)
  const idsConRubrica = new Set()
  if (colsValidas.length) {
    try {
      const { data } = await supabase.from('rubrica_criterios').select('actividad_id').in('actividad_id', colsValidas.map(c => c.actividad_id))
      ;(data ?? []).forEach(r => idsConRubrica.add(r.actividad_id))
    } catch { /* aviso opcional: si falla, el import sigue igual */ }
  }
  const actsEscritas = new Set()

  // 7) Escritura — HACER/SABER: INSERT por lotes (nunca pisa notas); si un lote falla, fila por fila
  const resumirError = (e) => e?.message ?? String(e)
  for (let i = 0; i < pendientesNotas.length; i += TAM_LOTE_NOTAS) {
    onProgreso(`Guardando notas Hacer/Saber (${Math.min(i + TAM_LOTE_NOTAS, pendientesNotas.length)}/${pendientesNotas.length})...`)
    const lote = pendientesNotas.slice(i, i + TAM_LOTE_NOTAS)
    const { error } = await supabase.from('notas').insert(lote.map(p => p.row))
    if (!error) { rep.escritasNotas += lote.length; lote.forEach(p => actsEscritas.add(p.row.actividad_id)); continue }

    for (const p of lote) {
      const { error: e } = await supabase.from('notas').insert(p.row)
      if (!e) { rep.escritasNotas++; actsEscritas.add(p.row.actividad_id) }
      else if (e.code === '23505') rep.omitidasConNota++   // alguien la cargó mientras tanto
      else rep.errores.push({ nombre: p.est.nombre, etiqueta: p.etiqueta, motivo: resumirError(e) })
    }
  }

  // 8) Escritura — SER / Autoevaluación: SOLO vía RPC. null = "no tocar" (la RPC hace COALESCE).
  const listaCal = [...pendientesCal.values()]
  for (let i = 0; i < listaCal.length; i += CONCURRENCIA_RPC) {
    onProgreso(`Guardando SER / Autoevaluación (${Math.min(i + CONCURRENCIA_RPC, listaCal.length)}/${listaCal.length})...`)
    await Promise.all(listaCal.slice(i, i + CONCURRENCIA_RPC).map(async (p) => {
      const { error } = await supabase.rpc('rpc_upsert_calificacion', {
        p_estudiante_id: p.est.estudiante_id,
        p_materia_id:    materiaId,
        p_trimestre:     Number(periodo),
        p_nota_ser:      p.ser,
        p_nota_decidir:  p.auto,
      })
      if (error) {
        rep.errores.push({ nombre: p.est.nombre, etiqueta: [p.ser != null ? 'SER' : null, p.auto != null ? 'Autoevaluación' : null].filter(Boolean).join(' + '), motivo: resumirError(error) })
      } else {
        if (p.ser != null) rep.escritasSer++
        if (p.auto != null) rep.escritasAuto++
      }
    }))
  }

  rep.rubricaSinDesglose = colsValidas.filter(c => idsConRubrica.has(c.actividad_id) && actsEscritas.has(c.actividad_id)).map(c => c.titulo)
  return rep
}

// ─────────────────────────────────────────────────────────
// UI: selector de archivo + reporte
// ─────────────────────────────────────────────────────────
export function iniciarImportacionNotas({ cursoId, materiaId, periodo, perfil, onTerminado = () => {} }) {
  if (!cursoId || !materiaId) { toast('Seleccioná curso y materia primero', 'warning'); return }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xlsx'
  input.style.display = 'none'
  document.body.appendChild(input)

  input.addEventListener('change', async () => {
    const archivo = input.files?.[0]
    input.remove()
    if (!archivo) return
    mostrarLoader('Importando notas...')
    try {
      const rep = await importarNotasExcel({
        archivo, cursoId, materiaId, periodo, perfil,
        onProgreso: (t) => mostrarLoader(t),
      })
      ocultarLoader()
      mostrarReporteImportacion(rep)
      onTerminado(rep)
    } catch (err) {
      ocultarLoader()
      if (err instanceof ErrorImportacion) mostrarRechazo(err.message)
      else { console.error(err); toast('Error al importar: ' + (err.message ?? err), 'error') }
    }
  })
  // Si el usuario cancela el diálogo no se dispara "change": el input queda oculto hasta recargar (inofensivo)
  input.click()
}

function _overlay(html) {
  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)', padding: '16px',
  })
  overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px;max-width:560px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 25px 50px rgba(0,0,0,0.25);">${html}
    <button data-cerrar style="margin-top:16px;width:100%;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Entendido</button></div>`
  const cerrar = () => overlay.remove()
  overlay.querySelector('[data-cerrar]').onclick = cerrar
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar() })
  document.body.appendChild(overlay)
}

function mostrarRechazo(mensaje) {
  _overlay(`<h3 style="margin:0 0 8px;font-size:1.1rem;font-weight:700;color:#991b1b;">No se pudo importar</h3>
    <p style="margin:0;font-size:0.9rem;color:#374151;">${escapeHtml(mensaje)}</p>`)
}

export function mostrarReporteImportacion(rep) {
  const fila = (n, texto, color = '#374151') =>
    `<li style="margin:4px 0;color:${color};"><strong>${n}</strong> ${texto}</li>`
  const detalle = (arr, fmt) => {
    if (!arr.length) return ''
    const items = arr.slice(0, MAX_DETALLE).map(x => `<li>${fmt(x)}</li>`).join('')
    const mas = arr.length > MAX_DETALLE ? `<li>… y ${arr.length - MAX_DETALLE} más</li>` : ''
    return `<ul style="margin:4px 0 8px 18px;padding:0;font-size:12px;color:#64748b;">${items}${mas}</ul>`
  }

  const totalEscritas = rep.escritasNotas + rep.escritasSer + rep.escritasAuto
  let html = `<h3 style="margin:0 0 4px;font-size:1.1rem;font-weight:700;">Resultado de la importación</h3>
    <p style="margin:0 0 12px;font-size:0.85rem;color:#64748b;">${totalEscritas ? 'Se cargaron las notas que estaban vacías en el sistema.' : 'No se escribió ninguna nota nueva.'}</p>
    <ul style="list-style:none;padding:0;margin:0;font-size:0.9rem;">`
  html += fila(rep.escritasNotas, 'notas Hacer/Saber escritas', '#166534')
  html += fila(`${rep.escritasSer} / ${rep.escritasAuto}`, 'notas SER / Autoevaluación escritas', '#166534')
  html += fila(rep.omitidasConNota, 'omitidas: ya tenían una nota distinta en el sistema')
  html += fila(rep.omitidasVacias, 'omitidas: celda vacía (no se escribió 0)')
  if (rep.sinCambios) html += fila(rep.sinCambios, 'sin cambios (ya coincidían con el sistema)')
  html += fila(rep.columnasOmitidas.length, 'columnas omitidas', rep.columnasOmitidas.length ? '#92400e' : '#374151')
  html += fila(rep.invalidas.length, 'celdas inválidas (texto o fuera de máximo)', rep.invalidas.length ? '#991b1b' : '#374151')
  if (rep.filasOmitidas.length) html += fila(rep.filasOmitidas.length, 'estudiantes omitidos', '#92400e')
  if (rep.errores.length) html += fila(rep.errores.length, 'errores al guardar', '#991b1b')
  html += '</ul>'

  if (rep.omitidasConNota) {
    html += `<div style="margin-top:12px;padding:10px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e;">
      Para corregir notas ya cargadas, usá la interfaz web.</div>`
    html += detalle(rep.conNotaDetalle, x => `${escapeHtml(x.nombre)} — ${escapeHtml(x.etiqueta)}: Excel ${x.excel}, sistema ${x.sistema}`)
  }
  if (rep.rubricaSinDesglose.length) {
    html += `<div style="margin-top:12px;padding:10px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e;">
      ⚠ Estas actividades tienen rúbrica y sus notas se cargaron sin desglose por criterios:
      <strong>${rep.rubricaSinDesglose.map(escapeHtml).join(', ')}</strong>.
      Si quieres el detalle, califícalas desde la web.</div>`
  }
  html += detalle(rep.columnasOmitidas, x => `Columna "${escapeHtml(x.titulo)}": ${escapeHtml(x.motivo)}`)
  html += detalle(rep.filasOmitidas, x => `${escapeHtml(x.nombre)}: ${escapeHtml(x.motivo)}`)
  html += detalle(rep.invalidas, x => `${escapeHtml(x.nombre)} — ${escapeHtml(x.etiqueta)}: ${escapeHtml(x.motivo)}`)
  html += detalle(rep.errores, x => `${escapeHtml(x.nombre)} — ${escapeHtml(x.etiqueta)}: ${escapeHtml(x.motivo)}`)

  _overlay(html)
}