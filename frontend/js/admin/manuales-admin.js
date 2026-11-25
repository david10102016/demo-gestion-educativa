// js/admin/manuales-admin.js — Editor de tutoriales y manuales (solo superadmin).
// Se conecta con UNA línea en dashboard-superadmin.html; no toca superadmin.js.
import '../../css/ayuda.css'
import '../../css/manuales-admin.css'
import { supabase } from '../config/supabase-config.js'
import { toast, confirmar } from '../utils/ui.js'
import { escapeHtml as e } from '../utils/sanitize.js'
import { htmlLista, htmlGuia, videosDe, abrirModalVideo, copiarBloque, ETIQUETAS_PANTALLAS, NOMBRE_ROL } from '../ayuda/ayuda-bloques.js'

const ROLES = ['director', 'profesor', 'estudiante', 'tutor', 'secretaria', 'regente']
const ROL_TXT = { director: 'Director', profesor: 'Profesor', estudiante: 'Estudiante', tutor: 'Tutor / Familia', secretaria: 'Secretaría', regente: 'Regente' }
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[^\s"'<>\\`]*)?$/
const MAX_BYTES = 262144

let sec = null, lista = [], vista = 'lista', filtro = '', f = null, cargado = false
let prev = { tab: 'lista', abierto: null, colegio: 'Colegio de ejemplo', color: '' }

const lineas = s => String(s ?? '').split('\n').map(x => x.trim()).filter(Boolean)
const bloques = s => String(s ?? '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)
const $ = (q, r = sec) => r.querySelector(q)

// ── Montaje ──────────────────────────────────────────────────────────────────
function montar() {
  const nav = document.querySelector('.sidebar-nav'), page = document.querySelector('.page-content')
  if (!nav || !page || document.getElementById('nav-manuales')) return
  nav.insertAdjacentHTML('beforeend', `<div class="sidebar-section-label">Contenido</div>
    <button class="nav-item" id="nav-manuales" type="button">
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      Tutoriales y manuales</button>`)
  page.insertAdjacentHTML('beforeend', '<section id="section-manuales" class="section-content hidden"><div class="mn"></div></section>')
  sec = document.getElementById('section-manuales')
  const btn = document.getElementById('nav-manuales')

  btn.addEventListener('click', async () => {
    document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'))
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); sec.classList.remove('hidden')
    const t = document.getElementById('topbar-title'); if (t) t.textContent = 'Tutoriales y manuales'
    document.getElementById('sidebar')?.classList.remove('open')
    document.getElementById('sidebar-overlay')?.classList.remove('active')
    if (!cargado) await cargar()
    else pintar()
  })
  // Al elegir otra opción del menú se desactiva la nuestra (la sección ya la oculta el script de la página)
  document.addEventListener('click', ev => {
    const b = ev.target.closest('.nav-item[data-section]')
    if (b) { btn.classList.remove('active'); sec.classList.add('hidden') }
  }, true)

  sec.addEventListener('click', clic)
  sec.addEventListener('input', entrada)
  sec.addEventListener('change', entrada)
}

async function cargar() {
  $('.mn').innerHTML = '<p class="mn-vacio">Cargando…</p>'
  const { data, error } = await supabase.from('tutoriales')
    .select('id,rol,titulo,aprenderas,secciones,videos,orden,publicado').order('rol').order('orden')
  if (error) { $('.mn').innerHTML = `<p class="mn-vacio">No se pudo cargar: ${e(error.message)}</p><button class="btn btn-primary" data-a="recargar">Reintentar</button>`; return }
  lista = data ?? []; cargado = true; vista = 'lista'; pintar()
}

function pintar() { $('.mn').innerHTML = vista === 'lista' ? htmlListado() : htmlForm() }

// ── Listado ──────────────────────────────────────────────────────────────────
function htmlListado() {
  const vis = lista.filter(t => !filtro || t.rol === filtro)
  return `<div class="mn-top">
      <select data-k="filtro" aria-label="Filtrar por rol"><option value="">Todos los roles</option>${ROLES.map(r => `<option value="${r}"${r === filtro ? ' selected' : ''}>${ROL_TXT[r]}</option>`).join('')}</select>
      <button class="btn btn-primary" data-a="nuevo">+ Nuevo tutorial</button>
    </div>
    ${vis.length ? `<div class="card" style="padding:0"><div class="table-wrapper"><table class="mn-tabla">
      <thead><tr><th>Orden</th><th>Título</th><th>Rol</th><th>Estado</th><th>Pasos</th><th>Videos</th><th>Acciones</th></tr></thead>
      <tbody>${vis.map(t => `<tr>
        <td>${t.orden}</td><td><strong>${e(t.titulo)}</strong></td><td>${e(ROL_TXT[t.rol] ?? t.rol)}</td>
        <td><span class="badge ${t.publicado ? 'badge-success' : ''}">${t.publicado ? 'Publicado' : 'Borrador'}</span></td>
        <td>${(t.secciones ?? []).length}</td><td>${(t.videos ?? []).length}</td>
        <td class="mn-acc">
          <button class="btn btn-ghost btn-sm" data-a="editar" data-id="${e(t.id)}">Editar</button>
          <button class="btn btn-ghost btn-sm" data-a="subir" data-id="${e(t.id)}" aria-label="Subir">↑</button>
          <button class="btn btn-ghost btn-sm" data-a="bajar" data-id="${e(t.id)}" aria-label="Bajar">↓</button>
          <button class="btn btn-ghost btn-sm" data-a="pub" data-id="${e(t.id)}">${t.publicado ? 'Ocultar' : 'Publicar'}</button>
          <button class="btn btn-danger btn-sm" data-a="borrar" data-id="${e(t.id)}">Borrar</button>
        </td></tr>`).join('')}</tbody></table></div></div>`
      : '<p class="mn-vacio">No hay tutoriales todavía.</p>'}`
}

// ── Formulario ───────────────────────────────────────────────────────────────
function aForm(t) {
  return {
    id: t?.id ?? null, rol: t?.rol ?? 'estudiante', titulo: t?.titulo ?? '',
    aprenderas: (t?.aprenderas ?? []).join('\n'),
    videos: (t?.videos ?? []).map(v => ({ url: v.url ?? '', titulo: v.titulo ?? '' })),
    secciones: (t?.secciones ?? []).map(s => ({
      titulo: s.titulo ?? '', parrafos: (s.parrafos ?? s.texto ?? []).join('\n\n'), lista: (s.lista ?? []).join('\n'),
      avTipo: s.aviso?.tipo ?? 'info', avTexto: s.aviso?.texto ?? '',
      coTitulo: s.copiable?.titulo ?? '', coTexto: s.copiable?.texto ?? '',
      maqueta: s.maqueta ?? s.pantalla ?? '', imagen_url: s.imagen_url ?? s.imagen ?? ''
    })),
    orden: t?.orden ?? (lista.filter(x => x.rol === (t?.rol ?? 'estudiante')).length), publicado: t?.publicado ?? false
  }
}

function aPayload(x) {
  return {
    rol: x.rol, titulo: x.titulo.trim(), aprenderas: lineas(x.aprenderas),
    videos: x.videos.filter(v => v.url.trim()).map(v => ({ url: v.url.trim(), ...(v.titulo.trim() ? { titulo: v.titulo.trim() } : {}) })),
    secciones: x.secciones.map(s => {
      const o = { titulo: s.titulo.trim() }
      const p = bloques(s.parrafos), l = lineas(s.lista)
      if (p.length) o.parrafos = p
      if (l.length) o.lista = l
      if (s.avTexto.trim()) o.aviso = { tipo: s.avTipo, texto: s.avTexto.trim() }
      if (s.coTexto.trim()) o.copiable = { ...(s.coTitulo.trim() ? { titulo: s.coTitulo.trim() } : {}), texto: s.coTexto.replace(/\s+$/, '') }
      if (s.maqueta) o.maqueta = s.maqueta
      else if (s.imagen_url.trim()) o.imagen_url = s.imagen_url.trim()
      return o
    }),
    orden: Number.isInteger(+x.orden) ? +x.orden : 0, publicado: !!x.publicado
  }
}

function validar(p, x) {
  if (p.titulo.length < 3 || p.titulo.length > 200) return 'El título debe tener entre 3 y 200 caracteres.'
  if (p.aprenderas.length > 20) return 'Máximo 20 puntos en "Aprenderás".'
  if (p.secciones.length > 60) return 'Máximo 60 pasos.'
  if (x.videos.filter(v => v.url.trim()).length > 5) return 'Máximo 5 videos.'
  for (const [i, v] of p.videos.entries()) {
    if (!HTTPS.test(v.url) || v.url.length > 500) return `Video ${i + 1}: el enlace debe empezar con https:// y no tener espacios ni < >.`
    if ((v.titulo ?? '').length > 60) return `Video ${i + 1}: el nombre admite hasta 60 caracteres.`
  }
  for (const [i, s] of p.secciones.entries()) {
    if (!s.titulo) return `Paso ${i + 1}: falta el título.`
    if (x.secciones[i].maqueta && x.secciones[i].imagen_url.trim()) return `Paso ${i + 1}: elige maqueta o imagen, no ambas.`
    if (s.imagen_url && !HTTPS.test(s.imagen_url)) return `Paso ${i + 1}: la imagen debe ser un enlace https://.`
  }
  if (!Number.isInteger(+x.orden) || +x.orden < 0) return 'El orden debe ser un número entero desde 0.'
  if (new Blob([JSON.stringify(p.secciones)]).size > MAX_BYTES) return 'Los pasos superan el tamaño máximo (256 KB).'
  return null
}

function htmlForm() {
  return `<div class="mn-top"><button class="btn btn-ghost" data-a="cancelar">← Volver a la lista</button>
      <div class="mn-top-r"><button class="btn btn-ghost" data-a="vista">Vista previa</button><button class="btn btn-primary" data-a="guardar">Guardar</button></div></div>
    <div class="card"><div class="card-title">${f.id ? 'Editar tutorial' : 'Nuevo tutorial'}</div><div class="card-body">
      <div class="grid-2">
        <div class="form-group"><label>Rol *</label><select data-k="rol">${ROLES.map(r => `<option value="${r}"${r === f.rol ? ' selected' : ''}>${ROL_TXT[r]}</option>`).join('')}</select></div>
        <div class="form-group"><label>Orden</label><input type="number" min="0" data-k="orden" value="${e(f.orden)}"></div>
        <div class="form-group" style="grid-column:1/-1"><label>Título *</label><input type="text" maxlength="200" data-k="titulo" value="${e(f.titulo)}"></div>
        <div class="form-group" style="grid-column:1/-1"><label>Aprenderás (un punto por línea)</label><textarea rows="4" data-k="aprenderas">${e(f.aprenderas)}</textarea></div>
      </div>
      <label class="mn-check"><input type="checkbox" data-k="publicado"${f.publicado ? ' checked' : ''}> Publicado (visible para ese rol)</label>
    </div></div>

    <div class="card"><div class="card-title">Videos (hasta 5, cualquier red pública)</div><div class="card-body">
      ${f.videos.map((v, i) => `<div class="mn-fila">
        <input type="url" placeholder="https://…" data-v="${i}" data-k="url" value="${e(v.url)}">
        <input type="text" placeholder="Nombre (opcional)" maxlength="60" data-v="${i}" data-k="titulo" value="${e(v.titulo)}">
        <button class="btn btn-ghost btn-sm" data-a="quitar-video" data-i="${i}" aria-label="Quitar video">✕</button></div>`).join('')}
      ${f.videos.length < 5 ? '<button class="btn btn-ghost btn-sm" data-a="add-video">+ Agregar video</button>' : ''}
      <small class="mn-ayuda">YouTube, Vimeo y Drive se ven dentro del panel; TikTok, Facebook, Instagram y otros se abren en otra pestaña.</small>
    </div></div>

    <div class="card"><div class="card-title">Pasos de la guía (${f.secciones.length})</div><div class="card-body">
      ${f.secciones.map((s, i) => htmlPaso(s, i)).join('')}
      <button class="btn btn-ghost" data-a="add-paso">+ Agregar paso</button>
    </div></div>`
}

function htmlPaso(s, i) {
  const d = (k, v) => `data-s="${i}" data-k="${k}"${v === undefined ? '' : ` value="${e(v)}"`}`
  return `<div class="mn-paso"><div class="mn-paso-top"><b>Paso ${i + 1}</b>
      <span><button class="btn btn-ghost btn-sm" data-a="paso-sube" data-i="${i}" aria-label="Subir paso">↑</button>
      <button class="btn btn-ghost btn-sm" data-a="paso-baja" data-i="${i}" aria-label="Bajar paso">↓</button>
      <button class="btn btn-danger btn-sm" data-a="paso-quita" data-i="${i}">Quitar</button></span></div>
    <div class="form-group"><label>Título *</label><input type="text" ${d('titulo', s.titulo)}></div>
    <div class="form-group"><label>Párrafos (separa con una línea en blanco; **negrita** permitida)</label><textarea rows="3" ${d('parrafos')}>${e(s.parrafos)}</textarea></div>
    <div class="form-group"><label>Lista (un ítem por línea)</label><textarea rows="2" ${d('lista')}>${e(s.lista)}</textarea></div>
    <div class="grid-2">
      <div class="form-group"><label>Aviso</label><select ${d('avTipo')}>${['info', 'alarma', 'ojo'].map(t => `<option value="${t}"${t === s.avTipo ? ' selected' : ''}>${{ info: 'Información', alarma: 'Alarma', ojo: 'Ojo / atención' }[t]}</option>`).join('')}</select></div>
      <div class="form-group"><label>Texto del aviso (vacío = sin aviso)</label><input type="text" ${d('avTexto', s.avTexto)}></div>
      <div class="form-group"><label>Bloque copiable: título</label><input type="text" ${d('coTitulo', s.coTitulo)}></div>
      <div class="form-group"><label>Bloque copiable: texto</label><textarea rows="2" ${d('coTexto')}>${e(s.coTexto)}</textarea></div>
      <div class="form-group"><label>Maqueta de celular</label><select ${d('maqueta')}><option value="">— ninguna —</option>${Object.entries(ETIQUETAS_PANTALLAS).map(([k, n]) => `<option value="${k}"${k === s.maqueta ? ' selected' : ''}>${e(n)}</option>`).join('')}</select></div>
      <div class="form-group"><label>…o imagen (enlace https://)</label><input type="url" ${d('imagen_url', s.imagen_url)}></div>
    </div></div>`
}

// ── Eventos ──────────────────────────────────────────────────────────────────
function entrada(ev) {
  const t = ev.target, k = t.dataset?.k
  if (!k) return
  if (k === 'filtro') { if (ev.type === 'change') { filtro = t.value; pintar() } return }
  if (prev.modal && prev.modal.contains(t)) return
  if (!f) return
  const val = t.type === 'checkbox' ? t.checked : t.value
  if (t.dataset.s !== undefined) f.secciones[+t.dataset.s][k] = val
  else if (t.dataset.v !== undefined) f.videos[+t.dataset.v][k] = val
  else f[k] = val
}

async function clic(ev) {
  const b = ev.target.closest('[data-a]'); if (!b) return
  const a = b.dataset.a, i = +b.dataset.i, t = lista.find(x => x.id === b.dataset.id)
  const mover = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true }
  switch (a) {
    case 'recargar': return cargar()
    case 'nuevo': f = aForm(null); vista = 'form'; return pintar()
    case 'editar': f = aForm(t); vista = 'form'; return pintar()
    case 'cancelar':
      if (!await confirmar('Salir sin guardar', 'Se perderán los cambios que no hayas guardado.', 'Salir', 'Seguir editando')) return
      vista = 'lista'; f = null; return pintar()
    case 'add-video': f.videos.push({ url: '', titulo: '' }); return pintar()
    case 'quitar-video': f.videos.splice(i, 1); return pintar()
    case 'add-paso': f.secciones.push({ titulo: '', parrafos: '', lista: '', avTipo: 'info', avTexto: '', coTitulo: '', coTexto: '', maqueta: '', imagen_url: '' }); return pintar()
    case 'paso-sube': if (mover(f.secciones, i, -1)) pintar(); return
    case 'paso-baja': if (mover(f.secciones, i, 1)) pintar(); return
    case 'paso-quita': if (await confirmar('Quitar paso', `¿Quitar el paso ${i + 1}?`)) { f.secciones.splice(i, 1); pintar() } return
    case 'guardar': return guardar()
    case 'vista': return abrirVista()
    case 'pub': return actualizar(t, { publicado: !t.publicado }, t.publicado ? 'Tutorial oculto' : 'Tutorial publicado')
    case 'subir': return reordenar(t, -1)
    case 'bajar': return reordenar(t, 1)
    case 'borrar': {
      if (!await confirmar('Borrar tutorial', `¿Borrar "${t.titulo}"? No se puede deshacer.`, 'Borrar', 'Cancelar')) return
      const { error } = await supabase.from('tutoriales').delete().eq('id', t.id)
      if (error) return toast('No se pudo borrar: ' + error.message, 'error')
      toast('Tutorial borrado', 'success'); return cargar()
    }
  }
}

function mensaje(err) {
  const m = err?.message ?? ''
  if (/videos/.test(m)) return 'Algún video no es válido (https, sin espacios, máx. 5).'
  if (/secciones/.test(m)) return 'Los pasos no son válidos o son demasiado grandes.'
  if (/titulo/.test(m)) return 'El título no es válido (3 a 200 caracteres).'
  if (/aprenderas/.test(m)) return 'Demasiados puntos en "Aprenderás".'
  if (err?.code === '42501' || /row-level security|permission/i.test(m)) return 'No tienes permiso para esta acción.'
  return m || 'Error desconocido'
}

async function guardar() {
  const p = aPayload(f), msg = validar(p, f)
  if (msg) return toast(msg, 'warning')
  const q = f.id ? supabase.from('tutoriales').update(p).eq('id', f.id) : supabase.from('tutoriales').insert(p)
  const { error } = await q
  if (error) return toast('No se pudo guardar: ' + mensaje(error), 'error')
  toast('Tutorial guardado', 'success'); f = null; await cargar()
}

async function actualizar(t, cambios, ok) {
  const { error } = await supabase.from('tutoriales').update(cambios).eq('id', t.id)
  if (error) return toast('No se pudo actualizar: ' + mensaje(error), 'error')
  toast(ok, 'success'); await cargar()
}

async function reordenar(t, d) {
  const g = lista.filter(x => x.rol === t.rol), i = g.findIndex(x => x.id === t.id), j = i + d
  if (j < 0 || j >= g.length) return
  ;[g[i], g[j]] = [g[j], g[i]]
  for (const [n, x] of g.entries()) {
    if (x.orden === n) continue
    const { error } = await supabase.from('tutoriales').update({ orden: n }).eq('id', x.id)
    if (error) { toast('No se pudo reordenar: ' + mensaje(error), 'error'); break }
  }
  await cargar()
}

// ── Vista previa (misma pantalla que verá el usuario) ────────────────────────
function abrirVista() {
  const p = aPayload(f); p.id = 'preview'
  prev.tab = 'lista'; prev.abierto = null
  const m = document.createElement('div'); m.className = 'mn-prev'; prev.modal = m
  document.body.appendChild(m)
  const dibujar = () => {
    m.innerHTML = `<div class="mn-prev-box"><div class="mn-prev-top">
        <b>Vista previa</b>
        <label>Colegio <input type="text" data-p="colegio" value="${e(prev.colegio)}"></label>
        <label>Color <input type="color" data-p="color" value="${e(prev.color || '#2563eb')}"></label>
        <button class="btn btn-ghost btn-sm" data-p-cerrar>Cerrar</button></div>
      <div class="mn-prev-cont" style="${prev.color ? `--color-primary:${e(prev.color)};` : ''}">
        ${prev.tab === 'lista' ? htmlLista([p], p.rol, prev.abierto) : htmlGuia(p, prev.colegio)}</div></div>`
  }
  dibujar()
  m.addEventListener('input', ev => { const k = ev.target.dataset.p; if (k) { prev[k] = ev.target.value; const s = ev.target.selectionStart; dibujar(); const n = m.querySelector(`[data-p="${k}"]`); if (k === 'colegio') { n.focus(); n.setSelectionRange(s, s) } } })
  m.addEventListener('click', ev => {
    const t = ev.target
    if (t === m || t.closest('[data-p-cerrar]')) { m.remove(); prev.modal = null; return }
    if (t.closest('[data-fila]')) { prev.abierto = prev.abierto === 'preview' ? null : 'preview'; return dibujar() }
    if (t.closest('[data-guia]')) { prev.tab = 'guia'; return dibujar() }
    if (t.closest('[data-volver]')) { prev.tab = 'lista'; return dibujar() }
    const v = t.closest('[data-video]'); if (v) return abrirModalVideo(videosDe(p)[+v.dataset.video.split(':')[1]])
    const c = t.closest('[data-copiar]'); if (c) return copiarBloque(c)
    if (t.closest('[data-imprimir]')) window.print()
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar()