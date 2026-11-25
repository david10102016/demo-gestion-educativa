// js/porteria/porteria-api.js
// ÚNICO punto de acceso a las funciones de la migración 091 (Portería QR).
// Lo usan: escáner (regente), director, profesor, estudiante y tutor.
// No dibuja nada: solo datos y utilidades de fecha/hora en hora de Bolivia.
import { supabase } from '../config/supabase-config.js'
import { paginar } from '../utils/paginar.js'

export const ZONA = 'America/La_Paz'

export const ESTADOS = {
  a_tiempo:          { texto: 'A tiempo',          color: '#16a34a', fondo: '#dcfce7', icono: '🟢' },
  atraso:            { texto: 'Atraso',            color: '#c2410c', fondo: '#ffedd5', icono: '🟠' },
  salida_anticipada: { texto: 'Salida anticipada', color: '#a16207', fondo: '#fef9c3', icono: '🟡' },
  normal:            { texto: 'Salida normal',     color: '#16a34a', fondo: '#dcfce7', icono: '🟢' },
  fuera_de_horario:  { texto: 'Fuera de horario',  color: '#4338ca', fondo: '#e0e7ff', icono: '🔵' },
  sin_ingreso:       { texto: 'Aún no ingresó',        color: '#475569', fondo: '#f1f5f9', icono: '⚪' },
}

export const ALERTAS = {
  atraso:            'Atraso',
  salida_anticipada: 'Salida anticipada',
  exceso_salidas:    'Demasiadas salidas',
  duplicado:         'Posible QR duplicado',
  posible_fuga:      'Posible fuga',
  inconsistencia:    'Inconsistencia',
}

export const TURNOS = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }

// ─── Fecha y hora (siempre Bolivia) ─────────────────────────
/** 'YYYY-MM-DD' de hoy en Bolivia */
export function hoyBolivia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date())
}
/** '07:25' de un timestamp */
export function horaBolivia(ts) {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('es-BO', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}
/** Suma días a 'YYYY-MM-DD' */
export function sumarDias(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}
/** Lunes de la semana de una fecha */
export function lunesDe(fecha) {
  const d = new Date(fecha + 'T12:00:00')
  const dia = (d.getDay() + 6) % 7
  return sumarDias(fecha, -dia)
}
export function fechaLarga(fecha, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(fecha + 'T12:00:00').toLocaleDateString('es-BO', opts)
}

// ─── Llamadas a la base (091) ───────────────────────────────
async function rpc(nombre, params = {}) {
  const { data, error } = await supabase.rpc(nombre, params)
  if (error) throw new Error(error.message)
  return data
}

/** ¿El colegio del usuario tiene el módulo encendido? (nunca lanza error) */
export async function porteriaActiva() {
  try { return !!(await rpc('porteria_activa')) } catch { return false }
}

export const registrar = ({ clientUuid, tipo, codigo = null, estudianteId = null, hora = null, dispositivo = null, motivo = null }) =>
  rpc('registrar_porteria', {
    p_client_uuid: clientUuid, p_tipo: tipo, p_codigo: codigo, p_estudiante_id: estudianteId,
    p_hora: hora, p_metodo: codigo ? 'qr' : 'manual', p_dispositivo: dispositivo, p_motivo: motivo,
  })

export const anotarMotivo   = (registroId, motivo) => rpc('anotar_motivo_porteria', { p_registro_id: registroId, p_motivo: motivo })
export const justificar     = (alertaId, motivo)   => rpc('justificar_alerta_porteria', { p_alerta_id: alertaId, p_motivo: motivo })
/** Lista completa del escáner, en páginas de 1000 (PostgREST corta en 1000 filas) */
export async function listaEscaner() {
  const { data, error } = await paginar(() => supabase.rpc('porteria_lista_escaner').order('nombre_completo'), ['estudiante_id'])
  if (error) throw new Error(error.message)
  return data ?? []
}
export const generarQrCurso = (cursoId)            => rpc('generar_qr_curso', { p_curso_id: cursoId })
export const regenerarQr    = (estudianteId)       => rpc('regenerar_qr_estudiante', { p_estudiante_id: estudianteId })
export const resumenDia     = (fecha)              => rpc('porteria_resumen_dia', { p_fecha: fecha })
export async function cruceDia(fecha) {
  // Un día sin usar la portería puede dar cientos de "inconsistencias": se trae completo en páginas
  const { data, error } = await paginar(() => supabase.rpc('porteria_cruce_dia', { p_fecha: fecha }), ['estudiante_id', 'tipo'])
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function ingresoHoyCurso(cursoId) {
  try { return await rpc('porteria_ingreso_hoy_curso', { p_curso_id: cursoId }) ?? [] } catch { return [] }
}

/** Profesor (092): hora de ingreso de hoy de los estudiantes de su lista (sirve también para técnicas A+B) */
export async function ingresoHoyEstudiantes(estudianteIds) {
  if (!estudianteIds?.length) return []
  try { return await rpc('porteria_ingreso_hoy_estudiantes', { p_estudiante_ids: estudianteIds }) ?? [] } catch { return [] }
}

export const guardarHorario = (h) => rpc('guardar_horario_porteria', {
  p_turno: h.turno, p_nivel: h.nivel, p_hora_entrada: h.entrada,
  p_tolerancia_min: h.tolerancia, p_hora_salida: h.salida, p_activo: h.activo,
})

// 093: excepciones de horario por grado (ej. 5° y 6° Secundaria Tarde 14:00)
export const guardarHorarioGrado = (h) => rpc('guardar_horario_grado_porteria', {
  p_turno: h.turno, p_nivel: h.nivel, p_grados: h.grados, p_hora_entrada: h.entrada,
  p_tolerancia_min: h.tolerancia, p_hora_salida: h.salida,
})
export const quitarHorarioGrado = (id) => rpc('quitar_horario_grado_porteria', { p_id: id })
export async function horariosGrado() {
  const { data, error } = await supabase.from('porteria_horarios_grado').select('*').order('turno').order('nivel').order('grado')
  if (error) throw new Error(error.message)
  return data ?? []
}

// Lecturas directas (protegidas por RLS de la 091)
export async function horarios() {
  const { data, error } = await supabase.from('porteria_horarios').select('*').order('turno').order('nivel')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Registros de un rango (director: todo el colegio; estudiante/tutor: solo lo suyo por RLS) */
export async function registros({ desde, hasta, estudianteIds = null, conNombres = false }) {
  const construir = () => {
  let q = supabase.from('asistencia_porteria')
    .select(conNombres
      ? 'id, estudiante_id, fecha, hora, turno, tipo, estado, metodo, dispositivo, motivo, duplicado, registrado_por, estudiante:estudiantes(curso:cursos(nombre_completo, nivel), usuarios(nombre_completo))'
      : 'id, estudiante_id, fecha, hora, turno, tipo, estado, metodo, motivo, duplicado')
    .gte('fecha', desde).lte('fecha', hasta)
    .order('hora', { ascending: true })
  if (estudianteIds?.length) q = q.in('estudiante_id', estudianteIds)
  return q
  }
  // Un colegio grande puede superar las 1000 filas de PostgREST en un día (entradas + salidas)
  const { data, error } = await paginar(construir, ['id'])
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function alertas({ desde = null, hasta = null, estado = null, estudianteIds = null, conNombres = false } = {}) {
  // En páginas de 1000: las pendientes de muchos días pueden superar el corte de PostgREST
  const construir = () => {
  let q = supabase.from('porteria_alertas')
    .select(conNombres
      ? 'id, estudiante_id, fecha, tipo, estado, justificacion, justificado_at, registro:asistencia_porteria(hora, motivo), estudiante:estudiantes(curso:cursos(nombre_completo), usuarios(nombre_completo))'
      : 'id, estudiante_id, fecha, tipo, estado, justificacion, justificado_at')
    .order('fecha', { ascending: false })
  if (desde) q = q.gte('fecha', desde)
  if (hasta) q = q.lte('fecha', hasta)
  if (estado) q = q.eq('estado', estado)
  if (estudianteIds?.length) q = q.in('estudiante_id', estudianteIds)
  return q
  }
  const { data, error } = await paginar(construir, ['id'])
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Identificador único por registro (idempotencia de la cola sin internet) */
export function nuevoUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

/** Resume los registros de un estudiante en un día: entrada, salida y estado más relevante */
export function resumirDia(regs) {
  const validos = regs.filter(r => !r.duplicado)
  const entradas = validos.filter(r => r.tipo === 'entrada')
  const salidas  = validos.filter(r => r.tipo === 'salida')
  const prioridad = ['salida_anticipada', 'atraso', 'fuera_de_horario', 'a_tiempo', 'normal']
  let estado = entradas.length ? 'a_tiempo' : 'sin_ingreso'
  for (const p of prioridad) { if (validos.some(r => r.estado === p)) { estado = p; break } }
  if (!entradas.length && !salidas.length) estado = 'sin_ingreso'
  return {
    entrada: entradas[0]?.hora ?? null,
    salida:  salidas[salidas.length - 1]?.hora ?? null,
    salidas: salidas.length,
    estado,
    movimientos: validos,
  }
}

// ─── 095: fotos de estudiantes (bucket privado 'fotos-estudiantes') ─────────
export const BUCKET_FOTOS = 'fotos-estudiantes'
export const fotosCurso   = (cursoId)            => rpc('fotos_curso', { p_curso_id: cursoId })
export const estadoFoto   = (estudianteId)       => rpc('estado_foto_estudiante', { p_estudiante_id: estudianteId })
export const guardarFoto  = (estudianteId, path, reemplazar = false) =>
  rpc('guardar_foto_estudiante', { p_estudiante_id: estudianteId, p_path: path, p_reemplazar: reemplazar })
export const restaurarFoto = (estudianteId)      => rpc('restaurar_foto_estudiante', { p_estudiante_id: estudianteId })

/** Sube el JPEG y devuelve la ruta {colegio}/{estudiante}/{marca}.jpg */
export async function subirFoto(blob, colegioId, estudianteId) {
  const path = `${colegioId}/${estudianteId}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  return path
}
export async function borrarFotoSubida(path) {
  try { await supabase.storage.from(BUCKET_FOTOS).remove([path]) } catch { /* sin efecto */ }
}
/** Enlaces firmados temporales. Acepta rutas o URLs (las URLs se devuelven tal cual). */
export async function urlsFirmadas(paths, segundos = 600) {
  const mapa = new Map()
  const rutas = [...new Set((paths ?? []).filter(p => p && !/^https?:/i.test(p)))]
  ;(paths ?? []).filter(p => p && /^https?:/i.test(p)).forEach(u => mapa.set(u, u))
  for (let i = 0; i < rutas.length; i += 100) {
    const lote = rutas.slice(i, i + 100)
    const { data } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(lote, segundos)
    ;(data ?? []).forEach(d => { if (d.signedUrl) mapa.set(d.path, d.signedUrl) })
  }
  return mapa
}
export async function urlFirmada(path, segundos = 600) {
  if (!path) return null
  return (await urlsFirmadas([path], segundos)).get(path) ?? null
}