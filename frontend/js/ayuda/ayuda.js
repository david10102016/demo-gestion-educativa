// js/ayuda/ayuda.js
// Tutoriales y manuales para CUALQUIER panel con menú lateral (director, profesor, estudiante, tutor, secretaria).
// Se conecta con una sola línea al final del <body> del panel:
//   <script type="module" src="/js/ayuda/ayuda.js"></script>
// No depende del JS del panel: agrega su propia opción al menú y su propia sección. El contenido sale de la tabla
// `tutoriales` (migración 107): la base ya devuelve solo los publicados del rol del usuario.
// Si el panel no tiene menú lateral (p. ej. el escáner del regente), no hace nada.
import '../../css/ayuda.css'
import { supabase } from '../config/supabase-config.js'
import { htmlLista, htmlGuia, videosDe, abrirModalVideo, copiarBloque } from './ayuda-bloques.js'

const VIGENCIA_MS = 5 * 60 * 1000
let _tutoriales = null, _cargadoEn = 0, _rol = null, _abierto = null

const $sec = () => document.getElementById('section-ayuda')
const $btn = () => document.getElementById('nav-ayuda')

const ICONO = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="#db2777" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>'

function cerrarMenuMovil() {
  document.getElementById('sidebar')?.classList.remove('open')
  document.getElementById('sidebar-overlay')?.classList.remove('active')
  document.body.classList.remove('menu-abierto')
}

function montar() {
  const nav = document.querySelector('.sidebar-nav')
  const pagina = document.querySelector('.page-content')
  if (!nav || !pagina || $btn()) return   // sin menú lateral: este panel no usa Tutoriales

  const html = `<div class="sidebar-section-label">Ayuda</div>
    <button type="button" class="nav-item" id="nav-ayuda">${ICONO}Tutoriales</button>`
  const cuenta = [...nav.querySelectorAll('.sidebar-section-label')].find(l => /cuenta/i.test(l.textContent))
  if (cuenta) cuenta.insertAdjacentHTML('beforebegin', html); else nav.insertAdjacentHTML('beforeend', html)
  pagina.insertAdjacentHTML('beforeend', '<section id="section-ayuda" class="section-content hidden"></section>')

  $btn().addEventListener('click', abrir)
  $sec().addEventListener('click', clicEnSeccion)
  // Al ir a otra opción del menú, el panel no sabe de este botón: se desmarca aquí.
  document.addEventListener('click', e => {
    const otro = e.target.closest?.('.nav-item')
    if (otro && otro !== $btn()) salir()
  }, true)
  window.__abrirTutoriales = abrir   // lo usa el botón "?" de tour.js
}

function salir() {
  $btn()?.classList.remove('active')
  document.body.classList.remove('ayuda-activa')
}

async function cargar() {
  if (_tutoriales && Date.now() - _cargadoEn < VIGENCIA_MS) return true
  const { data, error } = await supabase.from('tutoriales')
    .select('id, rol, titulo, aprenderas, secciones, videos, orden')
    .eq('publicado', true).order('orden', { ascending: true })
  if (error) { console.error('[ayuda]', error); return false }
  _tutoriales = data ?? []; _cargadoEn = Date.now(); _rol = _tutoriales[0]?.rol ?? null
  return true
}

async function abrir() {
  const sec = $sec(); if (!sec) return
  document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'))
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
  $btn().classList.add('active')
  document.body.classList.add('ayuda-activa')
  sec.classList.remove('hidden')
  const titulo = document.querySelector('.topbar-title'); if (titulo) titulo.textContent = 'Tutoriales'
  cerrarMenuMovil()

  if (!_tutoriales) sec.innerHTML = '<div class="ay"><div class="ay-vacio">Cargando tutoriales...</div></div>'
  const ok = await cargar()
  if (!ok && !_tutoriales) {
    sec.innerHTML = '<div class="ay"><div class="ay-vacio">No se pudieron cargar los tutoriales.<br><button type="button" class="ay-btn" data-reintentar>Reintentar</button></div></div>'
    return
  }
  pintarLista()
}

function irAlInicio() {
  const sec = $sec(), barra = document.querySelector('.topbar')
  sec.style.scrollMarginTop = `${(barra?.offsetHeight ?? 60) + 8}px`
  sec.scrollIntoView({ block: 'start' })
}

function pintarLista() { $sec().innerHTML = htmlLista(_tutoriales, _rol, _abierto) }

function pintarGuia(id) {
  const t = _tutoriales?.find(x => x.id === id); if (!t) return
  // Nombre del colegio: el que el panel ya puso en el menú (sin consultas ni valores fijos)
  const colegio = document.querySelector('.sidebar-logo-text')?.textContent?.trim() ?? ''
  $sec().innerHTML = htmlGuia(t, colegio)
  irAlInicio()
}

function abrirVideo(ref) {
  const [id, n] = String(ref).split(':')
  abrirModalVideo(videosDe(_tutoriales?.find(x => x.id === id))[Number(n)])
}

function clicEnSeccion(e) {
  const t = e.target
  const fila = t.closest('[data-fila]')
  if (fila) {
    const id = fila.dataset.fila
    _abierto = _abierto === id ? null : id
    pintarLista()
    $sec().querySelector(`[data-fila="${id}"]`)?.focus()
    return
  }
  const g = t.closest('[data-guia]'); if (g) return pintarGuia(g.dataset.guia)
  const v = t.closest('[data-video]'); if (v) return abrirVideo(v.dataset.video)
  const c = t.closest('[data-copiar]'); if (c) return copiarBloque(c)
  if (t.closest('[data-imprimir]')) return window.print()
  if (t.closest('[data-volver]')) { pintarLista(); return irAlInicio() }
  if (t.closest('[data-reintentar]')) return abrir()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar)
else montar()