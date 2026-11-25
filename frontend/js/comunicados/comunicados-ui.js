// js/comunicados/comunicados-ui.js
// Render bandeja de entrada y modal de redacción
import { marcarLeido, marcarLeidoTutor, getLecturasComunicado, getResumenEnviados } from './comunicados.js'
import { escapeHtml } from '../utils/sanitize.js'

const COLORES_CAT = {
  'Urgente':     'badge-error',
  'Citación':    'badge-warning',
  'Informativo': 'badge-info'
}

// ─── Íconos SVG (sin emojis) ─────────────────────────────────────────────────
const svg = (cuerpo, { w = 14, h = 14, vb = '0 0 24 24', color = 'currentColor', grosor = 2.5, titulo = '' } = {}) =>
  `<svg width="${w}" height="${h}" viewBox="${vb}" fill="none" stroke="${color}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0;" aria-hidden="${titulo ? 'false' : 'true'}">${titulo ? `<title>${titulo}</title>` : ''}${cuerpo}</svg>`

// Checks de lectura (estilo mensajería): un check gris = sin leer · doble check celeste = leído
const CHECK_GRIS    = svg('<polyline points="20 6 9 17 4 12"/>', { color: '#9ca3af', titulo: 'Sin leer' })
const CHECK_CELESTE = svg('<polyline points="18 6 7 17 2 12"/><polyline points="26 6 15 17 13.5 15.5"/>', { w: 18, vb: '0 0 28 24', color: '#34B7F1', titulo: 'Leído' })
const ICONO_BANDEJA = svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>', { w: 36, h: 36, grosor: 1.5 })
const ICONO_INFO    = svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', { grosor: 2 })

// Formato corto: 23/11 14:32 (24 h), para que entre en el modal
const fmtFechaHora = f => {
  const d = new Date(f), p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─── CONTADOR DEL MENÚ "Comunicados" (estudiante y padre) ────────────────────
// Número rojo con pulso, igual que "Mis tareas". Usa el elemento #badge-comunicados del menú.
export function pintarBadgeComunicados(n) {
  if (!document.getElementById('com-estilo-pulso')) {
    const st = document.createElement('style')
    st.id = 'com-estilo-pulso'
    st.textContent = `
      @keyframes com-pulso { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.18); opacity: .65 } }
      .com-pulso { animation: com-pulso 1.4s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .com-pulso { animation: none; } }`
    document.head.appendChild(st)
  }
  const b = document.getElementById('badge-comunicados')
  if (!b) return
  b.textContent = n > 9 ? '9+' : String(n)
  b.style.display = n > 0 ? 'flex' : 'none'
  b.classList.toggle('com-pulso', n > 0)
}

// ─── RENDER BANDEJA ESTUDIANTE / TUTOR ───────────────────────────────────────
// opciones.esTutor = true → al abrir se registra la lectura del padre (migración 115)
export function renderBandeja(contenedor, items, onActualizar, opciones = {}) {
  if (!items.length) {
    contenedor.innerHTML = `<div style="text-align:center;padding:40px;color:var(--color-text-3);">
      <div style="margin-bottom:8px;display:flex;justify-content:center;">${ICONO_BANDEJA}</div>
      <p>Sin comunicados recibidos</p>
    </div>`
    return
  }

  contenedor.innerHTML = `<p style="font-size:13px;color:var(--color-text-3);margin-bottom:12px;display:flex;align-items:center;gap:6px;">${ICONO_INFO} Toca un comunicado para leerlo completo.</p>` + items.map(item => {
    const com = item.comunicado
    const leido = !!item.leido_at
    return `<div class="card" style="margin-bottom:12px;cursor:pointer;border-left:4px solid ${leido ? 'var(--color-border)' : 'var(--color-primary)'};opacity:${leido ? '0.8' : '1'};"
      onclick="abrirComunicado('${item.id}', this)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            ${!leido ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--color-primary);display:inline-block;"></span>' : ''}
            <span class="badge ${COLORES_CAT[com.categoria] ?? 'badge-info'}">${com.categoria}</span>
            <span style="font-size:12px;color:var(--color-text-3);">${new Date(com.created_at).toLocaleDateString('es-BO')}</span>
          </div>
          <strong style="font-size:15px;">${escapeHtml(com.asunto)}</strong>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:2px;">De: ${com.emisor?.nombre_completo ?? '—'}</div>
        </div>
        <svg style="width:16px;height:16px;color:var(--color-text-3);flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="com-contenido" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);font-size:14px;white-space:pre-wrap;">${escapeHtml(com.contenido)}</div>
    </div>`
  }).join('')

  window.abrirComunicado = async function(ceId, card) {
    const contenido = card.querySelector('.com-contenido')
    const abierto = contenido.style.display !== 'none'
    contenido.style.display = abierto ? 'none' : 'block'
    if (!abierto) {
      try {
        await (opciones.esTutor ? marcarLeidoTutor(ceId) : marcarLeido(ceId))
      } catch (e) {
        console.error('[comunicados] marcar leído', e)
      }
      const punto = card.querySelector('span[style*="border-radius:50%"]')
      if (punto) punto.remove()
      card.style.borderLeftColor = 'var(--color-border)'
      card.style.opacity = '0.8'
      if (onActualizar) onActualizar()
    }
  }
}

// ─── RENDER TABLA ENVIADOS (DIRECTOR / PROFESOR) ─────────────────────────────
// opciones.esDirector = true → el detalle muestra qué estudiantes no tienen padre vinculado
export function renderTablaEnviados(tbody, items, opciones = {}) {
  tbody.innerHTML = !items.length
    ? `<tr><td colspan="6" style="text-align:center;color:var(--color-text-3);">Sin comunicados enviados aún</td></tr>`
    : items.map(c => {
        const todos = c.total_count > 0 && c.leidos_count === c.total_count
        return `
        <tr style="cursor:pointer;" onclick="verDetalleComunicadoProf('${c.id}')">
          <td>${new Date(c.created_at).toLocaleDateString('es-BO')}</td>
          <td><span class="badge ${COLORES_CAT[c.categoria] ?? 'badge-info'}">${c.categoria}</span></td>
          <td><strong>${escapeHtml(c.asunto)}</strong></td>
          <td>${c.emisor_nombre ?? '—'}</td>
          <td>${c.destinatario_nombre ?? '—'}</td>
          <td style="font-size:12px;color:var(--color-text-3);white-space:nowrap;">${todos ? CHECK_CELESTE : CHECK_GRIS} ${c.leidos_count}/${c.total_count} leído(s)</td>
        </tr>`
      }).join('')

  window._comunicadosEnviados = items

  window.verDetalleComunicadoProf = function(id) {
    const c = window._comunicadosEnviados?.find(x => x.id === id)
    if (!c) return
    document.getElementById('modal-com-det-titulo').textContent = c.asunto
    document.getElementById('modal-com-det-body').innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
        <span class="badge ${COLORES_CAT[c.categoria] ?? 'badge-info'}">${c.categoria}</span>
        <span style="font-size:12px;color:var(--color-text-3);">
          ${new Date(c.created_at).toLocaleDateString('es-BO', {weekday:'long', day:'numeric', month:'long'})}
        </span>
      </div>
      <div style="margin-bottom:12px;font-size:13px;">
        <span style="color:var(--color-text-3);">Para:</span>
        <strong style="margin-left:6px;">${c.destinatario_nombre ?? '—'}</strong>
      </div>
      <div style="padding:16px;background:var(--color-surface-2);border-radius:var(--radius-md);font-size:14px;white-space:pre-wrap;line-height:1.6;">
        ${escapeHtml(c.contenido)}
      </div>
      <div id="com-det-lecturas" style="margin-top:16px;font-size:13px;color:var(--color-text-3);">Cargando lecturas…</div>`
    document.getElementById('modal-detalle-comunicado').classList.remove('hidden')
    cargarLecturas(id, opciones)
  }
}

// ─── LISTA DE ENVIADOS CON "VER MÁS" (DIRECTOR / PROFESOR) ───────────────────
// Carga de a 50, del más nuevo al más viejo. La columna Lectura cuenta familias que lo leyeron
// (estudiante o padre); el detalle muestra quién leyó.
const POR_PAGINA = 50

export async function montarListaEnviados(tbody, opciones = {}) {
  let items = []
  let desde = 0

  const botonVerMas = () => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td colspan="6" style="text-align:center;padding:12px;">
      <button type="button" class="btn btn-secondary btn-sm">Ver más</button></td>`
    const btn = tr.querySelector('button')
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = 'Cargando…'
      await cargar()
    })
    tbody.appendChild(tr)
  }

  async function cargar() {
    try {
      const nuevos = await getResumenEnviados(desde, POR_PAGINA)
      items = items.concat(nuevos)
      desde += nuevos.length
      renderTablaEnviados(tbody, items, opciones)
      if (nuevos.length === POR_PAGINA) botonVerMas()
    } catch (e) {
      console.error('[comunicados] lista de enviados', e)
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-text-3);">No se pudo cargar la lista. Intenta de nuevo.</td></tr>`
      } else {
        renderTablaEnviados(tbody, items, opciones)
        botonVerMas()
      }
    }
  }

  await cargar()
}

// ─── LECTURAS POR ESTUDIANTE (detalle del comunicado) ────────────────────────
// Doble check celeste = abierto desde la cuenta del estudiante (leido_at)
// Visto por el padre = abierto desde la cuenta del padre (comunicados_lectura_tutor)
async function cargarLecturas(comunicadoId, { esDirector = false } = {}) {
  const cont = document.getElementById('com-det-lecturas')
  if (!cont) return
  let filas
  try {
    filas = await getLecturasComunicado(comunicadoId, { conVinculos: esDirector })
  } catch (e) {
    console.error('[comunicados] lecturas', e)
    cont.textContent = 'No se pudo cargar quién lo leyó.'
    return
  }
  // Si el usuario ya abrió otro comunicado, no pisar su detalle
  if (document.getElementById('com-det-lecturas') !== cont) return
  if (!filas.length) { cont.textContent = 'Sin destinatarios.'; return }

  const leidos = filas.filter(f => f.leido_at).length
  const padres = filas.filter(f => f.visto_padre_at).length
  // Director: el total de padres son los estudiantes con padre vinculado. Profesor: no se conoce.
  const conPadre = esDirector ? filas.filter(f => f.tiene_padre || f.visto_padre_at).length : null
  const celdaPadre = f => {
    if (f.visto_padre_at) return `${CHECK_CELESTE} ${fmtFechaHora(f.visto_padre_at)}`
    if (f.tiene_padre === false) return '<span style="color:var(--color-text-3);">Sin padre vinculado</span>'
    if (f.tiene_padre === true) return `${CHECK_GRIS} Sin leer`
    return '<span style="color:var(--color-text-3);">—</span>'
  }
  cont.innerHTML = `
    <div style="margin-bottom:8px;color:var(--color-text);">
      <strong>Leído por el estudiante:</strong> ${leidos ? CHECK_CELESTE : CHECK_GRIS} ${leidos}/${filas.length}
      <span style="margin-left:16px;"><strong>Leído por el padre:</strong> ${padres ? CHECK_CELESTE : CHECK_GRIS} ${conPadre === null ? padres : `${padres}/${conPadre}`}</span>
      ${conPadre !== null ? `<div style="margin-top:4px;font-size:12px;color:var(--color-text-3);">${filas.length - conPadre} estudiante(s) sin padre vinculado: el comunicado les llega solo por la cuenta del estudiante.</div>` : ''}
    </div>
    <div class="table-wrapper" style="max-height:320px;overflow:auto;">
      <table style="font-size:13px;width:100%;">
        <thead><tr><th>Nombre</th><th style="white-space:nowrap;">Estudiante</th><th style="white-space:nowrap;">Padre</th></tr></thead>
        <tbody>
          ${filas.map(f => `
            <tr>
              <td>${escapeHtml(f.nombre)}</td>
              <td style="white-space:nowrap;">${f.leido_at ? `${CHECK_CELESTE} ${fmtFechaHora(f.leido_at)}` : `${CHECK_GRIS} Sin leer`}</td>
              <td style="white-space:nowrap;">${celdaPadre(f)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`
}