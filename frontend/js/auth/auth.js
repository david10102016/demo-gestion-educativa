// js/auth/auth.js
// Autenticación unificada — los 3 roles usan Supabase Auth
import { supabase } from '../config/supabase-config.js'
import { cargarConfiguracion } from '../config/config-app.js'
import { getCache, setCache, clearUserCache } from '../utils/offline-db.js'
import { conTimeout } from '../utils/data-layer.js'
import { MODO_DEMO, rutaEntradaDemo } from '../demo/demo-config.js'

// Rutas por rol
const RUTAS = {
  regente: '/dashboard-regente.html',
  director:   '/dashboard-director.html',
  profesor:   '/dashboard-profesor.html',
  estudiante: '/dashboard-estudiante.html',
  secretaria: '/dashboard-secretaria.html',
  tutor:      '/dashboard-tutor.html',
  superadmin: '/dashboard-superadmin.html',
  // En el despliegue de cuentas de prueba, la salida vuelve a la entrada de ese colegio (/<enlace>)
  get login() { return MODO_DEMO ? rutaEntradaDemo() : '/index.html' }
}

// -------------------------------------------------------
// LOGIN
// -------------------------------------------------------
export async function login(email, password) {
  if (!navigator.onLine) {
    throw new Error('Sin conexión a internet. Necesitás conexión para iniciar sesión.')
  }

  let data, error
  try {
    ;({ data, error } = await conTimeout(
      supabase.auth.signInWithPassword({ email, password }), 8000
    ))
  } catch (_) {
    throw new Error('No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.')
  }
  if (error) throw error

  // Obtener perfil del usuario
  const perfil = await obtenerPerfil(data.user.id)
if (!perfil) { await supabase.auth.signOut(); throw new Error('Usuario no encontrado en el sistema') }
if (!perfil.activo) { await supabase.auth.signOut(); throw new Error('Usuario inactivo. Contacta al administrador') }

// 🔥 Validar que el usuario pertenezca al colegio seleccionado
// Si el tutor no tiene colegio asignado (NULL), permitir login en cualquier colegio
const colegioSeleccionado = localStorage.getItem('colegio_id')
if (colegioSeleccionado && perfil.colegio_id !== null && perfil.colegio_id !== colegioSeleccionado) {
  await supabase.auth.signOut()
  throw new Error('Este usuario no pertenece al colegio seleccionado')
}

  return perfil
}

// -------------------------------------------------------
// LOGOUT
// -------------------------------------------------------
export async function logout() {
  // Borra las copias sin conexión de este usuario (datos de su panel en este dispositivo)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) await clearUserCache(session.user.id)
  } catch (_) {}
  await supabase.auth.signOut()
  sessionStorage.clear()
  window.location.href = RUTAS.login
}

// -------------------------------------------------------
// OBTENER PERFIL
// Distingue explícitamente dos motivos de fallo:
//  - 'servidor': Supabase respondió y confirma que no hay perfil
//    (usuario borrado, o error real de la consulta ya autenticada).
//  - 'red': no hubo respuesta porque no hay conexión a internet.
// Esta distinción es la que verificarSesion() necesita para no
// cerrar la sesión por error cuando simplemente no hay señal.
// -------------------------------------------------------
export async function obtenerPerfil(userId) {
  const resultado = await obtenerPerfilConEstado(userId)
  return resultado.perfil
}

export async function obtenerPerfilConEstado(userId) {
  // Sin conexión: ni siquiera lo intentamos contra el servidor.
  if (!navigator.onLine) {
    return { perfil: null, motivo: 'red' }
  }

  try {
    const { data, error } = await conTimeout(
      supabase
        .from('usuarios')
        .select('id, rol, nombre_completo, email, activo, colegio_id, foto_url')
        .eq('id', userId)
        .single(),
      6000
    )

    if (error) {
      // PGRST116 = "no rows" -> el servidor respondió, el usuario no existe.
      // Cualquier otro código de error de Postgrest también es una
      // respuesta real del servidor (permisos, RLS, etc.).
      if (error.code) {
        return { perfil: null, motivo: 'servidor' }
      }
      // Error sin código reconocible (fetch falló, timeout, DNS, etc.)
      // = problema de red, no una confirmación real.
      return { perfil: null, motivo: 'red' }
    }

    if (!data) return { perfil: null, motivo: 'servidor' }
    return { perfil: data, motivo: 'ok' }
  } catch (err) {
    // Cualquier excepción (fetch rechazado por falta de red) se trata
    // como problema de conexión, nunca como rechazo del usuario.
    return { perfil: null, motivo: 'red' }
  }
}

// -------------------------------------------------------
// AVISO "SIN CONEXIÓN" CON REINTENTAR
// Se muestra cuando no hay red y el dispositivo no tiene copia del
// perfil: así la pantalla no queda cargando sin explicación.
// -------------------------------------------------------
function mostrarSinConexion() {
  if (document.getElementById('aviso-sin-conexion')) return
  const capa = document.createElement('div')
  capa.id = 'aviso-sin-conexion'
  capa.setAttribute('role', 'alert')
  capa.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.55)'

  const caja = document.createElement('div')
  caja.style.cssText = 'max-width:340px;width:100%;background:#fff;color:#1e293b;border-radius:14px;padding:24px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:inherit'
  caja.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
    <div style="font-weight:700;font-size:1.05rem;margin:10px 0 6px">Sin conexión</div>
    <div style="font-size:.9rem;color:#475569;margin-bottom:16px">No se pudo conectar con el servidor. Revisa tu señal o tus datos móviles e intenta de nuevo.</div>
    <button type="button" style="width:100%;padding:10px 14px;border:0;border-radius:10px;background:var(--color-primary,#2563eb);color:#fff;font-weight:600;font-size:.95rem;cursor:pointer">Reintentar</button>`
  caja.querySelector('button').addEventListener('click', () => window.location.reload())
  capa.appendChild(caja)
  ;(document.body ?? document.documentElement).appendChild(capa)
}

// -------------------------------------------------------
// VERIFICAR SESIÓN Y REDIRIGIR
// Llamar al inicio de cada página protegida
// -------------------------------------------------------
export async function verificarSesion(rolRequerido = null) {
  const { data: { session }, error } = await supabase.auth.getSession()

  // getSession() es local (lee el token guardado), no requiere red.
  // Si no hay sesión guardada en absoluto, no hay nada que hacer offline.
  if (error || !session) {
    window.location.href = RUTAS.login
    return null
  }

  const { perfil, motivo } = await obtenerPerfilConEstado(session.user.id)

  // ── CASO: no hay conexión ──────────────────────────────
  // NUNCA cerramos la sesión por esto. Usamos la última copia del
  // perfil que se confirmó con éxito mientras había internet.
  if (motivo === 'red') {
    const cache = await getCache(`perfil-sesion::u_${session.user.id}`)
    const perfilGuardado = cache?.value ?? null

    if (perfilGuardado) {
      if (rolRequerido && perfilGuardado.rol !== rolRequerido) {
        window.location.href = RUTAS[perfilGuardado.rol] ?? RUTAS.login
        return null
      }
      // No se puede refrescar Config contra el servidor; se usa lo que
      // ya esté cacheado por config-app.js (si existe).
      if (perfilGuardado.rol !== 'superadmin') {
        try { await cargarConfiguracion(session.user.id) } catch (_) {}
      }
      return { session, perfil: perfilGuardado, offline: true }
    }

    // Sin conexión Y sin ninguna copia local del perfil: no podemos
    // continuar, pero tampoco destruimos el token de sesión — el
    // usuario simplemente necesita recuperar conexión una vez más.
    mostrarSinConexion()
    return null
  }

  // ── CASO: el servidor respondió y confirma que no hay perfil
  //    válido (usuario borrado o inactivo) ──────────────────
  if (!perfil || !perfil.activo) {
    await supabase.auth.signOut()
    window.location.href = RUTAS.login
    return null
  }

  // Perfil confirmado con éxito: se guarda para poder usarlo la
  // próxima vez que se abra la app sin conexión.
  await setCache(`perfil-sesion::u_${session.user.id}`, perfil)

  // Si se especificó un rol requerido, verificar
  if (rolRequerido && perfil.rol !== rolRequerido) {
    window.location.href = RUTAS[perfil.rol] ?? RUTAS.login
    return null
  }

  // Aplicar colores del colegio desde localStorage
  const colorPrimario = localStorage.getItem('color_primario')
  const colorSecundario = localStorage.getItem('color_secundario')
  if (colorPrimario) {
    document.documentElement.style.setProperty('--color-primary', colorPrimario)
  }
  if (colorSecundario) {
    document.documentElement.style.setProperty('--color-secondary', colorSecundario)
  }

  // Cargar configuración global (desde caché si está disponible)
  if (perfil.rol !== 'superadmin') await cargarConfiguracion(session.user.id)

  // Cuenta de prueba: barra "Probando como" (solo en el despliegue demo)
  if (MODO_DEMO) import('../demo/barra-demo.js').then(m => m.iniciarBarraDemo(perfil)).catch(() => {})

  return { session, perfil }
}

// -------------------------------------------------------
// GUARDAR SESIÓN EN PÁGINA DE LOGIN (redirigir si ya está logueado)
// -------------------------------------------------------
export async function redirigirSiLogueado() {
  return new Promise((resolve) => {
    let resuelto = false
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (resuelto) return
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        resuelto = true
        listener.subscription.unsubscribe()
        if (session) {
          const { perfil, motivo } = await obtenerPerfilConEstado(session.user.id)

          if (perfil?.activo) {
            window.location.href = RUTAS[perfil.rol] ?? RUTAS.login
            return
          }

          // Sin conexión: no sabemos si el usuario sigue activo contra el
          // servidor, pero sí tenemos su sesión guardada. Usamos la última
          // copia de perfil confirmada para redirigirlo igual, en vez de
          // dejarlo varado en la pantalla de login sin poder entrar.
          if (motivo === 'red') {
            const cache = await getCache(`perfil-sesion::u_${session.user.id}`)
            const perfilGuardado = cache?.value ?? null
            if (perfilGuardado) {
              window.location.href = RUTAS[perfilGuardado.rol] ?? RUTAS.login
              return
            }
          }
        }
        resolve()
      }
    })
    // Más tiempo de margen que antes (1.5s era muy corto ya para un chequeo
    // local; 3s da algo de aire sin sentirse lento).
    setTimeout(() => { if (!resuelto) { resuelto = true; resolve() } }, 3000)
  })
}

// -------------------------------------------------------
// ESCUCHAR CAMBIOS DE SESIÓN (auto-logout si expira)
// -------------------------------------------------------
export function iniciarMonitorSesion() {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !session) {
      sessionStorage.clear()
      window.location.href = RUTAS.login
    }
  })
}

// -------------------------------------------------------
// DATOS DEL USUARIO ACTUAL (desde sesión activa)
// -------------------------------------------------------
export async function usuarioActual() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return obtenerPerfil(user.id)
}