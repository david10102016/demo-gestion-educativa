// js/config/config-pagos.js
// Configuración del módulo de pagos.
// Sigue el mismo patrón que config-app.js — caché en sessionStorage,
// acceso centralizado vía objeto ConfigPagos.
import { supabase } from './supabase-config.js'

const PAGOS_CACHE_KEY = 'pagos_config_cache'
const PAGOS_CACHE_TTL = 1000 * 60 * 30 // 30 minutos

// Meses del año escolar boliviano (10 meses por defecto)
export const MESES_LABELS = {
  1:  'Enero',
  2:  'Febrero',
  3:  'Marzo',
  4:  'Abril',
  5:  'Mayo',
  6:  'Junio',
  7:  'Julio',
  8:  'Agosto',
  9:  'Septiembre',
  10: 'Octubre',
  11: 'Noviembre',
  12: 'Diciembre'
}

// Estados de pago con etiqueta y color para la UI
export const ESTADOS_PAGO = {
  pendiente:    { label: 'Pendiente',    color: 'amber'  },
  en_revision:  { label: 'En revisión',  color: 'blue'   },
  aprobado:     { label: 'Aprobado',     color: 'green'  },
  rechazado:    { label: 'Rechazado',    color: 'red'    }
}

// Niveles manejados en el módulo de pagos
export const NIVELES_PAGO = ['Primaria', 'Secundaria', 'Inicial']

// -------------------------------------------------------
// Cargar configuración de mensualidades desde la BD
// Se cachea igual que config-app.js
// -------------------------------------------------------
export async function cargarConfigPagos(año) {
  const cacheKey = `${PAGOS_CACHE_KEY}_${año}`

  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < PAGOS_CACHE_TTL) {
        window.PAGOS_CONFIG = data
        return data
      }
    }
  } catch (_) {}

  const { data, error } = await supabase
    .from('config_mensualidad')
    .select('*')
    .eq('año', año)
    .eq('activo', true)
    .order('nivel')
    .order('mes')

  if (error) {
    console.error('Error cargando config de pagos:', error)
    window.PAGOS_CONFIG = []
    return []
  }

  sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }))
  window.PAGOS_CONFIG = data
  return data
}

export function invalidarConfigPagosCache(año) {
  sessionStorage.removeItem(`${PAGOS_CACHE_KEY}_${año}`)
}

// -------------------------------------------------------
// Objeto de acceso centralizado — igual que Config en config-app.js
// -------------------------------------------------------
export const ConfigPagos = {

  // Monto de mensualidad para un nivel y mes específico
  monto(nivel, mes) {
    const config = (window.PAGOS_CONFIG ?? []).find(
      c => c.nivel === nivel && c.mes === mes
    )
    return config?.monto_bs ?? 0
  },

  // Meses activos para un nivel
  mesesActivos(nivel) {
    return (window.PAGOS_CONFIG ?? [])
      .filter(c => c.nivel === nivel)
      .map(c => c.mes)
      .sort((a, b) => a - b)
  },

  // Total anual para un nivel (suma de todos los meses activos)
  totalAnual(nivel) {
    return (window.PAGOS_CONFIG ?? [])
      .filter(c => c.nivel === nivel)
      .reduce((sum, c) => sum + Number(c.monto_bs), 0)
  },

  // Etiqueta legible de un mes
  labelMes(mes) {
    return MESES_LABELS[mes] ?? `Mes ${mes}`
  },

  // Estado legible con color
  estadoPago(estado) {
    return ESTADOS_PAGO[estado] ?? { label: estado, color: 'gray' }
  }
}

// -------------------------------------------------------
// Obtener el colegio_id del usuario actual
// Reutiliza el patrón de consulta existente en el sistema
// -------------------------------------------------------
export async function obtenerColegioId() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('usuarios')
    .select('colegio_id')
    .eq('id', user.id)
    .single()

  return data?.colegio_id ?? null
}

// -------------------------------------------------------
// Verificar si un estudiante tiene beca activa en el año
// -------------------------------------------------------
export async function tieneBeca(estudianteId, año) {
  const { data } = await supabase
    .from('becas_estudiante')
    .select('porcentaje')
    .eq('estudiante_id', estudianteId)
    .eq('año', año)
    .eq('activo', true)
    .maybeSingle()

  return data ?? null
}

// -------------------------------------------------------
// Calcular monto real considerando beca
// -------------------------------------------------------
export function montoConBeca(montoOriginal, beca) {
  if (!beca) return montoOriginal
  const descuento = (Number(beca.porcentaje) / 100) * montoOriginal
  return Math.max(0, montoOriginal - descuento)
}

// -------------------------------------------------------
// Formatear monto en bolivianos para la UI
// -------------------------------------------------------
export function formatBs(monto) {
  return `${Number(monto).toFixed(2)} Bs`
}

// -------------------------------------------------------
// Obtener resumen de pagos de un estudiante en el año
// Retorna: { pagados, pendientes, rechazados, totalPagado, totalPendiente }
// -------------------------------------------------------
export async function resumenPagosEstudiante(estudianteId, año) {
  const { data: pagos, error } = await supabase
    .from('pagos_mensualidad')
    .select('mes, monto_bs, estado')
    .eq('estudiante_id', estudianteId)
    .eq('año', año)

  if (error || !pagos) return null

  const aprobados  = pagos.filter(p => p.estado === 'aprobado')
  const pendientes = pagos.filter(p => ['pendiente', 'en_revision'].includes(p.estado))
  const rechazados = pagos.filter(p => p.estado === 'rechazado')

  return {
    aprobados:      aprobados.length,
    pendientes:     pendientes.length,
    rechazados:     rechazados.length,
    totalPagado:    aprobados.reduce((s, p) => s + Number(p.monto_bs), 0),
    mesesPagados:   aprobados.map(p => p.mes),
    mesesPendientes: pendientes.map(p => p.mes),
    registros:      pagos
  }
}