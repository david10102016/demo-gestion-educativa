// js/utils/calculos.js
// Cálculos de promedios y notas usando Config dinámico (sin valores hardcodeados)
import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { notaOficial, trimestreCerrado } from './estado-notas.js'

/**
 * Calcula la nota final de un estudiante en una materia y período.
 * Lee los pesos desde Config.dimensiones (dinámico).
 * Retorna objeto con cada dimensión y el total.
 */
export async function calcularNotaFinal(estudianteId, materiaId, periodo) {
  const dims = Config.dimensiones

  // Obtener actividades de la materia en el período
  const { data: actividades } = await supabase
    .from('actividades')
    .select('id, tipo, max_puntos')
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)

  if (!actividades?.length) {
    return construirResultadoVacio(dims)
  }

  // Obtener notas del estudiante para esas actividades
  const actIds = actividades.map(a => a.id)
  const { data: notas } = await supabase
    .from('notas')
    .select('actividad_id, valor')
    .eq('estudiante_id', estudianteId)
    .in('actividad_id', actIds)

  const notasMap = {}
  ;(notas ?? []).forEach(n => { notasMap[n.actividad_id] = n.valor })

  // Obtener SER y DECIDIR de calificaciones (tipo 'ficha' y 'directo')
  const { data: cal } = await supabase
    .from('calificaciones')
    .select('nota_ser, nota_decidir')
    .eq('estudiante_id', estudianteId)
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .maybeSingle()

  const resultado = {}
  let total = 0

  for (const dim of dims) {
    let nota = 0

    if (dim.tipo === 'actividades') {
      // Promedio normalizado al peso de la dimensión
      const acts = actividades.filter(a => a.tipo === dim.codigo)
      const vals = acts
        .map(a => notasMap[a.id] != null
          ? (parseFloat(notasMap[a.id]) / parseFloat(a.max_puntos)) * dim.peso_maximo
          : null)
        .filter(v => v !== null)

      nota = vals.length
        ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100
        : 0

    } else if (dim.tipo === 'ficha') {
      // Viene de calificaciones.nota_ser
      nota = cal?.nota_ser != null ? parseFloat(cal.nota_ser) : 0

    } else if (dim.tipo === 'directo') {
      // Viene de calificaciones.nota_decidir
      nota = cal?.nota_decidir != null ? parseFloat(cal.nota_decidir) : 0
    }

    resultado[dim.codigo] = Math.round(nota * 100) / 100
    total += nota
  }

  resultado.total  = Math.round(total * 100) / 100
  // Aprobado/Reprobado solo con el trimestre cerrado; abierto → En curso
  resultado.estado = trimestreCerrado(periodo, { trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada })
    ? Config.estado(notaOficial(total)) : 'En curso'
  return resultado
}

/**
 * Calcula el promedio general de un estudiante en todos sus períodos.
 */
export async function calcularPromedioGeneral(estudianteId, periodo) {
  const { data: notas } = await supabase
    .from('notas_finales')
    .select('nota_final')
    .eq('estudiante_id', estudianteId)
    .eq('trimestre', periodo)

  const validas = (notas ?? [])
    .map(n => parseFloat(n.nota_final ?? 0))
    .filter(v => v > 0)

  if (!validas.length) return 0
  return Math.round((validas.reduce((s, v) => s + v, 0) / validas.length) * 100) / 100
}

/**
 * Estadísticas de asistencia de un estudiante en un rango de fechas.
 * Fuente: asistencias_materia (v5). Prioridad por día/sesión:
 * FALTA > LICENCIA > RETRASO > PRESENTE.
 */
export async function calcularAsistencia(estudianteId, fechaInicio, fechaFin) {
  const { data } = await supabase
    .from('asistencias_materia')
    .select('fecha, sesion, estado')
    .eq('estudiante_id', estudianteId)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)

  if (!data?.length) {
    return { total: 0, presente: 0, falta: 0, retraso: 0, licencia: 0, porcentaje: 100 }
  }

  // Agrupar por fecha+sesión y aplicar prioridad
  const porDia = {}
  for (const r of data) {
    const key = `${r.fecha}|${r.sesion}`
    if (!porDia[key]) porDia[key] = []
    porDia[key].push(r.estado)
  }

  const res = { total: 0, presente: 0, falta: 0, retraso: 0, licencia: 0 }
  for (const estados of Object.values(porDia)) {
    let estado = 'presente'
    if (estados.includes('falta')) estado = 'falta'
    else if (estados.includes('licencia')) estado = 'licencia'
    else if (estados.includes('retraso')) estado = 'retraso'
    res[estado] = (res[estado] || 0) + 1
    res.total++
  }

  res.porcentaje = res.total > 0
    ? parseFloat(((res.presente + res.retraso) / res.total * 100).toFixed(1))
    : 100

  return res
}

/**
 * Devuelve estudiantes en riesgo de un curso en un período.
 * Usa Config.notaMinima (dinámico, no hardcodeado).
 */
export async function estudiantesEnRiesgo(cursoId, periodo) {
  const { data } = await supabase
    .from('notas_finales')
    .select('estudiante_id, estudiante, nota_final')
    .eq('trimestre', periodo)

  if (!data?.length) return []

  // Agrupar por estudiante y calcular promedio
  const porEst = {}
  for (const n of data) {
    if (!porEst[n.estudiante_id]) {
      porEst[n.estudiante_id] = { nombre: n.estudiante, notas: [] }
    }
    if (parseFloat(n.nota_final ?? 0) > 0) {
      porEst[n.estudiante_id].notas.push(parseFloat(n.nota_final))
    }
  }

  return Object.entries(porEst)
    .map(([id, est]) => {
      const prom = est.notas.length
        ? est.notas.reduce((s, v) => s + v, 0) / est.notas.length
        : 0
      return { id, nombre: est.nombre, promedio: Math.round(prom * 10) / 10 }
    })
    .filter(e => notaOficial(e.promedio) < Config.notaMinima && e.promedio > 0)
    .sort((a, b) => a.promedio - b.promedio)
}

/**
 * Estadísticas generales de un curso en un período.
 */
export async function estadisticasCurso(cursoId, periodo) {
  const { data: estudiantes } = await supabase
    .from('estudiantes')
    .select('id')
    .eq('curso_id', cursoId)

  if (!estudiantes?.length) {
    return { total: 0, aprobados: 0, reprobados: 0, promedio: 0, enRiesgo: 0 }
  }

  const promedios = await Promise.all(
    estudiantes.map(e => calcularPromedioGeneral(e.id, periodo))
  )

  const total      = promedios.length
  const aprobados  = promedios.filter(p => notaOficial(p) >= Config.notaMinima).length
  const reprobados = total - aprobados
  const promedio   = total > 0
    ? Math.round(promedios.reduce((s, v) => s + v, 0) / total * 10) / 10
    : 0

  return { total, aprobados, reprobados, promedio, enRiesgo: reprobados }
}

// ─── HELPERS PRIVADOS ────────────────────────────────────
function construirResultadoVacio(dims) {
  const res = {}
  for (const d of dims) res[d.codigo] = 0
  res.total  = 0
  res.estado = 'Sin calificar'   // sin notas no se afirma Reprobado
  return res
}