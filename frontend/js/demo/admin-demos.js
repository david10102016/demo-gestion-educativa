// js/demo/admin-demos.js
// Panel del superadmin: cuentas de prueba (crear, ampliar vigencia, reiniciar, eliminar, limpiar vencidas).
// Solo se activa en el despliegue demo (VITE_MODO_DEMO=true).

import { supabase } from '../config/supabase-config.js'
import { MODO_DEMO } from './demo-config.js'
import { esc, ICONO_ENLACE } from './iconos-demo.js'
import { toast, confirmar, mostrarLoader, ocultarLoader } from '../utils/ui.js'

const SITIO = String(import.meta.env.VITE_SITE_URL ?? '').replace(/\/+$/, '') || window.location.origin
const DIAS_POR_DEFECTO = 14

const hoy = () => fechaISO(new Date())
function fechaISO(d) {
  const z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number)
  return fechaISO(new Date(a, m - 1, d + n))
}
function fechaCorta(v) {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d) ? '—' : d.toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const enlaceDe = slug => `${SITIO}/${slug}`

async function llamarAdmin(body) {
  const { data, error } = await supabase.functions.invoke('demo-admin', { body })
  if (error) {
    let msg = 'No se pudo completar la acción'
    try { msg = (await error.context?.json?.())?.error ?? msg } catch (_) {}
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const ETIQUETA_ESTADO = {
  vigente: '<span class="badge badge-success">Vigente</span>',
  vencido: '<span class="badge badge-error">Vencido</span>',
  no_iniciado: '<span class="badge badge-warning">Aún no inicia</span>',
}

function montarSeccion() {
  const nav = document.querySelector('.sidebar-nav')
  const contenido = document.querySelector('.page-content')
  if (!nav || !contenido) return false

  const btn = document.createElement('button')
  btn.className = 'nav-item'
  btn.dataset.section = 'demos'
  btn.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 14l2 2 4-4"/></svg>Cuentas de prueba`
  nav.appendChild(btn)
  btn.addEventListener('click', () => {
    document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'))
    document.querySelectorAll('.nav-item[data-section]').forEach(b => b.classList.remove('active'))
    document.getElementById('section-demos').classList.remove('hidden')
    btn.classList.add('active')
    document.getElementById('topbar-title').textContent = 'Cuentas de prueba'
    document.getElementById('sidebar')?.classList.remove('open')
    document.getElementById('sidebar-overlay')?.classList.remove('active')
    cargarDemos()
  })

  const sec = document.createElement('section')
  sec.id = 'section-demos'
  sec.className = 'section-content hidden'
  sec.innerHTML = `
    <div class="card" style="max-width:720px;margin-bottom:20px;">
      <div class="card-title">Nueva cuenta de prueba</div>
      <div class="card-body">
        <div class="grid-2">
          <div class="form-group" style="grid-column:1/-1;"><label>Nombre del colegio *</label>
            <input type="text" id="demo-nombre" maxlength="120" placeholder="Ej: U.E. San José"></div>
          <div class="form-group" style="grid-column:1/-1;"><label>Contacto (nombre y teléfono)</label>
            <input type="text" id="demo-contacto" maxlength="160" placeholder="Ej: Lic. Rosa Flores, 70000000"></div>
          <div class="form-group"><label>Desde *</label><input type="date" id="demo-desde"></div>
          <div class="form-group"><label>Hasta *</label><input type="date" id="demo-hasta"></div>
        </div>
        <small style="color:var(--color-text-secondary);display:block;margin-bottom:12px;">
          Se crean 10 estudiantes, 2 profesores, director, secretaría, regente y padre de familia con datos de ejemplo.
          El enlace se genera a partir del nombre. Tarda unos segundos.</small>
        <button class="btn btn-primary" id="demo-crear">Crear cuenta de prueba</button>
        <div id="demo-creado" style="display:none;margin-top:14px;padding:12px;border-radius:10px;background:var(--color-bg-2,#f1f5f9);"></div>
      </div>
    </div>
    <div class="card" style="padding:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;flex-wrap:wrap;">
        <div class="card-title" style="margin:0;">Cuentas creadas</div>
        <button class="btn btn-ghost btn-sm" id="demo-limpiar" title="Borra las pruebas vencidas hace más de 3 días">Limpiar vencidas</button>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Colegio</th><th>Vigencia</th><th>Estado</th><th>Último ingreso</th><th>Roles usados</th><th>Acciones</th></tr></thead>
          <tbody id="tabla-demos"><tr><td colspan="6" style="text-align:center;padding:28px;">Cargando...</td></tr></tbody>
        </table>
      </div>
    </div>
    <div class="modal-overlay hidden" id="modal-vigencia">
      <div class="modal-box" style="max-width:420px;">
        <div class="modal-header"><h2>Cambiar vigencia</h2></div>
        <div class="modal-body">
          <div id="vig-nombre" style="font-weight:600;margin-bottom:12px;"></div>
          <div class="grid-2">
            <div class="form-group"><label>Desde</label><input type="date" id="vig-desde"></div>
            <div class="form-group"><label>Hasta</label><input type="date" id="vig-hasta"></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-mas="7">+7 días</button>
            <button class="btn btn-ghost btn-sm" data-mas="14">+14 días</button>
            <button class="btn btn-ghost btn-sm" data-mas="30">+30 días</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="vig-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="vig-guardar">Guardar</button>
        </div>
      </div>
    </div>`
  contenido.appendChild(sec)

  document.getElementById('demo-desde').value = hoy()
  document.getElementById('demo-hasta').value = sumarDias(hoy(), DIAS_POR_DEFECTO - 1)
  document.getElementById('demo-crear').addEventListener('click', crearDemo)
  document.getElementById('demo-limpiar').addEventListener('click', limpiarVencidas)
  document.getElementById('tabla-demos').addEventListener('click', accionTabla)
  return true
}

async function crearDemo() {
  const nombre = document.getElementById('demo-nombre').value.trim()
  const contacto = document.getElementById('demo-contacto').value.trim()
  const desde = document.getElementById('demo-desde').value
  const hasta = document.getElementById('demo-hasta').value
  if (nombre.length < 3) return toast('Escribe el nombre del colegio', 'error')
  if (!desde || !hasta || hasta < desde) return toast('Revisa las fechas', 'error')

  const btn = document.getElementById('demo-crear')
  btn.disabled = true
  btn.textContent = 'Creando…'
  try {
    const r = await llamarAdmin({ accion: 'crear', nombre, contacto, desde, hasta })
    const enlace = enlaceDe(r.slug)
    const caja = document.getElementById('demo-creado')
    caja.style.display = 'block'
    caja.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">Cuenta creada</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <code style="word-break:break-all;">${esc(enlace)}</code>
        <button class="btn btn-ghost btn-sm" data-copiar="${esc(enlace)}">${ICONO_ENLACE} Copiar enlace</button>
      </div>`
    caja.querySelector('[data-copiar]').addEventListener('click', e => copiar(e.currentTarget.dataset.copiar))
    document.getElementById('demo-nombre').value = ''
    document.getElementById('demo-contacto').value = ''
    toast('Cuenta de prueba creada')
    cargarDemos()
  } catch (e) {
    toast(e.message, 'error', 5000)
  } finally {
    btn.disabled = false
    btn.textContent = 'Crear cuenta de prueba'
  }
}

async function cargarDemos() {
  const tbody = document.getElementById('tabla-demos')
  const { data, error } = await supabase.rpc('demo_listar')
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--color-danger,#b91c1c);">No se pudo cargar la lista</td></tr>`
    return
  }
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--color-text-secondary);">Aún no hay cuentas de prueba</td></tr>`
    return
  }
  tbody.innerHTML = data.map(d => {
    const enlace = enlaceDe(d.slug)
    return `<tr data-id="${esc(d.colegio_id)}" data-nombre="${esc(d.nombre)}" data-desde="${esc(d.desde)}" data-hasta="${esc(d.hasta)}">
      <td><div style="font-weight:600;">${esc(d.nombre)}</div>
          <div style="font-size:.8rem;color:var(--color-text-secondary);">${esc(enlace)}</div>
          ${d.contacto ? `<div style="font-size:.8rem;color:var(--color-text-secondary);">${esc(d.contacto)}</div>` : ''}</td>
      <td style="white-space:nowrap;">${esc(d.desde)}<br>${esc(d.hasta)}</td>
      <td>${ETIQUETA_ESTADO[d.estado] ?? esc(d.estado)}${d.estado === 'vigente' ? `<div style="font-size:.8rem;margin-top:3px;">${d.dias_restantes} días</div>` : ''}</td>
      <td style="font-size:.85rem;">${esc(fechaCorta(d.ultimo_ingreso))}</td>
      <td style="font-size:.85rem;">${(d.roles_usados ?? []).map(esc).join(', ') || '—'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" data-accion="copiar" data-enlace="${esc(enlace)}" title="Copiar enlace">${ICONO_ENLACE}</button>
        <button class="btn btn-ghost btn-sm" data-accion="vigencia">Vigencia</button>
        <button class="btn btn-ghost btn-sm" data-accion="reiniciar">Reiniciar</button>
        <button class="btn btn-ghost btn-sm" data-accion="eliminar" style="color:var(--color-danger,#b91c1c);">Eliminar</button>
      </td></tr>`
  }).join('')
}

async function accionTabla(e) {
  const btn = e.target.closest('button[data-accion]')
  if (!btn) return
  const fila = btn.closest('tr')
  const id = fila.dataset.id
  const nombre = fila.dataset.nombre
  const accion = btn.dataset.accion

  if (accion === 'copiar') return copiar(btn.dataset.enlace)
  if (accion === 'vigencia') return abrirVigencia(id, nombre, fila.dataset.desde, fila.dataset.hasta)

  if (accion === 'reiniciar') {
    if (!await confirmar('Reiniciar prueba', `Se borran todos los datos de "${nombre}" y se cargan de nuevo los de ejemplo. El enlace y la vigencia se mantienen.`, 'Reiniciar', 'Cancelar', 'peligro')) return
    await ejecutar(() => llamarAdmin({ accion: 'reiniciar', colegio_id: id }), 'Prueba reiniciada')
  }
  if (accion === 'eliminar') {
    if (!await confirmar('Eliminar prueba', `Se borra "${nombre}" con todos sus usuarios y archivos. No se puede deshacer.`, 'Eliminar', 'Cancelar', 'peligro')) return
    await ejecutar(() => llamarAdmin({ accion: 'eliminar', colegio_id: id }), 'Prueba eliminada')
  }
}

async function limpiarVencidas() {
  if (!await confirmar('Limpiar vencidas', 'Se borran las pruebas vencidas hace más de 3 días, con sus usuarios y archivos. No se puede deshacer.', 'Limpiar', 'Cancelar', 'peligro')) return
  await ejecutar(async () => {
    const r = await llamarAdmin({ accion: 'limpiar' })
    toast(r.borrados ? `Se borraron ${r.borrados} pruebas` : 'No había pruebas para borrar')
  })
}

async function ejecutar(fn, mensajeOk) {
  mostrarLoader?.()
  try {
    await fn()
    if (mensajeOk) toast(mensajeOk)
  } catch (e) {
    toast(e.message, 'error', 5000)
  } finally {
    ocultarLoader?.()
    cargarDemos()
  }
}

function abrirVigencia(id, nombre, desde, hasta) {
  const modal = document.getElementById('modal-vigencia')
  document.getElementById('vig-nombre').textContent = nombre
  const inDesde = document.getElementById('vig-desde')
  const inHasta = document.getElementById('vig-hasta')
  inDesde.value = desde
  inHasta.value = hasta
  modal.classList.remove('hidden')

  const cerrar = () => modal.classList.add('hidden')
  modal.querySelectorAll('[data-mas]').forEach(b => {
    b.onclick = () => {
      const base = inHasta.value && inHasta.value >= hoy() ? inHasta.value : hoy()
      inHasta.value = sumarDias(base, Number(b.dataset.mas))
    }
  })
  document.getElementById('vig-cancelar').onclick = cerrar
  document.getElementById('vig-guardar').onclick = async () => {
    if (!inDesde.value || !inHasta.value || inHasta.value < inDesde.value) return toast('Revisa las fechas', 'error')
    const { error } = await supabase.rpc('demo_cambiar_vigencia', { p_colegio: id, p_desde: inDesde.value, p_hasta: inHasta.value })
    if (error) return toast(error.message, 'error', 5000)
    cerrar()
    toast('Vigencia actualizada')
    cargarDemos()
  }
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto)
    toast('Enlace copiado')
  } catch (_) {
    window.prompt('Copia el enlace:', texto)
  }
}

if (MODO_DEMO) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarSeccion)
  else montarSeccion()
}

