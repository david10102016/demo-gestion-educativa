// js/utils/export-excel.js
import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { paginar } from './paginar.js'
import { notaOficial, trimestreCerrado } from './estado-notas.js'

// Aprobado/Reprobado solo cuando el director cerró el trimestre; abierto → EN CURSO
const _cerrado = t => trimestreCerrado(t, { trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada })
const _estadoTri = (nota, t) => _cerrado(t) ? Config.estado(nota) : 'EN CURSO'
import { textoLlegada } from './asistencia-materia.js'
import { cursosDelGrado } from './tecnica-grado.js'
import { asegurarXLSX } from './cargar-librerias.js'
import { toast } from './ui.js'

// Paleta por dimensión: la comparten el detalle y el resumen para que se vean iguales
const DIM_COLORS = {
  hacer:   { header: 'FFF59E0B', light: 'FFFFF8EC', mid: 'FFFEF3C7' },
  saber:   { header: 'FF3B82F6', light: 'FFEFF6FF', mid: 'FFDBEAFE' },
  ser:     { header: 'FF8B5CF6', light: 'FFF5F3FF', mid: 'FFEDE9FE' },
  decidir: { header: 'FF06B6D4', light: 'FFECFEFF', mid: 'FFCFFAFE' },
}
const DEFAULT_COLOR = { header: 'FF6366F1', light: 'FFEFF0FF', mid: 'FFE0E7FF' }

/** Nombre del profesor con asignación activa en curso + materia (null si no hay). */
export async function obtenerDocenteAsignado(cursoId, materiaId) {
  const { data } = await supabase.from('asignaciones_profesor')
    .select('profesor:usuarios(nombre_completo)')
    .eq('curso_id', cursoId).eq('materia_id', materiaId).eq('activo', true).limit(1)
  return data?.[0]?.profesor?.nombre_completo ?? null
}

// ─────────────────────────────────────────────────────────
// EXPORTAR NOTAS FINALES — resumen del período (ExcelJS, mismo diseño que el detalle)
// ─────────────────────────────────────────────────────────
export async function exportarNotasExcel(cursoId, materiaId, periodo, nombreArchivo = null, nombreDocente = null) {
  if (typeof ExcelJS === 'undefined') { console.error('ExcelJS no está cargado.'); return }

  const [{ data: curso }, { data: materia }] = await Promise.all([
    supabase.from('cursos').select('nombre_completo').eq('id', cursoId).single(),
    supabase.from('materias').select('nombre').eq('id', materiaId).single()
  ])

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  const { data: notas } = await supabase.from('notas_finales').select('*').eq('trimestre', periodo).eq('materia_id', materiaId).eq('curso_id', cursoId)

  let idsSet
  if (esTecnica) {
    const { data: inscritos } = await supabase.from('inscripciones_tecnicas')
      .select('estudiante_id').eq('materia_id', materiaId).eq('activo', true)
    idsSet = new Set((inscritos ?? []).map(i => i.estudiante_id))
  } else {
    const { data: estudiantesCurso } = await supabase.from('estudiantes').select('id').eq('curso_id', cursoId)
    idsSet = new Set((estudiantesCurso ?? []).map(e => e.id))
  }
  const filasNotas = (notas ?? [])
    .filter(n => idsSet.has(n.estudiante_id) && n.materia_id === materiaId)
    .sort((a, b) => (a.estudiante ?? '').localeCompare(b.estudiante ?? ''))

  const dims        = Config.dimensiones
  const nomMateria  = materia?.nombre ?? 'Materia'
  const docente     = nombreDocente ?? (await obtenerDocenteAsignado(cursoId, materiaId)) ?? 'Dirección'
  const fechaExport = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' })
  const colTotal    = 4 + dims.length            // N°, Estudiante, Carnet, [dims], Total, Estado
  const colorDim    = (col) => { const d = dims[col - 4]; return d ? (DIM_COLORS[d.codigo] ?? DEFAULT_COLOR) : null }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Gestión Educativa 2027'
  wb.created = new Date()
  const ws = wb.addWorksheet(`${Config.nombrePeriodo} ${periodo}`)
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }

  _encabezado(ws, {
    titulo:     `RESUMEN DE NOTAS — ${nomMateria} — ${Config.nombrePeriodo} ${periodo} — Gestión ${Config.año}`,
    curso:      curso?.nombre_completo ?? '',
    docente,
    info:       `Nota mínima aprobación: ${Config.notaMinima} · Total estudiantes: ${filasNotas.length}`,
    aviso:      'Notas finales del período, redondeadas al entero oficial del sistema.',
    totalCols:  colTotal + 1,
    colorFondo: 'FF1F3864',
    fechaExport,
    tituloGrande: true,
  })

  const rH = ws.addRow(['N°', 'Estudiante', 'Carnet',
    ...dims.map(d => `${d.nombre}\n(/${d.peso_maximo})`), `Total\n(${Config.escalaMaxima})`, 'Estado'])
  rH.height = 50
  rH.eachCell((cell, col) => {
    cell.font      = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorDim(col)?.header ?? 'FF1F3864' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border    = _bBlanco()
  })
  ;[4, 30, 12, ...dims.map(() => 15), 12, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w })

  filasNotas.forEach((n, i) => {
    const vals     = { hacer: n.promedio_hacer, saber: n.promedio_saber, ser: n.nota_ser, decidir: n.nota_decidir }
    const total    = notaOficial(n.nota_final ?? 0)
    const aprobado = total >= Config.notaMinima || !_cerrado(periodo)   // abierto: sin rojo
    const r = ws.addRow([i + 1, n.estudiante, /^[1-9]\d{0,14}$/.test(String(n.carnet ?? '')) ? Number(n.carnet) : n.carnet,
      ...dims.map(d => notaOficial(vals[d.codigo] ?? 0)), total, _estadoTri(n.nota_final ?? 0, periodo)])
    r.height = 20
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      const c = colorDim(col)
      const esTotal = col >= colTotal
      cell.font      = { name: 'Arial', size: 9, bold: !!c || esTotal, color: esTotal ? { argb: aprobado ? 'FF166534' : 'FF991B1B' } : undefined }
      cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' }
      cell.border    = _bGris()
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: esTotal ? (aprobado ? 'FFD1FAE5' : 'FFFEE2E2')
        : c ? (i % 2 === 0 ? c.light : c.mid) : (i % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB') } }
      if (c || col === colTotal) cell.numFmt = '0'
    })
  })

  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 6 }]

  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = nombreArchivo ?? `notas_${nomMateria.replace(/[^a-zA-Z0-9]/g, '_')}_T${periodo}_${Config.año}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────
// EXPORTAR RESUMEN ANUAL POR ESTUDIANTE (SheetJS)
// ─────────────────────────────────────────────────────────
export async function exportarResumenAnualExcel(estudianteId) {
  try { await asegurarXLSX() }
  catch (e) { console.error('SheetJS no está cargado.', e); toast('No se pudo preparar el Excel. Revisa tu conexión e intenta de nuevo.', 'error'); return }

  const { data: est } = await supabase.from('estudiantes')
    .select('carnet, usuarios(nombre_completo), curso:cursos(nombre_completo)')
    .eq('id', estudianteId).single()

  const periodos = Config.periodos
  const wb       = XLSX.utils.book_new()

  for (const p of periodos) {
    const { data: notas } = await supabase.from('notas_finales').select('*')
      .eq('estudiante_id', estudianteId).eq('trimestre', p.numero)

    const dims   = Config.dimensiones
    const header = ['Materia', ...dims.map(d => `${d.nombre} (${d.peso_maximo})`), 'Total', 'Estado']
    const filas  = (notas ?? [])
      .sort((a, b) => a.materia?.localeCompare(b.materia))
      .map(n => {
        const vals = { hacer: parseFloat(n.promedio_hacer??0), saber: parseFloat(n.promedio_saber??0), ser: parseFloat(n.nota_ser??0), decidir: parseFloat(n.nota_decidir??0) }
        return [n.materia, ...dims.map(d => notaOficial(vals[d.codigo]??0)), notaOficial(n.nota_final??0), _estadoTri(n.nota_final??0, p.numero)]
      })

    const wsData = [
      [`${p.nombre} ${p.numero} — Gestión ${Config.año}`],
      [`Estudiante: ${est?.usuarios?.nombre_completo ?? ''}`],
      [`Curso: ${est?.curso?.nombre_completo ?? ''}`],
      [],
      header,
      ...filas
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch:35 }, ...dims.map(()=>({ wch:14 })), { wch:10 }, { wch:12 }]
    XLSX.utils.book_append_sheet(wb, ws, p.nombre)
  }

  XLSX.writeFile(wb, `resumen_${est?.carnet ?? 'estudiante'}_${Config.año}.xlsx`)
}

// ─────────────────────────────────────────────────────────
// EXPORTAR ASISTENCIAS (ExcelJS)
export async function exportarAsistenciasExcel(cursoId, fechaInicio, fechaFin, opts = {}) {
  if (typeof ExcelJS === 'undefined') { console.error('ExcelJS no está cargado.'); return }

  const materiaId  = opts.materiaId  ?? null
  const profesorId = opts.profesorId ?? null

    const [{ data: curso }, { data: materiaInfo }, { data: profesorInfo }] = await Promise.all([
    supabase.from('cursos').select('nombre_completo').eq('id', cursoId).single(),
    materiaId
      ? supabase.from('materias').select('nombre, es_tecnica').eq('id', materiaId).single()
      : Promise.resolve({ data: null }),
    profesorId
      ? supabase.from('usuarios').select('nombre_completo').eq('id', profesorId).single()
      : Promise.resolve({ data: null }),
  ])
  const nombreMateria  = materiaInfo?.nombre ?? 'Todas las materias'
  const nombreProfesor = profesorInfo?.nombre_completo ?? 'Todos los profesores'
  const esTecnica      = materiaInfo?.es_tecnica === true

  let estudiantesCurso = []
  if (esTecnica && materiaId) {
    const { data: inscritos } = await supabase
      .from('inscripciones_tecnicas')
      .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
      .eq('materia_id', materiaId)
      .eq('activo', true)
      .in('estudiantes.curso_id', await cursosDelGrado(cursoId))
    estudiantesCurso = (inscritos ?? []).map(i => ({
      id: i.estudiante_id,
      usuarios: i.estudiantes?.usuarios ?? null,
    }))
  } else {
    const { data } = await supabase
      .from('estudiantes')
      .select('id, usuarios(nombre_completo)')
      .eq('curso_id', cursoId)
    estudiantesCurso = data ?? []
  }

  // Paginación PostgREST (~1000 filas) — no una query por alumno
  const PAGE = 1000
  let from = 0
  const asistencias = []
  for (;;) {
    let q = supabase
      .from('asistencias_materia')
      .select('fecha, estado, estudiante_id, materia_id, profesor_id, hora_llegada, minutos_retraso, materias(nombre)')
            .gte('fecha', fechaInicio)
      .lte('fecha', fechaFin)
      .order('fecha')
      .order('estudiante_id')
      .range(from, from + PAGE - 1)
    q = esTecnica ? q.in('curso_id', await cursosDelGrado(cursoId)) : q.eq('curso_id', cursoId)
    if (materiaId)  q = q.eq('materia_id', materiaId)
    if (profesorId) q = q.eq('profesor_id', profesorId)
    const { data, error } = await q
    if (error) throw error
    const batch = data ?? []
    asistencias.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }

  const nombreCurso = curso?.nombre_completo ?? ''
  const periodo     = `${fechaInicio} al ${fechaFin}`

  const estudiantesMap = {}
  ;(estudiantesCurso ?? []).forEach(e => {
    estudiantesMap[e.id] = e.usuarios?.nombre_completo ?? 'Sin nombre'
  })

  const estudiantes = (estudiantesCurso ?? [])
    .sort((a, b) => (estudiantesMap[a.id] ?? '').localeCompare(estudiantesMap[b.id] ?? ''))
    .map(e => ({ id: e.id, nombre_completo: estudiantesMap[e.id] }))

    // Varias materias el mismo día: FALTA > LICENCIA > RETRASO > PRESENTE
  const prioridad = { falta: 4, licencia: 3, retraso: 2, presente: 1 }
  const asistenciaMap = {}
  const detalleMap = {}
  for (const a of asistencias) {
    const key = `${a.estudiante_id}_${a.fecha}`
    if (!detalleMap[key]) detalleMap[key] = []
    detalleMap[key].push({
      materia: a.materias?.nombre ?? 'Materia',
      estado: a.estado,
      llegada: textoLlegada(a),   // solo marcas tomadas por QR
    })
    const prev = asistenciaMap[key]
    if (!prev || (prioridad[a.estado] ?? 0) > (prioridad[prev.estado] ?? 0)) {
      asistenciaMap[key] = a
    }
  }

  const diasUnicos = [...new Set(asistencias.map(a => a.fecha))].sort()

  const obtenerDiaSemana = (fechaStr) => {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    return dias[new Date(fechaStr + 'T00:00:00').getDay()]
  }
    const obtenerDiaMes = (fechaStr) => {
    const d = new Date(fechaStr + 'T00:00:00')
    const dia = String(d.getDate()).padStart(2, '0')
    const mes = String(d.getMonth() + 1).padStart(2, '0')
    return `${dia}/${mes}`
  }

  const workbook = opts.workbook || new ExcelJS.Workbook()
  const sheet    = workbook.addWorksheet('Asistencia')

  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true,
    fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
  }

  const totalCols = 2 + Math.max(diasUnicos.length, 0) + 6

    const colsSpan = Math.max(totalCols, 8)

  const row1 = sheet.addRow([`CONTROL DE ASISTENCIA - ${periodo.toUpperCase()}`])
  sheet.mergeCells(1, 1, 1, colsSpan)
  row1.height = 25
  row1.getCell(1).font      = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  row1.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  row1.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' }

  // Encabezado a todo el ancho (no usa el ancho 3.2 de los días)
  const row2 = sheet.addRow([
    `Materia: ${nombreMateria}   |   Curso: ${nombreCurso}   |   Profesor: ${nombreProfesor}`
  ])
  sheet.mergeCells(2, 1, 2, colsSpan)
  row2.height = 18

  const row3 = sheet.addRow([
    `Período: ${fechaInicio} al ${fechaFin}   |   Gestión: ${Config.año}`
  ])
  sheet.mergeCells(3, 1, 3, colsSpan)
  row3.height = 18

  ;[row2, row3].forEach(row => {
    const cell = row.getCell(1)
    cell.font      = { name: 'Arial', size: 9, bold: true }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }
    }
  })

  if (!diasUnicos.length || !estudiantes.length) {
    sheet.addRow(['Sin registros de asistencia en ese rango'])
  } else {
    const headerRow = ['N°', 'Estudiante']
    diasUnicos.forEach(f => headerRow.push(`${obtenerDiaSemana(f)}\n${obtenerDiaMes(f)}`))
    headerRow.push('P', 'F', 'R', 'L', 'TD', '%')

    const row4 = sheet.addRow(headerRow)
    row4.height = 80
    row4.eachCell((cell, colNum) => {
      cell.font      = { name: 'Arial', size: 8, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } }
      cell.alignment = {
        vertical: 'middle', horizontal: 'center', wrapText: true,
        textRotation: colNum > 2 && colNum <= 2 + diasUnicos.length ? 90 : 0
      }
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFFFFFFF' } },
        left:   { style: 'thin', color: { argb: 'FFFFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        right:  { style: 'thin', color: { argb: 'FFFFFFFF' } }
      }
    })

    sheet.getColumn(1).width = 4
    sheet.getColumn(2).width = 25
    for (let i = 3; i <= 2 + diasUnicos.length; i++) sheet.getColumn(i).width = 3.2
    const sc = 3 + diasUnicos.length
    ;[4, 4, 4, 4, 4, 6].forEach((w, i) => sheet.getColumn(sc + i).width = w)

    const firstDataRow = 5
    estudiantes.forEach((estudiante, index) => {
      const rowData    = [index + 1, estudiante.nombre_completo]
      const dataRowNum = firstDataRow + index
      const firstCol   = 'C'
      const lastCol    = String.fromCharCode(67 + diasUnicos.length - 1)

                  diasUnicos.forEach(fecha => {
        const key    = `${estudiante.id}_${fecha}`
        const a      = asistenciaMap[key]
        const estado = a ? a.estado.charAt(0).toUpperCase() : ''
        rowData.push(estado)
      })

      rowData.push(
        { formula: `COUNTIF(${firstCol}${dataRowNum}:${lastCol}${dataRowNum},"P")` },
        { formula: `COUNTIF(${firstCol}${dataRowNum}:${lastCol}${dataRowNum},"F")` },
        { formula: `COUNTIF(${firstCol}${dataRowNum}:${lastCol}${dataRowNum},"R")` },
        { formula: `COUNTIF(${firstCol}${dataRowNum}:${lastCol}${dataRowNum},"L")` },
        { formula: `COUNTA(${firstCol}${dataRowNum}:${lastCol}${dataRowNum})` },
        { formula: `IFERROR(${String.fromCharCode(67 + diasUnicos.length)}${dataRowNum}/COUNTA(${firstCol}${dataRowNum}:${lastCol}${dataRowNum}),0)` }
      )

      const dataRow  = sheet.addRow(rowData)
      dataRow.height = 20

      dataRow.eachCell((cell, colNum) => {
        cell.font      = { name: 'Arial', size: 9 }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border    = {
          top:    { style: 'thin', color: { argb: 'FFD0D0D0' } },
          left:   { style: 'thin', color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          right:  { style: 'thin', color: { argb: 'FFD0D0D0' } }
        }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF9F9F9' } }

        if (colNum === 2) cell.alignment = { vertical: 'middle', horizontal: 'left' }

                if (colNum > 2 && colNum <= 2 + diasUnicos.length) {
          const fecha     = diasUnicos[colNum - 3]
          const diaSemana = new Date(fecha + 'T00:00:00').getDay()
          const valor     = cell.value
          if (diaSemana === 0)    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
          else if (valor === 'F') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
          else if (valor === 'R') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } }
          else if (valor === 'L') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEEFF' } }
          else if (valor === '')  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } }

                    // Note solo cuando hay más de una materia ese día (caso director)
          // Formato: una materia por línea + fuente más pequeña (~30 %)
          const key = `${estudiante.id}_${fecha}`
          const det = detalleMap[key]
          const conQr = det?.some(d => d.llegada)
          if (det && (det.length > 1 || conQr)) {
            const letraDia = valor || ''
            const lineas = det.length > 1 ? [
              `Día: ${letraDia}`,
              ...det.map(d => {
                const abrev = _abreviarMateria(d.materia)
                const est   = (d.estado || '').charAt(0).toUpperCase()
                return `${abrev}: ${est}${d.llegada ? ` · ${d.llegada.replace('Entró al aula ', 'aula ').replace(' (QR)', '')}` : ''}`
              })
            ] : [det[0].llegada]            // una sola materia tomada por QR: "Entró al aula 14:25 · 15 min tarde (QR)
            cell.note = {
              texts: [{
                font: { size: 7, name: 'Arial' },
                text: lineas.join('\n')
              }]
            }
          }
        }

        if (colNum === totalCols) {
          cell.numFmt = '0.0%'
          cell.font   = { name: 'Arial', size: 9, bold: true }
        }
      })
    })

    const lastDataRow = firstDataRow + estudiantes.length - 1
    const percentCol  = totalCols

    // Columna % coloreada por umbral
    const colLetter = (n) => {
      let s = ''
      while (n > 0) {
        const m = (n - 1) % 26
        s = String.fromCharCode(65 + m) + s
        n = Math.floor((n - 1) / 26)
      }
      return s
    }
    const pColLetter = colLetter(percentCol)

    sheet.addConditionalFormatting({
      ref: `${pColLetter}${firstDataRow}:${pColLetter}${lastDataRow}`,
      rules: [
        { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [0.9], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } } } },
        { type: 'cellIs', operator: 'between', formulae: [0.75, 0.89], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } } } },
        { type: 'cellIs', operator: 'lessThan', formulae: [0.75], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } } } }
      ]
    })

    // ── RESUMEN DEL PERÍODO ──
    const resumenStart = lastDataRow + 2
    const pCol = pColLetter

    const addResumenRow = (rowNum, label, value, bgVal) => {
      const r = sheet.getRow(rowNum)
      r.values = [label, value]
      r.height = 18
      r.getCell(1).font      = { name: 'Arial', size: 9, bold: true }
      r.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      r.getCell(2).font      = { name: 'Arial', size: 9 }
      r.getCell(2).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgVal } }
      r.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' }
      r.eachCell(cell => {
        cell.border = {
          top:    { style: 'thin',   color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin',   color: { argb: 'FFD0D0D0' } },
          left:   { style: 'medium', color: { argb: 'FF000000' } },
          right:  { style: 'medium', color: { argb: 'FF000000' } }
        }
      })
    }

    const tRow = sheet.getRow(resumenStart)
    tRow.values = ['RESUMEN DEL PERÍODO']
    sheet.mergeCells(resumenStart, 1, resumenStart, 2)
    tRow.height = 22
    tRow.getCell(1).font      = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    tRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    tRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' }

    addResumenRow(resumenStart + 1, 'Total días hábiles:', diasUnicos.length, 'FFFFFFFF')
    addResumenRow(resumenStart + 2, 'Promedio asistencia:', { formula: `AVERAGE(${pCol}${firstDataRow}:${pCol}${lastDataRow})` }, 'FFFFFFFF')
    addResumenRow(resumenStart + 3, 'Estudiantes con ≥90%:', { formula: `COUNTIF(${pCol}${firstDataRow}:${pCol}${lastDataRow},">=0.9")` }, 'FFC6EFCE')
    addResumenRow(resumenStart + 4, 'Estudiantes en riesgo (<75%):', { formula: `COUNTIF(${pCol}${firstDataRow}:${pCol}${lastDataRow},"<0.75")` }, 'FFFFC7CE')
    sheet.getRow(resumenStart + 2).getCell(2).numFmt = '0.0%'
  }

    // Si viene workbook externo (export de calificaciones), solo agrega la hoja
  if (opts.workbook) return

  const buffer = await workbook.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = window.URL.createObjectURL(blob)
  const link   = document.createElement('a')
  link.href     = url
  link.download = `asistencias_${nombreCurso.replace(/\s/g,'_')}_${fechaInicio}_${fechaFin}.xlsx`
  link.click()
  window.URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────
// EXPORTAR DETALLE DE NOTAS POR DIMENSIÓN (ExcelJS)
//
// Estructura del Excel:
//   Pestaña "Resumen General"  — solo lectura, fórmulas hacia las hojas de dimensión
//   Pestaña "HACER"            — notas editables, promedios protegidos, validación máx 40
//   Pestaña "SABER"            — notas editables, promedios protegidos, validación máx 45
//   Pestaña "SER"              — nota directa editable, validación máx 10
//   Pestaña "AUTOEVALUACIÓN"   — nota directa editable, validación máx 5
//
// Celdas editables  → fondo blanco, borde color dimensión, sin protección
// Celdas calculadas → color dimensión, protegidas (sin contraseña)
// Resumen General   → 100% protegido, fórmulas entre hojas
// ─────────────────────────────────────────────────────────
export async function exportarDetalleNotasExcel({ cursoId, materiaId, periodo, soloCurso = false, profesorId = null, nombreDocente = null, fechaInicio = null, fechaFin = null }) {
  if (typeof ExcelJS === 'undefined') { console.error('ExcelJS no está cargado.'); return }

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  // ── Fetch de datos ────────────────────────────────────
  const [
    { data: curso },
    { data: materia },
    estudiantesResult,
  ] = await Promise.all([
    supabase.from('cursos').select('nombre_completo').eq('id', cursoId).single(),
    supabase.from('materias').select('nombre').eq('id', materiaId).single(),
    esTecnica
      ? supabase.from('inscripciones_tecnicas')
          .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
          .eq('materia_id', materiaId).eq('activo', true).in('estudiantes.curso_id', await cursosDelGrado(cursoId))
          .match(soloCurso ? { curso_id: cursoId } : {})
      : supabase.from('estudiantes')
          .select('id, usuarios(nombre_completo)')
          .eq('curso_id', cursoId),
  ])

  const estudiantesRaw = esTecnica
    ? (estudiantesResult.data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios }))
    : (estudiantesResult.data ?? [])

  const estudiantes = (estudiantesRaw ?? [])
    .sort((a, b) => (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

  // ── Actividades ───────────────────────────────────────
  let qActs = supabase.from('actividades')
    .select('id, titulo, tipo, max_puntos, trimestre')
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .order('created_at', { ascending: true })
  qActs = esTecnica ? qActs.in('curso_id', await cursosDelGrado(cursoId)) : qActs.eq('curso_id', cursoId)
  if (profesorId) qActs = qActs.eq('creado_por', profesorId)
  const { data: actividades } = await qActs

  // ── Notas individuales ────────────────────────────────
  let notasMap = {}
  const actIds = (actividades ?? []).map(a => a.id)
  if (actIds.length) {
    const { data: notas } = await paginar(() => supabase.from('notas')
      .select('actividad_id, estudiante_id, valor')
      .in('actividad_id', actIds))
    ;(notas ?? []).forEach(n => { notasMap[`${n.actividad_id}_${n.estudiante_id}`] = n.valor })
  }

  // ── Notas de traslado (solo materias regulares) ───────
  // Actividades de esta materia y periodo en OTRO paralelo, de los estudiantes que hoy
  // están en este curso. Van en columnas grises BLOQUEADAS: NO se registran en la hoja
  // Meta, así que la importación nunca escribe sobre ellas.
  let actsTraslado = []
  if (!esTecnica && estudiantes.length) {
    const { data: tr } = await paginar(() => supabase.from('notas')
      .select('estudiante_id, valor, act:actividades!inner(id, titulo, tipo, max_puntos, created_at, materia_id, trimestre, curso_id, curso:cursos(nombre_completo))')
      .in('estudiante_id', estudiantes.map(e => e.id))
      .eq('act.materia_id', materiaId)
      .eq('act.trimestre', periodo)
      .neq('act.curso_id', cursoId))
    const vistos = {}
    ;(tr ?? []).forEach(n => {
      if (n.valor == null || !n.act) return
      if (!vistos[n.act.id]) {
        vistos[n.act.id] = true
        actsTraslado.push({ ...n.act, curso: n.act.curso?.nombre_completo ?? 'otro paralelo' })
      }
      notasMap[`${n.act.id}_${n.estudiante_id}`] = n.valor
    })
    actsTraslado.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  }

  // ── Calificaciones directas SER / DECIDIR ────────────
  let calMap = {}
  if (estudiantes.length) {
    const { data: cals } = await paginar(() => supabase.from('calificaciones')
      .select('estudiante_id, nota_ser, nota_decidir')
      .eq('materia_id', materiaId)
      .eq('trimestre', periodo))
    ;(cals ?? []).forEach(c => { calMap[c.estudiante_id] = c })
  }

  // ── Ficha SER publicada (detalle por criterio, solo informativo) ──
  // La publicación deja UNA ficha publicada por estudiante/materia/trimestre y copia su nota
  // a calificaciones.nota_ser. Aquí solo se muestran los puntajes de cada criterio.
  const fichaMap = {}   // estudiante_id -> { valores, nota }
  const gruposSer = Config.subcriteriosPorCategoria?.() ?? []
  if (estudiantes.length && gruposSer.length) {
    try {
      const { data: fichas } = await supabase.from('fichas_seguimiento_ser')
        .select('estudiante_id, valores, nota_calculada')
        .eq('materia_id', materiaId).eq('trimestre', periodo).eq('año', Config.año).eq('publicada', true)
      ;(fichas ?? []).forEach(f => { fichaMap[f.estudiante_id] = { valores: f.valores ?? {}, nota: f.nota_calculada } })
    } catch (e) { console.warn('[export-excel] fichas SER:', e) }
  }

  // ── Rúbrica de calificación (opcional por actividad) ──
  let rubricaCriteriosMap = {}   // actividad_id -> [criterios]
  let rubricaCalifMap     = {}   // `${actividad_id}_${estudiante_id}` -> { criterio_id: puntos }
  if (actIds.length) {
    const { data: rc } = await supabase.from('rubrica_criterios')
      .select('*').in('actividad_id', actIds).order('orden')
    ;(rc ?? []).forEach(c => {
      if (!rubricaCriteriosMap[c.actividad_id]) rubricaCriteriosMap[c.actividad_id] = []
      rubricaCriteriosMap[c.actividad_id].push(c)
    })
    if (Object.keys(rubricaCriteriosMap).length) {
      const { data: notasConId } = await paginar(() => supabase.from('notas')
        .select('id, actividad_id, estudiante_id')
        .in('actividad_id', Object.keys(rubricaCriteriosMap)))
      const notaIdMap = {}   // notas.id -> `${actividad_id}_${estudiante_id}`
      ;(notasConId ?? []).forEach(n => { notaIdMap[n.id] = `${n.actividad_id}_${n.estudiante_id}` })
      const notaIds = Object.keys(notaIdMap)
      if (notaIds.length) {
        const { data: rcal } = await supabase.from('rubrica_calificaciones')
          .select('*').in('nota_id', notaIds)
        ;(rcal ?? []).forEach(x => {
          const clave = notaIdMap[x.nota_id]
          if (!clave) return
          if (!rubricaCalifMap[clave]) rubricaCalifMap[clave] = {}
          rubricaCalifMap[clave][x.criterio_id] = x.puntos_obtenidos
        })
      }
    }
  }

  const dims        = Config.dimensiones
  const periName    = Config.nombrePeriodo
  const nombreCurso = curso?.nombre_completo ?? ''
  const nomMateria  = materia?.nombre ?? 'Materia'
  const etiqDocente = nombreDocente ?? 'Dirección'
  const fechaExport = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' })

  // ── Máximos por dimensión para validación ────────────
  // Se usan en la validación de datos de Excel y en las fórmulas
  const DIM_MAX = {
    hacer:   40,
    saber:   45,
    ser:     10,
    decidir: 5,
  }

  // ── Utilidad: número de columna → letra(s) Excel ─────
  const colLetter = (n) => {
    let s = ''
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) }
    return s
  }

  // _encabezado agrega 5 filas (título, curso, docente, aviso, separador)
  // luego se agrega 1 fila de cabecera de columnas (fila 6)
  // por lo tanto los datos de estudiantes empiezan en la fila 7
  const DATA_START_ROW = 7

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Gestión Educativa 2027'
  wb.created = new Date()

  // Mapa: codigo dimensión → nombre exacto de hoja en el workbook
  const wsNameMap = {}

  // Metadatos para el import de notas (hoja "Meta"): dónde vive cada actividad/columna
  const metaActs      = []   // { actividad_id, titulo, tipo, hoja, columna }
  const metaDirectas  = []   // { codigo, campo, hoja, columna, max }

  // ═══════════════════════════════════════════════════════
  // PASO 1 — Resumen General (se crea primero para que quede
  //          como primera pestaña; se rellena en PASO 3 una
  //          vez que wsNameMap esté completo)
  // ═══════════════════════════════════════════════════════
  const wsRes = wb.addWorksheet('Resumen General')
  wsRes.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }

  // ═══════════════════════════════════════════════════════
  // PASO 2 — Hojas de dimensión
  // ═══════════════════════════════════════════════════════
  for (const dim of dims) {
    const colors    = DIM_COLORS[dim.codigo] ?? DEFAULT_COLOR
    const actsPropias = (actividades ?? []).filter(a => a.tipo === dim.codigo)
    const actsTrDim   = actsTraslado.filter(a => a.tipo === dim.codigo)
    // Propias primero (editables, en Meta); traslado al final (bloqueadas, fuera de Meta)
    const actsOfDim = [...actsPropias, ...actsTrDim]
    const nPropias  = actsPropias.length
    const sheetName = dim.nombre.substring(0, 31)
    wsNameMap[dim.codigo] = sheetName

    const ws = wb.addWorksheet(sheetName)
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }

    // Máximo de la dimensión para validaciones
    const dimMax = DIM_MAX[dim.codigo] ?? dim.peso_maximo

    if (dim.tipo === 'actividades') {
      // ────────────────────────────────────────────────
      // HOJA DE DIMENSIÓN CON ACTIVIDADES (HACER / SABER)
      // Columnas: N°(1) | Nombre(2) | Act1..ActN(3..2+n) | PromPond(3+n) | NotaDim(4+n) | %Alc(5+n)
      // ────────────────────────────────────────────────
      const nActs   = actsOfDim.length
      const colProm = 3 + nActs
      const colNota = 4 + nActs
      const colPct  = 5 + nActs
      const totalCols = colPct

      // ── Encabezado ──────────────────────────────────
      _encabezado(ws, {
        titulo:     `${dim.nombre} — ${nomMateria} — ${periName} ${periodo} — Gestión ${Config.año}`,
        curso:      nombreCurso,
        docente:    etiqDocente,
        info:       `Peso máximo dimensión: ${dimMax} pts · Nota máxima por actividad según su configuración`,
        aviso:      `⚠ Las columnas de color ${dim.nombre} son EDITABLES. Promedio y % se calculan automáticamente.`,
        totalCols:  Math.max(totalCols, 5),
        colorFondo: colors.header,
        fechaExport,
      })

      if (!nActs) {
        ws.addRow([`Sin actividades registradas en ${dim.nombre} para este período`])
        ws.protect('', _opcionesProteccion())
        continue
      }

      actsPropias.forEach((a, i) => metaActs.push({
        actividad_id: a.id, titulo: a.titulo, tipo: a.tipo, hoja: sheetName, columna: 3 + i,
      }))

      // ── Cabecera de columnas ─────────────────────────
      const headerD = [
        'N°', 'Estudiante',
        ...actsOfDim.map((a, i) => i >= nPropias
          ? `TRASLADO · ${a.curso}\n${a.titulo}\n(máx ${a.max_puntos}) solo lectura`
          : `${a.titulo}\n(máx ${a.max_puntos})${rubricaCriteriosMap[a.id]?.length ? '\n⚠ rúbrica: calificar en la web' : ''}`),
        'Promedio\nPonderado',
        `Nota ${dim.nombre}\n(/${dimMax})`,
        '% Alcanzado',
      ]
      const rDH = ws.addRow(headerD)
      rDH.height = 65
      rDH.eachCell((cell, col) => {
        const isActCol = col >= 3 && col <= 2 + nActs
        const isTrCol  = col >= 3 + nPropias && col <= 2 + nActs
        cell.font      = { name: 'Arial', size: 8, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: isTrCol ? 'FF9CA3AF' : isActCol ? colors.header : 'FF1F3864' } }
        cell.alignment = {
          vertical: 'middle', horizontal: 'center', wrapText: true,
          textRotation: isActCol && nActs > 3 ? 90 : 0,
        }
        cell.border     = _bBlanco()
        cell.protection = { locked: true }
      })

      // ── Anchos ──────────────────────────────────────
      ws.getColumn(1).width = 4
      ws.getColumn(2).width = 30
      for (let i = 0; i < nActs; i++) ws.getColumn(3 + i).width = nActs > 8 ? 5 : 9
      ws.getColumn(colProm).width = 13
      ws.getColumn(colNota).width = 15
      ws.getColumn(colPct).width  = 13

      // ── Filas de estudiantes ─────────────────────────
      estudiantes.forEach((est, idx) => {
        const dataRow = DATA_START_ROW + idx

        // Valores reales del sistema (para prellenar)
        const valsActs = actsOfDim.map(a => {
          const v = notasMap[`${a.id}_${est.id}`]
          return v != null ? parseFloat(v) : ''
        })

        const r = ws.addRow([
          idx + 1,
          est.usuarios?.nombre_completo ?? '—',
          ...valsActs,
          '',   // promedio → fórmula
          '',   // nota dim → fórmula
          '',   // % alc    → fórmula
        ])
        r.height = 20

        // ── Fórmulas en columnas calculadas ─────────────
        // Cada actividad se normaliza: (nota_act / max_act) * peso_max_dim
        // Luego se promedia entre todas las actividades con nota ingresada
        const partes = actsOfDim.map((a, i) => {
          const cL  = colLetter(3 + i)
          const max = parseFloat(a.max_puntos)
          // Solo cuenta si hay valor numérico en esa celda
          return `IF(ISNUMBER(${cL}${dataRow}),(${cL}${dataRow}/${max})*${dimMax},"")`
        })

        // AVERAGEIF equivalente: suma de partes numéricas / cantidad de partes numéricas
        const sumaPartes  = partes.map(p => `IF(ISNUMBER(${p}),${p},0)`).join('+')
        const countPartes = actsOfDim.map((_, i) => `IF(ISNUMBER(${colLetter(3+i)}${dataRow}),1,0)`).join('+')
        const fProm = actsOfDim.length
          ? `IFERROR(IF((${countPartes})=0,"",ROUND((${sumaPartes})/(${countPartes}),1)),"")`
          : `""`

        // Nota dimensión = promedio ponderado redondeado a 2 decimales
        const cProm = colLetter(colProm)
        const fNota = `IFERROR(IF(${cProm}${dataRow}="","",ROUND(${cProm}${dataRow},2)),"")`

        // % alcanzado
        const cNota = colLetter(colNota)
        const fPct  = `IFERROR(IF(${cNota}${dataRow}="","",${cNota}${dataRow}/${dimMax}),"")`

        r.getCell(colProm).value = { formula: fProm }
        r.getCell(colNota).value = { formula: fNota }
        r.getCell(colPct).value  = { formula: fPct }
        r.getCell(colPct).numFmt = '0.00%'

        // ── Estilos ──────────────────────────────────────
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          const isActCol  = col >= 3 && col <= 2 + nActs
          const isTrCol   = col >= 3 + nPropias && col <= 2 + nActs
          const isCalcCol = col >= colProm

          cell.font      = { name: 'Arial', size: 9 }
          cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' }
          cell.border    = _bGris()

          if (isTrCol) {
            // TRASLADO — gris, BLOQUEADA (no está en Meta: la importación la ignora)
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
            cell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF4B5563' } }
            cell.protection = { locked: true }
          } else if (isActCol) {
            // EDITABLE — fondo blanco, borde color dimensión
            const val = valsActs[col - 3]
            cell.fill = {
              type: 'pattern', pattern: 'solid',
              fgColor: { argb: val === '' ? 'FFFAFAFA' : 'FFFFFFFF' },
            }
            cell.border = {
              top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
              bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
              left:   { style: 'thin', color: { argb: colors.header } },
              right:  { style: 'thin', color: { argb: colors.header } },
            }
            cell.protection = { locked: false }   // ← EDITABLE
          } else if (isCalcCol) {
            // CALCULADA — color dimensión, protegida
            cell.fill = {
              type: 'pattern', pattern: 'solid',
              fgColor: { argb: idx % 2 === 0 ? colors.light : colors.mid },
            }
            cell.font       = { name: 'Arial', size: 9, bold: true }
            cell.protection = { locked: true }
          } else {
            // N° y Nombre — protegidos
            cell.fill = {
              type: 'pattern', pattern: 'solid',
              fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB' },
            }
            cell.protection = { locked: true }
          }
        })

        // ── Validación de datos por actividad ────────────
        // Cada celda de actividad: mínimo 0, máximo = max_puntos de esa actividad
        actsPropias.forEach((act, i) => {
          const cL  = colLetter(3 + i)
          const max = parseFloat(act.max_puntos)
          ws.getCell(`${cL}${dataRow}`).dataValidation = {
            type:           'decimal',
            operator:       'between',
            formulae:       [0, max],
            allowBlank:     true,
            showErrorMessage: true,
            errorStyle:     'stop',
            errorTitle:     '⚠ Nota fuera de rango',
            error:          `La nota debe estar entre 0 y ${max} para la actividad "${act.titulo}". Corrija el valor ingresado.`,
            showInputMessage: true,
            promptTitle:    act.titulo,
            prompt:         `Ingrese una nota entre 0 y ${max}`,
          }
        })
      })

      // Congelar: 2 columnas + filas de encabezado
      ws.views = [{
        state:      'frozen',
        xSplit:     2,
        ySplit:     DATA_START_ROW,
        activeCell: `C${DATA_START_ROW + 1}`,
      }]

      // ── Protección de hoja SIN contraseña ───────────
      ws.protect('', _opcionesProteccion())

    } else {
      // ────────────────────────────────────────────────
      // HOJA DE DIMENSIÓN DIRECTA (SER / AUTOEVALUACIÓN)
      // Columnas: N°(1) | Nombre(2) | Nota(3) | Máximo(4) | %Alc(5)
      // ────────────────────────────────────────────────
      // SER con ficha: columnas de criterios DESPUÉS de la 5 (la Nota sigue en la columna 3,
      // que es la que registra Meta → la importación no cambia). Solo informativas, protegidas.
      // Una columna por CATEGORÍA (la que configura el director); el detalle por criterio va en la nota de la celda
      const crit = dim.tipo === 'ficha' ? gruposSer : []
      const nivel = v => { const e = (Config.escalaSer ?? []).find(x => Number(x.valor) === Number(v)); return e?.etiqueta ? `${e.etiqueta} (${v})` : String(v) }
      _encabezado(ws, {
        titulo:     `${dim.nombre} — ${nomMateria} — ${periName} ${periodo} — Gestión ${Config.año}`,
        curso:      nombreCurso,
        docente:    etiqDocente,
        info:       `Peso máximo: ${dimMax} pts · Calificación directa por estudiante${crit.length ? ' · Categorías: puntaje de la Ficha SER publicada (pasa el cursor para ver los niveles)' : ''}`,
        aviso:      `⚠ La columna "Nota ${dim.nombre}" es EDITABLE. El % se calcula automáticamente.`,
        totalCols:  5 + crit.length,
        colorFondo: colors.header,
        fechaExport,
      })

      const rDH = ws.addRow(['N°', 'Estudiante', `Nota ${dim.nombre}`, 'Máximo', '% Alcanzado',
        ...crit.map(g => String(g.categoria ?? '').toUpperCase())])
      rDH.height = crit.length ? 95 : 35
      rDH.eachCell((cell, col) => {
        cell.font      = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: col === 3 ? colors.header : 'FF1F3864' } }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.border    = _bBlanco()
        cell.protection = { locked: true }
      })
      crit.forEach((_, k) => { rDH.getCell(6 + k).alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center', wrapText: true } })

      ws.getColumn(1).width = 4
      ws.getColumn(2).width = 30
      ws.getColumn(3).width = 16
      ws.getColumn(4).width = 10
      ws.getColumn(5).width = 14
      crit.forEach((_, k) => { ws.getColumn(6 + k).width = 6 })

      const campo = dim.tipo === 'ficha' ? 'nota_ser' : 'nota_decidir'
      metaDirectas.push({ codigo: dim.codigo, campo, hoja: sheetName, columna: 3, max: dimMax })

      estudiantes.forEach((est, idx) => {
        const dataRow = DATA_START_ROW + idx
        const cal     = calMap[est.id]
        // Sin nota en el sistema → celda VACÍA (no 0): el import distingue vacío de cero
        const notaSistema = cal?.[campo]
        const nota        = notaSistema != null ? parseFloat(notaSistema) : 0   // solo para el color del %
        const celdaNota   = notaSistema != null ? nota : ''

        // Criterios: puntaje del nivel elegido en la ficha publicada; si la nota es directa, "Directa"
        const ficha = dim.tipo === 'ficha' ? fichaMap[est.id] : null   // la ficha es solo del SER
        // Puntaje de la categoría = promedio de sus criterios, redondeado
        const celdasCrit = crit.map(g => {
          if (!ficha) return ''
          const vs = g.items.map(it => ficha.valores?.[it.subcriterio_id]).filter(v => v != null).map(Number)
          return vs.length ? notaOficial(vs.reduce((a, b) => a + b, 0) / vs.length) : ''
        })
        const r = ws.addRow([idx + 1, est.usuarios?.nombre_completo ?? '—', celdaNota, dimMax, '', ...celdasCrit])
        r.height = 20
        if (ficha && notaSistema != null) {
          r.getCell(3).note = `Nota de la Ficha SER publicada (promedio de los criterios): ${Number(ficha.nota).toFixed(2)}`
          // Se ve redondeada (9,7 → 10) pero la celda guarda el valor exacto: al reimportar coincide con el sistema
          r.getCell(3).numFmt = '0'
          // Al pasar el cursor por la categoría: cada criterio con el nivel elegido
          crit.forEach((g, k) => {
            r.getCell(6 + k).note = g.items.map(it => `${it.texto}: ${ficha.valores?.[it.subcriterio_id] != null ? nivel(ficha.valores[it.subcriterio_id]) : '—'}`).join('\n')
          })
        } else if (crit.length && notaSistema != null) {
          r.getCell(3).note = 'Nota directa, sin Ficha SER'
        }

        // Fórmula % alcanzado referenciando la nota editable (columna C)
        r.getCell(5).value  = { formula: `IFERROR(IF(C${dataRow}="","",C${dataRow}/D${dataRow}),"")` }
        r.getCell(5).numFmt = '0.00%'

        r.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.font      = { name: 'Arial', size: 9 }
          cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' }
          cell.border    = _bGris()

          if (col === 3) {
            // EDITABLE — fondo blanco, borde color dimensión
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
            cell.border = {
              top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
              bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
              left:   { style: 'thin', color: { argb: colors.header } },
              right:  { style: 'thin', color: { argb: colors.header } },
            }
            cell.font       = { name: 'Arial', size: 9, bold: true }
            cell.protection = { locked: false }   // ← EDITABLE
          } else if (col > 5) {
            // Categoría de la ficha — solo lectura
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? colors.light : colors.mid } }
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1F2937' } }
            cell.protection = { locked: true }
          } else if (col === 5) {
            // % calculado — color semáforo, protegido
            const pct = dimMax > 0 ? nota / dimMax : 0
            cell.fill = {
              type: 'pattern', pattern: 'solid',
              fgColor: { argb: pct >= 0.9 ? 'FFD1FAE5' : pct >= 0.5 ? 'FFFEF3C7' : 'FFFEE2E2' },
            }
            cell.font       = { name: 'Arial', size: 9, bold: true,
              color: { argb: pct >= 0.9 ? 'FF166534' : pct >= 0.5 ? 'FF92400E' : 'FF991B1B' } }
            cell.protection = { locked: true }
          } else {
            cell.fill = {
              type: 'pattern', pattern: 'solid',
              fgColor: { argb: idx % 2 === 0 ? colors.light : colors.mid },
            }
            cell.protection = { locked: true }
          }
        })

        // ── Validación: nota entre 0 y dimMax ────────────
        ws.getCell(`C${dataRow}`).dataValidation = {
          type:             'decimal',
          operator:         'between',
          formulae:         [0, dimMax],
          allowBlank:       true,
          showErrorMessage: true,
          errorStyle:       'stop',
          errorTitle:       '⚠ Nota fuera de rango',
          error:            `La nota para ${dim.nombre} debe estar entre 0 y ${dimMax}. Corrija el valor ingresado.`,
          showInputMessage: true,
          promptTitle:      `Nota ${dim.nombre}`,
          prompt:           `Ingrese un valor entre 0 y ${dimMax}`,
        }
      })

      ws.views = [{ state: 'frozen', xSplit: 2, ySplit: DATA_START_ROW }]
      ws.protect('', _opcionesProteccion())
    }
  }

  // ═══════════════════════════════════════════════════════
  // PASO 3 — Rellenar el Resumen General con fórmulas
  //          que apuntan a las hojas de dimensión ya creadas
  // ═══════════════════════════════════════════════════════
  const totalColsRes = 2 + dims.length + 2   // N°, Nombre, [dims], Total, Estado

  _encabezado(wsRes, {
    titulo:     `DETALLE DE NOTAS — ${nomMateria} — ${periName} ${periodo} — Gestión ${Config.año}`,
    curso:      nombreCurso,
    docente:    etiqDocente,
    info:       `Nota mínima aprobación: ${Config.notaMinima} · Total estudiantes: ${estudiantes.length}`,
    aviso:      `🔒 Esta hoja es de solo lectura. Para modificar datos vaya a la pestaña de cada dimensión.`,
    totalCols:  totalColsRes,
    colorFondo: 'FF1F3864',
    fechaExport,
    tituloGrande: true,
  })

  // ── Cabecera de columnas del resumen ──────────────────
  const headerRes = [
    'N°', 'Estudiante',
    ...dims.map(d => `${d.nombre}\n(/${DIM_MAX[d.codigo] ?? d.peso_maximo})`),
    `Total\n(${Config.escalaMaxima ?? 100})`,
    'Estado',
  ]
  const rH = wsRes.addRow(headerRes)
  rH.height = 50
  rH.eachCell((cell, col) => {
    const dim    = dims[col - 3]
    const colors = dim ? (DIM_COLORS[dim.codigo] ?? DEFAULT_COLOR) : null
    cell.font      = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors ? colors.header : 'FF1F3864' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border    = _bBlanco()
    cell.protection = { locked: true }
  })

  wsRes.getColumn(1).width = 4
  wsRes.getColumn(2).width = 30
  dims.forEach((_, i) => { wsRes.getColumn(3 + i).width = 15 })
  wsRes.getColumn(3 + dims.length).width = 12
  wsRes.getColumn(4 + dims.length).width = 14

  // ── Filas del resumen con fórmulas entre hojas ────────
  estudiantes.forEach((est, idx) => {
    const dataRow = DATA_START_ROW + idx

    // Para cada dimensión, la nota final está en columnas diferentes según el tipo:
    //   actividades: colNota = 4 + nActs  (columna de "Nota Dimensión")
    //   directa:     columna C (3)        (la nota editada directamente)
    const dimFormulas = dims.map(dim => {
      const safe = _safeSheetRef(wsNameMap[dim.codigo])
      if (dim.tipo === 'actividades') {
        const nActs   = (actividades ?? []).filter(a => a.tipo === dim.codigo).length
          + actsTraslado.filter(a => a.tipo === dim.codigo).length   // columnas de traslado
        const colNota = colLetter(4 + nActs)
        return { formula: `IFERROR(${safe}!${colNota}${dataRow},0)` }
      } else {
        return { formula: `IFERROR(${safe}!C${dataRow},0)` }
      }
    })

    // Total: suma de todas las dimensiones
    const colsTotal = dims.map((_, i) => `${colLetter(3 + i)}${dataRow}`)
    // SUM ignora celdas de texto vacío ("") de SER/Autoevaluación sin nota; con '+' Excel daba #VALUE! → 0
    // Total redondeado al entero (.5 sube), igual que en el sistema
    const fTotal    = `IFERROR(ROUND(SUM(${colsTotal.join(',')}),0),0)`

    // Estado: IF total >= notaMinima
    const colTotalL = colLetter(3 + dims.length)
    const fEstado   = _cerrado(periodo)
      ? `IF(${colTotalL}${dataRow}>=${Config.notaMinima},"${Config.etiqAprobado}","${Config.etiqReprobado}")`
      : '"EN CURSO"'

    const rowData = [idx + 1, est.usuarios?.nombre_completo ?? '—',
      ...dimFormulas,
      { formula: fTotal },
      { formula: fEstado },
    ]
    const r = wsRes.addRow(rowData)
    r.height = 20

    r.eachCell({ includeEmpty: true }, (cell, col) => {
      const dim    = dims[col - 3]
      const colors = dim ? (DIM_COLORS[dim.codigo] ?? DEFAULT_COLOR) : null

      cell.font       = { name: 'Arial', size: 9 }
      cell.alignment  = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' }
      cell.border     = _bGris()
      cell.protection = { locked: true }

      if (colors) {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? colors.light : colors.mid } }
        cell.font = { name: 'Arial', size: 9, bold: true }
        // Solo presentación: se MUESTRA entero (27,5 → 28); la celda conserva el decimal.
        // Hoja de solo lectura: no afecta la importación de notas.
        cell.numFmt = '0'
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB' } }
      }
    })
  })

  // ── Formato condicional: Total y Estado ──────────────
  const colTotalRef  = colLetter(3 + dims.length)
  const colEstadoRef = colLetter(4 + dims.length)
  const rangeFrom    = DATA_START_ROW
  const rangeTo      = DATA_START_ROW + estudiantes.length - 1

  wsRes.addConditionalFormatting({
    ref: `${colTotalRef}${rangeFrom}:${colTotalRef}${rangeTo}`,
    rules: [
      { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [Config.notaMinima],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } },
                 font: { bold: true, color: { argb: 'FF166534' } } } },
      { type: 'cellIs', operator: 'lessThan', formulae: [Config.notaMinima],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } },
                 font: { bold: true, color: { argb: 'FF991B1B' } } } },
    ],
  })

  wsRes.addConditionalFormatting({
    ref: `${colEstadoRef}${rangeFrom}:${colEstadoRef}${rangeTo}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: Config.etiqAprobado,
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } },
                 font: { bold: true, color: { argb: 'FF166534' } } } },
      { type: 'containsText', operator: 'containsText', text: Config.etiqReprobado,
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } },
                 font: { bold: true, color: { argb: 'FF991B1B' } } } },
    ],
  })

  wsRes.views = [{ state: 'frozen', xSplit: 2, ySplit: DATA_START_ROW }]

  // Resumen General: todo protegido, ni siquiera se pueden seleccionar celdas no bloqueadas
  wsRes.protect('', {
    selectLockedCells:   true,
    selectUnlockedCells: false,
    formatCells:   false,
    formatColumns: false,
    formatRows:    false,
    insertRows:    false,
    deleteRows:    false,
    sort:          false,
    autoFilter:    false,
  })

  // ═══════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════
  // PASO 4 — Criterios de calificación (solo si alguna
  //          actividad de esta materia/período tiene rúbrica)
  // Formato compacto: una fila por estudiante, una columna por
  // criterio (no una fila por criterio) -- reduce muchísimo el
  // largo de la hoja. El detalle no se pierde: cada celda de
  // criterio lleva la descripción del nivel obtenido como
  // comentario (aparece al pasar el cursor, no se imprime), y la
  // columna Total lleva el resumen completo de los criterios
  // juntos en un solo comentario. Cada actividad tiene su propio
  // encabezado con un color de fondo suave distinto (en ciclo),
  // para distinguir visualmente dónde empieza cada una.
  // ═══════════════════════════════════════════════════════
  if (Object.keys(rubricaCriteriosMap).length) {
    const wsRub = wb.addWorksheet('Criterios de calificación')
    wsRub.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    wsRub.getColumn(1).width = 28
    for (let i = 2; i <= 10; i++) wsRub.getColumn(i).width = 16

    wsRub.addRow([`Criterios de calificación — ${nomMateria}`]).font = { bold: true, size: 14 }
    wsRub.addRow([`${nombreCurso} · ${periName} ${periodo} · ${etiqDocente}`]).font = { italic: true, color: { argb: 'FF64748B' } }
    wsRub.addRow([])

    // Paleta de fondos suaves por actividad -- se repite en ciclo
    // si hay más actividades que colores en la lista.
    const paletaActividades = ['FFEFF0FF', 'FFECFDF5', 'FFFFF7ED', 'FFF0F9FF', 'FFFDF2F8', 'FFF7FEE7']
    let actividadIndex = 0

    for (const act of (actividades ?? [])) {
      const criterios = rubricaCriteriosMap[act.id]
      if (!criterios || !criterios.length) continue

      const colorFondo = paletaActividades[actividadIndex % paletaActividades.length]
      actividadIndex++
      const nCols = criterios.length + 2 // Estudiante + N criterios + Total

      const filaTitulo = wsRub.addRow([`${act.titulo} (${act.tipo === 'hacer' ? 'Hacer' : 'Saber'} — ${act.max_puntos} pts)`])
      filaTitulo.font = { bold: true, size: 12 }
      wsRub.mergeCells(filaTitulo.number, 1, filaTitulo.number, nCols)
      for (let c = 1; c <= nCols; c++) {
        wsRub.getCell(filaTitulo.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorFondo } }
      }

      const filaCab = wsRub.addRow(['Estudiante', ...criterios.map(c => c.nombre), 'Total'])
      filaCab.font = { bold: true }
      filaCab.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        c.alignment = { wrapText: true, vertical: 'middle' }
      })
      filaCab.height = 32

      let estudianteIndex = 0
      for (const est of estudiantes) {
        const detalle = rubricaCalifMap[`${act.id}_${est.id}`]
        const colorZebra = estudianteIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC'
        let total = 0
        const detalleTexto = []

        const valores = criterios.map(crit => {
          const pts = detalle?.[crit.id]
          if (pts === undefined) {
            detalleTexto.push(`${crit.nombre}: Sin calificar`)
            return 'Sin calificar'
          }
          total += pts
          const nivel = crit.niveles.find(n => Math.abs((crit.puntos_max * n.porcentaje / 100) - pts) < 0.05)
          detalleTexto.push(`${crit.nombre}: ${nivel?.descripcion ?? 'Sin descripción'}`)
          return `${pts}/${crit.puntos_max}`
        })

        const fila = wsRub.addRow([est.usuarios?.nombre_completo ?? '—', ...valores, `${total}/${act.max_puntos}`])
        fila.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorZebra } } })

        criterios.forEach((crit, i) => {
          const pts = detalle?.[crit.id]
          if (pts === undefined) return
          const nivel = crit.niveles.find(n => Math.abs((crit.puntos_max * n.porcentaje / 100) - pts) < 0.05)
          if (nivel) fila.getCell(2 + i).note = nivel.descripcion
        })
        fila.getCell(2 + criterios.length).note = detalleTexto.join('\n')

        estudianteIndex++
      }
      wsRub.addRow([])
    }
  }

    // Hoja de asistencia acoplada (mismo criterio regular / técnica)
  if (fechaInicio && fechaFin) {
    await exportarAsistenciasExcel(cursoId, fechaInicio, fechaFin, {
      materiaId,
      profesorId,
      workbook: wb,
    })
  }

  // ── Hoja Meta (necesaria para importar el Excel de vuelta) ──
  _agregarHojaMeta(wb, {
    materiaId, cursoId, periodo, profesorId,
    año: Config.año,
    actividades: metaActs,
    directas:    metaDirectas,
    estudiantes: estudiantes.map((e, idx) => ({
      estudiante_id: e.id,
      nombre:        e.usuarios?.nombre_completo ?? '—',
      fila:          DATA_START_ROW + idx,
    })),
    filaCabecera: DATA_START_ROW - 1,
  })

  // ── Descargar ─────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href        = url
  a.download    = `detalle_notas_${nomMateria.replace(/[^a-zA-Z0-9]/g, '_')}_T${periodo}_${Config.año}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────
// HELPERS PRIVADOS
// ─────────────────────────────────────────────────────────

/**
 * Agrega el bloque de encabezado estándar de 5 filas:
 *   Fila 1 — Título (fondo color dimensión / azul oscuro)
 *   Fila 2 — Curso e info adicional
 *   Fila 3 — Docente y fecha de exportación
 *   Fila 4 — Aviso editable/protegido
 *   Fila 5 — Separador (altura mínima)
 * Total = 5 filas → cabecera col en fila 6 → DATA_START_ROW = 7
 */
function _encabezado(ws, { titulo, curso, docente, info, aviso, totalCols, colorFondo, fechaExport, tituloGrande = false }) {
  const tc = Math.max(totalCols, 4)
  const m  = (r, c1, c2) => ws.mergeCells(r, c1, r, c2)
  const mitad = Math.ceil(tc / 2)

  // Fila 1 — Título
  const r1 = ws.addRow([titulo])
  m(1, 1, tc)
  r1.height = tituloGrande ? 30 : 25
  const c1  = r1.getCell(1)
  c1.font      = { name: 'Arial', size: tituloGrande ? 13 : 11, bold: true, color: { argb: 'FFFFFFFF' } }
  c1.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorFondo } }
  c1.alignment = { vertical: 'middle', horizontal: 'center' }
  c1.protection = { locked: true }

  // Fila 2 — Curso / info
  const r2 = ws.addRow([`Curso: ${curso}`, '', info])
  m(2, 1, mitad); m(2, mitad + 1, tc)
  r2.height = 17
  r2.eachCell(cell => {
    cell.font      = { name: 'Arial', size: 9, bold: true }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } }
    cell.protection = { locked: true }
  })

  // Fila 3 — Docente / fecha
  const r3 = ws.addRow([`Docente: ${docente}`, '', `Exportado: ${fechaExport}`])
  m(3, 1, mitad); m(3, mitad + 1, tc)
  r3.height = 17
  r3.eachCell(cell => {
    cell.font      = { name: 'Arial', size: 9, italic: true }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } }
    cell.protection = { locked: true }
  })

  // Fila 4 — Aviso
  const r4 = ws.addRow([aviso])
  m(4, 1, tc)
  r4.height = 18
  const c4  = r4.getCell(1)
  const esAviso  = aviso.startsWith('⚠')
  c4.font      = { name: 'Arial', size: 8, italic: true, bold: false,
    color: { argb: esAviso ? 'FF92400E' : 'FF1E40AF' } }
  c4.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: esAviso ? 'FFFEF3C7' : 'FFEFF6FF' } }
  c4.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  c4.border    = { bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } } }
  c4.protection = { locked: true }

  // Fila 5 — Separador
  const r5 = ws.addRow([])
  r5.height = 5
}

/**
 * Hoja "Meta": identifica de forma estable (por IDs) qué materia/curso/periodo,
 * qué actividades y qué estudiantes contiene el Excel. La lee importar-notas-excel.js.
 * Formato: bloque clave-valor + 3 tablas, cada una con su marcador en la columna A.
 * NO es una hoja para editar; está protegida (sin contraseña) para evitar accidentes.
 */
export const META_SHEET_NAME    = 'Meta'
export const META_FORMATO       = 'notas-excel-v1'

function _agregarHojaMeta(wb, { materiaId, cursoId, periodo, profesorId, año, actividades, directas, estudiantes, filaCabecera }) {
  const ws = wb.addWorksheet(META_SHEET_NAME, { properties: { tabColor: { argb: 'FF94A3B8' } } })
  ws.getColumn(1).width = 38
  ws.getColumn(2).width = 40
  ws.getColumn(3).width = 14
  ws.getColumn(4).width = 22
  ws.getColumn(5).width = 10

  const titulo = ws.addRow(['META — NO MODIFICAR ESTA HOJA (la usa el sistema para importar las notas)'])
  titulo.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF991B1B' } }
  ws.addRow([])

  ws.addRow(['#CLAVES'])
  ;[
    ['formato',        META_FORMATO],
    ['materia_id',     materiaId],
    ['curso_id',       cursoId],
    ['trimestre',      Number(periodo)],
    ['profesor_id',    profesorId ?? ''],
    ['año',            año],
    ['fila_cabecera',  filaCabecera],
    ['exportado_en',   new Date().toISOString()],
  ].forEach(r => ws.addRow(r))
  ws.addRow([])

  ws.addRow(['#ACTIVIDADES'])
  ws.addRow(['actividad_id', 'titulo', 'tipo', 'hoja', 'columna'])
  actividades.forEach(a => ws.addRow([a.actividad_id, a.titulo, a.tipo, a.hoja, a.columna]))
  ws.addRow([])

  ws.addRow(['#DIRECTAS'])
  ws.addRow(['codigo', 'campo', 'columna', 'hoja', 'max'])
  directas.forEach(d => ws.addRow([d.codigo, d.campo, d.columna, d.hoja, d.max]))
  ws.addRow([])

  ws.addRow(['#ESTUDIANTES'])
  ws.addRow(['estudiante_id', 'nombre', 'fila'])
  estudiantes.forEach(e => ws.addRow([e.estudiante_id, e.nombre, e.fila]))

  // Los IDs/títulos deben leerse siempre como texto
  ws.eachRow(row => row.eachCell(c => { c.numFmt = '@' ; if (typeof c.value === 'number') c.numFmt = 'General' }))
  ws.protect('', { selectLockedCells: true, selectUnlockedCells: true })
}

/** Opciones de protección estándar para hojas de dimensión (sin contraseña) */
function _opcionesProteccion() {
  return {
    selectLockedCells:   true,
    selectUnlockedCells: true,   // El profesor puede hacer clic en celdas editables
    formatCells:   false,
    formatColumns: false,
    formatRows:    false,
    insertRows:    false,
    deleteRows:    false,
    sort:          false,
    autoFilter:    false,
  }
}

/** Referencia segura a nombre de hoja para fórmulas (agrega comillas si tiene espacios) */
function _safeSheetRef(name) {
  return /[\s\W]/.test(name) ? `'${name}'` : name
}

/** Borde blanco delgado (para cabeceras de color) */
function _bBlanco() {
  const s = { style: 'thin', color: { argb: 'FFFFFFFF' } }
  return { top: s, left: s, bottom: s, right: s }
}

/** Borde gris delgado (para filas de datos) */
function _bGris() {
  const s = { style: 'thin', color: { argb: 'FFD0D0D0' } }
  return { top: s, left: s, bottom: s, right: s }
}

/** Abreviatura corta de materia para el note nativo de Excel (caja pequeña) */
function _abreviarMateria(nombre) {
  if (!nombre || typeof nombre !== 'string') return 'Mat'
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return 'Mat'
  if (partes.length === 1) return partes[0].substring(0, Math.min(4, partes[0].length))
  const p1 = partes[0].substring(0, Math.min(4, partes[0].length))
  const p2 = partes[1].substring(0, Math.min(3, partes[1].length))
  return `${p1} ${p2}`
}

// ─────────────────────────────────────────────────────────
// EXPORTAR VISTA CONSOLIDADA (ExcelJS)
//
// Una sola hoja horizontal con:
//   Actividades HACER (editables) | Promedio HACER (protegido)
//   Actividades SABER (editables) | Promedio SABER (protegido)
//   Nota SER (editable)           | Nota AUTOEVALUACIÓN (editable)
//   Total (protegido)
//
// Ideal para imprimir o analizar todo en una sola vista.
// ─────────────────────────────────────────────────────────
export async function exportarVistaConsolidadaExcel({ cursoId, materiaId, periodo, profesorId = null, nombreDocente = null }) {
  if (typeof ExcelJS === 'undefined') { console.error('ExcelJS no está cargado.'); return }

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  // ── Fetch de datos ────────────────────────────────────
  const [
    { data: curso },
    { data: materia },
    estudiantesResult,
  ] = await Promise.all([
    supabase.from('cursos').select('nombre_completo').eq('id', cursoId).single(),
    supabase.from('materias').select('nombre').eq('id', materiaId).single(),
    esTecnica
      ? supabase.from('inscripciones_tecnicas')
          .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
          .eq('materia_id', materiaId).eq('activo', true).in('estudiantes.curso_id', await cursosDelGrado(cursoId))
      : supabase.from('estudiantes')
          .select('id, usuarios(nombre_completo)')
          .eq('curso_id', cursoId),
  ])

  const estudiantesRaw = esTecnica
    ? (estudiantesResult.data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios }))
    : (estudiantesResult.data ?? [])

  const estudiantes = (estudiantesRaw ?? [])
    .sort((a, b) => (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

  // ── Actividades ───────────────────────────────────────
  let qActs = supabase.from('actividades')
    .select('id, titulo, tipo, max_puntos, trimestre')
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .order('created_at', { ascending: true })
  qActs = esTecnica ? qActs.in('curso_id', await cursosDelGrado(cursoId)) : qActs.eq('curso_id', cursoId)
  if (profesorId) qActs = qActs.eq('creado_por', profesorId)
  const { data: actividades } = await qActs

  const actsHacer = (actividades ?? []).filter(a => a.tipo === 'hacer')
  const actsSaber = (actividades ?? []).filter(a => a.tipo === 'saber')

  // ── Notas individuales ────────────────────────────────
  let notasMap = {}
  const actIds = (actividades ?? []).map(a => a.id)
  if (actIds.length) {
    const { data: notas } = await paginar(() => supabase.from('notas')
      .select('actividad_id, estudiante_id, valor')
      .in('actividad_id', actIds))
    ;(notas ?? []).forEach(n => { notasMap[`${n.actividad_id}_${n.estudiante_id}`] = n.valor })
  }

  // ── Calificaciones directas SER / DECIDIR ────────────
  let calMap = {}
  if (estudiantes.length) {
    const { data: cals } = await paginar(() => supabase.from('calificaciones')
      .select('estudiante_id, nota_ser, nota_decidir')
      .eq('materia_id', materiaId)
      .eq('trimestre', periodo))
    ;(cals ?? []).forEach(c => { calMap[c.estudiante_id] = c })
  }

  const periName    = Config.nombrePeriodo
  const nombreCurso = curso?.nombre_completo ?? ''
  const nomMateria  = materia?.nombre ?? 'Materia'
  const etiqDocente = nombreDocente ?? 'Dirección'
  const fechaExport = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' })

  // Máximos fijos por dimensión
  const MAX_HACER   = 40
  const MAX_SABER   = 45
  const MAX_SER     = 10
  const MAX_AUTO    = 5
  const MAX_TOTAL   = MAX_HACER + MAX_SABER + MAX_SER + MAX_AUTO  // 100

  // Colores
  const COL_HACER  = { header: 'FFF59E0B', light: 'FFFFF8EC', mid: 'FFFEF3C7' }
  const COL_SABER  = { header: 'FF3B82F6', light: 'FFEFF6FF', mid: 'FFDBEAFE' }
  const COL_SER    = { header: 'FF8B5CF6', light: 'FFF5F3FF', mid: 'FFEDE9FE' }
  const COL_AUTO   = { header: 'FF06B6D4', light: 'FFECFEFF', mid: 'FFCFFAFE' }
  const COL_TOTAL  = { header: 'FF1F3864', light: 'FFE8EEF7', mid: 'FFD1DCF0' }

  // Utilidad columna → letra Excel
  const colLetter = (n) => {
    let s = ''
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) }
    return s
  }

  // ── Estructura de columnas ────────────────────────────
  // Col 1:       N°
  // Col 2:       Estudiante
  // Col 3..2+nH: Actividades HACER  (editables)
  // Col 3+nH:    Promedio HACER     (protegido)
  // Col 4+nH..3+nH+nS: Actividades SABER (editables)
  // Col 4+nH+nS: Promedio SABER     (protegido)
  // Col 5+nH+nS: Nota SER           (editable)
  // Col 6+nH+nS: Nota AUTOEVALUACIÓN(editable)
  // Col 7+nH+nS: Total              (protegido)
  const nH = actsHacer.length
  const nS = actsSaber.length

  const cPromHacer = 3 + nH
  const cIniSaber  = 4 + nH
  const cPromSaber = 4 + nH + nS
  const cSer       = 5 + nH + nS
  const cAuto      = 6 + nH + nS
  const cTotal     = 7 + nH + nS
  const totalCols  = cTotal

  // Fila de datos empieza en 7:
  // fila1=título, fila2=curso/info, fila3=docente, fila4=aviso, fila5=separador,
  // fila6=cabecera de grupos, fila7=cabecera de columnas → datos desde fila 8 — NO
  // En esta hoja hay DOS filas de cabecera de columnas (grupos + columnas)
  // entonces: 5 filas encabezado + 2 filas header = datos en fila 8
  const DATA_ROW = 8

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Gestión Educativa 2027'
  wb.created = new Date()
  const ws = wb.addWorksheet('Vista Consolidada')
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }

  // ── FILA 1: Título ────────────────────────────────────
  const r1 = ws.addRow([`VISTA CONSOLIDADA — ${nomMateria} — ${periName} ${periodo} — Gestión ${Config.año}`])
  ws.mergeCells(1, 1, 1, totalCols)
  r1.height = 28
  const c1 = r1.getCell(1)
  c1.font      = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  c1.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  c1.alignment = { vertical: 'middle', horizontal: 'center' }
  c1.protection = { locked: true }

  // ── FILA 2: Curso / info ──────────────────────────────
  const mitad = Math.ceil(totalCols / 2)
  const r2 = ws.addRow([`Curso: ${nombreCurso}`, '', `Nota mínima aprobación: ${Config.notaMinima} · Total estudiantes: ${estudiantes.length}`])
  ws.mergeCells(2, 1, 2, mitad)
  ws.mergeCells(2, mitad + 1, 2, totalCols)
  r2.height = 17
  r2.eachCell(cell => {
    cell.font      = { name: 'Arial', size: 9, bold: true }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } }
    cell.protection = { locked: true }
  })

  // ── FILA 3: Docente / fecha ───────────────────────────
  const r3 = ws.addRow([`Docente: ${etiqDocente}`, '', `Exportado: ${fechaExport}`])
  ws.mergeCells(3, 1, 3, mitad)
  ws.mergeCells(3, mitad + 1, 3, totalCols)
  r3.height = 17
  r3.eachCell(cell => {
    cell.font      = { name: 'Arial', size: 9, italic: true }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } }
    cell.protection = { locked: true }
  })

  // ── FILA 4: Aviso ─────────────────────────────────────
  const r4 = ws.addRow(['⚠ Celdas con borde naranja (HACER) y azul (SABER) son EDITABLES. Las columnas de promedio y total están protegidas.'])
  ws.mergeCells(4, 1, 4, totalCols)
  r4.height = 18
  const c4 = r4.getCell(1)
  c4.font      = { name: 'Arial', size: 8, italic: true, color: { argb: 'FF92400E' } }
  c4.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
  c4.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  c4.border    = { bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } } }
  c4.protection = { locked: true }

  // ── FILA 5: Separador ─────────────────────────────────
  const r5 = ws.addRow([])
  r5.height = 5

  // ── FILA 6: Cabecera de grupos ────────────────────────
  // Muestra el nombre de cada grupo de columnas con su color
  const r6 = ws.addRow([])
  r6.height = 20

  const _estiloGrupo = (cell, colors) => {
    cell.font      = { name: 'Arial', size: 8, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border    = _bBlanco()
    cell.protection = { locked: true }
  }

  // Grupo N° y Estudiante
  r6.getCell(1).value = ''
  r6.getCell(2).value = ''
  ws.mergeCells(6, 1, 6, 2)
  r6.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  r6.getCell(1).protection = { locked: true }

  // Grupo HACER
  if (nH > 0) {
    r6.getCell(3).value = `HACER (máx ${MAX_HACER})`
    ws.mergeCells(6, 3, 6, cPromHacer)
    _estiloGrupo(r6.getCell(3), COL_HACER)
  }

  // Grupo SABER
  if (nS > 0) {
    r6.getCell(cIniSaber).value = `SABER (máx ${MAX_SABER})`
    ws.mergeCells(6, cIniSaber, 6, cPromSaber)
    _estiloGrupo(r6.getCell(cIniSaber), COL_SABER)
  }

  // SER, AUTOEVALUACIÓN, TOTAL — celdas individuales
  r6.getCell(cSer).value   = `SER (máx ${MAX_SER})`
  r6.getCell(cAuto).value  = `AUTOEVALUACIÓN (máx ${MAX_AUTO})`
  r6.getCell(cTotal).value = 'TOTAL'
  _estiloGrupo(r6.getCell(cSer),   COL_SER)
  _estiloGrupo(r6.getCell(cAuto),  COL_AUTO)
  _estiloGrupo(r6.getCell(cTotal), COL_TOTAL)

  // ── FILA 7: Cabecera de columnas ──────────────────────
  const r7vals = [
    'N°', 'Estudiante',
    ...actsHacer.map(a => `${a.titulo}\n(máx ${a.max_puntos})`),
    `Prom.\nHACER`,
    ...actsSaber.map(a => `${a.titulo}\n(máx ${a.max_puntos})`),
    `Prom.\nSABER`,
    `Nota\nSER`,
    `Nota\nAuto.`,
    `Total\n(${MAX_TOTAL})`,
  ]
  const r7 = ws.addRow(r7vals)
  r7.height = 65
  r7.eachCell((cell, col) => {
    const isHacer = col >= 3 && col <= 2 + nH
    const isProm  = col === cPromHacer || col === cPromSaber
    const isSaber = col >= cIniSaber && col <= cPromSaber - 1
    const isSer   = col === cSer
    const isAuto  = col === cAuto
    const isTotal = col === cTotal

    let argb = 'FF1F3864'
    if (isHacer) argb = COL_HACER.header
    if (isSaber) argb = COL_SABER.header
    if (isSer)   argb = COL_SER.header
    if (isAuto)  argb = COL_AUTO.header
    if (isTotal) argb = COL_TOTAL.header

    cell.font      = { name: 'Arial', size: 8, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    cell.alignment = {
      vertical: 'middle', horizontal: 'center', wrapText: true,
      textRotation: (isHacer || isSaber) && (nH + nS) > 4 ? 90 : 0,
    }
    cell.border    = _bBlanco()
    cell.protection = { locked: true }
  })

  // ── Anchos de columna ─────────────────────────────────
  ws.getColumn(1).width = 4
  ws.getColumn(2).width = 30
  const wAct = (nH + nS) > 10 ? 5 : 8
  for (let i = 0; i < nH; i++) ws.getColumn(3 + i).width = wAct
  ws.getColumn(cPromHacer).width = 12
  for (let i = 0; i < nS; i++) ws.getColumn(cIniSaber + i).width = wAct
  ws.getColumn(cPromSaber).width = 12
  ws.getColumn(cSer).width   = 10
  ws.getColumn(cAuto).width  = 13
  ws.getColumn(cTotal).width = 12

  // ── FILAS DE ESTUDIANTES ──────────────────────────────
  estudiantes.forEach((est, idx) => {
    const dataRow = DATA_ROW + idx

    // Valores reales del sistema
    const valsH = actsHacer.map(a => {
      const v = notasMap[`${a.id}_${est.id}`]
      return v != null ? parseFloat(v) : ''
    })
    const valsS = actsSaber.map(a => {
      const v = notasMap[`${a.id}_${est.id}`]
      return v != null ? parseFloat(v) : ''
    })
    const cal      = calMap[est.id]
    const notaSer  = cal ? parseFloat(cal.nota_ser  ?? 0) : 0
    const notaAuto = cal ? parseFloat(cal.nota_decidir ?? 0) : 0

    const r = ws.addRow([
      idx + 1,
      est.usuarios?.nombre_completo ?? '—',
      ...valsH,
      '',   // promedio HACER → fórmula
      ...valsS,
      '',   // promedio SABER → fórmula
      notaSer,
      notaAuto,
      '',   // total → fórmula
    ])
    r.height = 20

    // ── Fórmulas ────────────────────────────────────────
    // Promedio HACER: (suma ponderada de actividades) / cantidad con nota
    if (nH > 0) {
      const partesH = actsHacer.map((a, i) => {
        const cL  = colLetter(3 + i)
        const max = parseFloat(a.max_puntos)
        return `IF(ISNUMBER(${cL}${dataRow}),(${cL}${dataRow}/${max})*${MAX_HACER},0)`
      })
      const countH = actsHacer.map((_, i) => `IF(ISNUMBER(${colLetter(3+i)}${dataRow}),1,0)`).join('+')
      const sumaH  = partesH.join('+')
      const fPromH = `IFERROR(IF((${countH})=0,0,ROUND((${sumaH})/(${countH}),2)),0)`
      r.getCell(cPromHacer).value = { formula: fPromH }
    } else {
      r.getCell(cPromHacer).value = 0
    }

    // Promedio SABER
    if (nS > 0) {
      const partesS = actsSaber.map((a, i) => {
        const cL  = colLetter(cIniSaber + i)
        const max = parseFloat(a.max_puntos)
        return `IF(ISNUMBER(${cL}${dataRow}),(${cL}${dataRow}/${max})*${MAX_SABER},0)`
      })
      const countS = actsSaber.map((_, i) => `IF(ISNUMBER(${colLetter(cIniSaber+i)}${dataRow}),1,0)`).join('+')
      const sumaS  = partesS.join('+')
      const fPromS = `IFERROR(IF((${countS})=0,0,ROUND((${sumaS})/(${countS}),2)),0)`
      r.getCell(cPromSaber).value = { formula: fPromS }
    } else {
      r.getCell(cPromSaber).value = 0
    }

    // Total = promHacer + promSaber + ser + auto
    const cPH = colLetter(cPromHacer)
    const cPS = colLetter(cPromSaber)
    const cS  = colLetter(cSer)
    const cA  = colLetter(cAuto)
    r.getCell(cTotal).value = {
      formula: `IFERROR(ROUND(${cPH}${dataRow}+${cPS}${dataRow}+${cS}${dataRow}+${cA}${dataRow},2),0)`
    }

    // ── Estilos por celda ────────────────────────────────
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      const isHacer   = col >= 3 && col <= 2 + nH
      const isPromH   = col === cPromHacer
      const isSaber   = col >= cIniSaber && col <= cPromSaber - 1
      const isPromS   = col === cPromSaber
      const isSer     = col === cSer
      const isAuto    = col === cAuto
      const isTotal   = col === cTotal
      const isEditable = isHacer || isSaber || isSer || isAuto
      const isCalc    = isPromH || isPromS || isTotal

      cell.font      = { name: 'Arial', size: 9 }
      cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' }
      cell.border    = _bGris()

      if (isHacer) {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: valsH[col - 3] === '' ? 'FFFAFAFA' : 'FFFFFFFF' } }
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
          bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left:   { style: 'thin', color: { argb: COL_HACER.header } },
          right:  { style: 'thin', color: { argb: COL_HACER.header } },
        }
        cell.protection = { locked: false }
      } else if (isSaber) {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: valsS[col - cIniSaber] === '' ? 'FFFAFAFA' : 'FFFFFFFF' } }
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
          bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left:   { style: 'thin', color: { argb: COL_SABER.header } },
          right:  { style: 'thin', color: { argb: COL_SABER.header } },
        }
        cell.protection = { locked: false }
      } else if (isSer) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
          bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left:   { style: 'thin', color: { argb: COL_SER.header } },
          right:  { style: 'thin', color: { argb: COL_SER.header } },
        }
        cell.font = { name: 'Arial', size: 9, bold: true }
        cell.protection = { locked: false }
      } else if (isAuto) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
          bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left:   { style: 'thin', color: { argb: COL_AUTO.header } },
          right:  { style: 'thin', color: { argb: COL_AUTO.header } },
        }
        cell.font = { name: 'Arial', size: 9, bold: true }
        cell.protection = { locked: false }
      } else if (isPromH) {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? COL_HACER.light : COL_HACER.mid } }
        cell.font = { name: 'Arial', size: 9, bold: true }
        cell.protection = { locked: true }
      } else if (isPromS) {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? COL_SABER.light : COL_SABER.mid } }
        cell.font = { name: 'Arial', size: 9, bold: true }
        cell.protection = { locked: true }
      } else if (isTotal) {
        const totalVal = notaOficial(notaSer + notaAuto)
        const aprobado = totalVal >= Config.notaMinima
        cell.font = { name: 'Arial', size: 9, bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? COL_TOTAL.light : COL_TOTAL.mid } }
        cell.protection = { locked: true }
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB' } }
        cell.protection = { locked: true }
      }
    })

    // ── Validaciones ─────────────────────────────────────
    actsHacer.forEach((act, i) => {
      const cL  = colLetter(3 + i)
      const max = parseFloat(act.max_puntos)
      ws.getCell(`${cL}${dataRow}`).dataValidation = {
        type: 'decimal', operator: 'between', formulae: [0, max], allowBlank: true,
        showErrorMessage: true, errorStyle: 'stop',
        errorTitle: '⚠ Nota fuera de rango',
        error: `La nota debe estar entre 0 y ${max} para "${act.titulo}".`,
        showInputMessage: true, promptTitle: act.titulo,
        prompt: `Ingrese entre 0 y ${max}`,
      }
    })
    actsSaber.forEach((act, i) => {
      const cL  = colLetter(cIniSaber + i)
      const max = parseFloat(act.max_puntos)
      ws.getCell(`${cL}${dataRow}`).dataValidation = {
        type: 'decimal', operator: 'between', formulae: [0, max], allowBlank: true,
        showErrorMessage: true, errorStyle: 'stop',
        errorTitle: '⚠ Nota fuera de rango',
        error: `La nota debe estar entre 0 y ${max} para "${act.titulo}".`,
        showInputMessage: true, promptTitle: act.titulo,
        prompt: `Ingrese entre 0 y ${max}`,
      }
    })
    ws.getCell(`${colLetter(cSer)}${dataRow}`).dataValidation = {
      type: 'decimal', operator: 'between', formulae: [0, MAX_SER], allowBlank: true,
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: '⚠ Nota fuera de rango',
      error: `La nota SER debe estar entre 0 y ${MAX_SER}.`,
      showInputMessage: true, promptTitle: 'Nota SER',
      prompt: `Ingrese entre 0 y ${MAX_SER}`,
    }
    ws.getCell(`${colLetter(cAuto)}${dataRow}`).dataValidation = {
      type: 'decimal', operator: 'between', formulae: [0, MAX_AUTO], allowBlank: true,
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: '⚠ Nota fuera de rango',
      error: `La nota AUTOEVALUACIÓN debe estar entre 0 y ${MAX_AUTO}.`,
      showInputMessage: true, promptTitle: 'Nota Autoevaluación',
      prompt: `Ingrese entre 0 y ${MAX_AUTO}`,
    }
  })

  // ── Formato condicional columna Total ─────────────────
  const rangeTotal = `${colLetter(cTotal)}${DATA_ROW}:${colLetter(cTotal)}${DATA_ROW + estudiantes.length - 1}`
  ws.addConditionalFormatting({
    ref: rangeTotal,
    rules: [
      { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [Config.notaMinima],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } },
                 font: { bold: true, color: { argb: 'FF166534' } } } },
      { type: 'cellIs', operator: 'lessThan', formulae: [Config.notaMinima],
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } },
                 font: { bold: true, color: { argb: 'FF991B1B' } } } },
    ],
  })

  // ── Congelar y proteger ───────────────────────────────
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: DATA_ROW, activeCell: `C${DATA_ROW + 1}` }]
  ws.protect('', {
    selectLockedCells:   true,
    selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, deleteRows: false, sort: false, autoFilter: false,
  })

  // ── Descargar ─────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href        = url
  a.download    = `consolidado_${nomMateria.replace(/[^a-zA-Z0-9]/g, '_')}_T${periodo}_${Config.año}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Exponer funciones al scope global (para llamadas desde HTML inline) ──
window.exportarNotasExcel        = exportarNotasExcel
window.exportarResumenAnualExcel = exportarResumenAnualExcel
window.exportarAsistenciasExcel  = exportarAsistenciasExcel
window.exportarDetalleNotasExcel    = exportarDetalleNotasExcel
window.exportarVistaConsolidadaExcel = exportarVistaConsolidadaExcel