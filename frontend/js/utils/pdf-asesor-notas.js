// js/utils/pdf-asesor-notas.js
// PDF de notas del curso para el ASESOR: todas las materias en una hoja horizontal,
// con el nombre de cada materia en vertical para que entren muchas columnas.
// Usa los mismos datos y la misma regla de estado que la pantalla (estado-notas.js):
// con el trimestre abierto muestra "En curso"/"En riesgo"; Aprobado/Reprobado solo al cierre.
// Requiere jsPDF + autotable (ya cargados en dashboard-profesor.html).
import { supabase } from '../config/supabase-config.js'
import { estadoTrimestre, promedioAnual, promedioSimple, notaOficial, fmtNota } from './estado-notas.js'

const FORMATOS = { carta: 'letter', oficio: [215.9, 330.2] }   // oficio Bolivia: 8,5 x 13 pulgadas

// Colores por estado (fondo, texto) — los mismos tonos de la pantalla del asesor
const COLOR = {
  'en-curso':      [[254, 243, 199], [146, 64, 14]],
  'en-riesgo':     [[254, 226, 226], [185, 28, 28]],
  'aprobado':      [[220, 252, 231], [22, 101, 52]],
  'reprobado':     [[254, 202, 202], [127, 29, 29]],
  'parcial':       [[224, 231, 255], [55, 48, 163]],
  'parcial-bajo':  [[254, 226, 226], [185, 28, 28]],
  'sin-calificar': [[241, 245, 249], [100, 116, 139]],
}

/**
 * @param {object} o
 *   curso: { curso_nombre, anio }, tri: 1..N | 'anual', nombrePeriodo: string,
 *   matriz, estudiantes, ctx, notaMinima, formato: 'carta' | 'oficio', asesor: string
 */
export async function pdfNotasAsesor({ curso, tri, nombrePeriodo, matriz, estudiantes, ctx, notaMinima, formato = 'carta', asesor = '' }) {
  if (!window.jspdf?.jsPDF) throw new Error('La librería PDF no está cargada')
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: FORMATOS[formato] ?? 'letter' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const mg = 10

  let colegio = ''
  try { const { data } = await supabase.from('colegios').select('nombre').limit(1); colegio = data?.[0]?.nombre ?? '' } catch (_) {}

  const anual = tri === 'anual'
  const materias = matriz.materias

  // Celda: valor + estado corto en segunda línea
  const celda = (mats, m) => {
    const tieneNotas = Object.keys(mats).length > 0
    if (!mats[m.id] && tieneNotas) return { txt: 'S/I', clave: null }          // sin inscripción (técnica)
    const porTri = mats[m.id] ?? {}
    if (anual) {
      const a = promedioAnual(porTri, ctx)
      const clave = a.clave === 'parcial' && a.bajo ? 'parcial-bajo' : a.clave
      return { txt: a.promedio == null ? '—' : `${fmtNota(a.promedio)}\n${corto(a.clave)}`, clave, valor: a.promedio }
    }
    const e = estadoTrimestre(porTri[tri], ctx)
    if (e.clave === 'sin-calificar') return { txt: '—', clave: e.clave }
        const abierto = (e.clave === 'en-curso' || e.clave === 'en-riesgo') && !e.completa
    const v = abierto && e.hs != null ? e.hs : e.nota
    const clave = e.completa && e.clave === 'en-curso' ? 'aprobado' : e.clave
    return { txt: `${fmtNota(v)}\n${e.completa && e.clave === 'en-curso' ? 'Completa' : corto(e.clave)}`, clave, valor: porTri[tri]?.nota_final ?? null }
  }

  const filasCeldas = estudiantes.map(e => {
    const mats = matriz.porEstudiante[e.estudiante_id] ?? {}
    const cs = materias.map(m => celda(mats, m))
    const prom = notaOficial(promedioSimple(cs.map(c => notaOficial(c.valor ?? null))))
    return { nombre: e.nombre, cs, prom }
  })

  // Anchos: N°, Estudiante y Promedio fijos; materias reparten el resto
  const wN = 7, wNom = 58, wProm = 13
  const wMat = Math.max(9, (W - mg * 2 - wN - wNom - wProm) / Math.max(materias.length, 1))
  const altoCab = 34
  const tope = 26

  const encabezado = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(17, 24, 39)
    doc.text(colegio || 'Unidad Educativa', mg, 10)
    doc.setFontSize(9.5)
    doc.text(`Notas del curso ${curso.curso_nombre} — ${anual ? 'Promedio anual' : nombrePeriodo} — Gestión ${curso.anio}`, mg, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(75, 85, 99)
    doc.text(`Asesor: ${asesor || '—'}   ·   Emitido: ${new Date().toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`, mg, 21)
  }

  doc.autoTable({
    head: [['N°', 'Estudiante', ...materias.map(() => ''), 'Prom.']],
    body: filasCeldas.map((f, i) => [i + 1, f.nombre, ...f.cs.map(c => c.txt), fmtNota(f.prom)]),
    startY: tope, margin: { left: mg, right: mg, top: tope, bottom: 16 },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, halign: 'center', valign: 'middle', lineColor: [209, 213, 219], lineWidth: 0.1, textColor: [17, 24, 39] },
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold', minCellHeight: altoCab, valign: 'bottom' },
    columnStyles: {
      0: { cellWidth: wN },
      1: { cellWidth: wNom, halign: 'left', fontSize: 7.5 },
      ...Object.fromEntries(materias.map((_, i) => [i + 2, { cellWidth: wMat }])),
      [materias.length + 2]: { cellWidth: wProm, fontStyle: 'bold' },
    },
    didParseCell: d => {
      if (d.section !== 'body') return
      if (d.row.index % 2 && (d.column.index < 2 || d.column.index === materias.length + 2)) d.cell.styles.fillColor = [232, 238, 248]   // intercalado
      const j = d.column.index - 2
      if (j < 0 || j >= materias.length) return
      const c = filasCeldas[d.row.index].cs[j]
      const col = COLOR[c.clave]
      if (col) { d.cell.styles.fillColor = col[0]; d.cell.styles.textColor = col[1] }
      if (c.txt === 'S/I') d.cell.styles.textColor = [148, 163, 184]
      d.cell.styles.fontStyle = 'bold'
    },
    didDrawCell: d => {
      // Nombre de la materia en vertical, de abajo hacia arriba
      if (d.section !== 'head') return
      const j = d.column.index - 2
      if (j < 0 || j >= materias.length) return
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255)
      const maxLargo = altoCab - 3
      // Hasta 2 columnas de texto vertical; si aún no entra, la 2ª se recorta con punto
      let lineas = doc.splitTextToSize(materias[j].nombre, maxLargo)
      if (lineas.length > 2) {
        let l2 = lineas.slice(1).join(' ')
        while (doc.getTextWidth(l2 + '.') > maxLargo && l2.length > 3) l2 = l2.slice(0, -1)
        lineas = [lineas[0], l2.trimEnd() + '.']
      }
      const paso = 2.6, x0 = d.cell.x + d.cell.width / 2 + 1 - (lineas.length - 1) * paso / 2
      lineas.forEach((l, k) => doc.text(l, x0 + k * paso, d.cell.y + d.cell.height - 1.5, { angle: 90 }))
    },
    didDrawPage: () => {
      encabezado()
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(75, 85, 99)
      const ley = anual
        ? `Anual: promedio de los trimestres con notas. Gestión abierta: En curso / En riesgo; Aprobado / Reprobado al cerrar la gestión.`
        : `Trimestre abierto: se muestra Hacer+Saber; bajo ${notaMinima} = En riesgo. Aprobado / Reprobado solo con el trimestre cerrado.`
      doc.text(`${ley}  S/I = sin inscripción en la especialidad.  — = sin notas.`, mg, H - 9)
      doc.text(`Página ${doc.internal.getNumberOfPages()}`, W - mg, H - 9, { align: 'right' })
    },
  })

  const archivo = `notas_${curso.curso_nombre}_${anual ? 'anual' : 'T' + tri}_${new Date().toISOString().slice(0, 10)}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_')
  doc.save(`${archivo}.pdf`)
}

function corto(clave) {
  return { 'en-curso': 'En curso', 'en-riesgo': 'En riesgo', aprobado: 'Aprob.', reprobado: 'Reprob.', parcial: 'Parcial', 'sin-calificar': '' }[clave] ?? ''
}