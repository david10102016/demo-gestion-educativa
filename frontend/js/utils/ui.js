// js/utils/ui.js
// Utilidades de interfaz reutilizables en todos los paneles
import { escapeHtml } from './sanitize.js'

// -------------------------------------------------------
// TOAST — notificación no bloqueante
// -------------------------------------------------------
export function toast(mensaje, tipo = 'success', duracion = 3000) {
  const bgColores = {
    success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b'
  }
  const iconos = {
    success: '✓', error: '✕', info: 'ℹ', warning: '⚠'
  }

  const t = document.createElement('div')
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    zIndex: '999999', display: 'flex', alignItems: 'center', gap: '10px',
    padding: '12px 20px', borderRadius: '12px', color: '#fff',
    fontSize: '14px', fontWeight: '500', boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
    background: bgColores[tipo] ?? bgColores.info,
    transition: 'opacity 0.3s, transform 0.3s',
    opacity: '0', transform: 'translateY(20px)'
  })
  t.innerHTML = `<span style="font-weight:700;">${iconos[tipo]}</span><span>${escapeHtml(mensaje)}</span>`
  document.body.appendChild(t)

  requestAnimationFrame(() => {
    t.style.opacity = '1'
    t.style.transform = 'translateY(0)'
  })

  setTimeout(() => {
    t.style.opacity = '0'
    t.style.transform = 'translateY(20px)'
    t.addEventListener('transitionend', () => t.remove())
  }, duracion)
}

// -------------------------------------------------------
// LOADER GLOBAL
// -------------------------------------------------------
let loaderEl = null

export function mostrarLoader(texto = 'Cargando...') {
  if (loaderEl) return
  loaderEl = document.createElement('div')
  loaderEl.id = 'global-loader'
  Object.assign(loaderEl.style, {
    position: 'fixed', inset: '0', zIndex: '9998',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)'
  })
  loaderEl.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:32px;display:flex;flex-direction:column;align-items:center;gap:16px;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
      <div style="width:40px;height:40px;border:4px solid #e2e8f0;border-top-color:#4f46e5;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <p style="color:#475569;font-size:14px;font-weight:500;">${escapeHtml(texto)}</p>
    </div>
  `
  document.body.appendChild(loaderEl)
}

export function ocultarLoader() {
  loaderEl?.remove()
  loaderEl = null
}

// -------------------------------------------------------
// MODAL DE CONFIRMACIÓN
// -------------------------------------------------------
const CF_ICONOS = {
  pregunta: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  peligro:  '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  exito:    '<circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/>',
  sesion:   '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
}

export function confirmar(titulo, mensaje, textoOk = 'Confirmar', textoCancelar = 'Cancelar', tipo = null) {
  return new Promise(resolve => {
    if (!CF_ICONOS[tipo]) {
      tipo = /cerrar\s+sesi/i.test(titulo) ? 'sesion'
           : /elimin|borrar|anular|quitar/i.test(titulo) ? 'peligro'
           : 'pregunta'
    }
    const previo = document.activeElement
    const overlay = document.createElement('div')
    overlay.className = 'cf-overlay'
    overlay.innerHTML = `
      <div class="cf-box cf-${tipo}" role="alertdialog" aria-modal="true" aria-labelledby="cf-titulo" aria-describedby="cf-msg">
        <div class="cf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CF_ICONOS[tipo]}</svg></div>
        <h3 id="cf-titulo" class="cf-titulo">${escapeHtml(titulo)}</h3>
        <p id="cf-msg" class="cf-msg">${escapeHtml(mensaje)}</p>
        <div class="cf-acc">
          <button type="button" id="btn-cancelar" class="cf-btn cf-btn-sec">${escapeHtml(textoCancelar)}</button>
          <button type="button" id="btn-ok" class="cf-btn cf-btn-pri">${escapeHtml(textoOk)}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const cerrar = (valor) => {
      document.removeEventListener('keydown', teclas, true)
      overlay.remove()
      try { previo?.focus?.() } catch (_) {}
      resolve(valor)
    }
    const teclas = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(false) } }
    document.addEventListener('keydown', teclas, true)

    overlay.querySelector('#btn-ok').onclick = () => cerrar(true)
    overlay.querySelector('#btn-cancelar').onclick = () => cerrar(false)
    overlay.onclick = (e) => { if (e.target === overlay) cerrar(false) }
    overlay.querySelector('#btn-ok').focus()
  })
}

// -------------------------------------------------------
// MODAL GENÉRICO
// -------------------------------------------------------
export function abrirModal(id) {
  document.getElementById(id)?.classList.remove('hidden')
}

export function cerrarModal(id) {
  document.getElementById(id)?.classList.add('hidden')
}

// -------------------------------------------------------
// FORMATEO DE FECHAS
// -------------------------------------------------------
export function formatFecha(fecha, opciones = {}) {
  if (!fecha) return '-'
  return new Date(fecha).toLocaleDateString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric', ...opciones
  })
}

export function formatFechaHora(fecha) {
  if (!fecha) return '-'
  return new Date(fecha).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// Fecha calendario LOCAL (no UTC) en formato YYYY-MM-DD. new Date().toISOString()
// siempre da la fecha en UTC -- en Bolivia (UTC-4), después de las 20:00 ya
// "cruza" al día siguiente en UTC aunque acá siga siendo el día de hoy.
export function fechaLocal(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// -------------------------------------------------------
// PAGINACIÓN
// -------------------------------------------------------
export function renderPaginacion(containerId, totalItems, porPagina, paginaActual, onCambio) {
  const container = document.getElementById(containerId)
  if (!container) return

  const totalPaginas = Math.ceil(totalItems / porPagina)
  if (totalPaginas <= 1) { container.innerHTML = ''; return }

  const paginas = []
  for (let i = 1; i <= totalPaginas; i++) {
    const activo = i === paginaActual
    paginas.push(`
      <button onclick="(${onCambio.toString()})(${i})"
        style="width:36px;height:36px;border-radius:8px;font-size:13px;font-weight:500;border:none;cursor:pointer;
        background:${activo ? '#4f46e5' : 'transparent'};color:${activo ? '#fff' : '#475569'};">
        ${i}
      </button>
    `)
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px;">
      <span style="font-size:12px;color:#94a3b8;margin-right:8px;">${totalItems} registros</span>
      ${paginas.join('')}
    </div>
  `
}

// -------------------------------------------------------
// INICIALES DE AVATAR
// -------------------------------------------------------
export function iniciales(nombre = '') {
  return nombre.trim().split(' ')
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('')
}

// -------------------------------------------------------
// DEBOUNCE
// -------------------------------------------------------
export function debounce(fn, delay = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

// -------------------------------------------------------
// MENÚ LATERAL EN CELULAR (≤ 768 px)
//   · Al elegir una opción del menú, se cierra solo
//   · Deslizar a la izquierda lo cierra; deslizar desde el borde izquierdo lo abre
//   · Con el menú abierto se oculta el botón ☰ (no tapa el nombre del colegio)
//   En computadora no cambia nada. Funciona en todos los paneles que usan ui.js.
// -------------------------------------------------------
function iniciarMenuMovil() {
  const sb = document.getElementById('sidebar')
  const ov = document.getElementById('sidebar-overlay')
  if (!sb || !ov || sb.dataset.menuMovil) return
  sb.dataset.menuMovil = '1'
  const esMovil = () => window.matchMedia('(max-width: 768px)').matches
  const btn = document.getElementById('btn-sidebar-toggle')
  const abrir = () => { sb.classList.add('open'); ov.classList.add('active') }
  const cerrar = () => { sb.classList.remove('open'); ov.classList.remove('active') }

  new MutationObserver(() => {
    if (btn) btn.style.visibility = (sb.classList.contains('open') && esMovil()) ? 'hidden' : ''
  }).observe(sb, { attributes: true, attributeFilter: ['class'] })

  sb.addEventListener('click', (e) => {
    if (esMovil() && e.target.closest('.nav-item, a[href]')) cerrar()
  })

  let x0 = null, y0 = null, desdeBorde = false
  document.addEventListener('touchstart', (e) => {
    if (!esMovil() || e.touches.length !== 1) { x0 = null; return }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY
    desdeBorde = x0 < 28
  }, { passive: true })
  document.addEventListener('touchend', (e) => {
    if (x0 === null) return
    const dx = e.changedTouches[0].clientX - x0
    const dy = e.changedTouches[0].clientY - y0
    x0 = null
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return   // no fue un deslizamiento horizontal
    const abierto = sb.classList.contains('open')
    if (dx < 0 && abierto) cerrar()
    else if (dx > 0 && !abierto && desdeBorde) abrir()
  }, { passive: true })
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarMenuMovil)
  else iniciarMenuMovil()
}