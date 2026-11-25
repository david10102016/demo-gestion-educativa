// js/pagos/bandeja-comprobantes.js
// Bandeja de comprobantes de pago para el panel del director (plan avanzado con finanzas).
// Misma lógica que la bandeja de la secretaría: ver el comprobante, aprobar o rechazar.
// La base de datos ya permite al director leer y actualizar pagos de su colegio (RLS).

import { supabase } from '../config/supabase-config.js'
import { obtenerPagosPendientes, revisarPago } from './pagos.js'
import { MESES_LABELS, ESTADOS_PAGO } from '../config/config-pagos.js'
import { toast, mostrarLoader, ocultarLoader, confirmar, formatFechaHora } from '../utils/ui.js'

const ESTILOS = `
.bc-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.bc-tab{padding:7px 14px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);cursor:pointer;font:inherit;font-size:.85rem;color:var(--color-text-secondary)}
.bc-tab.activo{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
.bc-cuenta{display:inline-flex;min-width:20px;justify-content:center;margin-left:6px;padding:0 6px;border-radius:999px;background:rgba(255,255,255,.25);font-size:.75rem}
.bc-grid{display:grid;gap:12px}
.bc-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;padding:16px 18px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}
.bc-card h3{margin:0 0 4px;font-size:.95rem;font-weight:600;color:var(--color-text-primary)}
.bc-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:.8rem;color:var(--color-text-secondary)}
.bc-meta span{display:flex;align-items:center;gap:4px}
.bc-acc{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.bc-thumb{width:52px;height:52px;border-radius:8px;object-fit:cover;border:1px solid var(--color-border);cursor:pointer;background:#fff}
.bc-pdf{width:52px;height:52px;border-radius:8px;border:1px solid var(--color-border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#ef4444;background:#fef2f2;cursor:pointer}
.bc-estado{display:inline-flex;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
.bc-estado-aprobado{background:#d1fae5;color:#065f46}.bc-estado-rechazado{background:#fee2e2;color:#991b1b}
.bc-vacio{padding:26px;text-align:center;color:var(--color-text-secondary);font-size:.9rem}
.bc-info{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:.875rem}
.bc-info span{color:var(--color-text-secondary)}
#bc-modal .modal-box{max-width:700px;width:95%}
#bc-visor-img{width:100%;max-height:65vh;object-fit:contain;border-radius:8px}
#bc-visor-pdf{width:100%;height:65vh;border:none;border-radius:8px}
@media (max-width:520px){.bc-card{grid-template-columns:1fr}.bc-acc{flex-direction:row;align-items:center;justify-content:space-between}.bc-info{grid-template-columns:1fr}}
`

const svgIco = p => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
const ICO = {
  curso:   svgIco('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  mes:     svgIco('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  monto:   svgIco('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>'),
  persona: svgIco('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  recibo:  svgIco('<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>'),
  alerta:  svgIco('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  ok:      svgIco('<polyline points="20 6 9 17 4 12"/>'),
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

let raiz = null
let pendientes = []
let historial = []
let pestana = 'pendientes'
let pagoActual = null
let montado = false

const claveTransaccion = p => p.numero_transaccion ? `${p.numero_transaccion}|${p.created_at}` : null

function resumenTransaccion(pago) {
  const clave = claveTransaccion(pago)
  if (!clave) return null
  const vistos = new Set()
  let total = 0, meses = 0
  for (const p of [...pendientes, ...historial]) {
    if (vistos.has(p.id) || claveTransaccion(p) !== clave) continue
    vistos.add(p.id)
    total += Number(p.monto_bs) || 0
    meses++
  }
  return { total, meses }
}

function lineaTransaccion(pago) {
  if (!pago.numero_transaccion && pago.monto_declarado == null) return ''
  const res = resumenTransaccion(pago)
  const partes = []
  if (pago.numero_transaccion) partes.push(`<span>${ICO.recibo} N.º transacción: <strong>${esc(pago.numero_transaccion)}</strong></span>`)
  if (pago.monto_declarado != null) {
    const declarado = Number(pago.monto_declarado)
    const difiere = res && Math.abs(declarado - res.total) > 0.009
    const detalle = res ? ` · total de la transacción ${res.total.toFixed(2)} Bs (${res.meses} ${res.meses === 1 ? 'mes' : 'meses'})` : ''
    partes.push(difiere
      ? `<span style="color:#b45309;font-weight:600;">${ICO.alerta} Declarado ${declarado.toFixed(2)} Bs${detalle}: no coincide</span>`
      : `<span style="color:#047857;">${ICO.ok} Declarado ${declarado.toFixed(2)} Bs${detalle}</span>`)
  }
  return `<div class="bc-meta">${partes.join('')}</div>`
}

const esPdf = p => String(p.comprobante_url ?? '').toLowerCase().includes('.pdf') ||
                   String(p.comprobante_nombre ?? '').toLowerCase().endsWith('.pdf')
const quienPago = p => p.tutores_familia?.usuarios?.nombre_completo ?? p.nombre_pagador ?? 'Pago en efectivo'

function tarjeta(p, conAcciones) {
  const est = p.estudiantes
  const mes = MESES_LABELS[p.mes] ?? `Mes ${p.mes}`
  const estado = ESTADOS_PAGO[p.estado] ?? { label: p.estado }
  const thumb = p.comprobante_url
    ? esPdf(p)
      ? `<div class="bc-pdf" data-ver="${esc(p.id)}">PDF</div>`
      : `<img class="bc-thumb" src="${esc(p.comprobante_url)}" alt="Comprobante" data-ver="${esc(p.id)}">`
    : `<div class="bc-pdf" style="background:#f1f5f9;color:#94a3b8;cursor:default;">—</div>`
  return `
    <div class="bc-card">
      <div>
        <h3>${esc(est?.usuarios?.nombre_completo)}</h3>
        <div class="bc-meta">
          <span>${ICO.curso} ${esc(est?.cursos?.nombre_completo ?? '—')}</span>
          <span>${ICO.mes} ${esc(mes)} ${esc(p.año)}</span>
          <span>${ICO.monto} ${Number(p.monto_bs).toFixed(2)} Bs</span>
          <span>${ICO.persona} ${esc(quienPago(p))}</span>
        </div>
        ${lineaTransaccion(p)}
        ${p.observacion_tutor ? `<p style="margin:8px 0 0;font-size:.8rem;color:var(--color-text-secondary);">"${esc(p.observacion_tutor)}"</p>` : ''}
      </div>
      <div class="bc-acc">
        ${thumb}
        ${conAcciones
          ? `<button class="btn btn-sm btn-primary" data-revisar="${esc(p.id)}">Revisar</button>`
          : `<span class="bc-estado bc-estado-${esc(p.estado)}">${esc(estado.label)}</span>`}
      </div>
    </div>`
}

function pintar() {
  raiz.querySelector('[data-cuenta]').textContent = pendientes.length
  raiz.querySelectorAll('.bc-tab').forEach(t => t.classList.toggle('activo', t.dataset.tab === pestana))
  const lista = pestana === 'pendientes' ? pendientes : historial
  const grid = raiz.querySelector('.bc-grid')
  grid.innerHTML = lista.length
    ? lista.map(p => tarjeta(p, pestana === 'pendientes')).join('')
    : `<div class="bc-vacio">${pestana === 'pendientes' ? 'No hay comprobantes por revisar' : 'Sin pagos revisados'}</div>`
}

async function cargar() {
  try {
    const [pend, hist] = await Promise.all([
      obtenerPagosPendientes(),
      supabase.from('pagos_mensualidad')
        .select(`id, año, mes, monto_bs, estado, comprobante_url, comprobante_nombre,
          observacion_tutor, numero_transaccion, monto_declarado, nombre_pagador, created_at,
          estudiantes!inner ( carnet, usuarios!inner(nombre_completo), cursos(nombre_completo,nivel) ),
          tutores_familia ( usuarios!inner(nombre_completo,email) )`)
        .in('estado', ['aprobado', 'rechazado'])
        .not('comprobante_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    pendientes = pend
    historial = hist.data ?? []
  } catch (e) {
    console.error('[bandeja-comprobantes]', e)
    raiz.querySelector('.bc-grid').innerHTML = '<div class="bc-vacio">No se pudo cargar la bandeja</div>'
    return
  }
  pintar()
}

function abrirModal(pagoId, conAcciones) {
  const p = [...pendientes, ...historial].find(x => x.id === pagoId)
  if (!p) return
  pagoActual = p
  const m = document.getElementById('bc-modal')
  const set = (id, v) => { m.querySelector(`[data-c="${id}"]`).textContent = v }
  set('estudiante', p.estudiantes?.usuarios?.nombre_completo ?? '—')
  set('curso', p.estudiantes?.cursos?.nombre_completo ?? '—')
  set('mes', `${MESES_LABELS[p.mes] ?? p.mes} ${p.año}`)
  set('monto', `${Number(p.monto_bs).toFixed(2)} Bs`)
  set('tutor', quienPago(p))
  set('fecha', formatFechaHora(p.created_at))
  set('transaccion', p.numero_transaccion || '—')
  const res = resumenTransaccion(p)
  if (p.monto_declarado == null) set('declarado', '—')
  else {
    const d = Number(p.monto_declarado)
    const difiere = res && Math.abs(d - res.total) > 0.009
    set('declarado', res ? `${d.toFixed(2)} Bs (total de la transacción: ${res.total.toFixed(2)} Bs${difiere ? ', no coincide' : ''})` : `${d.toFixed(2)} Bs`)
  }
  const obs = m.querySelector('[data-c="obs-tutor"]')
  obs.parentElement.style.display = p.observacion_tutor ? 'block' : 'none'
  obs.textContent = p.observacion_tutor ?? ''

  const img = document.getElementById('bc-visor-img')
  const pdf = document.getElementById('bc-visor-pdf')
  img.style.display = 'none'; pdf.style.display = 'none'
  if (p.comprobante_url && esPdf(p)) { pdf.src = p.comprobante_url; pdf.style.display = 'block' }
  else if (p.comprobante_url) { img.src = p.comprobante_url; img.style.display = 'block' }

  document.getElementById('bc-obs').value = ''
  m.querySelector('[data-zona="revision"]').style.display = conAcciones ? 'block' : 'none'
  m.querySelector('.modal-footer').style.display = conAcciones ? 'flex' : 'none'
  m.classList.remove('hidden')
}

function cerrarModal() {
  document.getElementById('bc-modal').classList.add('hidden')
  document.getElementById('bc-visor-pdf').src = 'about:blank'
  pagoActual = null
}

async function decidir(accion) {
  if (!pagoActual) return
  const verbo = accion === 'aprobado' ? 'Aprobar' : 'Rechazar'
  const ok = await confirmar(`${verbo} pago`,
    `¿Deseas ${verbo.toLowerCase()} el pago de ${MESES_LABELS[pagoActual.mes]} de ${pagoActual.estudiantes?.usuarios?.nombre_completo}?`,
    verbo, 'Cancelar')
  if (!ok) return
  mostrarLoader('Procesando...')
  try {
    await revisarPago(pagoActual.id, accion, document.getElementById('bc-obs').value.trim())
    toast(`Pago ${accion === 'aprobado' ? 'aprobado' : 'rechazado'} correctamente`, accion === 'aprobado' ? 'success' : 'error')
    cerrarModal()
    await cargar()
  } catch (e) {
    toast(e.message ?? 'Error al procesar el pago', 'error')
  } finally {
    ocultarLoader()
  }
}

function montar(contenedor) {
  const estilo = document.createElement('style')
  estilo.textContent = ESTILOS
  document.head.appendChild(estilo)

  contenedor.innerHTML = `
    <div class="bc-tabs">
      <button type="button" class="bc-tab activo" data-tab="pendientes">Por revisar<span class="bc-cuenta" data-cuenta>0</span></button>
      <button type="button" class="bc-tab" data-tab="historial">Revisados</button>
      <button type="button" class="bc-tab" data-recargar title="Actualizar">Actualizar</button>
    </div>
    <div class="bc-grid"><div class="bc-vacio">Cargando...</div></div>`

  const modal = document.createElement('div')
  modal.className = 'modal-overlay hidden'
  modal.id = 'bc-modal'
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header"><h2>Comprobante de pago</h2><button class="btn-close-modal" data-cerrar aria-label="Cerrar">×</button></div>
      <div class="modal-body">
        <div class="bc-info">
          <div><span>Estudiante</span><div style="font-weight:600;" data-c="estudiante"></div></div>
          <div><span>Curso</span><div data-c="curso"></div></div>
          <div><span>Mes / Año</span><div data-c="mes"></div></div>
          <div><span>Monto</span><div style="font-weight:600;color:#10b981;" data-c="monto"></div></div>
          <div><span>Tutor</span><div data-c="tutor"></div></div>
          <div><span>Fecha de envío</span><div data-c="fecha"></div></div>
          <div><span>N.º transacción</span><div data-c="transaccion"></div></div>
          <div><span>Monto declarado</span><div data-c="declarado"></div></div>
        </div>
        <div style="display:none;margin-bottom:16px;padding:12px;background:var(--color-bg);border-radius:10px;font-size:.875rem;">
          <span style="color:var(--color-text-secondary);font-size:.78rem;">Nota del tutor:</span>
          <p data-c="obs-tutor" style="margin:4px 0 0;"></p>
        </div>
        <div style="margin-bottom:16px;text-align:center;">
          <img id="bc-visor-img" alt="Comprobante" style="display:none;">
          <iframe id="bc-visor-pdf" title="Comprobante" style="display:none;"></iframe>
        </div>
        <div class="form-group" data-zona="revision">
          <label for="bc-obs">Observación (opcional)</label>
          <textarea id="bc-obs" rows="2" placeholder="Agregar nota al aprobar o rechazar..." style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-cerrar>Cancelar</button>
        <button class="btn btn-danger" data-decidir="rechazado">Rechazar</button>
        <button class="btn btn-success" data-decidir="aprobado">Aprobar</button>
      </div>
    </div>`
  document.body.appendChild(modal)

  contenedor.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]')
    if (tab) { pestana = tab.dataset.tab; pintar(); return }
    if (e.target.closest('[data-recargar]')) { cargar(); return }
    const rev = e.target.closest('[data-revisar]')
    if (rev) { abrirModal(rev.dataset.revisar, true); return }
    const ver = e.target.closest('[data-ver]')
    if (ver) abrirModal(ver.dataset.ver, pestana === 'pendientes')
  })
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-cerrar]')) { cerrarModal(); return }
    const d = e.target.closest('[data-decidir]')
    if (d) decidir(d.dataset.decidir)
  })
}

/** Monta (la primera vez) y recarga la bandeja dentro del contenedor indicado */
export async function initBandejaComprobantes(contenedor) {
  if (!contenedor) return
  const finanzas = window.APP_CONFIG?.plan === 'avanzado' && window.APP_CONFIG?.finanzas_habilitado === true
  if (!finanzas) { contenedor.closest('.card')?.style.setProperty('display', 'none'); return }
  if (!montado) { raiz = contenedor; montar(contenedor); montado = true }
  await cargar()
}
