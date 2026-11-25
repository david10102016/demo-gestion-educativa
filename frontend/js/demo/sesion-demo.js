// js/demo/sesion-demo.js
// Entrar o cambiar de rol en una cuenta de prueba con un clic.
// La Edge Function "demo-entrar" abre la sesión en el servidor y devuelve solo los tokens:
// ninguna contraseña pasa por el navegador.

import { supabase } from '../config/supabase-config.js'
import { guardarSlug, RUTAS_ROL } from './demo-config.js'
import { clearUserCache } from '../utils/offline-db.js'

async function mensajeDeError(error, data) {
  if (data?.mensaje) return data.mensaje
  if (data?.error) return data.error
  try {
    const cuerpo = await error?.context?.json?.()
    if (cuerpo?.error === 'vencido') return 'La cuenta de prueba terminó.'
    if (cuerpo?.mensaje) return cuerpo.mensaje
    if (cuerpo?.error) return cuerpo.error
  } catch (_) {}
  if (!navigator.onLine) return 'Sin conexión a internet.'
  return 'No se pudo entrar. Intenta de nuevo.'
}

/** Guarda los datos del colegio como lo hace el login normal (colores, logo, nombre) */
export function guardarColegioLocal(col) {
  if (!col?.id) return
  const sigla = col.sigla || String(col.nombre ?? '').split(' ').filter(w => w.length > 2).map(w => w[0]).join('').slice(0, 3).toUpperCase()
  try {
    localStorage.setItem('colegio_id', col.id)
    sessionStorage.setItem('colegio_id', col.id)
    localStorage.setItem('color_primario', col.color_primario || '#1d4ed8')
    localStorage.setItem('color_secundario', col.color_secundario || '#ffffff')
    localStorage.setItem('colegio_nombre', col.nombre ?? '')
    localStorage.setItem('colegio_sigla', sigla)
    localStorage.setItem('colegio_logo_url', col.logo_url || '')
  } catch (_) {}
}

/**
 * Abre la sesión del rol elegido y lleva a su panel.
 * Devuelve un mensaje de error si no se pudo (y no redirige).
 */
export async function entrarComo(slug, clave) {
  if (!navigator.onLine) return 'Sin conexión a internet. La prueba necesita conexión para entrar.'

  const { data, error } = await supabase.functions.invoke('demo-entrar', { body: { slug, clave } })
  if (error || !data?.access_token) return mensajeDeError(error, data)

  // setSession reemplaza la sesión anterior sin cerrarla (cerrarla dispararía la salida al login).
  // Antes se borran las copias sin conexión del rol anterior en este dispositivo.
  try {
    const { data: { session: previa } } = await supabase.auth.getSession()
    if (previa?.user?.id) await clearUserCache(previa.user.id)
  } catch (_) {}
  try { sessionStorage.clear() } catch (_) {}

  const { error: errSes } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
  if (errSes) return 'No se pudo abrir la sesión de prueba.'

  guardarSlug(slug)
  guardarColegioLocal(data.colegio)
  window.location.href = RUTAS_ROL[data.rol] ?? '/'
  return null
}
