// js/demo/demo-config.js
// Modo demo: solo se activa en el despliegue de cuentas de prueba (VITE_MODO_DEMO=true).
// En producción esta variable no existe, así que nada de la carpeta js/demo/ se ejecuta.

export const MODO_DEMO = import.meta.env.VITE_MODO_DEMO === 'true'

// Contacto que se muestra en la entrada y en la barra de la prueba (WhatsApp, solo números con código de país)
export const DEMO_WHATSAPP = String(import.meta.env.VITE_DEMO_WHATSAPP ?? '').replace(/\D/g, '')

export const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/

const CLAVE_SLUG = 'demo_slug'

/** Enlace del demo en la dirección actual: /san-jose (o ?demo=san-jose) */
export function slugDeLaDireccion(loc = window.location) {
  const desdeRuta = loc.pathname.split('/').filter(Boolean)[0] ?? ''
  if (desdeRuta && !desdeRuta.includes('.') && SLUG_VALIDO.test(desdeRuta)) return desdeRuta
  const desdeParam = new URLSearchParams(loc.search).get('demo') ?? ''
  return SLUG_VALIDO.test(desdeParam) ? desdeParam : null
}

export function guardarSlug(slug) {
  try { localStorage.setItem(CLAVE_SLUG, slug) } catch (_) {}
}

export function slugGuardado() {
  try {
    const s = localStorage.getItem(CLAVE_SLUG) ?? ''
    return SLUG_VALIDO.test(s) ? s : null
  } catch (_) { return null }
}

/** Página de entrada del demo de este dispositivo (si se conoce), o la raíz */
export function rutaEntradaDemo() {
  const s = slugGuardado()
  return s ? `/${s}` : '/'
}

export function enlaceWhatsapp(texto = 'Hola, me interesa el sistema Gestión Educativa para mi colegio.') {
  return DEMO_WHATSAPP ? `https://wa.me/${DEMO_WHATSAPP}?text=${encodeURIComponent(texto)}` : null
}

// Rutas por rol (las mismas que usa auth.js)
export const RUTAS_ROL = {
  director:   '/dashboard-director.html',
  profesor:   '/dashboard-profesor.html',
  estudiante: '/dashboard-estudiante.html',
  secretaria: '/dashboard-secretaria.html',
  tutor:      '/dashboard-tutor.html',
  regente:    '/dashboard-regente.html',
  superadmin: '/dashboard-superadmin.html',
}
