// js/utils/importar-profesores.js
// Importación masiva de profesores desde Excel (panel del director).
// Llama a la Edge Function `crear-profesores-masivo` (máx. 50 por llamada).
// Excel: columnas "Nombre completo" (obligatoria: apellidos y nombres en una celda, apellidos primero, como en el SIE)
// y "Teléfono" (opcional). Si los apellidos vienen en columnas aparte, se unen solos. Sin carnet.
// Antes de crear muestra una vista previa: nuevos, posibles repetidos (ya existen en el colegio o
// repetidos en el archivo) y con error. Los repetidos solo se crean si se marca "Es otra persona".
// Las contraseñas temporales las genera el servidor y se descargan UNA sola vez en un Excel.
// Requiere SheetJS (window.XLSX), ya cargado en dashboard-director.html.

import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from './ui.js'
import { validarNombre, validarTelefono } from './validaciones.js'
import { escapeHtml } from './sanitize.js'

export const MAX_POR_LLAMADA = 50                       // igual al tope de la función del servidor
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'     // 32 símbolos, sin 0/O/1/I

/** Contraseña temporal aleatoria (10 caracteres, generador criptográfico). También la usa el Reset. */
export function generarPasswordTemporal(longitud = 10) {
  const bytes = new Uint8Array(longitud)
  crypto.getRandomValues(bytes)
  let p = ''
  for (const b of bytes) p += ALFABETO[b & 31]
  return p
}

// ─────────────────────────────────────────────────────────
// Lectura del Excel
// ─────────────────────────────────────────────────────────
const normKey = (k) => String(k ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

const COL_NOMBRE_COMPLETO = ['nombre completo', 'nombre', 'profesor', 'nombre_completo', 'apellidos y nombres']
const COL_NOMBRES  = ['nombres']
const COL_PATERNO  = ['apellido paterno', 'paterno', 'primer apellido']
const COL_MATERNO  = ['apellido materno', 'materno', 'segundo apellido']
const COL_APELLIDOS = ['apellidos', 'apellido']
const COL_TEL      = ['telefono', 'celular', 'cel', 'movil']

/** Clave para comparar nombres: sin mayúsculas, tildes ni espacios de más, y sin importar el orden
 *  de las palabras (igual que el servidor): "JUAN DAVID USCAMAYTA RAMOS" = "USCAMAYTA RAMOS JUAN DAVID". */
export const claveNombre = (n) => String(n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ')
const tieneColumna = (rows, candidatas) => rows.some(r => Object.keys(r).some(k => candidatas.includes(normKey(k))))

function leerColumna(row, candidatas) {
  for (const k of Object.keys(row)) {
    if (candidatas.includes(normKey(k))) return String(row[k] ?? '').trim()
  }
  return ''
}

/** Filas de la hoja → { profesores, errores }. Pura (sin DOM), para poder probarla. */
export function normalizarFilasProfesores(rows) {
  const profesores = []
  const errores = []
  // Formato del nombre: una sola columna (recomendado) o apellidos y nombres en columnas aparte
  const separado = tieneColumna(rows, [...COL_PATERNO, ...COL_MATERNO, ...COL_APELLIDOS])
  const unaColumna = tieneColumna(rows, COL_NOMBRE_COMPLETO)
  if (!separado && !unaColumna && tieneColumna(rows, COL_NOMBRES)) {
    throw new Error('El Excel tiene solo la columna "Nombres", sin apellidos. Use una columna "Nombre completo" con apellidos y nombres (apellidos primero, como en el SIE).')
  }
  rows.forEach((row, idx) => {
    const fila = idx + 2                                  // +2: la fila 1 es el encabezado
    let nombre = unaColumna && !separado ? leerColumna(row, COL_NOMBRE_COMPLETO) : ''
    if (separado) {                                       // apellidos primero, luego nombres
      nombre = [leerColumna(row, COL_PATERNO), leerColumna(row, COL_MATERNO), leerColumna(row, COL_APELLIDOS),
        leerColumna(row, COL_NOMBRES) || leerColumna(row, COL_NOMBRE_COMPLETO)].filter(Boolean).join(' ')
    }
    nombre = nombre.replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim()
    const tel = leerColumna(row, COL_TEL)
    if (!nombre && !tel) return                           // fila vacía: se ignora
    const rn = validarNombre(nombre)
    if (!rn.valido) { errores.push({ fila, nombre, razon: rn.mensaje }); return }
    const rt = validarTelefono(tel)
    if (!rt.valido) { errores.push({ fila, nombre, razon: rt.mensaje }); return }
    profesores.push({ fila, nombre, telefono: rt.limpio || '' })
  })
  return { profesores, errores }
}

export function parseExcelProfesores(archivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const XLSX = window.XLSX
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        if (!sheet) return reject(new Error('El archivo Excel está vacío'))
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        const r = normalizarFilasProfesores(rows)
        if (!r.profesores.length && !r.errores.length) return reject(new Error('No hay datos en el Excel'))
        resolve(r)
      } catch (err) { reject(new Error(`Error leyendo el Excel: ${err.message}`)) }
    }
    reader.onerror = () => reject(new Error('Error leyendo el archivo'))
    reader.readAsArrayBuffer(archivo)
  })
}

// ─────────────────────────────────────────────────────────
// Llamada al servidor (en lotes de 50)
// ─────────────────────────────────────────────────────────
async function mensajeDeError(error) {
  let msg = error?.message || 'Error en la Edge Function'
  try {
    const j = await error.context?.json()
    if (j?.error) msg = j.error + (j.details ? `: ${j.details}` : '')
  } catch (_e) { /* sin cuerpo */ }
  return msg
}

export async function importarProfesoresMasivo(profesores, colegioId, onProgreso = () => {}) {
  const res = { datos_creados: [], errores: [], advertencias: [], repetidos: [], interrumpido: false }
  for (let i = 0; i < profesores.length; i += MAX_POR_LLAMADA) {
    const lote = profesores.slice(i, i + MAX_POR_LLAMADA)
    onProgreso(Math.min(i + MAX_POR_LLAMADA, profesores.length), profesores.length)
    const { data, error } = await supabase.functions.invoke('crear-profesores-masivo', {
      body: { profesores: lote.map(p => ({ nombre: p.nombre, telefono: p.telefono, es_otra_persona: !!p.es_otra_persona })), colegio_id: colegioId },
    })
    if (error || !data?.ok) {
      // Si un lote falla sin respuesta no sabemos si se creó algo: se detiene todo y se avisa.
      const motivo = error ? await mensajeDeError(error) : (data?.error || 'Respuesta inesperada')
      lote.forEach(p => res.errores.push({ fila: p.fila, nombre: p.nombre,
        reason: `${motivo}. Revisa la lista de Profesores antes de reintentar.` }))
      res.interrumpido = true
      break
    }
    res.datos_creados.push(...data.datos_creados)
    ;(data.advertencias || []).forEach(a => res.advertencias.push(a))
    ;(data.repetidos || []).forEach(e => {
      const p = lote[(e.row ?? 1) - 1]
      res.repetidos.push({ ...e, fila: p?.fila ?? '—', nombre: e.nombre || p?.nombre })
    })
    ;(data.errores || []).forEach(e => {
      const p = lote[(e.row ?? 1) - 1]
      res.errores.push({ ...e, fila: p?.fila ?? '—', nombre: e.nombre || p?.nombre })
    })
  }
  return res
}

// ─────────────────────────────────────────────────────────
// Descargas
// ─────────────────────────────────────────────────────────
export function descargarCredencialesProfesores(creados, nombreArchivo = 'credenciales_profesores.xlsx') {
  const XLSX = window.XLSX
  const hoja = XLSX.utils.json_to_sheet(creados.map(r => ({
    'Nombre': r.nombre, 'Correo (usuario)': r.email, 'Contraseña temporal': r.password, 'Teléfono': r.telefono ?? '',
  })))
  hoja['!cols'] = [{ wch: 30 }, { wch: 34 }, { wch: 20 }, { wch: 14 }]
  const instr = XLSX.utils.aoa_to_sheet([
    ['Instrucciones para el profesor'],
    ['1. Ingresa con tu correo y la contraseña temporal de esta hoja.'],
    ['2. Cambia tu contraseña desde tu panel apenas ingreses.'],
    ['3. Este archivo contiene contraseñas: entrégalo solo a cada profesor y bórralo después.'],
  ])
  instr['!cols'] = [{ wch: 90 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, hoja, 'Profesores')
  XLSX.utils.book_append_sheet(wb, instr, 'Instrucciones')
  XLSX.writeFile(wb, nombreArchivo)
}

export function descargarPlantillaProfesores() {
  const XLSX = window.XLSX
  const hoja = XLSX.utils.aoa_to_sheet([['Nombre completo', 'Teléfono']])   // solo encabezados: sin filas de ejemplo que se puedan importar por error
  hoja['!cols'] = [{ wch: 36 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, hoja, 'Profesores')
  XLSX.writeFile(wb, 'plantilla_profesores.xlsx')
}

// ─────────────────────────────────────────────────────────
// Ventana de importación
// ─────────────────────────────────────────────────────────
export function mostrarWidgetImportacionProfesores(colegioId) {
  const modalId = 'modal-importacion-profesores'
  document.getElementById(modalId)?.remove()
  const modal = document.createElement('div')
  modal.id = modalId
  modal.className = 'modal-overlay hidden'
  modal.innerHTML = `
    <div class="modal-box" style="max-width:580px;">
      <div class="modal-header">
        <h2>Importar profesores</h2>
        <button class="btn-close-modal" data-cerrar>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Archivo Excel (.xlsx)</label>
          <input type="file" id="imp-prof-archivo" accept=".xlsx,.xls">
          <small style="color:var(--color-text-3);display:block;line-height:1.5;">
            <b>Nombre completo</b> (obligatoria): apellidos y nombres en una sola celda, <b>apellidos primero</b>, como en el SIE. Ejemplo: <i>USCAMAYTA RAMOS JUAN DAVID</i>.<br>
            <b>Teléfono</b> (opcional). Las demás columnas se ignoran.<br>
            Antes de crear, el sistema le muestra quiénes ya existen en el colegio para no duplicar cuentas.
            <a href="#" id="imp-prof-plantilla">Descargar plantilla</a></small>
        </div>
        <div style="margin-top:10px;padding:10px;background:#fef3c7;border-radius:8px;font-size:12.5px;color:#92400e;">
          ⚠ Se descargará un Excel con las <b>contraseñas temporales</b>. Es la única vez que se muestran: guárdalo y entrégalo a cada profesor.
        </div>
        <div id="imp-prof-previa" class="hidden" style="margin-top:16px;"></div>
        <div id="imp-prof-resumen" class="hidden" style="margin-top:16px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-cerrar>Cerrar</button>
        <button id="imp-prof-btn" class="btn btn-primary">Importar</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => modal.remove())

  const input = modal.querySelector('#imp-prof-archivo')
  const btn = modal.querySelector('#imp-prof-btn')
  const resumen = modal.querySelector('#imp-prof-resumen')
  const previa = modal.querySelector('#imp-prof-previa')
  let lectura = null                                        // { profesores, errores, repetidos: Set(fila) }
  modal.querySelector('#imp-prof-plantilla').onclick = (e) => { e.preventDefault(); descargarPlantillaProfesores() }
  const reiniciar = () => { lectura = null; btn.disabled = false; btn.textContent = 'Revisar archivo'; resumen.classList.add('hidden'); previa.classList.add('hidden') }
  input.onchange = reiniciar
  btn.textContent = 'Revisar archivo'

  btn.onclick = async () => {
    if (!lectura) return revisar()
    return crear()
  }

  // Paso 1: leer el Excel y comparar con los profesores del colegio (no crea nada)
  async function revisar() {
    const archivo = input.files[0]
    if (!archivo) { toast('Selecciona un archivo Excel', 'warning'); return }
    btn.disabled = true
    mostrarLoader('Revisando el archivo...')
    try {
      const { profesores, errores } = await parseExcelProfesores(archivo)
      const { data: ya } = await supabase.from('usuarios').select('nombre_completo, email')
        .eq('colegio_id', colegioId).eq('rol', 'profesor')
      const existentes = new Map((ya ?? []).map(u => [claveNombre(u.nombre_completo), u.email ?? '']))
      const vistos = new Map()
      profesores.forEach(p => {
        const k = claveNombre(p.nombre)
        if (existentes.has(k)) p.repetido = `Ya existe en el colegio (${existentes.get(k)})`
        else if (vistos.has(k)) p.repetido = `Aparece también en la fila ${vistos.get(k)} del archivo`
        if (!vistos.has(k)) vistos.set(k, p.fila)
      })
      lectura = { profesores, errores }
      pintarPrevia()
    } catch (err) {
      toast(err.message, 'error'); btn.disabled = false
    } finally { ocultarLoader() }
  }

  function pintarPrevia() {
    const nuevos = lectura.profesores.filter(p => !p.repetido)
    const rep = lectura.profesores.filter(p => p.repetido)
    const caja = (titulo, color, cuerpo) => `<div style="margin-bottom:10px;padding:10px;border-radius:8px;background:${color};">
      <b style="font-size:13px;">${titulo}</b>${cuerpo}</div>`
    const lista = (arr, fmt) => arr.length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;max-height:140px;overflow-y:auto;">${arr.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : ''
    previa.innerHTML =
      caja(`✅ Nuevos: ${nuevos.length}`, '#dcfce7', lista(nuevos, p => `Fila ${p.fila}: ${escapeHtml(p.nombre)}`)) +
      (rep.length ? caja(`⚠️ Posibles repetidos: ${rep.length} — no se crearán, salvo que marque "Es otra persona"`, '#fef3c7',
        `<div style="font-size:12.5px;margin-top:6px;display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">${rep.map(p => `
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin:0;">
            <input type="checkbox" data-otra="${p.fila}" style="width:auto;margin-top:2px;">
            <span><b>Fila ${p.fila}: ${escapeHtml(p.nombre)}</b><br><span style="color:#92400e;">${escapeHtml(p.repetido)}. Marque solo si es otra persona con el mismo nombre.</span></span>
          </label>`).join('')}</div>`) : '') +
      (lectura.errores.length ? caja(`❌ Con error: ${lectura.errores.length} — se omitirán`, '#fee2e2',
        lista(lectura.errores, e => `Fila ${e.fila}: ${escapeHtml(e.nombre || '(sin nombre)')} — ${escapeHtml(e.razon)}`)) : '')
    previa.classList.remove('hidden')
    previa.querySelectorAll('[data-otra]').forEach(c => c.onchange = actualizarBoton)
    actualizarBoton()
  }

  function aCrear() {
    const marcados = new Set([...previa.querySelectorAll('[data-otra]:checked')].map(c => Number(c.dataset.otra)))
    return lectura.profesores
      .filter(p => !p.repetido || marcados.has(p.fila))
      .map(p => ({ ...p, es_otra_persona: !!p.repetido && marcados.has(p.fila) }))
  }
  function actualizarBoton() {
    const n = aCrear().length
    btn.textContent = n ? `Crear ${n} profesor${n !== 1 ? 'es' : ''}` : 'Nada para crear'
    btn.disabled = n === 0
  }

  // Paso 2: crear (el servidor vuelve a controlar los repetidos)
  async function crear() {
    const lote = aCrear()
    if (!lote.length) return
    const omitidos = lectura.profesores.length - lote.length
    const ok = await confirmar('Crear profesores',
      `Se crearán ${lote.length} cuenta${lote.length !== 1 ? 's' : ''} de profesor.` +
      (omitidos ? ` ${omitidos} posible${omitidos !== 1 ? 's' : ''} repetido${omitidos !== 1 ? 's' : ''} no se crearán.` : '') +
      (lectura.errores.length ? ` ${lectura.errores.length} fila${lectura.errores.length !== 1 ? 's' : ''} con error se omitirán.` : '') + ' ¿Continuar?')
    if (!ok) return
    btn.disabled = true                                     // evita doble clic = cuentas duplicadas
    mostrarLoader('Creando profesores...')
    try {
      const res = await importarProfesoresMasivo(lote, colegioId,
        (hasta, total) => mostrarLoader(`Creando profesores (${hasta}/${total})...`))
      lectura.errores.forEach(e => res.errores.push({ fila: e.fila, nombre: e.nombre, reason: e.razon }))
      ocultarLoader()
      previa.classList.add('hidden')
      mostrarResumen(resumen, res)
      btn.textContent = 'Listo'
      if (res.datos_creados.length) {
        descargarCredencialesProfesores(res.datos_creados)
        toast(`${res.datos_creados.length} profesor(es) creado(s). Se descargó el Excel de credenciales.`, 'success')
        if (typeof window.cargarProfesores === 'function') window.cargarProfesores()
        if (typeof window.cargarEstadisticasInicio === 'function') window.cargarEstadisticasInicio()
      } else toast('No se creó ningún profesor. Revisa el resumen.', 'warning')
    } catch (err) {
      toast(err.message, 'error'); console.error('Error importando profesores:', err); btn.disabled = false
    } finally { ocultarLoader() }
  }
  modal.classList.remove('hidden')
}

function mostrarResumen(el, res) {
  const lista = (arr, fmt) => arr.length
    ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;">${arr.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : ''
  const rep = res.repetidos ?? []
  let html = `<p style="margin:0 0 6px;"><b style="color:#166534;">✅ Creados: ${res.datos_creados.length}</b> &nbsp; <b style="color:${res.errores.length ? '#991b1b' : '#374151'};">❌ Con error: ${res.errores.length}</b>${rep.length ? ` &nbsp; <b style="color:#92400e;">⚠️ Repetidos no creados: ${rep.length}</b>` : ''}</p>`
  if (res.interrumpido) html += `<p style="margin:6px 0;padding:8px;background:#fee2e2;border-radius:8px;color:#7f1d1d;font-size:12.5px;"><b>La importación se interrumpió.</b> Revisa la lista de Profesores antes de volver a subir el archivo, para no duplicar cuentas.</p>`
  const huerfanas = res.errores.filter(e => e.cuenta_huerfana)
  if (huerfanas.length) html += `<p style="margin:6px 0;padding:8px;background:#fee2e2;border-radius:8px;color:#7f1d1d;font-size:12.5px;"><b>Atención:</b> ${huerfanas.length} cuenta(s) quedaron a medias y deben revisarse con el superadmin: ${huerfanas.map(h => escapeHtml(h.email || h.nombre)).join(', ')}.</p>`
  html += lista(res.errores, e => `<b>Fila ${escapeHtml(e.fila)}</b> ${escapeHtml(e.nombre ?? '')}: ${escapeHtml(e.reason)}`)
  if (rep.length) html += `<p style="margin:10px 0 0;font-size:12.5px;color:#92400e;"><b>Repetidos (no se crearon):</b></p>` + lista(rep, e => `<b>Fila ${escapeHtml(e.fila)}</b> ${escapeHtml(e.nombre ?? '')}: ${escapeHtml(e.reason)}`)
  if (res.advertencias.length) html += `<p style="margin:10px 0 0;font-size:12.5px;color:#92400e;"><b>Avisos:</b></p>` + lista(res.advertencias, a => escapeHtml(a))
  el.innerHTML = html
  el.classList.remove('hidden')
}