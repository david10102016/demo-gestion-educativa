// js/utils/generar-libreta-pdf.js
// Genera la libreta de calificaciones en PDF usando pdfMake.
// Adaptado del sistema en producción — escudo base64, numeroALiteral,
// materias técnicas por aplica_desde, promedio en letras.
import { supabase } from '../config/supabase-config.js'
import { Config }   from '../config/config-app.js'
import { notaOficial } from './estado-notas.js'
import { asegurarPdfMake } from './cargar-librerias.js'
import { toast } from './ui.js'

// ─── ESCUDO BOLIVIA EN BASE64 ─────────────────────────────
const ESCUDO_BASE64 = 'data:image/png;base64,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'

// ─── NÚMERO A LITERAL EN ESPAÑOL ─────────────────────────
function numeroALiteral(numero) {
  const unidades   = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
  const decenas    = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
  const centenas   = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']
  numero = Math.round(numero)
  if (numero === 0)   return 'CERO'
  if (numero === 100) return 'CIEN'
  let literal = ''
  const c = Math.floor(numero / 100)
  if (c > 0) { literal += centenas[c]; if (numero % 100 !== 0) literal += ' ' }
  const resto = numero % 100
  if (resto >= 10 && resto < 20) {
    literal += especiales[resto - 10]
  } else {
    const d = Math.floor(resto / 10); const u = resto % 10
    if (d > 0) { literal += decenas[d]; if (u > 0) literal += ' Y ' + unidades[u] }
    else if (u > 0) literal += unidades[u]
  }
  return literal.trim()
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────
export async function generarLibretaPDF(estudianteId) {
  try { await asegurarPdfMake() }
  catch (e) { console.error('pdfMake no cargado', e); toast('No se pudo preparar el PDF. Revisa tu conexión e intenta de nuevo.', 'error'); return }

  const { data: est } = await supabase
    .from('estudiantes')
    .select('carnet, usuarios(nombre_completo), curso:cursos(nombre_completo, nivel, grado, paralelo)')
    .eq('id', estudianteId).single()
  if (!est) { console.error('Estudiante no encontrado'); return }

  const nivel    = est.curso?.nivel ?? 'Secundaria'
  const gradoNum = parseInt(est.curso?.grado) || 0
  const periodos = Config.periodos

  // Paralelo: colegio + materias + inscripciones + notas (antes iban en serie)
  const [
    { data: col },
    { data: todasMaterias },
    { data: inscTec },
    { data: notasVista },
  ] = await Promise.all([
    supabase
      .from('colegios')
      .select('nombre, municipio, departamento, director_nombre, resolucion_ministerial')
      .single(),
    supabase
      .from('materias')
      .select('id, nombre, campo_saberes, es_tecnica, aplica_desde')
      .eq('nivel', nivel)
      .eq('activo', true)
      .order('campo_saberes').order('nombre'),
    supabase
      .from('inscripciones_tecnicas')
      .select('materia_id')
      .eq('estudiante_id', estudianteId)
      .eq('activo', true),
    supabase
      .from('notas_finales')
      .select('materia_id, trimestre, nota_final')
      .eq('estudiante_id', estudianteId)
      .in('trimestre', periodos.map(p => p.numero)),
  ])

  let regulares  = (todasMaterias ?? []).filter(m => !m.es_tecnica)
  const tecnicas = (todasMaterias ?? []).filter(m => m.es_tecnica)

  if (nivel === 'Secundaria' && gradoNum >= 4) {
    regulares = regulares.filter(m => m.nombre !== 'Técnica Tecnológica General')
  }

  const idsInscritos = new Set((inscTec ?? []).map(i => i.materia_id))
  const gradoAplica = (s) => {
    const n = parseInt(String(s ?? '4').replace(/\D/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 4
  }
  const tecnicasEst = tecnicas.filter(
    m => idsInscritos.has(m.id) && gradoNum >= gradoAplica(m.aplica_desde)
  )
  regulares.push(...tecnicasEst)

  const materias = regulares
  const notasMap = {}
  ;(notasVista ?? []).forEach(n => {
    if (!notasMap[n.materia_id]) notasMap[n.materia_id] = {}
    notasMap[n.materia_id][n.trimestre] = parseFloat(n.nota_final ?? 0)
  })

  const docDef = buildDoc(est, col, materias, notasMap, periodos)
  const apellidos = (est.usuarios?.nombre_completo ?? 'alumno')
    .trim().split(/\s+/).slice(0, 2).join('_')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
  pdfMake.createPdf(docDef).download(`libreta_${apellidos}_${est.carnet}_${Config.año}.pdf`)
}

// ─── CONSTRUCTOR DEL DOCUMENTO ───────────────────────────
export function buildDoc(est, col, materias, notasMap, periodos) {
  const CAMPOS = [
    'COMUNIDAD Y SOCIEDAD',
    'CIENCIA TECNOLOGÍA Y PRODUCCIÓN',
    'VIDA TIERRA TERRITORIO',
    'COSMOS Y PENSAMIENTO',
  ]

  // Anchos fijos probados en producción (suma=500pt, tabla con margin [20,10,20,10])
  const anchoCampo    = 120
  const anchoMateria  = 150
  const anchoPeriodo  = 50
  const anchoPromedio = 80
  const colWidths     = [anchoCampo, anchoMateria, ...periodos.map(() => anchoPeriodo), anchoPromedio]

  const headerRow1 = [
    { text: 'Campos de Saberes y\nConocimientos', style: 'th', rowSpan: 2 },
    { text: 'Áreas Curriculares',                 style: 'th', rowSpan: 2 },
    { text: 'Valoración Cuantitativa', style: 'th', colSpan: periodos.length + 1 },
    ...Array(periodos.length).fill({}),
  ]
  const headerRow2 = [
    {}, {},
    ...periodos.map(p => ({ text: p.nombre, style: 'th', fontSize: 8 })),
    { text: 'Promedio\nAnual', style: 'th', fontSize: 8 },
  ]

  const filas = []
  for (const campo of CAMPOS) {
    const mc = materias.filter(m => m.campo_saberes === campo)
    if (!mc.length) continue
    mc.forEach((mat, idx) => {
      const notasPeriodos = periodos.map(p => {
        const val = notasMap[mat.id]?.[p.numero]
        return val && val > 0
          ? { text: String(notaOficial(val)), style: 'celda', alignment: 'center' }
          : { text: '—', style: 'celda', alignment: 'center', color: '#94a3b8' }
      })

      const valsValidos = periodos.map(p => notasMap[mat.id]?.[p.numero]).filter(v => v && v > 0)
      let celdaPromedio
      if (valsValidos.length) {
        // Misma regla del sistema: promedio de los trimestres redondeados, redondeado (.5 sube)
        const prom     = notaOficial(valsValidos.reduce((s, v) => s + notaOficial(v), 0) / valsValidos.length)
        const aprobado = prom >= Config.notaMinima
        const enCurso  = valsValidos.length < periodos.length
        celdaPromedio  = {
          stack: [
            { text: prom.toString(), bold: true, fontSize: 11 },
            { text: numeroALiteral(prom), fontSize: 6, color: aprobado ? '#065f46' : '#991b1b' },
            enCurso ? { text: '(En curso)', fontSize: 6, color: '#64748b' } : {},
          ],
          alignment: 'center',
          fillColor: aprobado ? '#d1fae5' : '#fee2e2',
        }
      } else {
        celdaPromedio = { text: '—', style: 'celda', alignment: 'center', color: '#94a3b8' }
      }

      filas.push([
        idx === 0 ? { text: campo, style: 'campoSaber', rowSpan: mc.length } : {},
        { text: mat.nombre, style: 'celda' },
        ...notasPeriodos,
        celdaPromedio,
      ])
    })
  }

  // Firmas — 3 columnas de igual ancho fijo (184pt c/u = 552pt total)
  const lineaFirma = 120
  const firmas = {
    columns: [
      { width: 184, stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: lineaFirma, y2: 0, lineWidth: 0.5 }] },
        { text: 'Firma Docente', fontSize: 9, alignment: 'center', margin: [0, 4, 0, 0] },
      ], alignment: 'center' },
      { width: 184, stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: lineaFirma, y2: 0, lineWidth: 0.5 }] },
        { text: col?.director_nombre ? `Dir.: ${col.director_nombre}` : 'Director/a', fontSize: 9, alignment: 'center', margin: [0, 4, 0, 0] },
      ], alignment: 'center' },
      { width: 184, stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: lineaFirma, y2: 0, lineWidth: 0.5 }] },
        { text: 'Firma Tutor/a', fontSize: 9, alignment: 'center', margin: [0, 4, 0, 0] },
      ], alignment: 'center' },
    ],
    columnGap: 0,
    margin: [0, 24, 0, 0],
  }

  return {
    pageSize: 'LETTER', pageOrientation: 'portrait', pageMargins: [0, 0, 0, 0],
    content: [
      // Encabezado
      {
        columns: [
          { image: ESCUDO_BASE64, width: 60, margin: [20, 20, 0, 0] },
          { stack: [
            { text: 'ESTADO PLURINACIONAL DE BOLIVIA', fontSize: 8, alignment: 'center', bold: true },
            { text: 'MINISTERIO DE EDUCACIÓN',         fontSize: 8, alignment: 'center' },
            { text: col?.nombre ?? 'Unidad Educativa', fontSize: 12, bold: true, alignment: 'center', margin: [0, 3, 0, 0] },
            col?.municipio ? { text: `${col.municipio} — ${col.departamento ?? ''}`, fontSize: 8, alignment: 'center', color: '#64748b' } : {},
            col?.resolucion_ministerial ? { text: `Res. Min.: ${col.resolucion_ministerial}`, fontSize: 8, alignment: 'center', color: '#64748b' } : {},
            { text: '⚠ DOCUMENTO INFORMATIVO — NO OFICIAL', fontSize: 7, alignment: 'center', color: '#dc2626', bold: true, margin: [0, 3, 0, 0] },
          ] },
        ],
        margin: [0, 0, 0, 0],
      },
      { canvas: [{ type: 'line', x1: 20, y1: 0, x2: 575, y2: 0, lineWidth: 1 }], margin: [0, 0, 0, 0] },
      { text: 'LIBRETA DE CALIFICACIONES', fontSize: 12, bold: true, alignment: 'center', margin: [0, 0, 0, 8] },
      // Datos estudiante
      { table: { widths: ['*', '*'], body: [[
        { text: `Apellidos y Nombres: ${est.usuarios?.nombre_completo ?? ''}`, bold: true, fontSize: 10 },
        { text: `Año de Escolaridad: ${est.curso?.grado ?? ''}° — ${est.curso?.paralelo ?? ''}`, bold: true, fontSize: 10, alignment: 'right' },
      ]] }, layout: 'noBorders', margin: [20, 8, 20, 3] },
      { table: { widths: ['*', '*'], body: [[
        { text: `Curso: ${est.curso?.nombre_completo ?? ''}`, fontSize: 9 },
        { text: `Carnet: ${est.carnet ?? ''}`, fontSize: 9, alignment: 'right' },
      ]] }, layout: 'noBorders', margin: [20, 0, 20, 8] },
      // Tabla
      { table: { headerRows: 2, widths: colWidths, body: [headerRow1, headerRow2, ...filas] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#cbd5e0', vLineColor: () => '#cbd5e0', fillColor: (row) => row < 2 ? '#1e1b4b' : null },
        margin: [20, 10, 20, 10] },
      { text: `Nota mínima de aprobación: ${Config.notaMinima} puntos de ${Config.escalaMaxima ?? 100}`, fontSize: 8, color: '#64748b', margin: [20, 0, 20, 4] },
      { text: '⚠ DOCUMENTO DE USO INTERNO — No constituye documento oficial del Ministerio de Educación del Estado Plurinacional de Bolivia.', fontSize: 7, bold: true, color: '#dc2626', alignment: 'center', margin: [20, 0, 20, 0] },
      firmas,
    ],
    styles: {
      th:         { bold: true, fontSize: 8, color: 'white', fillColor: '#1e1b4b', alignment: 'center' },
      campoSaber: { bold: true, fontSize: 8, fillColor: '#e2e8f0' },
      celda:      { fontSize: 9 },
    },
    footer: (cp, pc) => ({ text: `${col?.nombre ?? ''} — Gestión ${Config.año} — Página ${cp} de ${pc}`, fontSize: 7, color: '#94a3b8', alignment: 'center', margin: [0, 10, 0, 0] }),
  }
}

window.generarLibretaPDF = generarLibretaPDF