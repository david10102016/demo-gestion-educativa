// js/utils/notificaciones.js
// Envío de notificaciones Telegram usando las Edge Functions del proyecto original.
// Las funciones de Telegram no cambian entre proyectos — solo llaman al bot API.
import { supabase } from '../config/supabase-config.js'
import { fechaLocal } from './ui.js'
import { paginar } from './paginar.js'

/**
 * Envía una notificación a un estudiante específico.
 * La plantilla se carga desde config_notificaciones en la BD.
 *
 * @param {string} estudianteId - UUID del estudiante
 * @param {string} tipo - tipo de notificación: 'nueva_actividad', 'nota_registrada', etc.
 * @param {object} vars - variables para reemplazar en la plantilla: { nombre, actividad_titulo, ... }
 */
export async function notificarEstudiante(estudianteId, tipo, vars = {}) {
  try {
    // Obtener plantilla desde la BD
    const { data: config } = await supabase
      .from('config_notificaciones')
      .select('plantilla, activo')
      .eq('tipo', tipo)
      .single()

    if (!config?.activo) return { ok: false, motivo: 'Notificación inactiva' }

    // Reemplazar variables en la plantilla
    const mensaje = reemplazarVars(config.plantilla, vars)

    // Llamar a la Edge Function
    const { data, error } = await supabase.functions.invoke('telegram-notificar', {
      body: { estudianteId, tipo, mensaje }
    })

    if (error) throw error
    return { ok: true, data }

  } catch (err) {
    console.error('Error enviando notificación:', err)
    return { ok: false, error: err.message }
  }
}

/**
 * Envía una notificación masiva a todos los estudiantes de un curso.
 *
 * @param {string} cursoId - UUID del curso
 * @param {string} tipo - tipo de notificación
 * @param {object} varsBase - variables base (sin {nombre}, que se agrega por estudiante)
 * @returns {{ exitosos, fallidos, total }}
 */
export async function notificarCurso(cursoId, tipo, varsBase = {}) {
  // Obtener estudiantes del curso con Telegram vinculado
  const { data: estudiantes } = await supabase
    .from('estudiantes')
    .select(`
      id,
      usuarios(nombre_completo),
      telegram_vinculos!inner(chat_id, vinculado, activo)
    `)
    .eq('curso_id', cursoId)
    .eq('telegram_vinculos.vinculado', true)
    .eq('telegram_vinculos.activo', true)

  if (!estudiantes?.length) return { exitosos: 0, fallidos: 0, total: 0 }

  let exitosos = 0
  let fallidos = 0

  // Procesar en lotes de 10 para respetar rate limit de Telegram
  const lotes = chunk(estudiantes, 10)

  for (const lote of lotes) {
    const promesas = lote.map(est =>
      notificarEstudiante(est.id, tipo, {
        ...varsBase,
        nombre: est.usuarios?.nombre_completo ?? 'Estudiante'
      })
    )

    const resultados = await Promise.allSettled(promesas)
    resultados.forEach(r => {
      if (r.status === 'fulfilled' && r.value?.ok) exitosos++
      else fallidos++
    })

    // Pausa entre lotes para no saturar la API de Telegram
    if (lotes.indexOf(lote) < lotes.length - 1) {
      await delay(1000)
    }
  }

  return { exitosos, fallidos, total: estudiantes.length }
}

/**
 * Notifica a todos los estudiantes de un curso sobre una nueva actividad.
 */
export async function notificarNuevaActividad(cursoId, actividad) {
  return notificarCurso(cursoId, 'nueva_actividad', {
    actividad_titulo: actividad.titulo,
    fecha_limite:     actividad.fecha_limite
      ? new Date(actividad.fecha_limite).toLocaleDateString('es-BO')
      : 'Sin fecha límite',
    max_puntos: actividad.max_puntos
  })
}

/**
 * Notifica a un estudiante que su nota fue registrada.
 */
export async function notificarNotaRegistrada(estudianteId, nombreEst, actividad, valor) {
  return notificarEstudiante(estudianteId, 'nota_registrada', {
    nombre:           nombreEst,
    actividad_titulo: actividad.titulo,
    nota_valor:       valor,
    max_puntos:       actividad.max_puntos
  })
}

/**
 * Envía alerta de faltas a estudiantes que superan el umbral configurado.
 */
export async function verificarYNotificarFaltas(cursoId) {
  // Obtener umbral desde config
  const { data: cfg } = await supabase
    .from('config_notificaciones')
    .select('umbral_faltas')
    .eq('tipo', 'faltas_alerta')
    .single()

  const umbral = cfg?.umbral_faltas ?? 3

  // Fecha hace 30 días
  const hace30 = new Date()
  hace30.setDate(hace30.getDate() - 30)
  const fechaInicio = fechaLocal(hace30)
  const fechaFin    = fechaLocal()

    // Obtener faltas desde asistencias_materia (v5).
  // Prioridad por día/sesión: FALTA > LICENCIA > RETRASO > PRESENTE.
  const { data: filas } = await paginar(() => supabase
    .from('asistencias_materia')
    .select('estudiante_id, fecha, sesion, estado, estudiantes(usuarios(nombre_completo))')
    .eq('curso_id', cursoId)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin))

  // Agrupar por estudiante + fecha + sesión y aplicar prioridad
  const porDia = {}
  for (const r of filas ?? []) {
    const key = `${r.estudiante_id}|${r.fecha}|${r.sesion}`
    if (!porDia[key]) {
      porDia[key] = {
        estudiante_id: r.estudiante_id,
        nombre: r.estudiantes?.usuarios?.nombre_completo ?? 'Estudiante',
        estados: [],
      }
    }
    porDia[key].estados.push(r.estado)
  }

  const conteo = {}
  for (const d of Object.values(porDia)) {
    let estado = 'presente'
    if (d.estados.includes('falta')) estado = 'falta'
    else if (d.estados.includes('licencia')) estado = 'licencia'
    else if (d.estados.includes('retraso')) estado = 'retraso'

    if (estado !== 'falta') continue

    if (!conteo[d.estudiante_id]) {
      conteo[d.estudiante_id] = { nombre: d.nombre, faltas: 0 }
    }
    conteo[d.estudiante_id].faltas++
  }

  // Notificar solo a los que superan el umbral
  const resultados = []
  for (const [estId, data] of Object.entries(conteo)) {
    if (data.faltas >= umbral) {
      const res = await notificarEstudiante(estId, 'faltas_alerta', {
        nombre: data.nombre,
        faltas: data.faltas
      })
      resultados.push({ estudianteId: estId, nombre: data.nombre, faltas: data.faltas, ...res })
    }
  }

  return resultados
}

// ─── HELPERS ─────────────────────────────────────────────
function reemplazarVars(plantilla, vars) {
  let resultado = plantilla
  for (const [key, value] of Object.entries(vars)) {
    resultado = resultado.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '')
  }
  return resultado
}

function chunk(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}