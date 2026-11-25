// js/demo/barra-demo.js
// Barra fija de la cuenta de prueba: días que quedan, "Probando como" (cambio de rol con un clic)
// y contacto por WhatsApp. Si la prueba venció, cubre la pantalla y cierra la sesión.

import { supabase } from '../config/supabase-config.js'
import { enlaceWhatsapp, guardarSlug } from './demo-config.js'
import { entrarComo } from './sesion-demo.js'
import { ICONO_RELOJ, ICONO_CAMBIAR, ICONO_WHATSAPP, esc } from './iconos-demo.js'

const ESTILOS = `
.dmb{position:fixed;left:50%;bottom:14px;line-height:1.2;transform:translateX(-50%);z-index:9000;display:flex;align-items:center;gap:10px;
  padding:7px 8px 7px 14px;border-radius:999px;background:#0f172a;color:#f8fafc;font-size:.82rem;
  box-shadow:0 10px 30px rgba(15,23,42,.35);max-width:calc(100vw - 20px)}
.dmb-dias{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.dmb-dias.urgente{color:#fca5a5}
.dmb-corto{display:none}
@media (max-width:640px){.dmb-corto{display:inline}}
.dmb-sep{width:1px;height:18px;background:#334155}
.dmb-rol{display:inline-flex;align-items:center;gap:6px;color:#cbd5e1;white-space:nowrap;margin:0;font-weight:400}
.dmb .dmb-sel{width:auto;height:30px;min-height:0;margin:0;background:#1e293b;color:#fff;border:1px solid #334155;border-radius:999px;padding:0 12px;font:inherit;font-size:.82rem;max-width:200px;cursor:pointer;box-shadow:none}
.dmb .dmb-sel:focus{outline:2px solid #60a5fa;outline-offset:1px}
.dmb-wa{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#16a34a;color:#fff;flex-shrink:0}
.dmb-cerrar{background:none;border:0;color:#94a3b8;cursor:pointer;padding:4px 6px;font:inherit;font-size:1rem;line-height:1}
.dmb-mini{position:fixed;left:12px;bottom:14px;z-index:9000;width:38px;height:38px;border-radius:50%;border:0;background:#0f172a;color:#fff;
  display:none;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(15,23,42,.35);cursor:pointer}
.dmb-capa{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:16px}
.dmb-caja{background:#fff;color:#0f172a;border-radius:18px;max-width:420px;width:100%;padding:26px;text-align:center}
.dmb-caja h3{font-size:1.15rem;margin:0 0 8px}
.dmb-caja p{color:#475569;margin:0 0 18px;line-height:1.5}
.dmb-caja a,.dmb-caja button{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:0;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;margin:4px}
.dmb-caja a{background:#16a34a;color:#fff}
.dmb-caja button{background:#e2e8f0;color:#0f172a}
@media (max-width:640px){
  .dmb{left:10px;transform:none;max-width:calc(100vw - 84px);bottom:calc(12px + env(safe-area-inset-bottom));padding:6px 6px 6px 10px;gap:6px;font-size:.78rem}
  .dmb-largo{display:none}
  .dmb-sep{display:none}
  .dmb-rol .dmb-txt{display:none}
  .dmb .dmb-sel{max-width:140px}
}
@media print{.dmb,.dmb-mini{display:none!important}}
`

let montada = false

function pantallaVencida(estado) {
  const wa = enlaceWhatsapp(`Hola, terminó la prueba de ${estado?.nombre ?? 'mi colegio'} y quiero continuar con Gestión Educativa.`)
  const capa = document.createElement('div')
  capa.className = 'dmb-capa'
  capa.innerHTML = `
    <div class="dmb-caja" role="alertdialog" aria-modal="true">
      <h3>Tu prueba terminó</h3>
      <p>La cuenta de prueba de ${esc(estado?.nombre ?? 'tu colegio')} ya no está disponible. Escríbenos para continuar con tu colegio.</p>
      ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${ICONO_WHATSAPP} Escríbenos</a>` : ''}
      <button type="button" id="dmb-salir">Salir</button>
    </div>`
  document.body.appendChild(capa)
  capa.querySelector('#dmb-salir').addEventListener('click', async () => {
    try { await supabase.auth.signOut() } catch (_) {}
    try { sessionStorage.clear() } catch (_) {}
    window.location.href = estado?.slug ? `/${estado.slug}` : '/'
  })
}

/** Monta la barra. Se llama desde verificarSesion cuando el modo demo está activo. */
export async function iniciarBarraDemo(perfil) {
  if (montada || !perfil || perfil.rol === 'superadmin') return
  montada = true

  let estado = null
  try {
    const { data, error } = await supabase.rpc('demo_mi_estado')
    if (error) throw error
    estado = data
  } catch (_) { return }        // sin conexión: la barra aparece en la próxima carga
  if (!estado || typeof estado !== 'object' || !estado.slug) return   // no es un colegio de prueba

  if (estado.slug) guardarSlug(estado.slug)

  const estilo = document.createElement('style')
  estilo.textContent = ESTILOS
  document.head.appendChild(estilo)

  if (estado.estado !== 'vigente') { pantallaVencida(estado); return }

  const dias = Number(estado.dias_restantes ?? 0)
  const textoDias = dias === 1 ? 'Queda 1 día' : `Quedan ${dias} días`
  const roles = estado.roles ?? []
  // El rol actual: por la persona exacta (mismo nombre) o, si no, por el tipo de rol
  const actual = roles.find(r => r.rol === perfil.rol && r.nombre === perfil.nombre_completo)
              ?? roles.find(r => r.rol === perfil.rol)
  const wa = enlaceWhatsapp(`Hola, estoy probando Gestión Educativa (${estado.nombre}) y quiero más información.`)

  const barra = document.createElement('div')
  barra.className = 'dmb'
  barra.setAttribute('role', 'region')
  barra.setAttribute('aria-label', 'Cuenta de prueba')
  barra.innerHTML = `
    <span class="dmb-dias ${dias <= 3 ? 'urgente' : ''}" title="${esc(textoDias)}">${ICONO_RELOJ}<span class="dmb-largo">${esc(textoDias)}</span><span class="dmb-corto">${dias} d</span></span>
    <span class="dmb-sep"></span>
    <label class="dmb-rol">${ICONO_CAMBIAR}<span class="dmb-txt">Probando como</span>
      <select class="dmb-sel" aria-label="Cambiar de rol">
        ${actual ? '' : '<option value="" selected>Elegir rol</option>'}
        ${roles.map(r => `<option value="${esc(r.clave)}" ${r === actual ? 'selected' : ''}>${esc(r.etiqueta)}</option>`).join('')}
      </select>
    </label>
    ${wa ? `<a class="dmb-wa" href="${esc(wa)}" target="_blank" rel="noopener" title="Escríbenos por WhatsApp" aria-label="WhatsApp">${ICONO_WHATSAPP}</a>` : ''}
    <button type="button" class="dmb-cerrar" title="Ocultar" aria-label="Ocultar barra">&times;</button>`
  document.body.appendChild(barra)
  // Los clics en la barra no llegan a la pantalla de abajo (la portería devuelve el foco al lector y cerraría la lista)
  barra.addEventListener('click', e => e.stopPropagation())

  const mini = document.createElement('button')
  mini.type = 'button'
  mini.className = 'dmb-mini'
  mini.title = 'Mostrar barra de prueba'
  mini.setAttribute('aria-label', 'Mostrar barra de prueba')
  mini.innerHTML = ICONO_CAMBIAR
  document.body.appendChild(mini)

  barra.querySelector('.dmb-cerrar').addEventListener('click', () => { barra.style.display = 'none'; mini.style.display = 'flex' })
  mini.addEventListener('click', () => { barra.style.display = 'flex'; mini.style.display = 'none' })

  const sel = barra.querySelector('select')
  sel.addEventListener('change', async () => {
    const clave = sel.value
    if (!clave || clave === actual?.clave) return
    sel.disabled = true
    const error = await entrarComo(estado.slug, clave)
    if (error) {
      sel.disabled = false
      sel.value = actual?.clave ?? ''
      alertaBreve(error)
    }
  })
}

function alertaBreve(texto) {
  const t = document.createElement('div')
  t.textContent = texto
  t.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:9100;background:#b91c1c;color:#fff;padding:9px 14px;border-radius:10px;font-size:.85rem;max-width:90vw'
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
