// js/utils/asistencia-materia.js
//
// Capa de datos — asistencia independiente por materia/profesor (diseño v5).
// Fuente de verdad nueva: public.asistencias_materia
// Vistas: asistencia_resumen_diario (director/estudiante/tutor)
//         asistencia_resumen_profesor (solo el profesor)
//
// No escribe en public.asistencias (tabla histórica; queda en paralelo).
// Usado por: profesor.js, director, estudiante, tutor, export-excel (Fase 2+).
//
// Prioridad de estados (resumen):
//   FALTA > LICENCIA > RETRASO > PRESENTE

import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader } from './ui.js'

export const ESTADOS_ASISTENCIA = ['presente', 'falta', 'retraso', 'licencia']
export const SESIONES = ['regular', 'tecnica']

/** Etiqueta corta para UI / Excel */
export function etiquetaEstado(estado) {
  const map = {
    presente: 'Presente',
    falta: 'Falta',
    retraso: 'Retraso',
    licencia: 'Licencia',
  }
  return map[estado] ?? (estado || '—')
}

/**
 * Upsert de un lote de asistencia por materia.
 * Cada ítem debe traer estudiante_id, curso_id, materia_id, profesor_id, fecha, sesion, estado.
 * @param {Array<object>} filas
 * @returns {Promise<{ ok: boolean, error?: string, count?: number }>}
 */
export async function guardarAsistenciaMateria(filas) {
  if (!Array.isArray(filas) || !filas.length) {
    toast('No hay registros para guardar', 'warning')
    return { ok: false, error: 'sin_datos' }
  }

  const payload = []
  for (const f of filas) {
    const estado = f.estado
    const sesion = f.sesion === 'tecnica' ? 'tecnica' : 'regular'
    if (!f.estudiante_id || !f.curso_id || !f.materia_id || !f.profesor_id || !f.fecha) {
      toast('Faltan datos obligatorios en un registro de asistencia', 'error')
      return { ok: false, error: 'datos_incompletos' }
    }
    if (!ESTADOS_ASISTENCIA.includes(estado)) {
      toast(`Estado no válido: ${estado}`, 'error')
      return { ok: false, error: 'estado_invalido' }
    }
    payload.push({
      estudiante_id: f.estudiante_id,
      curso_id: f.curso_id,
      materia_id: f.materia_id,
      profesor_id: f.profesor_id,
      fecha: f.fecha,
      sesion,
      estado,
      observaciones: f.observaciones?.trim() || null,
      // Método de la marca: 'manual' (por defecto) borra hora y minutos; 'qr' los conserva.
      // Así, guardar a mano sobre una lista QR deja como válida la última acción.
      metodo: f.metodo === 'qr' ? 'qr' : 'manual',
      hora_llegada: f.metodo === 'qr' ? (f.hora_llegada ?? null) : null,
      minutos_retraso: f.metodo === 'qr' ? (f.minutos_retraso ?? null) : null,
      llamada_id: f.llamada_id ?? null,
    })
  }

  mostrarLoader(`Guardando ${payload.length} registros...`)
  const { error } = await supabase
    .from('asistencias_materia')
    .upsert(payload, {
      onConflict: 'estudiante_id,fecha,sesion,profesor_id,materia_id',
    })
  ocultarLoader()

  if (error) {
    toast(error.message, 'error')
    return { ok: false, error: error.message }
  }
  toast(`Asistencia guardada (${payload.length})`, 'success')
  return { ok: true, count: payload.length }
}

/**
 * Resumen del día — Vista 1 (todas las materias del curso).
 * Incluye materia_excepcion cuando el estado no es "presente".
 * @param {string} cursoId
 * @param {string} fecha  YYYY-MM-DD
 * @param {string} [sesion]  'regular' | 'tecnica' | omitir = ambas
 */
export async function obtenerResumenDia(cursoId, fecha, sesion) {
  if (!cursoId || !fecha) return []

  let q = supabase
    .from('asistencia_resumen_diario')
    .select('estudiante_id, curso_id, fecha, sesion, estado_resumen, materias_registradas, materia_excepcion')
    .eq('curso_id', cursoId)
    .eq('fecha', fecha)

  if (sesion === 'regular' || sesion === 'tecnica') q = q.eq('sesion', sesion)

  const { data, error } = await q
  if (error) {
    console.error('[asistencia-materia] obtenerResumenDia', error)
    toast(error.message, 'error')
    return []
  }
  return data ?? []
}

/**
 * Resumen del día solo para un profesor — Vista 2.
 * @param {string} cursoId
 * @param {string} profesorId
 * @param {string} fecha
 * @param {string} [sesion]
 */
export async function obtenerResumenProfesorDia(cursoId, profesorId, fecha, sesion) {
  if (!cursoId || !profesorId || !fecha) return []

  let q = supabase
    .from('asistencia_resumen_profesor')
    .select('estudiante_id, curso_id, profesor_id, fecha, sesion, estado_resumen')
    .eq('curso_id', cursoId)
    .eq('profesor_id', profesorId)
    .eq('fecha', fecha)

  if (sesion === 'regular' || sesion === 'tecnica') q = q.eq('sesion', sesion)

  const { data, error } = await q
  if (error) {
    console.error('[asistencia-materia] obtenerResumenProfesorDia', error)
    toast(error.message, 'error')
    return []
  }
  return data ?? []
}

/**
 * Detalle crudo del día (filas de asistencias_materia).
 * Filtros opcionales: cursoId, profesorId, materiaId, sesion, estudianteId.
 * @param {object} opts
 */
export async function obtenerDetalleDia({
  fecha,
  cursoId = null,
  profesorId = null,
  materiaId = null,
  sesion = null,
  estudianteId = null,
} = {}) {
  if (!fecha) return []

  let q = supabase
    .from('asistencias_materia')
    .select(`
      id,
      estudiante_id,
      curso_id,
      materia_id,
      profesor_id,
      fecha,
      sesion,
      estado,
      observaciones,
      created_at,
      materia:materias(id, nombre, es_tecnica),
      profesor:usuarios!asistencias_materia_profesor_id_fkey(id, nombre_completo)
    `)
    .eq('fecha', fecha)
    .order('materia_id')

  if (cursoId) q = q.eq('curso_id', cursoId)
  if (profesorId) q = q.eq('profesor_id', profesorId)
  if (materiaId) q = q.eq('materia_id', materiaId)
  if (sesion === 'regular' || sesion === 'tecnica') q = q.eq('sesion', sesion)
  if (estudianteId) q = q.eq('estudiante_id', estudianteId)

  const { data, error } = await q
  if (error) {
    // Fallback sin embed si el nombre de FK no coincide en este proyecto
    console.warn('[asistencia-materia] detalle con join falló, reintento simple', error.message)
    let q2 = supabase
      .from('asistencias_materia')
      .select('*')
      .eq('fecha', fecha)
    if (cursoId) q2 = q2.eq('curso_id', cursoId)
    if (profesorId) q2 = q2.eq('profesor_id', profesorId)
    if (materiaId) q2 = q2.eq('materia_id', materiaId)
    if (sesion === 'regular' || sesion === 'tecnica') q2 = q2.eq('sesion', sesion)
    if (estudianteId) q2 = q2.eq('estudiante_id', estudianteId)
    const r2 = await q2
    if (r2.error) {
      toast(r2.error.message, 'error')
      return []
    }
    return r2.data ?? []
  }
  return data ?? []
}

/**
 * Marcas de una materia concreta (lista del profesor al abrir el día).
 */
export async function obtenerAsistenciaMateriaDia({
  cursoId,
  materiaId,
  profesorId,
  fecha,
  sesion = 'regular',
}) {
  if (!cursoId || !materiaId || !profesorId || !fecha) return []

  const { data, error } = await supabase
    .from('asistencias_materia')
    .select('estudiante_id, estado, observaciones, curso_id, sesion')
    .eq('curso_id', cursoId)
    .eq('materia_id', materiaId)
    .eq('profesor_id', profesorId)
    .eq('fecha', fecha)
    .eq('sesion', sesion === 'tecnica' ? 'tecnica' : 'regular')

  if (error) {
    toast(error.message, 'error')
    return []
  }
  return data ?? []
}

// ─── Asistencia por QR (migración 100): hora de llegada al aula ─────────
/** Hora HH:MM (Bolivia) de un timestamp. */
export function horaBoliviaCorta(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' })
}

/**
 * Texto de llegada de una marca tomada por QR (vacío si fue manual o no escaneó).
 * Ej.: "Entró al aula 14:25 · 15 min tarde (QR)" | "Entró al aula 14:12 (QR)"
 * @param {{ estado, hora_llegada?, minutos_retraso? }} r
 */
export function textoLlegada(r) {
  if (!r?.hora_llegada) return ''
  const h = horaBoliviaCorta(r.hora_llegada)
  return r.estado === 'retraso' && r.minutos_retraso != null
    ? `Entró al aula ${h} · ${r.minutos_retraso} min tarde (QR)`
    : `Entró al aula ${h} (QR)`
}

/**
 * Arma mapa estudiante_id -> estado desde un array de filas de asistencia.
 */
export function mapaEstadosPorEstudiante(filas) {
  const map = {}
  for (const f of filas ?? []) {
    map[f.estudiante_id] = {
      estado: f.estado,
      observaciones: f.observaciones ?? null,
    }
  }
  return map
}
