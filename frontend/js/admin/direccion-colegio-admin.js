// js/admin/direccion-colegio-admin.js
// Superadmin: asignar / cambiar la dirección propia de un colegio (ej: mariscal-sucre -> mariscal-sucre.vercel.app)
import { supabase } from '../config/supabase-config.js'
import { toast, confirmar } from '../utils/ui.js'

window.editarDireccion = async function (id, actual) {
  const entrada = window.prompt(
    'Nombre de la dirección del colegio (solo minúsculas, números y guion; mínimo 3 caracteres; ej: mariscal-sucre).\n' +
    'Quedará como NOMBRE.vercel.app. Antes de guardarlo, agrega esa misma dirección en Vercel (Settings, Domains).',
    actual || ''
  )
  if (entrada === null) return
  const nombre = entrada.trim().toLowerCase()

  if (!nombre) { toast('El nombre de la dirección no puede quedar vacío', 'warning'); return }
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(nombre)) {
    toast('Nombre inválido: use minúsculas, números y guion (3 a 40 caracteres, sin puntos ni espacios)', 'warning'); return
  }
  if (nombre === actual) return

  if (actual && !await confirmar(
    'Cambiar dirección del colegio',
    `Las credenciales que ya se imprimieron con "${actual}" dejarán de funcionar si quitas esa dirección de Vercel. Deja las dos activas. ¿Continuar?`
  )) return

  const { error } = await supabase.from('colegios').update({ subdominio: nombre }).eq('id', id)
  if (error) {
    if (error.code === '23505') toast(`El nombre "${nombre}" ya lo usa otro colegio. Elija uno distinto.`, 'error')
    else if (error.code === '23514') toast('Ese nombre no está permitido (reservado o con formato inválido). Use otro.', 'error')
    else toast(error.message, 'error')
    return
  }
  toast(`Dirección asignada: ${nombre}`, 'success')
  window.dispatchEvent(new Event('colegios-actualizar'))
}