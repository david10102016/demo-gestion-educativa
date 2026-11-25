// js/demo/entrada-demo.js
// Página de entrada de una cuenta de prueba: /<enlace-del-colegio>
// Muestra el colegio, los días que quedan y "¿Qué rol quieres probar?".
// Reemplaza al selector de colegios y al login (solo en el despliegue demo).

import { supabase } from '../config/supabase-config.js'
import { slugDeLaDireccion, slugGuardado, enlaceWhatsapp } from './demo-config.js'
import { entrarComo, guardarColegioLocal } from './sesion-demo.js'
import { iconoRol, ICONO_WHATSAPP, ICONO_RELOJ, esc } from './iconos-demo.js'

const ESTILOS = `
.dm-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 16px;background:linear-gradient(160deg,color-mix(in srgb,var(--color-primary) 14%,#f8fafc),#eef1f6 60%)}
.dm-card{width:100%;max-width:760px;background:#fff;border-radius:22px;box-shadow:0 18px 50px rgba(15,23,42,.12);padding:32px 28px}
.dm-head{display:flex;align-items:center;gap:16px;margin-bottom:6px}
.dm-logo{width:64px;height:64px;border-radius:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--color-primary);color:#fff;font-weight:700;font-size:22px;overflow:hidden}
.dm-logo img{width:100%;height:100%;object-fit:cover}
.dm-nombre{font-size:1.35rem;font-weight:700;color:#0f172a;line-height:1.2}
.dm-sub{font-size:.9rem;color:#475569;margin-top:3px}
.dm-aviso{display:flex;align-items:center;gap:8px;margin:18px 0 22px;padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--color-primary) 9%,#fff);color:#1e293b;font-size:.9rem}
.dm-aviso svg{flex-shrink:0;color:var(--color-primary)}
.dm-titulo{font-size:1.05rem;font-weight:700;color:#0f172a;margin-bottom:4px}
.dm-ayuda{font-size:.85rem;color:#64748b;margin-bottom:16px}
.dm-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.dm-rol{display:flex;align-items:center;gap:12px;text-align:left;padding:14px;border-radius:14px;border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .1s;font:inherit;color:inherit}
.dm-rol:hover{border-color:var(--color-primary);box-shadow:0 6px 18px rgba(15,23,42,.08)}
.dm-rol:active{transform:scale(.99)}
.dm-rol:disabled{opacity:.6;cursor:wait}
.dm-rol-ico{width:42px;height:42px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--color-primary) 12%,#fff);color:var(--color-primary)}
.dm-rol-et{font-weight:700;font-size:.95rem;color:#0f172a}
.dm-rol-nom{font-size:.8rem;color:#64748b;margin-top:2px}
.dm-error{display:none;margin-top:14px;padding:10px 14px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:.88rem}
.dm-pie{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.82rem;color:#64748b}
.dm-wa{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;font-size:.88rem}
.dm-centro{text-align:center}
.dm-centro .dm-titulo{font-size:1.25rem;margin-bottom:8px}
.dm-centro p{color:#475569;margin-bottom:18px;line-height:1.5}
.dm-spin{width:34px;height:34px;border:3px solid #e2e8f0;border-top-color:var(--color-primary);border-radius:50%;animation:dmgiro .8s linear infinite;margin:10px auto}
@keyframes dmgiro{to{transform:rotate(360deg)}}
@media (max-width:520px){.dm-card{padding:24px 18px}.dm-nombre{font-size:1.15rem}.dm-roles{grid-template-columns:1fr}}
`

function montarBase() {
  document.getElementById('pantalla-selector')?.classList.remove('active')
  document.getElementById('pantalla-login')?.classList.remove('active')
  const estilo = document.createElement('style')
  estilo.textContent = ESTILOS
  document.head.appendChild(estilo)
  const wrap = document.createElement('div')
  wrap.className = 'dm-wrap'
  wrap.innerHTML = '<div class="dm-card" id="dm-card"><div class="dm-spin" aria-label="Cargando"></div></div>'
  document.body.appendChild(wrap)
  return document.getElementById('dm-card')
}

function botonWhatsapp(texto) {
  const url = enlaceWhatsapp(texto)
  return url ? `<a class="dm-wa" href="${esc(url)}" target="_blank" rel="noopener">${ICONO_WHATSAPP} Escríbenos por WhatsApp</a>` : ''
}

function pantallaMensaje(card, titulo, texto, textoWa) {
  card.innerHTML = `
    <div class="dm-centro">
      <div class="dm-titulo">${esc(titulo)}</div>
      <p>${esc(texto)}</p>
      ${botonWhatsapp(textoWa)}
    </div>`
}

function aplicarColores(estado) {
  if (estado.color_primario) document.documentElement.style.setProperty('--color-primary', estado.color_primario)
  if (estado.color_secundario) document.documentElement.style.setProperty('--color-secondary', estado.color_secundario)
}

function pantallaRoles(card, slug, estado) {
  const dias = Number(estado.dias_restantes ?? 0)
  const textoDias = dias === 1 ? 'te queda 1 día' : `te quedan ${dias} días`
  const logo = estado.logo_url
    ? `<img src="${esc(estado.logo_url)}" alt="">`
    : esc(estado.sigla || String(estado.nombre ?? '').split(' ').filter(w => w.length > 2).map(w => w[0]).join('').slice(0, 3).toUpperCase())

  card.innerHTML = `
    <div class="dm-head">
      <div class="dm-logo">${logo}</div>
      <div>
        <div class="dm-nombre">${esc(estado.nombre)}</div>
        <div class="dm-sub">Gestión Educativa · Cuenta de prueba</div>
      </div>
    </div>
    <div class="dm-aviso">${ICONO_RELOJ}<span>Prueba gratuita: <strong>${esc(textoDias)}</strong>. Los datos son de ejemplo.</span></div>
    <div class="dm-titulo">¿Qué rol quieres probar?</div>
    <div class="dm-ayuda">Entras con un clic. Dentro del sistema puedes cambiar de rol cuando quieras.</div>
    <div class="dm-roles">
      ${(estado.roles ?? []).map(r => `
        <button type="button" class="dm-rol" data-clave="${esc(r.clave)}">
          <span class="dm-rol-ico">${iconoRol(r.rol)}</span>
          <span><span class="dm-rol-et">${esc(r.etiqueta)}</span><br><span class="dm-rol-nom">${esc(r.nombre ?? '')}</span></span>
        </button>`).join('')}
    </div>
    <div class="dm-error" id="dm-error" role="alert"></div>
    <div class="dm-pie">
      <span>¿Te interesa para tu colegio?</span>
      ${botonWhatsapp(`Hola, estoy probando Gestión Educativa (${estado.nombre}) y quiero más información.`)}
    </div>`

  const errorEl = card.querySelector('#dm-error')
  card.querySelectorAll('.dm-rol').forEach(btn => btn.addEventListener('click', async () => {
    card.querySelectorAll('.dm-rol').forEach(b => { b.disabled = true })
    errorEl.style.display = 'none'
    const nombre = btn.querySelector('.dm-rol-et')
    const original = nombre.textContent
    nombre.textContent = 'Entrando…'
    const error = await entrarComo(slug, btn.dataset.clave)
    if (error) {
      nombre.textContent = original
      card.querySelectorAll('.dm-rol').forEach(b => { b.disabled = false })
      errorEl.textContent = error
      errorEl.style.display = 'block'
    }
  }))
}

/** Pinta la entrada del demo. No termina nunca: detiene el resto del script del index. */
export async function iniciarEntradaDemo() {
  const card = montarBase()
  // En la raíz (app instalada o enlace sin nombre) se usa la prueba de este dispositivo, si la hay
  const slug = slugDeLaDireccion() ?? slugGuardado()

  if (!slug) {
    pantallaMensaje(card, 'Gestión Educativa',
      'Para probar el sistema necesitas el enlace de tu colegio. Escríbenos y te lo enviamos.',
      'Hola, quiero una cuenta de prueba de Gestión Educativa para mi colegio.')
    return new Promise(() => {})
  }

  let estado = null
  try {
    const { data, error } = await supabase.rpc('demo_por_slug', { p_slug: slug })
    if (error) throw error
    estado = data
  } catch (_) {
    pantallaMensaje(card, 'Sin conexión',
      navigator.onLine ? 'No se pudo cargar la cuenta de prueba. Intenta de nuevo en un momento.' : 'Revisa tu conexión a internet e intenta de nuevo.',
      'Hola, tengo problemas para abrir mi cuenta de prueba de Gestión Educativa.')
    return new Promise(() => {})
  }

  if (!estado) {
    pantallaMensaje(card, 'Enlace no encontrado',
      'Este enlace de prueba no existe o ya fue cerrado. Escríbenos y te enviamos uno nuevo.',
      'Hola, mi enlace de prueba de Gestión Educativa no funciona.')
    return new Promise(() => {})
  }

  aplicarColores(estado)
  guardarColegioLocal({ id: estado.colegio_id, nombre: estado.nombre, sigla: estado.sigla, logo_url: estado.logo_url,
    color_primario: estado.color_primario, color_secundario: estado.color_secundario })

  if (estado.estado === 'vencido') {
    pantallaMensaje(card, 'Tu prueba terminó',
      `La cuenta de prueba de ${estado.nombre} ya no está disponible. Escríbenos para continuar con tu colegio.`,
      `Hola, terminó la prueba de ${estado.nombre} y quiero continuar con Gestión Educativa.`)
    return new Promise(() => {})
  }
  if (estado.estado === 'no_iniciado') {
    pantallaMensaje(card, 'Tu prueba aún no empieza',
      `La cuenta de prueba de ${estado.nombre} estará disponible desde el ${estado.desde}.`,
      `Hola, tengo una consulta sobre la prueba de ${estado.nombre}.`)
    return new Promise(() => {})
  }

  document.title = `${estado.nombre} · Prueba de Gestión Educativa`
  pantallaRoles(card, slug, estado)
  return new Promise(() => {})
}
