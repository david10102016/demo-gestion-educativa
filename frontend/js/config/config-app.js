// js/config/config-app.js
import { supabase } from './supabase-config.js'
import { conTimeout } from '../utils/data-layer.js'

const CONFIG_KEY = 'app_config_cache'
const CONFIG_TTL = 1000 * 60 * 30
// Última configuración buena por usuario: se usa solo si el servidor no responde
// (señal débil o sin conexión), en vez de la configuración genérica de respaldo.
const CONFIG_ULTIMA = (usuarioId) => `app_config_ultima::u_${usuarioId}`

export async function cargarConfiguracion(usuarioId = null) {
  try {
    const cached = sessionStorage.getItem(CONFIG_KEY)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CONFIG_TTL) {
        window.APP_CONFIG = data
        return data
      }
    }
  } catch (_) {}

  let data = null, error = null
  try {
    ;({ data, error } = await conTimeout(supabase.rpc('get_config_año'), 8000))
  } catch (e) {
    error = e                          // sin respuesta del servidor (tiempo agotado o sin red)
  }

  if (error || !data) {
    console.error('Error cargando configuración:', error)
    if (usuarioId) {
      try {
        const ultima = localStorage.getItem(CONFIG_ULTIMA(usuarioId))
        if (ultima) {
          window.APP_CONFIG = JSON.parse(ultima)
          return window.APP_CONFIG
        }
      } catch (_) {}
    }
    window.APP_CONFIG = configuracionFallback()
    return window.APP_CONFIG
  }

  sessionStorage.setItem(CONFIG_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  if (usuarioId) {
    try { localStorage.setItem(CONFIG_ULTIMA(usuarioId), JSON.stringify(data)) } catch (_) {}
  }
  window.APP_CONFIG = data
  return data
}

export function invalidarConfigCache() {
  sessionStorage.removeItem(CONFIG_KEY)
}

export const Config = {
  get año()               { return window.APP_CONFIG?.año ?? new Date().getFullYear() },
  get bloqueada()         { return window.APP_CONFIG?.bloqueada ?? false },
  get trimestreActivo()   { return window.APP_CONFIG?.trimestre_activo ?? 1 },
  get periodos()        { return window.APP_CONFIG?.periodos ?? [1,2,3].map(n=>({numero:n, nombre:`Trimestre ${n}`})) },
  get nombrePeriodo()   { return window.APP_CONFIG?.nombre_periodo ?? 'Trimestre' },
  get cantidadPeriodos(){ return window.APP_CONFIG?.cantidad_periodos ?? 3 },
  get notaMinima()      { return window.APP_CONFIG?.nota_minima ?? 51 },
  get escalaMaxima()    { return window.APP_CONFIG?.escala_maxima ?? 100 },
  get etiqAprobado()    { return window.APP_CONFIG?.etiqueta_aprobado ?? 'APROBADO' },
  get etiqReprobado()   { return window.APP_CONFIG?.etiqueta_reprobado ?? 'REPROBADO' },
  get dimensiones()     { return window.APP_CONFIG?.dimensiones ?? [] },
  get subcriteriosSer()        { return window.APP_CONFIG?.subcriterios_ser ?? [] },
  get escalaSer()              { return window.APP_CONFIG?.escala_ser ?? [] },
  get usaCarrerasTecnicas()    { return window.APP_CONFIG?.usa_carreras_tecnicas ?? false },
  get permiteEntregaTareas()  { return window.APP_CONFIG?.permite_entrega_tareas ?? false },

  pesoDimension(codigo) {
    const dim = this.dimensiones.find(d => d.codigo === codigo)
    return dim?.peso_maximo ?? 0
  },

  nombreDimension(codigo) {
    const dim = this.dimensiones.find(d => d.codigo === codigo)
    return dim?.nombre ?? codigo.toUpperCase()
  },

  subcriteriosPorCategoria() {
    const grupos = {}
    for (const s of this.subcriteriosSer) {
      if (!grupos[s.categoria_id]) {
        grupos[s.categoria_id] = { categoria: s.categoria, orden: s.cat_orden, items: [] }
      }
      grupos[s.categoria_id].items.push(s)
    }
    return Object.values(grupos).sort((a, b) => a.orden - b.orden)
  },

  etiquetaEscalaSer(valor) {
    const item = this.escalaSer.find(e => e.valor === valor)
    return item?.etiqueta ?? valor
  },

  estado(nota) {
    return Math.round(Math.round(nota * 100) / 100) >= this.notaMinima ? this.etiqAprobado : this.etiqReprobado
  }
}

function configuracionFallback() {
  return {
    año: new Date().getFullYear(),
    estado: 'activo',
    bloqueada: false,
    cantidad_periodos: 3,
    nombre_periodo: 'Trimestre',
    nota_minima: 51,
    escala_maxima: 100,
    etiqueta_aprobado: 'APROBADO',
    etiqueta_reprobado: 'REPROBADO',
    dimensiones: [
      { codigo: 'hacer',   nombre: 'HACER',   peso_maximo: 40, tipo: 'actividades', orden: 1 },
      { codigo: 'saber',   nombre: 'SABER',   peso_maximo: 45, tipo: 'actividades', orden: 2 },
      { codigo: 'ser',     nombre: 'SER',     peso_maximo: 10, tipo: 'ficha',       orden: 3 },
      { codigo: 'decidir', nombre: 'DECIDIR', peso_maximo:  5, tipo: 'directo',     orden: 4 }
    ],
    subcriterios_ser: [],
    escala_ser: [
      { valor: 10, etiqueta: 'Siempre',      color: 'green',  orden: 1 },
      { valor:  7, etiqueta: 'Casi Siempre', color: 'yellow', orden: 2 },
      { valor:  2, etiqueta: 'Nunca',        color: 'red',    orden: 3 }
    ],
    usa_carreras_tecnicas: false,
    permite_entrega_tareas: false,
    periodos: [1,2,3].map(n => ({ numero: n, nombre: `Trimestre ${n}` }))
  }
}