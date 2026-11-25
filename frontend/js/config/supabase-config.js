// js/config/supabase-config.js
import { createClient } from '@supabase/supabase-js'
import { initConnectionStatus, avisarConexionLenta, avisarCopiaUsada } from '../utils/connection-status.js'
import { getCache, setCache } from '../utils/offline-db.js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Faltan variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Crea el archivo .env.local')
}

// ─── Peticiones con límite de tiempo y aviso de señal débil ──────────────────
// Sin internet: la petición falla de inmediato (antes esperaba hasta ~1 minuto).
// Señal débil: a los 5 s aparece "Conexión lenta"; a los 15 s se corta y la pantalla
// muestra su error o los datos guardados. Funciones (Edge Functions) y archivos
// (Storage) no tienen límite, porque las cargas masivas y los archivos pueden tardar.
const LIMITE_MS = 15000
const AVISO_LENTO_MS = 5000
const _lentas = new Set()
// Peticiones en curso: si el equipo pierde la red mientras esperan,
// se cortan en ese momento en vez de esperar los 15 s.
const _enCurso = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    for (const c of _enCurso) c.abort()
  })
}

// Error de red "terminal": la librería de consultas (postgrest-js 2.x) reintenta los
// fallos de red de las lecturas 3 veces (1 s + 2 s + 4 s = 7 s por consulta), salvo
// que el error sea de tipo abort (code ABORT_ERR). Sin red o con tiempo agotado no
// tiene sentido reintentar: se marca así para que falle de inmediato.
function errorRed(titulo, detalle) {
  const e = new Error(detalle)
  e.name = titulo
  e.code = 'ABORT_ERR'
  return e
}

// ─── Copia de lecturas para usar sin conexión (todas las pantallas) ───────────
// Cada lectura exitosa (GET/HEAD a /rest/v1 y RPC de solo lectura) se guarda en
// IndexedDB con una clave que incluye el usuario de la sesión. Sin red, o si el
// servidor no responde a tiempo, se devuelve esa copia en vez de un error.
// Nunca se guardan escrituras: sin red, guardar sigue fallando y se avisa.
// La copia se borra al cerrar sesión (clearUserCache en auth.logout).
const RPC_LECTURA = new Set([
  'get_config_año', 'notas_de_mi_hijo', 'tiene_permiso', 'resumen_comunicados', 'reporte_notas_periodo',
  'porteria_resumen_dia', 'porteria_lista_escaner', 'porteria_ingreso_hoy_estudiantes',
  'porteria_ingreso_hoy_curso', 'porteria_cruce_dia', 'porteria_activa', 'mi_asesoria_curso',
  'fotos_curso', 'estado_foto_estudiante', 'asesor_notas_curso', 'asesor_datos_libreta', 'asesor_asistencia_curso',
])
const MAX_COPIA = 2_000_000   // no se guardan respuestas de más de ~2 MB

function usuarioDelToken(headers) {
  const auth = headers.get('Authorization') || ''
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const parte = jwt.split('.')[1]
  if (!parte) return null
  try {
    const json = JSON.parse(decodeURIComponent(escape(atob(parte.replace(/-/g, '+').replace(/_/g, '/')))))
    return json.role === 'authenticated' && json.sub ? json.sub : null
  } catch (_) { return null }
}

function claveLectura(url, init) {
  if (!url.includes('/rest/v1/')) return null
  const metodo = String(init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers || {})
  const uid = usuarioDelToken(headers)
  if (!uid) return null
  let cuerpo = ''
  if (metodo === 'POST') {
    const m = url.match(/\/rest\/v1\/rpc\/([^?]+)/)
    const nombre = m ? decodeURIComponent(m[1]) : ''
    if (!RPC_LECTURA.has(nombre)) return null
    cuerpo = typeof init.body === 'string' ? init.body : ''
  } else if (metodo !== 'GET' && metodo !== 'HEAD') {
    return null
  }
  const extra = `${headers.get('Accept') || ''}|${headers.get('Prefer') || ''}|${headers.get('Range') || ''}|${cuerpo}`
  return { clave: `http::${metodo}::${url}::${extra}::u_${uid}`, metodo }
}

async function guardarCopia(info, res) {
  try {
    const texto = info.metodo === 'HEAD' ? '' : await res.clone().text()
    if (texto.length > MAX_COPIA) return
    const headers = []
    res.headers.forEach((v, k) => { if (k !== 'set-cookie') headers.push([k, v]) })
    await setCache(info.clave, { status: res.status, statusText: res.statusText, headers, body: texto })
  } catch (_) { /* la copia es opcional */ }
}

async function respuestaGuardada(info) {
  if (!info) return null
  const c = await getCache(info.clave)
  if (!c?.value) return null
  avisarCopiaUsada()
  const v = c.value
  return new Response(info.metodo === 'HEAD' ? null : v.body, { status: v.status, statusText: v.statusText, headers: v.headers })
}

async function fetchConLimite(input, init = {}) {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input))
  const info = claveLectura(url, init)

  if (!navigator.onLine) {
    const copia = await respuestaGuardada(info)
    if (copia) return copia
    throw errorRed('Sin conexión', 'revisa tu señal o tus datos móviles')
  }

  try {
    const res = await fetchDirecto(input, init, url)
    if (info && res.ok) guardarCopia(info, res)
    return res
  } catch (err) {
    const copia = await respuestaGuardada(info)
    if (copia) return copia
    throw err
  }
}

function fetchDirecto(input, init, url) {
  const sinLimite = url.includes('/functions/v1/') || url.includes('/storage/v1/')
  const ctrl = new AbortController()
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort()
    else init.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }

  _enCurso.add(ctrl)
  let porTiempo = false
  const tCorte = sinLimite ? null : setTimeout(() => { porTiempo = true; ctrl.abort() }, LIMITE_MS)
  const marca = {}
  const tLento = setTimeout(() => { _lentas.add(marca); avisarConexionLenta(true) }, AVISO_LENTO_MS)

  return fetch(input, { ...init, signal: ctrl.signal })
    .catch(err => {
      if (porTiempo) throw errorRed('Conexión lenta', 'el servidor no respondió a tiempo')
      if (!navigator.onLine) throw errorRed('Sin conexión', 'revisa tu señal o tus datos móviles')
      throw err
    })
    .finally(() => {
      _enCurso.delete(ctrl)
      clearTimeout(tCorte)
      clearTimeout(tLento)
      if (_lentas.delete(marca) && _lentas.size === 0) avisarConexionLenta(false)
    })
}

if (typeof window !== 'undefined') {
  const iniciarAviso = () => initConnectionStatus()
  if (document.body) iniciarAviso()
  else document.addEventListener('DOMContentLoaded', iniciarAviso, { once: true })
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  global: { fetch: fetchConLimite },
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true
  }
})
export function crearClienteTemporal() {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-temp-signup-client' }
  })
}