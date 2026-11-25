// js/utils/centralizador-anual.js
// BOLETÍN CENTRALIZADOR DE NOTAS (PDF) — un curso + una materia con los
// trimestres en columnas: cualitativo + cuantitativo por trimestre, promedio
// anual, promedio literal y situación del estudiante, más un gráfico de
// aprobados/reprobados por trimestre.
//
// Es PROGRESIVO: cada trimestre que ya tiene notas aparece llenándose
// (1er trim → 1er+2do → 3 trimestres); los que aún no tienen notas quedan vacíos.
// Observación del director: antes solo se podía ver un trimestre a la vez.
//
// Reutiliza calcularPromedioAnualLote() (misma regla que "Promedio Anual":
// promedio = suma de trimestres con nota ÷ cantidad de trimestres con nota;
// la situación solo es definitiva con todos los trimestres cargados).
import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader } from './ui.js'
import { calcularPromedioAnualLote } from './promedio-anual.js'
import { notaOficial } from './estado-notas.js'
import { cursosDelGrado } from './tecnica-grado.js'

let _perfil = null
export function iniciarCentralizador(perfil) { _perfil = perfil }

// ─── ESCALA CUALITATIVA (misma que los informes del director) ───
// ED ≤ 50 · DA 51–68 · DO 69–85 · DP > 85
export function cualitativo(nota) {
  const n = notaOficial(nota)   // la escala se aplica sobre la nota oficial redondeada
  if (n === null) return ''
  if (n > 85) return 'DP'
  if (n > 68) return 'DO'
  if (n > 50) return 'DA'
  return 'ED'
}
const COLOR_CUAL = { DP: '#047857', DO: '#1d4ed8', DA: '#b45309', ED: '#b91c1c', '': '#000' }

function literal(numero) {
  const u = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
  const d = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const e = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
  const v = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
  const n = Math.round(numero)
  if (n === 0) return 'CERO'
  if (n === 100) return 'CIEN'
  if (n < 10) return u[n]
  if (n < 20) return e[n - 10]
  if (n < 30) return v[n - 20]
  const dd = Math.floor(n / 10), uu = n % 10
  return uu ? `${d[dd]} Y ${u[uu]}` : d[dd]
}

// ─── DATOS ───────────────────────────────────────────────
async function _recolectar(cursoId, materiaId, soloCurso = false) {
  const { data: mat } = await supabase.from('materias').select('nombre, es_tecnica').eq('id', materiaId).single()
  const esTecnica = mat?.es_tecnica === true

  let estudiantes = []
  if (esTecnica) {
    // Profesor (soloCurso = false): el grupo de la técnica es el GRADO completo del curso elegido (todos sus
    // paralelos), igual que su pestaña Calificaciones. Director (soloCurso = true): solo el paralelo elegido.
    let q = supabase.from('inscripciones_tecnicas')
      .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
      .eq('materia_id', materiaId).eq('activo', true)
    q = soloCurso ? q.eq('curso_id', cursoId) : q.in('estudiantes.curso_id', await cursosDelGrado(cursoId))
    const { data } = await q
    estudiantes = (data ?? []).map(i => ({ id: i.estudiante_id, nombre: i.estudiantes?.usuarios?.nombre_completo ?? '' }))
  } else {
    const { data } = await supabase.from('estudiantes')
      .select('id, usuarios(nombre_completo)').eq('curso_id', cursoId)
    estudiantes = (data ?? []).map(e => ({ id: e.id, nombre: e.usuarios?.nombre_completo ?? '' }))
  }
  estudiantes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  const [{ data: col }, { data: curso }, lote] = await Promise.all([
    supabase.from('colegios').select('nombre, director_nombre').single(),
    supabase.from('cursos').select('nombre_completo, nivel, grado').eq('id', cursoId).single(),
    calcularPromedioAnualLote(estudiantes.map(e => e.id), [materiaId]),
  ])

  const filas = estudiantes.map(e => {
    const m = lote[e.id]?.[0] ?? null
    return { nombre: e.nombre, t: [m?.t1 ?? null, m?.t2 ?? null, m?.t3 ?? null], promedio: m?.promedio ?? null, completo: !!m?.completo }
  })
  return {
    filas,
    colegio: col?.nombre ?? '',
    director: col?.director_nombre ?? '',
    curso: esTecnica && !soloCurso && curso ? `${curso.grado}° ${curso.nivel} · todos los paralelos` : (curso?.nombre_completo ?? ''),
    materia: mat?.nombre ?? '',
  }
}

// ─── GRÁFICO (canvas → PNG) ──────────────────────────────
function _graficoPNG(grupos) {
  const W = 520, H = 250
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  const base = H - 60, alto = H - 110
  const anchoGrupo = (W - 40) / grupos.length
  g.font = 'bold 15px Arial'; g.textAlign = 'center'
  grupos.forEach((gr, i) => {
    const x0 = 20 + i * anchoGrupo
    const bw = Math.min(54, anchoGrupo / 2 - 8)
    const total = gr.aprob + gr.reprob
    ;[[gr.aprob, '#67e8f9'], [gr.reprob, '#f472b6']].forEach(([val, color], k) => {
      const pct = total ? Math.round((val / total) * 100) : 0
      const h = total ? (val / total) * alto : 0
      const x = x0 + anchoGrupo / 2 - bw - 2 + k * (bw + 4)
      if (total) {
        g.fillStyle = color; g.fillRect(x, base - h, bw, h)
        g.fillStyle = '#111'; g.fillText(`${pct}%`, x + bw / 2, base - h - 6)
      }
    })
    g.fillStyle = '#111'; g.font = 'bold 15px Arial'
    g.fillText(gr.etiqueta, x0 + anchoGrupo / 2, base + 22)
    if (!total) { g.fillStyle = '#6b7280'; g.font = '13px Arial'; g.fillText('sin datos', x0 + anchoGrupo / 2, base - 8); g.font = 'bold 15px Arial' }
  })
  g.strokeStyle = '#111'; g.beginPath(); g.moveTo(15, base); g.lineTo(W - 15, base); g.stroke()
  g.font = '14px Arial'; g.textAlign = 'left'
  g.fillStyle = '#67e8f9'; g.fillRect(W / 2 - 150, H - 28, 14, 14)
  g.fillStyle = '#111'; g.fillText('APROBADOS', W / 2 - 130, H - 16)
  g.fillStyle = '#f472b6'; g.fillRect(W / 2 + 10, H - 28, 14, 14)
  g.fillStyle = '#111'; g.fillText('REPROBADOS', W / 2 + 30, H - 16)
  return cv.toDataURL('image/png')
}

// ─── DOCUMENTO ───────────────────────────────────────────
export function construirCentralizador(d) {
  const notaMin = Config.notaMinima ?? 51
  const periodos = Config.periodos
  const numP = periodos.length
  const aprobado = Config.etiqAprobado ?? 'APROBADO'
  const reprobado = Config.etiqReprobado ?? 'REPROBADO'
  const colTrim = ['#fecaca', '#bae6fd', '#fef08a']
  const colTrimClaro = ['#fde8e8', '#e0f2fe', '#fef9c3']

  // Estadísticas por trimestre (solo con quienes tienen nota) y anual (solo año completo)
  const grupos = periodos.map((p, i) => {
    const notas = d.filas.map(f => f.t[i]).filter(v => v !== null).map(notaOficial)
    return { etiqueta: `${i + 1} TRIM`, aprob: notas.filter(v => v >= notaMin).length, reprob: notas.filter(v => v < notaMin).length }
  })
  const completos = d.filas.filter(f => f.completo)
  grupos.push({ etiqueta: 'ANUAL', aprob: completos.filter(f => f.promedio >= notaMin).length, reprob: completos.filter(f => f.promedio < notaMin).length })

  const hcell = (text, extra = {}) => ({ text, bold: true, alignment: 'center', fontSize: 7, margin: [0, 2, 0, 2], ...extra })
  const fila1 = [hcell('N°', { rowSpan: 2, margin: [0, 10, 0, 0] }), hcell('NÓMINA DE ESTUDIANTES', { rowSpan: 2, fontSize: 10, margin: [0, 8, 0, 0] })]
  const fila2 = [{}, {}]
  periodos.forEach((p, i) => {
    fila1.push(hcell(`${i + 1}${i === 0 ? 'er' : i === 1 ? 'do' : 'er'}. TRIM`.toUpperCase(), { colSpan: 2, fillColor: colTrim[i % 3], fontSize: 10 }), {})
    fila2.push(hcell('CUALITATIVO', { fillColor: colTrimClaro[i % 3] }), hcell('CUANTITATIVO', { fillColor: colTrimClaro[i % 3] }))
  })
  fila1.push(hcell('PROMEDIO ANUAL', { rowSpan: 2, fillColor: '#cbd5e1', margin: [0, 8, 0, 0] }),
             hcell('PROMEDIO ANUAL LITERAL', { rowSpan: 2, fillColor: '#cbd5e1', margin: [0, 8, 0, 0] }),
             hcell('SITUACIÓN DEL ESTUDIANTE', { rowSpan: 2, fillColor: '#cbd5e1', margin: [0, 8, 0, 0] }))
  fila2.push({}, {}, {})

  const cuerpo = d.filas.map((f, idx) => {
    const fila = [
      { text: String(idx + 1), alignment: 'center', fontSize: 8 },
      { text: f.nombre.toUpperCase(), fontSize: 8 },
    ]
    for (let i = 0; i < numP; i++) {
      const v = f.t[i]
      const cual = v === null ? '' : cualitativo(v)
      fila.push(
        { text: cual, alignment: 'center', bold: true, fontSize: 8, color: COLOR_CUAL[cual], fillColor: colTrimClaro[i % 3] },
        { text: v === null ? '' : String(notaOficial(v)), alignment: 'center', bold: true, fontSize: 9, color: v !== null && notaOficial(v) < notaMin ? '#b91c1c' : '#000', fillColor: colTrimClaro[i % 3] },
      )
    }
    const prom = f.promedio
    const sit = prom === null ? '' : (!f.completo || !Config.bloqueada) ? 'EN CURSO' : prom >= notaMin ? aprobado : reprobado
    fila.push(
      { text: prom === null ? '' : String(notaOficial(prom)), alignment: 'center', bold: true, fontSize: 9, fillColor: '#e2e8f0', color: prom !== null && prom < notaMin ? '#b91c1c' : '#000', italics: prom !== null && !f.completo },
      { text: prom === null ? '' : literal(prom), fontSize: 8, bold: true },
      { text: sit, alignment: 'center', bold: true, fontSize: 8, fillColor: sit === aprobado ? '#d1fae5' : sit === reprobado ? '#fee2e2' : sit ? '#fef9c3' : null,
        color: sit === aprobado ? '#047857' : sit === reprobado ? '#b91c1c' : '#854d0e' },
    )
    return fila
  })

  const anchos = [18, '*']
  for (let i = 0; i < numP; i++) anchos.push(46, 52)
  anchos.push(38, 105, 62)

  const etiqueta = (k, v) => ({ columns: [{ text: k, bold: true, width: 105, fontSize: 9 }, { text: v || '', fontSize: 9 }], margin: [0, 1, 0, 1] })
  const hoy = new Date().toLocaleDateString('es-BO')
  const hechos = periodos.filter((p, i) => d.filas.some(f => f.t[i] !== null)).length

  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 24, 28, 30],
    content: [
      { text: 'BOLETÍN CENTRALIZADOR DE NOTAS', style: 'titulo', alignment: 'center', margin: [0, 0, 0, 6] },
      {
        columns: [
          { width: '*', stack: [
            etiqueta('UNIDAD EDUCATIVA:', d.colegio.toUpperCase()),
            etiqueta('DIRECTOR/A:', d.director.toUpperCase()),
            etiqueta('DOCENTE:', (d.docente ?? _perfil?.nombre_completo ?? '').toUpperCase()),
            etiqueta('ÁREA:', d.materia.toUpperCase()),
            etiqueta('CURSO:', d.curso.toUpperCase()),
            etiqueta('GESTIÓN:', String(Config.año)),
            { text: `Avance: ${hechos} de ${numP} trimestres con notas · Emitido: ${hoy}`, fontSize: 8, color: '#555', margin: [0, 6, 0, 0] },
          ] },
          { width: 260, image: _graficoPNG(grupos), fit: [260, 130], alignment: 'right' },
        ],
        margin: [0, 0, 0, 8],
      },
      {
        table: { headerRows: 2, widths: anchos, body: [fila1, fila2, ...cuerpo] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#555', vLineColor: () => '#555', paddingTop: () => 2, paddingBottom: () => 2 },
      },
      { text: `Escala cualitativa: DP Desarrollo Pleno (86–100) · DO Desarrollo Óptimo (69–85) · DA Desarrollo Aceptable (51–68) · ED En Desarrollo (0–50). Notas redondeadas al entero (.5 sube). Promedio anual = suma de trimestres ÷ trimestres con nota; la situación es definitiva al cerrar el último trimestre. Aprueba con ≥ ${notaMin}.`,
        fontSize: 7, color: '#555', margin: [0, 6, 0, 0] },
    ],
    footer: (page, pages) => ({ text: `Página ${page} de ${pages}`, alignment: 'center', fontSize: 8, color: '#777' }),
    styles: { titulo: { fontSize: 18, bold: true, color: '#1e1b4b' } },
    defaultStyle: { fontSize: 9 },
  }
}

// ─── PUNTO DE ENTRADA ────────────────────────────────────
/** Genera y descarga el centralizador. docente: nombre a imprimir (por defecto, el profesor en sesión). */
export async function generarCentralizadorPDF({ cursoId, materiaId, docente = null, soloCurso = false }) {
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia primero', 'warning'); return }
  if (typeof pdfMake === 'undefined') { toast('La librería de PDF no está cargada', 'error'); return }
  mostrarLoader('Generando centralizador...')
  try {
    const datos = await _recolectar(cursoId, materiaId, soloCurso)
    datos.docente = docente
    if (!datos.filas.length) { toast('El curso no tiene estudiantes', 'warning'); return }
    const limpio = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_')
    pdfMake.createPdf(construirCentralizador(datos)).download(`centralizador_${limpio(datos.curso)}_${limpio(datos.materia)}_${Config.año}.pdf`)
  } catch (err) {
    console.error(err)
    toast(err.message ?? 'No se pudo generar el centralizador', 'error')
  } finally {
    ocultarLoader()
  }
}

// Botón del panel del profesor (Calificaciones)
window._vcCentralizadorPDF = function () {
  return generarCentralizadorPDF({
    cursoId: document.getElementById('selector-curso-global')?.value,
    materiaId: document.getElementById('selector-materia-global')?.value,
  })
}

// Botón del panel del director (Calificaciones): el docente sale de la asignación activa.
window.centralizadorDirPDF = async function () {
  const cursoId = document.getElementById('cal-curso')?.value
  const materiaId = document.getElementById('cal-materia')?.value
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia primero', 'warning'); return }
  let docente = null
  try {
    const { data: mat } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    let q = supabase.from('asignaciones_profesor').select('profesor_id').eq('materia_id', materiaId).eq('activo', true)
    if (!mat?.es_tecnica) q = q.eq('curso_id', cursoId)
    const { data: asig } = await q.limit(1)
    if (asig?.[0]) {
      const { data: u } = await supabase.from('usuarios').select('nombre_completo').eq('id', asig[0].profesor_id).single()
      docente = u?.nombre_completo ?? null
    }
  } catch { /* sin docente: se deja en blanco */ }
  return generarCentralizadorPDF({ cursoId, materiaId, docente: docente ?? '', soloCurso: true })
}