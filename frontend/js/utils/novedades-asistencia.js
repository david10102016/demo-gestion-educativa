// js/utils/novedades-asistencia.js
//
// Novedades institucionales del día (director): 'en_direccion' | 'no_ingreso'.
// Tabla: public.novedades_asistencia_dia (migración 079).
// Independiente de asistencias_materia. No pide sesión regular/técnica.

import { supabase } from '../config/supabase-config.js'

export const TIPOS_NOVEDAD = {
  en_direccion: 'En dirección',
  no_ingreso:   'No ingresó',
}

/** Fecha local de hoy en formato YYYY-MM-DD (no usa UTC). */
export function hoyLocalISO() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Estudiantes activos del curso (curso_id viene fresco de la BD).
 * Devuelve [{ id, curso_id, nombre }] ordenado por nombre.
 */
export async function listarEstudiantesCurso(cursoId, colegioId) {
  const { data, error } = await supabase
    .from('estudiantes')
    .select('id, curso_id, usuarios!inner(nombre_completo, activo)')
    .eq('colegio_id', colegioId)
    .eq('curso_id', cursoId)
    .eq('usuarios.activo', true)
  if (error) throw error
  return (data ?? [])
    .map(e => ({
      id: e.id,
      curso_id: e.curso_id,
      nombre: e.usuarios?.nombre_completo ?? 'Sin nombre',
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Novedades de un curso en una fecha. Devuelve { [estudiante_id]: fila }. */
export async function listarNovedades(cursoId, fecha) {
  const { data, error } = await supabase
    .from('novedades_asistencia_dia')
    .select('id, estudiante_id, tipo, observaciones, updated_at')
    .eq('curso_id', cursoId)
    .eq('fecha', fecha)
  if (error) throw error
  const mapa = {}
  for (const n of data ?? []) mapa[n.estudiante_id] = n
  return mapa
}

/** Crea o reemplaza la novedad del estudiante en ese día (una por día). */
export async function guardarNovedad({
  estudianteId, cursoId, colegioId, registradoPor, fecha, tipo, observaciones,
}) {
  const { error } = await supabase
    .from('novedades_asistencia_dia')
    .upsert({
      estudiante_id:  estudianteId,
      curso_id:       cursoId,
      colegio_id:     colegioId,
      registrado_por: registradoPor,
      fecha,
      tipo,
      observaciones: observaciones?.trim() || null,
    }, { onConflict: 'estudiante_id,fecha' })
  if (error) throw error
}

/** Elimina la novedad del estudiante en ese día. */
export async function eliminarNovedad(estudianteId, fecha) {
  const { error } = await supabase
    .from('novedades_asistencia_dia')
    .delete()
    .eq('estudiante_id', estudianteId)
    .eq('fecha', fecha)
  if (error) throw error
}

/** Todas las novedades de un estudiante (más reciente primero). */
export async function listarHistorialEstudiante(estudianteId) {
  const { data, error } = await supabase
    .from('novedades_asistencia_dia')
    .select('fecha, tipo, observaciones, curso:cursos(nombre_completo)')
    .eq('estudiante_id', estudianteId)
    .order('fecha', { ascending: false })
    .limit(500)
  if (error) throw error
  return data ?? []
}

/** Mensaje entendible para errores comunes de RLS / restricciones. */
export function mensajeErrorNovedad(err) {
  const code = err?.code
  if (code === '42501') return 'No tienes permiso para registrar esta novedad (estudiante o curso fuera de tu colegio).'
  if (code === '23514') return 'La fecha no puede ser futura.'
  if (code === '23503') return 'El estudiante o el curso ya no existe.'
  return err?.message ?? 'Error desconocido'
}