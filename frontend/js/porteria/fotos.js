// js/porteria/fotos.js
// Modo FOTOS (095): regentes y director sacan la foto de cada estudiante con el celular.
//   · Curso → lista alfabética · pestañas "Sin foto" / "Todos" · contador "23 de 35 con foto"
//   · Tocar estudiante → cámara → vista previa recortada (proporción de la credencial) → Guardar / Otra foto
//   · Antes de guardar se consulta si ya tiene foto (otro regente pudo subirla) → compara y confirma
//   · Una sola foto por estudiante; la anterior queda guardada (el director puede restaurarla)
// Uso: montarFotos(contenedor, { colegioId, esDirector, onVolver })
import { supabase } from '../config/supabase-config.js'
import { toast, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import * as api from './porteria-api.js'

const ANCHO = 360, ALTO = 440          // 1,8 × 2,2 cm (proporción de la credencial)
const CALIDAD = 0.82                   // ~40–60 KB por foto

export async function montarFotos(cont, { colegioId, esDirector = false, onVolver = null }) {
  const st = { curso: '', pestana: 'sin', lista: [], urls: new Map(), actual: null }

  const { data: cursos } = await supabase.from('cursos').select('id, nombre_completo')
    .eq('colegio_id', colegioId).eq('activo', true).order('nombre_completo')

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
      <strong style="font-size:1.05rem;">📷 Fotos de estudiantes</strong>
      ${onVolver ? '<button class="btn btn-secondary btn-sm" id="fo-volver">← Volver</button>' : ''}
    </div>
    <p class="text-sm text-muted" style="margin:0 0 10px;">Buena luz y pared lisa detrás. La foto se recorta sola al tamaño de la credencial.</p>
    <select id="fo-curso" style="width:100%;margin-bottom:8px;"><option value="">Elija un curso</option>
      ${(cursos ?? []).map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('')}</select>
    <div id="fo-resumen" class="text-sm" style="margin-bottom:8px;"></div>
    <div id="fo-tabs" style="display:none;gap:6px;margin-bottom:8px;">
      <button class="btn btn-sm" data-tab="sin"></button><button class="btn btn-sm" data-tab="todos"></button>
    </div>
    <div id="fo-siguiente"></div>
    <div id="fo-lista"></div>
    <input type="file" id="fo-input" accept="image/*" capture="environment" style="display:none;">
    <input type="file" id="fo-galeria" accept="image/*" style="display:none;">
    <div class="modal-overlay hidden" id="fo-modal"><div class="modal-box" style="max-width:420px;" id="fo-modal-box"></div></div>`

  const $ = (id) => cont.querySelector('#' + id)
  if (onVolver) $('fo-volver').onclick = onVolver
  $('fo-curso').onchange = () => { st.curso = $('fo-curso').value; st.pestana = 'sin'; cargar() }
  cont.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.pestana = b.dataset.tab; pintar() })
  const alElegir = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && st.actual) procesarArchivo(f) }
  $('fo-input').onchange = alElegir
  $('fo-galeria').onchange = alElegir

  async function cargar() {
    $('fo-siguiente').innerHTML = ''
    if (!st.curso) { $('fo-lista').innerHTML = ''; $('fo-resumen').textContent = ''; $('fo-tabs').style.display = 'none'; return }
    $('fo-lista').innerHTML = '<div class="text-muted text-sm">Cargando...</div>'
    try {
      st.lista = await api.fotosCurso(st.curso) ?? []
      st.urls = await api.urlsFirmadas(st.lista.map(x => x.foto_path))
      pintar()
    } catch (e) { $('fo-lista').innerHTML = `<div style="color:#b91c1c;">${escapeHtml(e.message)}</div>` }
  }

  function pintar() {
    const con = st.lista.filter(x => x.foto_path).length
    const sin = st.lista.length - con
    $('fo-resumen').innerHTML = `<strong>${con} de ${st.lista.length}</strong> con foto`
    $('fo-tabs').style.display = 'flex'
    cont.querySelectorAll('[data-tab]').forEach(b => {
      b.textContent = b.dataset.tab === 'sin' ? `Sin foto (${sin})` : `Todos (${st.lista.length})`
      b.className = `btn btn-sm ${b.dataset.tab === st.pestana ? 'btn-primary' : 'btn-secondary'}`
    })
    const filas = st.pestana === 'sin' ? st.lista.filter(x => !x.foto_path) : st.lista
    if (!filas.length) {
      $('fo-lista').innerHTML = `<div class="empty-state"><div class="empty-state-title">${st.pestana === 'sin' ? '✔ Todo el curso tiene foto' : 'Curso sin estudiantes activos'}</div></div>`
      return
    }
    $('fo-lista').innerHTML = filas.map(x => `
      <div class="buscador-item" data-id="${x.estudiante_id}" style="display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--color-border);cursor:pointer;">
        ${miniatura(st.urls.get(x.foto_path), x.nombre_completo)}
        <div style="flex:1;"><div style="font-weight:600;">${escapeHtml(x.nombre_completo)}</div>
          <div class="text-sm text-muted">${x.foto_path ? `✔ Foto${x.subida_por ? ' · ' + escapeHtml(x.subida_por) : ''}` : 'Sin foto'}</div></div>
        ${esDirector && x.tiene_anterior ? `<button class="btn btn-secondary btn-sm" data-restaurar="${x.estudiante_id}">↺ Anterior</button>` : ''}
      </div>`).join('')
    $('fo-lista').querySelectorAll('[data-id]').forEach(el => el.onclick = (ev) => {
      if (ev.target.closest('[data-restaurar]')) return
      abrirCamara(st.lista.find(x => x.estudiante_id === el.dataset.id))
    })
    $('fo-lista').querySelectorAll('[data-restaurar]').forEach(b => b.onclick = () => restaurar(b.dataset.restaurar))
  }

  // Cámara (estudiante presente) o galería (foto que ya está en el celular)
  function abrirCamara(est) {
    st.actual = est
    modal(`
      <div class="modal-header"><h2>${escapeHtml(est.nombre_completo)}</h2></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-primary" id="fo-op-camara">📷 Tomar foto</button>
        <button class="btn btn-secondary" id="fo-op-galeria">🖼 Elegir de la galería</button>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" id="fo-op-cancelar">Cancelar</button></div>`)
    const box = $('fo-modal-box')
    // El click() va dentro del toque del usuario: así el navegador permite abrir cámara o galería
    box.querySelector('#fo-op-camara').onclick  = () => { st.origen = 'fo-input';   cerrarModal(); $('fo-input').click() }
    box.querySelector('#fo-op-galeria').onclick = () => { st.origen = 'fo-galeria'; cerrarModal(); $('fo-galeria').click() }
    box.querySelector('#fo-op-cancelar').onclick = () => { cerrarModal(); st.actual = null }
  }

  async function procesarArchivo(file) {
    let blob
    try { blob = await recortar(file) } catch { toast('No se pudo leer la foto', 'error'); return }
    const url = URL.createObjectURL(blob)
    const est = st.actual
    modal(`
      <div class="modal-header"><h2>Vista previa</h2></div>
      <div class="modal-body" style="text-align:center;">
        <img src="${url}" style="width:180px;height:220px;object-fit:cover;border-radius:10px;border:1px solid var(--color-border);">
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(est.nombre_completo)}</div>
        <div class="text-sm text-muted">¿Es este estudiante y la foto se ve bien?</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="fo-otra">↻ Otra foto</button>
        <button class="btn btn-primary" id="fo-guardar">✔ Guardar</button>
      </div>`)
    $('fo-modal-box').querySelector('#fo-otra').onclick = () => { cerrarModal(); URL.revokeObjectURL(url); $(st.origen ?? 'fo-input').click() }
    $('fo-modal-box').querySelector('#fo-guardar').onclick = async () => {
      cerrarModal()
      await guardar(est, blob, url)
    }
  }

  async function guardar(est, blob, urlNueva) {
    try {
      // Consulta fresca: otro regente pudo subirle foto hace un momento
      const estado = await api.estadoFoto(est.estudiante_id)
      if (estado?.tiene_foto && !(await confirmarReemplazo(est, estado, urlNueva))) { URL.revokeObjectURL(urlNueva); return }
      const path = await api.subirFoto(blob, colegioId, est.estudiante_id)
      let r = await api.guardarFoto(est.estudiante_id, path, !!estado?.tiene_foto)
      if (r && r.ok === false && r.requiere_confirmar) {          // carrera: alguien guardó justo ahora
        const e2 = await api.estadoFoto(est.estudiante_id)
        if (!(await confirmarReemplazo(est, e2, urlNueva))) { await api.borrarFotoSubida(path); return }
        r = await api.guardarFoto(est.estudiante_id, path, true)
      }
      toast(`Foto guardada: ${est.nombre_completo}`, 'success')
      URL.revokeObjectURL(urlNueva)
      const idx = st.lista.findIndex(x => x.estudiante_id === est.estudiante_id)
      st.lista = await api.fotosCurso(st.curso) ?? st.lista
      st.urls = await api.urlsFirmadas(st.lista.map(x => x.foto_path))
      pintar()
      ofrecerSiguiente(idx)
    } catch (e) { toast(e.message, 'error', 6000) }
  }

  // El navegador no deja abrir la cámara sola: se ofrece un botón grande con el siguiente sin foto
  function ofrecerSiguiente(desde) {
    const pendientes = st.lista.map((x, i) => ({ x, i })).filter(o => !o.x.foto_path)
    const sig = (pendientes.find(o => o.i > desde) ?? pendientes[0])?.x
    if (!sig) { $('fo-siguiente').innerHTML = '<div class="card text-sm" style="margin-bottom:8px;">✔ Curso completo</div>'; return }
    $('fo-siguiente').innerHTML = `<button class="btn btn-primary" style="width:100%;padding:14px;margin-bottom:8px;font-size:1rem;" id="fo-sig">📷 Siguiente: ${escapeHtml(sig.nombre_completo)}</button>`
    $('fo-siguiente').querySelector('#fo-sig').onclick = () => { $('fo-siguiente').innerHTML = ''; abrirCamara(sig) }
  }

  function confirmarReemplazo(est, estado, urlNueva) {
    return new Promise(async (ok) => {
      const urlActual = await api.urlFirmada(estado.foto_path)
      const cuando = estado.subida_at ? new Date(estado.subida_at).toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' }) : ''
      modal(`
        <div class="modal-header"><h2>Ya tiene foto</h2></div>
        <div class="modal-body">
          <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(est.nombre_completo)}</div>
          <div class="text-sm text-muted" style="margin-bottom:10px;">Subida${estado.subida_por ? ' por ' + escapeHtml(estado.subida_por) : ''}${cuando ? ' · ' + cuando : ''}</div>
          <div style="display:flex;gap:10px;justify-content:center;text-align:center;">
            <div><img src="${urlActual ?? ''}" style="width:120px;height:147px;object-fit:cover;border-radius:8px;background:#f1f5f9;"><div class="text-sm">Actual</div></div>
            <div><img src="${urlNueva}" style="width:120px;height:147px;object-fit:cover;border-radius:8px;"><div class="text-sm">Nueva</div></div>
          </div>
          <p class="text-sm text-muted" style="margin-top:10px;">La actual queda guardada y la dirección puede restaurarla.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="fo-no">Mantener actual</button>
          <button class="btn btn-primary" id="fo-si">Reemplazar</button>
        </div>`)
      $('fo-modal-box').querySelector('#fo-no').onclick = () => { cerrarModal(); ok(false) }
      $('fo-modal-box').querySelector('#fo-si').onclick = () => { cerrarModal(); ok(true) }
    })
  }

  async function restaurar(id) {
    const est = st.lista.find(x => x.estudiante_id === id)
    if (!await confirmar('Restaurar foto', `Se volverá a la foto anterior de ${est?.nombre_completo ?? 'este estudiante'}. ¿Continuar?`, 'Restaurar', 'Cancelar')) return
    try { await api.restaurarFoto(id); toast('Foto anterior restaurada', 'success'); cargar() }
    catch (e) { toast(e.message, 'error') }
  }

  function modal(html) { $('fo-modal-box').innerHTML = html; $('fo-modal').classList.remove('hidden') }
  function cerrarModal() { $('fo-modal').classList.add('hidden') }
}

function miniatura(url, nombre) {
  const ini = (nombre ?? '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
  return url
    ? `<img src="${escapeHtml(url)}" alt="" style="width:38px;height:46px;border-radius:6px;object-fit:cover;flex-shrink:0;">`
    : `<div style="width:38px;height:46px;border-radius:6px;background:var(--color-surface-2);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--color-text-3);flex-shrink:0;">${escapeHtml(ini)}</div>`
}

/** Recorta al centro en proporción 1,8:2,2 y reduce a 360×440 JPEG */
async function recortar(file) {
  const img = await new Promise((ok, mal) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file)
  })
  const r = ANCHO / ALTO
  let sw = img.naturalWidth, sh = img.naturalHeight
  if (sw / sh > r) sw = sh * r; else sh = sw / r
  const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2
  const c = document.createElement('canvas'); c.width = ANCHO; c.height = ALTO
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, ANCHO, ALTO)
  URL.revokeObjectURL(img.src)
  return await new Promise((ok, mal) => c.toBlob(b => b ? ok(b) : mal(new Error('sin imagen')), 'image/jpeg', CALIDAD))
}