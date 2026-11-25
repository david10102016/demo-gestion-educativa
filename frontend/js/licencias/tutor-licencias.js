// js/licencias/tutor-licencias.js
// Panel del tutor: registro del carnet (una sola vez) y pestaña Licencias.
// Se engancha desde dashboard-tutor.html:
//   asegurarCarnet()                  → antes de vincular un hijo (devuelve el parentesco o null)
//   montarEstadoCarnet(contenedor)    → recuadro de estado del carnet en "Vincular hijo"
//   montarLicenciasTutor(contenedor, hijos) → pestaña Licencias
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml as esc } from '../utils/sanitize.js'
import {
  MOTIVOS, ESTADOS, PARENTESCOS, RECHAZO_LICENCIA, RECHAZO_VINCULO, LIMITES,
  hoyBolivia, rangoTexto, fechaCorta, textoOfensivo,
  comprimirImagen, subirArchivo, borrarArchivos,
  miVerificacion, registrarCarnet, misLicencias, solicitarLicencia, cancelarLicencia,
} from './licencias-api.js'

// ───────────────────── Modal genérico ─────────────────────
function abrirModal(id, titulo, cuerpo, pie) {
  document.getElementById(id)?.remove()
  const m = document.createElement('div')
  m.id = id
  m.className = 'modal-overlay'
  m.innerHTML = `
    <div class="modal-box" style="max-width:520px;width:100%;">
      <div class="modal-header"><h2>${titulo}</h2>
        <button class="btn-close-modal" data-cerrar>&times;</button></div>
      <div class="modal-body">${cuerpo}</div>
      <div class="modal-footer">${pie}</div>
    </div>`
  document.body.appendChild(m)
  m.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', () => m.remove()))
  return m
}

/** Campo de foto: cámara o galería (en el celular el sistema ofrece las dos opciones) con vista previa */
function campoFoto(id, etiqueta) {
  return `
    <div class="form-group">
      <label style="font-weight:600;">${etiqueta}</label>
      <label for="${id}" style="display:flex;align-items:center;gap:12px;border:2px dashed var(--color-border);border-radius:12px;padding:12px;cursor:pointer;">
        <img id="${id}-prev" alt="" style="width:84px;height:60px;object-fit:cover;border-radius:8px;background:var(--color-surface-2);display:none;">
        <span id="${id}-txt" style="font-size:0.85rem;color:var(--color-text-secondary);">📷 Tomar foto o elegir de la galería</span>
      </label>
      <input type="file" id="${id}" accept="image/*" style="display:none;">
    </div>`
}
function enlazarFoto(modal, id) {
  const input = modal.querySelector('#' + id)
  input.addEventListener('change', () => {
    const f = input.files?.[0]
    const prev = modal.querySelector('#' + id + '-prev'), txt = modal.querySelector('#' + id + '-txt')
    if (!f) { prev.style.display = 'none'; txt.textContent = '📷 Tomar foto o elegir de la galería'; return }
    if (!/^image\//.test(f.type)) { toast('Elige una foto (imagen)', 'warning'); input.value = ''; return }
    prev.src = URL.createObjectURL(f); prev.style.display = 'block'; txt.textContent = '✓ Foto lista · tocar para cambiar'
  })
  return () => input.files?.[0] ?? null
}

// ───────────────────── Carnet del tutor ─────────────────────
/**
 * Garantiza que el tutor registró su carnet. Si ya lo hizo devuelve su parentesco;
 * si no, abre el formulario (2 fotos + parentesco). Devuelve null si cancela.
 */
export async function asegurarCarnet() {
  const v = await miVerificacion()
  if (v && v.estado !== 'rechazado') return v.parentesco
  return await formularioCarnet(v)
}

function formularioCarnet(previa) {
  return new Promise(resolve => {
    const aviso = previa?.estado === 'rechazado'
      ? `<div style="background:var(--color-error-bg);color:#991b1b;padding:10px 12px;border-radius:10px;font-size:0.85rem;margin-bottom:14px;">
           Dirección observó tu registro: <b>${esc(RECHAZO_VINCULO[previa.motivo_rechazo] ?? 'observado')}</b>${previa.nota ? ' — ' + esc(previa.nota) : ''}.
           Vuelve a registrar tu carnet.</div>` : ''
    const m = abrirModal('modal-carnet-tutor', 'Registra tu carnet de identidad', `
      ${aviso}
      <p style="font-size:0.875rem;color:var(--color-text-secondary);margin:0 0 14px;">
        Se pide <b>una sola vez</b> para confirmar que eres el padre, la madre o el adulto responsable del estudiante.
        🔒 Solo lo verá la dirección del colegio.
      </p>
      <div class="form-group">
        <label style="font-weight:600;">¿Qué eres del estudiante? *</label>
        <select id="carnet-parentesco" style="width:100%;">
          <option value="">Selecciona…</option>
          ${Object.entries(PARENTESCOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}
        </select>
      </div>
      ${campoFoto('carnet-anverso', 'Carnet · cara de adelante (anverso) *')}
      ${campoFoto('carnet-reverso', 'Carnet · cara de atrás (reverso) *')}
      <small style="color:var(--color-text-3);">La foto debe verse completa y legible. Se optimiza automáticamente.</small>`,
      `<button class="btn btn-secondary" data-cerrar>Cancelar</button>
       <button class="btn btn-primary" id="btn-guardar-carnet">Guardar y continuar</button>`)

    const anverso = enlazarFoto(m, 'carnet-anverso'), reverso = enlazarFoto(m, 'carnet-reverso')
    let listo = false
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!listo) resolve(null) } })
    obs.observe(document.body, { childList: true })

    m.querySelector('#btn-guardar-carnet').addEventListener('click', async () => {
      const parentesco = m.querySelector('#carnet-parentesco').value
      const fa = anverso(), fr = reverso()
      if (!parentesco) return toast('Indica qué eres del estudiante', 'warning')
      if (!fa || !fr) return toast('Adjunta las dos caras del carnet', 'warning')
      mostrarLoader('Guardando carnet…')
      let rutas = []
      try {
        const [ba, br] = await Promise.all([comprimirImagen(fa), comprimirImagen(fr)])
        rutas = [await subirArchivo(ba, 'carnet'), await subirArchivo(br, 'carnet')]
        await registrarCarnet(parentesco, rutas[0], rutas[1])
        listo = true
        toast('Carnet registrado', 'success')
        m.remove()
        resolve(parentesco)
      } catch (e) {
        await borrarArchivos(rutas).catch(() => {})
        toast(e.message, 'error')
      } finally { ocultarLoader() }
    })
  })
}

/** Recuadro con el estado del carnet (para la sección Vincular hijo) */
export async function montarEstadoCarnet(cont) {
  if (!cont) return
  const v = await miVerificacion()
  if (!v) {
    cont.innerHTML = `<div style="background:var(--color-info-bg);color:#1e40af;padding:12px 14px;border-radius:12px;font-size:0.85rem;margin-bottom:16px;">
      🪪 Para vincular a tu hijo primero registrarás <b>tu</b> carnet de identidad (anverso y reverso). Es una sola vez.</div>`
  } else if (v.estado === 'rechazado') {
    cont.innerHTML = `<div style="background:var(--color-error-bg);color:#991b1b;padding:12px 14px;border-radius:12px;font-size:0.85rem;margin-bottom:16px;">
      ⚠️ Dirección observó tu registro: <b>${esc(RECHAZO_VINCULO[v.motivo_rechazo] ?? 'observado')}</b>${v.nota ? ' — ' + esc(v.nota) : ''}.
      <button class="btn btn-sm btn-primary" style="margin-left:6px;" id="btn-recarnet">Registrar de nuevo</button></div>`
    cont.querySelector('#btn-recarnet').onclick = async () => { if (await asegurarCarnet()) montarEstadoCarnet(cont) }
  } else {
    cont.innerHTML = `<div style="background:var(--color-success-bg);color:#065f46;padding:10px 14px;border-radius:12px;font-size:0.85rem;margin-bottom:16px;">
      ✓ Carnet registrado como <b>${esc(PARENTESCOS[v.parentesco] ?? v.parentesco)}</b>${v.estado === 'revisado' ? ' · verificado por dirección' : ''}.</div>`
  }
}

// ───────────────────── Pestaña Licencias ─────────────────────
let _cont = null, _hijos = []

export async function montarLicenciasTutor(cont, hijos) {
  _cont = cont; _hijos = (hijos ?? []).filter(h => h.activo !== false)
  if (!cont) return
  if (!_hijos.length) {
    cont.innerHTML = `<div class="card" style="text-align:center;padding:30px;">Primero vincula a tu hijo en <b>Vincular hijo</b>.</div>`
    return
  }
  cont.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div class="card-title" style="margin:0;">Licencias</div>
          <div style="font-size:0.8rem;color:var(--color-text-secondary);">Solicita permiso cuando tu hijo no pueda asistir. La dirección lo revisa.</div>
        </div>
        <button class="btn btn-primary" id="btn-nueva-licencia">+ Solicitar licencia</button>
      </div>
    </div>
    <div id="lista-licencias-tutor"><p style="color:var(--color-text-secondary);">Cargando…</p></div>`
  cont.querySelector('#btn-nueva-licencia').onclick = nuevaLicencia
  await pintarLista()
}

async function pintarLista() {
  const box = _cont?.querySelector('#lista-licencias-tutor')
  if (!box) return
  try {
    const lista = await misLicencias()
    const nombre = id => _hijos.find(h => h.id === id)?.nombre ?? 'Estudiante'
    if (!lista.length) { box.innerHTML = `<div class="card" style="text-align:center;color:var(--color-text-secondary);">Aún no solicitaste licencias.</div>`; return }
    box.innerHTML = lista.map(l => {
      const st = ESTADOS[l.estado] ?? ESTADOS.pendiente
      const resp = l.estado === 'rechazada'
        ? `<div style="margin-top:8px;font-size:0.82rem;background:var(--color-error-bg);color:#991b1b;padding:8px 10px;border-radius:8px;">
             Motivo: <b>${esc(RECHAZO_LICENCIA[l.motivo_respuesta] ?? '')}</b>${l.nota_respuesta ? ' — ' + esc(l.nota_respuesta) : ''}</div>`
        : (l.nota_respuesta ? `<div style="margin-top:8px;font-size:0.82rem;color:var(--color-text-secondary);">Nota de dirección: ${esc(l.nota_respuesta)}</div>` : '')
      return `<div class="card" style="margin-bottom:10px;padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="font-weight:700;">${esc(nombre(l.estudiante_id))}</div>
          <span class="badge ${st.badge}">${st.txt}</span>
        </div>
        <div style="font-size:0.85rem;margin-top:4px;">${MOTIVOS[l.motivo] ?? l.motivo} · ${rangoTexto(l.fecha_inicio, l.fecha_fin)}</div>
        <div style="font-size:0.82rem;color:var(--color-text-secondary);margin-top:4px;">${esc(l.descripcion)}</div>
        ${resp}
        ${l.estado === 'pendiente' ? `<button class="btn btn-sm btn-secondary" style="margin-top:10px;" data-cancelar="${l.id}">Cancelar solicitud</button>` : ''}
      </div>`
    }).join('')
    box.querySelectorAll('[data-cancelar]').forEach(b => b.onclick = async () => {
      if (!await confirmar('Cancelar solicitud', '¿Deseas cancelar esta solicitud de licencia?', 'Sí, cancelar', 'No')) return
      try { await cancelarLicencia(b.dataset.cancelar); toast('Solicitud cancelada', 'info'); pintarLista() }
      catch (e) { toast(e.message, 'error') }
    })
  } catch (e) { box.innerHTML = `<div class="card" style="color:#991b1b;">${esc(e.message)}</div>` }
}

async function nuevaLicencia() {
  // Los tutores vinculados antes de esta función registran su carnet aquí, una sola vez
  if (!await asegurarCarnet()) return
  const hoy = hoyBolivia()
  const m = abrirModal('modal-nueva-licencia', 'Solicitar licencia', `
    <div class="form-group">
      <label style="font-weight:600;">Estudiante *</label>
      <select id="lic-hijo" style="width:100%;">
        ${_hijos.map(h => `<option value="${h.id}">${esc(h.nombre)} · ${esc(h.curso ?? '')}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label style="font-weight:600;">Motivo *</label>
      <select id="lic-motivo" style="width:100%;">
        ${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}
      </select>
      <small id="lic-ayuda" style="color:var(--color-text-3);"></small>
    </div>
    <div style="display:flex;gap:10px;">
      <div class="form-group" style="flex:1;"><label style="font-weight:600;">Desde *</label>
        <input type="date" id="lic-ini" min="${hoy}" value="${hoy}" style="width:100%;"></div>
      <div class="form-group" style="flex:1;"><label style="font-weight:600;">Hasta *</label>
        <input type="date" id="lic-fin" min="${hoy}" value="${hoy}" style="width:100%;"></div>
    </div>
    <div class="form-group">
      <label style="font-weight:600;">Describe el caso *</label>
      <textarea id="lic-desc" rows="3" maxlength="${LIMITES.descripcion}" style="width:100%;" placeholder="Ej.: Presenta fiebre alta, fue llevado al centro de salud."></textarea>
      <small id="lic-cont" style="color:var(--color-text-3);">0 / ${LIMITES.descripcion}</small>
    </div>
    ${campoFoto('lic-comp', 'Comprobante (receta, certificado, pasaje…)')}
    <small style="color:var(--color-text-3);">Máximo ${LIMITES.diasMax} días por licencia y ${LIMITES.porMes} por mes. No se aceptan días pasados.</small>`,
    `<button class="btn btn-secondary" data-cerrar>Cancelar</button>
     <button class="btn btn-primary" id="btn-enviar-licencia">Enviar solicitud</button>`)

  const comp = enlazarFoto(m, 'lic-comp')
  const $ = s => m.querySelector(s)
  const ayuda = () => {
    const emer = $('#lic-motivo').value === 'emergencia'
    $('#lic-ayuda').textContent = emer ? 'Emergencia: solo para hoy y con comprobante obligatorio.' : 'El comprobante es opcional para este motivo.'
    if (emer) { $('#lic-ini').value = hoy; $('#lic-fin').value = hoy }
    $('#lic-ini').disabled = $('#lic-fin').disabled = emer
  }
  $('#lic-motivo').addEventListener('change', ayuda); ayuda()
  $('#lic-ini').addEventListener('change', () => { if ($('#lic-fin').value < $('#lic-ini').value) $('#lic-fin').value = $('#lic-ini').value; $('#lic-fin').min = $('#lic-ini').value })
  $('#lic-desc').addEventListener('input', () => { $('#lic-cont').textContent = `${$('#lic-desc').value.length} / ${LIMITES.descripcion}` })

  $('#btn-enviar-licencia').addEventListener('click', async () => {
    const motivo = $('#lic-motivo').value, inicio = $('#lic-ini').value, fin = $('#lic-fin').value
    const descripcion = $('#lic-desc').value.trim(), archivo = comp()
    if (!inicio || !fin) return toast('Indica las fechas', 'warning')
    if (inicio < hoy) return toast('No se puede pedir licencia para días pasados', 'warning')
    const dias = (new Date(fin) - new Date(inicio)) / 86400000 + 1
    if (dias > LIMITES.diasMax) return toast(`Máximo ${LIMITES.diasMax} días por licencia`, 'warning')
    if (descripcion.length < 5) return toast('Describe brevemente el caso', 'warning')
    if (textoOfensivo(descripcion)) return toast('La descripción contiene palabras no permitidas', 'warning')
    if (motivo === 'emergencia' && !archivo) return toast('Para una emergencia adjunta un comprobante', 'warning')

    mostrarLoader('Enviando solicitud…')
    let ruta = null
    try {
      if (archivo) ruta = await subirArchivo(await comprimirImagen(archivo), 'licencias')
      await solicitarLicencia({ estudianteId: $('#lic-hijo').value, motivo, inicio, fin, descripcion, comprobante: ruta })
      toast('Solicitud enviada. La dirección la revisará.', 'success')
      m.remove()
      pintarLista()
    } catch (e) {
      if (ruta) await borrarArchivos([ruta]).catch(() => {})
      toast(e.message, 'error')
    } finally { ocultarLoader() }
  })
}

/** Aviso en Resumen cuando dirección rechazó el carnet (sus vínculos quedaron desactivados) */
export async function avisoRechazoTutor(cont) {
  if (!cont) return
  const v = await miVerificacion()
  if (v?.estado !== 'rechazado') return
  cont.insertAdjacentHTML('afterbegin', `
    <div style="background:var(--color-error-bg);color:#991b1b;padding:14px 16px;border-radius:12px;font-size:0.9rem;margin-bottom:16px;">
      ⚠️ <b>Dirección observó tu registro:</b> ${esc(RECHAZO_VINCULO[v.motivo_rechazo] ?? 'observado')}${v.nota ? ' — ' + esc(v.nota) : ''}.<br>
      Por eso tus hijos no aparecen. Acércate al colegio o vuelve a registrar tu carnet.
      <div style="margin-top:10px;"><button class="btn btn-sm btn-primary" onclick="navegarA('vincular')">Registrar carnet de nuevo</button></div>
    </div>`)
}

export { fechaCorta }
