// js/profesor/asistencia-mensual.js
// Historial MENSUAL de asistencia del profesor: grilla estudiante × día,
// filtrada SIEMPRE por curso + paralelo (el curso ya incluye el paralelo),
// materia y profesor. Totales P/F/R/L, búsqueda, detalle y exportación a Excel.
//
// Observación del director: el historial salía de TODOS los estudiantes porque
// la consulta no filtraba por curso. Aquí (y en el historial por rango, ver
// profesor.js) se filtra por curso_id; solo las materias técnicas, que mezclan
// cursos, se filtran por inscripción.
// La grilla (HTML/Excel) es compartida: utils/grilla-asistencia.js.
import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader } from '../utils/ui.js'
import { paginar } from '../utils/paginar.js'
import {
  MESES, LETRA, rangoMes, pad, limpiarNombreArchivo,
  htmlBarraMes, htmlGrilla, htmlDetalleMarca, exportarGrillaExcel,
} from '../utils/grilla-asistencia.js'
import { escapeHtml } from '../utils/sanitize.js'
import { textoLlegada } from '../utils/asistencia-materia.js'
import { cursosDelGrado } from '../utils/tecnica-grado.js'

const IDS = { titulo: 'hm-titulo', mes: 'hm-mes', resultado: 'hm-resultado', detalle: 'hm-detalle' }

let _perfil = null
let _mes = new Date().getMonth()
let _anio = new Date().getFullYear()
let _filtro = ''
let _datos = null // { estudiantes, fechas, celdas, cursoNombre, materiaNombre }

export function iniciarAsistenciaMensual(perfil) {
  _perfil = perfil
  // Si el panel mensual está abierto y cambian curso/materia, se recarga solo.
  for (const id of ['selector-curso-global', 'selector-materia-global']) {
    document.getElementById(id)?.addEventListener('change', () => {
      const panel = document.getElementById('panel-historial-mensual')
      if (panel && !panel.classList.contains('hidden')) setTimeout(() => window.cargarHistorialMensual(), 0)
    })
  }
}

function _sel() {
  const c = document.getElementById('selector-curso-global')
  const m = document.getElementById('selector-materia-global')
  return {
    cursoId: c?.value ?? '',
    materiaId: m?.value ?? '',
    cursoNombre: c?.options[c.selectedIndex]?.text ?? '',
    materiaNombre: m?.options[m.selectedIndex]?.text ?? '',
  }
}

// ─── UI ──────────────────────────────────────────────────
window.abrirHistorialMensual = function () {
  const panel = document.getElementById('panel-historial-mensual')
  panel?.classList.remove('hidden')
  window.mostrarHistorialMensual()
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
window.cerrarHistorialMensual = function () {
  document.getElementById('panel-historial-mensual')?.classList.add('hidden')
}

window.mostrarHistorialMensual = function () {
  const cont = document.getElementById('hist-mensual-wrap')
  if (!cont) return
  _filtro = ''
  cont.innerHTML = htmlBarraMes({
    anio: _anio, mes: _mes, ids: IDS,
    fn: { nav: 'window.cambiarMesHistorial', ir: 'window.irMesHistorial', buscar: 'window.filtrarHistorialMensual', exportar: 'window.exportarHistorialMensual' },
  })
  window.cargarHistorialMensual()
}

window.cambiarMesHistorial = function (delta) {
  _mes += delta
  if (_mes < 0) { _mes = 11; _anio-- }
  if (_mes > 11) { _mes = 0; _anio++ }
  window.cargarHistorialMensual()
}

window.irMesHistorial = function (valor) {
  const [y, m] = String(valor).split('-').map(Number)
  if (!y || !m) return
  _anio = y; _mes = m - 1
  window.cargarHistorialMensual()
}

window.filtrarHistorialMensual = function (valor) { _filtro = valor ?? ''; _pintar() }

window.detalleHistorialMensual = function (estId, fecha) {
  const det = document.getElementById(IDS.detalle)
  if (!det || !_datos) return
  det.innerHTML = htmlDetalleMarca(_datos.estudiantes.find(e => e.id === estId), fecha, _datos.celdas[`${estId}|${fecha}`])
}

window.exportarHistorialMensual = function () {
  if (!_datos?.fechas.length) { toast('No hay datos para exportar', 'warning'); return }
  try {
    exportarGrillaExcel(_datos, {
      titulo: `Historial mensual de asistencia — ${MESES[_mes]} ${_anio}`,
      subtitulo: `${_datos.cursoNombre} · ${_datos.materiaNombre}`,
      hoja: MESES[_mes],
      archivo: `asistencia_${limpiarNombreArchivo(_datos.cursoNombre)}_${limpiarNombreArchivo(_datos.materiaNombre)}_${_anio}-${pad(_mes + 1)}.xlsx`,
    })
  } catch (err) { toast(err.message, 'error') }
}

function _pintar() {
  const out = document.getElementById(IDS.resultado)
  const tit = document.getElementById(IDS.titulo)
  if (!out || !_datos) return
  const { estudiantes, fechas, cursoNombre, materiaNombre } = _datos

  if (tit) tit.innerHTML = `
    <div style="font-size:1.15rem;font-weight:700;">Historial mensual de asistencia — ${MESES[_mes]} ${_anio}</div>
    <div class="text-sm text-muted">${escapeHtml(cursoNombre)} · ${escapeHtml(materiaNombre)} · ${estudiantes.length} estudiantes · ${fechas.length} fechas registradas</div>`

  if (!fechas.length) {
    out.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">Sin registros de asistencia en ${MESES[_mes]} ${_anio}</div></div>`
    return
  }
  out.innerHTML = htmlGrilla(_datos, { filtro: _filtro, onClick: 'window.detalleHistorialMensual' })
  const det = document.getElementById(IDS.detalle); if (det) det.innerHTML = ''
}

// ─── DATOS ───────────────────────────────────────────────
window.cargarHistorialMensual = async function () {
  const { cursoId, materiaId, cursoNombre, materiaNombre } = _sel()
  const out = document.getElementById(IDS.resultado)
  if (!out) return
  const mesInput = document.getElementById(IDS.mes)
  if (mesInput) mesInput.value = `${_anio}-${pad(_mes + 1)}`
  if (!cursoId || !materiaId) {
    out.innerHTML = `<div class="empty-state"><div class="empty-state-title">Selecciona curso y materia arriba</div></div>`
    return
  }

  const { desde, hasta } = rangoMes(_anio, _mes)

  mostrarLoader('Cargando historial mensual...')
  try {
    const { data: mat } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    const esTecnica = mat?.es_tecnica === true

    // 1) Lista de estudiantes del curso (o inscritos, si es técnica)
    let estudiantes = []
    if (esTecnica) {
      const { data } = await supabase.from('inscripciones_tecnicas')
        .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
        .eq('materia_id', materiaId).eq('activo', true).in('estudiantes.curso_id', await cursosDelGrado(cursoId))
      estudiantes = (data ?? []).map(i => ({ id: i.estudiante_id, nombre: i.estudiantes?.usuarios?.nombre_completo ?? 'Sin nombre' }))
    } else {
      const { data } = await supabase.from('estudiantes')
        .select('id, usuarios(nombre_completo)').eq('curso_id', cursoId)
      estudiantes = (data ?? []).map(e => ({ id: e.id, nombre: e.usuarios?.nombre_completo ?? 'Sin nombre' }))
    }
    const idsPermitidos = new Set(estudiantes.map(e => e.id))
    const idsGrado = esTecnica ? await cursosDelGrado(cursoId) : null

    // 2) Asistencias del mes: SOLO de este curso (clave de la corrección)
    const { data: filas, error } = await paginar(() => {
      let q = supabase.from('asistencias_materia')
        .select('estudiante_id, fecha, estado, observaciones, hora_llegada, minutos_retraso, estudiantes(usuarios(nombre_completo))')
        .eq('materia_id', materiaId)
        .eq('profesor_id', _perfil.id)
        .gte('fecha', desde).lte('fecha', hasta)
      q = esTecnica ? q.in('curso_id', idsGrado) : q.eq('curso_id', cursoId)
      return q
    })
    if (error) throw error

    const celdas = {}
    const fechasSet = new Set()
    for (const r of filas ?? []) {
      // Estudiante que ya no está en este curso (cambió de curso/paralelo) pero tiene
      // asistencia registrada aquí: se conserva en la grilla como evidencia.
      if (!idsPermitidos.has(r.estudiante_id)) {
        if (esTecnica) continue
        idsPermitidos.add(r.estudiante_id)
        estudiantes.push({ id: r.estudiante_id, nombre: r.estudiantes?.usuarios?.nombre_completo ?? 'Sin nombre', movido: true })
      }
      fechasSet.add(r.fecha)
      celdas[`${r.estudiante_id}|${r.fecha}`] = { l: LETRA[r.estado] ?? '', obs: r.observaciones ?? '', qr: textoLlegada(r) }
    }
    estudiantes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

    _datos = { estudiantes, fechas: [...fechasSet].sort(), celdas, cursoNombre, materiaNombre }
    _pintar()
  } catch (err) {
    console.error(err)
    toast(err.message ?? 'Error al cargar el historial mensual', 'error')
    out.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error al cargar</div></div>`
  } finally {
    ocultarLoader()
  }
}
