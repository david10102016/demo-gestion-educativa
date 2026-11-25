// js/profesor/profesor.js
import { supabase } from '../config/supabase-config.js'
import { mostrarIngresoPorteria } from '../porteria/ingreso-profesor.js'
import { verificarSesion, logout } from '../auth/auth.js'
import { Config } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar, fechaLocal } from '../utils/ui.js'
import { exportarAsistenciasExcel } from '../utils/export-excel.js'
import { guardarAsistenciaMateria, obtenerAsistenciaMateriaDia, mapaEstadosPorEstudiante, horaBoliviaCorta } from '../utils/asistencia-materia.js'
import { abrirLlamadaQr } from './asistencia-qr.js'
import { aplicarLicenciasEnLista } from '../licencias/licencias-profesor.js'
import { iniciarVistaCalificaciones } from './vista-calificaciones.js'
import { iniciarBitacora } from './bitacora.js'
import { iniciarAsistenciaMensual } from './asistencia-mensual.js'
import { iniciarCentralizador } from '../utils/centralizador-anual.js'
import { iniciarAsesorCurso } from './asesor-curso.js'
import { fetchConCache } from '../utils/data-layer.js'
import { cursosDelGrado } from '../utils/tecnica-grado.js'
import { initConnectionStatus, avisoOfflineInline } from '../utils/connection-status.js'
import { clearUserCache } from '../utils/offline-db.js'
import { escapeHtml as escapeHTML } from '../utils/sanitize.js'
import { subirArchivoTarea } from '../utils/almacenamiento.js'
const _cp = localStorage.getItem('color_primario')
if (_cp) document.documentElement.style.setProperty('--color-primary', _cp)

let perfil = null
let asignaciones = []
let _notasCallId = 0

// ─── RÚBRICA DE CALIFICACIÓN (Hacer / Saber) ──────────────────────────
const NIVELES_RUBRICA_GENERICOS = [
  { porcentaje: 0,   descripcion: 'No realizó la actividad / no desarrolla nada' },
  { porcentaje: 55,  descripcion: 'Desarrollo desorganizado, no cumple lo esencial del criterio' },
  { porcentaje: 65,  descripcion: 'Cumple el criterio de forma aislada, sin conexión clara' },
  { porcentaje: 75,  descripcion: 'Cumple el criterio con claridad, aunque la profundidad es limitada' },
  { porcentaje: 85,  descripcion: 'Cumple el criterio con buen nivel de desarrollo y coherencia' },
  { porcentaje: 100, descripcion: 'Cumple el criterio de forma sobresaliente, con dominio completo' }
]

let _rubricaState = { actividadId: null, tipo: null, puntosTotal: 0, bloqueada: false, tieneCriterios: false }
let _rubricaCriteriosNotas = []
let _rubricaMaxPuntosNotas = 0
let _perfilesNotasMap = {}

function _actualizarBotonRubrica() {
  const id  = document.getElementById('act-id')?.value
  const btn = document.getElementById('btn-armar-rubrica')
  if (!btn) return
  if (id) btn.classList.remove('hidden'); else btn.classList.add('hidden')
}

window.abrirModalRubrica = async function() {
  const actividadId = document.getElementById('act-id').value
  if (!actividadId) return
  const tipo        = document.getElementById('act-tipo').value
  const puntosTotal = parseFloat(document.getElementById('act-puntos').value) || 0

  mostrarLoader('Cargando rúbrica...')
  const [{ count: notasCount }, { data: criteriosExist }] = await Promise.all([
    supabase.from('notas').select('id', { count: 'exact', head: true }).eq('actividad_id', actividadId),
    supabase.from('rubrica_criterios').select('*').eq('actividad_id', actividadId).order('orden')
  ])
  ocultarLoader()

  const bloqueada    = (notasCount ?? 0) > 0
  const tieneCriterios = !!(criteriosExist && criteriosExist.length)

  let criterios
  if (tieneCriterios) {
    criterios = criteriosExist.map(c => ({
      id: c.id, nombre: c.nombre, porcentaje: c.porcentaje,
      puntos_max: c.puntos_max, niveles: c.niveles
    }))
  } else {
    const { data: plantilla, error: errPlantilla } = await supabase
      .from('rubrica_plantillas')
      .select('criterios')
      .eq('tipo', tipo)
      .is('colegio_id', null)
      .single()
    if (errPlantilla || !plantilla) {
      toast('No se encontró la plantilla base de rúbrica para esta dimensión', 'error')
      return
    }
    criterios = plantilla.criterios.map(c => ({
      id: null, nombre: c.nombre, porcentaje: c.porcentaje,
      puntos_max: +(puntosTotal * c.porcentaje / 100).toFixed(2),
      niveles: c.niveles.map(n => ({ ...n }))
    }))
  }

  _rubricaState = { actividadId, tipo, puntosTotal, bloqueada, tieneCriterios }
  _renderModalRubrica(criterios)
}

function _renderCriterioCardHTML(c, bloqueada) {
  return `
    <div class="rubrica-criterio-card" data-id="${c.id ?? ''}" style="border:1px solid var(--color-border);border-left:4px solid var(--color-primary);border-radius:10px;padding:14px;margin-bottom:12px;background:color-mix(in srgb, var(--color-primary) 8%, white);">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
        <input type="text" class="rc-nombre" value="${escapeHTML(c.nombre)}" placeholder="Nombre del criterio"
          style="flex:1;min-width:140px;padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-weight:600;">
        <input type="number" class="rc-porcentaje" value="${c.porcentaje}" min="1" max="100" step="1"
          ${bloqueada ? 'readonly' : 'oninput="window._rcActualizarSuma()"'}
          style="width:56px;padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;text-align:center;${bloqueada ? 'background:var(--color-surface-2);' : ''}">
        <span style="font-size:11px;color:var(--color-text-3);">%</span>
        <span class="rc-pts" style="font-size:11px;color:var(--color-text-3);white-space:nowrap;">= ${c.puntos_max} pts</span>
        ${!bloqueada ? `<button type="button" onclick="this.closest('.rubrica-criterio-card').remove();window._rcActualizarSuma()" style="background:none;border:none;cursor:pointer;font-size:14px;margin-left:auto;">🗑️</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:46px 1fr;gap:6px 10px;background:#ffffff;border-radius:8px;padding:10px;">
        ${c.niveles.map(n => `
          <div style="font-size:11px;font-weight:600;color:#6b7280;padding-top:6px;">${n.porcentaje}%</div>
          <input type="text" class="rc-nivel" data-pct="${n.porcentaje}" value="${escapeHTML(n.descripcion)}"
            style="padding:5px 8px;border:1px solid var(--color-border);border-radius:6px;font-size:12px;">
        `).join('')}
      </div>
    </div>`
}

function _renderModalRubrica(criterios) {
  const { bloqueada, tieneCriterios, tipo } = _rubricaState
  const overlay = document.createElement('div')
  overlay.id = 'rubrica-overlay'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)', padding: '16px'
  })
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:620px;max-height:88vh;">
      <div class="modal-header modal-header-gradient">
        <div class="modal-header-icon-lg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17l2 2 4-4"/></svg>
        </div>
        <div class="modal-header-titles">
          <h2>Armar rúbrica — ${tipo === 'hacer' ? 'Hacer' : 'Saber'}</h2>
          <p class="modal-subtitle">${bloqueada ? 'Ya tiene notas: solo se edita el texto' : 'Ajusta los criterios (suman 100%) y toca Guardar rúbrica'}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
          <button type="button" onclick="window._rcCopiarJSON()" title="Copiar los criterios actuales como JSON"
            style="background:none;border:1px solid var(--color-border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--color-text-2);cursor:pointer;">📋 Copiar JSON</button>
          ${!bloqueada ? `<button type="button" onclick="window._rcPegarJSON()" title="Pegar criterios adaptados (ej. por una IA externa)"
            style="background:none;border:1px solid var(--color-border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--color-text-2);cursor:pointer;">📥 Pegar JSON</button>` : ''}
          <button class="btn-close-modal" onclick="document.getElementById('rubrica-overlay').remove()">×</button>
        </div>
      </div>
      <div class="modal-body" style="overflow-y:auto;flex:1;">
        ${bloqueada
          ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#991b1b;">🔒 Solo se puede editar el texto, no los puntajes.</div>`
          : ''
        }
        <div id="rc-lista-criterios">
          ${criterios.map(c => _renderCriterioCardHTML(c, bloqueada)).join('')}
        </div>
        ${!bloqueada ? `<button type="button" onclick="window._rcAgregarCriterio()" style="width:100%;padding:8px;border:1px dashed var(--color-border);border-radius:8px;background:none;cursor:pointer;font-size:12px;color:var(--color-primary);font-weight:600;">➕ Agregar criterio</button>` : ''}
      </div>
      <div class="modal-footer-gradient" style="padding:14px 24px;border-top:1px solid var(--color-border);">
        ${!bloqueada ? `<div id="rc-suma-bar" style="text-align:center;font-size:12px;font-weight:700;margin-bottom:10px;"></div>` : ''}
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <div>
            ${tieneCriterios && !bloqueada ? `<button type="button" onclick="window._quitarRubrica()" style="padding:8px 14px;font-size:12px;font-weight:600;color:#dc2626;background:#fef2f2;border:none;border-radius:8px;cursor:pointer;">Quitar rúbrica</button>` : ''}
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" onclick="document.getElementById('rubrica-overlay').remove()" class="btn btn-secondary">Cancelar</button>
            <button type="button" id="btn-guardar-rubrica" onclick="window._guardarRubrica()" class="btn btn-primary">
              ${bloqueada ? 'Guardar cambios de texto' : 'Guardar rúbrica'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  if (!bloqueada) window._rcActualizarSuma()
}

window._rcActualizarSuma = function() {
  const puntosTotal = _rubricaState.puntosTotal
  let suma = 0
  document.querySelectorAll('.rubrica-criterio-card').forEach(card => {
    const pctInput = card.querySelector('.rc-porcentaje')
    const pct = parseFloat(pctInput.value) || 0
    suma += pct
    const ptsSpan = card.querySelector('.rc-pts')
    if (ptsSpan) ptsSpan.textContent = `= ${(puntosTotal * pct / 100).toFixed(1)} pts`
  })
  const bar = document.getElementById('rc-suma-bar')
  const btnGuardar = document.getElementById('btn-guardar-rubrica')
  if (!bar) return
  if (Math.abs(suma - 100) < 0.01) {
    bar.textContent = `Suma actual: ${suma.toFixed(0)}% ✓`
    bar.style.color = '#16a34a'
    if (btnGuardar) btnGuardar.disabled = false
  } else {
    const diff = (100 - suma)
    bar.textContent = diff > 0
      ? `Suma actual: ${suma.toFixed(0)}% — faltan ${diff.toFixed(0)}%`
      : `Suma actual: ${suma.toFixed(0)}% — sobran ${Math.abs(diff).toFixed(0)}%`
    bar.style.color = '#dc2626'
    if (btnGuardar) btnGuardar.disabled = true
  }
}

window._rcAgregarCriterio = function() {
  const cont = document.getElementById('rc-lista-criterios')
  const wrapper = document.createElement('div')
  wrapper.innerHTML = _renderCriterioCardHTML(
    { id: null, nombre: '', porcentaje: 0, puntos_max: 0, niveles: NIVELES_RUBRICA_GENERICOS.map(n => ({ ...n })) },
    false
  )
  cont.appendChild(wrapper.firstElementChild)
  window._rcActualizarSuma()
}

// Lee los criterios actuales del DOM en el mismo formato que espera
// el RPC de guardado -- lo reutilizan tanto Guardar como Copiar JSON.
function _rcLeerCriteriosDelDOM() {
  const cards = document.querySelectorAll('.rubrica-criterio-card')
  const criterios = []
  for (const card of cards) {
    const nombre = card.querySelector('.rc-nombre').value.trim()
    const porcentaje = parseFloat(card.querySelector('.rc-porcentaje').value)
    const niveles = [...card.querySelectorAll('.rc-nivel')].map(inp => ({
      porcentaje: parseInt(inp.dataset.pct, 10),
      descripcion: inp.value.trim()
    }))
    criterios.push({ nombre, porcentaje, niveles })
  }
  return criterios
}

window._rcCopiarJSON = async function() {
  const criterios = _rcLeerCriteriosDelDOM()
  const texto = JSON.stringify(criterios, null, 2)
  try {
    await navigator.clipboard.writeText(texto)
    toast('Criterios copiados al portapapeles', 'success')
  } catch {
    // El navegador bloqueó el acceso al portapapeles -- se ofrece
    // seleccionado en un cuadro de texto para copiar a mano.
    _rcMostrarTextoManual('Copiar criterios', texto, true)
  }
}

// Valida que el JSON pegado tenga la forma esperada antes de usarlo
// para no romper el modal con algo mal armado (ej. por una IA que
// se equivocó de formato).
function _rcValidarCriteriosJSON(data) {
  if (!Array.isArray(data) || !data.length) return 'El JSON debe ser una lista de criterios.'
  const pctsValidos = [0, 55, 65, 75, 85, 100]
  let suma = 0
  for (const [i, c] of data.entries()) {
    if (typeof c.nombre !== 'string' || !c.nombre.trim()) return `Criterio ${i + 1}: falta "nombre".`
    if (typeof c.porcentaje !== 'number' || c.porcentaje <= 0 || c.porcentaje > 100) return `Criterio ${i + 1}: "porcentaje" debe ser un número entre 1 y 100.`
    if (!Array.isArray(c.niveles) || c.niveles.length !== 6) return `Criterio ${i + 1}: debe tener exactamente 6 niveles (0/55/65/75/85/100).`
    const pctsCriterio = c.niveles.map(n => n.porcentaje).sort((a, b) => a - b)
    if (JSON.stringify(pctsCriterio) !== JSON.stringify(pctsValidos)) return `Criterio ${i + 1}: los niveles deben ser exactamente 0, 55, 65, 75, 85 y 100.`
    if (c.niveles.some(n => typeof n.descripcion !== 'string')) return `Criterio ${i + 1}: cada nivel necesita una "descripcion" de texto.`
    suma += c.porcentaje
  }
  if (Math.abs(suma - 100) > 0.01) return `Los criterios suman ${suma}%, deben sumar exactamente 100%.`
  return null
}

window._rcPegarJSON = function() {
  if (_rubricaState.bloqueada) return
  const overlay = document.createElement('div')
  overlay.id = 'rc-pegar-overlay'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '100000', display: 'flex',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.6)', padding: '16px'
  })
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;padding:18px;">
      <h4 style="margin:0 0 8px;font-size:14px;font-weight:700;">Pegar JSON de criterios</h4>
      <p style="margin:0 0 8px;font-size:12px;color:var(--color-text-3);">Pegá acá (Ctrl+V) el JSON que te devolvió la IA externa, con el mismo formato que copiaste.</p>
      <textarea id="rc-pegar-textarea" placeholder="Pegá el JSON acá..." style="width:100%;height:220px;font-family:monospace;font-size:11px;padding:8px;border:1px solid var(--color-border);border-radius:8px;"></textarea>
      <div id="rc-pegar-error" style="color:#dc2626;font-size:12px;margin-top:6px;min-height:16px;"></div>
      <div style="text-align:right;margin-top:10px;display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="document.getElementById('rc-pegar-overlay').remove()" style="padding:6px 14px;font-size:12px;font-weight:600;background:#f1f5f9;color:#475569;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
        <button onclick="window._rcConfirmarPegado()" style="padding:6px 14px;font-size:12px;font-weight:600;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cargar criterios</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  overlay.querySelector('textarea').focus()
}

window._rcConfirmarPegado = function() {
  const texto = document.getElementById('rc-pegar-textarea').value
  const errorEl = document.getElementById('rc-pegar-error')
  if (!texto.trim()) { errorEl.textContent = 'Pegá el JSON primero.'; return }

  let data
  try {
    data = JSON.parse(texto)
  } catch {
    errorEl.textContent = 'Eso no es un JSON válido -- revisá que la IA no haya agregado texto extra antes o después del JSON.'
    return
  }
  const errorValidacion = _rcValidarCriteriosJSON(data)
  if (errorValidacion) { errorEl.textContent = errorValidacion; return }

  const criterios = data.map(c => ({
    id: null, nombre: c.nombre, porcentaje: c.porcentaje,
    puntos_max: +(_rubricaState.puntosTotal * c.porcentaje / 100).toFixed(2),
    niveles: c.niveles.map(n => ({ porcentaje: n.porcentaje, descripcion: n.descripcion }))
  }))
  document.getElementById('rc-lista-criterios').innerHTML = criterios.map(c => _renderCriterioCardHTML(c, false)).join('')
  window._rcActualizarSuma()
  document.getElementById('rc-pegar-overlay')?.remove()
  toast('Criterios cargados desde el JSON pegado -- revisalos antes de guardar', 'success')
}

function _rcMostrarTextoManual(titulo, texto, soloLectura) {
  const overlay = document.createElement('div')
  overlay.id = 'rc-texto-manual-overlay'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '100000', display: 'flex',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.6)', padding: '16px'
  })
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:500px;width:100%;padding:18px;">
      <h4 style="margin:0 0 8px;font-size:14px;font-weight:700;">${titulo}</h4>
      <p style="margin:0 0 8px;font-size:12px;color:var(--color-text-3);">Tu navegador bloqueó el acceso directo al portapapeles. Copiá el texto de acá abajo a mano.</p>
      <textarea ${soloLectura ? 'readonly' : ''} style="width:100%;height:220px;font-family:monospace;font-size:11px;padding:8px;border:1px solid var(--color-border);border-radius:8px;">${escapeHTML(texto)}</textarea>
      <div style="text-align:right;margin-top:10px;">
        <button onclick="document.getElementById('rc-texto-manual-overlay').remove()" style="padding:6px 14px;font-size:12px;font-weight:600;background:#f1f5f9;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  const ta = overlay.querySelector('textarea')
  ta.focus(); ta.select()
}

window._guardarRubrica = async function() {
  const cards = document.querySelectorAll('.rubrica-criterio-card')
  const criterios = []
  for (const card of cards) {
    const nombre = card.querySelector('.rc-nombre').value.trim()
    const porcentaje = parseFloat(card.querySelector('.rc-porcentaje').value)
    if (!nombre) { toast('Todos los criterios necesitan un nombre', 'warning'); return }
    if (!_rubricaState.bloqueada && (isNaN(porcentaje) || porcentaje <= 0)) {
      toast('Todos los criterios necesitan un porcentaje mayor a 0', 'warning'); return
    }
    const niveles = [...card.querySelectorAll('.rc-nivel')].map(inp => ({
      porcentaje: parseInt(inp.dataset.pct, 10),
      descripcion: inp.value.trim()
    }))
    const item = {
      nombre, porcentaje,
      puntos_max: +(_rubricaState.puntosTotal * porcentaje / 100).toFixed(2),
      niveles, orden: criterios.length
    }
    const idAttr = card.dataset.id
    if (idAttr) item.id = idAttr
    criterios.push(item)
  }
  if (!criterios.length) { toast('Agregá al menos un criterio', 'warning'); return }

  if (!_rubricaState.bloqueada) {
    const suma = criterios.reduce((s, c) => s + c.porcentaje, 0)
    if (Math.abs(suma - 100) > 0.01) {
      toast(`Los criterios suman ${suma}%, deben sumar exactamente 100%`, 'warning'); return
    }
  }

  mostrarLoader('Guardando rúbrica...')
  const { data, error } = await supabase.rpc('guardar_rubrica_criterios', {
    p_actividad_id: _rubricaState.actividadId,
    p_criterios: criterios
  })
  ocultarLoader()
  if (error) { toast(error.message, 'error'); return }
  if (data?.ok === false) { toast(data.error, 'error'); return }
  toast('✓ Rúbrica guardada. Esta actividad se calificará por criterios.', 'success')
  document.getElementById('rubrica-overlay')?.remove()
  document.getElementById('modal-actividad')?.classList.add('hidden')   // termina el flujo: se cierran ambas ventanas
  if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
}

window._quitarRubrica = async function() {
  if (_rubricaState.bloqueada) return
  const ok = await confirmar('Quitar rúbrica', '¿Quitar la rúbrica de esta actividad? Volverá a calificarse con un solo número.')
  if (!ok) return
  mostrarLoader('Quitando rúbrica...')
  const { error } = await supabase.from('rubrica_criterios').delete().eq('actividad_id', _rubricaState.actividadId)
  ocultarLoader()
  if (error) { toast(error.message, 'error'); return }
  toast('Rúbrica quitada', 'success')
  document.getElementById('rubrica-overlay')?.remove()
  if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
}
// ─── FIN RÚBRICA DE CALIFICACIÓN ───────────────────────────────────────





document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await verificarSesion('profesor')
  if (!sesion) return
  perfil = sesion.perfil
  iniciarAsistenciaMensual(perfil)
  iniciarCentralizador(perfil)
  iniciarAsesorCurso(perfil)

  initConnectionStatus()

  document.getElementById('nombre-prof').textContent = perfil.nombre_completo
  document.getElementById('email-prof').textContent = perfil.email ?? ''
  document.getElementById('avatar-prof').textContent =
    perfil.nombre_completo.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase()
  document.getElementById('stat-gestion-prof').textContent = Config.año
  const { data: col } = await supabase.from('colegios').select('nombre').eq('id', perfil.colegio_id).single()
  if (col) document.getElementById('nombre-colegio-prof').textContent = col.nombre

  await cargarAsignaciones()
    if (window.APP_CONFIG?.plan !== 'avanzado') {
    const navCom = document.getElementById('nav-comunicados')
    if (navCom) navCom.style.display = 'none'
  }
  poblarSelectores()
  poblarDimensionesModal()
  poblarPeriodosModal()
  poblarFechaAsistencia()

  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => mostrarSeccionProf(btn.dataset.section))
  })

  document.getElementById('btn-logout-prof').addEventListener('click', async () => {
    if (await confirmar('Cerrar sesión', '¿Deseas cerrar la sesión?')) {
      // Limpieza de cache offline de este usuario para no dejar datos
      // visibles a la siguiente persona que use este dispositivo.
      await clearUserCache(perfil?.id)
      logout()
    }
  })

  // Al cambiar de curso, la materia se elige sola y la sección se recarga sin otro clic.
  document.getElementById('selector-curso-global').addEventListener('change', () => {
    actualizarMaterias()
    _elegirMateria()
    _guardarSeleccion()
    _refrescarSeccionActual()
  })
  document.getElementById('selector-materia-global').addEventListener('change', () => {
    _guardarSeleccion()
    _refrescarSeccionActual()
  })
  document.getElementById('selector-periodo-global').addEventListener('change', () => {
    const sec = document.querySelector('.nav-item.active')?.dataset?.section
    if (sec === 'actividades') iniciarVistaCalificaciones(perfil)
  })

  await cargarEstadisticasInicio()
})

window.mostrarSeccionProf = function(nombre) {
  document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'))
  document.querySelectorAll('.nav-item[data-section]').forEach(b => b.classList.remove('active'))
  document.getElementById(`section-${nombre}`)?.classList.remove('hidden')
  document.querySelector(`[data-section="${nombre}"]`)?.classList.add('active')
  const titulos = { inicio:'Inicio', actividades:'Calificaciones',
    ser:'Ficha SER', asistencia:'Asistencia', bitacora:'Bitácora', 'mis-cursos':'Mis cursos', 'mi-cuenta':'Mi cuenta', comunicados:'Comunicados', 'asesor-curso':'Asesor de curso' }
  document.getElementById('topbar-title-prof').textContent = titulos[nombre] ?? nombre
  document.querySelector('.main-content').scrollTop = 0

  const loaders = {
    actividades:  () => { if (perfil) iniciarVistaCalificaciones(perfil) },
    ser:          cargarEstudiantesDelCurso,
    asistencia:   () => {},
    bitacora:     () => { if (perfil) iniciarBitacora(perfil) },
    'mis-cursos':  cargarMisCursos,
    'mi-cuenta':   () => {},
    comunicados:   () => cargarComunicadosProf(),
    'asesor-curso': () => window.cargarAsesorCurso?.()
  }
  loaders[nombre]?.()
}

// ─── ASIGNACIONES (lectura offline: sin esto no carga nada del panel) ───
async function cargarAsignaciones() {
  const r = await fetchConCache({
    key: `asignaciones-profesor`,
    colegioId: perfil?.colegio_id, usuarioId: perfil?.id,
    run: () => supabase.from('asignaciones_profesor')
      .select('curso_id, materia_id, curso:cursos(nombre_completo), materia:materias(nombre, es_tecnica)')
      .eq('profesor_id', perfil.id).eq('activo', true),
  })
  asignaciones = r.data ?? []
  window._profAsignaciones = asignaciones   // accesos rápidos de Calificaciones
}

function poblarSelectores() {
  const cursos = [...new Map(asignaciones.map(a=>[a.curso_id, a.curso])).entries()]
    .sort((a, b) => (a[1]?.nombre_completo ?? '').localeCompare(b[1]?.nombre_completo ?? '', 'es', { numeric: true }))
  const selCurso = document.getElementById('selector-curso-global')
  selCurso.innerHTML = '<option value="">— Curso —</option>'
    + cursos.map(([id,c])=>`<option value="${escapeHTML(id)}">${escapeHTML(c?.nombre_completo)}</option>`).join('')

  document.getElementById('selector-periodo-global').innerHTML =
    Config.periodos.map(p=>`<option value="${p.numero}">${p.nombre}</option>`).join('')
  // Fijar el selector en el trimestre activo por defecto
  document.getElementById('selector-periodo-global').value = Config.trimestreActivo

  // Los selectores nunca quedan vacíos: última combinación usada o, si no hay,
  // el primer curso y su primera materia.
  const guardada = _leerSeleccion()
  const idsCursos = cursos.map(([id]) => id)
  if (guardada && idsCursos.includes(guardada.cursoId)) selCurso.value = guardada.cursoId
  else if (idsCursos.length) selCurso.value = idsCursos[0]
  actualizarMaterias()
  _elegirMateria(guardada?.cursoId === selCurso.value ? guardada.materiaId : '')
}

// ─── SELECCIÓN DE CURSO Y MATERIA ────────────────────────
// Se recuerda la última combinación usada, por usuario y en este navegador.
function _claveSeleccion() { return `ge:seleccion-prof:${perfil?.id ?? ''}` }

function _leerSeleccion() {
  try { return JSON.parse(localStorage.getItem(_claveSeleccion()) || 'null') } catch { return null }
}

function _guardarSeleccion() {
  try {
    const { cursoId, materiaId } = get()
    if (cursoId && materiaId) localStorage.setItem(_claveSeleccion(), JSON.stringify({ cursoId, materiaId }))
  } catch { /* sin almacenamiento disponible: solo no se recuerda */ }
}

// Elige la materia preferida si está en la lista; si no, la primera del curso.
function _elegirMateria(preferida = '') {
  const sel = document.getElementById('selector-materia-global')
  const ids = [...sel.options].map(o => o.value).filter(Boolean)
  sel.value = ids.includes(preferida) ? preferida : (ids[0] ?? '')
}

function _refrescarSeccionActual() {
  const sec = document.querySelector('.nav-item.active')?.dataset?.section
  if (sec === 'actividades') iniciarVistaCalificaciones(perfil)
  if (sec === 'ser') cargarEstudiantesDelCurso()
  if (sec === 'asistencia') cargarListaAsistencia()
}

// Accesos rápidos de Calificaciones: fija curso y materia con un clic.
window._profSeleccionar = function(cursoId, materiaId) {
  const selCurso = document.getElementById('selector-curso-global')
  if (!selCurso || ![...selCurso.options].some(o => o.value === cursoId)) return
  selCurso.value = cursoId
  actualizarMaterias()
  _elegirMateria(materiaId)
  _guardarSeleccion()
  _refrescarSeccionActual()
}

function actualizarMaterias() {
  const cursoId = document.getElementById('selector-curso-global').value
  const mats = asignaciones.filter(a => !cursoId || a.curso_id === cursoId)
    .map(a => ({ id: a.materia_id, nombre: a.materia?.nombre }))
  const unicas = [...new Map(mats.map(m=>[m.id,m])).values()]
  const sel = document.getElementById('selector-materia-global')
  sel.innerHTML = '<option value="">— Materia —</option>'
    + unicas.map(m=>`<option value="${escapeHTML(m.id)}">${escapeHTML(m.nombre)}</option>`).join('')
}

function get() {
  return {
    cursoId:   document.getElementById('selector-curso-global').value,
    materiaId: document.getElementById('selector-materia-global').value,
    periodo:   parseInt(document.getElementById('selector-periodo-global').value ?? '1')
  }
}

async function cargarEstadisticasInicio() {
  const cursos   = new Set(asignaciones.map(a=>a.curso_id)).size
  const materias = new Set(asignaciones.map(a=>a.materia_id)).size
  document.getElementById('stat-mis-cursos').textContent = cursos
  document.getElementById('stat-mis-materias').textContent = materias
  const cursosConMateriaRegular = [...new Set(asignaciones.filter(a => !a.materia?.es_tecnica).map(a => a.curso_id))]
  const materiasTecnicasIds = [...new Set(asignaciones.filter(a => a.materia?.es_tecnica).map(a => a.materia_id))]

  const idsEstudiantes = new Set()
  if (cursosConMateriaRegular.length) {
    const { data: est } = await supabase.from('estudiantes').select('id').in('curso_id', cursosConMateriaRegular)
    ;(est ?? []).forEach(e => idsEstudiantes.add(e.id))
  }
  if (materiasTecnicasIds.length) {
    const { data: insc } = await supabase.from('inscripciones_tecnicas')
      .select('estudiante_id').in('materia_id', materiasTecnicasIds).eq('activo', true)
    ;(insc ?? []).forEach(i => idsEstudiantes.add(i.estudiante_id))
  }
  document.getElementById('stat-mis-estudiantes').textContent = idsEstudiantes.size
  const r = await fetchConCache({
    key: `stat-actividades-count`,
    colegioId: perfil?.colegio_id, usuarioId: perfil?.id,
    run: async () => {
      const { count, error } = await supabase.from('actividades')
        .select('*', {count:'exact',head:true}).eq('creado_por', perfil.id)
      return { data: count, error }
    },
  })
  document.getElementById('stat-actividades').textContent = r.data ?? 0
}

// ─── ACTIVIDADES ─────────────────────────────────────────
async function cargarActividades() {
  const { cursoId, materiaId, periodo } = get()
  let q = supabase.from('actividades').select('*').eq('creado_por', perfil.id).order('created_at', {ascending:false})
  if (cursoId)   q = q.eq('curso_id', cursoId)
  if (materiaId) q = q.eq('materia_id', materiaId)
  if (periodo)   q = q.eq('trimestre', periodo)

  const { data } = await q
  const tbody = document.getElementById('tabla-actividades')

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-title">Sin actividades para este filtro</div></div></td></tr>`
    return
  }

  // Batch: qué actividades de esta lista ya tienen rúbrica armada,
  // para mostrar el chip -- una sola consulta, no una por fila.
  const { data: conRubrica } = await supabase
    .from('rubrica_criterios').select('actividad_id').in('actividad_id', data.map(a => a.id))
  const idsConRubrica = new Set((conRubrica ?? []).map(r => r.actividad_id))

  tbody.innerHTML = data.map(a => `<tr>
    <td><strong>${escapeHTML(a.titulo)}</strong>${a.descripcion?`<div class="text-sm text-muted">${escapeHTML(a.descripcion)}</div>`:''}
      ${idsConRubrica.has(a.id) ? `<span class="badge" style="background:#eef2ff;color:#4f46e5;margin-left:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17l2 2 4-4"/></svg>Rúbrica</span>` : ''}
    </td>
    <td><span class="badge badge-info">${Config.nombreDimension(a.tipo)}</span></td>
    <td>${a.max_puntos} pts</td>
    <td>${Config.nombrePeriodo} ${a.trimestre}</td>
    <td class="text-sm text-muted">${a.fecha_limite ? new Date(a.fecha_limite).toLocaleDateString('es-BO') : '—'}</td>
    <td>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="abrirModalNotas('${a.id}')">✏️ Calificar</button>
        <button class="btn btn-secondary btn-sm" onclick="editarActividad('${a.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="eliminarActividad('${a.id}')">Eliminar</button>
      </div>
    </td>
  </tr>`).join('')
}

function poblarDimensionesModal() {
  const sel = document.getElementById('act-tipo')
  const dims = Config.dimensiones.filter(d => d.tipo === 'actividades')
  sel.innerHTML = dims.map(d=>`<option value="${d.codigo}">${d.nombre} (${d.peso_maximo} pts)</option>`).join('')
  sel.addEventListener('change', actualizarPuntosModal)
  actualizarPuntosModal()
}

function actualizarPuntosModal() {
  const codigo = document.getElementById('act-tipo')?.value
  const peso   = Config.pesoDimension(codigo)
  const input  = document.getElementById('act-puntos')
  if (input) input.value = peso
}

function poblarPeriodosModal() {
  const sel = document.getElementById('act-periodo')
  if (sel) sel.innerHTML = Config.periodos.map(p=>`<option value="${p.numero}">${p.nombre}</option>`).join('')
  const lbl = document.getElementById('act-periodo-label')
  if (lbl) lbl.textContent = Config.nombrePeriodo + ' *'
}

window.abrirModalActividad = function() {
  const { cursoId, materiaId, periodo } = get()
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia en los selectores de arriba', 'warning'); return }
  document.getElementById('act-id').value = ''
  document.getElementById('act-titulo').value = ''
  document.getElementById('act-descripcion').value = ''
  document.getElementById('act-fecha').value = ''
  document.getElementById('act-periodo').value = periodo || '1'
  const _tardia = document.getElementById('act-tardia'); if (_tardia) _tardia.checked = false
  const _tardiaWrap = document.getElementById('act-tardia-wrap'); if (_tardiaWrap) _tardiaWrap.style.display = window.APP_CONFIG?.permite_entrega_tareas ? '' : 'none'
  window._actTardiaOriginal = false
  const fin = document.getElementById('act-archivo')
  if (fin) fin.value = ''
  const actArchivoActual = document.getElementById('act-archivo-actual')
  if (actArchivoActual) { actArchivoActual.style.display = 'none'; actArchivoActual.textContent = '' }
  actualizarPuntosModal()
  document.getElementById('modal-act-titulo').textContent = 'Nueva actividad'
  document.getElementById('modal-actividad').classList.remove('hidden')
  _actualizarBotonRubrica()
}

window.editarActividad = async function(id) {
  const { data: a } = await supabase.from('actividades').select('*').eq('id',id).single()
  if (!a) return
  document.getElementById('act-id').value = id
  document.getElementById('act-titulo').value = a.titulo
  document.getElementById('act-descripcion').value = a.descripcion ?? ''
  document.getElementById('act-tipo').value = a.tipo
  document.getElementById('act-puntos').value = a.max_puntos
  document.getElementById('act-periodo').value = a.trimestre
  document.getElementById('act-fecha').value = a.fecha_limite ?? ''
  document.getElementById('act-hora').value = a.hora_limite ?? ''
  const _tardia = document.getElementById('act-tardia'); if (_tardia) _tardia.checked = a.permite_entrega_tardia === true
  const _tardiaWrap = document.getElementById('act-tardia-wrap'); if (_tardiaWrap) _tardiaWrap.style.display = window.APP_CONFIG?.permite_entrega_tareas ? '' : 'none'
  window._actTardiaOriginal = a.permite_entrega_tardia === true
  document.getElementById('modal-act-titulo').textContent = 'Editar actividad'
  document.getElementById('modal-actividad').classList.remove('hidden')

      const actArchivoActual = document.getElementById('act-archivo-actual')
  const fin = document.getElementById('act-archivo')
  if (fin) fin.value = ''
  if (actArchivoActual) {
    if (a.archivo_consigna_url) {
      actArchivoActual.style.display = 'block'
      actArchivoActual.innerHTML = `📎 <a href="${a.archivo_consigna_url}" target="_blank" rel="noopener" style="color:#15803d;font-weight:600;">Ver archivo adjunto</a> — selecciona uno nuevo para reemplazar`
      _setQuitarArchivoVisible(true)
    } else {
      actArchivoActual.style.display = 'none'
      actArchivoActual.innerHTML = ''
      _setQuitarArchivoVisible(false)
    }
  }
  _actualizarBotonRubrica()
}
function _setQuitarArchivoVisible(visible) {
  const btn = document.getElementById('btn-quitar-archivo-consigna')
  if (btn) btn.style.display = visible ? 'inline-flex' : 'none'
}


window.quitarArchivoConsigna = async function () {
  const id = document.getElementById('act-id')?.value
  const fin = document.getElementById('act-archivo')
  const out = document.getElementById('act-archivo-actual')

  // Aún no guardada: solo limpia UI
  if (!id) {
    if (fin) fin.value = ''
    if (out) { out.style.display = 'none'; out.innerHTML = '' }
    _setQuitarArchivoVisible(false)
    toast('Archivo quitado', 'success')
    return
  }

  const { count, error } = await supabase
    .from('notas')
    .select('id', { count: 'exact', head: true })
    .eq('actividad_id', id)
  if (error) { toast(error.message, 'error'); return }

  if ((count ?? 0) > 0) {
    toast('No se puede quitar el archivo: esta actividad ya tiene notas registradas', 'warning')
    return
  }

  const { error: errUp } = await supabase
    .from('actividades')
    .update({ archivo_consigna_url: null })
    .eq('id', id)
  if (errUp) { toast(errUp.message, 'error'); return }

  if (fin) fin.value = ''
  if (out) { out.style.display = 'none'; out.innerHTML = '' }
  _setQuitarArchivoVisible(false)
  toast('Archivo adjunto eliminado', 'success')
}
document.getElementById('act-archivo')?.addEventListener('change', function () {
  const out = document.getElementById('act-archivo-actual')
  if (!out) return
  const f = this.files?.[0]
  if (!f) { out.style.display = 'none'; out.textContent = ''; return }
  if (f.size > 10 * 1024 * 1024) {
    toast('Máximo 10MB', 'warning')
    this.value = ''
    out.style.display = 'none'
    return
  }
    const url = URL.createObjectURL(f)
  out.style.display = 'block'
  out.innerHTML = `📎 <a href="${url}" target="_blank" rel="noopener" style="color:#15803d;font-weight:600;">${f.name}</a> (${(f.size / 1024).toFixed(0)} KB)`
  _setQuitarArchivoVisible(true)
})

window.guardarActividad = async function() {
  const id       = document.getElementById('act-id').value
  const titulo   = document.getElementById('act-titulo').value.trim()
  const tipo     = document.getElementById('act-tipo').value
  const puntos   = parseFloat(document.getElementById('act-puntos').value)
  const periodo  = parseInt(document.getElementById('act-periodo').value)
  
  const fecha    = document.getElementById('act-fecha').value || null
  const hora     = document.getElementById('act-hora').value || null
  const desc     = document.getElementById('act-descripcion').value.trim() || null
  const { cursoId, materiaId } = get()

  if (!titulo) { toast('El título es obligatorio', 'warning'); return }

  // Validar trimestre activo
  if (!id && periodo !== Config.trimestreActivo) {
    toast(`Solo podés crear actividades en el ${Config.nombrePeriodo} ${Config.trimestreActivo} (activo). Cambiá el selector.`, 'warning')
    return
  }

  mostrarLoader('Guardando actividad...')

  // Subir archivo consigna si se seleccionó uno
  let archivoConsignaUrl = null
  const archivoInput = document.getElementById('act-archivo')
  const archivoFile  = archivoInput?.files?.[0]
  if (archivoFile) {
    // Consigna al mismo almacenamiento que las entregas de los estudiantes (almacenamiento.js).
    // El bucket "tareas" de Supabase es privado: sus direcciones públicas no abren.
    try {
      archivoConsignaUrl = await subirArchivoTarea(archivoFile, 'consignas')
    } catch (e) {
      ocultarLoader()
      toast('No se pudo subir el archivo: ' + e.message, 'error')
      return
    }
  }

  const payload = { titulo, tipo, max_puntos: puntos, trimestre: periodo, fecha_limite: fecha, hora_limite: hora,
    descripcion: desc, curso_id: cursoId, materia_id: materiaId, creado_por: perfil.id,
    archivo_consigna_url: archivoConsignaUrl ?? undefined }
  // Entrega tardía (migración 111). Solo se envía si está marcada, o si estaba marcada y ahora se desmarca:
  // así, si alguien guarda actividades sin haber corrido la migración, nada cambia.
  const tardia = !!document.getElementById('act-tardia')?.checked
  if (tardia || window._actTardiaOriginal === true) payload.permite_entrega_tardia = tardia

  const { data: guardada, error } = id
    ? await supabase.from('actividades').update(payload).eq('id', id).select('id').single()
    : await supabase.from('actividades').insert(payload).select('id').single()

  ocultarLoader()
  if (error) { toast(error.message, 'error'); return }
  if (typeof window._vcRefrescar === 'function') window._vcRefrescar()

  if (!id && guardada) {
    // Recién creada: se pregunta explícitamente cómo se calificará (antes quedaba abierta en silencio)
    document.getElementById('act-id').value = guardada.id
    document.getElementById('modal-act-titulo').textContent = 'Editar actividad'
    _actualizarBotonRubrica()
    const conRubrica = await confirmar(
      '✓ Actividad creada',
      '¿Calificarás esta actividad con rúbrica (por criterios)? Si eliges "No", se califica con una sola nota.',
      'Sí, armar rúbrica', 'No, nota directa', 'exito')
    if (conRubrica) { window.abrirModalRubrica(); return }
    document.getElementById('modal-actividad').classList.add('hidden')
    toast('Actividad lista. Se calificará con nota directa.', 'success')
  } else {
    document.getElementById('modal-actividad').classList.add('hidden')
    toast('Actividad actualizada', 'success')
  }
}

window.eliminarActividad = async function(id) {
  if (!await confirmar('Eliminar actividad', '¿Eliminar esta actividad? También se eliminarán las notas registradas.')) return
  await supabase.from('actividades').delete().eq('id', id)
  toast('Actividad eliminada', 'success'); cargarActividades()
}

// ─── MODAL REGISTRO DE NOTAS ─────────────────────────────
// Nota: esta pantalla es de edición (requiere internet). No se conecta
// al motor offline a propósito, para no inducir a calificar sin conexión.
window.abrirModalNotas = async function(actividadId) {
  mostrarLoader('Cargando...')
  const { cursoId } = get()

  const { data: act } = await supabase.from('actividades')
    .select('*, materia:materias(es_tecnica)')
    .eq('id', actividadId).single()

  const esTecnica = act?.materia?.es_tecnica === true

  const [{ data: rawEstudiantes }, { data: notasExist }] = await Promise.all([
    esTecnica
      ? supabase.from('inscripciones_tecnicas')
          .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
          .eq('materia_id', act.materia_id)
          .eq('activo', true)
          .in('estudiantes.curso_id', await cursosDelGrado(act.curso_id ?? cursoId))
      : supabase.from('estudiantes')
          .select('id, usuarios(nombre_completo)')
          .eq('curso_id', cursoId),
    supabase.from('notas').select('estudiante_id, valor, observaciones').eq('actividad_id', actividadId)
  ])

  const estudiantes = esTecnica
    ? (rawEstudiantes ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios }))
    : (rawEstudiantes ?? [])

  const perfilMap = {}
  ;(estudiantes ?? []).forEach(e => perfilMap[e.id] = e.usuarios?.nombre_completo)

  const notasMap = {}
  ;(notasExist ?? []).forEach(n => { notasMap[n.estudiante_id] = { valor: n.valor, obs: n.observaciones ?? '' } })

  // ¿Esta actividad tiene rúbrica armada? Si sí, cada fila ofrece
  // además el botón de calificar por criterios -- el input numérico
  // sigue disponible siempre, la elección es por estudiante.
  const { data: rubricaCriterios } = await supabase
    .from('rubrica_criterios').select('*').eq('actividad_id', actividadId).order('orden')
  const tieneRubrica = !!(rubricaCriterios && rubricaCriterios.length)
  _rubricaCriteriosNotas = rubricaCriterios ?? []
  _rubricaMaxPuntosNotas = act?.max_puntos ?? 0
  _perfilesNotasMap = perfilMap

  ocultarLoader()

  const sorted = (estudiantes ?? []).sort((a,b) => (perfilMap[a.id]??'').localeCompare(perfilMap[b.id]??''))

  document.getElementById('modal-notas-titulo').textContent = act?.titulo ?? 'Registrar Notas'
  document.getElementById('modal-notas-info').textContent =
    `${act?.descripcion ?? ''} | Máx: ${act?.max_puntos} pts | ${Config.nombreDimension(act?.tipo)} | ${Config.nombrePeriodo} ${act?.trimestre}`
  _ayudaModalNotas(tieneRubrica)

  document.getElementById('tabla-notas-body').innerHTML = sorted.map((e, i) => {
    const n = notasMap[e.id]
    return `<tr style="background:${i % 2 === 0 ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))' : 'var(--color-surface, #ffffff)'};">
      <td style="padding:8px;font-size:13px;">${i+1}</td>
      <td style="padding:8px;font-size:13px;font-weight:500;">${escapeHTML(perfilMap[e.id] ?? 'Sin nombre')}</td>
      <td style="padding:8px;">
        <input type="number" class="nota-input-modal" data-est="${escapeHTML(e.id)}"
          data-original="${n?.valor ?? ''}"
          min="0" max="${act?.max_puntos}" step="0.01"
          value="${n?.valor ?? ''}" placeholder="—"
          style="width:90px;padding:6px;border:1px solid var(--color-border);border-radius:6px;text-align:center;">
      </td>
      <td style="padding:8px;text-align:center;">
        <input type="hidden" class="obs-input-modal" data-est="${escapeHTML(e.id)}" data-original="${escapeHTML(n?.obs ?? '')}" value="${escapeHTML(n?.obs ?? '')}">
        <button type="button" id="obs-icono-${escapeHTML(e.id)}" title="${n?.obs ? 'Ver/editar comentario' : 'Agregar comentario'}"
          onclick="window._abrirComentarioNota('${escapeHTML(e.id)}')"
          style="background:none;border:none;cursor:pointer;padding:4px;color:${n?.obs ? '#f59e0b' : '#94a3b8'};">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </button>
      </td>
      <td style="padding:8px;">
        <div style="display:flex;gap:1mm;align-items:center;">
          <button class="btn btn-success btn-sm" title="Guardar la nota de este estudiante" onclick="guardarNotaIndividual('${actividadId}', '${e.id}', ${act?.max_puntos})">💾</button>
          ${tieneRubrica ? `<button class="btn btn-sm" title="Calificar con rúbrica" onclick="window._abrirCalifRubricaDesdeNotas('${actividadId}','${e.id}')" style="background:var(--color-primary);color:#fff;margin-left:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></button>` : ''}
        </div>
      </td>
      <td style="padding:8px;">
        <span class="badge ${n?.valor != null ? 'badge-success' : 'badge-neutral'}" id="estado-nota-${e.id}">
          ${n?.valor != null ? `✓ ${n.valor}` : 'Sin nota'}
        </span>
      </td>
    </tr>`
  }).join('')

  document.getElementById('btn-guardar-todas-notas').onclick = () => guardarTodasNotas(actividadId, act?.max_puntos)
  document.getElementById('modal-notas').classList.remove('hidden')
  window._rubricaGuardadaCallback = () => {
    abrirModalNotas(actividadId)
    if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
  }
}

// Leyenda corta (siempre visible) + "¿Cómo calificar?" plegable (recuerda si se dejó abierto)
const _IC_GUARDAR = '<span style="display:inline-flex;align-items:center;justify-content:center;background:var(--color-success,#10b981);border-radius:5px;padding:1px 5px;font-size:11px;">💾</span>'
const _IC_RUBRICA = '<span style="display:inline-flex;align-items:center;justify-content:center;background:var(--color-primary);color:#fff;border-radius:5px;padding:2px 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></span>'
const _IC_OBS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" style="vertical-align:-2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
function _ayudaModalNotas(tieneRubrica) {
  const body = document.querySelector('#modal-notas .modal-body')
  if (!body) return
  body.querySelector('#notas-ayuda')?.remove()
  let abierta = false
  try { abierta = localStorage.getItem('ayuda_notas_abierta') === '1' } catch (_) {}
  const item = (t) => `<li style="margin:3px 0;">${t}</li>`
  body.insertAdjacentHTML('afterbegin', `
    <div id="notas-ayuda" style="margin-bottom:12px;font-size:12.5px;line-height:1.5;">
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;color:var(--color-text-2);">
        <span>${_IC_GUARDAR} Guardar nota</span>
        ${tieneRubrica ? `<span>${_IC_RUBRICA} Calificar con rúbrica</span>` : ''}
        <span>${_IC_OBS} Observación</span>
        <span><b>Guardar todas</b> (abajo) guarda en bloque</span>
      </div>
      <details id="notas-ayuda-det" ${abierta ? 'open' : ''} style="margin-top:6px;">
        <summary style="cursor:pointer;color:var(--color-primary);font-weight:600;">¿Cómo calificar?</summary>
        <ul style="margin:6px 0 0;padding-left:18px;color:var(--color-text-2);">
          ${item(`<b>Nota directa:</b> escribe la nota y toca ${_IC_GUARDAR}, o <b>Guardar todas</b>.`)}
          ${tieneRubrica ? item(`<b>Con rúbrica:</b> toca ${_IC_RUBRICA} y marca un nivel por criterio.`) : ''}
          ${item(`<b>Borrar una nota:</b> vacía la casilla y toca ${_IC_GUARDAR}.`)}
          ${item(`<b>Observación:</b> toca ${_IC_OBS}.`)}
          ${item(`<b>¿Prefieres llenar las notas en Excel, sin internet?</b> <i>Opcional, solo para nota directa:</i> con internet toca <b>Exportar Excel</b>, llena las notas sin internet y luego, con internet, toca <b>Importar Excel</b> (solo llena notas vacías). <b>Con rúbrica</b> se califica siempre en la plataforma.`)}
        </ul>
      </details>
    </div>`)
  body.querySelector('#notas-ayuda-det').addEventListener('toggle', e => {
    try { localStorage.setItem('ayuda_notas_abierta', e.target.open ? '1' : '0') } catch (_) {}
  })
}

window._abrirComentarioNota = function(estudianteId) {
  const input = document.querySelector(`.obs-input-modal[data-est="${estudianteId}"]`)
  const actual = input?.value ?? ''
  const overlay = document.createElement('div')
  overlay.id = 'obs-nota-overlay'
  Object.assign(overlay.style, {
    position:'fixed', inset:'0', zIndex:'100000', display:'flex',
    alignItems:'center', justifyContent:'center', backgroundColor:'rgba(15,23,42,0.5)', padding:'16px'
  })
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:400px;width:100%;padding:18px;">
      <h4 style="margin:0 0 4px;font-size:14px;font-weight:700;">Comentario para el estudiante y su familia</h4>
      <p style="margin:0 0 10px;font-size:12px;color:#64748b;">Opcional. Se muestra junto a la nota y a esta actividad en el panel del estudiante: escribe qué se evaluó o qué debe mejorar. Recuerda presionar 💾 (o «Guardar todos») para guardarlo.</p>
      <textarea id="obs-nota-textarea" rows="4" placeholder="Escribe un comentario..."
        style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:13px;resize:vertical;">${escapeHTML(actual)}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
        <button onclick="document.getElementById('obs-nota-overlay').remove()" style="padding:7px 14px;font-size:12px;font-weight:600;background:#f1f5f9;color:#475569;border:none;border-radius:6px;cursor:pointer;">Cancelar</button>
        <button onclick="window._guardarComentarioNota('${estudianteId}')" style="padding:7px 14px;font-size:12px;font-weight:600;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;">Guardar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  overlay.querySelector('textarea').focus()
}

window._guardarComentarioNota = function(estudianteId) {
  const texto = document.getElementById('obs-nota-textarea').value
  const input = document.querySelector(`.obs-input-modal[data-est="${estudianteId}"]`)
  if (input) input.value = texto
  const icono = document.getElementById(`obs-icono-${estudianteId}`)
  if (icono) {
    icono.style.color = texto.trim() ? '#f59e0b' : '#94a3b8'
    icono.title = texto.trim() ? 'Ver/editar comentario' : 'Agregar comentario'
  }
  document.getElementById('obs-nota-overlay')?.remove()
}

window._abrirCalifRubricaDesdeNotas = function(actividadId, estudianteId) {
  const nombreEstudiante = _perfilesNotasMap[estudianteId] ?? 'Estudiante'
  window._calificarConRubrica(actividadId, estudianteId, nombreEstudiante, _rubricaMaxPuntosNotas, _rubricaCriteriosNotas)
}

window.guardarNotaIndividual = async function(actividadId, estudianteId, maxPuntos) {
  // Validar trimestre activo
  const { data: act } = await supabase.from('actividades').select('trimestre').eq('id', actividadId).single()
  if (act && act.trimestre !== Config.trimestreActivo) {
    toast(`Esta actividad pertenece al ${Config.nombrePeriodo} ${act.trimestre}. Solo podés calificar en el ${Config.nombrePeriodo} ${Config.trimestreActivo} (activo).`, 'warning')
    return
  }

  maxPuntos = parseFloat(maxPuntos)
  const input    = document.querySelector(`.nota-input-modal[data-est="${estudianteId}"]`)
  const obsInput = document.querySelector(`.obs-input-modal[data-est="${estudianteId}"]`)
  const val = input?.value?.trim()
  if (val === '') {
    const { error: errDel } = await supabase.rpc('rpc_delete_nota', {
      p_actividad_id: actividadId,
      p_estudiante_id: estudianteId
    })
    if (errDel) { toast(errDel.message, 'error'); return }
    if (input) input.value = ''
    const badge = document.getElementById(`estado-nota-${estudianteId}`)
    if (badge) { badge.textContent = 'Sin nota'; badge.className = 'badge badge-neutral' }
    toast('Nota eliminada', 'success')
    if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
    return
  }
  const num = parseFloat(val)
  if (isNaN(num) || num < 0 || num > maxPuntos) { toast(`Nota fuera de rango (0 - ${maxPuntos})`, 'error'); return }

  const valorOriginal = input?.dataset?.original ?? ''
  const cambioDeVerdad = valorOriginal === '' || parseFloat(valorOriginal) !== num

  const { data: notaGuardada, error } = await supabase.from('notas').upsert({
    actividad_id: actividadId, estudiante_id: estudianteId,
    valor: num, observaciones: obsInput?.value?.trim() || null, creado_por: perfil.id
  }, { onConflict: ['actividad_id', 'estudiante_id'] }).select('id').single()

  if (error) { toast(error.message, 'error'); return }
  // Solo limpiar el desglose de rúbrica si el número realmente cambió --
  // si el profesor guardó sin tocar la nota (por ejemplo, solo editó el
  // comentario), el desglose que ya tenía se conserva intacto.
  if (notaGuardada && cambioDeVerdad) {
    await supabase.from('rubrica_calificaciones').delete().eq('nota_id', notaGuardada.id)
  }
  if (input) input.dataset.original = String(num)
  if (obsInput) obsInput.dataset.original = obsInput.value
  const estado = document.getElementById(`estado-nota-${estudianteId}`)
  if (estado) { estado.className = 'badge badge-success'; estado.textContent = `✓ ${num}` }
  toast('Nota guardada', 'success')
  if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
}

window.guardarTodasNotas = async function(actividadId, maxPuntos) {
  // Validar trimestre activo
  const { data: act } = await supabase.from('actividades').select('trimestre').eq('id', actividadId).single()
  if (act && act.trimestre !== Config.trimestreActivo) {
    toast(`Esta actividad pertenece al ${Config.nombrePeriodo} ${act.trimestre}. Solo podés calificar en el ${Config.nombrePeriodo} ${Config.trimestreActivo} (activo).`, 'warning')
    return
  }

  const inputs = document.querySelectorAll('.nota-input-modal')
  const notas  = []

  for (const inp of inputs) {
    const val = inp.value.trim()
    if (val === '') continue
    const original = inp.dataset.original ?? ''
    const obsInput = document.querySelector(`.obs-input-modal[data-est="${inp.dataset.est}"]`)
    const obsCambio = (obsInput?.value ?? '').trim() !== (obsInput?.dataset.original ?? '').trim()
    // sin cambios (ni nota ni comentario) -- no se toca ni se limpia el desglose de rúbrica
    if (val === original && !obsCambio) continue
    const num = parseFloat(val)
    if (isNaN(num) || num < 0 || num > maxPuntos) { toast(`Nota fuera de rango (0 - ${maxPuntos})`, 'error'); return }
    notas.push({ estudiante_id: inp.dataset.est, valor: num, observaciones: obsInput?.value?.trim() || null, soloComentario: val === original })
  }

  if (!notas.length) { toast('No hay notas para guardar', 'info'); return }

  mostrarLoader(`Guardando ${notas.length} notas...`)
  const payload = notas.map(n => ({
    actividad_id: actividadId, estudiante_id: n.estudiante_id,
    valor: n.valor, observaciones: n.observaciones, creado_por: perfil.id
  }))

  const { data: notasGuardadas, error } = await supabase.from('notas')
    .upsert(payload, { onConflict: ['actividad_id', 'estudiante_id'] })
    .select('id, estudiante_id')
  ocultarLoader()
  if (error) { toast(error.message, 'error'); return }

  // Limpieza: cualquiera de estas notas que tuviera desglose de rúbrica
  // de una calificación anterior queda huérfano tras sobrescribir a mano.
  // (si solo cambió el comentario, el desglose de rúbrica se conserva)
  if (notasGuardadas?.length) {
    const idsPorEst = new Map(notas.map(n => [n.estudiante_id, n.soloComentario]))
    const aLimpiar = notasGuardadas.filter(g => !idsPorEst.get(g.estudiante_id)).map(g => g.id)
    if (aLimpiar.length) await supabase.from('rubrica_calificaciones').delete().in('nota_id', aLimpiar)
  }

  notas.forEach(n => {
    const estado = document.getElementById(`estado-nota-${n.estudiante_id}`)
    if (estado) { estado.className = 'badge badge-success'; estado.textContent = `✓ ${n.valor}` }
    const inp = document.querySelector(`.nota-input-modal[data-est="${n.estudiante_id}"]`)
    if (inp) inp.dataset.original = String(n.valor)
    const oi = document.querySelector(`.obs-input-modal[data-est="${n.estudiante_id}"]`)
    if (oi) oi.dataset.original = oi.value
  })
  toast(`${notas.length} notas guardadas`, 'success')
  if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
}

// ─── REGISTRO DE NOTAS (sección) ─────────────────────────
async function poblarActividadesNotas() {
  const callId = ++_notasCallId
  const selCurso = document.getElementById('selector-curso-global')
  const selMat   = document.getElementById('selector-materia-global')
  if (!selCurso.value && selCurso.options.length > 1) { selCurso.selectedIndex = 1; actualizarMaterias() }
  if (!selMat.value && selMat.options.length > 1) selMat.selectedIndex = 1

  const { cursoId, materiaId, periodo } = get()
  if (!cursoId || !materiaId) return

  let q = supabase.from('actividades').select('id,titulo,tipo,max_puntos,trimestre')
    .eq('creado_por', perfil.id).eq('curso_id', cursoId).eq('materia_id', materiaId)
  if (periodo) q = q.eq('trimestre', periodo)

  const { data } = await q.order('created_at', {ascending:false})
  if (callId !== _notasCallId) return

  const sel = document.getElementById('sel-actividad-notas')
  sel.innerHTML = '<option value="">Selecciona actividad</option>'
    + (data??[]).map(a=>`<option value="${a.id}">${a.titulo} — ${Config.nombreDimension(a.tipo)} (${a.max_puntos} pts)</option>`).join('')
}

window.cargarNotasActividad = async function() {
  const actId = document.getElementById('sel-actividad-notas').value
  if (!actId) { toast('Selecciona una actividad', 'warning'); return }
  abrirModalNotas(actId)
}

// ─── FICHA SER ───────────────────────────────────────────
async function cargarEstudiantesDelCurso() {
  const { cursoId, materiaId } = get()
  if (!cursoId) return

  const { data: materiaInfo } = materiaId
    ? await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    : { data: null }
  const esTecnica = materiaInfo?.es_tecnica === true

  const r = esTecnica
    ? await fetchConCache({
        key: `estudiantes-tecnica:${materiaId}:${cursoId}`,
        colegioId: perfil?.colegio_id, usuarioId: perfil?.id,
        run: async () => {
          const { data, error } = await supabase.from('inscripciones_tecnicas')
            .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
            .eq('materia_id', materiaId).eq('activo', true).in('estudiantes.curso_id', await cursosDelGrado(cursoId))
          return {
            data: (data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios })),
            error
          }
        },
      })
    : await fetchConCache({
        key: `estudiantes-curso:${cursoId}`,
        colegioId: perfil?.colegio_id, usuarioId: perfil?.id,
        run: () => supabase.from('estudiantes')
          .select('id, usuarios(nombre_completo)').eq('curso_id', cursoId),
      })

  const sel = document.getElementById('ser-estudiante')
  sel.innerHTML = '<option value="">Selecciona estudiante</option>'
    + (r.data??[]).sort((a,b)=>(a.usuarios?.nombre_completo??'').localeCompare(b.usuarios?.nombre_completo??''))
        .map(e=>`<option value="${e.id}">${e.usuarios?.nombre_completo ?? 'Sin nombre'}</option>`).join('')
}

window.cargarHistorialFicha = async function() {
  const estId = document.getElementById('ser-estudiante').value
  if (!estId) { toast('Selecciona un estudiante', 'warning'); return }

  const r = await fetchConCache({
    key: `fichas-ser:${estId}:${Config.año}`,
    colegioId: perfil?.colegio_id, usuarioId: perfil?.id,
    run: () => supabase.from('fichas_seguimiento_ser')
      .select('id, fecha, nota_calculada, publicada, obs_general')
      .eq('estudiante_id', estId).eq('año', Config.año)
      .order('fecha', {ascending:false}),
  })
  const fichas = r.data

  const panel = document.getElementById('panel-ser')
  if (!fichas?.length) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div>
      <div class="empty-state-title">Sin fichas SER para este estudiante</div>
      <div class="empty-state-desc">Crea la primera ficha con el botón "+ Nueva ficha"</div></div>`
    return
  }

  panel.innerHTML = `
    ${r.offline ? avisoOfflineInline() : ''}
    <div class="card" style="padding:0;"><div class="table-wrapper"><table>
    <thead><tr><th>Fecha</th><th>Nota SER</th><th>Estado</th><th>Obs. General</th><th>Acciones</th></tr></thead>
    <tbody>${fichas.map(f=>`<tr>
      <td>${new Date(f.fecha).toLocaleDateString('es-BO')}</td>
      <td><strong>${f.nota_calculada} / ${Config.pesoDimension('ser')}</strong></td>
      <td><span class="badge ${f.publicada?'badge-success':'badge-neutral'}">${f.publicada?'Publicada':'Borrador'}</span></td>
      <td class="text-sm text-muted">${f.obs_general ? f.obs_general.substring(0,60)+'...' : '—'}</td>
      <td>
        <div style="display:flex;gap:6px;">
          ${!f.publicada ? `<button class="btn btn-success btn-sm" onclick="publicarFicha('${f.id}')">Publicar</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="verDetalleFicha('${f.id}')">Ver</button>
        </div>
      </td>
    </tr>`).join('')}</tbody>
  </table></div></div>`
}

window.abrirNuevaFicha = function() {
  const estId = document.getElementById('ser-estudiante').value
  if (!estId) { toast('Selecciona un estudiante primero', 'warning'); return }

  const grupos = Config.subcriteriosPorCategoria()
  const escala = Config.escalaSer
  if (!grupos.length) { toast('No hay subcriterios SER configurados', 'error'); return }

  const body = document.getElementById('body-ficha-ser')
  body.innerHTML = `
    ${grupos.map(g=>`
      <div style="margin-bottom:24px;">
        <h3 style="font-size:14px;font-weight:600;color:var(--color-primary);margin-bottom:12px;">${escapeHTML(g.categoria)}</h3>
        ${g.items.map(s=>`
          <div style="margin-bottom:12px;padding:12px;background:var(--color-surface-2);border-radius:var(--radius-md);">
            <p style="font-size:13.5px;font-weight:500;margin-bottom:8px;">${escapeHTML(s.texto)}</p>
            ${s.descripcion ? `<p class="text-sm text-muted" style="margin-bottom:8px;">${escapeHTML(s.descripcion)}</p>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${escala.map(e=>`
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:13px;">
                  <input type="radio" name="ser_${s.subcriterio_id}" value="${e.valor}" style="width:auto;">
                  ${e.etiqueta} (${e.valor})
                </label>`).join('')}
            </div>
          </div>`).join('')}
        <div class="form-group" style="margin-top:8px;">
          <label style="font-size:12px;">Observaciones sobre ${escapeHTML(g.categoria)}</label>
          <textarea id="obs_${g.categoria_id}" rows="2" placeholder="Opcional..."></textarea>
        </div>
      </div>`).join('')}
    <div class="form-group">
      <label>Observaciones generales</label>
      <textarea id="obs_general_ficha" rows="3" placeholder="Comentarios generales..."></textarea>
    </div>
    <div style="text-align:center;padding:16px;background:var(--color-surface-2);border-radius:var(--radius-md);">
      <div class="text-sm text-muted">Nota SER calculada</div>
      <div id="nota-ser-display" style="font-size:32px;font-weight:700;color:var(--color-primary);">—</div>
      <div class="text-sm text-muted">de ${Config.pesoDimension('ser')} puntos</div>
    </div>`

  body.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', calcularNotaSer))
  document.getElementById('modal-ficha-ser').classList.remove('hidden')
}

function calcularNotaSer() {
  const grupos = Config.subcriteriosPorCategoria()
  const vals = []
  for (const g of grupos) {
    for (const s of g.items) {
      const sel = document.querySelector(`input[name="ser_${s.subcriterio_id}"]:checked`)
      if (sel) vals.push(parseFloat(sel.value))
    }
  }
  const totalSubs = grupos.reduce((sum, g) => sum + g.items.length, 0)
  const display = document.getElementById('nota-ser-display')
  if (!display) return
  if (vals.length === totalSubs && totalSubs > 0) {
    const nota = Math.round(vals.reduce((a,b)=>a+b,0) / totalSubs * 10) / 10
    display.textContent = nota
    display.style.color = nota >= 7 ? 'var(--color-success)' : nota >= 4 ? 'var(--color-warning)' : 'var(--color-error)'
  } else {
    display.textContent = '—'
    display.style.color = 'var(--color-primary)'
  }
}

window.guardarFichaSer = async function() {
  const estId = document.getElementById('ser-estudiante').value
  const { materiaId, cursoId, periodo } = get()
  if (!estId || !materiaId) { toast('Selecciona estudiante y materia', 'warning'); return }

  const grupos = Config.subcriteriosPorCategoria()
  const valores = {}, obsCateg = {}

  for (const g of grupos) {
    for (const s of g.items) {
      const sel = document.querySelector(`input[name="ser_${s.subcriterio_id}"]:checked`)
      if (!sel) { toast('Completa todos los subcriterios', 'warning'); return }
      valores[s.subcriterio_id] = parseFloat(sel.value)
    }
    const obsEl = document.getElementById(`obs_${g.categoria_id}`)
    if (obsEl?.value?.trim()) obsCateg[g.categoria_id] = obsEl.value.trim()
  }

  const allVals = Object.values(valores)
  const nota = Math.round(allVals.reduce((a,b)=>a+b,0) / allVals.length * 10) / 10
  const obsGen = document.getElementById('obs_general_ficha')?.value?.trim() || null

  mostrarLoader('Guardando ficha SER...')
  const { error } = await supabase.from('fichas_seguimiento_ser').insert({
    estudiante_id: estId, materia_id: materiaId, curso_id: cursoId,
    profesor_id: perfil.id, trimestre: periodo, año: Config.año,
    valores, observaciones: obsCateg, obs_general: obsGen,
    nota_calculada: nota, publicada: false
  })
  ocultarLoader()
  if (error) { toast(error.message, 'error'); return }
  toast(`Ficha guardada. Nota SER: ${nota}`, 'success')
  document.getElementById('modal-ficha-ser').classList.add('hidden')
  cargarHistorialFicha()
}

window.publicarFicha = async function(fichaId) {
  if (!await confirmar('Publicar ficha SER', 'Al publicar, la nota SER se actualizará en el registro oficial. ¿Confirmas?')) return
  mostrarLoader('Publicando ficha...')
  const { data, error } = await supabase.rpc('rpc_publish_ficha', { p_ficha_id: fichaId })
  ocultarLoader()
  if (error) { toast(error.message, 'error'); return }
  toast(`Ficha publicada. Nota SER: ${data?.nota_ser ?? '—'}`, 'success')
  cargarHistorialFicha()
}

window.verDetalleFicha = async function(fichaId) {
  const { data: f } = await supabase.from('fichas_seguimiento_ser').select('*').eq('id', fichaId).single()
  if (!f) return

  const grupos = Config.subcriteriosPorCategoria()
  let html = `<div class="card"><div class="card-title">Detalle Ficha SER</div>
    <div class="flex-between" style="margin-bottom:16px;">
      <div>Fecha: ${new Date(f.fecha).toLocaleDateString('es-BO')}</div>
      <span class="badge ${f.publicada?'badge-success':'badge-neutral'}">${f.publicada?'Publicada':'Borrador'}</span>
    </div>`

  for (const g of grupos) {
    html += `<h4 style="font-size:13px;font-weight:600;color:var(--color-primary);margin:12px 0 6px;">${escapeHTML(g.categoria)}</h4>
    <table style="width:100%;font-size:13px;"><tbody>`
    for (const s of g.items) {
      const val = f.valores?.[s.subcriterio_id]
      const etiq = val != null ? Config.etiquetaEscalaSer(val) : '—'
      html += `<tr><td style="padding:4px 0;">${escapeHTML(s.texto)}</td><td style="padding:4px 0;font-weight:600;">${escapeHTML(etiq)} ${val!=null?`(${val})`:''}</td></tr>`
    }
    html += `</tbody></table>`
    const obsG = f.observaciones?.[g.categoria_id]
    if (obsG) html += `<p class="text-sm text-muted" style="margin-top:4px;">Obs: ${escapeHTML(obsG)}</p>`
  }

  html += `<div style="margin-top:16px;padding:12px;background:var(--color-surface-2);border-radius:var(--radius-md);text-align:center;">
    <div class="text-sm text-muted">Nota calculada</div>
    <div style="font-size:28px;font-weight:700;color:var(--color-primary);">${f.nota_calculada} pts</div>
  </div>
  ${f.obs_general ? `<div style="margin-top:12px;"><strong class="text-sm">Obs. generales:</strong><p class="text-sm text-muted">${escapeHTML(f.obs_general)}</p></div>` : ''}
  </div>`

  document.getElementById('body-ficha-ser').innerHTML = html
  document.getElementById('modal-ficha-ser').classList.remove('hidden')
}

// ─── ASISTENCIA ──────────────────────────────────────────
function poblarFechaAsistencia() {
  const hoy = fechaLocal()
  const inp = document.getElementById('fecha-asistencia')
  if (inp) inp.value = hoy
}

window.cargarListaAsistencia = async function() {
  const { cursoId, materiaId } = get()
  const fecha = document.getElementById('fecha-asistencia')?.value
  if (!cursoId || !materiaId || !fecha) { toast('Selecciona curso, materia y fecha', 'warning'); return }

  const hoy = fechaLocal()
  const esFechaHoy = fecha === hoy

  mostrarLoader('Cargando asistencia...')

  const colegioId = perfil?.colegio_id
  const usuarioId = perfil?.id

  const { data: materiaInfo } = materiaId
    ? await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    : { data: null }
  const esTecnica = materiaInfo?.es_tecnica === true

  const [rEstsRaw, rRegs] = await Promise.all([
    esTecnica
      ? fetchConCache({
          key: `estudiantes-tecnica:${materiaId}:${cursoId}`,
          colegioId, usuarioId,
          run: async () => {
            const { data, error } = await supabase.from('inscripciones_tecnicas')
              .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
              .eq('materia_id', materiaId).eq('activo', true).in('estudiantes.curso_id', await cursosDelGrado(cursoId))
            return {
              data: (data ?? []).map(i => ({ id: i.estudiante_id, curso_id: i.estudiantes?.curso_id, usuarios: i.estudiantes?.usuarios })),
              error
            }
          },
        })
      : fetchConCache({
          key: `estudiantes-curso:${cursoId}`,
          colegioId, usuarioId,
          run: () => supabase.from('estudiantes').select('id, usuarios(nombre_completo)').eq('curso_id', cursoId),
        }),
    esTecnica
      ? fetchConCache({
          key: `asistencias-tecnica:${materiaId}:${cursoId}:${fecha}`,
          colegioId, usuarioId,
          run: async () => {
            const { data: inscritos } = await supabase.from('inscripciones_tecnicas')
              .select('estudiante_id, estudiantes!inner(curso_id)').eq('materia_id', materiaId).eq('activo', true)
              .in('estudiantes.curso_id', await cursosDelGrado(cursoId))
            const ids = (inscritos ?? []).map(i => i.estudiante_id)
            if (!ids.length) return { data: [] }
            return supabase.from('asistencias_materia').select('estudiante_id, estado, observaciones, metodo, hora_llegada, minutos_retraso, llamada_id').in('estudiante_id', ids).eq('fecha', fecha).eq('sesion', 'tecnica').eq('materia_id', materiaId).eq('profesor_id', usuarioId)
          },
        })
      : fetchConCache({
          key: `asistencias:${cursoId}:${materiaId}:${fecha}`,
          colegioId, usuarioId,
          run: () => supabase.from('asistencias_materia').select('estudiante_id, estado, observaciones, metodo, hora_llegada, minutos_retraso, llamada_id').eq('curso_id', cursoId).eq('fecha', fecha).eq('sesion', 'regular').eq('materia_id', materiaId).eq('profesor_id', usuarioId),
        }),
  ])

  const rEsts = rEstsRaw

  const estudiantes = rEsts.data
  const registros   = rRegs.data
  const huboOffline = rEsts.offline || rRegs.offline

  const regMap = {}
  ;(registros ?? []).forEach(r => regMap[r.estudiante_id] = r)

  const hayRegistros = (registros?.length ?? 0) > 0
  const mostrarToggle = !esFechaHoy

  const estudiantesOrdenados = (estudiantes ?? []).sort((a, b) =>
    (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

  const contadores = { presente: 0, falta: 0, retraso: 0, licencia: 0 }
  if (hayRegistros) registros.forEach(r => { if (r.estado in contadores) contadores[r.estado]++ })

  // Asistencia por QR: estado previo de la lista (para avisos y para conservar horas al guardar a mano)
  const filasQr = (registros ?? []).filter(r => r.metodo === 'qr')
  const inicioQr = filasQr.map(r => r.hora_llegada).filter(Boolean).sort()[0] ?? null   // primer escaneo = inicio
  window._asisPrevio = {
    regMap, cursoId, fecha, esTecnica,
    hayManual: (registros ?? []).some(r => (r.metodo ?? 'manual') === 'manual'),
    hayQr: filasQr.length > 0,
    inicioQr: inicioQr ? horaBoliviaCorta(inicioQr) : null,
    estudiantes: (estudiantes ?? []).map(e => ({ id: e.id, nombre: e.usuarios?.nombre_completo ?? 'Sin nombre', curso_id: e.curso_id ?? cursoId })),
  }
  // Hora de entrada al AULA (QR del profesor). La entrada al COLEGIO (portería) va junto al nombre: "🚪 Colegio 07:52"
  const celdaHora = (reg) => {
    if (!reg) return ''
    const aula = '<span class="asis-solo-movil">Aula </span>'
    if (reg.metodo === 'qr' && reg.hora_llegada) {
      const h = horaBoliviaCorta(reg.hora_llegada)
      return reg.estado === 'retraso' && reg.minutos_retraso != null
        ? `<span style="font-weight:700;color:#c2410c;" title="Entró al aula a las ${h}, ${reg.minutos_retraso} min tarde (QR)">📷 ${aula}${h} · ${reg.minutos_retraso} min tarde</span>`
        : `<span style="font-weight:600;color:#0369a1;" title="Entró al aula a las ${h} (QR)">📷 ${aula}${h}</span>`
    }
    if (filasQr.length) return reg.metodo === 'qr'
      ? `<span class="text-muted" title="No escaneó en la llamada QR">— <span class="asis-solo-movil">Aula: no escaneó</span></span>`
      : `<span class="text-muted" title="Marcado a mano por el profesor">✋ ${aula}a mano</span>`
    return ''
  }
  const qrEscaneados = filasQr.filter(r => r.hora_llegada).length
  const qrAMano = (registros ?? []).filter(r => (r.metodo ?? 'manual') === 'manual').length

  ocultarLoader()

  const panel = document.getElementById('panel-asistencia')
  panel.innerHTML = `
    ${huboOffline ? avisoOfflineInline('Sin conexión — mostrando la asistencia guardada la última vez que hubo internet. Si otro dispositivo registró asistencia después, no se verá hasta reconectar.') : ''}

    <div class="asis-contadores" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px;">
      <div class="stat-card" style="text-align:center;border-top:4px solid var(--color-success);padding:20px 16px;">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--color-success);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Presentes</div>
        <div id="cnt-presente" style="font-size:36px;font-weight:800;color:var(--color-success);line-height:1;">${hayRegistros ? contadores.presente : '—'}</div>
      </div>
      <div class="stat-card" style="text-align:center;border-top:4px solid var(--color-error);padding:20px 16px;">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--color-error);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Faltas</div>
        <div id="cnt-falta" style="font-size:36px;font-weight:800;color:var(--color-error);line-height:1;">${hayRegistros ? contadores.falta : '—'}</div>
      </div>
      <div class="stat-card" style="text-align:center;border-top:4px solid var(--color-warning);padding:20px 16px;">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--color-warning);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Retrasos</div>
        <div id="cnt-retraso" style="font-size:36px;font-weight:800;color:var(--color-warning);line-height:1;">${hayRegistros ? contadores.retraso : '—'}</div>
      </div>
      <div class="stat-card" style="text-align:center;border-top:4px solid var(--color-amarillo);padding:20px 16px;">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-amarillo)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--color-amarillo);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Licencias</div>
        <div id="cnt-licencia" style="font-size:36px;font-weight:800;color:var(--color-amarillo);line-height:1;">${hayRegistros ? contadores.licencia : '—'}</div>
      </div>
    </div>

    <div class="card">
      <div class="flex-between" style="margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div class="card-title">
          Asistencia — ${new Date(fecha + 'T12:00:00').toLocaleDateString('es-BO', {weekday:'long', day:'numeric', month:'long'})}
          ${esFechaHoy ? '<span style="margin-left:8px;font-size:11px;background:var(--color-success);color:white;padding:2px 8px;border-radius:20px;font-weight:600;">HOY</span>' : ''}
          ${inicioQr ? `<span class="asis-badge-qr" style="margin-left:8px;font-size:11px;background:#e0f2fe;color:#0369a1;padding:2px 10px;border-radius:20px;font-weight:600;display:inline-block;letter-spacing:0;text-transform:none;" title="Hora de inicio de la llamada por QR (entrada al aula)">📷 Lista por QR · inicio ${horaBoliviaCorta(inicioQr)} · ${qrEscaneados} escaneado${qrEscaneados === 1 ? '' : 's'} · ${qrAMano} a mano</span>` : ''}
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          ${mostrarToggle ? `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;user-select:none;">
            <div style="position:relative;width:44px;height:24px;flex-shrink:0;">
              <input type="checkbox" id="toggle-todos-presente" style="opacity:0;width:0;height:0;position:absolute;"
                onchange="toggleTodosPresente(this.checked)">
              <span id="toggle-track" style="position:absolute;inset:0;background:#ccc;border-radius:12px;transition:background 0.2s;cursor:pointer;"></span>
              <span id="toggle-thumb" style="position:absolute;left:2px;top:2px;width:20px;height:20px;background:white;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);pointer-events:none;"></span>
            </div>
            Marcar todos presentes
          </label>` : ''}
          <div class="asis-acciones">
          <span class="asis-resumen" id="asis-resumen"></span>
          ${esFechaHoy ? `<button class="btn" style="background:#0f766e;color:#fff;" onclick="llamarListaQr()" title="Escanear las credenciales QR en el aula">📷 <span class="asis-solo-pc">Llamar por </span>QR</button>` : ''}
          <button class="btn btn-primary" onclick="guardarAsistencia('${cursoId}','${fecha}', ${esTecnica})">💾 Guardar asistencia</button>
          <button class="btn btn-amarillo" onclick="abrirExportarAsistencia('${cursoId}')">📊 <span class="asis-solo-pc">Exportar </span>Excel</button>
          </div>
        </div>
      </div>

      <div class="table-wrapper"><table class="asis-tabla">
        <thead>
          <tr>
            <th style="min-width:200px;">N° &nbsp;Estudiante</th>
            <th style="text-align:center;">✅ Presente</th>
            <th style="text-align:center;">❌ Falta</th>
            <th style="text-align:center;">🕐 Retraso</th>
            <th style="text-align:center;">📋 Licencia</th>
            <th style="text-align:center;white-space:nowrap;" title="Hora de llegada al aula (solo si se llamó lista por QR)">⏱ Hora (aula)</th>
            <th>Observación</th>
            <th style="text-align:center;">Faltas/Mes</th>
          </tr>
        </thead>
        <tbody id="tbody-asistencia">
          ${estudiantesOrdenados.map((e, i) => {
            const reg = regMap[e.id]
            const estadoDefecto = reg?.estado ?? (esFechaHoy ? 'presente' : null)
            return `<tr>
              <td class="asis-td-nom" style="font-weight:500;font-size:13px;"><span class="text-muted" style="display:inline-block;min-width:26px;">${i + 1}</span><span class="asis-nom">${escapeHTML(e.usuarios?.nombre_completo ?? 'Sin nombre')}</span></td>
              ${['presente','falta','retraso','licencia'].map(st => `
              <td class="asis-op asis-op-${st}" style="text-align:center;">
                <label class="asis-op-lbl">
                <input type="radio" name="asis_${escapeHTML(e.id)}" value="${st}" class="asis-radio" data-est="${escapeHTML(e.id)}" data-curso="${escapeHTML(e.curso_id ?? cursoId)}"
                  ${estadoDefecto === st ? 'checked' : ''}
                  onchange="actualizarContadoresAsistencia();navigator.vibrate?.(12)"><span class="asis-chip">${{ presente: 'P', falta: 'F', retraso: 'R', licencia: 'L' }[st]}</span>
                </label>
              </td>`).join('')}
              <td class="asis-td-hora" style="text-align:center;font-size:12px;white-space:nowrap;">${celdaHora(reg)}</td>
              <td class="asis-td-obs">
                <input type="text" class="asis-obs" data-est="${escapeHTML(e.id)}" autocomplete="off" data-lpignore="true" data-form-type="other" name="obs-${escapeHTML(e.id)}"
                  readonly onfocus="this.removeAttribute('readonly')"
                  value="${escapeHTML(reg?.observaciones ?? '')}" placeholder="Opcional..."
                  style="font-size:12px;width:150px;padding:4px 8px;border:1px solid var(--color-border);border-radius:6px;">
              </td>
              <td class="asis-td-faltas" style="text-align:center;" id="faltas-mes-${e.id}">
                <span style="font-size:12px;color:var(--color-muted);">—</span>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table></div>
    </div>

    <div id="modal-exportar-asistencia" class="modal-overlay hidden">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <div class="modal-title">Exportar Asistencia a Excel</div>
          <button class="modal-close" onclick="cerrarModal('modal-exportar-asistencia')">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:13px;font-weight:500;display:block;margin-bottom:6px;">Fecha inicio</label>
            <input type="date" id="export-fecha-inicio" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:6px;">
          </div>
          <div>
            <label style="font-size:13px;font-weight:500;display:block;margin-bottom:6px;">Fecha fin</label>
            <input type="date" id="export-fecha-fin" style="width:100%;padding:8px;border:1px solid var(--color-border);border-radius:6px;">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${Config.periodos.map(p => `
            <button class="btn btn-secondary btn-sm" onclick="setRangoTrimestre(${p.numero})">
              ${p.nombre}
            </button>`).join('')}
            <button class="btn btn-secondary btn-sm" onclick="setRangoMesActual()">Mes actual</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="cerrarModal('modal-exportar-asistencia')">Cancelar</button>
          <button class="btn btn-primary" onclick="ejecutarExportarAsistencia('${cursoId}')">📥 Descargar Excel</button>
        </div>
      </div>
    </div>`

  actualizarContadoresAsistencia()
  cargarFaltasMesEstudiantes(cursoId, fecha, estudiantesOrdenados.map(e => e.id), esTecnica)
  if (esFechaHoy) mostrarIngresoPorteria(estudiantesOrdenados.map(e => e.id))
  aplicarLicenciasEnLista(fecha, estudiantesOrdenados.map(e => e.id), regMap)   // licencias aprobadas (101)
}

window.toggleTodosPresente = function(checked) {
  const track = document.getElementById('toggle-track')
  const thumb = document.getElementById('toggle-thumb')
  if (track) track.style.background = checked ? 'var(--color-primary)' : '#ccc'
  if (thumb) thumb.style.left = checked ? '22px' : '2px'
  if (checked) {
    document.querySelectorAll('#tbody-asistencia input[type=radio][value=presente]').forEach(r => r.checked = true)
    actualizarContadoresAsistencia()
  }
}

window.actualizarContadoresAsistencia = function() {
    document.querySelectorAll('#tbody-asistencia tr.asis-sin-estado').forEach(f => {
    if (f.querySelector('.asis-radio:checked')) f.classList.remove('asis-sin-estado')
  })
  const cnt = { presente: 0, falta: 0, retraso: 0, licencia: 0 }
  document.querySelectorAll('.asis-radio:checked').forEach(r => { if (r.value in cnt) cnt[r.value]++ })
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('cnt-presente', cnt.presente || '—')
  set('cnt-falta',    cnt.falta    || '—')
  set('cnt-retraso',  cnt.retraso  || '—')
  set('cnt-licencia', cnt.licencia || '—')
  // Resumen de la barra inferior (celular)
  set('asis-resumen', `${cnt.presente} P · ${cnt.falta} F · ${cnt.retraso} R · ${cnt.licencia} L`)
}

async function cargarFaltasMesEstudiantes(cursoId, fecha, estIds, esTecnica = false) {
  const mesInicio = fecha.substring(0, 7) + '-01'
  const r = await fetchConCache({
    key: `faltas-mes:${esTecnica ? 'tecnica:' + cursoId : cursoId}:${mesInicio}:${fecha}`,
    colegioId: perfil?.colegio_id, usuarioId: perfil?.id,
    run: () => {
      const { materiaId } = get()
      let q = supabase.from('asistencias_materia')
        .select('estudiante_id, estado')
        .in('estudiante_id', estIds)
        .gte('fecha', mesInicio)
        .lte('fecha', fecha)
        .eq('estado', 'falta')
        .eq('sesion', esTecnica ? 'tecnica' : 'regular')
        .eq('materia_id', materiaId)
        .eq('profesor_id', perfil.id)
      if (!esTecnica) q = q.eq('curso_id', cursoId)
      return q
    },
  })
  const data = r.data

  const faltasMap = {}
  ;(data ?? []).forEach(r => { faltasMap[r.estudiante_id] = (faltasMap[r.estudiante_id] ?? 0) + 1 })

  estIds.forEach(id => {
    const el = document.getElementById(`faltas-mes-${id}`)
    if (el) {
      const n = faltasMap[id] ?? 0
      el.innerHTML = `<span style="font-size:12px;font-weight:600;color:${n > 0 ? 'var(--color-error)' : 'var(--color-success)'};">${n}</span>`
    }
  })
}

window.guardarAsistencia = async function(cursoId, fecha, esTecnica = false) {
  const { materiaId } = get()
  if (!materiaId) { toast('Selecciona una materia', 'warning'); return }

  const filas = document.querySelectorAll('#tbody-asistencia tr')
  const payload = []
  const sesion = esTecnica ? 'tecnica' : 'regular'
  
  // No guardar si hay estudiantes sin estado
  const sinEstado = [...filas].filter(f => f.querySelector('.asis-radio') && !f.querySelector('.asis-radio:checked'))
  filas.forEach(f => f.classList.toggle('asis-sin-estado', sinEstado.includes(f)))
  if (sinEstado.length) {
    const nombre = sinEstado[0].querySelector('.asis-nom')?.textContent.trim()
    toast(sinEstado.length === 1
      ? `${nombre} no tiene estado. Márcalo antes de guardar.`
      : `Faltan ${sinEstado.length} estudiantes sin estado. Márcalos antes de guardar.`, 'warning')
    sinEstado[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  for (const fila of filas) {
    const radio = fila.querySelector('.asis-radio:checked')
    if (!radio) continue
    const estId = radio.dataset.est
    const obs   = fila.querySelector(`.asis-obs[data-est="${estId}"]`)?.value?.trim() || null
    const cursoIdReal = radio.dataset.curso || cursoId
    // Si la marca vino del QR y el profesor no cambió el estado, conserva su hora de llegada
    const previo = window._asisPrevio?.regMap?.[estId]
    const conservaQr = previo?.metodo === 'qr' && previo.estado === radio.value
    payload.push({
      estudiante_id: estId,
      curso_id: cursoIdReal,
      materia_id: materiaId,
      profesor_id: perfil.id,
      fecha,
      sesion,
      estado: radio.value,
      observaciones: obs,
      ...(conservaQr ? { metodo: 'qr', hora_llegada: previo.hora_llegada, minutos_retraso: previo.minutos_retraso, llamada_id: previo.llamada_id } : { metodo: 'manual' }),
    })
  }

  if (!payload.length) { toast('No hay registros para guardar', 'warning'); return }

  // Lista tomada por QR: avisar si el guardado manual cambia marcas con hora de llegada
  const pierden = payload.filter(p => p.metodo === 'manual' && window._asisPrevio?.regMap?.[p.estudiante_id]?.metodo === 'qr' && window._asisPrevio.regMap[p.estudiante_id].hora_llegada).length
  if (pierden) {
    const ok = await confirmar('Lista tomada por QR',
      `Esta lista ya se tomó por QR${window._asisPrevio?.inicioQr ? ` (inicio ${window._asisPrevio.inicioQr})` : ''}. ` +
      `${pierden} estudiante(s) cambian de estado y perderán su hora de llegada; los demás la conservan. ¿Continuar bajo su responsabilidad?`,
      'Guardar igual', 'Cancelar')
    if (!ok) return
  }

  const r = await guardarAsistenciaMateria(payload)
  if (r.ok) { actualizarContadoresAsistencia(); cargarListaAsistencia() }
}

// ─── LLAMAR LISTA POR QR (solo hoy) ───────────────────────
window.llamarListaQr = async function() {
  const { materiaId } = get()
  const ctx = window._asisPrevio
  if (!ctx || !materiaId) { toast('Carga la lista primero', 'warning'); return }
  if (ctx.fecha !== fechaLocal()) { toast('Llamar por QR solo funciona con la lista de hoy', 'warning'); return }

  if (ctx.hayQr) {
    const ok = await confirmar('Nueva llamada por QR',
      `Esta lista ya se tomó por QR hoy${ctx.inicioQr ? ` (inicio ${ctx.inicioQr})` : ''}. Si continúas, la nueva llamada reemplaza la anterior. ¿Continuar bajo su responsabilidad?`,
      'Continuar', 'Cancelar')
    if (!ok) return
  } else if (ctx.hayManual) {
    const ok = await confirmar('Ya llamaste lista a mano',
      'Ya hay asistencia guardada a mano hoy en esta materia. Si continúas con QR, esa lista se reemplaza. ¿Continuar bajo su responsabilidad?',
      'Continuar', 'Cancelar')
    if (!ok) return
  }

  await abrirLlamadaQr({
    cursoId: ctx.cursoId,
    materiaId,
    sesion: ctx.esTecnica ? 'tecnica' : 'regular',
    fecha: ctx.fecha,
    profesorId: perfil.id,
    estudiantes: ctx.estudiantes,
    alTerminar: () => cargarListaAsistencia(),
  })
}

window.abrirExportarAsistencia = function(cursoId) {
  const hoy = fechaLocal()
  const inicioMes = hoy.substring(0, 7) + '-01'
  document.getElementById('export-fecha-inicio').value = inicioMes
  document.getElementById('export-fecha-fin').value = hoy
  document.getElementById('modal-exportar-asistencia').classList.remove('hidden')
}

window.setRangoMesActual = function() {
  const hoy = fechaLocal()
  document.getElementById('export-fecha-inicio').value = hoy.substring(0, 7) + '-01'
  document.getElementById('export-fecha-fin').value = hoy
}

window.setRangoTrimestre = function(numero) {
  const p = Config.periodos.find(x => x.numero === numero)
  if (!p) return
  document.getElementById('export-fecha-inicio').value = p.fecha_inicio ?? `${Config.año}-01-01`
  document.getElementById('export-fecha-fin').value = p.fecha_fin ?? fechaLocal()
}

window.ejecutarExportarAsistencia = function(cursoId) {
  const inicio = document.getElementById('export-fecha-inicio').value
  const fin    = document.getElementById('export-fecha-fin').value
  if (!inicio || !fin) { toast('Selecciona el rango de fechas', 'warning'); return }
  const { materiaId } = get()
  if (!materiaId) { toast('Selecciona una materia', 'warning'); return }
  cerrarModal('modal-exportar-asistencia')
  exportarAsistenciasExcel(cursoId, inicio, fin, {
    materiaId,
    profesorId: perfil?.id || null,
  })
}

// ─── HISTORIAL DE ASISTENCIA (solo consulta) ─────────────
window.mostrarHistorialAsistencia = function() {
  const panel = document.getElementById('panel-historial-asistencia')
  if (!panel) return
  panel.classList.remove('hidden')
  window.setHistorialRango('semana')
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

window.ocultarHistorialAsistencia = function() {
  const panel = document.getElementById('panel-historial-asistencia')
  if (panel) panel.classList.add('hidden')
}

function _histAsisLunesDomingo(ref = new Date()) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const day = d.getDay() // 0=dom … 6=sáb
  const diffLunes = day === 0 ? -6 : 1 - day
  const lunes = new Date(d)
  lunes.setDate(d.getDate() + diffLunes)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  const iso = (x) => {
    const y = x.getFullYear()
    const m = String(x.getMonth() + 1).padStart(2, '0')
    const dd = String(x.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }
  return { desde: iso(lunes), hasta: iso(domingo) }
}

window.setHistorialRango = function(tipo) {
  const desde = document.getElementById('hist-asis-desde')
  const hasta = document.getElementById('hist-asis-hasta')
  if (!desde || !hasta) return
  const hoy = new Date()
  if (tipo === 'semana') {
    const { desde: d, hasta: h } = _histAsisLunesDomingo(hoy)
    desde.value = d
    hasta.value = h
  } else if (tipo === 'mes') {
    const y = hoy.getFullYear()
    const m = String(hoy.getMonth() + 1).padStart(2, '0')
    const last = new Date(y, hoy.getMonth() + 1, 0).getDate()
    desde.value = `${y}-${m}-01`
    hasta.value = `${y}-${m}-${String(last).padStart(2, '0')}`
  }
}

window.cargarHistorialAsistencia = async function() {
  const { cursoId, materiaId } = typeof get === 'function' ? get() : {
    cursoId: document.getElementById('selector-curso-global')?.value,
    materiaId: document.getElementById('selector-materia-global')?.value,
  }
  const fechaInicio = document.getElementById('hist-asis-desde')?.value
  const fechaFin    = document.getElementById('hist-asis-hasta')?.value
  const cont = document.getElementById('hist-asis-resultado')
  if (!cont) return
  if (!cursoId || !materiaId) {
    toast('Selecciona curso y materia', 'warning')
    return
  }
  if (!fechaInicio || !fechaFin) {
    toast('Selecciona el rango de fechas', 'warning')
    return
  }

  mostrarLoader('Cargando historial...')
  try {
    // Filtrar por curso+paralelo (cursoId ya es el curso con su paralelo).
    // Las materias técnicas mezclan cursos, por eso solo ellas quedan sin filtro de curso.
    const { data: matInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    const esTecnicaHist = matInfo?.es_tecnica === true
    const idsGradoHist = esTecnicaHist ? await cursosDelGrado(cursoId) : null
    const PAGE = 1000
    let from = 0
    const filas = []
    for (;;) {
      let qHist = supabase
        .from('asistencias_materia')
        .select('fecha, estado, estudiante_id, estudiantes(usuarios(nombre_completo))')
        .eq('profesor_id', perfil.id)
        .eq('materia_id', materiaId)
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin)
      qHist = esTecnicaHist ? qHist.in('curso_id', idsGradoHist) : qHist.eq('curso_id', cursoId)
      const { data, error } = await qHist
        .order('fecha')
        .order('estudiante_id')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const batch = data ?? []
      filas.push(...batch)
      if (batch.length < PAGE) break
      from += PAGE
    }

    if (!filas.length) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">Sin registros de asistencia en ese rango</div></div>`
      return
    }

    const porEst = {}
    for (const r of filas) {
      const id = r.estudiante_id
      if (!porEst[id]) {
        porEst[id] = {
          nombre: r.estudiantes?.usuarios?.nombre_completo ?? 'Sin nombre',
          P: 0, F: 0, R: 0, L: 0,
          dias: [],
        }
      }
      const letra = (r.estado || '').charAt(0).toUpperCase()
      if (letra === 'P') porEst[id].P++
      else if (letra === 'F') porEst[id].F++
      else if (letra === 'R') porEst[id].R++
      else if (letra === 'L') porEst[id].L++
      porEst[id].dias.push({ fecha: r.fecha, estado: letra })
    }

    const lista = Object.entries(porEst)
      .map(([id, e]) => {
        const total = e.P + e.F + e.R + e.L
        const pct = total ? Math.round((e.P / total) * 1000) / 10 : 0
        return { id, ...e, total, pct }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

    window._histAsisDetalle = lista

    cont.innerHTML = `
      <p class="text-sm text-muted" style="margin-bottom:8px;">${fechaInicio} → ${fechaFin} · ${lista.length} estudiantes con registro</p>
      <div class="table-wrapper"><table>
        <thead><tr>
          <th>Estudiante</th><th>P</th><th>F</th><th>R</th><th>L</th><th>%</th><th></th>
        </tr></thead>
        <tbody>
          ${lista.map((e, i) => `
            <tr>
              <td><strong>${escapeHTML(e.nombre)}</strong></td>
              <td>${e.P}</td><td>${e.F}</td><td>${e.R}</td><td>${e.L}</td>
              <td><strong>${e.pct}%</strong></td>
              <td><button type="button" class="btn btn-secondary btn-sm" onclick="window.verDetalleHistorialAsis(${i})">Días</button></td>
            </tr>`).join('')}
        </tbody>
      </table></div>`
  } catch (err) {
    toast(err.message ?? 'Error al cargar historial', 'error')
    cont.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error al cargar</div></div>`
  } finally {
    ocultarLoader()
  }
}

window.verDetalleHistorialAsis = function(idx) {
  const e = window._histAsisDetalle?.[idx]
  if (!e) return

  const label = { P: 'Presente', F: 'Falta', R: 'Retraso', L: 'Licencia' }
  const color = { P: '#15803d', F: '#b91c1c', R: '#a16207', L: '#1d4ed8' }

  const dias = (e.dias || []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha))

  const titulo = document.getElementById('modal-hist-asis-titulo')
  const resumen = document.getElementById('modal-hist-asis-resumen')
  const lista = document.getElementById('modal-hist-asis-lista')
  const modal = document.getElementById('modal-hist-asis-detalle')
  if (!modal || !lista) return

  if (titulo) titulo.textContent = e.nombre
  if (resumen) {
    resumen.textContent = `P: ${e.P} · F: ${e.F} · R: ${e.R} · L: ${e.L} · ${e.pct}% asistencia`
  }

  if (!dias.length) {
    lista.innerHTML = '<p class="text-sm text-muted">Sin días registrados en este rango.</p>'
  } else {
    lista.innerHTML = `<ul style="list-style:none;margin:0;padding:0;">
      ${dias.map(d => {
        const [, m, day] = d.fecha.split('-')
        const est = label[d.estado] || d.estado
        const c = color[d.estado] || '#444'
        return `<li style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid var(--color-border, #eee);">
          <span>${day}/${m}</span>
          <strong style="color:${c};">${est}</strong>
        </li>`
      }).join('')}
    </ul>`
  }

  modal.classList.remove('hidden')
}

window.exportarHistorialAsistencia = function() {
  const { cursoId, materiaId } = typeof get === 'function' ? get() : {
    cursoId: document.getElementById('selector-curso-global')?.value,
    materiaId: document.getElementById('selector-materia-global')?.value,
  }
  const fechaInicio = document.getElementById('hist-asis-desde')?.value
  const fechaFin    = document.getElementById('hist-asis-hasta')?.value
  if (!cursoId || !fechaInicio || !fechaFin) {
    toast('Curso y rango de fechas requeridos', 'warning')
    return
  }
  exportarAsistenciasExcel(cursoId, fechaInicio, fechaFin, {
    materiaId: materiaId || null,
    profesorId: perfil?.id || null,
  })
}

// ─── MIS CURSOS ──────────────────────────────────────────
async function cargarMisCursos() {
  const cursos = [...new Map(asignaciones.map(a=>[a.curso_id,a])).values()]
  const panel  = document.getElementById('panel-mis-cursos')
  if (!cursos.length) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📚</div><div class="empty-state-title">Sin cursos asignados</div><div class="empty-state-desc">El director debe asignarte cursos y materias</div></div>`
    return
  }
  const cards = await Promise.all(cursos.map(async a => {
    const asigCurso = asignaciones.filter(x => x.curso_id === a.curso_id)
    const mats = asigCurso.map(x => x.materia?.nombre)
    const tieneRegular = asigCurso.some(x => !x.materia?.es_tecnica)

    let ne
    if (tieneRegular) {
      const { count } = await supabase.from('estudiantes').select('*',{count:'exact',head:true}).eq('curso_id', a.curso_id)
      ne = count ?? 0
    } else {
      const materiasTecId = asigCurso.map(x => x.materia_id)
      const { data: insc } = await supabase.from('inscripciones_tecnicas')
        .select('estudiante_id').in('materia_id', materiasTecId).eq('curso_id', a.curso_id).eq('activo', true)
      ne = new Set((insc ?? []).map(i => i.estudiante_id)).size
    }

    return `<div class="card">
      <div class="card-title">${escapeHTML(a.curso?.nombre_completo)}</div>
      <div class="text-sm text-muted" style="margin-bottom:10px;">${ne ?? 0} estudiantes</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${mats.map(m=>`<span class="badge badge-info">${escapeHTML(m)}</span>`).join('')}
      </div>
    </div>`
  }))
  panel.innerHTML = `<div class="grid-3">${cards.join('')}</div>`
}

// ─── UTILS ───────────────────────────────────────────────
window.cerrarModal = function(id) {
  document.getElementById(id)?.classList.add('hidden')
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden')
  })
})

// ─── MI CUENTA ───────────────────────────────────────────
window.cambiarContrasenaProfesor = async function() {
  const actual  = document.getElementById('prof-pass-actual')?.value ?? ''
  const nueva   = document.getElementById('prof-pass-nueva')?.value ?? ''
  const confirm = document.getElementById('prof-pass-confirm')?.value ?? ''

  if (!actual || !nueva || !confirm) { toast('Completa todos los campos', 'warning'); return }
  if (nueva.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'warning'); return }
  if (nueva !== confirm) { toast('Las contraseñas no coinciden', 'error'); return }

  mostrarLoader('Actualizando contraseña...')
  try {
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: perfil.email, password: actual })
    if (signInErr) { toast('La contraseña actual es incorrecta', 'error'); return }
    const { error } = await supabase.auth.updateUser({ password: nueva })
    if (error) throw error
    toast('Contraseña actualizada correctamente', 'success')
    document.getElementById('prof-pass-actual').value = ''
    document.getElementById('prof-pass-nueva').value = ''
    document.getElementById('prof-pass-confirm').value = ''
  } catch(err) {
    toast(err.message ?? 'Error actualizando contraseña', 'error')
  } finally { ocultarLoader() }
}

// ─── CALIFICAR SER / AUTOEVALUACIÓN ──────────────────────
window.abrirModalSerAuto = async function() {
  const { cursoId, materiaId, periodo } = get()
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia', 'warning'); return }

  mostrarLoader('Cargando estudiantes...')

  const dimSer  = Config.dimensiones.find(d => d.codigo === 'ser')
  const dimAuto = Config.dimensiones.find(d => d.codigo === 'decidir')

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  const [estudiantesResult, { data: cals }] = await Promise.all([
    esTecnica
      ? supabase.from('inscripciones_tecnicas')
          .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
          .eq('materia_id', materiaId).eq('activo', true).in('estudiantes.curso_id', await cursosDelGrado(cursoId))
      : supabase.from('estudiantes')
          .select('id, usuarios(nombre_completo)')
          .eq('curso_id', cursoId)
          .order('usuarios(nombre_completo)'),
    supabase.from('calificaciones')
      .select('estudiante_id, nota_ser, nota_decidir')
      .eq('materia_id', materiaId)
      .eq('trimestre', periodo)
  ])

  const estudiantes = esTecnica
    ? (estudiantesResult.data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios }))
    : (estudiantesResult.data ?? [])

  const calMap = {}
  ;(cals ?? []).forEach(c => { calMap[c.estudiante_id] = c })

  const sorted = (estudiantes ?? []).sort((a,b) =>
    (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

  ocultarLoader()

  document.getElementById('modal-ser-auto-titulo').textContent = 'Calificar SER / Autoevaluación'
  document.getElementById('modal-ser-auto-info').textContent =
    `Período: ${Config.nombrePeriodo} ${periodo} · SER máx: ${dimSer?.peso_maximo ?? 10} · Autoevaluación máx: ${dimAuto?.peso_maximo ?? 5}`
  document.getElementById('th-ser-label').textContent = `${dimSer?.nombre ?? 'SER'} (0-${dimSer?.peso_maximo ?? 10})`
  document.getElementById('th-auto-label').textContent = `${dimAuto?.nombre ?? 'Autoevaluación'} (0-${dimAuto?.peso_maximo ?? 5})`

  document.getElementById('tabla-ser-auto-body').innerHTML = sorted.map((e, i) => {
    const cal = calMap[e.id]
    return `<tr>
      <td style="font-size:13px;color:var(--color-text-3);">${i + 1}</td>
      <td style="font-weight:500;font-size:13px;">${escapeHTML(e.usuarios?.nombre_completo ?? '—')}</td>
      <td style="text-align:center;">
        <input type="number" class="ser-auto-input" data-est="${escapeHTML(e.id)}" data-tipo="ser"
          min="0" max="${dimSer?.peso_maximo ?? 10}" step="0.1"
          value="${cal?.nota_ser ?? ''}" placeholder="—"
          style="width:80px;padding:6px;border:1px solid var(--color-border);border-radius:6px;text-align:center;font-size:13px;">
      </td>
      <td style="text-align:center;">
        <input type="number" class="ser-auto-input" data-est="${escapeHTML(e.id)}" data-tipo="auto"
          min="0" max="${dimAuto?.peso_maximo ?? 5}" step="0.1"
          value="${cal?.nota_decidir ?? ''}" placeholder="—"
          style="width:80px;padding:6px;border:1px solid var(--color-border);border-radius:6px;text-align:center;font-size:13px;">
      </td>
      <td style="text-align:center;">
        <button class="btn btn-success btn-sm"
          onclick="guardarSerAutoIndividual('${e.id}','${materiaId}',${periodo},${dimSer?.peso_maximo ?? 10},${dimAuto?.peso_maximo ?? 5})">💾</button>
      </td>
    </tr>`
  }).join('')

  document.getElementById('btn-guardar-ser-auto').onclick = () =>
    guardarSerAutoTodos(materiaId, periodo, dimSer?.peso_maximo ?? 10, dimAuto?.peso_maximo ?? 5)

  document.getElementById('modal-ser-auto').classList.remove('hidden')
}

window.guardarSerAutoIndividual = async function(estId, materiaId, periodo, maxSer, maxAuto) {
  const serInput  = document.querySelector(`.ser-auto-input[data-est="${estId}"][data-tipo="ser"]`)
  const autoInput = document.querySelector(`.ser-auto-input[data-est="${estId}"][data-tipo="auto"]`)

  const serVal  = serInput?.value?.trim()
  const autoVal = autoInput?.value?.trim()

  if (serVal === '' && autoVal === '') { toast('Ingresa al menos una nota', 'warning'); return }

  const notaSer  = serVal  !== '' ? parseFloat(serVal)  : null
  const notaAuto = autoVal !== '' ? parseFloat(autoVal) : null

  if (notaSer  != null && (isNaN(notaSer)  || notaSer  < 0 || notaSer  > maxSer))  { toast(`SER fuera de rango (0-${maxSer})`,   'error'); return }
  if (notaAuto != null && (isNaN(notaAuto) || notaAuto < 0 || notaAuto > maxAuto)) { toast(`Autoevaluación fuera de rango (0-${maxAuto})`, 'error'); return }

  const { error } = await supabase.rpc('rpc_upsert_calificacion', {
    p_estudiante_id: estId,
    p_materia_id:    materiaId,
    p_trimestre:     periodo,
    p_nota_ser:      notaSer,
    p_nota_decidir:  notaAuto
  })

  if (error) { toast(error.message, 'error'); return }
  toast('Guardado', 'success')
  if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
}

window.guardarSerAutoTodos = async function(materiaId, periodo, maxSer, maxAuto) {
  const filas = document.querySelectorAll('#tabla-ser-auto-body tr')
  let guardados = 0, errores = 0

  mostrarLoader('Guardando...')
  for (const fila of filas) {
    const serInput  = fila.querySelector('.ser-auto-input[data-tipo="ser"]')
    const autoInput = fila.querySelector('.ser-auto-input[data-tipo="auto"]')
    const estId     = serInput?.dataset?.est
    if (!estId) continue

    const serVal  = serInput?.value?.trim()
    const autoVal = autoInput?.value?.trim()
    if (serVal === '' && autoVal === '') continue

    const notaSer  = serVal  !== '' ? parseFloat(serVal)  : null
    const notaAuto = autoVal !== '' ? parseFloat(autoVal) : null

    if (notaSer  != null && (isNaN(notaSer)  || notaSer  < 0 || notaSer  > maxSer))  { errores++; continue }
    if (notaAuto != null && (isNaN(notaAuto) || notaAuto < 0 || notaAuto > maxAuto)) { errores++; continue }

    const { error } = await supabase.rpc('rpc_upsert_calificacion', {
      p_estudiante_id: estId,
      p_materia_id:    materiaId,
      p_trimestre:     periodo,
      p_nota_ser:      notaSer,
      p_nota_decidir:  notaAuto
    })
    if (error) errores++; else guardados++
  }

  ocultarLoader()
  if (errores) toast(`${guardados} guardados, ${errores} con error`, 'warning')
  else { toast(`${guardados} registros guardados`, 'success'); if (typeof window._vcRefrescar === 'function') window._vcRefrescar() }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEGAR AL FINAL DE: frontend/js/profesor/profesor.js
// ═══════════════════════════════════════════════════════════════════════════════
import { enviarComunicado, getComunicadosEnviados } from '../comunicados/comunicados.js'
import { renderTablaEnviados, montarListaEnviados } from '../comunicados/comunicados-ui.js'
import { crearFormComunicado, gruposProfesor } from '../comunicados/form-comunicado.js'

// ─── COMUNICADOS — PROFESOR ───────────────────────────────────────────────────
async function cargarComunicadosProf() {
  const tbody = document.getElementById('tabla-comunicados-prof')
  if (tbody) await montarListaEnviados(tbody)
}

// Formulario "Nuevo comunicado": lógica compartida en comunicados/form-comunicado.js
const _comProf = crearFormComunicado({
  prefijo: 'prof', tipoEmisor: 'profesor',
  getPerfil: () => perfil,
  cargarGrupos: gruposProfesor,
  onEnviado: () => cargarComunicadosProf(),
})
window.abrirModalComunicadoProf = _comProf.abrir
window.cambiarGrupoComProf      = _comProf.cambiarGrupo
window.cambiarModoComProf       = _comProf.cambiarModo
window.actualizarResumenComProf = _comProf.actualizarResumen
window.enviarComunicadoProf     = _comProf.enviar