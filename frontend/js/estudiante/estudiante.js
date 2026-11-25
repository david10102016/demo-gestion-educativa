// js/estudiante/estudiante.js
import { supabase } from '../config/supabase-config.js'
import { verificarSesion, logout } from '../auth/auth.js'
import { Config } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar, fechaLocal } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import { generarLibretaPDF } from '../utils/generar-libreta-pdf.js'
import { subirEntrega, eliminarEntrega, MAX_ARCHIVOS } from '../utils/entrega-tareas.js'
import { tardanzaEntrega } from '../utils/entrega-tardia.js'
import { renderizarPromedioAnual } from '../utils/promedio-anual.js'
import { etiquetaEstado, textoLlegada } from '../utils/asistencia-materia.js'
import { notaOficial, fmtNota, tituloExacto } from '../utils/estado-notas.js'
import { montarIngreso } from '../porteria/calendario-ingreso.js'
import { cursosDelGrado } from '../utils/tecnica-grado.js'
import { iniciarMisTareas, cargarMisTareas } from './mis-tareas.js'
import { fetchConCache } from '../utils/data-layer.js'
import { insertarAvisoCopia } from '../utils/connection-status.js'
const _cp = localStorage.getItem('color_primario')
if (_cp) document.documentElement.style.setProperty('--color-primary', _cp)

let perfil  = null
let estData = null

// ─── INIT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await verificarSesion('estudiante')
  if (!sesion) return
  perfil = sesion.perfil

  document.getElementById('nombre-est').textContent =
    perfil.nombre_completo
  document.getElementById('email-est').textContent = perfil.email ?? ''
  document.getElementById('avatar-est').textContent =
    perfil.nombre_completo.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()
  document.getElementById('stat-año-est').textContent     = Config.año
  document.getElementById('topbar-periodo-est').textContent = `Gestión ${Config.año}`

  // Colegio y datos del estudiante no dependen entre sí: se piden al mismo tiempo,
  // con límite de tiempo y copia guardada para señal débil o sin conexión.
  const colegioId = perfil.colegio_id
  const usuarioId = perfil.id
  const [rCol, rEst] = await Promise.all([
    fetchConCache({
      key: `colegio-nombre:${colegioId}`,
      colegioId, usuarioId,
      run: () => supabase.from('colegios').select('nombre').eq('id', colegioId).single(),
    }),
    fetchConCache({
      key: `estudiante-datos:${usuarioId}`,
      colegioId, usuarioId,
      run: () => supabase
        .from('estudiantes')
        .select('id, carnet, curso_id, curso:cursos(id, nombre_completo, nivel, grado)')
        .eq('id', usuarioId)
        .single(),
    }),
  ])
  const col = rCol.data
  if (col) document.getElementById('nombre-colegio-est').textContent = col.nombre

  // Datos del estudiante
  const e = rEst.data
  estData = e
  if (e) document.getElementById('curso-est').textContent = e.curso?.nombre_completo ?? '—'

  // Poblar selector de períodos
  const selPer = document.getElementById('sel-periodo-notas')
  if (selPer) {
    selPer.innerHTML = Config.periodos
      .map(p => `<option value="${p.numero}">${escapeHtml(p.nombre)}</option>`)
      .join('')
    selPer.value = String(Config.trimestreActivo ?? 1)   // abre en el trimestre activo, igual que el profesor
    selPer.addEventListener('change', cargarNotasEst)
  }

  // Fechas asistencia — mes actual por defecto
  const hoy = new Date()
  const ini = fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1))
  const fin = fechaLocal(hoy)
  const iniEl = document.getElementById('asis-ini-est')
  const finEl = document.getElementById('asis-fin-est')
  if (iniEl) iniEl.value = ini
  if (finEl) finEl.value = fin

  // Navegación
  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => mostrarSec(btn.dataset.section))
  })

  document.getElementById('btn-logout-est')?.addEventListener('click', async () => {
    if (await confirmar('Cerrar sesión', '¿Deseas cerrar la sesión?')) logout()
  })

  await cargarInicio()
  iniciarMisTareas(perfil, estData, mostrarSec)   // contador del menú "Mis tareas"
  actualizarBadgeComunicados(perfil.id)           // contador del menú "Comunicados"
  // Listener botón cerrar modal
  document.getElementById('modal-detalle-materia')
    ?.querySelector('.btn-close-modal')
    ?.addEventListener('click', () => {
      document.getElementById('modal-detalle-materia').classList.add('hidden')
    })

  // Listener overlay para cerrar al hacer clic fuera del modal-box
  document.getElementById('modal-detalle-materia')
    ?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.add('hidden')
      }
    })
})

// ─── NAVEGACIÓN ──────────────────────────────────────────
function mostrarSec(nombre) {
  document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'))
  document.querySelectorAll('.nav-item[data-section]').forEach(b => b.classList.remove('active'))
  document.getElementById(`section-${nombre}`)?.classList.remove('hidden')
  document.querySelector(`[data-section="${nombre}"]`)?.classList.add('active')

  const titulos = {
    inicio:            'Inicio',
    tareas:            'Mis tareas',
    notas:             'Mis notas',
    asistencia:        'Mi asistencia',
    ingreso:           'Ingreso al colegio',
    'evaluar-docente': 'Evaluar docente',
    'promedio-anual':  'Promedio Anual',
    telegram:          'Vincular Telegram'
  }
  document.getElementById('topbar-title-est').textContent = titulos[nombre] ?? nombre

  const loaders = {
    tareas:            cargarMisTareas,
    notas:             cargarNotasEst,
        asistencia:        () => window.cargarAsistenciaEst?.(),
    'evaluar-docente': cargarEvaluacionDocente,
    'promedio-anual':  () => renderizarPromedioAnual('panel-promedio-anual', estData?.id),
    telegram:          cargarTelegram,
    'mi-cuenta':       () => {},
    comunicados:       () => cargarComunicadosEst(perfil.id),
    ingreso:           () => montarIngreso(document.getElementById('ingreso-cont'), [{ id: estData?.id, nombre: perfil?.nombre_completo ?? 'Yo' }])
  }
  loaders[nombre]?.()
}

// ─── INICIO ──────────────────────────────────────────────
async function cargarInicio() {
  if (!perfil?.id) return

  const colegioId = perfil.colegio_id
  const usuarioId = perfil.id

  // Materias del curso, notas y faltas no dependen entre sí: se piden al mismo tiempo,
  // con límite de tiempo y copia guardada. El filtro por materias del curso se aplica
  // aquí mismo (antes se aplicaba en la consulta), con el mismo resultado.
  const [rAsigs, rNotas, rFaltas] = await Promise.all([
    estData?.curso_id
      ? fetchConCache({
          key: `inicio-materias-curso:${estData.curso_id}`,
          colegioId, usuarioId,
          run: () => supabase
            .from('asignaciones_profesor')
            .select('materia_id')
            .eq('curso_id', estData.curso_id)
            .eq('activo', true),
        })
      : Promise.resolve({ data: [], error: null, offline: false }),
    fetchConCache({
      key: `inicio-notas:${usuarioId}`,
      colegioId, usuarioId,
      run: () => supabase
        .from('notas_finales')
        .select('materia_id, materia, nota_final, estado, trimestre')
        .eq('estudiante_id', usuarioId),
    }),
    fetchConCache({
      key: `inicio-faltas:${usuarioId}`,
      colegioId, usuarioId,
      run: async () => {
        const r = await supabase.from('asistencias_materia')
          .select('*', { count: 'exact', head: true })
          .eq('estudiante_id', usuarioId)
          .eq('estado', 'falta')
        return { data: r.count ?? 0, error: r.error }
      },
    }),
  ])

  const resumenEl = document.getElementById('resumen-notas-inicio')
  if (rNotas.error && !rNotas.data) {
    // Sin respuesta del servidor y sin copia guardada: no dejar "Cargando..." para siempre.
    if (resumenEl) {
      resumenEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No se pudieron cargar tus notas</div>
          <div class="empty-state-desc">Revisa tu señal o tus datos móviles e intenta de nuevo.</div>
          <button type="button" class="btn btn-primary" style="margin-top:12px" id="btn-reintentar-inicio">Reintentar</button>
        </div>`
      document.getElementById('btn-reintentar-inicio')?.addEventListener('click', () => cargarInicio())
    }
    return
  }

  const materiaIds = [...new Set((rAsigs.data ?? []).map(a => a.materia_id))]
  const notas = materiaIds.length
    ? (rNotas.data ?? []).filter(n => materiaIds.includes(n.materia_id))
    : (rNotas.data ?? [])
  const faltas = rFaltas.data

  // Agrupar por materia (igual que promedio-anual.js hace)
  const porMateria = {}
  for (const n of (notas ?? [])) {
    const val = parseFloat(n.nota_final ?? 0)
    if (val <= 0) continue // Solo notas válidas
    const trim = parseInt(n.trimestre ?? 0)
    const trimActual = porMateria[n.materia_id] ? parseInt(porMateria[n.materia_id].trimestre ?? 0) : 0
    if (trim > trimActual) {
      porMateria[n.materia_id] = { ...n, nota_final: val }
    }
  }

  const notasAgrupadas = Object.values(porMateria)
  const promedio = notasAgrupadas.length
    ? fmtNota(notasAgrupadas.reduce((s, n) => s + notaOficial(n.nota_final), 0) / notasAgrupadas.length)
    : '—'

  document.getElementById('stat-promedio').textContent     = promedio
  document.getElementById('stat-materias-est').textContent = notasAgrupadas.length
  document.getElementById('stat-faltas').textContent       = faltas ?? 0

  const resumen = document.getElementById('resumen-notas-inicio')
  if (!notasAgrupadas.length) {
    resumen.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">Sin notas registradas aún</div>
        <div class="empty-state-desc">Las notas aparecerán aquí cuando tu profesor las registre</div>
      </div>`
    if (rNotas.offline) insertarAvisoCopia(resumen, rNotas.syncedAt)
    return
  }

    const notaMin = Config.notaMinima ?? 51
  const trimActivo = Config.trimestreActivo ?? 1
  const gestionCerrada = !!Config.bloqueada

  resumen.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr><th>Materia</th><th>Nota</th><th>Estado</th></tr>
        </thead>
        <tbody>
          ${notasAgrupadas
            .sort((a, b) => a.materia?.localeCompare(b.materia))
            .map(n => {
              const nota = n.nota_final
              const bajoMinimo = notaOficial(nota) < notaMin
              const colorNota = bajoMinimo ? '#b91c1c' : '#15803d'
              // Trimestre cerrado: gestión bloqueada O la nota es de un trimestre anterior al activo
              const trimestreCerrado = gestionCerrada || parseInt(n.trimestre ?? 0) < trimActivo
              let textoEstado, badgeClass
              if (!trimestreCerrado) {
                textoEstado = 'En curso'
                badgeClass = 'badge-warning'
              } else if (bajoMinimo) {
                textoEstado = Config.etiqReprobado ?? 'REPROBADO'
                badgeClass = 'badge-error'
              } else {
                textoEstado = Config.etiqAprobado ?? 'APROBADO'
                badgeClass = 'badge-success'
              }
              return `
              <tr>
                <td>${n.materia}</td>
                <td><strong style="color:${colorNota}" title="${tituloExacto(nota)}">${fmtNota(nota)}</strong></td>
                <td>
                  <span class="badge ${badgeClass}">${textoEstado}</span>
                </td>
              </tr>`
            }).join('')}
        </tbody>
      </table>
    </div>`
  if (rNotas.offline) insertarAvisoCopia(resumen, rNotas.syncedAt)
}

// ─── NOTAS ───────────────────────────────────────────────
async function cargarNotasEst() {

  const periodo = parseInt(document.getElementById('sel-periodo-notas')?.value ?? '1')
  mostrarLoader('Cargando notas...')

  // Toda la obtención va en una sola copia guardada por trimestre: sin conexión
  // se muestra lo último que el estudiante vio de ese trimestre.
  const obtener = async () => {
    let cursoId = estData?.curso?.id
    if (!cursoId) {
      const { data: eTemp } = await supabase
        .from('estudiantes')
        .select('id, curso_id, curso:cursos(id, nombre_completo)')
        .eq('id', perfil.id)
        .single()
      estData = eTemp
      cursoId = estData?.curso?.id
    }
    if (!cursoId) return { sinCurso: true, filas: [] }

    const nivel = estData?.curso?.nivel
    const grado = parseInt(estData?.curso?.grado) || 0
    let materiaIds = []

    if (nivel) {
      // Cargar todas las materias activas del nivel con sus flags técnicos
      const { data: todasMaterias } = await supabase
        .from('materias')
        .select('id, es_tecnica, aplica_desde')
        .eq('nivel', nivel)
        .eq('activo', true)

      // 4to/5to/6to de Secundaria (ya no depende de Config.usaCarrerasTecnicas:
      // el toggle solo bloquea altas nuevas de inscripción, no debe ocultar la
      // nota general de una inscripción ya existente)
      const esTecnicaSecundariaSuperior =
        nivel === 'Secundaria' && grado >= 4

      if (esTecnicaSecundariaSuperior) {
        // Consultar si el estudiante tiene una inscripción técnica activa
        const { data: inscripciones } = await supabase
          .from('inscripciones_tecnicas')
          .select('materia_id')
          .eq('estudiante_id', estData.id)
          .eq('activo', true)

        const materiaTecnicaInscritaId = inscripciones?.[0]?.materia_id ?? null

        materiaIds = (todasMaterias ?? [])
          .filter(m => {
            if (!m.es_tecnica) return true                        // regulares: siempre mostrar
            if (m.id === materiaTecnicaInscritaId) return true    // su carrera inscrita: mostrar
            return false                                           // otras técnicas: ocultar
          })
          .map(m => m.id)
      } else {
        // 1ro/2do/3ro, o flag desactivado:
        // Solo materias regulares. Técnica Tecnológica General (es_tecnica=false) queda incluida.
        materiaIds = (todasMaterias ?? [])
          .filter(m => !m.es_tecnica)
          .map(m => m.id)
      }
    }

    let query = supabase
      .from('notas_finales')
      .select('*')
      .eq('estudiante_id', estData.id)
      .eq('trimestre', periodo)
    if (materiaIds.length) query = query.in('materia_id', materiaIds)

    const { data, error } = await query
    if (error) throw error
    return { sinCurso: false, filas: data ?? [] }
  }
  const r = await fetchConCache({
    key: `mis-notas:${periodo}`,
    colegioId: perfil.colegio_id, usuarioId: perfil.id,
    ms: 15000,
    run: async () => {
      try { return { data: await obtener(), error: null } }
      catch (e) { return { data: null, error: e } }
    },
  })
  ocultarLoader()
  if (r.data?.sinCurso) return
  const data  = r.data?.filas ?? null
  const error = r.data ? null : r.error

  const panel = document.getElementById('panel-notas-est')
  const dims  = Config.dimensiones

  if (error) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-title">Error cargando notas</div><div class="empty-state-desc">${error.message ?? error}</div></div>`
    return
  }
  if (!data?.length) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">Sin notas registradas aún</div><div class="empty-state-desc">Las notas aparecerán aquí cuando tu profesor las registre</div></div>`
    return
  }

  panel.innerHTML = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <div class="sp-table-wrap">
      <table class="sp-table" style="min-width:660px;">
        <colgroup>
          <col class="col-materia">
          ${dims.map(() => `<col class="col-dim">`).join('')}
          <col class="col-total" style="width:100px;">
          <col class="col-detalles" style="width:90px;">
          <col class="col-estado" style="width:110px;">
        </colgroup>
        <thead class="sp-thead">
          <tr>
            <th>Materia</th>
            ${dims.map(d => `
              <th class="center">
                <div class="sp-dim-label">
                  <span class="sp-dim-name">${escapeHtml(d.nombre)}</span>
                  <span class="sp-dim-pts">${d.peso_maximo} pts</span>
                </div>
              </th>`).join('')}
            <th class="center">Total</th>
            <th class="center">Detalles</th>
            <th class="center">Estado</th>
          </tr>
        </thead>
        <tbody>
          ${data.sort((a,b) => a.materia?.localeCompare(b.materia)).map(n => {
            // null = profesor no ingresó nota aún; 0 = nota real de cero
            const rawVals = {
              hacer:  n.promedio_hacer  != null ? parseFloat(n.promedio_hacer)  : null,
              saber:  n.promedio_saber  != null ? parseFloat(n.promedio_saber)  : null,
              ser:    n.nota_ser        != null ? parseFloat(n.nota_ser)        : null,
              decidir:n.nota_decidir    != null ? parseFloat(n.nota_decidir)    : null,
            }
            // Si todas las dimensiones son null → sin calificar (nota_final llega 0 por COALESCE en la vista)
            const todasNull = Object.values(rawVals).every(v => v === null)
            const total = todasNull ? null : parseFloat(n.nota_final ?? 0)
            const sinCalificar = todasNull
            const aprobado = !todasNull && notaOficial(total) >= (Config.notaMinima ?? 51)
            // Trimestre abierto (o 3er trimestre sin gestión cerrada): la nota puede cambiar → "En curso"
            const trimCerrado = !!Config.bloqueada || periodo < (Config.trimestreActivo ?? 1)
            const textoEstado = sinCalificar ? 'Pendiente' : !trimCerrado ? 'En curso' : (aprobado ? (Config.etiqAprobado ?? 'APROBADO') : (Config.etiqReprobado ?? 'REPROBADO'))
            const badgeEstado = sinCalificar ? 'badge-neutral' : !trimCerrado ? 'badge-warning' : aprobado ? 'badge-success' : 'badge-error'
            return `
              <tr class="sp-tr">
                <td class="sp-td"><strong>${n.materia}</strong></td>
                ${dims.map(d => {
                  const raw = rawVals[d.codigo]
                  if (raw == null) {
                    // Sin nota aún → mostrar guión
                    return `<td class="sp-td center">
                      <div class="dim-pill dp-zero" style="color:var(--color-text-3);letter-spacing:1px;">—</div>
                    </td>`
                  }
                  const v = fmtNota(raw)
                  const cls = raw > 0 ? `dp-${d.codigo}` : 'dp-zero'
                  return `<td class="sp-td center">
                    <div class="dim-pill ${cls}" title="${tituloExacto(raw)}">
                      ${v}<span>/ ${d.peso_maximo}</span>
                    </div>
                  </td>`
                }).join('')}
                <td class="sp-td center">
                  <div class="sp-total ${total != null ? (aprobado ? 'sp-total--aprobado' : 'sp-total--reprobado') : ''}">
                    ${total != null ? `<span title="${tituloExacto(total)}">${fmtNota(total)}</span><small>/100</small>` : '<span style="color:var(--color-text-3);letter-spacing:1px;">—</span>'}
                  </div>
                </td>
                <td class="sp-td center" style="white-space:nowrap;">
                  <button class="btn btn-sm" 
                    style="background:#ede9fe;color:#6d28d9;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;white-space:nowrap;"
                    onclick="verDetalleMateria('${n.materia_id}','${n.materia}',${periodo})">
                    🔍 Ver
                  </button>
                </td>
                <td class="sp-td center">
                  <span class="badge ${badgeEstado}">
                    ${textoEstado}
                  </span>
                </td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    </div>
    <div style="margin-top:16px;text-align:right;">
      <button class="btn btn-secondary" id="btn-descargar-libreta" style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg> Descargar libreta PDF</button>
    </div>`

  document.getElementById('btn-descargar-libreta')
    ?.addEventListener('click', () => {
      if (!estData?.id) {
        toast('No se encontró el estudiante.', 'error');
        return;
      }
      generarLibretaPDF(estData.id);
    });
  if (r.offline) insertarAvisoCopia(panel, r.syncedAt)
}

// ─── MODAL DETALLE MATERIA ─────────────────────────────
// soloActividadId (opcional): desde "Mis tareas" se muestra solo esa actividad
window.verDetalleMateria = async function(materiaId, materiaNombre, periodo, soloActividadId = null) {
    if (!materiaId || materiaId === 'undefined' || !perfil?.id || !estData?.curso_id) {
      console.error('[detalle] Datos inválidos:', { materiaId, materiaNombre, periodo })
      document.getElementById('modal-detalle-materia').classList.add('hidden')
      return
    }
  const modal = document.getElementById('modal-detalle-materia')
  const body  = document.getElementById('modal-detalle-body')
  document.getElementById('modal-detalle-titulo').textContent = `${materiaNombre} — ${Config.periodos.find(p=>p.numero===periodo)?.nombre ?? 'Período '+periodo}`
  modal.classList.remove('hidden')
  body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Cargando...</div></div>`

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnicaDetalle = materiaInfo?.es_tecnica === true
  if (esTecnicaDetalle && !Config.usaCarrerasTecnicas) {
    const { data: notaFinal } = await supabase
      .from('notas_finales')
      .select('nota_final, estado')
      .eq('estudiante_id', perfil.id)
      .eq('materia_id', materiaId)
      .eq('trimestre', periodo)
      .maybeSingle()

    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Detalle no disponible</div>
        <p style="color:var(--color-text-3);font-size:13px;max-width:340px;margin:8px auto 16px;">
          El desglose por actividad y la entrega de tareas en línea de esta materia no están
          disponibles con el plan actual del colegio.
        </p>
        <div style="font-size:28px;font-weight:700;" title="${tituloExacto(notaFinal?.nota_final)}">${fmtNota(notaFinal?.nota_final)}</div>
        <div style="font-size:13px;color:var(--color-text-3);margin-top:2px;">${notaFinal ? ((Config.bloqueada || periodo < (Config.trimestreActivo ?? 1)) ? Config.estado(notaFinal.nota_final) : 'En curso') : ''}</div>
      </div>
    `
    return
  }

  // 1. Actividades HACER y SABER con sus notas y observaciones
  let qActs = supabase
    .from('actividades')
    .select('id, titulo, descripcion, tipo, max_puntos, fecha_limite, hora_limite, fecha_cambiada_en, permite_entrega_tardia, archivo_consigna_url, curso_id, curso:cursos(nombre_completo)')
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .in('tipo', ['hacer', 'saber'])
  // Técnica: solo actividades de su grado (5° y 6° son grupos distintos aunque la materia sea la misma)
  if (esTecnicaDetalle) qActs = qActs.in('curso_id', await cursosDelGrado(estData.curso_id))
  if (!esTecnicaDetalle) {
    // Actividades de su curso actual + las de otro paralelo donde ya tiene nota (traslado)
    const { data: notasTr } = await supabase
      .from('notas')
      .select('actividad_id, act:actividades!inner(materia_id, trimestre, curso_id)')
      .eq('estudiante_id', perfil.id)
      .eq('act.materia_id', materiaId)
      .eq('act.trimestre', periodo)
      .neq('act.curso_id', estData.curso_id)
    const idsTr = (notasTr ?? []).map(n => n.actividad_id)
    qActs = idsTr.length
      ? qActs.or(`curso_id.eq.${estData.curso_id},id.in.(${idsTr.join(',')})`)
      : qActs.eq('curso_id', estData.curso_id)
  }
  const { data: actividadesTodas } = await qActs.order('fecha_limite', { ascending: true })
  const actividades = soloActividadId ? (actividadesTodas ?? []).filter(a => a.id === soloActividadId) : actividadesTodas

  const actIds = (actividades ?? []).map(a => a.id)
  let notasMap = {}
  if (actIds.length) {
    const { data: notas } = await supabase
      .from('notas')
      .select('id, actividad_id, valor, observaciones, updated_at')
      .eq('estudiante_id', perfil.id)
      .in('actividad_id', actIds)
    ;(notas ?? []).forEach(n => { notasMap[n.actividad_id] = n })
  }

  // 1c. Rúbrica (si la actividad tiene una armada): criterios + desglose
  // de esta calificación puntual. Opcional por actividad — si no hay
  // filas en rubrica_criterios, no se muestra nada distinto a hoy.
  let rubricaCriteriosMap = {}
  let rubricaCalifMap = {}
  if (actIds.length) {
    const { data: rc } = await supabase
      .from('rubrica_criterios')
      .select('*')
      .in('actividad_id', actIds)
      .order('orden')
    ;(rc ?? []).forEach(c => {
      if (!rubricaCriteriosMap[c.actividad_id]) rubricaCriteriosMap[c.actividad_id] = []
      rubricaCriteriosMap[c.actividad_id].push(c)
    })
    const notaIds = Object.values(notasMap).map(n => n.id)
    if (notaIds.length) {
      const { data: rcal } = await supabase
        .from('rubrica_calificaciones')
        .select('*')
        .in('nota_id', notaIds)
      ;(rcal ?? []).forEach(x => {
        if (!rubricaCalifMap[x.nota_id]) rubricaCalifMap[x.nota_id] = {}
        rubricaCalifMap[x.nota_id][x.criterio_id] = x.puntos_obtenidos
      })
    }
  }

  // Un archivo entregado: nombre, Ver/descargar, fecha de subida y (si está abierta) Reemplazar/Quitar
  const fmtSubido = f => new Date(f).toLocaleString('es-BO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  const archivoHtml = (e, abierta, actId) => `
    <div style="display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:12px;font-weight:600;color:#15803d;overflow-wrap:anywhere;">Entregado: ${escapeHtml(e.archivo_nombre ?? '')}</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${e.archivo_url ? `<a href="${escapeHtml(e.archivo_url)}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;
          background:var(--color-primary,#4f46e5);color:#fff;text-decoration:none;">Ver / descargar</a>` : ''}
        ${abierta ? `
        <label style="display:inline-flex;align-items:center;background:var(--color-surface,#fff);color:var(--color-text-2);padding:4px 10px;
          border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--color-border);">
          Reemplazar
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.txt"
            onchange="window._subirEntregaPorActividad('${actId}', this, '${e.id}')" style="display:none;">
        </label>
        <button type="button" onclick="window._quitarEntregaPorActividad('${actId}', '${e.id}')"
          style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:4px 10px;
          border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">Quitar</button>` : ''}
        ${e.updated_at ? `<span style="font-size:11px;color:var(--color-text-3);">Subido el ${fmtSubido(e.updated_at)}</span>` : ''}
      </div>
    </div>`

  // 1b. Entregas del estudiante (hasta MAX_ARCHIVOS por actividad, migración 106)
  let entregasMap = {}
  if (actIds.length && window.APP_CONFIG?.permite_entrega_tareas) {
    const { data: entregas } = await supabase
      .from('entregas_tareas')
      .select('id, actividad_id, archivo_nombre, archivo_url, created_at, updated_at')
      .eq('estudiante_id', perfil.id)
      .in('actividad_id', actIds)
      .order('created_at', { ascending: true })
    ;(entregas ?? []).forEach(e => { (entregasMap[e.actividad_id] ??= []).push(e) })
  }

  // 2. Ficha SER publicada (obs_general)
  const { data: fichas } = await supabase
    .from('fichas_seguimiento_ser')
    .select('nota_calculada, obs_general, fecha')
    .eq('estudiante_id', perfil.id)
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .eq('publicada', true)
    .order('fecha', { ascending: false })
    .limit(1)
  const fichaSer = fichas?.[0] ?? null

  // 3. Calificaciones SER/DECIDIR
  const { data: cal } = await supabase
    .from('calificaciones')
    .select('nota_ser, nota_decidir')
    .eq('estudiante_id', perfil.id)
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .maybeSingle()

  // ── Render ──
  const dimColors = { hacer: { bg:'#eff6ff', color:'#1d4ed8' }, saber: { bg:'#f0fdf4', color:'#15803d' } }

  const actHtml = (actividades ?? []).length === 0
    ? `<p style="color:var(--color-text-3);font-size:13px;padding:12px 0;">Sin actividades registradas aún.</p>`
    : (actividades ?? []).map(a => {
        const nota = notasMap[a.id]
        const c = dimColors[a.tipo] ?? { bg:'#f3f4f6', color:'#374151' }
        const pct = nota ? Math.round((nota.valor / a.max_puntos) * 100) : 0
        return `
          <div style="padding:12px 0;border-bottom:1px solid var(--color-border);">
            <div style="display:flex;align-items:flex-start;gap:12px;justify-content:space-between;">
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <span style="background:${c.bg};color:${c.color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;">${a.tipo}</span>
                  <span style="font-size:14px;font-weight:600;color:var(--color-text);">${a.titulo}</span>
                  ${!esTecnicaDetalle && a.curso_id !== estData.curso_id ? `<span style="background:#fef3c7;color:#b45309;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;">${escapeHtml(a.curso?.nombre_completo ?? 'Otro paralelo')} (traslado)</span>` : ''}
                </div>
                ${a.descripcion ? `<p style="font-size:12px;color:var(--color-text-3);margin:2px 0 6px;">${escapeHtml(a.descripcion)}</p>` : ''}
                ${a.archivo_consigna_url 
                  ? `<a href="${a.archivo_consigna_url}" target="_blank" rel="noopener"
                      style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;
                        background:#eff6ff;color:#1d4ed8;padding:5px 12px;border-radius:8px;
                        font-size:12px;font-weight:600;text-decoration:none;border:1px solid #bfdbfe;">
                      📄 Descargar enunciado
                    </a>` 
                  : ''}
                ${nota?.observaciones ? `<div style="margin-top:8px;padding:10px 12px;background:#fefce8;border:1px solid #fde68a;border-left:4px solid #eab308;border-radius:0 8px 8px 0;">
                  <div style="font-size:11px;font-weight:700;color:#854d0e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">💬 Observación del profesor · ${escapeHtml(a.titulo)} (${nota.valor}/${a.max_puntos})</div>
                  <div style="font-size:13px;color:#713f12;line-height:1.4;white-space:pre-wrap;">${escapeHtml(nota.observaciones)}</div>
                </div>` : ''}
                                ${(() => {
                  const criterios = rubricaCriteriosMap[a.id]
                  if (!criterios || !criterios.length) return ''
                  const detalle = nota ? (rubricaCalifMap[nota.id] ?? {}) : {}
                  const titulo = nota
                    ? 'Desglose de la calificación'
                    : 'Rúbrica de evaluación'
                  return `
                    <div style="margin-top:8px;border:1px solid var(--color-border);border-radius:8px;padding:8px 12px;">
                      <div style="font-size:11px;font-weight:700;color:var(--color-text-3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.03em;">${titulo}</div>
                      ${criterios.map(crit => {
                        const pts = detalle[crit.id]
                        return `
                          <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;">
                            <span style="color:var(--color-text);">${escapeHtml(crit.nombre)}</span>
                            <span style="font-weight:600;color:${c.color};">${nota
                              ? (pts !== undefined ? `${pts} / ${crit.puntos_max} pts` : '—')
                              : `${crit.puntos_max} pts máx.`}</span>
                          </div>`
                      }).join('')}
                    </div>`
                })()}
              </div>
              <div style="text-align:right;flex-shrink:0;">
                ${nota
                  ? `<div style="font-size:18px;font-weight:700;color:${c.color};">${nota.valor}<span style="font-size:12px;font-weight:400;color:var(--color-text-3);">/${a.max_puntos}</span></div>
                     <div style="font-size:11px;color:var(--color-text-3);">${pct}%</div>`
                  : `<div style="font-size:13px;color:var(--color-text-3);">Sin calificar</div>`}
              </div>
            </div>
            ${window.APP_CONFIG?.permite_entrega_tareas && (esTecnicaDetalle || a.curso_id === estData.curso_id) ? (() => {
            const [year, month, day] = (a.fecha_limite ?? '').split('-').map(Number)
            const [hh, mm] = a.hora_limite
              ? a.hora_limite.split(':').map(Number)
              : [23, 59]
            const limiteLocal = a.fecha_limite ? new Date(year, month - 1, day, hh, mm, 59, 999) : null
            const vencida = limiteLocal && new Date() > limiteLocal
            // Calificada = bloqueada, salvo que el profesor haya cambiado la fecha DESPUÉS de la nota (migración 105)
            const reabierta = nota && a.fecha_cambiada_en && new Date(a.fecha_cambiada_en) > new Date(nota.updated_at ?? 0)
            const lista = entregasMap[a.id] ?? []
            // Abierta: tiene fecha, no venció y (no tiene nota o el profesor la reabrió)
            const permiteTardia = a.permite_entrega_tardia === true
            const abierta = !!a.fecha_limite && (!vencida || permiteTardia) && (!nota || reabierta)
            const tardanza = tardanzaEntrega(a, lista)
            if (!a.fecha_limite && !nota && !lista.length) return `
              <div style="margin-top:10px;font-size:12px;color:var(--color-text-3);">Se presenta en clase</div>`
            if (!abierta && !lista.length) return vencida && !nota ? `
              <div style="margin-top:10px;"><span style="display:inline-flex;background:#fee2e2;color:#991b1b;
                padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;">Entrega cerrada</span></div>` : ''
            const fechaLimiteStr = a.fecha_limite
                ? `${new Date(year, month - 1, day).toLocaleDateString('es-BO', {day:'2-digit', month:'short', year:'numeric'})} — ${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}hs`
                : null
            const puedeAgregar = abierta && lista.length < MAX_ARCHIVOS
            return `
              <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
                ${reabierta && abierta ? `<div style="font-size:11px;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 10px;">Tu profesor reabrió la entrega. Puedes subir o reemplazar archivos.</div>` : ''}
                ${abierta && vencida ? `<div style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:5px 10px;">El plazo venció el <strong>${fechaLimiteStr}</strong>. Aún puedes entregar: quedará registrado como <strong>entrega tardía</strong>.</div>` : ''}
                ${abierta && !vencida && fechaLimiteStr ? `<div style="font-size:11px;color:var(--color-text-3);">Fecha límite: <strong style="color:#d97706;">${fechaLimiteStr}</strong></div>` : ''}
                ${tardanza ? `<div style="font-size:11px;font-weight:600;color:#b45309;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Entregaste ${tardanza.texto} después del plazo</div>` : ''}
                ${!abierta && vencida && !nota ? `<div style="font-size:11px;font-weight:600;color:#991b1b;">Entrega cerrada</div>` : ''}
                ${lista.map(e => archivoHtml(e, abierta, a.id)).join('')}
                ${puedeAgregar ? `
                <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
                  <label style="display:inline-flex;align-items:center;background:var(--color-primary,#4f46e5);color:#fff;
                    padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
                    ${lista.length ? 'Agregar otro archivo' : 'Entregar'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.txt"
                      onchange="window._subirEntregaPorActividad('${a.id}', this)" style="display:none;">
                  </label>
                  <span style="font-size:11px;color:var(--color-text-3);">PDF, JPG, PNG o TXT — máx. 10MB · hasta ${MAX_ARCHIVOS} archivos (${lista.length}/${MAX_ARCHIVOS})</span>
                </div>` : ''}
              </div>`
          })() : ''}
                    </div>`
      }).join('')

  let serHtml = '';
  if (fichaSer) {
    serHtml = `<div style="padding:12px;background:#fdf4ff;border-radius:var(--radius-md);margin-top:4px;">
         <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
           <span style="font-size:13px;font-weight:600;color:#7c3aed;">Nota SER (ficha publicada)</span>
           <span style="font-size:18px;font-weight:700;color:#7c3aed;">${fichaSer.nota_calculada}<span style="font-size:12px;font-weight:400;color:var(--color-text-3);">/10</span></span>
         </div>
         ${fichaSer.obs_general ? `<div style="padding:8px 12px;background:#ede9fe;border-left:3px solid #7c3aed;border-radius:0 6px 6px 0;font-size:12px;color:#4c1d95;">💬 <em>${escapeHtml(fichaSer.obs_general)}</em></div>` : '<p style="font-size:12px;color:var(--color-text-3);">Sin observaciones del profesor.</p>'}
       </div>`;
  } else if (cal?.nota_ser != null) {
    serHtml = `<div style="padding:12px;background:#f3f4f6;border-radius:var(--radius-md);margin-top:4px;">
         <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
           <span style="font-size:13px;font-weight:600;color:#7c3aed;">Nota SER (calificación directa)</span>
           <span style="font-size:18px;font-weight:700;color:#7c3aed;">${cal.nota_ser}<span style="font-size:12px;font-weight:400;color:var(--color-text-3);">/10</span></span>
         </div>
         <p style="font-size:12px;color:var(--color-text-3);">Sin observaciones del profesor.</p>
       </div>`;
  } else {
    serHtml = `<div style="padding:10px;background:var(--color-surface-2);border-radius:var(--radius-md);font-size:13px;color:var(--color-text-3);">Ficha SER no publicada aún.</div>`;
  }

  const decidirHtml = cal?.nota_decidir != null
    ? `<div style="padding:10px 14px;background:#fff7ed;border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;">
         <span style="font-size:13px;font-weight:600;color:#c2410c;">Autoevaluación (DECIDIR)</span>
         <span style="font-size:18px;font-weight:700;color:#c2410c;">${cal.nota_decidir}<span style="font-size:12px;font-weight:400;color:var(--color-text-3);">/5</span></span>
       </div>`
    : `<div style="padding:10px;background:var(--color-surface-2);border-radius:var(--radius-md);font-size:13px;color:var(--color-text-3);">DECIDIR no registrado aún.</div>`

  let entregaHtml = ''

  body.innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-3);margin-bottom:10px;">Actividades (HACER y SABER)</div>
      ${actHtml}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-3);margin-bottom:8px;">Dimensión SER</div>
        ${serHtml}
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-3);margin-bottom:8px;">Dimensión DECIDIR</div>
        ${decidirHtml}
      </div>
    </div>
    ${entregaHtml}`

  // Handler de entrega por actividad
  window._subirEntregaPorActividad = async function(actividadId, input, reemplazarId = null) {
    const file = input.files?.[0]
    if (!file) return
    const ok = await subirEntrega(perfil.id, actividadId, file, reemplazarId)
    input.value = ''
    if (ok) {
      window._refrescarMisTareas?.()
      const mat = document.getElementById('modal-detalle-titulo')?.textContent?.split(' — ')[0] ?? ''
      verDetalleMateria(materiaId, mat, periodo, soloActividadId)
    }
  }

  // Handler para quitar UN archivo entregado
  window._quitarEntregaPorActividad = async function(actividadId, entregaId) {
    if (!await confirmar('Quitar archivo', '¿Quitar este archivo de tu entrega? Esta acción no se puede deshacer.')) return
    await eliminarEntrega(perfil.id, actividadId, entregaId)
    toast('Archivo eliminado', 'success')
    window._refrescarMisTareas?.()
    const mat = document.getElementById('modal-detalle-titulo')?.textContent?.split(' — ')[0] ?? ''
    verDetalleMateria(materiaId, mat, periodo, soloActividadId)
  }
}

// ─── ASISTENCIA ──────────────────────────────────────────
window.cargarAsistenciaEst = async function () {
  const ini = document.getElementById('asis-ini-est')?.value
  const fin = document.getElementById('asis-fin-est')?.value
  if (!ini || !fin) { toast('Selecciona un rango de fechas', 'warning'); return }

  mostrarLoader('Cargando asistencia...')
  // Se guarda la última consulta (con su rango de fechas): sin conexión se muestra esa.
  const res = await fetchConCache({
    key: 'asistencia-ultima',
    colegioId: perfil.colegio_id, usuarioId: perfil.id,
    ms: 15000,
    run: async () => {
      const q = await supabase
        .from('asistencias_materia')
        .select('fecha, estado, observaciones, hora_llegada, minutos_retraso, materia:materias(nombre)')
        .eq('estudiante_id', perfil.id)
        .gte('fecha', ini)
        .lte('fecha', fin)
        .order('fecha', { ascending: false })
      return { data: q.error ? null : { ini, fin, filas: q.data ?? [] }, error: q.error }
    },
  })
  ocultarLoader()

  const panel = document.getElementById('panel-asistencia-est')
  if (res.error) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No se pudo cargar tu asistencia</div>
        <div class="empty-state-desc">${escapeHtml(res.error.message ?? String(res.error))}</div>
      </div>`
    return
  }
  const data = res.data?.filas ?? []
  const avisoRango = () => {
    if (!res.offline) return
    insertarAvisoCopia(panel, res.syncedAt)
    if (res.data.ini !== ini || res.data.fin !== fin) {
      const nota = document.createElement('div')
      nota.className = 'text-sm'
      nota.style.cssText = 'margin:-6px 0 12px;color:var(--color-text-3);'
      nota.textContent = `Rango guardado: del ${res.data.ini} al ${res.data.fin}.`
      panel.querySelector(':scope > .aviso-copia-guardada')?.after(nota)
    }
  }

  if (!data?.length) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <div class="empty-state-title">Sin registros en ese período</div>
      </div>`
    avisoRango()
    return
  }

  const resumen = { presente: 0, falta: 0, retraso: 0, licencia: 0 }
  data.forEach(r => { resumen[r.estado] = (resumen[r.estado] || 0) + 1 })
  const total = data.length
  const pct = total > 0
    ? ((resumen.presente + resumen.retraso) / total * 100).toFixed(0)
    : 0

  const colores = {
    presente: 'badge-success',
    falta:    'badge-error',
    retraso:  'badge-warning',
    licencia: 'badge-info'
  }

  panel.innerHTML = `
    <div class="grid-4" style="margin-bottom:16px;">
      <div class="stat-card">
        <div class="stat-card-label">Asistencia</div>
        <div class="stat-card-value">${pct}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Presentes</div>
        <div class="stat-card-value" style="color:var(--color-success);">${resumen.presente}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Faltas</div>
        <div class="stat-card-value" style="color:var(--color-error);">${resumen.falta}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Retrasos</div>
        <div class="stat-card-value" style="color:var(--color-warning);">${resumen.retraso}</div>
      </div>
    </div>
    <div class="card" style="padding:0;">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>Fecha</th><th>Materia</th><th>Estado</th><th>Observación</th></tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr>
                <td>
                  ${new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-BO', {
                    weekday: 'short', day: 'numeric', month: 'short'
                  })}
                </td>
                <td class="text-sm">${escapeHtml(r.materia?.nombre ?? '—')}</td>
                <td>
                  <span class="badge ${colores[r.estado] ?? 'badge-neutral'}">${escapeHtml(etiquetaEstado(r.estado))}</span>
                  ${r.hora_llegada ? `<div class="text-sm text-muted" style="margin-top:3px;">${escapeHtml(textoLlegada(r))}</div>` : ''}
                </td>
                <td class="text-sm text-muted">${escapeHtml(r.observaciones ?? '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`
  avisoRango()
}

// ─── EVALUAR DOCENTE ─────────────────────────────────────
async function cargarEvaluacionDocente() {
  const { data: evalActiva } = await supabase
    .from('evaluaciones_docente')
    .select('*')
    .eq('año', Config.año)
    .eq('activa', true)
    .maybeSingle()

  const panel = document.getElementById('panel-evaluar-docente')

  if (!evalActiva) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⭐</div>
        <div class="empty-state-title">Sin evaluación activa</div>
        <div class="empty-state-desc">
          El director debe activar la evaluación docente para que puedas responder
        </div>
      </div>`
    return
  }

  const [{ data: asigs }, { data: preguntas }] = await Promise.all([
    supabase.from('asignaciones_profesor')
      .select('profesor_id, profesor:usuarios(nombre_completo), materia:materias(nombre)')
      .eq('curso_id', estData?.curso_id ?? ''),
    supabase.from('config_preguntas_docente')
      .select('*')
      .eq('año', Config.año)
      .eq('activo', true)
      .order('orden')
  ])

  if (!asigs?.length) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⭐</div>
        <div class="empty-state-title">No tienes profesores asignados aún</div>
      </div>`
    return
  }

  // Agrupar asignaciones por profesor (puede tener varias materias)
  const profMap = {}
  for (const a of asigs) {
    if (!profMap[a.profesor_id]) {
      profMap[a.profesor_id] = { nombre: a.profesor?.nombre_completo, materias: [] }
    }
    profMap[a.profesor_id].materias.push(a.materia?.nombre)
  }

  panel.innerHTML = Object.entries(profMap).map(([profId, info]) => `
    <div class="card" style="margin-bottom:16px;" id="eval-prof-${profId}">
      <div class="flex-between" style="margin-bottom:16px;">
        <div>
          <div class="card-title">${escapeHtml(info.nombre)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
            ${info.materias.map(m => `<span class="badge badge-info">${escapeHtml(m)}</span>`).join('')}
          </div>
        </div>
        <span class="badge badge-neutral" id="eval-estado-${profId}">Pendiente</span>
      </div>
      ${(preguntas ?? []).map((p, i) => `
        <div style="margin-bottom:16px;">
          <p style="font-size:13.5px;font-weight:500;margin-bottom:10px;">
            ${i + 1}. ${escapeHtml(p.texto)}
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${Array.from(
              { length: p.escala_max - p.escala_min + 1 },
              (_, j) => p.escala_min + j
            ).map(v => `
              <label style="display:flex;flex-direction:column;align-items:center;gap:4px;
                cursor:pointer;padding:8px 14px;border:1px solid var(--color-border);
                border-radius:var(--radius-md);font-size:12px;min-width:48px;text-align:center;
                transition:all 0.15s;">
                <input type="radio" name="eval_${profId}_${p.id}" value="${v}"
                  style="width:auto;" onchange="resaltarOpcion(this)">
                <span>${v}</span>
                <span class="text-xs" style="opacity:0.6;">
                  ${v === p.escala_min ? 'Bajo' : v === p.escala_max ? 'Excelente' : ''}
                </span>
              </label>`).join('')}
          </div>
        </div>`).join('')}
      <button class="btn btn-primary"
        onclick="enviarEvaluacion('${evalActiva.id}','${profId}','${escapeHtml(info.nombre)}')">
        Enviar evaluación
      </button>
    </div>`).join('')

  // Marcar los que ya respondió
  for (const profId of Object.keys(profMap)) {
    const { data: ya } = await supabase
      .from('respuestas_evaluacion')
      .select('id')
      .eq('evaluacion_id', evalActiva.id)
      .eq('profesor_id', profId)
      .eq('estudiante_id', perfil.id)
      .maybeSingle()

    if (ya) marcarEvalCompleta(profId)
  }
}

window.resaltarOpcion = function (input) {
  const grupo = input.closest('div[style]')
  grupo?.querySelectorAll('label').forEach(l => {
    l.style.background    = ''
    l.style.borderColor   = ''
    l.style.color         = ''
  })
  const label = input.closest('label')
  if (label) {
    label.style.background  = 'var(--color-primary-light)'
    label.style.borderColor = 'var(--color-primary)'
    label.style.color       = 'var(--color-primary)'
  }
}

function marcarEvalCompleta(profId) {
  const card = document.getElementById(`eval-prof-${profId}`)
  if (!card) return
  card.querySelectorAll('input, button').forEach(el => el.disabled = true)
  card.querySelectorAll('label').forEach(l => { l.style.cursor = 'default' })
  const badge = document.getElementById(`eval-estado-${profId}`)
  if (badge) {
    badge.textContent  = 'Completada'
    badge.className    = 'badge badge-success'
  }
}

window.enviarEvaluacion = async function (evalId, profId, profNombre) {
  const { data: preguntas } = await supabase
    .from('config_preguntas_docente')
    .select('id')
    .eq('año', Config.año)
    .eq('activo', true)

  const respuestas = {}
  for (const p of preguntas ?? []) {
    const sel = document.querySelector(`input[name="eval_${profId}_${p.id}"]:checked`)
    if (!sel) {
      toast(`Completa todas las preguntas para ${profNombre}`, 'warning')
      return
    }
    respuestas[p.id] = parseInt(sel.value)
  }

  mostrarLoader('Enviando evaluación...')
  const { error } = await supabase.from('respuestas_evaluacion').insert({
    evaluacion_id: evalId,
    profesor_id:   profId,
    estudiante_id: perfil.id,
    respuestas
  })
  ocultarLoader()

  if (error) {
    toast(
      error.message?.includes('unique')
        ? 'Ya enviaste esta evaluación anteriormente'
        : error.message,
      'error'
    )
    return
  }

  toast(`Evaluación enviada para ${profNombre}`, 'success')
  marcarEvalCompleta(profId)
}

// ─── TELEGRAM ────────────────────────────────────────────
async function cargarTelegram() {
  const { data: vinculos } = await supabase
    .from('telegram_vinculos')
    .select('*')
    .eq('estudiante_id', perfil.id)
    .eq('activo', true)

  const panel   = document.getElementById('panel-telegram')
  const vinc    = (vinculos ?? []).filter(v => v.vinculado)
  const pend    = (vinculos ?? []).filter(v => !v.vinculado)

  const tiposLabel = {
    estudiante: 'Estudiante',
    padre:      'Padre',
    madre:      'Madre',
    tutor:      'Tutor'
  }

  let html = ''

  if (vinc.length) {
    html += `
      <div style="margin-bottom:20px;">
        <p style="font-size:13px;font-weight:600;color:var(--color-success);margin-bottom:8px;">
          ✓ Cuentas vinculadas
        </p>
        ${vinc.map(v => `
          <div style="padding:12px;background:var(--color-success-bg);border-radius:var(--radius-md);
            margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span class="badge badge-success">${tiposLabel[v.tipo_usuario] ?? v.tipo_usuario}</span>
              <span class="text-sm" style="margin-left:8px;color:var(--color-text-2);">
                Chat ID: ${v.chat_id}
              </span>
            </div>
            <button class="btn btn-danger btn-sm" onclick="desvincularTelegram('${v.id}')">
              Desvincular
            </button>
          </div>`).join('')}
      </div>`
  }

  if (pend.length) {
    html += `
      <div style="margin-bottom:20px;">
        <p style="font-size:13px;font-weight:600;color:var(--color-warning);margin-bottom:8px;">
          ⏳ Pendientes de activar
        </p>
        ${pend.map(v => `
          <div style="padding:12px;background:var(--color-warning-bg);border-radius:var(--radius-md);margin-bottom:8px;">
            <p class="text-sm">
              Envía este código al bot de Telegram:
            </p>
            <p style="font-family:var(--font-mono);font-size:22px;font-weight:700;
              color:var(--color-primary);margin:6px 0;letter-spacing:3px;">
              ${v.codigo_vinculacion}
            </p>
            <p class="text-xs text-muted">
              Tipo: ${tiposLabel[v.tipo_usuario] ?? v.tipo_usuario}
            </p>
          </div>`).join('')}
      </div>`
  }

  html += `
    <div style="border-top:1px solid var(--color-border);padding-top:20px;">
      <p class="text-sm" style="margin-bottom:12px;color:var(--color-text-2);">
        Agregar nueva cuenta de Telegram:
      </p>
      <div class="form-group">
        <label>Tipo de cuenta</label>
        <select id="tipo-telegram" style="width:auto;">
          <option value="estudiante">Estudiante</option>
          <option value="padre">Padre</option>
          <option value="madre">Madre</option>
          <option value="tutor">Tutor</option>
        </select>
      </div>
      <button class="btn btn-primary" onclick="generarCodigoTelegram()">
        Generar código
      </button>
      <div style="margin-top:16px;padding:14px;background:var(--color-surface-2);
        border-radius:var(--radius-md);">
        <p style="font-size:13px;font-weight:600;margin-bottom:8px;">Instrucciones:</p>
        <ol style="font-size:13px;color:var(--color-text-2);padding-left:18px;line-height:1.8;">
          <li>Selecciona el tipo de cuenta y genera un código</li>
          <li>Abre Telegram y busca el bot del colegio</li>
          <li>Envía el código al bot escribiéndolo en el chat</li>
          <li>Tu cuenta quedará vinculada automáticamente</li>
        </ol>
      </div>
    </div>`

  panel.innerHTML = html
}

window.generarCodigoTelegram = async function () {
  const tipo   = document.getElementById('tipo-telegram')?.value ?? 'estudiante'
  const codigo = Math.random().toString(36).substring(2, 8).toUpperCase()

  const { error } = await supabase.from('telegram_vinculos').insert({
    estudiante_id:      perfil.id,
    codigo_vinculacion: codigo,
    tipo_usuario:       tipo,
    vinculado:          false,
    activo:             true
  })

  if (error) { toast(error.message, 'error'); return }
  toast(`Código generado: ${codigo}`, 'success')
  cargarTelegram()
}

window.desvincularTelegram = async function (id) {
  if (!await confirmar('Desvincular Telegram', '¿Deseas desvincular esta cuenta?')) return
  await supabase.from('telegram_vinculos').update({ activo: false }).eq('id', id)
  toast('Cuenta desvinculada', 'success')
  cargarTelegram()
}

// ─── MI CUENTA — CAMBIAR CONTRASEÑA ─────────────────────
window.cambiarContrasenaEstudiante = async function() {
  const nueva   = document.getElementById('est-pass-nueva')?.value ?? ''
  const confirm = document.getElementById('est-pass-confirm')?.value ?? ''

  if (!nueva || !confirm) { toast('Completa todos los campos', 'warning'); return }
  if (nueva.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'warning'); return }
  if (nueva !== confirm) { toast('Las contraseñas no coinciden', 'error'); return }

  mostrarLoader('Actualizando contraseña...')
  try {
    const { error } = await supabase.auth.updateUser({ password: nueva })
    if (error) throw error

    toast('Contraseña actualizada correctamente', 'success')
    document.getElementById('est-pass-nueva').value = ''
    document.getElementById('est-pass-confirm').value = ''
  } catch(err) {
    toast(err.message ?? 'Error actualizando contraseña', 'error')
  } finally {
    ocultarLoader()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEGAR AL FINAL DE: frontend/js/estudiante/estudiante.js
// ═══════════════════════════════════════════════════════════════════════════════
import { getComunicadosEstudiante, contarNoLeidos } from '../comunicados/comunicados.js'
import { renderBandeja, pintarBadgeComunicados } from '../comunicados/comunicados-ui.js'

// ─── CONTADOR DEL MENÚ "Comunicados" ──────────────────────────────────────────
export async function actualizarBadgeComunicados(estudianteId) {
  try {
    pintarBadgeComunicados(await contarNoLeidos(estudianteId))
  } catch (e) {
    console.error('[comunicados] contador', e)
  }
}

// ─── CARGAR BANDEJA ───────────────────────────────────────────────────────────
export async function cargarComunicadosEst(estudianteId) {
  const contenedor = document.getElementById('bandeja-comunicados')
  if (!contenedor) return
  // Copia guardada de la bandeja: sin conexión se pueden leer los comunicados ya recibidos.
  const res = await fetchConCache({
    key: 'comunicados-bandeja',
    colegioId: perfil?.colegio_id, usuarioId: estudianteId,
    ms: 15000,
    run: async () => {
      try { return { data: await getComunicadosEstudiante(estudianteId), error: null } }
      catch (e) { return { data: null, error: e } }
    },
  })
  if (res.error) {
    contenedor.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No se pudieron cargar los comunicados</div>
        <div class="empty-state-desc">${escapeHtml(res.error.message ?? String(res.error))}</div>
      </div>`
    return
  }
  renderBandeja(contenedor, res.data ?? [], () => actualizarBadgeComunicados(estudianteId))
  if (res.offline) insertarAvisoCopia(contenedor, res.syncedAt)
  else actualizarBadgeComunicados(estudianteId)
}