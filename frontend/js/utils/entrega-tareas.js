// js/utils/entrega-tareas.js
// Módulo compartido para subida y consulta de entregas de tareas
// Usado por: vista-calificaciones.js (profesor) y estudiante.js (estudiante)
// Requiere: permite_entrega_tareas = true en config_gestion

import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader } from './ui.js'
import { estaVencida } from './entrega-tardia.js'
import { subirArchivoTarea, borrarArchivoTarea } from './almacenamiento.js'

const MAX_BYTES    = 10 * 1024 * 1024  // 10MB
const TIPOS_VALIDOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'text/plain']

// ─── BORRAR ARCHIVO ────────────────────────────────────────────
// En producción pasa por la Edge Function "eliminar-archivo-cloudinary" (almacenamiento.js).
// Si falla, no interrumpe la entrega: solo queda registrado en consola.
const borrarArchivoCloudinary = borrarArchivoTarea

// Máximo de archivos por estudiante y actividad (la base de datos lo exige: migración 106)
export const MAX_ARCHIVOS = 2

// ─── SUBIR ARCHIVO ─────────────────────────────────────────────
/**
 * Sube el archivo a Cloudinary y lo guarda en entregas_tareas.
 * Sin reemplazarId: agrega un archivo nuevo (hasta MAX_ARCHIVOS).
 * Con reemplazarId: reemplaza ESE archivo y borra el anterior de Cloudinary.
 * @returns {object|null} fila guardada
 */
export async function subirEntrega(estudianteId, actividadId, file, reemplazarId = null) {
  // ─── Validar fecha límite ─────────────────────────────
  const { data: act } = await supabase
    .from('actividades')
    .select('*')
    .eq('id', actividadId)
    .single()

  if (act?.fecha_limite) {
    const [year, month, day] = act.fecha_limite.split('-').map(Number)
    const [hh, mm] = act.hora_limite
      ? act.hora_limite.split(':').map(Number)
      : [23, 59]
    // Construir fecha en hora local Bolivia sin conversión UTC
    const limite = new Date(year, month - 1, day, hh, mm, 59, 999)
    if (new Date() > limite && act.permite_entrega_tardia !== true) {
      toast(`La fecha límite de entrega ya venció (${limite.toLocaleDateString('es-BO', {day:'2-digit', month:'short'})} ${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}hs)`, 'warning')
      return null
    }
  }

  const entregaTardia = estaVencida(act)

  // ─── Validar tipo y tamaño ────────────────────────────
  if (!TIPOS_VALIDOS.includes(file.type)) {
    toast('Solo se permiten archivos PDF, JPG, PNG o TXT', 'warning')
    return null
  }
  if (file.size > MAX_BYTES) {
    toast('El archivo no puede superar 10MB', 'warning')
    return null
  }

  // ─── Límite de archivos (solo al agregar) ─────────────
  const actuales = await getEntregas(estudianteId, actividadId)
  const anterior = reemplazarId ? actuales.find(e => e.id === reemplazarId) : null
  if (!reemplazarId && actuales.length >= MAX_ARCHIVOS) {
    toast(`Máximo ${MAX_ARCHIVOS} archivos por tarea. Reemplaza o quita uno.`, 'warning')
    return null
  }

  mostrarLoader('Subiendo archivo...')
  try {
    const url = await subirArchivoTarea(file, 'entregas')

    const payload = {
      estudiante_id:  estudianteId,
      actividad_id:   actividadId,
      archivo_url:    url,
      archivo_nombre: file.name,
      archivo_tipo:   file.type,
      tamano_bytes:   file.size,
      updated_at:     new Date().toISOString()
    }

    const q = anterior
      ? supabase.from('entregas_tareas').update(payload).eq('id', anterior.id)
      : supabase.from('entregas_tareas').insert(payload)
    const { data, error: dbError } = await q.select().single()
    if (dbError) throw dbError

    // Ya quedó guardado el nuevo: recién se borra el archivo reemplazado
    if (anterior?.archivo_url && anterior.archivo_url !== url) {
      await borrarArchivoCloudinary(anterior.archivo_url)
    }

    toast(entregaTardia
      ? (anterior ? 'Archivo reemplazado (fuera de plazo)' : 'Tarea entregada fuera de plazo: quedó registrada como tardía')
      : (anterior ? 'Archivo reemplazado' : 'Tarea entregada correctamente'),
      entregaTardia ? 'warning' : 'success')
    return data
  } catch (err) {
    console.error('[entrega-tareas] Error subiendo:', err)
    toast(String(err?.message ?? '').includes('Máximo')
      ? `Máximo ${MAX_ARCHIVOS} archivos por tarea.`
      : 'No se pudo subir el archivo. Intenta de nuevo.', 'error')
    return null
  } finally {
    ocultarLoader()
  }
}

// ─── ARCHIVOS DE UN ESTUDIANTE EN UNA ACTIVIDAD ────────────────
export async function getEntregas(estudianteId, actividadId) {
  const { data } = await supabase
    .from('entregas_tareas')
    .select('*')
    .eq('estudiante_id', estudianteId)
    .eq('actividad_id', actividadId)
    .order('created_at', { ascending: true })
  return data ?? []
}

// Compatibilidad: el archivo más reciente (o null)
export async function getEntrega(estudianteId, actividadId) {
  const lista = await getEntregas(estudianteId, actividadId)
  return lista.length ? lista[lista.length - 1] : null
}

// ─── OBTENER TODAS LAS ENTREGAS DE UNA ACTIVIDAD (para profesor) ─
export async function getEntregasPorActividad(actividadId, estudiantes) {
  const { data } = await supabase
    .from('entregas_tareas')
    .select('*')
    .eq('actividad_id', actividadId)
    .order('created_at', { ascending: true })

  const porEst = {}
  ;(data ?? []).forEach(e => { (porEst[e.estudiante_id] ??= []).push(e) })

  // Combinar con lista de estudiantes para saber quién entregó y quién no
  return (estudiantes ?? []).map(est => ({
    estudiante_id: est.id,
    nombre:        est.usuarios?.nombre_completo ?? '—',
    entregas:      porEst[est.id] ?? [],
    entrega:       porEst[est.id]?.[0] ?? null
  }))
}

// ─── CONTAR ESTUDIANTES QUE ENTREGARON UNA ACTIVIDAD ───────────
export async function contarEntregas(actividadId) {
  const { data } = await supabase
    .from('entregas_tareas')
    .select('estudiante_id')
    .eq('actividad_id', actividadId)
  return new Set((data ?? []).map(e => e.estudiante_id)).size
}

// ─── ELIMINAR ──────────────────────────────────────────────────
// Con entregaId quita ese archivo; sin él, todos los del estudiante en la actividad
export async function eliminarEntrega(estudianteId, actividadId, entregaId = null) {
  const lista = (await getEntregas(estudianteId, actividadId))
    .filter(e => !entregaId || e.id === entregaId)
  for (const e of lista) {
    // Primero Cloudinary (la Edge Function verifica que la entrega exista)
    await borrarArchivoCloudinary(e.archivo_url)
    await supabase.from('entregas_tareas').delete().eq('id', e.id)
  }
}

// ─── CONTADORES EN TARJETAS (estudiantes que entregaron) ───────
export async function cargarContadoresEntregas(actividadIds) {
  if (!actividadIds?.length) return {}
  const { data } = await supabase
    .from('entregas_tareas')
    .select('actividad_id, estudiante_id')
    .in('actividad_id', actividadIds)

  const sets = {}
  ;(data ?? []).forEach(e => { (sets[e.actividad_id] ??= new Set()).add(e.estudiante_id) })
  return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size]))
}