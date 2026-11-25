// js/estudiante/mis-tareas.js
// "Mis tareas" del estudiante: todas las actividades del trimestre activo de sus materias,
// en un solo lugar, con contador en el menú.
//   · Hacer  = tareas. Saber = evaluaciones (aviso para prepararse, nunca "pendiente").
//   · Contador: tareas nuevas que no abrió + tareas con fecha que aún no vencen y no tienen nota
//     + notas nuevas que no vio. Las tareas sin fecha no presionan: "Atento en clase".
//   · Lo visto se guarda en la tabla tareas_vistas (migración 104): vale en cualquier dispositivo.
//   · Al tocar una tarjeta se abre el detalle de ESA actividad (sin pasar por la lupa).
import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { escapeHtml } from '../utils/sanitize.js'
import { cursosDelGrado } from '../utils/tecnica-grado.js'
import { estaVencida } from '../utils/entrega-tardia.js'
import { fetchConCache } from '../utils/data-layer.js'
import { insertarAvisoCopia } from '../utils/connection-status.js'

let _perfil = null
let _est = null          // { id, curso_id, curso: { nivel, grado } }
let _irA = null          // función para cambiar de sección (mostrarSec)
let _items = []          // actividades ya procesadas
let _cargado = false     // true cuando _items ya tiene datos válidos
let _copia = null        // { syncedAt } cuando _items viene de la copia guardada (sin conexión)
let _vistas = { actividad: new Set(), nota: new Set() }

// Fecha en que se publicó "Mis tareas". Lo creado o calificado ANTES no se marca como nuevo
// (si no, el primer día todo el historial aparecería como "Nueva" / "Nota nueva").
const INICIO_AVISOS = '2026-11-13T00:00:00-04:00'

const AVISO = '<strong>Atento en clase:</strong> tu profesor indica las tareas y las fechas. Ante cualquier duda, pregúntale a él o a un compañero. No te quedes con dudas.'

// ─── Fechas ──────────────────────────────────────────────
function hoyISO() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function diasHasta(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const h = new Date(); h.setHours(0, 0, 0, 0)
  return Math.round((new Date(y, m - 1, d) - h) / 86400000)
}
function fechaCorta(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })
}

// ─── Datos ───────────────────────────────────────────────
async function materiasDelEstudiante() {
  const ids = new Set(); const tecnicas = new Set()
  // Las dos consultas van en paralelo (antes una esperaba a la otra)
  const [{ data: asigs, error: e1 }, { data: insc, error: e2 }] = await Promise.all([
    supabase.from('asignaciones_profesor').select('materia_id').eq('curso_id', _est.curso_id).eq('activo', true),
    supabase.from('inscripciones_tecnicas').select('materia_id').eq('estudiante_id', _est.id).eq('activo', true),
  ])
  if (e1 || e2) throw (e1 ?? e2)
  ;(asigs ?? []).forEach(a => ids.add(a.materia_id))
  ;(insc ?? []).forEach(i => tecnicas.add(i.materia_id))
  // Si el plan del colegio no incluye carreras técnicas, su detalle está bloqueado: no se listan
  const tec = Config.usaCarrerasTecnicas ? [...tecnicas] : []
  return { regulares: [...ids].filter(id => !tecnicas.has(id)), tecnicas: tec }
}

async function cargarDatos() {
  if (!_est?.curso_id) return []
  const trim = Config.trimestreActivo ?? 1
  // Materias y cursos del grado en paralelo
  const [{ regulares, tecnicas }, grado] = await Promise.all([
    materiasDelEstudiante(),
    cursosDelGrado(_est.curso_id),
  ])
  const sel = 'id, titulo, descripcion, tipo, max_puntos, fecha_limite, hora_limite, permite_entrega_tardia, created_at, materia_id, materia:materias(nombre)'
  const consultas = []
  if (regulares.length) consultas.push(supabase.from('actividades').select(sel)
    .eq('trimestre', trim).in('tipo', ['hacer', 'saber']).eq('curso_id', _est.curso_id).in('materia_id', regulares))
  if (tecnicas.length) {
    consultas.push(supabase.from('actividades').select(sel)
      .eq('trimestre', trim).in('tipo', ['hacer', 'saber']).in('curso_id', grado).in('materia_id', tecnicas))
  }
  const res = await Promise.all(consultas)
  const errAct = res.find(r => r.error)?.error
  if (errAct) throw errAct
  const acts = res.flatMap(r => r.data ?? [])
  if (!acts.length) return []

  const ids = acts.map(a => a.id)
  const [{ data: notas, error: e3 }, { data: vistas, error: e4 }, { data: entregas, error: e5 }] = await Promise.all([
    supabase.from('notas').select('actividad_id, valor, created_at').eq('estudiante_id', _est.id).in('actividad_id', ids),
    supabase.from('tareas_vistas').select('actividad_id, tipo').eq('estudiante_id', _est.id).in('actividad_id', ids),
    window.APP_CONFIG?.permite_entrega_tareas
      ? supabase.from('entregas_tareas').select('actividad_id').eq('estudiante_id', _est.id).in('actividad_id', ids)
      : Promise.resolve({ data: [] }),
  ])
  if (e3 || e4 || e5) throw (e3 ?? e4 ?? e5)
  const entregadas = new Set((entregas ?? []).map(e => e.actividad_id))
  const notaMap = {}, notaFecha = {}
  ;(notas ?? []).forEach(n => { notaMap[n.actividad_id] = n.valor; notaFecha[n.actividad_id] = n.created_at })
  _vistas = { actividad: new Set(), nota: new Set() }
  ;(vistas ?? []).forEach(v => _vistas[v.tipo]?.add(v.actividad_id))

  const hoy = hoyISO()
  const inicio = new Date(INICIO_AVISOS).getTime()
  const reciente = f => !!f && new Date(f).getTime() >= inicio
  return acts.map(a => {
    const tieneNota = notaMap[a.id] !== undefined && notaMap[a.id] !== null
    const it = {
      ...a, materiaNombre: a.materia?.nombre ?? 'Materia',
      nota: tieneNota ? Number(notaMap[a.id]) : null,
      esTarea: a.tipo === 'hacer',
      nueva: reciente(a.created_at) && !_vistas.actividad.has(a.id),
      notaNueva: tieneNota && reciente(notaFecha[a.id]) && !_vistas.nota.has(a.id),
      entregada: entregadas.has(a.id),
      // Ya subió archivo: deja de presionar aunque aún no tenga nota
      porVencer: a.tipo === 'hacer' && !tieneNota && !entregadas.has(a.id) && !!a.fecha_limite && a.fecha_limite >= hoy,
    }
    // Cuenta en el contador: tarea nueva, tarea con fecha vigente sin nota, o nota nueva
    it.alerta = (it.esTarea && (it.nueva || it.porVencer)) || it.notaNueva
    return it
  })
}

// ─── Contador del menú y aviso en Inicio ─────────────────
function pintarContador() {
  const n = _items.filter(i => i.alerta).length
  const b = document.getElementById('badge-tareas')
  estiloPulso()
  if (b) { b.textContent = n > 9 ? '9+' : String(n); b.style.display = n ? 'flex' : 'none'; b.classList.toggle('mt-pulso', n > 0) }
  const av = document.getElementById('aviso-tareas-inicio')
  if (av) {
    const nuevas = _items.filter(i => i.nueva).length
    const notas = _items.filter(i => i.notaNueva).length
    const partes = []
    if (nuevas) partes.push(`${nuevas} ${nuevas === 1 ? 'actividad nueva' : 'actividades nuevas'}`)
    if (notas) partes.push(`${notas} ${notas === 1 ? 'nota nueva' : 'notas nuevas'}`)
    av.innerHTML = partes.length ? `
      <div class="card" style="margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-left:4px solid var(--color-primary);">
        <div style="font-size:14px;"><strong>Tienes ${partes.join(' y ')}.</strong></div>
        <button class="btn btn-primary btn-sm" id="btn-ir-tareas">Ver mis tareas</button>
      </div>` : ''
    document.getElementById('btn-ir-tareas')?.addEventListener('click', () => _irA?.('tareas'))
  }
}

// Datos con copia guardada: sin conexión se muestra la última lista descargada.
async function cargarConCopia() {
  const res = await fetchConCache({
    key: 'mis-tareas',
    colegioId: _perfil?.colegio_id, usuarioId: _perfil?.id,
    ms: 15000,
    run: async () => {
      try { return { data: await cargarDatos(), error: null } }
      catch (e) { return { data: null, error: e } }
    },
  })
  if (res.error) throw res.error
  _copia = res.offline ? { syncedAt: res.syncedAt } : null
  return res.data ?? []
}

export async function iniciarMisTareas(perfil, estData, irA) {
  _perfil = perfil; _est = estData; _irA = irA
  try { _items = await cargarConCopia(); _cargado = true } catch (e) { console.error('[mis-tareas]', e); _items = [] }
  pintarContador()
}

async function marcarVistas(ids, tipo) {
  const nuevos = ids.filter(id => !_vistas[tipo].has(id))
  if (!nuevos.length) return
  const { error } = await supabase.from('tareas_vistas').upsert(
    nuevos.map(id => ({ estudiante_id: _est.id, actividad_id: id, tipo })),
    { onConflict: 'estudiante_id,actividad_id,tipo', ignoreDuplicates: true })
  if (!error) nuevos.forEach(id => _vistas[tipo].add(id))
}

// ─── Pantalla ────────────────────────────────────────────
function textoFecha(it) {
  if (!it.esTarea) return it.fecha_limite ? `📘 Evaluación el ${fechaCorta(it.fecha_limite)}` : '📘 Fecha a confirmar en clase'
  if (!it.fecha_limite) return '🏫 Se presenta en clase'
  const d = diasHasta(it.fecha_limite)
  const hora = it.hora_limite ? ` ${it.hora_limite.slice(0, 5)}` : ''
  if (it.nota === null && it.entregada) return 'Ya entregaste. Está pendiente porque tu profesor aún no la calificó.'
  if (it.nota !== null) return `Presentar hasta el ${fechaCorta(it.fecha_limite)}`
  if (it.permite_entrega_tardia === true && estaVencida(it)) return `<span style="color:#b45309;font-weight:600;">Plazo vencido el ${fechaCorta(it.fecha_limite)} · aún puedes entregar (quedará como tardía)</span>`
  if (d < 0) return `Fecha de presentación: ${fechaCorta(it.fecha_limite)}`
  if (d === 0) return `<span style="color:#b91c1c;font-weight:700;">Presentar HOY${hora}</span>`
  if (d === 1) return `<span style="color:#b91c1c;font-weight:700;">Presentar mañana${hora}</span>`
  return `Presentar hasta el ${fechaCorta(it.fecha_limite)}${hora} · faltan ${d} días`
}

const ZEBRA = 'var(--zebra)'   // intensidad única definida en global.css
const RESALTE = 'color-mix(in srgb, var(--color-primary) 20%, var(--color-surface, #fff))'
let _filtro = 'pendientes'   // pendientes | calificadas | todas
let _materia = ''            // '' = todas las materias

// Pulso suave para los números de alarma (campana del menú y materias con novedades)
function estiloPulso() {
  if (document.getElementById('mt-estilo')) return
  const st = document.createElement('style')
  st.id = 'mt-estilo'
  st.textContent = `
    @keyframes mt-pulso { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.18); opacity: .65 } }
    .mt-pulso { animation: mt-pulso 1.4s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .mt-pulso { animation: none; } }`
  document.head.appendChild(st)
}

function tarjeta(it, idx) {
  const color = it.esTarea ? '#1d4ed8' : '#15803d'
  const destacada = it.nueva || it.notaNueva
  // Intercalado como en el resto del sistema; las nuevas se destacan con más tinte y borde grueso
  const fondo = destacada ? RESALTE : (idx % 2 ? ZEBRA : 'var(--color-surface, #fff)')
  const etiqueta = (txt, c) => `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:${c};color:#fff;text-transform:uppercase;letter-spacing:.03em;">${txt}</span>`
  const etiquetas = [
    it.nueva ? etiqueta('Nueva', 'var(--color-primary)') : '',
    it.notaNueva ? etiqueta('Nota nueva', '#15803d') : '',
  ].join(' ')
  const estado = it.nota !== null
    ? `<div style="text-align:right;flex-shrink:0;"><div style="font-size:18px;font-weight:700;color:${color};">${it.nota}<span style="font-size:12px;font-weight:400;color:var(--color-text-3);">/${Number(it.max_puntos)}</span></div><div style="font-size:11px;color:var(--color-text-3);">Calificada</div></div>`
    : it.esTarea && it.entregada
      ? `<div style="font-size:12px;color:#15803d;font-weight:600;text-align:right;flex-shrink:0;">Entregada<br><span style="font-weight:400;color:var(--color-text-3);">aún sin calificar</span></div>`
      : `<div style="font-size:12px;color:var(--color-text-3);text-align:right;flex-shrink:0;">${it.esTarea ? 'Asignada<br>aún sin calificar' : 'Programada'}</div>`
  return `
    <button type="button" class="tarea-card" data-id="${it.id}"
      style="width:100%;text-align:left;display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:12px 14px;margin-bottom:8px;border:1px solid var(--color-border);border-left:${destacada ? 6 : 4}px solid ${color};border-radius:10px;cursor:pointer;background:${fondo};color:inherit;font:inherit;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
          <span style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.03em;">${escapeHtml(it.materiaNombre)}</span>
          ${etiquetas}
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--color-text);overflow-wrap:anywhere;">${escapeHtml(it.titulo)}</div>
        <div style="font-size:12px;color:var(--color-text-3);margin-top:4px;">${textoFecha(it)}</div>
      </div>
      ${estado}
    </button>`
}

function orden(a, b) {
  const g = it => (it.alerta || it.nueva || it.notaNueva) ? 0 : pendienteSinNota(it) ? (it.fecha_limite ? 1 : 2) : 3
  if (g(a) !== g(b)) return g(a) - g(b)
  if (g(a) === 1) return a.fecha_limite.localeCompare(b.fecha_limite)
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
}

// Pendiente = sin nota (aunque ya haya entregado: falta la calificación).
// El contador de la campana NO cuenta las entregadas (ver porVencer).
const pendienteSinNota = it => it.nota === null
const esPendiente = it => pendienteSinNota(it) || it.nueva || it.notaNueva

function pasaFiltro(it) {
  if (_filtro === 'pendientes') return esPendiente(it)
  if (_filtro === 'calificadas') return it.nota !== null
  return true
}

function pintarLista() {
  const panel = document.getElementById('panel-tareas')
  if (!panel) return
  estiloPulso()

  // Materias que tienen actividades en el trimestre, con su número de alarmas
  const mats = new Map()
  for (const it of _items) {
    const m = mats.get(it.materia_id) ?? { id: it.materia_id, nombre: it.materiaNombre, alertas: 0 }
    if (it.alerta) m.alertas++
    mats.set(it.materia_id, m)
  }
  if (_materia && !mats.has(_materia)) _materia = ''
  const listaMats = [...mats.values()].sort((a, b) => (b.alertas > 0) - (a.alertas > 0) || a.nombre.localeCompare(b.nombre, 'es'))
  const conAlerta = listaMats.filter(m => m.alertas)
  const totalAlertas = conAlerta.reduce((s, m) => s + m.alertas, 0)

  const base = _materia ? _items.filter(i => i.materia_id === _materia) : _items
  const visibles = base.filter(pasaFiltro)
  const tareas = visibles.filter(i => i.esTarea).sort(orden)
  const evals = visibles.filter(i => !i.esTarea).sort(orden)
  const periodo = Config.periodos.find(p => p.numero === (Config.trimestreActivo ?? 1))?.nombre ?? ''
  const cuenta = {
    pendientes: base.filter(esPendiente).length,
    calificadas: base.filter(i => i.nota !== null).length,
    todas: base.length,
  }
  const boton = (k, txt) => {
    const on = _filtro === k
    return `<button type="button" class="tareas-filtro" data-f="${k}"
      style="flex:1 1 0;min-width:0;padding:8px 6px;border-radius:8px;border:1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'};background:${on ? 'var(--color-primary)' : 'var(--color-surface, #fff)'};color:${on ? '#fff' : 'var(--color-text)'};font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">${txt} (${cuenta[k]})</button>`
  }
  const vacio = txt => `<p class="text-sm text-muted">${txt}</p>`
  const msjVacio = { pendientes: 'No tienes pendientes', calificadas: 'Aún no hay calificadas', todas: 'Aún no hay' }[_filtro]

  // 1) Novedades: lo primero que ve. Materias con alarma (número con pulso), o un recordatorio honesto.
  const sinNota = _items.filter(i => i.esTarea && i.nota === null).length
  let novedades = ''
  if (totalAlertas) {
    novedades = `
      <div style="padding:12px 14px;margin-bottom:12px;border-radius:10px;border:1px solid color-mix(in srgb, var(--color-error, #ef4444) 35%, transparent);background:var(--color-error-bg, #fee2e2);">
        <div style="font-size:14px;font-weight:700;color:color-mix(in srgb, var(--color-error, #ef4444) 70%, #000);margin-bottom:8px;">Tienes ${totalAlertas} por atender</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${conAlerta.map(m => `<button type="button" class="mt-mat" data-m="${m.id}"
            style="display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:7px 10px;border-radius:999px;border:1px solid ${_materia === m.id ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-error, #ef4444) 35%, transparent)'};background:${_materia === m.id ? 'var(--color-primary)' : 'var(--color-surface, #fff)'};color:${_materia === m.id ? '#fff' : 'color-mix(in srgb, var(--color-error, #ef4444) 70%, #000)'};font-size:13px;font-weight:600;cursor:pointer;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.nombre)}</span>
            <span class="mt-pulso" style="flex-shrink:0;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:${_materia === m.id ? '#fff' : 'var(--color-error, #ef4444)'};color:${_materia === m.id ? 'var(--color-error, #ef4444)' : '#fff'};font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;">${m.alertas}</span>
          </button>`).join('')}
        </div>
      </div>`
  } else if (_items.length) {
    novedades = `
      <div style="padding:10px 14px;margin-bottom:12px;border-radius:10px;border:1px solid var(--color-border);background:var(--color-surface,#fff);font-size:13px;line-height:1.5;">
        <strong>Sin avisos nuevos.</strong>
        ${sinNota
          ? `Tienes <button type="button" id="mt-ver-pend" style="border:none;background:none;padding:0;color:var(--color-primary);font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;">${sinNota} ${sinNota === 1 ? 'tarea' : 'tareas'} aún sin calificar</button>: revísalas en Pendientes.`
          : 'Todas tus tareas de este trimestre están calificadas.'}
      </div>`
  }

  // 2) Selector de materia (una sola fila, sirve con cualquier cantidad de materias)
  const selector = listaMats.length > 1 ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <label for="mt-materia" style="font-size:13px;font-weight:600;flex-shrink:0;">Materia</label>
      <select id="mt-materia" style="flex:1 1 200px;min-width:0;max-width:min(100%, 360px);">
        <option value="">Todas las materias</option>
        ${listaMats.map(m => `<option value="${m.id}"${_materia === m.id ? ' selected' : ''}>${escapeHtml(m.nombre)}${m.alertas ? ` (${m.alertas})` : ''}</option>`).join('')}
      </select>
    </div>` : ''

  panel.innerHTML = `
    <div style="padding:12px 14px;margin-bottom:12px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#78350f;font-size:13px;line-height:1.5;">${AVISO}</div>
    ${novedades}
    ${selector}
    <div style="display:flex;gap:6px;margin-bottom:16px;">
      ${boton('pendientes', 'Pendientes')}${boton('calificadas', 'Calificadas')}${boton('todas', 'Todas')}
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">Tareas (Hacer) · ${escapeHtml(periodo)}</div>
      ${tareas.length ? tareas.map(tarjeta).join('') : vacio(`${msjVacio} tareas${_materia ? ' en esta materia' : ' en este trimestre'}.`)}
    </div>
    <div class="card">
      <div class="card-title">Evaluaciones (Saber)</div>
      <p class="text-sm text-muted" style="margin-bottom:10px;">Para que sepas qué temas se evaluarán y te prepares.</p>
      ${evals.length ? evals.map(tarjeta).join('') : vacio(`${msjVacio} evaluaciones${_materia ? ' en esta materia' : ' en este trimestre'}.`)}
    </div>`

  panel.querySelector('#mt-materia')?.addEventListener('change', e => { _materia = e.target.value; pintarLista() })
  panel.querySelectorAll('.mt-mat').forEach(b => b.addEventListener('click', () => {
    _materia = _materia === b.dataset.m ? '' : b.dataset.m   // segundo toque vuelve a Todas
    _filtro = 'pendientes'
    pintarLista()
  }))
  panel.querySelector('#mt-ver-pend')?.addEventListener('click', () => { _materia = ''; _filtro = 'pendientes'; pintarLista() })
  panel.querySelectorAll('.tareas-filtro').forEach(b => b.addEventListener('click', () => { _filtro = b.dataset.f; pintarLista() }))
  panel.querySelectorAll('.tarea-card').forEach(btn => btn.addEventListener('click', () => abrir(btn.dataset.id)))
  if (_copia) insertarAvisoCopia(panel, _copia.syncedAt)
}

export async function cargarMisTareas() {
  const panel = document.getElementById('panel-tareas')
  if (!panel) return
  // Si ya hay datos (cargados al entrar al panel), se muestran al instante y se actualizan detrás
  if (_cargado) pintarLista()
  else panel.innerHTML = '<div class="empty-state"><div class="empty-state-title">Cargando tus tareas...</div></div>'
  let fallo = null
  try { _items = await cargarConCopia(); _cargado = true } catch (e) { console.error('[mis-tareas]', e); fallo = e; if (!_cargado) _items = [] }
  if (fallo && !_cargado) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-state-title">No se pudieron cargar tus tareas</div><div class="empty-state-desc"></div></div>'
    panel.querySelector('.empty-state-desc').textContent = fallo.message ?? String(fallo)
    return
  }
  pintarLista()
  pintarContador()
}

// Al abrir una tarea deja de ser "nueva" y su nota deja de ser "nota nueva"
async function abrir(id) {
  const it = _items.find(i => i.id === id)
  if (!it) return
  window.verDetalleMateria?.(it.materia_id, it.materiaNombre, Config.trimestreActivo ?? 1, it.id)
  if (!it.nueva && !it.notaNueva) return
  await Promise.all([
    it.nueva ? marcarVistas([id], 'actividad') : null,
    it.notaNueva ? marcarVistas([id], 'nota') : null,
  ])
  it.nueva = false
  it.notaNueva = false
  it.alerta = it.esTarea && it.porVencer
  pintarContador()
  pintarLista()
}

// Para refrescar lista y contador después de subir o quitar un archivo desde el detalle
window._refrescarMisTareas = () => cargarMisTareas()