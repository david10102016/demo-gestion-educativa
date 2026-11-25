// js/profesor/vista-calificaciones.js
// Vista integrada: tarjetas de actividades + tabla resumen de notas por dimensión
// Exporta: iniciarVistaCalificaciones()
// Depende de: supabase-config.js, config-app.js, ui.js (ya existentes)
// ─────────────────────────────────────────────────────────
import { supabase } from '../config/supabase-config.js'
import { Config }   from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { exportarDetalleNotasExcel } from '../utils/export-excel.js'
import { iniciarImportacionNotas } from '../utils/importar-notas-excel.js'
import { cargarContadoresEntregas, getEntregasPorActividad } from '../utils/entrega-tareas.js'
import { tardanzaEntrega } from '../utils/entrega-tardia.js'
import { calcularPromedioAnualLote } from '../utils/promedio-anual.js'
import { fetchConCache, conTimeout } from '../utils/data-layer.js'
import { cursosDelGrado } from '../utils/tecnica-grado.js'
import { initConnectionStatus, avisoOfflineInline } from '../utils/connection-status.js'
import { escapeHtml } from '../utils/sanitize.js'
import { trimestreCerrado, notaOficial, fmtNota, tituloExacto } from '../utils/estado-notas.js'
import { montarMatrizNotas } from '../utils/matriz-notas-curso.js'
import { abrirReutilizarActividad } from './reutilizar-actividad.js'


// ─── ÍCONOS SVG (sin emojis en la interfaz) ──────────────
const _SVG = {
  libro:    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  alerta:   '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  lista:    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
  grafico:  '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  archivo:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  lapiz:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  clip:     '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  reloj:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  imagen:   '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  guardar:  '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
}
function _ico(nombre, size = 14) {
  return `<svg class="vc-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_SVG[nombre] ?? ''}</svg>`
}

// ─── ESTADO LOCAL ────────────────────────────────────────
let _perfil       = null
let _actividades  = []
let _estudiantes  = []
let _contEntregas = {}
let _rubricaCriteriosActual = []
let _rubricaMaxPuntosActual = 0
let _notasMap = {}
let _obsMap   = {}
let _trasladoMap = {}   // { estudianteId: [{ tipo, max_puntos, valor, curso }] } notas de otro paralelo
let _resumen  = {}
let _modoResumen = 'resumen'   // 'resumen' | 'detalle'

// ─── PUNTO DE ENTRADA ────────────────────────────────────
export async function iniciarVistaCalificaciones(perfil) {
  _perfil = perfil
  window._profesorPerfil = perfil
  initConnectionStatus()
  await _renderVista()
}

// ─── RENDER PRINCIPAL ────────────────────────────────────
async function _renderVista() {
  const panel = document.getElementById('panel-calificaciones')
  if (!panel) return

  const { cursoId, materiaId, periodo } = _get()

  if (!cursoId || !materiaId) {
    const sinAsignaciones = !(window._profAsignaciones ?? []).length
    panel.innerHTML = _renderAccesos(cursoId, materiaId) + _emptyState('libro', sinAsignaciones
      ? 'No tienes cursos ni materias asignados. Pide a la dirección que te los asigne.'
      : 'Elige un curso y una materia para ver las actividades')
    _bindAccesos(panel)
    return
  }

  panel.innerHTML = _skeleton()
  mostrarLoader('Cargando actividades...')

  const colegioId = _perfil?.colegio_id
  const usuarioId = _perfil?.id

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  const [rActs, rEsts] = await Promise.all([
    fetchConCache({
      key: `actividades:${cursoId}:${materiaId}:${periodo}`,
      colegioId, usuarioId,
      run: async () => {
        let q = supabase.from('actividades')
          .select('id, titulo, descripcion, tipo, max_puntos, trimestre, fecha_limite, created_at')
          .eq('creado_por', _perfil.id)
          .eq('materia_id', materiaId)
          .eq('trimestre', periodo)
        q = esTecnica ? q.in('curso_id', await cursosDelGrado(cursoId)) : q.eq('curso_id', cursoId)
        return q.order('created_at', { ascending: false })
      },
    }),
    fetchConCache({
      key: esTecnica ? `estudiantes-tecnica:${materiaId}:${cursoId}` : `estudiantes-curso:${cursoId}`,
      colegioId, usuarioId,
      run: async () => {
        if (esTecnica) {
          const { data, error } = await supabase.from('inscripciones_tecnicas')
            .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
            .eq('materia_id', materiaId)
            .eq('activo', true)
            .in('estudiantes.curso_id', await cursosDelGrado(cursoId))
          return {
            data: (data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios })),
            error
          }
        }
        return supabase.from('estudiantes')
          .select('id, usuarios(nombre_completo)')
          .eq('curso_id', cursoId)
          .order('usuarios(nombre_completo)')
      },
    }),
  ])

  if (rActs.error || rEsts.error) {
    ocultarLoader()
    panel.innerHTML = _renderAccesos(cursoId, materiaId) + _emptyState('alerta', 'Error cargando datos. Intenta de nuevo.')
    _bindAccesos(panel)
    toast('Error al cargar actividades', 'error')
    return
  }

  _actividades = rActs.data ?? []
  _estudiantes = (rEsts.data ?? []).sort((a, b) =>
    (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

  let notasMap = {}
  let obsMap   = {}
  let calMap   = {}
  _trasladoMap  = {}
  _contEntregas = {}
  const actIds = _actividades.map(a => a.id)
  const estIds = _estudiantes.map(e => e.id)

  // Notas, traslado, SER/Autoevaluación y entregas no dependen entre sí:
  // se piden al mismo tiempo para que la espera no se sume con internet lento.
  const [rNotas, trasladoData, rCals, contEntregas] = await Promise.all([
    (actIds.length && estIds.length)
      ? fetchConCache({
          key: `notas:${cursoId}:${materiaId}:${periodo}`,
          colegioId, usuarioId,
          run: () => supabase.from('notas')
            .select('actividad_id, estudiante_id, valor, observaciones')
            .in('actividad_id', actIds),
        })
      : Promise.resolve({ data: [], offline: false }),

    // Notas de traslado: actividades de esta materia y periodo en OTRO paralelo,
    // de los estudiantes que hoy están en este curso. Solo materias regulares. Solo lectura.
    (!esTecnica && estIds.length)
      ? conTimeout(supabase.from('notas')
          .select('estudiante_id, valor, act:actividades!inner(tipo, max_puntos, materia_id, trimestre, curso_id, curso:cursos(nombre_completo))')
          .in('estudiante_id', estIds)
          .eq('act.materia_id', materiaId)
          .eq('act.trimestre', periodo)
          .neq('act.curso_id', cursoId))
          .then(({ data }) => data ?? [])
          .catch(err => { console.warn('[traslado] no se pudieron cargar notas de traslado', err); return [] })
      : Promise.resolve([]),

    estIds.length
      ? fetchConCache({
          key: `calificaciones-ser-decidir:${materiaId}:${periodo}`,
          colegioId, usuarioId,
          run: () => supabase.from('calificaciones')
            .select('estudiante_id, nota_ser, nota_decidir')
            .eq('materia_id', materiaId)
            .eq('trimestre', periodo),
        })
      : Promise.resolve({ data: [], offline: false }),

    (window.APP_CONFIG?.permite_entrega_tareas && actIds.length)
      ? conTimeout(cargarContadoresEntregas(actIds))
          .catch(err => { console.warn('[entregas] no se pudieron cargar contadores', err); return {} })
      : Promise.resolve({}),
  ])

  ;(rNotas.data ?? []).forEach(n => {
    notasMap[`${n.actividad_id}_${n.estudiante_id}`] = n.valor
    if (n.observaciones) obsMap[`${n.actividad_id}_${n.estudiante_id}`] = n.observaciones
  })

  trasladoData.forEach(n => {
    if (n.valor == null || !n.act) return
    ;(_trasladoMap[n.estudiante_id] ??= []).push({
      tipo: n.act.tipo, max_puntos: n.act.max_puntos, valor: n.valor,
      curso: n.act.curso?.nombre_completo ?? 'otro paralelo'
    })
  })

  ;(rCals.data ?? []).forEach(c => { calMap[c.estudiante_id] = c })

  _contEntregas = contEntregas ?? {}

  ocultarLoader()

  const resumen = _calcularResumen(_actividades, _estudiantes, notasMap, calMap, _trasladoMap)
  _notasMap = notasMap
  _obsMap   = obsMap
  _resumen  = resumen
  const huboOffline = rActs.offline || rEsts.offline || rNotas.offline || rCals.offline

  panel.innerHTML = `
    ${huboOffline ? avisoOfflineInline() : ''}
    ${_renderAccesos(cursoId, materiaId)}
    ${_renderAccionesBar()}
    ${_renderTarjetas(_actividades, notasMap)}
    ${_renderTablaResumen(_estudiantes, resumen)}
  `

  _bindAccesos(panel)
  panel.querySelectorAll('[data-act-calificar]').forEach(btn =>
    btn.addEventListener('click', () => window.abrirModalNotas(btn.dataset.actCalificar)))
  panel.querySelectorAll('[data-act-reutilizar]').forEach(btn =>
    btn.addEventListener('click', () => abrirReutilizarActividad(btn.dataset.actReutilizar, _perfil)))
  panel.querySelectorAll('[data-act-editar]').forEach(btn =>
    btn.addEventListener('click', () => window.editarActividad(btn.dataset.actEditar)))
  panel.querySelectorAll('[data-act-eliminar]').forEach(btn =>
    btn.addEventListener('click', () => _eliminarActividad(btn.dataset.actEliminar)))
  panel.querySelectorAll('[data-act-entregas]').forEach(btn =>
    btn.addEventListener('click', () => _verEntregasActividad(btn.dataset.actEntregas)))
  panel.querySelectorAll('[data-act-ver]').forEach(el =>
    el.addEventListener('click', () => _verActividad(el.dataset.actVer)))
  panel.querySelectorAll('.mn-modo-btn').forEach(btn =>
    btn.addEventListener('click', () => { _modoResumen = btn.dataset.modo; _aplicarModo() }))
  _aplicarModo()
}

// ─── MODO RESUMEN / DETALLE ──────────────────────────────
// "Detalle" = grilla de todo el curso (utils/matriz-notas-curso.js). Solo dibuja; los datos ya están cargados.
function _aplicarModo() {
  const vistaResumen = document.getElementById('vc-modo-resumen')
  const vistaDetalle = document.getElementById('vc-modo-detalle')
  if (!vistaResumen || !vistaDetalle) return
  const detalle = _modoResumen === 'detalle'
  vistaResumen.classList.toggle('hidden', detalle)
  vistaDetalle.classList.toggle('hidden', !detalle)
  document.querySelectorAll('.mn-modo-btn').forEach(b =>
    b.classList.toggle('is-active', b.dataset.modo === _modoResumen))
  if (!detalle) return

  const { periodo } = _get()
  montarMatrizNotas(vistaDetalle, {
    estudiantes: _estudiantes,
    actividades: _actividades,
    notasMap:    _notasMap,
    obsMap:      _obsMap,
    resumen:     _resumen,
    dimensiones: Config.dimensiones,
    colorDim:    _dimColor,
    trimestreAbierto: !trimestreCerrado(periodo, { trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada }),
    notaMinima:   Config.notaMinima,
    escalaMaxima: Config.escalaMaxima,
    onActividad:  (id) => window._vcVerEstadistica(id),
  })
}

// ─── ACCESOS RÁPIDOS CURSO · MATERIA ─────────────────────
// Bloque plegable, igual que HACER y SABER. Abierto por defecto; el profesor lo recoge si
// quiere más espacio (se recuerda en la sesión). PC: cuadrícula. Celular: dos tarjetas por fila.
// Complementa a los selectores de arriba: un clic fija curso y materia.
function _renderAccesos(cursoId, materiaId) {
  const vistos = new Set()
  const combos = (window._profAsignaciones ?? [])
    .filter(a => {
      const k = `${a.curso_id}|${a.materia_id}`
      if (vistos.has(k)) return false
      vistos.add(k); return true
    })
    .sort((a, b) =>
      (a.curso?.nombre_completo ?? '').localeCompare(b.curso?.nombre_completo ?? '', 'es', { numeric: true }) ||
      (a.materia?.nombre ?? '').localeCompare(b.materia?.nombre ?? '', 'es'))
  if (combos.length < 2) return ''
  let abierto = true
  try {
    const guardado = sessionStorage.getItem('vc_accesos_abierto')
    if (guardado !== null) abierto = guardado === '1'
  } catch (_) {}
  return `<details class="act-bloque vc-accesos-wrap"${abierto ? ' open' : ''} style="--dim-color:var(--color-primary);">
  <summary class="act-bloque-tit" id="vc-accesos-label"><span>Acceso rápido a tus cursos</span><span class="act-bloque-n">${combos.length}</span></summary>
  <nav class="vc-accesos" aria-labelledby="vc-accesos-label">
    ${combos.map(a => {
      const activo = a.curso_id === cursoId && a.materia_id === materiaId
      return `<button type="button" class="vc-acceso${activo ? ' is-active' : ''}" data-acceso
        data-curso="${escapeHtml(a.curso_id)}" data-materia="${escapeHtml(a.materia_id)}"${activo ? ' aria-current="true"' : ''}
        title="${escapeHtml((a.curso?.nombre_completo ?? '') + ' · ' + (a.materia?.nombre ?? ''))}">
        <span class="vc-acceso-curso">${escapeHtml(a.curso?.nombre_completo ?? 'Curso')}</span>
        <span class="vc-acceso-materia">${escapeHtml(a.materia?.nombre ?? 'Materia')}</span>
      </button>`
    }).join('')}
  </nav>
  </details>`
}

function _bindAccesos(panel) {
  panel.querySelectorAll('[data-acceso]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return
      window._profSeleccionar?.(btn.dataset.curso, btn.dataset.materia)
    }))
  // Recordar si el usuario lo dejó abierto o cerrado (en esta sesión)
  panel.querySelector('details.vc-accesos-wrap')?.addEventListener('toggle', e => {
    try { sessionStorage.setItem('vc_accesos_abierto', e.currentTarget.open ? '1' : '0') } catch (_) {}
  })
}

// ─── BARRA DE ACCIONES ───────────────────────────────────
function _renderAccionesBar() {
  return `
  <div class="vc-actions-bar">
    <div class="vc-actions-right">
      <button class="btn btn-primary vc-btn-main" onclick="window.abrirModalActividad()">
        + Nueva actividad
      </button>
      <button class="btn vc-btn-out" onclick="window._vcExportarDetalle()" title="Exportar detalle de notas por dimensión">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Exportar Excel
      </button>
      <button class="btn vc-btn-out" onclick="window._vcImportarNotas()" title="Importar notas desde un Excel exportado por el sistema (solo rellena notas vacías)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Importar Excel
      </button>
      <button class="btn vc-btn-out" onclick="window._vcAbrirBajoRendimiento()" title="Informe de bajo rendimiento">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        Bajo Rendimiento
      </button>
      <button class="btn vc-btn-out" onclick="window._vcAbrirAprobados()" title="Informe de aprobados y reprobados">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Aprobados / Reprobados
      </button>
      <button class="btn vc-btn-out" onclick="window._vcAbrirJunta()" title="Informe de junta trimestral">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Junta Trimestral
      </button>
      <button class="btn vc-btn-out" onclick="window.abrirModalSerAuto()" title="Calificar SER y Autoevaluación">
        ${_ico('lista')} SER / Autoevaluación
      </button>
      <button class="btn vc-btn-out" onclick="window._vcVerPromedioAnual()">
        ${_ico('grafico')} Promedio Anual
      </button>
      <button class="btn vc-btn-out" onclick="window._vcCentralizadorPDF()" title="Boletín centralizador con los trimestres, en PDF">
        ${_ico('archivo')} Centralizador PDF
      </button>
    </div>
  </div>`
}

// ─── TARJETAS DE ACTIVIDADES ─────────────────────────────
function _renderTarjetas(actividades, notasMap) {
  if (!actividades.length) {
    return `<div class="vc-empty-acts">
      <div class="vc-empty-icon">${_ico('lapiz', 40)}</div>
      <div class="vc-empty-title">Sin actividades en este período</div>
      <div class="vc-empty-desc">Crea la primera actividad con el botón "+ Nueva actividad"</div>
    </div>`
  }

  const cardHtml = a => {
    const dim    = Config.dimensiones.find(d => d.codigo === a.tipo)
    const color  = _dimColor(a.tipo)
    const calificados = _estudiantes.filter(e =>
      notasMap[`${a.id}_${e.id}`] != null).length
    const total   = _estudiantes.length
    const progPct = total > 0 ? Math.round((calificados / total) * 100) : 0
    const fechaLim = a.fecha_limite
      ? new Date(a.fecha_limite + 'T12:00:00').toLocaleDateString('es-BO', { day:'2-digit', month:'short', year:'2-digit' })
      : null
    const fechaCre = new Date(a.created_at).toLocaleDateString('es-BO', { day:'2-digit', month:'short', year:'2-digit' })

    return `
    <div class="act-card" data-dim="${a.tipo}">
      <div class="act-card-header">
        <span class="act-card-dim-badge" style="--dim-color:${color};">${dim?.nombre ?? a.tipo.toUpperCase()}</span>
        <div class="act-card-meta">
          <span class="act-card-date">Creación: ${fechaCre}</span>
          ${fechaLim ? `<span class="act-card-date act-card-date--limit">Entrega: ${fechaLim}</span>` : ''}
        </div>
      </div>

      <div class="act-card-body">
        <h3 class="act-card-title act-card-clickable" data-act-ver="${a.id}" title="Ver actividad completa">${escapeHtml(a.titulo)}</h3>
        ${a.descripcion ? `<p class="act-card-desc act-card-clickable" data-act-ver="${a.id}" title="Ver actividad completa">${escapeHtml(a.descripcion)}</p>
        ${(a.descripcion.length > 110 || a.descripcion.includes('\n')) ? `<button type="button" class="act-card-vermas" data-act-ver="${a.id}">Ver completa ›</button>` : ''}` : ''}
        <div class="act-card-chips">
          <span class="act-chip">Máx: <strong>${a.max_puntos}</strong></span>
          <span class="act-chip">${Config.nombrePeriodo}: <strong>${a.trimestre}</strong></span>
        </div>
      </div>

      <div class="act-card-progress">
        <div class="act-card-progress-bar">
          <div class="act-card-progress-fill" style="width:${progPct}%;background:${color};"></div>
        </div>
        <span class="act-card-progress-label">${calificados} / ${total} calificados</span>
      </div>

      <div class="act-card-footer" style="flex-wrap:wrap;gap:8px;">
        <button class="btn btn-primary btn-sm" data-act-calificar="${a.id}">
          ${_ico('lapiz')} Registrar Notas
        </button>
        ${window.APP_CONFIG?.permite_entrega_tareas ? `
        <button class="btn btn-secondary btn-sm" data-act-entregas="${a.id}"
          title="Ver entregas de estudiantes">
          ${_ico('clip')} Entregas
          ${(_contEntregas[a.id] ?? 0) > 0
            ? `<span style="background:#4f46e5;color:#fff;border-radius:99px;padding:1px 7px;font-size:11px;margin-left:4px;">${_contEntregas[a.id]}</span>`
            : ''}
        </button>` : ''}
        <div class="act-card-icon-btns">
          <button class="act-icon-btn act-icon-btn--ver" data-act-ver="${a.id}" title="Ver actividad">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="act-icon-btn act-icon-btn--edit" data-act-reutilizar="${a.id}" title="Reutilizar: copia esta actividad, con su rúbrica y su archivo, a otros cursos o materias que tienes asignados" style="width:auto;padding:0 8px;gap:4px;font-size:12px;font-weight:600;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Reutilizar
          </button>
          <button class="act-icon-btn act-icon-btn--edit" data-act-editar="${a.id}" title="Editar actividad">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="act-icon-btn act-icon-btn--delete" data-act-eliminar="${a.id}" title="Eliminar actividad">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button class="act-icon-btn act-icon-btn--chart" onclick="window._vcVerEstadistica('${a.id}')" title="Ver estadística">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </button>
        </div>
      </div>
    </div>`
  }

  // Un bloque por dimensión (Hacer, Saber, …), más recientes primero.
  // PC: cuadrícula. Celular: fila deslizable a los lados (ver .act-bloque en global.css).
  const dims = [...Config.dimensiones].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const codigos = new Set(dims.map(d => d.codigo))
  const grupos = [
    ...dims.map(d => ({ nombre: d.nombre, color: _dimColor(d.codigo), acts: actividades.filter(a => a.tipo === d.codigo) })),
    { nombre: 'Otras', color: '#64748b', acts: actividades.filter(a => !codigos.has(a.tipo)) },
  ].filter(g => g.acts.length)
  const bloques = grupos.map(g => `
    <details class="act-bloque" open style="--dim-color:${g.color};">
      <summary class="act-bloque-tit"><span>${escapeHtml(g.nombre)}</span><span class="act-bloque-n">${g.acts.length}</span></summary>
      <div class="act-cards-grid act-cards-grid--bloque">${[...g.acts]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(cardHtml).join('')}</div>
    </details>`).join('')

  // El filtro por dimensión va junto a la lista que filtra
  return `
  <div class="vc-acts-head">
    <div class="vc-section-label">
      <span>Actividades del período</span>
      <span class="vc-section-count">${actividades.length}</span>
    </div>
    <select id="vc-filtro-dim" class="vc-select" onchange="window._vcFiltrarDim(this.value)" aria-label="Filtrar actividades por dimensión">
      <option value="">Todas las dimensiones</option>
      ${Config.dimensiones.filter(d => d.tipo === 'actividades')
        .map(d => `<option value="${d.codigo}">${escapeHtml(d.nombre)}</option>`).join('')}
    </select>
  </div>
  <div id="act-cards-container">${bloques}</div>`
}

// ─── TABLA RESUMEN POR ESTUDIANTE ────────────────────────
function _renderTablaResumen(estudiantes, resumen) {
  if (!estudiantes.length) return ''

  const dims = Config.dimensiones

  const filas = estudiantes.map((e, i) => {
    const r = resumen[e.id] ?? {}
    const total = r.total ?? 0
    const aprobado = notaOficial(total) >= Config.notaMinima   // decide con la nota redondeada
    const totalClass = aprobado ? 'vc-total--aprobado' : 'vc-total--reprobado'

    const celdas = dims.map(d => {
      const val    = r[d.codigo]
      const color  = _dimColor(d.codigo)
      const filled = val != null && val > 0
      return `<td class="vc-td-dim">
        <span class="dim-pill ${filled ? 'dim-pill--filled' : 'dim-pill--empty'}"
          style="${filled ? `--dp-color:${color};` : ''}" title="${tituloExacto(val)}">
          ${fmtNota(val)}
          <small>/ ${d.peso_maximo}</small>
        </span>
      </td>`
    }).join('')

    return `<tr class="vc-tr animate-fade-in">
      <td class="vc-td-num">${i + 1}</td>
      <td class="vc-td-nombre">${escapeHtml(e.usuarios?.nombre_completo ?? '—')}${_trasladoMap[e.id]?.length
        ? `<div style="font-size:11px;color:#b45309;margin-top:2px;" title="El promedio incluye notas que el estudiante tenía en su paralelo anterior (solo lectura)">Incluye notas de traslado · ${escapeHtml([...new Set(_trasladoMap[e.id].map(t => t.curso))].join(', '))}</div>`
        : ''}</td>
      ${celdas}
      <td class="vc-td-total">
        <span class="vc-total ${totalClass}" title="${tituloExacto(total)}">
          ${fmtNota(total)} <small>/ ${Config.escalaMaxima}</small>
        </span>
      </td>
      <td class="vc-td-accion">
        <button class="btn btn-secondary btn-sm" onclick="window._vcVerDetalle('${e.id}')">Ver detalle</button>
      </td>
    </tr>`
  }).join('')

  const headers = dims.map(d =>
    `<th class="vc-th-dim">
      <span class="vc-th-dim-label" style="--dim-color:${_dimColor(d.codigo)};">${escapeHtml(d.nombre)}</span>
    </th>`
  ).join('')

  return `
  <div class="vc-section-label" style="margin-top:32px;">
    <span>Resumen de calificaciones</span>
    <span class="vc-section-count">${estudiantes.length} estudiantes</span>
    <div class="mn-modo" role="group" aria-label="Tipo de vista">
      <button type="button" class="mn-modo-btn is-active" data-modo="resumen">Resumen</button>
      <button type="button" class="mn-modo-btn" data-modo="detalle">Detalle</button>
    </div>
  </div>
  <div id="vc-modo-resumen">
  <div class="vc-table-wrap">
    <table class="vc-resumen-table">
      <thead>
        <tr class="vc-thead-row">
          <th class="vc-th-num">N°</th>
          <th class="vc-th-nombre">Estudiante</th>
          ${headers}
          <th class="vc-th-total">Total</th>
          <th class="vc-th-accion">Acciones</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
  </div>
  <div id="vc-modo-detalle" class="hidden"></div>`
}

// ─── CÁLCULO DE RESUMEN ──────────────────────────────────
function _calcularResumen(actividades, estudiantes, notasMap, calMap, trasladoMap = {}) {
  const dims = Config.dimensiones
  const resultado = {}

  for (const est of estudiantes) {
    const row   = {}
    let   total = 0

    for (const dim of dims) {
      let nota = null

      if (dim.tipo === 'actividades') {
        const acts = actividades.filter(a => a.tipo === dim.codigo)
        const vals = acts
          .map(a => {
            const v = notasMap[`${a.id}_${est.id}`]
            return v != null ? (parseFloat(v) / parseFloat(a.max_puntos)) * dim.peso_maximo : null
          })
          .filter(v => v !== null)
        // Notas del paralelo anterior (traslado): entran al mismo promedio
        ;(trasladoMap[est.id] ?? []).filter(t => t.tipo === dim.codigo && parseFloat(t.max_puntos) > 0)
          .forEach(t => vals.push((parseFloat(t.valor) / parseFloat(t.max_puntos)) * dim.peso_maximo))

        if (vals.length) {
          nota = Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100
        }
      } else if (dim.tipo === 'ficha') {
        const cal = calMap[est.id]
        if (cal?.nota_ser != null) nota = parseFloat(cal.nota_ser)
      } else if (dim.tipo === 'directo') {
        const cal = calMap[est.id]
        if (cal?.nota_decidir != null) nota = parseFloat(cal.nota_decidir)
      }

      row[dim.codigo] = nota
      total += nota ?? 0
    }

    row.total = Math.round(total * 100) / 100
    resultado[est.id] = row
  }

  return resultado
}

// ─── FILTRAR POR DIMENSIÓN ───────────────────────────────
window._vcFiltrarDim = function(dim) {
  document.querySelectorAll('.act-card').forEach(card => {
    const show = !dim || card.dataset.dim === dim
    card.style.display = show ? '' : 'none'
  })
  // Ocultar también el bloque (HACER, SABER) que queda sin actividades visibles
  document.querySelectorAll('.act-bloque:not(.vc-accesos-wrap)').forEach(bloque => {
    const visibles = [...bloque.querySelectorAll('.act-card')].some(c => c.style.display !== 'none')
    bloque.style.display = visibles ? '' : 'none'
  })
}

// ─── VER DETALLE ESTUDIANTE ──────────────────────────────
window._vcVerDetalle = async function(estudianteId) {
  const { materiaId, periodo } = _get()
  const est = _estudiantes.find(e => e.id === estudianteId)
  if (!est) return

  const actsPorDim = {}
  Config.dimensiones.forEach(d => {
    actsPorDim[d.codigo] = _actividades.filter(a => a.tipo === d.codigo)
  })

  const actIds = _actividades.map(a => a.id)
  let notasEst = {}
  if (actIds.length) {
    const r = await fetchConCache({
      key: `notas-estudiante:${estudianteId}:${materiaId}:${periodo}`,
      colegioId: _perfil?.colegio_id, usuarioId: _perfil?.id,
      run: () => supabase.from('notas')
        .select('actividad_id, valor')
        .eq('estudiante_id', estudianteId)
        .in('actividad_id', actIds),
    })
    ;(r.data ?? []).forEach(n => { notasEst[n.actividad_id] = n.valor })
  }

  const dims = Config.dimensiones
  let html = `<div style="font-size:15px;font-weight:600;margin-bottom:20px;">${escapeHtml(est.usuarios?.nombre_completo)}</div>`

  for (const dim of dims) {
    const acts = actsPorDim[dim.codigo] ?? []
    const color = _dimColor(dim.codigo)
    html += `<div style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <strong style="font-size:13px;color:${color};">${escapeHtml(dim.nombre)}</strong>
        <span style="font-size:12px;color:var(--color-text-3);">(max ${dim.peso_maximo} pts)</span>
      </div>`

    if (dim.tipo === 'actividades') {
      if (!acts.length) {
        html += `<p style="font-size:13px;color:var(--color-text-3);padding-left:18px;">Sin actividades</p>`
      } else {
        html += `<div style="display:flex;flex-direction:column;gap:6px;padding-left:18px;">`
        for (const a of acts) {
          const val = notasEst[a.id]
          const pct = val != null ? (parseFloat(val) / parseFloat(a.max_puntos) * 100).toFixed(0) : null
          html += `<div style="display:flex;justify-content:space-between;align-items:center;
            padding:8px 12px;background:var(--color-surface-2);border-radius:var(--radius-md);font-size:13px;">
            <span style="flex:1;">${a.titulo}</span>
            <span style="font-weight:600;color:${val != null ? color : 'var(--color-text-3)'};">
              ${val != null ? `${val} / ${a.max_puntos}` : '—'}
              ${pct != null ? `<small style="font-weight:400;color:var(--color-text-3);margin-left:4px;">(${pct}%)</small>` : ''}
            </span>
          </div>`
        }
        html += `</div>`
      }
    } else {
      const v = _resumen[estudianteId]?.[dim.codigo]
      html += `<p style="font-size:13px;color:var(--color-text-3);padding-left:18px;">
        ${v != null ? `<strong style="color:${color};">${fmtNota(v)} / ${dim.peso_maximo}</strong> <span style="font-size:11px;">(exacta: ${Number(v).toFixed(2)})</span>` : 'Sin calificar'}</p>`
    }
    html += `</div>`
  }

  _abrirModalInterno('Detalle de calificaciones', html)
}

// ─── VER ESTADÍSTICA DE ACTIVIDAD ────────────────────────
window._vcVerEstadistica = async function(actividadId) {
  const act = _actividades.find(a => a.id === actividadId)
  if (!act) return

  const r = await fetchConCache({
    key: `notas-actividad:${actividadId}`,
    colegioId: _perfil?.colegio_id, usuarioId: _perfil?.id,
    run: () => supabase.from('notas')
      .select('valor, estudiante_id')
      .eq('actividad_id', actividadId),
  })
  const notas = r.data

  const vals = (notas ?? []).map(n => parseFloat(n.valor))
  const total = _estudiantes.length
  const calificados = vals.length
  const promedio = calificados ? (vals.reduce((s, v) => s + v, 0) / calificados).toFixed(2) : '—'
  const maxVal   = calificados ? Math.max(...vals).toFixed(2) : '—'
  const minVal   = calificados ? Math.min(...vals).toFixed(2) : '—'
  const aprobados = vals.filter(v => (v / parseFloat(act.max_puntos)) >= 0.51).length

  const dim   = Config.dimensiones.find(d => d.codigo === act.tipo)
  const color = _dimColor(act.tipo)

  const html = `
    <div style="margin-bottom:16px;">
      <span style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;
        background:${color}20;color:${color};">${dim?.nombre ?? act.tipo}</span>
      <p style="margin-top:8px;font-size:13px;color:var(--color-text-3);">
        ${act.descripcion ?? ''} &nbsp;·&nbsp; Máx: ${act.max_puntos} pts
      </p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;">
      ${[
        ['Calificados', `${calificados} / ${total}`],
        ['Promedio',    promedio],
        ['Nota máxima', maxVal],
        ['Nota mínima', minVal],
        ['Aprobados',   aprobados],
        ['Sin nota',    total - calificados],
      ].map(([lbl, val]) => `
        <div style="padding:14px;background:var(--color-surface-2);border-radius:var(--radius-md);text-align:center;">
          <div style="font-size:11px;color:var(--color-text-3);text-transform:uppercase;font-weight:600;margin-bottom:4px;">${lbl}</div>
          <div style="font-size:22px;font-weight:700;color:var(--color-text);">${val}</div>
        </div>`).join('')}
    </div>`

  _abrirModalInterno(`Estadística — ${act.titulo}`, html)
}

// ─── ELIMINAR ACTIVIDAD ──────────────────────────────────
async function _eliminarActividad(id) {
  // Verificar si tiene notas o entregas registradas
  const [{ count: cNotas }, { count: cEntregas }] = await Promise.all([
    supabase.from('notas').select('*', { count: 'exact', head: true }).eq('actividad_id', id),
    supabase.from('entregas_tareas').select('*', { count: 'exact', head: true }).eq('actividad_id', id)
  ])

  if (cNotas > 0 || cEntregas > 0) {
    toast(`No se puede eliminar — tiene ${cNotas} nota(s) y ${cEntregas} entrega(s) registradas`, 'error')
    return
  }

  if (!await confirmar('Eliminar actividad', '¿Eliminar esta actividad?')) return
  const { error } = await supabase.from('actividades').delete().eq('id', id)
  if (error) { toast(error.message, 'error'); return }
  toast('Actividad eliminada', 'success')
  await _renderVista()
}

// ─── VER ACTIVIDAD (SOLO LECTURA) ────────────────────────
// Muestra título, consigna completa, fechas, rúbrica y progreso sin entrar a Editar.
// Los datos de la tarjeta ya están en memoria; hora límite y rúbrica se piden aparte.
async function _verActividad(actividadId) {
  const act = _actividades.find(a => a.id === actividadId)
  if (!act) return

  const dim   = Config.dimensiones.find(d => d.codigo === act.tipo)
  const color = _dimColor(act.tipo)
  const total = _estudiantes.length
  const calificados = _estudiantes.filter(e => _notasMap[`${act.id}_${e.id}`] != null).length
  const pct = total > 0 ? Math.round((calificados / total) * 100) : 0
  const conEntregas = !!window.APP_CONFIG?.permite_entrega_tareas
  const nEntregas = _contEntregas[act.id] ?? 0
  const fmt = (d) => d.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' })
  const fechaCre = fmt(new Date(act.created_at))

  const html = `
    <div class="va">
      <div class="va-chips">
        <span class="act-card-dim-badge" style="--dim-color:${color};">${escapeHtml(dim?.nombre ?? String(act.tipo).toUpperCase())}</span>
        <span class="act-chip">Máx: <strong>${escapeHtml(String(act.max_puntos))}</strong> pts</span>
        <span class="act-chip">${escapeHtml(Config.nombrePeriodo)}: <strong>${escapeHtml(String(act.trimestre))}</strong></span>
      </div>

      <h3 class="va-titulo">${escapeHtml(act.titulo)}</h3>

      <div class="va-fechas">
        <span>${_ico('calendario', 13)} Creada: <strong>${fechaCre}</strong></span>
        <span id="va-entrega">${_ico('reloj', 13)} ${act.fecha_limite ? 'Entrega: cargando…' : 'Sin fecha de entrega'}</span>
      </div>

      <div class="va-seccion">Consigna</div>
      <div class="va-consigna">${act.descripcion ? escapeHtml(act.descripcion) : '<span class="va-vacio">Esta actividad no tiene consigna escrita.</span>'}</div>

      <div id="va-rubrica"><div class="va-seccion">Rúbrica</div><div class="va-vacio">Cargando…</div></div>

      <div class="va-progreso">
        <div class="act-card-progress-bar"><div class="act-card-progress-fill" style="width:${pct}%;background:${color};"></div></div>
        <span>${calificados} / ${total} calificados${conEntregas ? ` · ${_ico('clip', 13)} ${nEntregas} entrega${nEntregas === 1 ? '' : 's'}` : ''}</span>
      </div>

      <div class="va-acciones">
        <button type="button" class="btn btn-primary btn-sm" data-va="notas">${_ico('lapiz')} Registrar notas</button>
        ${conEntregas ? `<button type="button" class="btn btn-secondary btn-sm" data-va="entregas">${_ico('clip')} Entregas</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-va="editar">✎ Editar</button>
      </div>
    </div>`

  _abrirModalInterno('Actividad', html, 760, 'actividad')

  const body = document.getElementById('modal-vc-body')
  const cerrar = () => document.getElementById('modal-vc-interno')?.classList.add('hidden')
  body.querySelector('[data-va="notas"]')?.addEventListener('click', () => { cerrar(); window.abrirModalNotas(actividadId) })
  body.querySelector('[data-va="entregas"]')?.addEventListener('click', () => _verEntregasActividad(actividadId))
  body.querySelector('[data-va="editar"]')?.addEventListener('click', () => { cerrar(); window.editarActividad(actividadId) })

  // Hora límite y rúbrica (si falla, se muestra lo que se tenga)
  const [rHora, rRub] = await Promise.all([
    act.fecha_limite
      ? supabase.from('actividades').select('hora_limite').eq('id', actividadId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('rubrica_criterios')
      .select('nombre, descripcion, puntos_max, porcentaje, niveles, orden')
      .eq('actividad_id', actividadId)
      .order('orden'),
  ])

  // Si el profesor ya cerró o abrió otra actividad, no pisar el contenido
  if (body.querySelector('.va-titulo')?.textContent !== act.titulo) return

  const elEntrega = body.querySelector('#va-entrega')
  if (elEntrega && act.fecha_limite) {
    const hora = rHora?.data?.hora_limite ? String(rHora.data.hora_limite).slice(0, 5) : '23:59'
    const [y, m, d] = act.fecha_limite.split('-').map(Number)
    const [hh, mm] = hora.split(':').map(Number)
    const limite = new Date(y, m - 1, d, hh, mm, 59, 999)
    const vencida = new Date() > limite
    elEntrega.innerHTML = `${_ico('reloj', 13)} Entrega: <strong>${fmt(limite)}, ${hora}</strong>
      <span class="va-estado ${vencida ? 'va-estado--vencida' : 'va-estado--vigente'}">${vencida ? 'vencida' : 'vigente'}</span>`
  }

  const elRub = body.querySelector('#va-rubrica')
  const criterios = rRub?.data ?? []
  if (elRub) {
    if (!criterios.length) {
      elRub.innerHTML = ''
    } else {
      elRub.innerHTML = `
        <div class="va-seccion">Rúbrica</div>
        <div class="va-rubrica">
          ${criterios.map(c => {
            const niveles = (Array.isArray(c.niveles) ? c.niveles : [])
              .slice().sort((a, b) => (b.porcentaje ?? 0) - (a.porcentaje ?? 0))
            return `<details class="va-criterio">
              <summary>
                <span class="va-criterio-nom">${escapeHtml(c.nombre)}</span>
                <span class="va-criterio-num">${escapeHtml(String(c.porcentaje))}% · ${escapeHtml(String(c.puntos_max))} pts</span>
              </summary>
              ${c.descripcion ? `<p class="va-criterio-desc">${escapeHtml(c.descripcion)}</p>` : ''}
              <ul class="va-niveles">
                ${niveles.map(n => `<li><b>${escapeHtml(String(n.porcentaje))}%</b> ${escapeHtml(n.descripcion ?? '')}</li>`).join('')}
              </ul>
            </details>`
          }).join('')}
        </div>`
    }
  }
}

// ─── MODAL INTERNO LIVIANO ───────────────────────────────
function _abrirModalInterno(titulo, contenido, ancho = 560, vista = '') {
  let modal = document.getElementById('modal-vc-interno')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'modal-vc-interno'
    modal.className = 'modal-overlay'
    modal.innerHTML = `
      <div class="modal-box" style="max-width:560px;">
        <div class="modal-header">
          <h2 id="modal-vc-titulo"></h2>
          <button class="btn-close-modal" onclick="document.getElementById('modal-vc-interno').classList.add('hidden')">×</button>
        </div>
        <div class="modal-body" id="modal-vc-body"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('modal-vc-interno').classList.add('hidden')">Cerrar</button>
        </div>
      </div>`
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden') })
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden')
    })
    document.body.appendChild(modal)
  }
  modal.dataset.vista = vista
  modal.querySelector('.modal-box').style.maxWidth = `${ancho}px`
  document.getElementById('modal-vc-titulo').textContent = titulo
  document.getElementById('modal-vc-body').innerHTML = contenido
  modal.classList.remove('hidden')
}

// ─── VER ENTREGAS DE UNA ACTIVIDAD ──────────────────────
// ─── VER ENTREGAS DE UNA ACTIVIDAD ──────────────────────
async function _verEntregasActividad(actividadId) {
  const act = _actividades.find(a => a.id === actividadId)
  if (!act) return

  _abrirModalInterno(`Entregas — ${act.titulo}`, `
    <div class="empty-state"><div class="empty-state-icon">${_ico('reloj', 40)}</div>
    <div class="empty-state-title">Cargando entregas...</div></div>`)

  const lista = await getEntregasPorActividad(actividadId, _estudiantes)
  // Límite vigente (para marcar entregas tardías; si el profesor amplía la fecha, la marca desaparece)
  const { data: actLim } = await supabase.from('actividades').select('fecha_limite, hora_limite').eq('id', actividadId).maybeSingle()
  const tardiaDe = item => tardanzaEntrega(actLim, item.entregas)

  // Cargar notas existentes para esta actividad
  const { data: notasExist } = await supabase
    .from('notas')
    .select('estudiante_id, valor')
    .eq('actividad_id', actividadId)
  const notasMap = {}
  ;(notasExist ?? []).forEach(n => { notasMap[n.estudiante_id] = n.valor })

  // Esta actividad, ¿tiene rúbrica armada? Si sí, se califica por criterios
  // en vez de un número suelto.
  const { data: rubricaCriterios } = await supabase
    .from('rubrica_criterios')
    .select('*')
    .eq('actividad_id', actividadId)
    .order('orden')
  const tieneRubrica = !!(rubricaCriterios && rubricaCriterios.length)
  _rubricaCriteriosActual = rubricaCriterios ?? []
  _rubricaMaxPuntosActual = act.max_puntos

  const entregados = lista.filter(e => e.entrega)
  const pendientes = lista.filter(e => !e.entrega)
  const tardias = entregados.filter(tardiaDe).length

  const html = `
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div class="stat-card" style="flex:1;min-width:0;">
        <div class="stat-card-label">Entregaron</div>
        <div class="stat-card-value" style="color:#16a34a;">${entregados.length}</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:0;">
        <div class="stat-card-label">Pendientes</div>
        <div class="stat-card-value" style="color:#dc2626;">${pendientes.length}</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:0;">
        <div class="stat-card-label">Total</div>
        <div class="stat-card-value">${lista.length}</div>
      </div>
    </div>

    ${tardias ? `<div style="font-size:12px;color:#b45309;margin:-6px 0 10px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${tardias} ${tardias === 1 ? 'entrega tardía' : 'entregas tardías'} (posteriores al plazo vigente)</div>` : ''}
    <div style="max-height:420px;overflow-y:auto;">
      ${lista.map(item => {
        const e = item.entrega
        const fecha = e ? new Date(e.updated_at).toLocaleDateString('es-BO',{day:'2-digit',month:'short',year:'2-digit'}) : null
        const icono = e?.archivo_tipo === 'application/pdf' ? _ico('archivo') : _ico('imagen')
        const notaActual = notasMap[item.estudiante_id] ?? ''
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 0;
            border-bottom:1px solid var(--color-border);flex-wrap:wrap;">
            <div style="flex:1;font-size:13px;font-weight:${e?'600':'400'};
              color:${e?'var(--color-text)':'var(--color-text-3)'};">
              ${escapeHtml(item.nombre)}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;">
              ${e
                ? `${tardiaDe(item) ? `<span title="Subida después del plazo" style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Tardía +${tardiaDe(item).texto}</span>` : ''}${item.entregas.map(x => `<a href="${escapeHtml(x.archivo_url)}" target="_blank" rel="noopener"
                    title="${escapeHtml(x.archivo_nombre ?? '')}"
                    style="display:inline-flex;align-items:center;gap:6px;
                      background:#f0fdf4;color:#15803d;padding:5px 12px;
                      border-radius:8px;font-size:12px;font-weight:600;
                      text-decoration:none;border:1px solid #bbf7d0;">
                    ${x.archivo_tipo === 'application/pdf' ? _ico('archivo') : _ico('imagen')} Ver archivo${item.entregas.length > 1 ? ' ' + (item.entregas.indexOf(x) + 1) : ''}
                    <span style="font-weight:400;color:#6b7280;font-size:11px;">${new Date(x.updated_at).toLocaleDateString('es-BO',{day:'2-digit',month:'short',year:'2-digit'})}</span>
                  </a>`).join('')}
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    ${tieneRubrica ? `
                        <button onclick="window._abrirCalifRubricaDesdeEntrega('${actividadId}','${item.estudiante_id}')"
                          style="background:#4f46e5;color:#fff;border:none;border-radius:6px;
                            padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>Calificar con rúbrica
                        </button>` : ''
                    }
                    <input type="number" 
                      id="nota-entrega-${item.estudiante_id}"
                      min="0" max="${act.max_puntos}" step="0.01"
                      value="${notaActual}"
                      placeholder="${tieneRubrica ? 'o nota directa' : 'Nota'}"
                      style="width:${tieneRubrica ? '90' : '70'}px;padding:5px 8px;border:1px solid var(--color-border);
                        border-radius:6px;font-size:13px;text-align:center;">
                    <span style="font-size:11px;color:var(--color-text-3);">/${act.max_puntos}</span>
                    <button onclick="window._calificarDesdeEntrega('${actividadId}','${item.estudiante_id}',${act.max_puntos})"
                      style="background:${tieneRubrica ? '#f1f5f9' : '#4f46e5'};color:${tieneRubrica ? '#475569' : '#fff'};border:none;border-radius:6px;
                        padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;">
                      ${_ico('guardar')}
                    </button>
                    ${notaActual !== '' ? `<span style="font-size:11px;color:#16a34a;font-weight:600;">✓ ${notaActual}</span>` : ''}
                  </div>`
                : `<span style="font-size:12px;color:var(--color-text-3);
                    background:var(--color-surface-2);padding:4px 10px;border-radius:8px;">
                    Sin entregar
                  </span>`
              }
            </div>
          </div>`
      }).join('')}
    </div>`

  document.getElementById('modal-vc-body').innerHTML = html

  // Handler para calificar desde el modal de entregas
  window._calificarDesdeEntrega = async function(actividadId, estudianteId, maxPuntos) {
    const input = document.getElementById(`nota-entrega-${estudianteId}`)
    const val = input?.value?.trim()
    if (!val) { toast('Ingresa una nota', 'warning'); return }
    const num = parseFloat(val)
    if (isNaN(num) || num < 0 || num > maxPuntos) {
      toast(`Nota fuera de rango (0 - ${maxPuntos})`, 'error'); return
    }
    const { data: notaGuardada, error } = await supabase.from('notas').upsert({
      actividad_id: actividadId,
      estudiante_id: estudianteId,
      valor: num,
      creado_por: _perfil?.id ?? null
    }, { onConflict: ['actividad_id', 'estudiante_id'] }).select('id').single()
    if (error) { toast(error.message, 'error'); return }
    if (notaGuardada) {
      await supabase.from('rubrica_calificaciones').delete().eq('nota_id', notaGuardada.id)
    }
    toast('Nota guardada', 'success')
    // Actualizar indicador visual
    const badge = input.nextElementSibling?.nextElementSibling?.nextElementSibling
    if (badge) { badge.textContent = `✓ ${num}`; badge.style.color = '#16a34a' }
    if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
  }
}


// ─── Estado del modal de calificación por rúbrica ──────────────────────
let _rcCalifSeleccion = {}   // { criterioId: porcentajeElegido }
let _rcCalifCriterios  = []
let _rcCalifMaxPuntos  = 0

// Wrapper para el botón de la vista de Entregas -- solo pasa ids por
// el onclick (seguro, son uuids), busca nombre/criterios en las
// variables de este módulo antes de llamar a la función compartida.
window._abrirCalifRubricaDesdeEntrega = function(actividadId, estudianteId) {
  const nombreEstudiante = _estudiantes.find(e => e.id === estudianteId)?.usuarios?.nombre_completo ?? 'Estudiante'
  window._calificarConRubrica(actividadId, estudianteId, nombreEstudiante, _rubricaMaxPuntosActual, _rubricaCriteriosActual)
  window._rubricaGuardadaCallback = () => { if (typeof window._vcRefrescar === 'function') window._vcRefrescar() }
}

// Función compartida real -- recibe todo por parámetro para poder
// llamarse desde otros módulos (profesor.js / Registrar Notas) sin
// depender de las variables internas de este archivo, y sin tener
// que serializar datos dentro de un atributo onclick (riesgo de XSS
// si el nombre trae comillas).
window._calificarConRubrica = async function(actividadId, estudianteId, nombreEstudiante, maxPuntos, criterios) {
  _rcCalifCriterios = criterios
  _rcCalifMaxPuntos = maxPuntos
  _rcCalifSeleccion = {}

  mostrarLoader('Cargando calificación previa...')
  const { data: notaExist } = await supabase
    .from('notas').select('id').eq('actividad_id', actividadId).eq('estudiante_id', estudianteId).maybeSingle()
  let previas = []
  if (notaExist) {
    const { data } = await supabase.from('rubrica_calificaciones').select('criterio_id, puntos_obtenidos').eq('nota_id', notaExist.id)
    previas = data ?? []
  }
  ocultarLoader()

  previas.forEach(p => {
    const crit = criterios.find(c => c.id === p.criterio_id)
    if (!crit) return
    const pctElegido = crit.niveles.find(n => Math.abs((crit.puntos_max * n.porcentaje / 100) - p.puntos_obtenidos) < 0.05)?.porcentaje
    if (pctElegido !== undefined) _rcCalifSeleccion[crit.id] = pctElegido
  })

  const overlay = document.createElement('div')
  overlay.id = 'rc-calif-overlay'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)', padding: '16px'
  })
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:640px;max-height:88vh;">
      <div class="modal-header modal-header-gradient">
        <div class="modal-header-icon-lg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="#fff"/></svg>
        </div>
        <div class="modal-header-titles">
          <h2>Calificar con rúbrica</h2>
          <p class="modal-subtitle">${escapeHtml(nombreEstudiante)}</p>
        </div>
        <button class="btn-close-modal" onclick="document.getElementById('rc-calif-overlay').remove()">×</button>
      </div>
      <div class="modal-body" id="rc-calif-body" style="overflow-y:auto;flex:1;">
        ${criterios.map(c => _renderCriterioCalificarHTML(c)).join('')}
      </div>
      <div class="modal-footer-gradient" style="padding:14px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
        <div id="rc-calif-total" style="font-size:14px;font-weight:700;"></div>
        <div style="display:flex;gap:8px;">
          <button type="button" onclick="document.getElementById('rc-calif-overlay').remove()" class="btn btn-secondary">Cancelar</button>
          <button type="button" id="rc-calif-guardar" onclick="window._guardarCalificacionRubrica('${actividadId}','${estudianteId}')" class="btn btn-primary">Guardar calificación</button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _rcCalifActualizarTotal()
}

function _renderCriterioCalificarHTML(c) {
  return `
    <div style="border:1px solid var(--color-border);border-radius:10px;padding:12px 14px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:8px;">
        <span>${escapeHtml(c.nombre)}</span>
        <span style="color:var(--color-text-3);font-weight:500;">${c.porcentaje}% · ${c.puntos_max} pts</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${c.niveles.map(n => `
          <button type="button" class="rc-calif-pill" data-crit="${c.id}" data-pct="${n.porcentaje}"
            title="${escapeHtml(n.descripcion)}"
            onclick="window._rcCalifElegir('${c.id}', ${n.porcentaje})"
            style="padding:6px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--color-border);background:#fff;color:#374151;">
            ${n.porcentaje}%
          </button>
        `).join('')}
      </div>
      <div class="rc-calif-desc" style="font-size:11px;color:var(--color-text-3);margin-top:6px;min-height:14px;"></div>
    </div>`
}

window._rcCalifElegir = function(criterioId, porcentaje) {
  _rcCalifSeleccion[criterioId] = porcentaje
  _rcCalifActualizarTotal()
}

function _rcCalifActualizarTotal() {
  document.querySelectorAll('.rc-calif-pill').forEach(btn => {
    const crit = btn.dataset.crit, pct = parseInt(btn.dataset.pct, 10)
    const elegido = _rcCalifSeleccion[crit] === pct
        btn.style.background = elegido ? 'var(--color-primary)' : '#fff'
    btn.style.color = elegido ? '#fff' : '#374151'
    btn.style.borderColor = elegido ? 'var(--color-primary)' : 'var(--color-border)'
    if (elegido) {
      const criterio = _rcCalifCriterios.find(c => c.id === crit)
      const nivel = criterio?.niveles.find(n => n.porcentaje === pct)
      const descEl = btn.closest('div').parentElement.querySelector('.rc-calif-desc')
      if (descEl && nivel) descEl.textContent = nivel.descripcion
    }
  })

  let total = 0, faltan = 0
  _rcCalifCriterios.forEach(c => {
    const pct = _rcCalifSeleccion[c.id]
    if (pct === undefined) { faltan++; return }
    total += c.puntos_max * pct / 100
  })
  const totalEl = document.getElementById('rc-calif-total')
  const btnGuardar = document.getElementById('rc-calif-guardar')
  if (totalEl) {
    totalEl.textContent = faltan > 0
      ? `Faltan ${faltan} criterio(s) por calificar`
      : `Total: ${total.toFixed(1)} / ${_rcCalifMaxPuntos} pts`
    totalEl.style.color = faltan > 0 ? '#dc2626' : '#16a34a'
  }
  if (btnGuardar) btnGuardar.disabled = faltan > 0
}

window._guardarCalificacionRubrica = async function(actividadId, estudianteId) {
  const faltan = _rcCalifCriterios.filter(c => _rcCalifSeleccion[c.id] === undefined)
  if (faltan.length) { toast('Calificá todos los criterios antes de guardar', 'warning'); return }

  let total = 0
  const detalle = _rcCalifCriterios.map(c => {
    const pct = _rcCalifSeleccion[c.id]
    const pts = +(c.puntos_max * pct / 100).toFixed(2)
    total += pts
    return { criterio_id: c.id, puntos_obtenidos: pts }
  })
  total = +total.toFixed(2)

  mostrarLoader('Guardando calificación...')
  const { data: nota, error: errNota } = await supabase.from('notas').upsert({
    actividad_id: actividadId,
    estudiante_id: estudianteId,
    valor: total,
    creado_por: _perfil?.id ?? null
  }, { onConflict: ['actividad_id', 'estudiante_id'] }).select('id').single()

  if (errNota || !nota) { ocultarLoader(); toast(errNota?.message ?? 'No se pudo guardar la nota', 'error'); return }

  await supabase.from('rubrica_calificaciones').delete().eq('nota_id', nota.id)
  const { error: errDetalle } = await supabase.from('rubrica_calificaciones').insert(
    detalle.map(d => ({ nota_id: nota.id, criterio_id: d.criterio_id, puntos_obtenidos: d.puntos_obtenidos }))
  )
  ocultarLoader()
  if (errDetalle) { toast(errDetalle.message, 'error'); return }

  toast(`Nota guardada: ${total} pts`, 'success')
  document.getElementById('rc-calif-overlay')?.remove()
  if (typeof window._rubricaGuardadaCallback === 'function') window._rubricaGuardadaCallback()
  else if (typeof window._vcRefrescar === 'function') window._vcRefrescar()
}
// ─── FIN calificación por rúbrica ──────────────────────────────────────

// ─── HELPERS ─────────────────────────────────────────────
function _get() {
  return {
    cursoId:   document.getElementById('selector-curso-global')?.value ?? '',
    materiaId: document.getElementById('selector-materia-global')?.value ?? '',
    periodo:   parseInt(document.getElementById('selector-periodo-global')?.value ?? '1'),
  }
}

function _dimColor(codigo) {
  const map = {
    hacer:   '#f59e0b',
    saber:   '#3b82f6',
    ser:     '#8b5cf6',
    decidir: '#06b6d4',
  }
  return map[codigo] ?? '#6366f1'
}

function _emptyState(icon, msg) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${_ico(icon, 40)}</div>
    <div class="empty-state-title">${msg}</div>
  </div>`
}

function _skeleton() {
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
    ${[1,2,3].map(() => `<div class="act-card-skeleton"></div>`).join('')}
  </div>`
}

// ─── PROMEDIO ANUAL DEL CURSO ────────────────────────────
window._vcVerPromedioAnual = async function() {
  const { cursoId, materiaId } = _get()
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia primero', 'warning'); return }

  _abrirModalInterno('Promedio Anual', `<div style="text-align:center;padding:24px;">Calculando...</div>`)

  const idsEstudiantes = _estudiantes.map(e => e.id)
  const lote = await calcularPromedioAnualLote(idsEstudiantes, [materiaId])
  const html = _estudiantes.map((e, i) => {
    const m = lote[e.id]?.[0]
    if (!m) return ''
    const aprobado = (m.promedio ?? 0) >= (Config.notaMinima ?? 51)
    return `<tr>
      <td style="padding:8px;font-size:13px;">${i+1}</td>
      <td style="padding:8px;font-weight:500;font-size:13px;">${escapeHtml(e.usuarios?.nombre_completo ?? '—')}</td>
      <td style="padding:8px;text-align:center;" title="${tituloExacto(m.t1)}">${fmtNota(m.t1)}</td>
      <td style="padding:8px;text-align:center;" title="${tituloExacto(m.t2)}">${fmtNota(m.t2)}</td>
      <td style="padding:8px;text-align:center;" title="${tituloExacto(m.t3)}">${fmtNota(m.t3)}</td>
      <td style="padding:8px;text-align:center;font-weight:700;color:${aprobado?'#065f46':'#991b1b'};">
        <span title="${tituloExacto(m.promedioExacto)}">${fmtNota(m.promedio)}</span>
      </td>
      <td style="padding:8px;text-align:center;">
        <span class="badge ${m.completo?(aprobado?'badge-success':'badge-error'):'badge-warning'}">${m.estado}</span>
      </td>
    </tr>`
  })

  document.getElementById('modal-vc-body').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:var(--color-surface-2);">
          <th style="padding:8px;">N°</th>
          <th style="padding:8px;text-align:left;">Estudiante</th>
          <th style="padding:8px;text-align:center;">T1</th>
          <th style="padding:8px;text-align:center;">T2</th>
          <th style="padding:8px;text-align:center;">T3</th>
          <th style="padding:8px;text-align:center;">Promedio</th>
          <th style="padding:8px;text-align:center;">Estado</th>
        </tr>
      </thead>
      <tbody>${html.join('')}</tbody>
    </table>
    <div style="margin-top:10px;font-size:11px;color:var(--color-text-3);text-align:right;">
      Promedio = (T1 + T2 + T3) ÷ trimestres con nota, notas redondeadas (.5 sube) · Aprueba con ≥ ${Config.notaMinima} pts
    </div>`
}

// ─── RE-RENDER TRAS GUARDAR NOTA ─────────────────────────
window._vcRefrescar = async function() {
  await _renderVista()
}

// ─── HANDLERS DE BOTONES DE INFORMES ─────────────────────
window._vcExportarDetalle = async function() {
  const { cursoId, materiaId, periodo } = _get()
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia primero', 'warning'); return }
  if (typeof ExcelJS === 'undefined') { toast('La librería de Excel no está cargada', 'error'); return }

  const hoy = new Date().toISOString().slice(0, 10)
  const inicioMes = hoy.slice(0, 8) + '01'

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)'
  })
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:420px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 8px;font-size:1.1rem;font-weight:700;">Exportar Excel</h3>
      <p style="margin:0 0 14px;font-size:0.85rem;color:#64748b;">
        Las <strong>notas y rúbricas</strong> se exportan del trimestre actual.<br>
        Elige el rango <strong>solo para la hoja de asistencia</strong>:
      </p>
      <p style="margin:0 0 14px;padding:8px 10px;font-size:0.8rem;color:#92400e;background:#fef3c7;border-radius:8px;">
        ${_ico('alerta', 13)} Las actividades con <strong>rúbrica</strong> se califican desde la web para conservar el detalle por criterios.
        Las demás puedes llenarlas en Excel y luego importarlas.
      </p>
      <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Desde</label>
      <input id="vc-exp-ini" type="date" value="${inicioMes}"
        style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px;box-sizing:border-box;">
      <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Hasta</label>
      <input id="vc-exp-fin" type="date" value="${hoy}"
        style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px;box-sizing:border-box;">
      <div style="display:flex;gap:8px;">
        <button id="vc-exp-ok" style="flex:1;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Descargar Excel</button>
        <button id="vc-exp-cancel" style="flex:1;padding:10px;background:#f1f5f9;color:#374151;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Cancelar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  document.getElementById('vc-exp-cancel').onclick = () => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  document.getElementById('vc-exp-ok').onclick = async () => {
    const fechaInicio = document.getElementById('vc-exp-ini').value
    const fechaFin    = document.getElementById('vc-exp-fin').value
    if (!fechaInicio || !fechaFin) { toast('Selecciona el rango de fechas', 'warning'); return }
    if (fechaInicio > fechaFin) { toast('La fecha desde no puede ser mayor que hasta', 'warning'); return }
    overlay.remove()
    mostrarLoader('Generando Excel de notas + asistencia...')
    try {
      await exportarDetalleNotasExcel({
        cursoId,
        materiaId,
        periodo,
        profesorId:    _perfil?.id ?? null,
        nombreDocente: _perfil?.nombre_completo ?? null,
        fechaInicio,
        fechaFin,
      })
      toast('Excel generado correctamente', 'success')
    } catch (err) {
      console.error(err)
      toast('Error al generar el Excel: ' + (err.message ?? err), 'error')
    } finally {
      ocultarLoader()
    }
  }
}

window._vcImportarNotas = function() {
  const { cursoId, materiaId, periodo } = _get()
  iniciarImportacionNotas({
    cursoId, materiaId, periodo,
    perfil: _perfil,
    onTerminado: () => _renderVista(),
  })
}

window._vcAbrirBajoRendimiento = function() {
  if (typeof window.abrirInformeBajoRendimiento === 'function') {
    window.abrirInformeBajoRendimiento()
  } else {
    toast('El módulo de bajo rendimiento no está cargado', 'error')
  }
}

window._vcAbrirInforme = window._vcAbrirBajoRendimiento

window._vcAbrirAprobados = function() {
  if (typeof window.abrirInformeAprobados === 'function') {
    window.abrirInformeAprobados()
  } else {
    toast('El módulo de aprobados/reprobados no está cargado', 'error')
  }
}

window._vcAbrirJunta = function() {
  if (window.APP_CONFIG?.plan !== 'avanzado') {
    toast('La Junta Trimestral (reportes avanzados y certificado automático) requiere el plan avanzado. Solicítalo al administrador.', 'warning')
    return
  }
  if (typeof window.abrirInformeJunta === 'function') {
    window.abrirInformeJunta()
  } else {
    toast('El módulo de junta trimestral no está cargado', 'error')
  }
}