// js/profesor/asesor-curso.js
// Panel del ASESOR DE CURSO (profesor designado por el director para un curso en la gestión).
// TODO es de solo lectura y sale de funciones seguras del servidor (migración 079):
//   · Notas: nota final por materia y trimestre + anual, sin actividades ni comentarios,
//            indicando qué dimensiones (Hacer/Saber/Ser/Decidir) ya están calificadas.
//   · Asistencia: grilla del curso completo (todas las materias), solo lectura.
//   · Libretas: individual o ZIP de todo el curso.
// Si la migración no está aplicada o el profesor no es asesor, la sección no aparece.
import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader } from '../utils/ui.js'
import { paginar } from '../utils/paginar.js'
import { escapeHtml } from '../utils/sanitize.js'
import { normalizarFilas, estadoTrimestre, promedioAnual, armarMatriz, promedioSimple, esAlerta, notaOficial, fmtNota, tituloExacto, trimestreCerrado, NOMBRES_DIM } from '../utils/estado-notas.js'
import { MESES, LETRA, pad, rangoMes, htmlBarraMes, htmlGrilla, htmlDetalleMarca, exportarGrillaExcel, limpiarNombreArchivo } from '../utils/grilla-asistencia.js'
import { cargarDatosLibretas, descargarLibretaEstudiante, descargarLibretasCurso } from '../utils/libretas-curso.js'

const IDS = { titulo: 'as-titulo', mes: 'as-mes', resultado: 'as-resultado', detalle: 'as-detalle' }
const COLOR = {
  'parcial-bajo': ['#fee2e2', '#b91c1c'],
  'en-curso': ['#fef3c7', '#92400e'], 'en-riesgo': ['#fee2e2', '#b91c1c'],
  aprobado: ['#dcfce7', '#166534'], reprobado: ['#fecaca', '#7f1d1d'],
  parcial: ['#e0e7ff', '#3730a3'], 'sin-calificar': ['#f1f5f9', '#64748b'],
}

let _curso = null            // { curso_id, curso_nombre, anio }
let _tab = 'notas'
let _notas = null            // { filas, matriz, estudiantes, hora }
let _tri = 'anual'           // 1..N | 'anual'
let _filtro = ''
let _mes = new Date().getMonth()
let _anio = new Date().getFullYear()
let _asist = null            // { estudiantes, fechas, celdas }
let _libr = null             // datos cacheados para libretas

const ctx = () => ({
  trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada, notaMinima: Config.notaMinima,
  etiqAprobado: Config.etiqAprobado, etiqReprobado: Config.etiqReprobado,
  numPeriodos: Config.periodos.length,
})
const numPeriodos = () => Config.periodos.length
const raiz = () => document.getElementById('asesor-curso-contenido')

/** Se llama al iniciar el panel. Muestra el menú solo si el profesor es asesor. */
export async function iniciarAsesorCurso(perfil) {
  try {
    const { data, error } = await supabase.rpc('mi_asesoria_curso')
    if (error) return // migración no aplicada u otro error: la función queda oculta
    if (!data?.length) return
    const d = data[0]
    _curso = { curso_id: d.curso_id, curso_nombre: d.curso, nivel: d.nivel, grado: d.grado, anio: d['año'] }
    document.getElementById('nav-asesor-curso')?.classList.remove('hidden')
  } catch { /* sin asesoría */ }
}

window.cargarAsesorCurso = function () {
  const r = raiz(); if (!r || !_curso) return
  r.innerHTML = `
    <div class="card" style="padding:14px 18px;margin-bottom:14px;">
      <div style="font-size:1.1rem;font-weight:700;">Asesor del curso ${escapeHtml(_curso.curso_nombre)}</div>
      <div class="text-sm text-muted">Gestión ${_curso.anio} · Vista de solo lectura: no puedes modificar notas ni asistencia.</div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      ${[['notas', '📊 Notas'], ['asistencia', '🗓️ Asistencia'], ['libretas', '📄 Libretas']].map(([k, t]) =>
        `<button type="button" class="btn ${k === _tab ? 'btn-primary' : 'btn-secondary'}" onclick="window._asTab('${k}')">${t}</button>`).join('')}
    </div>
    <div id="asesor-tab"></div>`
  window._asTab(_tab)
}

window._asTab = function (t) {
  _tab = t
  raiz()?.querySelectorAll(':scope > div:nth-child(2) button').forEach((b, i) => {
    const activo = ['notas', 'asistencia', 'libretas'][i] === t
    b.className = `btn ${activo ? 'btn-primary' : 'btn-secondary'}`
  })
  if (t === 'notas') _tabNotas()
  else if (t === 'asistencia') _tabAsistencia()
  else _tabLibretas()
}

// ─── NOTAS ───────────────────────────────────────────────
async function _tabNotas() {
  const cont = document.getElementById('asesor-tab'); if (!cont) return
  cont.innerHTML = '<div class="text-muted">Cargando…</div>'
  mostrarLoader('Cargando notas del curso...')
  try {
    const [datos, rNotas] = await Promise.all([
      cargarDatosLibretas(_curso.curso_id), // lista de estudiantes activos del curso
      paginar(() => supabase.rpc('asesor_notas_curso', { p_curso_id: _curso.curso_id }), ['estudiante_id', 'materia_id', 'trimestre']),
    ])
    if (rNotas.error) throw rNotas.error
    const filas = normalizarFilas(rNotas.data ?? [], _curso)
    const estudiantes = datos.estudiantes.map(e => ({ estudiante_id: e.id, nombre: e.nombre_completo, carnet: e.carnet }))
    _libr = datos
    _notas = { filas, matriz: armarMatriz(filas), estudiantes, hora: new Date() }
    _pintarNotas()
  } catch (err) {
    console.error(err)
    toast(err.message ?? 'No se pudieron cargar las notas', 'error')
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-title">Error al cargar</div></div>'
  } finally { ocultarLoader() }
}

window._asTri = function (v) { _tri = v === 'anual' ? 'anual' : Number(v); _pintarNotas() }
window._asBuscar = function (v) { _filtro = v ?? ''; _pintarNotas(true) }

function _celda(est, f) {
  const e = estadoTrimestre(f, ctx())
  const [bg, fg] = e.completa && e.clave === 'en-curso' ? COLOR.aprobado : COLOR[e.clave]
  if (e.clave === 'sin-calificar') return _celdaVacia('Sin notas registradas en el sistema')
  const abierto = (e.clave === 'en-curso' || e.clave === 'en-riesgo') && !e.completa
  // Trimestre abierto con avance: se muestra HACER+SABER. Cerrado o con las 4 dimensiones calificadas: nota completa.
  const exacta = abierto && e.hs != null ? e.hs : e.nota
  const valor = abierto && e.hs != null ? `H+S ${fmtNota(e.hs)}` : fmtNota(e.nota)
  const falta = abierto && e.pendientes.length
    ? `<div style="font-size:10px;font-weight:400;" title="Dimensiones aún sin calificar">Falta: ${e.pendientes.join('·')}</div>` : ''
  return `<td style="padding:4px;text-align:center;border-left:1px solid var(--color-border);background:${bg};color:${fg};font-weight:700;" title="${tituloExacto(exacta)}">${valor}<div style="font-size:10px;font-weight:600;">${escapeHtml(e.texto)}</div>${falta}</td>`
}

// El servidor solo devuelve una materia técnica a quien la tiene inscrita. Si el estudiante tiene
// notas de otras materias pero ninguna fila de esta, es que no está inscrito en esa especialidad.
function _celdaSinInscripcion() {
  return '<td style="padding:4px;text-align:center;border-left:1px solid var(--color-border);font-size:10px;color:#94a3b8;" title="El estudiante no tiene esta especialidad inscrita en el sistema">Sin inscr.</td>'
}

// Sin notas: un guion tenue sin fondo, para que resalte lo que sí tiene nota y se vea el intercalado
function _celdaVacia(titulo) {
  return `<td style="padding:4px;text-align:center;border-left:1px solid var(--color-border);color:var(--color-text-3);opacity:.55;" title="${escapeHtml(titulo)}">—</td>`
}

function _celdaAnual(porTri) {
  const a = promedioAnual(porTri, ctx())
  const [bg, fg] = COLOR[a.clave === 'parcial' && a.bajo ? 'parcial-bajo' : a.clave]
  if (a.clave === 'sin-calificar') return _celdaVacia('Sin notas registradas en el sistema')
  if (a.promedio == null) return `<td style="padding:4px;text-align:center;border-left:1px solid var(--color-border);background:${bg};color:${fg};font-size:11px;" title="${escapeHtml(a.detalle)}">${escapeHtml(a.texto)}</td>`
  // El detalle (trimestres usados) queda al pasar el mouse: filas más bajas
  return `<td style="padding:4px;text-align:center;border-left:1px solid var(--color-border);background:${bg};color:${fg};font-weight:700;" title="${tituloExacto(a.promedioExacto)} · ${escapeHtml(a.detalle)}">${fmtNota(a.promedio)}<div style="font-size:10px;font-weight:600;">${escapeHtml(a.texto)}</div></td>`
}

function _pintarNotas(soloTabla = false) {
  const cont = document.getElementById('asesor-tab'); if (!cont || !_notas) return
  const { matriz, estudiantes, hora } = _notas
  const q = _filtro.trim().toLowerCase()
  const lista = estudiantes.filter(e => !q || e.nombre.toLowerCase().includes(q))
  const n = numPeriodos()
  const hh = `${pad(hora.getHours())}:${pad(hora.getMinutes())}`

  // Cabecera fija al bajar (sticky top) y nombres de materia en vertical, hasta 2 columnas de texto
  const TH = 'position:sticky;top:0;z-index:2;background:var(--color-primary);color:#fff;border-left:1px solid rgba(255,255,255,.25);'
  const encabezado = `<th style="${TH}left:0;z-index:3;padding:6px 8px;text-align:left;vertical-align:bottom;">Estudiante</th>` +
    matriz.materias.map(m => `<th class="as-mat" style="${TH}padding:6px 4px;vertical-align:bottom;min-width:64px;" title="${escapeHtml(m.nombre)}">
      <div style="writing-mode:vertical-rl;transform:rotate(180deg);height:110px;margin:0 auto;white-space:normal;line-height:1.1;font-size:10.5px;font-weight:700;text-align:left;overflow:hidden;">${escapeHtml(m.nombre)}</div></th>`).join('') +
    `<th style="${TH}padding:6px 8px;vertical-align:bottom;border-left:3px solid #fff;">Promedio</th>`

  let _conAlerta = 0
  const cuerpo = lista.map((e, i) => {
    const mats = matriz.porEstudiante[e.estudiante_id] ?? {}
    const tieneNotas = Object.keys(mats).length > 0
    const celdas = matriz.materias.map(m => {
      if (!mats[m.id] && tieneNotas) return _celdaSinInscripcion()
      const porTri = mats[m.id] ?? {}
      return _tri === 'anual' ? _celdaAnual(porTri) : _celda(e, porTri[_tri])
    }).join('')
    const valores = matriz.materias.map(m => {
      const porTri = mats[m.id] ?? {}
      if (_tri === 'anual') return promedioAnual(porTri, ctx()).promedio
      return porTri[_tri]?.nota_final ?? null
    })
    const prom = notaOficial(promedioSimple(valores.map(notaOficial)))
    const alertas = matriz.materias.filter(m => {
      const porTri = mats[m.id] ?? {}
      return esAlerta(_tri === 'anual' ? promedioAnual(porTri, ctx()) : estadoTrimestre(porTri[_tri], ctx()))
    }).length
    if (alertas) _conAlerta++
    const fondo = i % 2 ? 'var(--zebra)' : 'var(--color-surface,#fff)'   // intercalado como en todo el sistema
    return `<tr class="as-fila" onclick="this.classList.toggle('as-sel')" style="background:${fondo};">
      <td class="as-nombre" style="padding:6px 8px;white-space:nowrap;font-weight:600;position:sticky;left:0;z-index:1;background:${fondo};border-bottom:1px solid var(--color-border);">${i + 1}. ${escapeHtml(e.nombre)}</td>
      ${celdas}
      <td style="padding:4px 8px;text-align:center;font-weight:800;font-size:14px;border-left:3px solid var(--color-primary);background:color-mix(in srgb, var(--color-primary) 8%, var(--color-surface,#fff));color:${prom != null && prom < Config.notaMinima ? '#b91c1c' : 'var(--color-text)'};">${fmtNota(prom)}</td></tr>`
  }).join('')

  const tabla = `
    <style>
      .as-fila:hover td, .as-fila.as-sel td { box-shadow: inset 0 0 0 9999px rgba(0,0,0,.07); }
      .as-fila.as-sel td:first-child { box-shadow: inset 4px 0 0 var(--color-primary), inset 0 0 0 9999px rgba(0,0,0,.07); }
      .as-fila { cursor: pointer; }
      /* Celular: nombre en 2 líneas y columnas más angostas (en PC no cambia) */
      @media (max-width: 640px) {
        .as-nombre { white-space: normal !important; min-width: 130px; max-width: 130px; font-size: 11.5px; line-height: 1.25; padding: 4px 6px !important; }
        .as-mat { min-width: 50px !important; }
        .as-fila td { font-size: 12px; }
      }
    </style>
    <div style="overflow:auto;max-height:75vh;border:1px solid var(--color-border);border-radius:10px;">
      <table style="border-collapse:separate;border-spacing:0;width:100%;font-size:13px;">
        <thead><tr style="background:var(--color-surface-2,#f8fafc);">${encabezado}</tr></thead>
        <tbody>${cuerpo || '<tr><td style="padding:16px;" class="text-muted">Sin estudiantes</td></tr>'}</tbody>
      </table>
    </div>`

  const resumen = `<div style="font-size:13px;margin-bottom:8px;"><strong style="color:#b91c1c;">${_conAlerta}</strong> de ${lista.length} estudiantes con al menos una materia en <span style="background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:6px;font-weight:700;">En riesgo</span>, <span style="background:#fecaca;color:#7f1d1d;padding:1px 6px;border-radius:6px;font-weight:700;">Reprobado</span> o bajo ${Config.notaMinima} con datos parciales.</div>`
  if (soloTabla && document.getElementById('as-tabla')) { document.getElementById('as-tabla').innerHTML = resumen + tabla; return }

  const opciones = [...Array(n)].map((_, i) => `<option value="${i + 1}" ${_tri === i + 1 ? 'selected' : ''}>${escapeHtml(Config.periodos[i]?.nombre ?? `Trimestre ${i + 1}`)}</option>`).join('')
  cont.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select onchange="window._asTri(this.value)" style="width:auto;">${opciones}<option value="anual" ${_tri === 'anual' ? 'selected' : ''}>Anual</option></select>
        <input type="search" placeholder="Buscar estudiante..." value="${escapeHtml(_filtro)}" oninput="window._asBuscar(this.value)" style="width:200px;">
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <select id="as-pdf-formato" style="width:auto;" title="Tamaño de hoja">
          <option value="carta">Carta</option><option value="oficio">Oficio</option>
        </select>
        <button type="button" class="btn btn-primary btn-sm" onclick="window._asPdfNotas()">Imprimir PDF</button>
        <span class="text-sm text-muted">Actualizado a las ${hh} · <button type="button" class="btn btn-secondary btn-sm" onclick="window._asRecargarNotas()">↻ Actualizar</button></span>
      </div>
    </div>
    ${_htmlEstadoSie()}
    <details class="card" ${window.innerWidth > 640 ? 'open' : ''} style="padding:10px 14px;margin-bottom:10px;background:#fffbeb;border:1px solid #fde68a;font-size:13px;">
      <summary style="cursor:pointer;font-weight:700;">Cómo leer esta tabla</summary>
      <br>• <strong>Trimestre abierto:</strong> se muestra HACER+SABER (H+S), que es lo calificado objetivamente.
      Si es menor a ${Config.notaMinima} aparece <span style="background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:6px;font-weight:700;">En riesgo</span>;
      si no, <span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:6px;font-weight:700;">En curso</span>.
      Si todavía falta calificar HACER o SABER, aparece "En curso (falta …)". SER y DECIDIR se suman al cierre, salvo que ya estén calificados: entonces se muestra la nota completa ("Completa").
      <br>• <strong>Trimestre cerrado:</strong> nota completa, Aprobado o Reprobado.
      <br>• <strong>Anual:</strong> promedio de los trimestres que tienen notas en el sistema (se indica cuáles). "Sin notas" nunca cuenta como cero.
      <br><em>Sin inscripción</em> indica una especialidad técnica en la que el estudiante no está inscrito.
    </details>
    <div id="as-tabla">${resumen}${tabla}</div>`
}
window._asRecargarNotas = function () { _tabNotas() }

// PDF horizontal con todas las materias (materias en vertical). Módulo aparte, se carga solo al usarlo.
window._asPdfNotas = async function () {
  if (!_notas) return
  const formato = document.getElementById('as-pdf-formato')?.value ?? 'carta'
  mostrarLoader('Generando PDF...')
  try {
    const { pdfNotasAsesor } = await import('../utils/pdf-asesor-notas.js')
    await pdfNotasAsesor({
      curso: _curso, tri: _tri, matriz: _notas.matriz, estudiantes: _notas.estudiantes, ctx: ctx(),
      nombrePeriodo: _tri === 'anual' ? 'Anual' : (Config.periodos[_tri - 1]?.nombre ?? `Trimestre ${_tri}`),
      notaMinima: Config.notaMinima, formato, asesor: window._profesorPerfil?.nombre_completo ?? '',
    })
  } catch (e) { console.error(e); toast(e.message ?? 'No se pudo generar el PDF', 'error') }
  finally { ocultarLoader() }
}

// ─── ESTADO PARA EL SIE ──────────────────────────────────
// Un trimestre está "listo para el SIE" solo si está CERRADO y TODOS los estudiantes tienen
// nota final en TODAS sus materias (las técnicas no inscritas no cuentan). Es solo informativo.
function _htmlEstadoSie() {
  const { matriz, estudiantes } = _notas
  const n = numPeriodos()
  const totMat = matriz.materias.length
  const DIM = { hacer_calificado: 'Hacer', saber_calificado: 'Saber', ser_calificado: 'Ser', decidir_calificado: 'Autoevaluación' }
  const lineas = []
  for (let t = 1; t <= n; t++) {
    const nombreT = escapeHtml(Config.periodos[t - 1]?.nombre ?? `Trimestre ${t}`)
    const cerrado = trimestreCerrado(t, ctx())
    if (!cerrado && t !== Number(Config.trimestreActivo)) continue      // trimestres futuros
    // Por materia: ¿alguien tiene nota? ¿qué dimensiones faltan a alguien?
    const info = new Map(matriz.materias.map(m => [m.id, { nombre: m.nombre, conNota: false, sinNota: 0, faltaDim: new Set(), estFalta: 0 }]))
    for (const e of estudiantes) {
      const mats = matriz.porEstudiante[e.estudiante_id] ?? {}
      const tieneNotas = Object.keys(mats).length > 0
      for (const m of matriz.materias) {
        if (!mats[m.id] && tieneNotas) continue          // técnica no inscrita
        const f = mats[m.id]?.[t], x = info.get(m.id)
        if (f?.nota_final == null) { x.sinNota++; continue }
        x.conNota = true
        let falta = false
        for (const [k, nom] of Object.entries(DIM)) if (!f[k]) { x.faltaDim.add(nom); falta = true }
        if (falta) x.estFalta++
      }
    }
    const lista = [...info.values()]
    const completas = lista.filter(x => x.conNota && !x.sinNota && !x.faltaDim.size)
    const sinNotas  = lista.filter(x => !x.conNota)
    const parciales = lista.filter(x => x.conNota && (x.sinNota || x.faltaDim.size))
    const nombres = arr => arr.map(x => escapeHtml(x.nombre)).join(', ')

    if (!cerrado) {                         // trimestre en curso (el activo)
      const nCon = totMat - sinNotas.length
      if (!nCon) lineas.push(`<div>⏳ <b>${nombreT}:</b> en curso · aún sin notas en ninguna materia</div>`)
      else if (nCon < totMat) lineas.push(`<div>⏳ <b>${nombreT}:</b> en curso · ${nCon} de ${totMat} materias con notas: ${nombres(lista.filter(x => x.conNota))}</div>`)
      else lineas.push(`<div>⏳ <b>${nombreT}:</b> en curso · todas las materias con notas · se completa al cierre (Ser y Autoevaluación)</div>`)
      continue
    }
    if (completas.length === totMat && totMat) {
      lineas.push(`<div style="color:#166534;">✓ <b>${nombreT}:</b> listo para el SIE · ${totMat} materias con sus 4 dimensiones</div>`)
      continue
    }
    if (sinNotas.length === totMat) {
      lineas.push(`<div>⚠️ <b>${nombreT}:</b> sin notas en el sistema · no listo para el SIE</div>`)
      continue
    }
    const partes = []
    // Materias con notas incompletas: cuántos estudiantes y qué les falta (dato real por estudiante)
    for (const x of parciales) {
      const det = []
      if (x.estFalta) det.push(`${x.estFalta} estudiante${x.estFalta !== 1 ? 's' : ''} sin ${[...x.faltaDim].join('/')}`)
      if (x.sinNota) det.push(`${x.sinNota} sin nota`)
      partes.push(`${escapeHtml(x.nombre)}: ${det.join(', ')}`)
    }
    if (sinNotas.length) partes.push(sinNotas.length <= 3 ? `sin notas: ${nombres(sinNotas)}` : `${sinNotas.length} materias sin notas`)
        const listaOk = completas.length ? ` (✓ ${nombres(completas)})` : ''
    lineas.push(`<div style="color:#b45309;">⚠️ <b>${nombreT}:</b> no listo · ${completas.length} de ${totMat} materias completas${listaOk} · ${partes.join(' · ')}</div>`)
  }
  if (!lineas.length) return ''
  return `<div class="card" style="padding:10px 14px;margin-bottom:10px;font-size:13px;line-height:1.6;">
    <div style="font-weight:700;margin-bottom:2px;">Estado para el SIE</div>${lineas.join('')}
    <div class="text-sm text-muted" style="margin-top:2px;">Listo para el SIE = trimestre cerrado con Hacer, Saber, Ser y Autoevaluación en todas las materias.</div></div>`
}

// ─── ASISTENCIA (solo lectura, curso completo) ───────────
const PRIORIDAD = { F: 4, L: 3, R: 2, P: 1 }

async function _tabAsistencia() {
  const cont = document.getElementById('asesor-tab'); if (!cont) return
  _filtro = ''
  cont.innerHTML = htmlBarraMes({
    anio: _anio, mes: _mes, ids: IDS,
    fn: { nav: 'window._asMesNav', ir: 'window._asMesIr', buscar: 'window._asAsistBuscar', exportar: 'window._asAsistExportar' },
  })
  await _cargarAsistencia()
}
window._asMesNav = function (d) { _mes += d; if (_mes < 0) { _mes = 11; _anio-- } if (_mes > 11) { _mes = 0; _anio++ } _cargarAsistencia() }
window._asMesIr = function (v) { const [y, m] = String(v).split('-').map(Number); if (!y || !m) return; _anio = y; _mes = m - 1; _cargarAsistencia() }
window._asAsistBuscar = function (v) { _filtro = v ?? ''; _pintarAsistencia() }
window._asAsistDetalle = function (estId, fecha) {
  const det = document.getElementById(IDS.detalle); if (!det || !_asist) return
  det.innerHTML = htmlDetalleMarca(_asist.estudiantes.find(e => e.id === estId), fecha, _asist.celdas[`${estId}|${fecha}`], 'Sin observación registrada.')
}
window._asAsistExportar = function () {
  if (!_asist?.fechas.length) { toast('No hay datos para exportar', 'warning'); return }
  try {
    exportarGrillaExcel(_asist, {
      titulo: `Asistencia del curso — ${MESES[_mes]} ${_anio}`, subtitulo: _curso.curso_nombre, hoja: MESES[_mes],
      archivo: `asistencia_${limpiarNombreArchivo(_curso.curso_nombre)}_${_anio}-${pad(_mes + 1)}.xlsx`,
    })
  } catch (e) { toast(e.message, 'error') }
}

async function _cargarAsistencia() {
  const mesInput = document.getElementById(IDS.mes); if (mesInput) mesInput.value = `${_anio}-${pad(_mes + 1)}`
  const out = document.getElementById(IDS.resultado); if (!out) return
  const { desde, hasta } = rangoMes(_anio, _mes)
  mostrarLoader('Cargando asistencia...')
  try {
    const { data, error } = await paginar(
      () => supabase.rpc('asesor_asistencia_curso', { p_curso_id: _curso.curso_id, p_desde: desde, p_hasta: hasta }),
      ['fecha', 'estudiante_id', 'sesion'])
    if (error) throw error
    const est = new Map(); const celdas = {}; const fechas = new Set(); const detalles = {}
    for (const r of data ?? []) {
      if (!est.has(r.estudiante_id)) est.set(r.estudiante_id, { id: r.estudiante_id, nombre: r.estudiante })
      if (!r.fecha || !r.estado) continue // alumno sin registros en el mes
      fechas.add(r.fecha)
      const l = LETRA[r.estado] ?? ''
      const k = `${r.estudiante_id}|${r.fecha}`
      const actual = celdas[k]
      const nota = r.materia_excepcion ? `${r.sesion ?? ''}: ${r.estado} (${r.materia_excepcion})` : ''
      ;(detalles[k] ??= []).push(nota || `${r.sesion ?? ''}: ${r.estado}`)
      if (!actual || (PRIORIDAD[l] ?? 0) > (PRIORIDAD[actual.l] ?? 0)) celdas[k] = { l, obs: '' }
    }
    for (const k of Object.keys(celdas)) celdas[k].obs = detalles[k].join(' · ')
    const estudiantes = [...est.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    _asist = { estudiantes, fechas: [...fechas].sort(), celdas }
    _pintarAsistencia()
  } catch (err) {
    console.error(err)
    toast(err.message ?? 'No se pudo cargar la asistencia', 'error')
    out.innerHTML = '<div class="empty-state"><div class="empty-state-title">Error al cargar</div></div>'
  } finally { ocultarLoader() }
}

function _pintarAsistencia() {
  const out = document.getElementById(IDS.resultado); const tit = document.getElementById(IDS.titulo)
  if (!out || !_asist) return
  if (tit) tit.innerHTML = `<div style="font-size:1.1rem;font-weight:700;">Asistencia del curso — ${MESES[_mes]} ${_anio}</div>
    <div class="text-sm text-muted">${escapeHtml(_curso.curso_nombre)} · todas las materias · por día se muestra la marca más relevante (Falta &gt; Licencia &gt; Retraso &gt; Presente)</div>`
  if (!_asist.fechas.length) {
    out.innerHTML = `<div class="empty-state"><div class="empty-state-title">Sin registros en ${MESES[_mes]} ${_anio}</div></div>`; return
  }
  out.innerHTML = htmlGrilla(_asist, { filtro: _filtro, onClick: 'window._asAsistDetalle' })
  const det = document.getElementById(IDS.detalle); if (det) det.innerHTML = ''
}

// ─── LIBRETAS ────────────────────────────────────────────
async function _tabLibretas() {
  _libr = null // siempre datos frescos
  const cont = document.getElementById('asesor-tab'); if (!cont) return
  cont.innerHTML = '<div class="text-muted">Cargando estudiantes…</div>'
  try {
    _libr = _libr ?? await cargarDatosLibretas(_curso.curso_id)
  } catch (err) {
    toast(err.message ?? 'No se pudieron cargar los datos', 'error')
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-title">Error al cargar</div></div>'; return
  }
  const filas = _libr.estudiantes.map((e, i) => `<tr>
    <td style="padding:6px 8px;">${i + 1}</td><td style="padding:6px 8px;">${escapeHtml(e.nombre_completo)}</td>
    <td style="padding:6px 8px;">${escapeHtml(e.carnet ?? '')}</td>
    <td style="padding:6px 8px;text-align:right;"><button type="button" class="btn btn-secondary btn-sm" data-id="${escapeHtml(e.id)}" onclick="window._asLibreta(this.dataset.id)">📄 PDF</button></td></tr>`).join('')
  cont.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div class="text-sm text-muted">${_libr.estudiantes.length} estudiantes · la libreta muestra los trimestres con notas y marca el promedio "En curso" mientras falten.</div>
      <button type="button" id="as-zip" class="btn btn-primary" onclick="window._asLibretasZip()">⬇️ Todas las libretas (ZIP)</button>
    </div>
    <div class="card" style="padding:0;"><div class="table-wrapper"><table style="width:100%;font-size:13px;">
      <thead><tr><th style="padding:6px 8px;">#</th><th style="padding:6px 8px;text-align:left;">Estudiante</th><th style="padding:6px 8px;text-align:left;">Carnet</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div></div>`
}

window._asLibreta = async function (id) {
  mostrarLoader('Generando libreta...')
  try { await descargarLibretaEstudiante(_curso.curso_id, id, _libr) }
  catch (e) { toast(e.message ?? 'No se pudo generar la libreta', 'error') }
  finally { ocultarLoader() }
}

window._asLibretasZip = async function () {
  const btn = document.getElementById('as-zip'); const txt = btn?.textContent
  if (btn) btn.disabled = true
  try {
    await descargarLibretasCurso(_curso.curso_id, (h, t) => { if (btn) btn.textContent = `Generando ${h} de ${t}…` }, _libr)
    toast('ZIP generado', 'success')
  } catch (e) { toast(e.message ?? 'No se pudo generar el ZIP', 'error') }
  finally { if (btn) { btn.disabled = false; btn.textContent = txt } }
}

export { NOMBRES_DIM }