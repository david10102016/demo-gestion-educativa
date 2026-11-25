// js/licencias/bandeja-licencias.js
// Centralizador de licencias para el director y para la secretaria/regente con permiso.
// Se inicia solo al cargarse en dashboard-director.html o dashboard-secretaria.html. Necesita en la página:
//   <button class="nav-item hidden" data-section="licencias" id="nav-licencias">…</button>
//   <section id="section-licencias" class="section-content hidden"><div id="licencias-cont"></div></section>
// Pestañas: Solicitudes (licencias.aprobar) · Verificar tutores (vinculos.revisar) · Permisos (solo director).
// No modifica director.js ni la navegación existente: escucha el clic del botón del menú.
import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml as esc } from '../utils/sanitize.js'
import {
  MOTIVOS, ESTADOS, PARENTESCOS, RECHAZO_LICENCIA, RECHAZO_VINCULO, LIMITES,
  rangoTexto, fechaCorta, urlFirmada, tengoPermiso,
  resolverLicencia, revisarVinculacion, nombresUsuarios, cursosDeEstudiantes,
} from './licencias-api.js'
import { montarPermisos } from './permisos.js'

const ctx = { rol: null, colegioId: null, puedeLic: false, puedeVinc: false, tab: null, filtro: 'pendiente', colegio: '' }

// ───────────────────── Arranque ─────────────────────
async function iniciar() {
  const nav = document.getElementById('nav-licencias')
  const cont = document.getElementById('licencias-cont')
  if (!nav || !cont) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data: perfil } = await supabase.from('usuarios').select('rol, colegio_id').eq('id', user.id).single()
  if (!perfil) return
  ctx.rol = perfil.rol; ctx.colegioId = perfil.colegio_id
  ;[ctx.puedeLic, ctx.puedeVinc] = await Promise.all([tengoPermiso('licencias.aprobar'), tengoPermiso('vinculos.revisar')])
  if (!ctx.puedeLic && !ctx.puedeVinc && ctx.rol !== 'director') return   // sin permisos: el menú queda oculto

  nav.classList.remove('hidden')
  nav.addEventListener('click', () => {
    setTimeout(() => { const t = document.getElementById('topbar-title'); if (t) t.textContent = 'Licencias' }, 0)
    montar(cont)
  })
  const { data: col } = await supabase.from('colegios').select('nombre').eq('id', ctx.colegioId).maybeSingle()
  ctx.colegio = col?.nombre ?? ''
  await actualizarAvisos()
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar)
else iniciar()

/** Número en el menú y aviso en Inicio del director */
async function actualizarAvisos() {
  const [rl, rv] = await Promise.all([
    ctx.puedeLic ? supabase.from('licencias').select('id', { count: 'exact', head: true }).eq('colegio_id', ctx.colegioId).eq('estado', 'pendiente') : { count: 0 },
    ctx.puedeVinc ? supabase.from('tutor_verificacion').select('tutor_id', { count: 'exact', head: true }).eq('estado', 'pendiente') : { count: 0 },
  ])
  const nl = rl.count ?? 0, nv = rv.count ?? 0, total = nl + nv
  const nav = document.getElementById('nav-licencias')
  if (nav) {
    nav.querySelector('.lic-badge')?.remove()
    if (total) nav.insertAdjacentHTML('beforeend', `<span class="lic-badge" style="margin-left:auto;background:#ef4444;color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:1px 8px;">${total}</span>`)
  }
  const inicio = document.getElementById('section-inicio')
  document.getElementById('aviso-licencias-inicio')?.remove()
  if (inicio && total) {
    const partes = []
    if (nl) partes.push(`<b>${nl}</b> licencia${nl !== 1 ? 's' : ''} por resolver`)
    if (nv) partes.push(`<b>${nv}</b> tutor${nv !== 1 ? 'es' : ''} por verificar`)
    inicio.insertAdjacentHTML('afterbegin', `
      <div id="aviso-licencias-inicio" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--color-warning-bg);color:#92400e;border-radius:12px;padding:12px 16px;margin-bottom:16px;">
        <span>📋 Tienes ${partes.join(' y ')}.</span>
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('nav-licencias').click()">Revisar</button>
      </div>`)
  }
}

// ───────────────────── Pestañas ─────────────────────
function montar(cont) {
  const tabs = []
  if (ctx.puedeLic) tabs.push(['solicitudes', 'Solicitudes'])
  if (ctx.puedeVinc) tabs.push(['vinculaciones', 'Verificar tutores'])
  if (ctx.rol === 'director') tabs.push(['permisos', 'Permisos'])
  if (!tabs.find(t => t[0] === ctx.tab)) ctx.tab = tabs[0]?.[0]
  cont.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      ${tabs.map(([k, t]) => `<button class="btn ${ctx.tab === k ? 'btn-primary' : 'btn-secondary'}" data-tab="${k}">${t}</button>`).join('')}
    </div>
    <div id="lic-tab-cont"></div>`
  cont.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ctx.tab = b.dataset.tab; montar(cont) })
  const box = cont.querySelector('#lic-tab-cont')
  if (ctx.tab === 'solicitudes') pintarSolicitudes(box)
  else if (ctx.tab === 'vinculaciones') pintarVinculaciones(box)
  else if (ctx.tab === 'permisos') montarPermisos(box, ctx.colegioId)
}

// ───────────────────── Modal simple ─────────────────────
function modal(titulo, cuerpo, pie) {
  document.getElementById('modal-lic-dir')?.remove()
  const m = document.createElement('div')
  m.id = 'modal-lic-dir'; m.className = 'modal-overlay'
  m.innerHTML = `<div class="modal-box" style="max-width:560px;width:100%;">
    <div class="modal-header"><h2>${titulo}</h2><button class="btn-close-modal" data-cerrar>&times;</button></div>
    <div class="modal-body">${cuerpo}</div><div class="modal-footer">${pie}</div></div>`
  document.body.appendChild(m)
  m.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => m.remove())
  return m
}
/** Pide motivo (lista) + nota opcional. Devuelve {motivo, nota} o null */
function pedirRespuesta(titulo, motivos, conMotivo = true) {
  return new Promise(resolve => {
    const m = modal(titulo, `
      ${conMotivo ? `<div class="form-group"><label style="font-weight:600;">Motivo *</label>
        <select id="resp-motivo" style="width:100%;"><option value="">Selecciona…</option>
        ${Object.entries(motivos).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>` : ''}
      <div class="form-group"><label style="font-weight:600;">Nota (opcional)</label>
        <textarea id="resp-nota" rows="2" maxlength="${LIMITES.nota}" style="width:100%;" placeholder="Visible para el tutor"></textarea></div>`,
      `<button class="btn btn-secondary" data-cerrar>Cancelar</button><button class="btn btn-primary" id="resp-ok">Confirmar</button>`)
    let hecho = false
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!hecho) resolve(null) } })
    obs.observe(document.body, { childList: true })
    m.querySelector('#resp-ok').onclick = () => {
      const motivo = conMotivo ? m.querySelector('#resp-motivo').value : null
      if (conMotivo && !motivo) return toast('Elige un motivo', 'warning')
      hecho = true; const nota = m.querySelector('#resp-nota').value.trim() || null
      m.remove(); resolve({ motivo, nota })
    }
  })
}

// ───────────────────── Solicitudes ─────────────────────
async function pintarSolicitudes(box) {
  box.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
      <select id="lic-filtro">
        ${['pendiente', 'aprobada', 'rechazada', 'cancelada', 'todas'].map(k => `<option value="${k}" ${ctx.filtro === k ? 'selected' : ''}>${k === 'todas' ? 'Todas' : ESTADOS[k].txt + 's'}</option>`).join('')}
      </select>
      <input type="text" id="lic-buscar" placeholder="Buscar estudiante…" style="flex:1;min-width:180px;">
    </div>
    <div id="lic-lista"><p style="color:var(--color-text-secondary);">Cargando…</p></div>`
  box.querySelector('#lic-filtro').onchange = e => { ctx.filtro = e.target.value; pintarSolicitudes(box) }

  let q = supabase.from('licencias').select('*').eq('colegio_id', ctx.colegioId).order('created_at', { ascending: false }).limit(300)
  if (ctx.filtro !== 'todas') q = q.eq('estado', ctx.filtro)
  const { data, error } = await q
  const lista = box.querySelector('#lic-lista')
  if (error) { lista.innerHTML = `<div class="card">${esc(error.message)}</div>`; return }
  const filas = data ?? []
  if (!filas.length) { lista.innerHTML = `<div class="card" style="text-align:center;color:var(--color-text-secondary);">No hay solicitudes en este estado.</div>`; return }

  const [nombres, cursos, parent, verif] = await Promise.all([
    nombresUsuarios(filas.flatMap(l => [l.estudiante_id, l.tutor_id, l.resuelto_por])),
    cursosDeEstudiantes(filas.map(l => l.estudiante_id)),
    supabase.from('tutor_estudiante').select('tutor_id, estudiante_id, parentesco').in('tutor_id', [...new Set(filas.map(l => l.tutor_id))]),
    ctx.puedeVinc ? supabase.from('tutor_verificacion').select('tutor_id, estado').in('tutor_id', [...new Set(filas.map(l => l.tutor_id))]) : { data: [] },
  ])
  const parentesco = (t, e) => (parent.data ?? []).find(p => p.tutor_id === t && p.estudiante_id === e)?.parentesco
  const sinRevisar = t => (verif.data ?? []).find(v => v.tutor_id === t)?.estado === 'pendiente'

  const render = (filtroTxt = '') => {
    const f = filtroTxt.toLowerCase()
    lista.innerHTML = filas.filter(l => !f || (nombres[l.estudiante_id] ?? '').toLowerCase().includes(f)).map(l => {
      const st = ESTADOS[l.estado]
      const par = parentesco(l.tutor_id, l.estudiante_id)
      return `<div class="card" style="margin-bottom:10px;padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div><div style="font-weight:700;">${esc(nombres[l.estudiante_id] ?? 'Estudiante')}</div>
            <div style="font-size:0.8rem;color:var(--color-text-secondary);">${esc(cursos[l.estudiante_id] ?? '')}</div></div>
          <span class="badge ${st.badge}" style="align-self:flex-start;">${st.txt}</span>
        </div>
        <div style="font-size:0.88rem;margin-top:6px;"><b>${MOTIVOS[l.motivo]}</b> · ${rangoTexto(l.fecha_inicio, l.fecha_fin)}</div>
        <div style="font-size:0.85rem;margin-top:4px;">${esc(l.descripcion)}</div>
        <div style="font-size:0.78rem;color:var(--color-text-3);margin-top:6px;">
          Solicitó: ${esc(nombres[l.tutor_id] ?? 'Tutor')}${par ? ' (' + esc(PARENTESCOS[par] ?? par) + ')' : ''} · ${fechaCorta(l.created_at.slice(0, 10))}
          ${sinRevisar(l.tutor_id) ? ' · <span class="badge badge-warning">⚠️ Vínculo sin revisar</span>' : ''}
        </div>
        ${l.estado === 'rechazada' ? `<div style="font-size:0.8rem;margin-top:6px;color:#991b1b;">Rechazada: ${esc(RECHAZO_LICENCIA[l.motivo_respuesta] ?? '')}${l.nota_respuesta ? ' — ' + esc(l.nota_respuesta) : ''}</div>` : ''}
        ${l.estado === 'aprobada' && l.nota_respuesta ? `<div style="font-size:0.8rem;margin-top:6px;">Nota: ${esc(l.nota_respuesta)}</div>` : ''}
        ${l.resuelto_por ? `<div style="font-size:0.75rem;color:var(--color-text-3);margin-top:4px;">Resuelta por ${esc(nombres[l.resuelto_por] ?? '')}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          ${l.comprobante ? `<button class="btn btn-sm btn-secondary" data-ver="${l.id}">📎 Ver comprobante</button>` : '<span style="font-size:0.78rem;color:var(--color-text-3);align-self:center;">Sin comprobante</span>'}
          ${l.estado === 'pendiente' ? `<button class="btn btn-sm btn-primary" data-aprobar="${l.id}">✓ Aprobar</button>
             <button class="btn btn-sm" style="background:#ef4444;color:#fff;" data-rechazar="${l.id}">✕ Rechazar</button>` : ''}
          ${l.estado === 'aprobada' ? `<button class="btn btn-sm btn-secondary" data-imprimir="${l.id}">🖨 Imprimir</button>` : ''}
        </div>
      </div>`
    }).join('') || `<div class="card" style="text-align:center;color:var(--color-text-secondary);">Sin coincidencias.</div>`

    const porId = id => filas.find(x => x.id === id)
    lista.querySelectorAll('[data-ver]').forEach(b => b.onclick = async () => {
      const url = await urlFirmada(porId(b.dataset.ver).comprobante)
      url ? verImagen('Comprobante', [url]) : toast('No se pudo abrir el comprobante', 'error')
    })
    lista.querySelectorAll('[data-aprobar]').forEach(b => b.onclick = async () => {
      const r = await pedirRespuesta('Aprobar licencia', null, false); if (!r) return
      await accion(() => resolverLicencia(b.dataset.aprobar, true, null, r.nota), 'Licencia aprobada', box)
    })
    lista.querySelectorAll('[data-rechazar]').forEach(b => b.onclick = async () => {
      const r = await pedirRespuesta('Rechazar licencia', RECHAZO_LICENCIA); if (!r) return
      await accion(() => resolverLicencia(b.dataset.rechazar, false, r.motivo, r.nota), 'Licencia rechazada', box)
    })
    lista.querySelectorAll('[data-imprimir]').forEach(b => b.onclick = () => {
      const l = porId(b.dataset.imprimir)
      imprimir(l, nombres, cursos[l.estudiante_id], PARENTESCOS[parentesco(l.tutor_id, l.estudiante_id)] ?? '')
    })
  }
  render()
  box.querySelector('#lic-buscar').oninput = e => render(e.target.value)
}

async function accion(fn, ok, box) {
  mostrarLoader('Guardando…')
  try { await fn(); toast(ok, 'success'); await actualizarAvisos(); ctx.tab === 'vinculaciones' ? pintarVinculaciones(box) : pintarSolicitudes(box) }
  catch (e) { toast(e.message, 'error') }
  finally { ocultarLoader() }
}

function verImagen(titulo, urls) {
  modal(titulo, urls.map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" style="width:100%;border-radius:10px;margin-bottom:10px;border:1px solid var(--color-border);"></a>`).join('')
    + '<small style="color:var(--color-text-3);">Toca la imagen para abrirla en tamaño completo. El enlace vence en 5 minutos.</small>',
    '<button class="btn btn-secondary" data-cerrar>Cerrar</button>')
}

function imprimir(l, nombres, curso, parentesco) {
  const w = window.open('', '_blank')
  if (!w) return toast('Permite las ventanas emergentes para imprimir', 'warning')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Licencia</title>
    <style>body{font-family:Arial,sans-serif;max-width:680px;margin:30px auto;color:#111}h1{font-size:20px;text-align:center;margin:0}
    h2{font-size:15px;text-align:center;margin:4px 0 24px;font-weight:normal}td{padding:8px 6px;border-bottom:1px solid #ddd;vertical-align:top}
    td:first-child{font-weight:bold;width:180px}.f{display:flex;justify-content:space-between;margin-top:70px}.f div{border-top:1px solid #000;width:40%;text-align:center;padding-top:6px;font-size:13px}</style></head>
    <body><h1>${esc(ctx.colegio.toUpperCase())}</h1><h2>LICENCIA DE ESTUDIANTE</h2><table>
    <tr><td>Estudiante</td><td>${esc(nombres[l.estudiante_id] ?? '')}</td></tr>
    <tr><td>Curso</td><td>${esc(curso ?? '')}</td></tr>
    <tr><td>Motivo</td><td>${esc((MOTIVOS[l.motivo] ?? '').replace(/^\S+\s/, ''))}</td></tr>
    <tr><td>Fechas</td><td>${rangoTexto(l.fecha_inicio, l.fecha_fin)}</td></tr>
    <tr><td>Descripción</td><td>${esc(l.descripcion)}</td></tr>
    <tr><td>Solicitado por</td><td>${esc(nombres[l.tutor_id] ?? '')}${parentesco ? ' (' + esc(parentesco) + ')' : ''}</td></tr>
    <tr><td>Aprobado por</td><td>${esc(nombres[l.resuelto_por] ?? '')} · ${l.resuelto_en ? new Date(l.resuelto_en).toLocaleString('es-BO') : ''}</td></tr>
    ${l.nota_respuesta ? `<tr><td>Nota</td><td>${esc(l.nota_respuesta)}</td></tr>` : ''}
    </table><div class="f"><div>Dirección</div><div>Sello</div></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`)
  w.document.close()
}

// ───────────────────── Vinculaciones ─────────────────────
async function pintarVinculaciones(box) {
  box.innerHTML = `<p style="color:var(--color-text-secondary);">Cargando…</p>`
  const { data, error } = await supabase.from('tutor_verificacion').select('*').eq('estado', 'pendiente').order('created_at', { ascending: true })
  if (error) { box.innerHTML = `<div class="card">${esc(error.message)}</div>`; return }
  const filas = data ?? []
  if (!filas.length) { box.innerHTML = `<div class="card" style="text-align:center;color:var(--color-text-secondary);">✓ No hay tutores por verificar.</div>`; return }

  const tutorIds = filas.map(v => v.tutor_id)
  const { data: vinc } = await supabase.from('tutor_estudiante').select('tutor_id, estudiante_id, parentesco, activo').in('tutor_id', tutorIds)
  const [nombres, cursos] = await Promise.all([
    nombresUsuarios([...tutorIds, ...(vinc ?? []).map(x => x.estudiante_id)]),
    cursosDeEstudiantes((vinc ?? []).map(x => x.estudiante_id)),
  ])

  box.innerHTML = `<p style="font-size:0.85rem;color:var(--color-text-secondary);margin:0 0 12px;">
      Padres y apoderados que se vincularon a un estudiante. Verifica que sean quienes dicen ser:<br>
      <b>1.</b> Toca <b>Ver carnet</b> (anverso y reverso).<br>
      <b>2.</b> Comprueba que sea el padre, la madre o el responsable del estudiante.<br>
      <b>3.</b> Toca <b>Revisado</b>. Por privacidad, las fotos del carnet se eliminan y queda registrado quién lo verificó.<br>
      Si no corresponde, toca <b>Rechazar</b>: su vínculo se desactiva y deberá acercarse al colegio.</p>` +
    filas.map(v => {
      const hijos = (vinc ?? []).filter(x => x.tutor_id === v.tutor_id)
      return `<div class="card" style="margin-bottom:10px;padding:14px 16px;">
        <div style="font-weight:700;">${esc(nombres[v.tutor_id] ?? 'Tutor')} <span class="badge badge-info">${esc(PARENTESCOS[v.parentesco] ?? v.parentesco)}</span></div>
        <div style="font-size:0.8rem;color:var(--color-text-3);">Registrado el ${fechaCorta(v.created_at.slice(0, 10))}</div>
        <div style="font-size:0.85rem;margin-top:6px;">${hijos.length
          ? hijos.map(h => `👦 ${esc(nombres[h.estudiante_id] ?? '')} · ${esc(cursos[h.estudiante_id] ?? '')}${h.activo ? '' : ' (inactivo)'}`).join('<br>')
          : '<i>Aún sin hijos vinculados</i>'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn btn-sm btn-secondary" data-carnet="${v.tutor_id}">🪪 Ver carnet</button>
          <button class="btn btn-sm btn-primary" data-ok="${v.tutor_id}">✓ Revisado</button>
          <button class="btn btn-sm" style="background:#ef4444;color:#fff;" data-no="${v.tutor_id}">✕ Rechazar</button>
        </div></div>`
    }).join('')

  const porId = id => filas.find(v => v.tutor_id === id)
  box.querySelectorAll('[data-carnet]').forEach(b => b.onclick = async () => {
    const v = porId(b.dataset.carnet)
    const urls = (await Promise.all([urlFirmada(v.ci_anverso), urlFirmada(v.ci_reverso)])).filter(Boolean)
    urls.length ? verImagen('Carnet del tutor', urls) : toast('No se pudo abrir el carnet', 'error')
  })
  box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Marcar como revisado', '¿Verificaste que el carnet corresponde al padre, madre o responsable del estudiante? Las fotos se eliminarán y no podrás volver a verlas.', 'Sí, revisado', 'Cancelar')) return
    await accion(() => revisarVinculacion(b.dataset.ok, true), 'Tutor verificado', box)
  })
  box.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
    const r = await pedirRespuesta('Rechazar vinculación', RECHAZO_VINCULO); if (!r) return
    if (!await confirmar('Rechazar', 'Se desactivarán los vínculos de este tutor con sus hijos en el colegio. Deberá acercarse a dirección.', 'Rechazar', 'Cancelar')) return
    await accion(() => revisarVinculacion(b.dataset.no, false, r.motivo, r.nota), 'Vinculación rechazada', box)
  })
}