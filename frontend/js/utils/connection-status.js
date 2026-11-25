// js/utils/connection-status.js
// ─────────────────────────────────────────────────────────
// Muestra un aviso flotante fijo cuando el navegador detecta que
// no hay conexión a internet, y lo oculta automáticamente al
// recuperarla. Es independiente de qué pantalla esté abierta.
//
// Uso: llamar initConnectionStatus() una sola vez (por ejemplo,
// en el DOMContentLoaded de cada panel: estudiante, profesor, etc.)
// ─────────────────────────────────────────────────────────

let _badgeEl = null
let _initialized = false
let _lento = false          // hay peticiones al servidor esperando demasiado (señal débil)
let _copia = false          // sin red se mostró al menos una copia guardada

function _crearBadge() {
  if (_badgeEl) return _badgeEl
  const el = document.createElement('div')
  el.id = 'offline-status-badge'
  el.style.cssText = `
    position:fixed; bottom:18px; left:18px; z-index:99999;
    background:#7c2d12; color:#fff; font-size:12.5px; font-weight:600;
    padding:9px 16px; border-radius:99px; box-shadow:0 4px 14px rgba(0,0,0,0.28);
    display:none; align-items:center; gap:8px; font-family:system-ui,-apple-system,sans-serif;
    max-width:calc(100vw - 36px);
  `
  el.innerHTML = `
    <span style="width:8px;height:8px;border-radius:50%;background:#fca5a5;flex-shrink:0;"></span>
    <span id="offline-status-text">Sin conexión a internet</span>
  `
  document.body.appendChild(el)
  _badgeEl = el
  return el
}

function _actualizarBadge() {
  const el = _crearBadge()
  const texto = el.querySelector('#offline-status-text')
  if (!navigator.onLine) {
    el.style.background = '#7c2d12'
    if (texto) texto.textContent = _copia ? 'Sin conexión — mostrando datos guardados' : 'Sin conexión a internet'
    el.style.display = 'flex'
  } else if (_lento) {
    el.style.background = '#92400e'
    if (texto) texto.textContent = 'Conexión lenta — esperando respuesta del servidor…'
    el.style.display = 'flex'
  } else {
    el.style.display = 'none'
  }
}

// Lo llama el cliente de Supabase cuando, sin red, responde con una copia guardada.
export function avisarCopiaUsada() {
  _copia = true
  if (!document.body) return
  initConnectionStatus()
  _actualizarBadge()
}

// Lo llama el cliente de Supabase (supabase-config.js) cuando una petición
// tarda más de lo normal (true) o cuando ya no queda ninguna lenta (false).
export function avisarConexionLenta(lento) {
  _lento = !!lento
  if (!document.body) return
  initConnectionStatus()
  _actualizarBadge()
}

export function initConnectionStatus() {
  if (_initialized) { _actualizarBadge(); return }
  _initialized = true
  _crearBadge()
  _actualizarBadge()
  window.addEventListener('online',  () => { _copia = false; _actualizarBadge() })
  window.addEventListener('offline', _actualizarBadge)
}

export function isOnline() {
  return navigator.onLine
}

const ICONO_SIN_RED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`
const ESTILO_AVISO = 'background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:10px;padding:10px 14px;font-size:12.5px;font-weight:500;margin-bottom:14px;display:flex;align-items:center;gap:8px;'

// Aviso opcional puntual dentro de una pantalla (además del badge global)
export function avisoOfflineInline(mensaje) {
  const texto = mensaje || 'Sin conexión — mostrando la última información guardada.'
  return `
    <div style="${ESTILO_AVISO}">
      <span style="flex-shrink:0;display:flex;">${ICONO_SIN_RED}</span><span>${texto}</span>
    </div>`
}

// Inserta al inicio de un contenedor el aviso "datos guardados", con la fecha
// en que se guardaron. Se usa cuando la pantalla muestra la copia sin conexión.
export function insertarAvisoCopia(contenedor, syncedAt) {
  if (!contenedor) return
  contenedor.querySelector(':scope > .aviso-copia-guardada')?.remove()
  const cuando = syncedAt
    ? new Date(syncedAt).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null
  const div = document.createElement('div')
  div.className = 'aviso-copia-guardada'
  div.setAttribute('style', ESTILO_AVISO)
  div.innerHTML = `<span style="flex-shrink:0;display:flex;">${ICONO_SIN_RED}</span><span></span>`
  div.lastElementChild.textContent = cuando
    ? `Sin conexión — mostrando lo guardado el ${cuando}.`
    : 'Sin conexión — mostrando la última información guardada.'
  contenedor.prepend(div)
}
