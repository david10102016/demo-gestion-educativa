// js/licencias/licencias-api.js
// Capa común del módulo de licencias (migración 101): llamadas a la base, archivos y textos.
// La usan: tutor-licencias.js (tutor), bandeja-licencias.js y permisos.js (director/secretaria),
// licencias-profesor.js (profesor). Toda escritura pasa por funciones RPC de la base.
import { supabase } from '../config/supabase-config.js'

export const BUCKET = 'documentos-tutores'

export const MOTIVOS = {
  emergencia: '🚨 Emergencia',
  salud:      '🩺 Salud',
  viaje:      '✈️ Viaje',
  academico:  '🎓 Académico',
  otro:       '📝 Otro',
}
export const ESTADOS = {
  pendiente: { txt: 'Pendiente', badge: 'badge-warning' },
  aprobada:  { txt: 'Aprobada',  badge: 'badge-success' },
  rechazada: { txt: 'Rechazada', badge: 'badge-error' },
  cancelada: { txt: 'Cancelada', badge: 'badge-neutral' },
}
export const PARENTESCOS = {
  padre: 'Padre', madre: 'Madre', tutor_legal: 'Tutor legal',
  abuelo: 'Abuelo', abuela: 'Abuela', tio: 'Tío', tia: 'Tía',
  hermano: 'Hermano (mayor de edad)', hermana: 'Hermana (mayor de edad)', otro: 'Otro',
}
export const RECHAZO_LICENCIA = {
  comprobante_ilegible: 'Comprobante ilegible o no corresponde',
  fuera_de_plazo:       'Fuera de plazo',
  falta_comprobante:    'Falta comprobante',
  limite_mes:           'Límite de licencias del mes alcanzado',
  presentarse_direccion:'Debe presentarse en dirección',
  otro:                 'Otro',
}
export const RECHAZO_VINCULO = {
  carnet_ilegible:      'Carnet ilegible',
  no_corresponde:       'El carnet no corresponde al tutor',
  parentesco_no_valido: 'Parentesco no válido',
  presentarse_direccion:'Debe presentarse en dirección',
  otro:                 'Otro',
}
export const LIMITES = { descripcion: 300, nota: 200, diasMax: 5, porMes: 4 }

// Palabras que no se aceptan en la descripción (filtro básico; la dirección igual revisa todo)
const OFENSIVAS = ['idiota', 'imbecil', 'imbécil', 'estupido', 'estúpido', 'pendejo', 'mierda', 'carajo', 'puta', 'puto',
  'cojudo', 'huevon', 'huevón', 'maldito', 'basura', 'inutil', 'inútil', 'ladron', 'ladrón', 'corrupto']
export function textoOfensivo(texto = '') {
  const t = ' ' + texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ ]/g, ' ') + ' '
  return OFENSIVAS.some(p => t.includes(' ' + p.normalize('NFD').replace(/[̀-ͯ]/g, '') + ' '))
}

/** Fecha de hoy en Bolivia (YYYY-MM-DD), igual que hoy_bolivia() de la base */
export function hoyBolivia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
}
export function fechaCorta(iso) {
  if (!iso) return ''
  return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function rangoTexto(ini, fin) {
  return ini === fin ? fechaCorta(ini) : `${fechaCorta(ini)} al ${fechaCorta(fin)}`
}

/** Error legible desde una respuesta de Supabase (los RAISE de la base vienen en message) */
function err(e) { return new Error(e?.message || 'Error inesperado') }

// ─────────────────────────── Imágenes ───────────────────────────
/**
 * Reduce una foto (cámara o galería) a JPEG liviano: lado mayor ≤ 1280 px y ~200 KB o menos.
 * Devuelve un Blob listo para subir.
 */
export async function comprimirImagen(file, { maxLado = 1280, maxBytes = 200 * 1024 } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('El archivo debe ser una imagen (foto)')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la imagen')); i.src = url })
    let lado = maxLado, calidad = 0.72, blob = null
    for (let intento = 0; intento < 6; intento++) {
      const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', calidad))
      if (blob && blob.size <= maxBytes) break
      if (calidad > 0.5) calidad -= 0.1; else lado = Math.round(lado * 0.8)
    }
    if (!blob) throw new Error('No se pudo procesar la imagen')
    return blob
  } finally { URL.revokeObjectURL(url) }
}

/** Sube un blob a <uid>/<carpeta>/<aleatorio>.jpg y devuelve la ruta */
export async function subirArchivo(blob, carpeta) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Sesión vencida. Vuelve a ingresar.')
  const ruta = `${user.id}/${carpeta}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw err(error)
  return ruta
}
export async function borrarArchivos(rutas) {
  const lista = (rutas ?? []).filter(Boolean)
  if (lista.length) await supabase.storage.from(BUCKET).remove(lista)
}
/** URL temporal (5 min) para ver un documento privado */
export async function urlFirmada(ruta) {
  if (!ruta) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 300)
  if (error) return null
  return data?.signedUrl ?? null
}

// ─────────────────────────── Tutor ───────────────────────────
export async function miVerificacion() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('tutor_verificacion')
    .select('estado, parentesco, motivo_rechazo, nota, revisado_en').eq('tutor_id', user.id).maybeSingle()
  return data ?? null
}
export async function registrarCarnet(parentesco, rutaAnverso, rutaReverso) {
  const { error } = await supabase.rpc('registrar_verificacion_tutor', { p_parentesco: parentesco, p_anverso: rutaAnverso, p_reverso: rutaReverso })
  if (error) throw err(error)
}
export async function misLicencias() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.from('licencias').select('*').eq('tutor_id', user.id).order('created_at', { ascending: false }).limit(60)
  if (error) throw err(error)
  return data ?? []
}
export async function solicitarLicencia({ estudianteId, motivo, inicio, fin, descripcion, comprobante }) {
  const { data, error } = await supabase.rpc('solicitar_licencia', {
    p_estudiante_id: estudianteId, p_motivo: motivo, p_inicio: inicio, p_fin: fin,
    p_descripcion: descripcion, p_comprobante: comprobante ?? null,
  })
  if (error) throw err(error)
  return data
}
export async function cancelarLicencia(id) {
  const { error } = await supabase.rpc('cancelar_licencia', { p_id: id })
  if (error) throw err(error)
}

// ─────────────────────────── Dirección ───────────────────────────
export async function resolverLicencia(id, aprobar, motivo = null, nota = null) {
  const { error } = await supabase.rpc('resolver_licencia', { p_id: id, p_aprobar: aprobar, p_motivo: motivo, p_nota: nota })
  if (error) throw err(error)
}
/** Acepta o rechaza el carnet de un tutor y elimina las fotos del bucket */
export async function revisarVinculacion(tutorId, aceptar, motivo = null, nota = null) {
  const { data, error } = await supabase.rpc('revisar_vinculacion', { p_tutor_id: tutorId, p_aceptar: aceptar, p_motivo: motivo, p_nota: nota })
  if (error) throw err(error)
  try { await borrarArchivos([data?.anverso, data?.reverso]) } catch (_) { /* si falla, quedan huérfanas pero inaccesibles */ }
}
/** ¿El usuario actual tiene este permiso? (director: siempre) */
export async function tengoPermiso(permiso) {
  const { data, error } = await supabase.rpc('tiene_permiso', { p_permiso: permiso })
  return !error && data === true
}

/** Nombres de usuarios por id (en lotes) → { id: nombre } */
export async function nombresUsuarios(ids) {
  const unicos = [...new Set((ids ?? []).filter(Boolean))]
  const mapa = {}
  for (let i = 0; i < unicos.length; i += 150) {
    const { data } = await supabase.from('usuarios').select('id, nombre_completo').in('id', unicos.slice(i, i + 150))
    ;(data ?? []).forEach(u => { mapa[u.id] = (u.nombre_completo ?? '').replace(/\s+/g, ' ').trim() })
  }
  return mapa
}
/** Curso de cada estudiante → { id: 'nombre del curso' } */
export async function cursosDeEstudiantes(ids) {
  const unicos = [...new Set((ids ?? []).filter(Boolean))]
  const mapa = {}
  for (let i = 0; i < unicos.length; i += 150) {
    const { data } = await supabase.from('estudiantes').select('id, cursos(nombre_completo)').in('id', unicos.slice(i, i + 150))
    ;(data ?? []).forEach(e => { mapa[e.id] = e.cursos?.nombre_completo ?? '' })
  }
  return mapa
}

// ─────────────────────────── Profesor ───────────────────────────
/** Licencias aprobadas que cubren una fecha, para una lista de estudiantes → { estudiante_id: licencia } */
export async function licenciasAprobadasDelDia(estudianteIds, fecha) {
  const mapa = {}
  const ids = [...new Set((estudianteIds ?? []).filter(Boolean))]
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from('licencias')
      .select('id, estudiante_id, motivo, fecha_inicio, fecha_fin')
      .eq('estado', 'aprobada').lte('fecha_inicio', fecha).gte('fecha_fin', fecha)
      .in('estudiante_id', ids.slice(i, i + 150))
    ;(data ?? []).forEach(l => { mapa[l.estudiante_id] = l })
  }
  return mapa
}
