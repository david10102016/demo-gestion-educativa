// js/utils/menu-movil.js
// Menú lateral para todos los paneles. Se conecta con una línea en cada HTML:
//   <script type="module" src="/js/utils/menu-movil.js"></script>
// No depende del JS del panel. Hace:
//   · Pone cada ícono del menú en su "cajita" (los colores del SVG no se tocan).
//   · Mueve el botón de tres rayas dentro de la barra superior (el contenido usa todo el ancho).
//   · Agrega la X de cerrar y cierra con: X, fondo oscuro, deslizar a la izquierda,
//     tecla Esc o al elegir una opción. Con el menú abierto, la pantalla de atrás no se mueve.

const MOVIL = '(max-width: 900px), (max-height: 500px)'
const esMovil = () => window.matchMedia(MOVIL).matches

function iniciar() {
  const sb = document.getElementById('sidebar')
  if (!sb) return
  try { aplicar(sb) } catch (e) { console.error('[menu-movil]', e) }
}

// Cada parte se aplica solo si falta: se puede llamar varias veces sin duplicar nada
function aplicar(sb) {
  const ov = document.getElementById('sidebar-overlay')
  const hamb = document.getElementById('btn-sidebar-toggle')

  // 1. Cajita para cada ícono (también los que el panel agregue después, como Tutoriales)
  const envolver = () => sb.querySelectorAll('.nav-item > .nav-icon').forEach(ic => {
    const chip = document.createElement('span')
    chip.className = 'nav-chip'
    ic.replaceWith(chip)
    chip.appendChild(ic)
  })
  envolver()
  if (!sb._menuObs) {
    sb._menuObs = new MutationObserver(envolver)
    sb._menuObs.observe(sb, { childList: true, subtree: true })
  }

  // 2. Tres rayas dentro de la barra superior
  const izq = document.querySelector('.topbar-left') ?? document.querySelector('.topbar')
  if (hamb && izq && !izq.contains(hamb)) izq.prepend(hamb)

  // 3. Abrir / cerrar
  const abrir = () => { sb.classList.add('open'); ov?.classList.add('active'); document.body.classList.add('menu-abierto') }
  const cerrar = () => { sb.classList.remove('open'); ov?.classList.remove('active'); document.body.classList.remove('menu-abierto') }
  if (hamb) { hamb.onclick = abrir; hamb.setAttribute('aria-label', 'Abrir menú') }
  if (ov) ov.onclick = cerrar

  const logo = sb.querySelector('.sidebar-logo')
  if (logo && !logo.querySelector('.sidebar-cerrar')) {
    logo.insertAdjacentHTML('beforeend', `<button type="button" class="sidebar-cerrar" aria-label="Cerrar menú" title="Cerrar menú">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`)
  }
  const x = logo?.querySelector('.sidebar-cerrar')
  if (x) x.onclick = cerrar

  // Los eventos generales se registran una sola vez
  if (sb._menuEventos) return
  sb._menuEventos = true

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sb.classList.contains('open')) cerrar() })

  // Elegir una opción cierra el menú en celular (el panel sigue haciendo su navegación)
  sb.addEventListener('click', e => { if (e.target.closest('.nav-item') && esMovil()) cerrar() })

  // Deslizar a la izquierda: el menú sigue al dedo y se cierra si pasa de 60 px
  let x0 = null, dx = 0
  sb.addEventListener('touchstart', e => {
    if (!esMovil() || !sb.classList.contains('open')) return
    x0 = e.touches[0].clientX; dx = 0; sb.style.transition = 'none'
  }, { passive: true })
  sb.addEventListener('touchmove', e => {
    if (x0 === null) return
    dx = Math.min(0, e.touches[0].clientX - x0)
    sb.style.transform = `translateX(${dx}px)`
  }, { passive: true })
  sb.addEventListener('touchend', () => {
    if (x0 === null) return
    sb.style.transition = ''; sb.style.transform = ''
    if (dx < -60) cerrar()
    x0 = null
  })

  // Si se pasa a pantalla grande con el menú abierto, se limpia el estado
  try { window.matchMedia(MOVIL).addEventListener('change', ev => { if (!ev.matches) cerrar() }) } catch (_) {}
}

// Se aplica al estar listo el HTML y otra vez al terminar de cargar la página
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar)
else iniciar()
window.addEventListener('load', iniciar)