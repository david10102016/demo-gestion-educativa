// js/porteria/porteria-director.js
// Todo lo de Portería QR en el panel del DIRECTOR, fuera de director.js:
//   · Configuración → pestaña "Portería QR": switch, máx. salidas, horarios, regentes
//   · Asistencias → pestaña "Portería": resumen del día, listas, alertas, Justificar, cruce
//   · Estudiantes → "Credenciales QR": PDF por curso y reimpresión individual
// director.js solo llama a window.renderConfigPorteria(c) y window.cargarPorteriaDirector().
import { supabase, crearClienteTemporal } from '../config/supabase-config.js'
import { Config, invalidarConfigCache } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import { paginar } from '../utils/paginar.js'
import * as api from './porteria-api.js'
import { imprimirCredenciales } from './qr-imprimir.js'
import { montarFotos } from './fotos.js'

const $ = (id) => document.getElementById(id)
const POR_PAGINA = 50
let _perfil = null
let _activa = false
let _vista = { fecha: null, lista: 'ingresos', pagina: 1, datos: null, curso: '', nivel: '', turno: '' }
let _cursos = []          // [{ id, nombre_completo, nivel }]
let _horariosAct = []     // horarios activos: [{ turno, nivel }]
let _timer = null

// ─── Inicio: muestra/oculta lo del módulo según el switch ───
// Se inicia solo al importarse: director.js solo necesita  import '../porteria/porteria-director.js'
export async function initPorteriaDirector() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data } = await supabase.from('usuarios').select('id, colegio_id').eq('id', user.id).single()
  _perfil = data
  envolverTabsAsis()
  _activa = await api.porteriaActiva()
  aplicarVisibilidad()
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPorteriaDirector)
else initPorteriaDirector()

// Agrega la 3.ª pestaña sin tocar window.cambiarTabAsis de director.js
function envolverTabsAsis() {
  const original = window.cambiarTabAsis
  if (!original || original._porteria) return
  const nueva = function (tab) {
    const esPor = tab === 'porteria'
    $('asis-panel-porteria')?.classList.toggle('hidden', !esPor)
    const b = $('asis-tab-porteria')
    if (b) { b.classList.toggle('btn-primary', esPor); b.classList.toggle('btn-secondary', !esPor) }
    if (!esPor) return original(tab)
    ;['resumen', 'novedades'].forEach(t => {
      $(`asis-panel-${t}`)?.classList.add('hidden')
      const bt = $(`asis-tab-${t}`)
      if (bt) { bt.classList.remove('btn-primary'); bt.classList.add('btn-secondary') }
    })
    window.cargarPorteriaDirector()
  }
  nueva._porteria = true
  window.cambiarTabAsis = nueva
}

function aplicarVisibilidad() {
  $('asis-tab-porteria')?.classList.toggle('hidden', !_activa)
  $('btn-credenciales-qr')?.classList.toggle('hidden', !_activa)
  if (!_activa && !$('asis-panel-porteria')?.classList.contains('hidden')) window.cambiarTabAsis?.('resumen')
}

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN → PORTERÍA QR
// ════════════════════════════════════════════════════════════
window.renderConfigPorteria = async function (c) {
  const { data: g } = await supabase.from('config_gestion')
    .select('id, usa_porteria, porteria_max_salidas').eq('colegio_id', _perfil.colegio_id).eq('estado', 'activo').maybeSingle()
  _activa = !!g?.usa_porteria
  aplicarVisibilidad()

  c.innerHTML = `
    <div class="card">
      <div class="card-title">🚪 Portería QR — ingreso y salida de estudiantes</div>
      <p class="text-sm text-muted" style="margin-bottom:16px;">
        Opcional. Al activarla aparecen: la pestaña <strong>Portería</strong> en Asistencias, las <strong>Credenciales QR</strong> en Estudiantes,
        los horarios y los regentes. Si se desactiva, todo se oculta y los registros quedan guardados.
      </p>
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
        <input type="checkbox" id="cfg-porteria" ${_activa ? 'checked' : ''} style="width:20px;height:20px;">
        <span id="label-porteria" style="font-weight:600;">${_activa ? '✅ Portería QR activa' : 'Portería QR desactivada'}</span>
      </label>
      <div id="porteria-opciones" style="margin-top:16px;${_activa ? '' : 'display:none;'}">
        <label class="text-sm">Alertar si un estudiante sale más de
          <input type="number" id="cfg-max-salidas" min="1" max="20" value="${g?.porteria_max_salidas ?? 2}" style="width:70px;display:inline-block;margin:0 6px;">
          veces en un turno</label>
        <button class="btn btn-secondary btn-sm" id="btn-max-salidas" style="margin-left:8px;">Guardar</button>
      </div>
    </div>
    <div id="porteria-horarios" style="${_activa ? '' : 'display:none;'}"></div>
    <div id="porteria-excepciones" style="${_activa ? '' : 'display:none;'}"></div>
    <div id="porteria-regentes" style="${_activa ? '' : 'display:none;'}"></div>`

  $('cfg-porteria').onchange = (e) => cambiarSwitch(g?.id, e.target.checked)
  $('btn-max-salidas').onclick = async () => {
    const v = parseInt($('cfg-max-salidas').value, 10)
    if (!(v >= 1 && v <= 20)) { toast('Ingrese un número entre 1 y 20', 'warning'); return }
    const { error } = await supabase.from('config_gestion').update({ porteria_max_salidas: v }).eq('id', g.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Guardado', 'success')
  }
  if (_activa) { await pintarHorarios(); await pintarExcepciones(); await pintarRegentes() }
}

async function cambiarSwitch(gestionId, activo) {
  if (!gestionId) { toast('No se encontró la gestión activa', 'error'); return }
  if (!activo && !await confirmar('Desactivar Portería QR', 'Se ocultará en todos los paneles. Los registros quedan guardados. ¿Continuar?', 'Desactivar', 'Cancelar')) {
    $('cfg-porteria').checked = true; return
  }
  const { error } = await supabase.from('config_gestion').update({ usa_porteria: activo }).eq('id', gestionId)
  if (error) { toast(error.message, 'error'); $('cfg-porteria').checked = !activo; return }
  invalidarConfigCache()
  _activa = activo
  toast(activo ? 'Portería QR activada' : 'Portería QR desactivada', 'success')
  window.renderConfigPorteria($('config-contenido'))
}

// ─── Horarios turno × nivel ─────────────────────────────────
async function pintarHorarios() {
  const cont = $('porteria-horarios')
  const [{ data: cursos }, existentes] = await Promise.all([
    supabase.from('cursos').select('nivel').eq('colegio_id', _perfil.colegio_id).eq('activo', true),
    api.horarios().catch(() => []),
  ])
  const niveles = [...new Set((cursos ?? []).map(c => c.nivel).filter(Boolean))].sort()
  const mapa = new Map(existentes.map(h => [`${h.turno}|${h.nivel}`, h]))
  const filas = []
  for (const t of Object.keys(api.TURNOS)) {
    for (const n of niveles) {
      const h = mapa.get(`${t}|${n}`)
      filas.push(`
        <tr data-turno="${t}" data-nivel="${escapeHtml(n)}">
          <td><input type="checkbox" class="h-activo" ${h?.activo ? 'checked' : ''}></td>
          <td><strong>${api.TURNOS[t]}</strong></td>
          <td>${escapeHtml(n)}</td>
          <td><input type="time" class="h-entrada" value="${(h?.hora_entrada ?? '').slice(0, 5)}" style="width:110px;"></td>
          <td><input type="number" class="h-tol" min="0" max="120" value="${h?.tolerancia_min ?? 10}" style="width:70px;"></td>
          <td><input type="time" class="h-salida" value="${(h?.hora_salida ?? '').slice(0, 5)}" style="width:110px;"></td>
        </tr>`)
    }
  }
  cont.innerHTML = `
    <div class="card" style="margin-top:16px;">
      <div class="card-title">🕒 Horarios por turno y nivel</div>
      <p class="text-sm text-muted" style="margin-bottom:12px;">
        Marque solo los turnos que usa el colegio. Con la hora de entrada, la tolerancia y la hora de salida
        el sistema marca solo: a tiempo, atraso o salida anticipada. En invierno basta con cambiar las horas.
      </p>
      ${niveles.length ? `
      <div class="table-wrapper"><table>
        <thead><tr><th>Usa</th><th>Turno</th><th>Nivel</th><th>Entrada</th><th>Tolerancia (min)</th><th>Salida</th></tr></thead>
        <tbody>${filas.join('')}</tbody>
      </table></div>
      <button class="btn btn-primary" id="btn-guardar-horarios" style="margin-top:12px;">Guardar horarios</button>`
      : '<div class="text-muted">No hay cursos activos.</div>'}
    </div>`
  $('btn-guardar-horarios')?.addEventListener('click', guardarHorarios)
}

async function guardarHorarios() {
  const filas = [...document.querySelectorAll('#porteria-horarios tbody tr')]
  const cambios = []
  for (const tr of filas) {
    const activo = tr.querySelector('.h-activo').checked
    const entrada = tr.querySelector('.h-entrada').value
    const salida = tr.querySelector('.h-salida').value
    const tolerancia = parseInt(tr.querySelector('.h-tol').value, 10) || 0
    if (!activo && !entrada && !salida) continue
    if (activo && (!entrada || !salida)) { toast(`Complete entrada y salida: ${api.TURNOS[tr.dataset.turno]} – ${tr.dataset.nivel}`, 'warning'); return }
    if (entrada && salida) cambios.push({ turno: tr.dataset.turno, nivel: tr.dataset.nivel, entrada, salida, tolerancia, activo })
  }
  // Primero se desactivan, luego se activan (evita falsos cruces al mover horarios)
  cambios.sort((a, b) => Number(a.activo) - Number(b.activo))
  mostrarLoader('Guardando horarios...')
  try {
    for (const h of cambios) await api.guardarHorario(h)
    toast('Horarios guardados', 'success')
  } catch (e) {
    toast(e.message, 'error', 6000)
  } finally { ocultarLoader() }
  pintarHorarios()
}

// ─── Excepciones por grado (093) ────────────────────────────
// Ej.: Secundaria Tarde entra 13:30, pero 5° y 6° (todos sus paralelos) entran 14:00
async function pintarExcepciones() {
  const cont = $('porteria-excepciones')
  if (!cont) return
  const [{ data: cursos }, lista] = await Promise.all([
    supabase.from('cursos').select('nivel, grado').eq('colegio_id', _perfil.colegio_id).eq('activo', true),
    api.horariosGrado().catch(() => null),
  ])
  if (lista === null) { cont.innerHTML = ''; return }   // 093 aún no aplicada: no se muestra el bloque
  const gradosPorNivel = {}
  ;(cursos ?? []).forEach(c => { if (c.nivel && c.grado) (gradosPorNivel[c.nivel] ??= new Set()).add(c.grado) })
  const niveles = Object.keys(gradosPorNivel).sort()
  // Agrupa filas iguales (mismo turno, nivel y horas) en una línea: "5° y 6°"
  const grupos = new Map()
  lista.forEach(x => {
    const k = [x.turno, x.nivel, x.hora_entrada, x.tolerancia_min, x.hora_salida].join('|')
    if (!grupos.has(k)) grupos.set(k, { ...x, grados: [], ids: [] })
    grupos.get(k).grados.push(x.grado); grupos.get(k).ids.push(x.id)
  })
  const filas = [...grupos.values()]
  cont.innerHTML = `
    <div class="card" style="margin-top:16px;">
      <div class="card-title">🕑 Excepciones por grado</div>
      <p class="text-sm text-muted" style="margin-bottom:12px;">
        Para grados que entran o salen a otra hora que el resto de su nivel. Vale para todos los paralelos del grado.
        Ejemplo: Secundaria Tarde entra 13:30, pero 5° y 6° entran 14:00.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div><label>Turno</label><select id="ex-turno">${Object.entries(api.TURNOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div><label>Nivel</label><select id="ex-nivel">${niveles.map(n => `<option>${escapeHtml(n)}</option>`).join('')}</select></div>
        <div><label>Grados</label><div id="ex-grados" style="display:flex;gap:8px;flex-wrap:wrap;padding:6px 0;"></div></div>
        <div><label>Entrada</label><input type="time" id="ex-entrada" style="width:110px;"></div>
        <div><label>Tolerancia</label><input type="number" id="ex-tol" min="0" max="120" value="5" style="width:70px;"></div>
        <div><label>Salida</label><input type="time" id="ex-salida" style="width:110px;"></div>
        <button class="btn btn-primary" id="ex-guardar">Guardar excepción</button>
      </div>
      <div class="table-wrapper" style="margin-top:12px;"><table>
        <thead><tr><th>Turno</th><th>Nivel</th><th>Grados</th><th>Entrada</th><th>Tolerancia</th><th>Salida</th><th></th></tr></thead>
        <tbody>${filas.length ? filas.map((f, i) => `<tr>
          <td>${api.TURNOS[f.turno] ?? f.turno}</td><td>${escapeHtml(f.nivel)}</td>
          <td><strong>${f.grados.sort((a, b) => a - b).map(g => g + '°').join(', ')}</strong></td>
          <td>${String(f.hora_entrada).slice(0, 5)}</td><td>${f.tolerancia_min} min</td><td>${String(f.hora_salida).slice(0, 5)}</td>
          <td><button class="btn btn-danger btn-sm" data-quitar="${i}">Quitar</button></td></tr>`).join('')
          : '<tr><td colspan="7" class="text-muted">Sin excepciones: todos los grados usan el horario de su nivel.</td></tr>'}</tbody>
      </table></div>
    </div>`
  const pintarGrados = () => {
    const gs = [...(gradosPorNivel[$('ex-nivel').value] ?? [])].sort((a, b) => a - b)
    $('ex-grados').innerHTML = gs.map(g => `<label style="display:flex;align-items:center;gap:4px;"><input type="checkbox" class="ex-g" value="${g}" style="width:auto;"> ${g}°</label>`).join('')
  }
  pintarGrados()
  $('ex-nivel').onchange = pintarGrados
  $('ex-guardar').onclick = async () => {
    const grados = [...document.querySelectorAll('.ex-g:checked')].map(x => parseInt(x.value, 10))
    const entrada = $('ex-entrada').value, salida = $('ex-salida').value
    const tolerancia = parseInt($('ex-tol').value, 10) || 0
    if (!grados.length) { toast('Marque al menos un grado', 'warning'); return }
    if (!entrada || !salida) { toast('Complete entrada y salida', 'warning'); return }
    try {
      await api.guardarHorarioGrado({ turno: $('ex-turno').value, nivel: $('ex-nivel').value, grados, entrada, tolerancia, salida })
      toast('Excepción guardada', 'success')
      pintarExcepciones()
    } catch (e) { toast(e.message, 'error', 6000) }
  }
  cont.querySelectorAll('[data-quitar]').forEach(b => b.onclick = async () => {
    const f = filas[parseInt(b.dataset.quitar, 10)]
    if (!await confirmar('Quitar excepción', `${f.grados.map(g => g + '°').join(', ')} ${f.nivel} volverán al horario general del nivel. ¿Continuar?`, 'Quitar', 'Cancelar')) return
    try {
      for (const id of f.ids) await api.quitarHorarioGrado(id)
      toast('Excepción quitada', 'success')
      pintarExcepciones()
    } catch (e) { toast(e.message, 'error') }
  })
}

// ─── Regentes (mismo patrón que "Nueva secretaria") ─────────
async function pintarRegentes() {
  const { data } = await supabase.from('usuarios').select('id, nombre_completo, email, activo')
    .eq('rol', 'regente').eq('colegio_id', _perfil.colegio_id).order('nombre_completo')
  $('porteria-regentes').innerHTML = `
    <div class="card" style="margin-top:16px;">
      <div class="card-title">👮 Regentes</div>
      <p class="text-sm text-muted" style="margin-bottom:12px;">Solo pueden usar el escáner: registrar ingresos y salidas y anotar el motivo de atrasos y salidas anticipadas.</p>
      <button class="btn btn-primary" id="btn-nuevo-regente" style="margin-bottom:12px;">+ Nuevo regente</button>
      <div class="table-wrapper"><table>
        <thead><tr><th>Nombre</th><th>Email</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${(data ?? []).length ? data.map(u => `
          <tr>
            <td><strong>${escapeHtml(u.nombre_completo)}</strong></td>
            <td class="text-muted text-sm">${escapeHtml(u.email)}</td>
            <td><span class="badge ${u.activo ? 'badge-success' : 'badge-error'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td><button class="btn btn-danger btn-sm" data-toggle="${u.id}" data-activo="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button></td>
          </tr>`).join('') : '<tr><td colspan="4" class="text-muted">No hay regentes registrados.</td></tr>'}
        </tbody>
      </table></div>
    </div>`
  $('btn-nuevo-regente').onclick = abrirModalRegente
  document.querySelectorAll('#porteria-regentes [data-toggle]').forEach(b => b.onclick = async () => {
    const activo = b.dataset.activo === 'true'
    if (!await confirmar('Cambiar estado', `¿${activo ? 'Desactivar' : 'Activar'} este regente?`)) return
    const { error } = await supabase.from('usuarios').update({ activo: !activo }).eq('id', b.dataset.toggle)
    if (error) { toast(error.message, 'error'); return }
    pintarRegentes()
  })
}

function abrirModalRegente() {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><h2>Nuevo regente</h2></div>
      <div class="modal-body">
        <div class="form-group"><label>Nombre completo *</label><input id="reg-nombre" type="text" autocomplete="off"></div>
        <div class="form-group"><label>Email *</label><input id="reg-email" type="email" autocomplete="off" placeholder="correo@ejemplo.com"></div>
        <div class="form-group"><label>Contraseña *</label>
          <div style="position:relative;">
            <input id="reg-pass" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres" style="padding-right:42px;">
            <button type="button" title="Mostrar u ocultar contraseña" aria-label="Mostrar u ocultar contraseña"
              onclick="const i=this.previousElementSibling,v=i.type==='password';i.type=v?'text':'password';this.children[0].style.display=v?'none':'';this.children[1].style.display=v?'':'none'"
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;display:flex;color:var(--color-text-3,#6b7280);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="reg-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="reg-guardar">Guardar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  overlay.querySelector('#reg-cancelar').onclick = () => overlay.remove()
  // Correo con el formato del sistema: iniciales(2 apellidos + nombres).regente@<dominio del colegio>.educativa.com
  const inNom = overlay.querySelector('#reg-nombre'), inMail = overlay.querySelector('#reg-email')
  let mailEditado = false, dominio = null, tSug = null
  supabase.from('colegios').select('dominio_correo').eq('id', _perfil.colegio_id).single()
    .then(({ data }) => { dominio = data?.dominio_correo || null })
  inMail.addEventListener('input', () => { mailEditado = true })
  inNom.addEventListener('input', () => {
    if (mailEditado) return
    clearTimeout(tSug)
    tSug = setTimeout(async () => {
      const base = emailRegente(inNom.value, dominio)
      inMail.value = base ? await emailLibre(base) : ''
    }, 350)
  })
  overlay.querySelector('#reg-guardar').onclick = async () => {
    const nombre = overlay.querySelector('#reg-nombre').value.trim()
    const email = overlay.querySelector('#reg-email').value.trim()
    const password = overlay.querySelector('#reg-pass').value
    if (!nombre || !email || !password) { toast('Complete todos los campos', 'warning'); return }
    if (password.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'warning'); return }
    overlay.remove()
    mostrarLoader('Creando regente...')
    try {
      const temp = crearClienteTemporal()
      const { data: su, error } = await temp.auth.signUp({ email, password, options: { data: { nombre_completo: nombre } } })
      if (error) throw error
      await new Promise(r => setTimeout(r, 1000))
      const { error: e2 } = await supabase.rpc('asignar_rol_privilegiado', { p_usuario_id: su.user.id, p_rol: 'regente' })
      if (e2) throw e2
      toast('Regente creado. Ingresa con su email y contraseña desde el inicio de sesión.', 'success', 5000)
      pintarRegentes()
    } catch (e) {
      toast(e.message ?? 'Error creando regente', 'error')
    } finally { ocultarLoader() }
  }
}

// ════════════════════════════════════════════════════════════
// ASISTENCIAS → PORTERÍA
// ════════════════════════════════════════════════════════════
window.cargarPorteriaDirector = async function () {
  const panel = $('asis-panel-porteria')
  if (!panel) return
  if (!panel.dataset.armado) {
    panel.dataset.armado = '1'
    panel.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div><label>Fecha</label><input type="date" id="por-fecha" style="width:160px;"></div>
          <div><label>Turno</label><select id="por-turno" style="width:140px;"><option value="">Todos</option></select></div>
          <div><label>Nivel</label><select id="por-nivel" style="width:150px;"><option value="">Todos</option></select></div>
          <div><label>Curso</label><select id="por-curso" style="width:200px;"><option value="">Todos los cursos</option></select></div>
          <button class="btn btn-primary" id="por-ver">Ver</button>
          <button class="btn btn-secondary" id="por-cruce">Cruce con asistencia por materia</button>
        </div>
      </div>
      <div id="por-tarjetas"></div>
      <div id="por-lista"></div>`
    $('por-fecha').value = api.hoyBolivia()
    $('por-fecha').max = api.hoyBolivia()
    const [{ data: cursos }, hor] = await Promise.all([
      supabase.from('cursos').select('id, nombre_completo, nivel').eq('colegio_id', _perfil.colegio_id).eq('activo', true).order('nombre_completo'),
      api.horarios().catch(() => []),
    ])
    _cursos = cursos ?? []
    _horariosAct = hor.filter(h => h.activo)
    const turnos = Object.keys(api.TURNOS).filter(t => _horariosAct.some(h => h.turno === t))
    $('por-turno').innerHTML += turnos.map(t => `<option value="${t}">${api.TURNOS[t]}</option>`).join('')
    $('por-turno').onchange = () => { _vista.turno = $('por-turno').value; pintarSelectores(); refiltrar() }
    $('por-nivel').onchange = () => { _vista.nivel = $('por-nivel').value; pintarSelectores(); refiltrar() }
    $('por-curso').onchange = () => { _vista.curso = $('por-curso').value; refiltrar() }
    pintarSelectores()
    $('por-ver').onclick = () => verDia()
    $('por-cruce').onclick = verCruce
  }
  verDia()
  // Hoy: se actualiza sola cada minuto mientras la pestaña Portería esté abierta
  clearInterval(_timer)
  _timer = setInterval(() => {
    const visible = !document.hidden && !$('asis-panel-porteria')?.classList.contains('hidden') && !$('asis-panel-porteria')?.closest('.hidden')   // no refresca si la pestaña del navegador está oculta
    if (visible && _vista.fecha === api.hoyBolivia()) verDia(true)
  }, 60000)
}

// Nivel según turno elegido; curso según nivel y turno (cada uno depende del anterior)
function nivelesDeTurno(t) { return [...new Set(_horariosAct.filter(h => !t || h.turno === t).map(h => h.nivel))] }
function pintarSelectores() {
  const niv = [...new Set(_cursos.map(c => c.nivel).filter(Boolean))].sort().filter(n => !_vista.turno || nivelesDeTurno(_vista.turno).includes(n))
  if (_vista.nivel && !niv.includes(_vista.nivel)) _vista.nivel = ''
  $('por-nivel').innerHTML = '<option value="">Todos</option>' + niv.map(n => `<option value="${escapeHtml(n)}" ${n === _vista.nivel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')
  const cur = _cursos.filter(c => niv.includes(c.nivel) && (!_vista.nivel || c.nivel === _vista.nivel))
  if (_vista.curso && !cur.some(c => c.id === _vista.curso)) _vista.curso = ''
  $('por-curso').innerHTML = '<option value="">Todos los cursos</option>' + cur.map(c => `<option value="${c.id}" ${c.id === _vista.curso ? 'selected' : ''}>${escapeHtml(c.nombre_completo)}</option>`).join('')
}
function refiltrar() { _vista.pagina = 1; if (_vista.datos) { pintarTarjetas(); pintarLista() } }

// ¿El estudiante entra en los filtros Turno / Nivel / Curso?
function estudianteVisible(e) {
  const nivel = e?.curso?.nivel
  if (_vista.curso) return e?.curso_id === _vista.curso
  if (_vista.nivel && nivel !== _vista.nivel) return false
  if (_vista.turno && !nivelesDeTurno(_vista.turno).includes(nivel)) return false
  return true
}
// Turno posterior de un nivel con dos turnos (ej. Secundaria tarde): no todos los cursos vienen,
// así que "No ingresaron" solo se calcula si la directora elige un curso
function ausentesIndefinidos() {
  if (!_vista.turno || _vista.curso) return false
  const niveles = _vista.nivel ? [_vista.nivel] : nivelesDeTurno(_vista.turno)
  return niveles.some(n => {
    const hs = _horariosAct.filter(h => h.nivel === n).sort((a, b) => String(a.hora_entrada).localeCompare(String(b.hora_entrada)))
    return hs.length > 1 && hs[0].turno !== _vista.turno
  })
}
// Registros del día ya filtrados (turno del registro + estudiante visible)
function regsFiltrados() {
  const { regs, estudiantes } = _vista.datos
  const visibles = new Set(estudiantes.filter(estudianteVisible).map(e => e.id))
  return regs.filter(r => visibles.has(r.estudiante_id) && (!_vista.turno || r.turno === _vista.turno))
}

async function verDia(silencioso = false) {
  const fecha = $('por-fecha').value || api.hoyBolivia()
  _vista = { ..._vista, fecha, pagina: silencioso ? _vista.pagina : 1, datos: silencioso ? _vista.datos : null }
  if (!silencioso) mostrarLoader('Cargando portería...')
  try {
    const [regs, estudiantes, alertasPend] = await Promise.all([
      api.registros({ desde: fecha, hasta: fecha, conNombres: true }),
      estudiantesActivos(),
      api.alertas({ estado: 'pendiente', conNombres: true }),
    ])
    _vista.datos = { regs, estudiantes, alertasPend }
    pintarTarjetas()
    pintarLista()
  } catch (e) {
    if (!silencioso) toast(e.message, 'error')
  } finally { if (!silencioso) ocultarLoader() }
}

let _cacheEst = null
async function estudiantesActivos() {
  if (_cacheEst) return _cacheEst
  const { data, error } = await paginar(() => supabase.from('estudiantes')
    .select('id, curso_id, curso:cursos(nombre_completo, nivel), usuarios!inner(nombre_completo, activo)')
    .eq('colegio_id', _perfil.colegio_id).eq('usuarios.activo', true), ['id'])
  if (error) throw new Error(error.message)
  _cacheEst = data ?? []
  return _cacheEst
}

function pintarTarjetas() {
  // Conteos calculados con los filtros Turno / Nivel / Curso aplicados
  const { estudiantes, alertasPend } = _vista.datos
  const vis = estudiantes.filter(estudianteVisible)
  const ids = new Set(vis.map(e => e.id))
  const regs = regsFiltrados().filter(x => !x.duplicado)
  const conIng = new Set(regs.filter(x => x.tipo === 'entrada').map(x => x.estudiante_id))
  const r = {
    total_estudiantes: vis.length,
    con_ingreso: conIng.size,
    sin_ingreso: ausentesIndefinidos() ? '—' : vis.length - conIng.size,
    atrasos: new Set(regs.filter(x => x.estado === 'atraso').map(x => x.estudiante_id)).size,
    salidas_anticipadas: new Set(regs.filter(x => x.estado === 'salida_anticipada').map(x => x.estudiante_id)).size,
    alertas_pendientes: alertasPend.filter(a => ids.has(a.estudiante_id)).length,
  }
  const t = (clave, titulo, valor, color, sub = '') => `
    <button class="stat-card" data-lista="${clave}" style="cursor:pointer;text-align:left;border:2px solid ${_vista.lista === clave ? color : 'transparent'};">
      <div class="stat-card-label">${titulo}</div>
      <div class="stat-card-value" style="color:${color};">${valor}</div>
      ${sub ? `<div class="text-sm text-muted">${sub}</div>` : ''}
    </button>`
  $('por-tarjetas').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
      ${t('ingresos', '🟢 Ingresaron', `${r.con_ingreso}`, '#16a34a', `de ${r.total_estudiantes}`)}
      ${t('atrasos', '🟠 Atrasos', r.atrasos, '#c2410c')}
      ${t('sin_ingreso', '⚪ No ingresaron', r.sin_ingreso, '#475569', r.sin_ingreso === '—' ? 'Elija un curso' : '')}
      ${t('salidas', '🟡 Salidas anticipadas', r.salidas_anticipadas, '#a16207')}
      ${t('alertas', '🔔 Alertas pendientes', r.alertas_pendientes, '#b91c1c', 'de todos los días')}
    </div>`
  document.querySelectorAll('#por-tarjetas [data-lista]').forEach(b => b.onclick = () => {
    _vista.lista = b.dataset.lista; _vista.pagina = 1; pintarTarjetas(); pintarLista()
  })
}

function filas() {
  const { estudiantes, alertasPend } = _vista.datos
  const regs = regsFiltrados()
  const porId = new Map(estudiantes.map(e => [e.id, e]))
  const nombreEst = (id) => porId.get(id)
  const porEst = new Map()
  regs.forEach(r => { if (!porEst.has(r.estudiante_id)) porEst.set(r.estudiante_id, []); porEst.get(r.estudiante_id).push(r) })

  if (_vista.lista === 'alertas') {
    return alertasPend
      .filter(a => estudianteVisible(nombreEst(a.estudiante_id)))
      .map(a => ({ alerta: a, nombre: a.estudiante?.usuarios?.nombre_completo, curso: a.estudiante?.curso?.nombre_completo }))
  }
  if (_vista.lista === 'sin_ingreso') {
    if (ausentesIndefinidos()) return []
    return estudiantes
      .filter(e => estudianteVisible(e) && !(porEst.get(e.id) ?? []).some(r => r.tipo === 'entrada' && !r.duplicado))
      .map(e => ({ nombre: e.usuarios?.nombre_completo, curso: e.curso?.nombre_completo, resumen: null }))
      .sort((a, b) => (a.curso ?? '').localeCompare(b.curso ?? '') || (a.nombre ?? '').localeCompare(b.nombre ?? ''))
  }
  const out = []
  for (const [id, lista] of porEst) {
    const e = nombreEst(id)
    if (!estudianteVisible(e)) continue
    const res = api.resumirDia(lista)
    const tieneAtraso = lista.some(r => r.estado === 'atraso' && !r.duplicado)
    const tieneAnt = lista.some(r => r.estado === 'salida_anticipada' && !r.duplicado)
    if (_vista.lista === 'atrasos' && !tieneAtraso) continue
    if (_vista.lista === 'salidas' && !tieneAnt) continue
    if (_vista.lista === 'ingresos' && !res.entrada) continue
    out.push({ nombre: e?.usuarios?.nombre_completo ?? lista[0]?.estudiante?.usuarios?.nombre_completo, curso: e?.curso?.nombre_completo, resumen: res })
  }
  return out.sort((a, b) => (a.curso ?? '').localeCompare(b.curso ?? '') || (a.nombre ?? '').localeCompare(b.nombre ?? ''))
}

function pintarLista() {
  if (!_vista.datos) return
  const todas = filas()
  const total = todas.length
  const pag = Math.max(1, Math.min(_vista.pagina, Math.ceil(total / POR_PAGINA) || 1))
  const lote = todas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA)
  const titulos = { ingresos: 'Ingresaron', atrasos: 'Con atraso', sin_ingreso: 'No ingresaron', salidas: 'Salidas anticipadas', alertas: 'Alertas pendientes' }

  let cuerpo
  if (_vista.lista === 'sin_ingreso' && ausentesIndefinidos()) {
    cuerpo = '<div class="empty-state"><div class="empty-state-title">Elija un curso para ver los ausentes de este turno</div><div class="text-sm text-muted">En este turno no vienen todos los cursos del nivel.</div></div>'
  } else if (!total) {
    cuerpo = '<div class="empty-state"><div class="empty-state-title">Sin registros para este filtro</div></div>'
  } else if (_vista.lista === 'alertas') {
    cuerpo = `<table><thead><tr><th>Fecha</th><th>Estudiante</th><th>Curso</th><th>Alerta</th><th>Nota del regente</th><th></th></tr></thead><tbody>
      ${lote.map(f => `<tr>
        <td>${api.fechaLarga(f.alerta.fecha)}</td>
        <td><strong>${escapeHtml(f.nombre ?? '—')}</strong></td>
        <td>${escapeHtml(f.curso ?? '')}</td>
        <td>${escapeHtml(api.ALERTAS[f.alerta.tipo] ?? f.alerta.tipo)}${f.alerta.registro?.hora ? ` · ${api.horaBolivia(f.alerta.registro.hora)}` : ''}</td>
        <td class="text-sm">${escapeHtml(f.alerta.registro?.motivo ?? '—')}</td>
        <td><button class="btn btn-primary btn-sm" data-justificar="${f.alerta.id}" data-sugerencia="${escapeHtml(f.alerta.registro?.motivo ?? '')}">Justificar</button></td>
      </tr>`).join('')}</tbody></table>`
  } else if (_vista.lista === 'sin_ingreso') {
    cuerpo = `<table><thead><tr><th>Estudiante</th><th>Curso</th></tr></thead><tbody>
      ${lote.map(f => `<tr><td><strong>${escapeHtml(f.nombre ?? '—')}</strong></td><td>${escapeHtml(f.curso ?? '')}</td></tr>`).join('')}</tbody></table>`
  } else {
    cuerpo = `<table><thead><tr><th>Estudiante</th><th>Curso</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Movimientos</th></tr></thead><tbody>
      ${lote.map(f => {
        const r = f.resumen, e = api.ESTADOS[r.estado] ?? api.ESTADOS.a_tiempo
        const movs = r.movimientos.map(m => `${m.tipo === 'entrada' ? '⬇' : '⬆'} ${api.horaBolivia(m.hora)}${m.metodo === 'manual' ? ' (sin QR)' : ''}${m.motivo ? ` — ${escapeHtml(m.motivo)}` : ''}`).join('<br>')
        return `<tr>
          <td><strong>${escapeHtml(f.nombre ?? '—')}</strong></td>
          <td>${escapeHtml(f.curso ?? '')}</td>
          <td>${api.horaBolivia(r.entrada)}</td>
          <td>${api.horaBolivia(r.salida)}</td>
          <td><span class="badge" style="background:${e.fondo};color:${e.color};">${e.icono} ${e.texto}</span></td>
          <td class="text-sm">${movs}</td>
        </tr>`
      }).join('')}</tbody></table>`
  }

  const paginas = Math.ceil(total / POR_PAGINA)
  $('por-lista').innerHTML = `
    <div class="card" style="padding:0;">
      <div style="padding:12px 16px;font-weight:700;">${titulos[_vista.lista]} — ${api.fechaLarga(_vista.fecha, { weekday: 'long', day: 'numeric', month: 'long' })} (${total})</div>
      <div class="table-wrapper">${cuerpo}</div>
      ${paginas > 1 ? `<div style="padding:12px 16px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" data-pag="${pag - 1}" ${pag <= 1 ? 'disabled' : ''}>‹</button>
        <span class="text-sm">Página ${pag} de ${paginas}</span>
        <button class="btn btn-secondary btn-sm" data-pag="${pag + 1}" ${pag >= paginas ? 'disabled' : ''}>›</button></div>` : ''}
    </div>`
  document.querySelectorAll('#por-lista [data-pag]').forEach(b => b.onclick = () => { _vista.pagina = parseInt(b.dataset.pag, 10); pintarLista() })
  document.querySelectorAll('#por-lista [data-justificar]').forEach(b => b.onclick = () => abrirJustificar(b.dataset.justificar, b.dataset.sugerencia))
}

function abrirJustificar(alertaId, sugerencia) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><h2>Justificar alerta</h2></div>
      <div class="modal-body">
        <label>Motivo de la justificación *</label>
        <textarea id="just-motivo" rows="3" style="width:100%;" maxlength="300">${escapeHtml(sugerencia ?? '')}</textarea>
        <p class="text-sm text-muted">Queda registrado quién justificó, cuándo y por qué. El estudiante y su tutor verán la justificación.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="just-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="just-guardar">Justificar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  overlay.querySelector('#just-cancelar').onclick = () => overlay.remove()
  overlay.querySelector('#just-guardar').onclick = async () => {
    const motivo = overlay.querySelector('#just-motivo').value.trim()
    if (!motivo) { toast('Escriba el motivo', 'warning'); return }
    try {
      await api.justificar(alertaId, motivo)
      overlay.remove()
      toast('Alerta justificada', 'success')
      verDia()
    } catch (e) { toast(e.message, 'error') }
  }
}

async function verCruce() {
  const fecha = $('por-fecha').value || api.hoyBolivia()
  mostrarLoader('Cruzando con la asistencia por materia...')
  try {
    const filasCruce = await api.cruceDia(fecha)
    $('por-lista').innerHTML = `
      <div class="card" style="padding:0;">
        <div style="padding:12px 16px;">
          <div style="font-weight:700;">Cruce portería × asistencia por materia — ${api.fechaLarga(fecha, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div class="text-sm text-muted">Posible fuga: entró al colegio y tiene falta en una clase (excepto si la novedad del día es "En dirección").
          Inconsistencia: el profesor lo marcó presente pero no pasó por portería.</div>
        </div>
        <div class="table-wrapper">${filasCruce?.length ? `<table><thead><tr><th>Estudiante</th><th>Curso</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>
          ${filasCruce.map(f => `<tr><td><strong>${escapeHtml(f.nombre_completo)}</strong></td><td>${escapeHtml(f.curso ?? '')}</td>
            <td>${f.tipo === 'posible_fuga' ? '🔴 Posible fuga' : '🟠 Inconsistencia'}</td><td class="text-sm">${escapeHtml(f.detalle)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty-state"><div class="empty-state-title">Sin diferencias ese día</div></div>'}</div>
      </div>`
  } catch (e) { toast(e.message, 'error') } finally { ocultarLoader() }
}

// ════════════════════════════════════════════════════════════
// ESTUDIANTES → CREDENCIALES QR
// ════════════════════════════════════════════════════════════
window.abrirCredencialesQr = async function () {
  const { data: cursos } = await supabase.from('cursos').select('id, nombre_completo, nivel, grado, paralelo').eq('colegio_id', _perfil.colegio_id).eq('activo', true)
    .order('nivel').order('grado').order('paralelo')
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:620px;">
      <div class="modal-header"><h2>🪪 Credenciales QR</h2><button class="btn-close-modal" id="cred-cerrar">×</button></div>
      <div class="modal-body">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
          <div><label>Exportar</label><select id="cred-modo" style="min-width:160px;">
            <option value="curso">Un curso</option><option value="nivel-continuo">Un nivel (PDF continuo)</option><option value="colegio-continuo">Todo el colegio (PDF continuo)</option><option value="nivel">Un nivel (.zip por curso)</option><option value="colegio">Todo el colegio (.zip por curso)</option></select></div>
          <div id="cred-box-curso"><label>Curso</label><select id="cred-curso" style="min-width:220px;"><option value="">Selecciona curso</option>
            ${(cursos ?? []).map(c => `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('')}</select></div>
          <div id="cred-box-nivel" style="display:none;"><label>Nivel</label><select id="cred-nivel" style="min-width:160px;">
            ${[...new Set((cursos ?? []).map(c => c.nivel).filter(Boolean))].sort().map(n => `<option>${escapeHtml(n)}</option>`).join('')}</select></div>
          <div><label>Formato</label><select id="cred-orientacion" style="min-width:170px;">
            <option value="vertical">Vertical · 9 por hoja</option><option value="horizontal">Horizontal · 10 por hoja</option></select></div>
          <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="cred-incluir-fotos" checked style="width:auto;"> Incluir fotos</label>
        </div>
        <p class="text-sm text-muted" style="margin:10px 0;">Tarjeta de 8,56 × 5,4 cm en hoja carta (vertical 9 por hoja, horizontal 10). Lleva el usuario de acceso, sin contraseña. Si un estudiante no tiene foto sale un recuadro para pegarla.
        Imprimir al 100 % (sin "ajustar a página").
        Imprimir en buena calidad; si se plastifica, que sea mate.</p>
        <div id="cred-lista" style="max-height:45vh;overflow-y:auto;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cred-cancelar">Cerrar</button>
        <button class="btn btn-secondary" id="cred-btn-fotos">📷 Fotos</button>
        <button class="btn btn-primary" id="cred-pdf" disabled>📄 PDF del curso</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  const cerrar = () => overlay.remove()
  overlay.querySelector('#cred-cerrar').onclick = cerrar
  overlay.querySelector('#cred-cancelar').onclick = cerrar
  overlay.querySelector('#cred-btn-fotos').onclick = abrirFotosDirector
  const incluirFotos = () => overlay.querySelector('#cred-incluir-fotos').checked
  const orientacion = () => overlay.querySelector('#cred-orientacion').value

  // Modo: curso (como antes) · nivel / colegio en PDF continuo (ahorra hojas) · nivel / colegio → .zip con un PDF por curso
  const selModo = overlay.querySelector('#cred-modo')
  selModo.onchange = () => {
    const m = selModo.value, continuo = m.endsWith('-continuo')
    overlay.querySelector('#cred-box-curso').style.display = m === 'curso' ? '' : 'none'
    overlay.querySelector('#cred-box-nivel').style.display = m.startsWith('nivel') ? '' : 'none'
    overlay.querySelector('#cred-lista').innerHTML = m === 'curso' ? '' : continuo
      ? '<div class="text-sm text-muted">Se genera UN solo PDF con todos los cursos seguidos, sin hojas a medio llenar. Cada credencial lleva su curso y cada hoja indica en el margen qué cursos contiene, para repartir después del corte. Se crean los QR que falten; no se anula ninguno.</div>'
      : '<div class="text-sm text-muted">Se genera un .zip con un PDF por curso, en el formato elegido. Se crean los QR que falten; no se anula ninguno.</div>'
    const btn = overlay.querySelector('#cred-pdf')
    btn.textContent = m === 'curso' ? '📄 PDF del curso' : continuo ? '📄 Generar PDF continuo' : '🗜️ Generar .zip'
    btn.disabled = m === 'curso' ? !estudiantes.length : false
  }

  let estudiantes = []
  const selCurso = overlay.querySelector('#cred-curso')
  selCurso.onchange = async () => {
    const lista = overlay.querySelector('#cred-lista')
    overlay.querySelector('#cred-pdf').disabled = true
    if (!selCurso.value) { lista.innerHTML = ''; return }
    lista.innerHTML = '<div class="text-muted">Preparando códigos...</div>'
    try {
      estudiantes = await api.generarQrCurso(selCurso.value) ?? []   // crea los QR faltantes
      const fotos = await fotosDe(estudiantes.map(e => e.estudiante_id))
      estudiantes = estudiantes.map(e => ({ ...e, foto_url: fotos.get(e.estudiante_id) ?? null, email: fotos.emails.get(e.estudiante_id) ?? '' }))
      lista.innerHTML = estudiantes.length ? `<table><tbody>${estudiantes.map(e => `
        <tr><td>${escapeHtml(e.nombre_completo)}</td>
        <td style="text-align:right;"><button class="btn btn-secondary btn-sm" data-reimp="${e.estudiante_id}">Reimprimir</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="text-muted">El curso no tiene estudiantes activos.</div>'
      overlay.querySelector('#cred-pdf').disabled = !estudiantes.length
      lista.querySelectorAll('[data-reimp]').forEach(b => b.onclick = () => reimprimir(b.dataset.reimp))
    } catch (e) { lista.innerHTML = `<div style="color:#b91c1c;">${escapeHtml(e.message)}</div>` }
  }

  const cursoTexto = () => selCurso.options[selCurso.selectedIndex]?.text ?? ''
  overlay.querySelector('#cred-pdf').onclick = async () => {
    const m = selModo.value, nivelElegido = m.startsWith('nivel') ? overlay.querySelector('#cred-nivel').value : null
    if (m.endsWith('-continuo')) return generarContinuo(nivelElegido)
    if (m !== 'curso') return generarZip(nivelElegido)
    mostrarLoader('Generando PDF...')
    try {
      await imprimirCredenciales({
        colegio: await datosColegio(), gestion: Config.año, curso: cursoTexto(),
        estudiantes, incluirFotos: incluirFotos(), orientacion: orientacion(),
        archivo: `credenciales_${cursoTexto().replace(/[^a-zA-Z0-9]+/g, '_')}_${Config.año}.pdf`,
      })
    } catch (e) { toast(e.message, 'error') } finally { ocultarLoader() }
  }

  async function generarZip(nivel) {
    if (typeof JSZip === 'undefined') { toast('No se cargó la librería ZIP. Recargue la página.', 'error'); return }
    const lista = (cursos ?? []).filter(c => !nivel || c.nivel === nivel)
    if (!lista.length) { toast('No hay cursos para exportar', 'warning'); return }
    const colegio = await datosColegio()
    const { logoReducido } = await import('./qr-imprimir.js')
    const logoData = await logoReducido(colegio?.logo_url)              // se descarga y reduce una sola vez
    const zip = new JSZip()
    const raiz = zip.folder(`Credenciales-QR-${nivel ?? 'Colegio'}-${Config.año}`)
    const limpio = (t) => (t ?? '').replace(/°/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    let hechos = 0, vacios = 0, fallidos = []
    // Datos de los cursos en paralelo (de a 4); los PDF se arman en orden a medida que llegan
    const preparar = async (c) => {
      let ests = await api.generarQrCurso(c.id) ?? []
      if (ests.length) {   // fotos (si se piden) y usuario de acceso de cada estudiante
        const fotos = await fotosDe(ests.map(e => e.estudiante_id), incluirFotos())
        ests = ests.map(e => ({ ...e, foto_url: fotos.get(e.estudiante_id) ?? null, email: fotos.emails.get(e.estudiante_id) ?? '' }))
      }
      return ests
    }
    const pendientes = lista.map(() => null)
    let siguiente = 0
    const lanzar = () => { if (siguiente < lista.length) { const i = siguiente++; pendientes[i] = preparar(lista[i]).catch(e => ({ error: e })) } }
    for (let k = 0; k < 4; k++) lanzar()
    try {
      for (let i = 0; i < lista.length; i++) {
        const c = lista[i]
        mostrarLoader(`Generando ${c.nombre_completo} (${i + 1} de ${lista.length})...`)
        const ests = await pendientes[i]
        lanzar()
        if (ests?.error) { fallidos.push(c.nombre_completo); continue }
        if (!ests.length) { vacios++; continue }
        try {
          const buf = await imprimirCredenciales({ colegio, gestion: Config.año, curso: c.nombre_completo, estudiantes: ests,
            incluirFotos: incluirFotos(), orientacion: orientacion(), soloBuffer: true, logoData })
          const carpeta = nivel ? raiz : raiz.folder(c.nivel ?? 'Otros')
          carpeta.file(`${limpio(c.nombre_completo)}.pdf`, buf)
          hechos++
        } catch (e) { fallidos.push(c.nombre_completo) }
      }
      if (!hechos) { toast('No se generó ningún PDF', 'warning'); return }
      mostrarLoader('Comprimiendo...')
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `Credenciales-QR-${nivel ?? 'Colegio'}-${Config.año}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      toast(`${hechos} curso(s) en el .zip${vacios ? ` · ${vacios} sin estudiantes` : ''}`, 'success', 6000)
      if (fallidos.length) toast(`No se pudieron generar: ${fallidos.join(', ')}`, 'error', 8000)
    } finally { ocultarLoader() }
  }

  // Un solo PDF con todos los cursos del nivel (o del colegio) seguidos: las hojas se llenan completas
  async function generarContinuo(nivel) {
    const lista = (cursos ?? []).filter(c => !nivel || c.nivel === nivel)
    if (!lista.length) { toast('No hay cursos para exportar', 'warning'); return }
    const colegio = await datosColegio()
    const { logoReducido } = await import('./qr-imprimir.js')
    const logoData = await logoReducido(colegio?.logo_url)
    const todos = [], fallidos = []
    try {
      for (let i = 0; i < lista.length; i += 4) {      // de a 4 cursos en paralelo, en orden
        const bloque = lista.slice(i, i + 4)
        mostrarLoader(`Preparando cursos ${i + 1}–${i + bloque.length} de ${lista.length}...`)
        const res = await Promise.all(bloque.map(async (c) => {
          const ests = await api.generarQrCurso(c.id) ?? []
          if (!ests.length) return []
          const fotos = await fotosDe(ests.map(e => e.estudiante_id), incluirFotos())
          return ests.map(e => ({ ...e, curso: c.nombre_completo, foto_url: fotos.get(e.estudiante_id) ?? null, email: fotos.emails.get(e.estudiante_id) ?? '' }))
        }).map((p, k) => p.catch(() => { fallidos.push(bloque[k].nombre_completo); return [] })))
        res.forEach(r => todos.push(...r))
      }
      if (!todos.length) { toast('No hay estudiantes para imprimir', 'warning'); return }
      const porHoja = orientacion() === 'horizontal' ? 10 : 9
      mostrarLoader(`Generando PDF (${todos.length} credenciales, ${Math.ceil(todos.length / porHoja)} hojas)...`)
      await imprimirCredenciales({ colegio, gestion: Config.año, curso: '', estudiantes: todos,
        incluirFotos: incluirFotos(), orientacion: orientacion(), logoData, etiquetaHojas: true,
        archivo: `Credenciales-QR-${(nivel ?? 'Colegio').replace(/[^a-zA-Z0-9]+/g, '_')}-continuo-${Config.año}.pdf` })
      toast(`${todos.length} credenciales en ${Math.ceil(todos.length / porHoja)} hojas`, 'success', 6000)
      if (fallidos.length) toast(`No se pudieron preparar: ${fallidos.join(', ')}`, 'error', 8000)
    } catch (e) { toast(e.message, 'error') } finally { ocultarLoader() }
  }

  async function reimprimir(estudianteId) {
    const e = estudiantes.find(x => x.estudiante_id === estudianteId)
    if (!await confirmar('Reimprimir credencial', `Se anulará el QR actual de ${e?.nombre_completo ?? 'este estudiante'} (dejará de funcionar) y se generará uno nuevo. ¿Continuar?`, 'Reimprimir', 'Cancelar')) return
    mostrarLoader('Generando credencial...')
    try {
      const codigo = await api.regenerarQr(estudianteId)
      e.codigo = codigo
      await imprimirCredenciales({
        colegio: await datosColegio(), gestion: Config.año, curso: cursoTexto(),
        estudiantes: [e], incluirFotos: incluirFotos(), orientacion: orientacion(),
        archivo: `credencial_${(e.nombre_completo ?? '').replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`,
      })
      toast('QR anterior anulado. Credencial nueva generada.', 'success')
    } catch (err) { toast(err.message, 'error') } finally { ocultarLoader() }
  }
}

// Modo Fotos para el director (mismo módulo que el regente; además puede restaurar la anterior)
function abrirFotosDirector() {
  const ov = document.createElement('div')
  ov.className = 'modal-overlay'
  ov.innerHTML = '<div class="modal-box" style="max-width:560px;"><div class="modal-body" id="fotos-dir"></div></div>'
  document.body.appendChild(ov)
  montarFotos(ov.querySelector('#fotos-dir'), { colegioId: _perfil.colegio_id, esDirector: true, onVolver: () => ov.remove() })
}

async function datosColegio() {
  const { data } = await supabase.from('colegios').select('nombre, logo_url, color_primario').eq('id', _perfil.colegio_id).single()
  return data ?? { nombre: '', logo_url: null, color_primario: null }
}

// Foto (enlace firmado) y usuario de acceso (correo) de cada estudiante. mapa.get(id) = foto, mapa.emails.get(id) = correo
async function fotosDe(ids, conFotos = true) {
  const mapa = new Map()
  mapa.emails = new Map()
  if (!ids.length) return mapa
  const { data } = await supabase.from('estudiantes').select('id, foto_url, usuarios(email)').in('id', ids)
  ;(data ?? []).forEach(e => mapa.emails.set(e.id, e.usuarios?.email ?? ''))
  const rutas = conFotos ? (data ?? []).map(e => e.foto_url).filter(Boolean) : []
  const firmadas = rutas.length ? await api.urlsFirmadas(rutas, 900) : new Map()   // fotos privadas: enlaces temporales para el PDF
  ;(data ?? []).forEach(e => mapa.set(e.id, e.foto_url ? (firmadas.get(e.foto_url) ?? null) : null))
  return mapa
}

// Mismo criterio que generarEmailProfesor (director.js): 2 primeras palabras = apellidos, el resto nombres
function emailRegente(nombreCompleto, dominio) {
  const sinAcentos = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const ini = (nombreCompleto ?? '').trim().split(/\s+/).filter(Boolean)
    .map(p => sinAcentos(p[0] || '').toLowerCase().replace(/[^a-z]/g, '')).join('')
  if (!ini) return ''
  return `${ini}.regente@${dominio ? `${dominio}.` : ''}educativa.com`
}

// Si el correo ya existe agrega 2, 3, ... (pmc.regente2@...)
async function emailLibre(base) {
  const [local, host] = base.split('@')
  for (let n = 1; n <= 20; n++) {
    const email = n === 1 ? base : `${local}${n}@${host}`
    const { count } = await supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('email', email)
    if (!count) return email
  }
  return base
}