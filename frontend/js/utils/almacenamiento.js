// js/utils/almacenamiento.js
// Subida y borrado de archivos (consignas, entregas de tareas y comprobantes de pago).
//
// VITE_ALMACENAMIENTO:
//   - 'cloudinary' (por defecto, producción): igual que siempre.
//   - 'supabase'   (despliegue de cuentas de prueba): bucket público "archivos-demo",
//                  ruta <colegio_id>/<carpeta>/<uuid>-<nombre>. Al borrar el demo se borra su carpeta.

import { supabase } from '../config/supabase-config.js'

export const ALMACENAMIENTO = import.meta.env.VITE_ALMACENAMIENTO === 'supabase' ? 'supabase' : 'cloudinary'
const BUCKET_DEMO = 'archivos-demo'

// Cloudinary de tareas (consignas y entregas): mismos valores que ya usaba el sistema
const TAREAS_CLOUD  = import.meta.env.VITE_CLOUDINARY_TAREAS_CLOUD_NAME || 'drcoufr1t'
const TAREAS_PRESET = import.meta.env.VITE_CLOUDINARY_TAREAS_PRESET || 'tareas_preset'

let colegioCache = null
async function miColegioId() {
  if (colegioCache) return colegioCache
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) throw new Error('Sin sesión')
  const { data, error } = await supabase.from('usuarios').select('colegio_id').eq('id', session.user.id).single()
  if (error || !data?.colegio_id) throw new Error('No se pudo identificar el colegio')
  colegioCache = data.colegio_id
  return colegioCache
}

function nombreSeguro(nombre) {
  const limpio = String(nombre ?? 'archivo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80)
  return limpio || 'archivo'
}

function uuid() {
  return crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

async function subirASupabase(file, carpeta) {
  const colegio = await miColegioId()
  const ruta = `${colegio}/${carpeta}/${uuid()}-${nombreSeguro(file.name)}`
  const { error } = await supabase.storage.from(BUCKET_DEMO).upload(ruta, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  })
  if (error) throw new Error(error.message || 'No se pudo subir el archivo')
  return supabase.storage.from(BUCKET_DEMO).getPublicUrl(ruta).data.publicUrl
}

async function subirACloudinary(file, { cloud, preset, recurso, carpeta }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', preset)
  if (carpeta) formData.append('folder', carpeta)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${recurso}/upload`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`Cloudinary respondió ${res.status}`)
  const { secure_url } = await res.json()
  if (!secure_url) throw new Error('Cloudinary no devolvió la dirección del archivo')
  return secure_url
}

/** Consigna del profesor o entrega del estudiante. Devuelve la URL pública. */
export async function subirArchivoTarea(file, carpeta = 'tareas') {
  if (ALMACENAMIENTO === 'supabase') return subirASupabase(file, carpeta)
  return subirACloudinary(file, { cloud: TAREAS_CLOUD, preset: TAREAS_PRESET, recurso: 'raw' })
}

/** Comprobante de pago del tutor. Devuelve la URL pública. */
export async function subirComprobantePago(file, tutorId) {
  if (ALMACENAMIENTO === 'supabase') return subirASupabase(file, `pagos/${tutorId}`)
  const cloud  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const preset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  if (!cloud || !preset) throw new Error('Faltan variables de entorno de Cloudinary')
  try {
    return await subirACloudinary(file, { cloud, preset, recurso: 'auto', carpeta: `pagos/${tutorId}` })
  } catch (_) {
    throw new Error('Error al subir el comprobante a Cloudinary')
  }
}

/** Ruta dentro del bucket demo a partir de su URL pública (o null si no es de ese bucket) */
function rutaDemoDeUrl(url) {
  const marca = `/storage/v1/object/public/${BUCKET_DEMO}/`
  const i = String(url ?? '').indexOf(marca)
  return i < 0 ? null : decodeURIComponent(String(url).slice(i + marca.length).split('?')[0])
}

/**
 * Borra un archivo de tarea. Nunca interrumpe el flujo: si falla, solo queda en consola.
 * Cloudinary necesita la firma secreta, por eso pasa por la Edge Function "eliminar-archivo-cloudinary".
 */
export async function borrarArchivoTarea(url) {
  if (!url) return
  try {
    const rutaDemo = rutaDemoDeUrl(url)
    if (rutaDemo) {
      const { error } = await supabase.storage.from(BUCKET_DEMO).remove([rutaDemo])
      if (error) console.warn('[almacenamiento] No se pudo borrar el archivo:', error)
      return
    }
    if (ALMACENAMIENTO === 'supabase') return   // archivo de ejemplo o externo: no se toca
    const { error } = await supabase.functions.invoke('eliminar-archivo-cloudinary', { body: { archivo_url: url } })
    if (error) console.warn('[almacenamiento] No se pudo borrar en Cloudinary:', error)
  } catch (e) {
    console.warn('[almacenamiento] No se pudo borrar el archivo:', e)
  }
}
