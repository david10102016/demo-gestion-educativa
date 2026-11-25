/**
 * tour.js — Botón Ayuda + recorrido guiado de cada panel
 * Detecta el rol por la URL. No depende del JS del panel.
 *
 * Botón Ayuda (abajo a la derecha) abre un panel con:
 *   · Recorrido del panel   (este tour)
 *   · Tutoriales            (solo aparece cuando exista window.__abrirTutoriales)
 *   · Contactar soporte     (WhatsApp con el colegio y el panel ya escritos)
 *
 * Uso: <script type="module" src="/js/utils/tour.js"></script>
 * Desde consola: window.__tourStart()
 */

const WHATSAPP_SOPORTE = '59173138524'
const MOVIL = '(max-width: 900px), (max-height: 500px)'
const esMovil = () => window.matchMedia(MOVIL).matches

// ─── Pasos por rol ───────────────────────────────────────────────────────────
// El recorrido pasa por TODAS las opciones visibles del menú, en su orden.
// Aquí solo va la explicación de cada opción; si una opción no tiene texto,
// se muestra igual con su nombre del menú.
const AYUDA_FINAL = { target: '#tour-trigger-btn', title: 'Ayuda', text: 'Vuelve a ver este recorrido o escribe a soporte cuando lo necesites.' }

const TOURS = {
  director: {
    intro: ['Panel Director', 'Desde aquí gestionas el colegio: estudiantes, profesores, cursos, reportes y configuración.'],
    sec: {
      inicio: 'Resumen del colegio: totales de estudiantes, profesores, cursos y la gestión activa.',
      estudiantes: 'Registra o importa estudiantes desde Excel. También generas credenciales y libretas.',
      profesores: 'Altas, bajas y datos de contacto del plantel docente.',
      cursos: 'Crea y organiza los cursos y paralelos de la gestión.',
      materias: 'Materias del colegio y su área.',
      asignaciones: 'Indica qué profesor dicta cada materia en cada curso y designa al asesor de curso.',
      'carreras-tecnicas': 'Especialidades técnicas (BTH) y sus estudiantes.',
      calificaciones: 'Consulta las notas de cualquier curso, materia y trimestre.',
      bitacora: 'Registro de lo que hicieron los profesores en el sistema.',
      reportes: 'Aprovechamiento, excelencia, semáforo de riesgo y rendimiento por materia.',
      asistencias: 'Asistencia de los estudiantes por curso y fecha.',
      'evaluacion-docente': 'Resultados de la evaluación que hacen los estudiantes a sus profesores.',
      licencias: 'Permisos solicitados por las familias: aprueba o rechaza.',
      pagos: 'Estado de pagos de las familias.',
      comunicados: 'Envía mensajes a todo el colegio, a un curso o a estudiantes puntuales.',
      configuracion: 'Datos del colegio, gestión y trimestre activo, dimensiones y Ficha SER.',
    },
  },
  profesor: {
    intro: ['Panel Profesor', 'Aquí trabajas tus cursos: actividades, notas, asistencia y comunicados.'],
    antes: [{ target: '#selector-curso-global', title: 'Curso, materia y trimestre', text: 'Elige arriba con qué curso y materia vas a trabajar. Todo el panel se ajusta a esa elección.' }],
    sec: {
      inicio: 'Resumen de tus cursos y actividades pendientes.',
      'mis-cursos': 'Los cursos y materias que tienes asignados.',
      actividades: 'Crea actividades de Hacer y Saber, registra notas y exporta o importa el Excel.',
      ser: 'Califica la dimensión Ser por criterios y publícala para que cuente en la nota.',
      asistencia: 'Pasa lista por fecha y revisa el historial semanal o mensual.',
      'asesor-curso': 'Si eres asesor, ves las notas de todo tu curso e imprimes el PDF.',
      bitacora: 'Anota lo que avanzaste en cada clase.',
      comunicados: 'Envía mensajes a tus estudiantes o a sus familias.',
      'mi-cuenta': 'Cambia tu contraseña cuando lo necesites.',
    },
  },
  estudiante: {
    intro: ['Tu panel', 'Aquí ves tus tareas, notas, asistencia y comunicados del colegio.'],
    sec: {
      inicio: 'Resumen de tu trimestre.',
      tareas: 'Todas tus tareas por materia. La alerta indica lo que tienes por atender.',
      notas: 'Tus notas por materia y trimestre, con el detalle de cada actividad.',
      'promedio-anual': 'Tu promedio del año por materia.',
      asistencia: 'Tus faltas, retrasos y licencias por fecha.',
      ingreso: 'La hora en que entraste y saliste del colegio.',
      'evaluar-docente': 'Evalúa a tus profesores cuando el colegio lo habilite.',
      comunicados: 'Mensajes del colegio y de tus profesores.',
      telegram: 'Recibe tus avisos en Telegram.',
      'mi-cuenta': 'Cambia tu contraseña cuando lo necesites.',
    },
  },
  tutor: {
    intro: ['Panel familiar', 'Aquí sigues a tus hijos: resumen, ingreso al colegio, licencias y pagos.'],
    sec: {
      inicio: 'Una tarjeta por cada hijo vinculado, con sus pagos del año.',
      asistencia: 'La hora en que tu hijo entró y salió del colegio.',
      licencias: 'Solicita permiso cuando tu hijo no pueda asistir.',
      pagos: 'Envía el comprobante de pago de la mensualidad.',
      historial: 'Tus pagos enviados y su estado.',
      vincular: 'Agrega a tu hijo con su número de carnet.',
      comunicados: 'Mensajes del colegio para tu familia.',
    },
  },
  secretaria: {
    intro: ['Panel Secretaría', 'Aquí revisas pagos y atiendes a las familias.'],
    sec: {
      bandeja: 'Pagos enviados por los padres: revisa el comprobante y aprueba o rechaza.',
      historial: 'Pagos ya revisados, con filtros por mes y estado.',
      licencias: 'Permisos solicitados por las familias.',
      tutores: 'Padres de familia registrados y sus hijos vinculados.',
    },
  },
}

// Arma los pasos leyendo el menú real del panel
function armarPasos(cfg) {
  const pasos = [{ target: '.sidebar-logo', title: cfg.intro[0], text: cfg.intro[1] }, ...(cfg.antes || [])]
  const vistos = new Set()
  document.querySelectorAll('.sidebar .nav-item[data-section]').forEach(el => {
    const s = el.dataset.section
    if (!s || s.includes('$') || vistos.has(s)) return
    vistos.add(s)
    const titulo = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim() || s
    pasos.push({ target: `.sidebar .nav-item[data-section="${s}"]`, title: titulo, text: cfg.sec[s] || `Abre la opción ${titulo}.` })
  })
  pasos.push(AYUDA_FINAL)
  return pasos
}

// ─── Íconos ──────────────────────────────────────────────────────────────────
const SVG = {
  ayuda: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  ruta: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  video: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  cerrar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
}

// ─── Estilos propios (colores del colegio; sin morado fijo) ──────────────────
function estilos() {
  if (document.getElementById('tour-estilos')) return
  const st = document.createElement('style')
  st.id = 'tour-estilos'
  st.textContent = `
    #tour-trigger-btn{background:var(--color-primary);box-shadow:0 4px 14px rgba(0,0,0,.25)}
    #tour-trigger-btn:hover{transform:scale(1.08);box-shadow:0 8px 22px rgba(0,0,0,.3)}
    .tour-footer{gap:10px}
    .tour-dots{flex:1 1 auto;min-width:0;overflow:hidden;flex-wrap:nowrap}
    .tour-dot{flex-shrink:0}
    .tour-footer .tour-btn{flex-shrink:0}
    .tour-footer > div:last-child{display:flex;gap:8px;flex-shrink:0}
    .tour-target-highlight{outline-color:var(--color-primary);box-shadow:0 0 0 5px rgba(255,255,255,.35)}
    body.tour-activo .sidebar{z-index:9001}
    #ayuda-pop{position:fixed;right:20px;bottom:76px;z-index:8999;width:min(280px,calc(100vw - 32px));background:var(--color-surface,#fff);color:var(--color-text,#1e293b);border:1px solid var(--color-border,#e2e8f0);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.22);overflow:hidden}
    #ayuda-pop .ap-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--color-primary);color:#fff;font-weight:700;font-size:14px}
    #ayuda-pop .ap-head button{border:none;background:rgba(255,255,255,.16);color:#fff;width:28px;height:28px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    #ayuda-pop .ap-op{display:flex;gap:12px;align-items:center;width:100%;min-height:52px;padding:10px 14px;border:none;border-top:1px solid var(--color-border,#e2e8f0);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;text-decoration:none}
    #ayuda-pop .ap-op:hover{background:var(--color-surface-2,#f1f5f9)}
    #ayuda-pop .ap-ic{flex-shrink:0;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--color-primary);background:var(--color-surface-2,#f1f5f9)}
    #ayuda-pop .ap-op b{display:block;font-size:14px}
    #ayuda-pop .ap-op small{display:block;font-size:12px;color:var(--color-text-3,#64748b)}
    #ayuda-pop .ap-op.wa .ap-ic{color:#16a34a}
    @media (max-width:900px),(max-height:500px){#ayuda-pop{right:16px;bottom:72px}}`
  document.head.appendChild(st)
}

// ─── Detección de rol ────────────────────────────────────────────────────────
function detectRole() {
  const p = window.location.pathname.toLowerCase()
  for (const r of ['director', 'profesor', 'estudiante', 'tutor', 'secretaria']) if (p.includes(r)) return r
  return document.body.dataset.role || null
}

// ─── Utilidades del menú en celular ──────────────────────────────────────────
const enMenu = el => !!el?.closest('#sidebar')
function abrirMenu() {
  document.getElementById('sidebar')?.classList.add('open')
  document.getElementById('sidebar-overlay')?.classList.add('active')
}
function cerrarMenu() {
  document.getElementById('sidebar')?.classList.remove('open')
  document.getElementById('sidebar-overlay')?.classList.remove('active')
  document.body.classList.remove('menu-abierto')
}
// Visible = existe, no está oculto con .hidden/display:none (el menú escondido en celular cuenta como visible)
function visible(el) {
  if (!el) return false
  if (el.closest('.hidden')) return false
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).display === 'none') return false
  }
  return true
}

// ─── Motor del recorrido ─────────────────────────────────────────────────────
class GuidedTour {
  constructor(steps) {
    // Solo los pasos cuya opción existe y se muestra en este panel
    this.steps = steps.filter(s => visible(document.querySelector(s.target)))
    this.index = 0
    this._onKey = this._onKey.bind(this)
  }

  start() {
    if (!this.steps.length) return
    document.body.classList.add('tour-activo')
    this.overlay = Object.assign(document.createElement('div'), { id: 'tour-overlay' })
    this.box = Object.assign(document.createElement('div'), { id: 'tour-box' })
    this.box.setAttribute('role', 'dialog')
    this.box.setAttribute('aria-modal', 'true')
    this.box.setAttribute('aria-label', 'Recorrido guiado')
    document.body.append(this.overlay, this.box)
    document.addEventListener('keydown', this._onKey)
    this._showStep(0)
  }

  _showStep(i) {
    this.index = i
    const step = this.steps[i]
    const target = document.querySelector(step.target)
    const total = this.steps.length
    const ultimo = i === total - 1

    // En celular, abrir el menú si el paso señala una opción del menú
    if (esMovil()) { if (enMenu(target)) abrirMenu(); else cerrarMenu() }

    this.box.innerHTML = `
      <div class="tour-header">
        <div class="tour-header-inner">
          <span class="tour-progress">${i + 1} / ${total}</span>
          <button class="tour-close" title="Cerrar" aria-label="Cerrar recorrido">${SVG.cerrar}</button>
        </div>
        <div class="tour-progress-bar-wrap"><div class="tour-progress-bar-fill" style="width:${Math.round((i + 1) / total * 100)}%"></div></div>
      </div>
      <div class="tour-body">
        <p class="tour-title">${step.title}</p>
        <p class="tour-text">${step.text}</p>
      </div>
      <div class="tour-footer">
        <div class="tour-dots">${(() => { const n = this.steps.length, v = 7, a = Math.max(0, Math.min(i - 3, n - v)); return this.steps.map((_, k) => k).slice(a, a + v).map(k => `<span class="tour-dot${k === i ? ' active' : ''}"></span>`).join('') })()}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${i > 0 ? '<button class="tour-btn tour-btn-ghost" data-t="prev">Atrás</button>' : ''}
          <button class="tour-btn tour-btn-primary" data-t="${ultimo ? 'fin' : 'next'}">${ultimo ? 'Listo' : 'Siguiente'}</button>
        </div>
      </div>`
    this.box.querySelector('.tour-close').onclick = () => this.end()
    this.box.querySelector('[data-t="prev"]')?.addEventListener('click', () => this._showStep(i - 1))
    this.box.querySelector('[data-t="next"]')?.addEventListener('click', () => this._showStep(i + 1))
    this.box.querySelector('[data-t="fin"]')?.addEventListener('click', () => this.end())

    document.querySelectorAll('.tour-target-highlight').forEach(el => el.classList.remove('tour-target-highlight'))
    if (target) {
      target.classList.add('tour-target-highlight')
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      // Esperar la animación del menú antes de medir
      setTimeout(() => this._position(target), esMovil() && enMenu(target) ? 320 : 0)
    }
  }

  _position(target) {
    const r = target.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const boxW = Math.min(320, vw - 16)
    const boxH = this.box.offsetHeight || 190
    let top, left
    if (vw < 600) {
      // Celular: la caja va abajo (o arriba si el elemento está abajo), a lo ancho
      left = 8
      top = r.bottom + boxH + 24 < vh ? r.bottom + 14 : Math.max(8, r.top - boxH - 14)
    } else if (r.right + boxW + 20 < vw) {
      left = r.right + 14; top = r.top + r.height / 2 - boxH / 2
    } else if (r.left - boxW - 20 > 0) {
      left = r.left - boxW - 14; top = r.top + r.height / 2 - boxH / 2
    } else {
      left = r.left + r.width / 2 - boxW / 2; top = r.top - boxH - 14
    }
    top = Math.max(8, Math.min(top, vh - boxH - 8))
    left = Math.max(8, Math.min(left, vw - boxW - 8))
    this.box.style.cssText = `top:${top}px;left:${left}px;width:${boxW}px;transform:none;`
  }

  _onKey(e) {
    if (e.key === 'Escape') this.end()
    if (e.key === 'ArrowRight' && this.index < this.steps.length - 1) this._showStep(this.index + 1)
    if (e.key === 'ArrowLeft' && this.index > 0) this._showStep(this.index - 1)
  }

  end() {
    document.querySelectorAll('.tour-target-highlight').forEach(el => el.classList.remove('tour-target-highlight'))
    this.overlay?.remove(); this.box?.remove()
    document.body.classList.remove('tour-activo')
    if (esMovil()) cerrarMenu()
    document.removeEventListener('keydown', this._onKey)
    try { localStorage.setItem(`tour-done-${detectRole()}`, '1') } catch (_) {}
  }
}

function startTour(role) {
  const cfg = TOURS[role]
  if (!cfg) return
  const steps = armarPasos(cfg)
  cerrarAyuda()
  document.getElementById('tour-overlay')?.remove()
  document.getElementById('tour-box')?.remove()
  new GuidedTour(steps).start()
}

// ─── Botón Ayuda y su panel ──────────────────────────────────────────────────
function cerrarAyuda() { document.getElementById('ayuda-pop')?.remove() }

function abrirAyuda(role) {
  if (document.getElementById('ayuda-pop')) { cerrarAyuda(); return }
  const colegio = document.querySelector('.sidebar-logo-text')?.textContent?.trim() ?? ''
  const panel = document.querySelector('.sidebar-logo-sub')?.textContent?.trim() ?? ''
  const msg = `Hola, necesito ayuda con el sistema.\nColegio: ${colegio}\n${panel}`
  const hayTutoriales = typeof window.__abrirTutoriales === 'function'

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ayuda-pop" role="dialog" aria-label="Ayuda">
      <div class="ap-head"><span>Ayuda</span><button type="button" data-a="cerrar" aria-label="Cerrar">${SVG.cerrar}</button></div>
      <button type="button" class="ap-op" data-a="tour"><span class="ap-ic">${SVG.ruta}</span><span><b>Recorrido del panel</b><small>Te muestra para qué sirve cada opción</small></span></button>
      ${hayTutoriales ? `<button type="button" class="ap-op" data-a="tutoriales"><span class="ap-ic">${SVG.video}</span><span><b>Tutoriales</b><small>Guías paso a paso y videos</small></span></button>` : ''}
      <a class="ap-op wa" href="https://wa.me/${WHATSAPP_SOPORTE}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" data-a="wa"><span class="ap-ic">${SVG.chat}</span><span><b>Contactar soporte</b><small>Escríbenos por WhatsApp</small></span></a>
    </div>`)
  const pop = document.getElementById('ayuda-pop')
  pop.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a
    if (a === 'cerrar' || a === 'wa') cerrarAyuda()
    if (a === 'tour') startTour(role)
    if (a === 'tutoriales') { cerrarAyuda(); window.__abrirTutoriales() }
  })
}

function addHelpButton(role) {
  if (document.getElementById('tour-trigger-btn')) return
  const btn = document.createElement('button')
  btn.id = 'tour-trigger-btn'
  btn.type = 'button'
  btn.title = 'Ayuda'
  btn.setAttribute('aria-label', 'Ayuda')
  btn.innerHTML = SVG.ayuda
  btn.onclick = e => { e.stopPropagation(); abrirAyuda(role) }
  document.body.appendChild(btn)
  // Tocar fuera del panel lo cierra
  document.addEventListener('click', e => {
    const pop = document.getElementById('ayuda-pop')
    if (pop && !pop.contains(e.target) && e.target !== btn) cerrarAyuda()
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarAyuda() })
}

// ─── Inicio ──────────────────────────────────────────────────────────────────
function init() {
  const role = detectRole()
  if (!role || !TOURS[role]) return
  estilos()
  window.__tourStart = () => startTour(role)
  addHelpButton(role)

  // El recorrido se abre solo la primera vez que el usuario entra a su panel
  let visto = false
  try { visto = localStorage.getItem(`tour-done-${role}`) === '1' } catch (_) {}
  if (!visto) setTimeout(() => startTour(role), 900)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()