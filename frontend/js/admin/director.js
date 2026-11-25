// js/admin/director.js
import { supabase, crearClienteTemporal } from '../config/supabase-config.js'
import { verificarSesion, logout } from '../auth/auth.js'
import { Config, invalidarConfigCache } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar, debounce } from '../utils/ui.js'
import { escapeHtml as escapeHTML } from '../utils/sanitize.js'
import { initCarrerasTecnicas }   from './carreras-tecnicas.js'
import { initBitacoraDirector }   from './bitacora-director.js'
import { initReportesDirector }    from './reportes-director.js'
import { mostrarWidgetImportacionEstudiantes } from '../utils/importar-estudiantes.js'
import { mostrarWidgetImportacionProfesores, generarPasswordTemporal } from '../utils/importar-profesores.js'
import { paginar } from '../utils/paginar.js'
import { iniciarAsesorCursoDirector } from './asesor-curso-director.js'
import '../utils/centralizador-anual.js'
import { exportarDetalleNotasExcel, exportarAsistenciasExcel } from '../utils/export-excel.js'
import { obtenerDetalleDia, obtenerResumenDia, etiquetaEstado, textoLlegada } from '../utils/asistencia-materia.js'
  import { htmlBadgeEstado, htmlResumenConDetalle, htmlFilasAsistenciaPorDia } from '../utils/asistencia-resumen-ui.js'
import {
  TIPOS_NOVEDAD, hoyLocalISO, listarEstudiantesCurso, listarNovedades,
  guardarNovedad, eliminarNovedad, listarHistorialEstudiante, mensajeErrorNovedad,
} from '../utils/novedades-asistencia.js'
import { generarLibretaPDF, buildDoc } from '../utils/generar-libreta-pdf.js'
import { cerrarGestionActual, desbloquearGestion, bloquearGestion, iniciarCierreConPromocion } from '../utils/gestion-cierre.js'
import { calcularPromedioAnualLote } from '../utils/promedio-anual.js'
import { notaOficial, fmtNota, tituloExacto } from '../utils/estado-notas.js'
import { exportarCredencialesPDF } from './credenciales-pdf.js'
import '../porteria/porteria-director.js'
import { initReportesPagos, renderReporteCurso, renderConfigMensualidad } from '../pagos/reportes-pagos.js'
import { initBandejaComprobantes } from '../pagos/bandeja-comprobantes.js'
import { validarNombre, validarTelefono } from '../utils/validaciones.js'
window.exportarCredencialesPDF = exportarCredencialesPDF
window.renderReporteCurso = renderReporteCurso
window.renderConfigMensualidad = renderConfigMensualidad
window.abrirAsignarBeca = abrirAsignarBeca
// ─── ESTADO GLOBAL ───────────────────────────────────────
let perfil = null
const POR_PAGINA = 20
let paginaEst = 1
let totalEst  = 0

const POR_PAGINA_ASIS = 50
let paginaAsisDir = 1

// ─── INIT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await verificarSesion('director')
  if (!sesion) return
  perfil = sesion.perfil
  window._perfil_director = sesion.perfil

  document.getElementById('nombre-director').textContent = perfil.nombre_completo
  document.getElementById('email-director').textContent = perfil.email ?? ''
  document.getElementById('avatar-director').textContent =
    perfil.nombre_completo.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase()
  document.getElementById('topbar-año').textContent = `Gestión ${Config.año}`

  const { data: col } = await supabase.from('colegios').select('nombre').eq('id', perfil.colegio_id).single()
  if (col) document.getElementById('nombre-colegio').textContent = col.nombre

  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => mostrarSeccion(btn.dataset.section))
  })

    const finanzasActivo = window.APP_CONFIG?.plan === 'avanzado' && window.APP_CONFIG?.finanzas_habilitado === true
  if (!finanzasActivo) {
    const navPagos = document.getElementById('nav-pagos')
    if (navPagos) navPagos.style.display = 'none'
  }

  // Carreras técnicas: respetar el valor guardado en config (no solo el switch en caliente)
  actualizarNavCarrerasTecnicas(Config.usaCarrerasTecnicas)

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (await confirmar('Cerrar sesión', '¿Deseas cerrar la sesión?')) logout()
  })

  document.getElementById('buscar-estudiante')?.addEventListener('input', debounce(() => {
    paginaEst = 1; cargarEstudiantes()
  }, 400))
  document.getElementById('filtro-curso-est')?.addEventListener('change', () => {
    paginaEst = 1; cargarEstudiantes()
  })

  document.getElementById('mat-tecnica')?.addEventListener('change', function() {
    document.getElementById('mat-aplica-grupo').style.display = this.checked ? 'block' : 'none'
  })

  document.getElementById('cal-curso')?.addEventListener('change', async function() {
    const { data } = await supabase.from('asignaciones_profesor')
      .select('materia:materias(id,nombre)').eq('curso_id', this.value)
    const sel = document.getElementById('cal-materia')
    sel.innerHTML = '<option value="">Selecciona materia</option>'
      + [...new Map((data??[]).map(a=>[a.materia.id,a.materia])).values()]
          .map(m=>`<option value="${m.id}">${m.nombre}</option>`).join('')
  })

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) this.classList.add('hidden')
    })
  })

  await cargarEstadisticasInicio()
  await Promise.all([cargarCursosEnSelects(), cargarPeriodosEnSelects()])
})

// ─── NAVEGACIÓN ──────────────────────────────────────────
window.mostrarSeccion = function(nombre) {
  if (nombre === 'reportes') { setTimeout(() => initReportesDirector(), 50) }
  if (nombre === 'pagos') { setTimeout(() => { initBandejaComprobantes(document.getElementById('director-bandeja-comprobantes')); initReportesPagos() }, 50) }
  document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'))
  document.querySelectorAll('.nav-item[data-section]').forEach(b => b.classList.remove('active'))

  document.querySelector('.main-content').scrollTop = 0
  const seccion = document.getElementById(`section-${nombre}`)
  if (seccion) seccion.classList.remove('hidden')

  const btnActivo = document.querySelector(`[data-section="${nombre}"]`)
  if (btnActivo) btnActivo.classList.add('active')

  const titulos = {
    inicio: 'Inicio', estudiantes: 'Estudiantes', profesores: 'Profesores',
    cursos: 'Cursos', materias: 'Materias', asignaciones: 'Asignaciones', comunicados: 'Comunicados',
    calificaciones: 'Calificaciones', asistencias: 'Asistencias', bitacora: 'Bitácora',
    'evaluacion-docente': 'Evaluación Docente', pagos: 'Pagos y mensualidades', configuracion: 'Configuración'
  }
  document.getElementById('topbar-title').textContent = titulos[nombre] ?? nombre

  document.querySelector('.main-content')?.scrollTo(0, 0)

  const loaders = {
    estudiantes:          () => cargarEstudiantes(),
    profesores:           () => cargarProfesores(),
    cursos:               () => cargarCursos(),
    materias:             () => cargarMaterias(),
    asignaciones:         () => { cargarAsignaciones(); iniciarAsesorCursoDirector() },
    'carreras-tecnicas':  () => initCarrerasTecnicas(),
    bitacora:             () => initBitacoraDirector(),
    'evaluacion-docente': () => cargarEvalDocente(),
    configuracion:        () => iniciarConfiguracion(),
    comunicados:          () => cargarComunicadosDir()
  }
  loaders[nombre]?.()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ─── ESTADÍSTICAS INICIO ─────────────────────────────────
async function cargarEstadisticasInicio() {
  const [{ count: ce }, { count: cp }, { count: cc }] = await Promise.all([
    supabase.from('usuarios').select('*', { count:'exact', head:true }).eq('rol','estudiante').eq('activo',true).eq('colegio_id', perfil.colegio_id),
    supabase.from('usuarios').select('*', { count:'exact', head:true }).eq('rol','profesor').eq('activo',true).eq('colegio_id', perfil.colegio_id),
    supabase.from('cursos').select('*', { count:'exact', head:true }).eq('activo',true).eq('colegio_id', perfil.colegio_id)
  ])
  const elEst = document.getElementById('stat-estudiantes')
  const elProf = document.getElementById('stat-profesores')
  const elCur = document.getElementById('stat-cursos')
  const elGes = document.getElementById('stat-gestion')
  if (elEst) elEst.textContent = ce ?? 0
  if (elProf) elProf.textContent = cp ?? 0
  if (elCur) elCur.textContent = cc ?? 0
  if (elGes) elGes.textContent = Config.año
}
window.cargarEstadisticasInicio = cargarEstadisticasInicio

// ─── CURSOS EN SELECTS ───────────────────────────────────
async function cargarCursosEnSelects() {
  const { data } = await supabase.from('cursos')
    .select('id,nombre_completo,nivel')
    .eq('activo',true)
    .eq('colegio_id', perfil.colegio_id)
    .order('nivel').order('grado').order('paralelo')
  const cursos = data ?? []

  const poblar = (id, incluirTodos=false) => {
    const sel = document.getElementById(id)
    if (!sel) return
    sel.innerHTML = (incluirTodos ? '<option value="">Todos los cursos</option>' : '<option value="">Selecciona curso</option>')
      + cursos.map(c => `<option value="${c.id}">${c.nombre_completo}</option>`).join('')
  }

  poblar('filtro-curso-est', true)
  poblar('est-curso')

  // Selector de nivel (Estudiantes): filtra la lista de cursos
  const selNivel = document.getElementById('filtro-nivel-est')
  if (selNivel) {
    const niveles = [...new Set(cursos.map(c => c.nivel).filter(Boolean))]
    const previo = selNivel.value
    selNivel.innerHTML = '<option value="">Todos los niveles</option>'
      + niveles.map(n => `<option value="${n}">${n}</option>`).join('')
    selNivel.value = niveles.includes(previo) ? previo : ''
    selNivel.onchange = () => {
      const sel = document.getElementById('filtro-curso-est')
      if (!sel) return
      const lista = selNivel.value ? cursos.filter(c => c.nivel === selNivel.value) : cursos
      sel.innerHTML = '<option value="">Todos los cursos</option>'
        + lista.map(c => `<option value="${c.id}">${c.nombre_completo}</option>`).join('')
      paginaEst = 1; cargarEstudiantes()
    }
  }
  poblar('cal-curso')
  poblar('asis-curso')
  poblar('nov-curso')
  poblar('filtro-curso-asig', true)

}

async function cargarPeriodosEnSelects() {
  const opts = Config.periodos.map(p => `<option value="${p.numero}">${p.nombre}</option>`).join('')
  const sel = document.getElementById('cal-periodo')
  if (sel) sel.innerHTML = opts
  const lbl = document.getElementById('cal-periodo-label')
  if (lbl) lbl.textContent = Config.nombrePeriodo
}

// ─── ESTUDIANTES ─────────────────────────────────────────
async function cargarEstudiantes() {
  const busqueda = document.getElementById('buscar-estudiante')?.value?.trim() ?? ''
  const cursoId  = document.getElementById('filtro-curso-est')?.value ?? ''
  const offset   = (paginaEst - 1) * POR_PAGINA

  let q = supabase.from('estudiantes')
    .select(`id, carnet, rude, curso_id,
      usuarios!inner(nombre_completo, email, activo),
      cursos(nombre_completo)`, { count: 'exact' })
    .eq('colegio_id', perfil.colegio_id)
    .range(offset, offset + POR_PAGINA - 1)
    .order('usuarios(nombre_completo)', { ascending: true })

  if (cursoId) q = q.eq('curso_id', cursoId)
    if (busqueda) {
    if (/\d/.test(busqueda)) {
      q = q.ilike('carnet', `%${busqueda}%`)
    } else {
      for (const palabra of busqueda.split(/\s+/)) q = q.ilike('usuarios.nombre_completo', `%${palabra}%`)
    }
  }

  const { data, count, error } = await q
  if (error) {
    console.warn('OR query falló, usando fallback:', error.message)
    let q2 = supabase.from('estudiantes')
      .select(`id, carnet, rude, curso_id,
        usuarios!inner(nombre_completo, email, activo),
        cursos(nombre_completo)`, { count: 'exact' })
    if (cursoId) q2 = q2.eq('curso_id', cursoId)
    const { data: dataAll, error: err2 } = await q2
    if (err2) { toast('Error cargando estudiantes', 'error'); return }
    const term = busqueda.toLowerCase()
    const filtered = busqueda
      ? (dataAll ?? []).filter(e =>
          e.carnet?.toLowerCase().includes(term) ||
          e.usuarios?.nombre_completo?.toLowerCase().includes(term))
      : (dataAll ?? [])
    filtered.sort((a, b) => (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))
    _renderTablaEstudiantes(filtered, filtered.length)
    return
  }

  const dataSorted = (data ?? []).sort((a, b) =>
    (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))
  _renderTablaEstudiantes(dataSorted, count ?? 0)
}

function _renderTablaEstudiantes(data, count) {
  totalEst = count
  const tbody = document.getElementById('tabla-estudiantes')

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">👤</div><div class="empty-state-title">No hay estudiantes</div></div></td></tr>`
    return
  }

  tbody.innerHTML = data.map(e => `
    <tr>
      <td><strong>${e.usuarios?.nombre_completo ?? '-'}</strong></td>
      <td><span class="font-mono text-sm">${e.carnet}</span>${e.rude ? `<div class="font-mono text-muted" style="font-size:11px;">RUDE ${escapeHTML(e.rude)}</div>` : ''}</td>
      <td>${e.cursos?.nombre_completo ?? '—'}</td>
      <td class="text-muted text-sm">${e.usuarios?.email ?? '-'}</td>
      <td><span class="badge ${e.usuarios?.activo ? 'badge-success' : 'badge-error'}">${e.usuarios?.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="editarEstudiante('${e.id}')">Editar</button>
          <button class="btn btn-warning btn-sm" onclick="resetearContrasena('${e.id}','${e.carnet}','${(e.usuarios?.nombre_completo ?? '').replace(/'/g, "\\'")}','${e.usuarios?.email}')">Reset</button>
          <button class="btn btn-danger btn-sm" onclick="toggleEstudiante('${e.id}',${e.usuarios?.activo})">
            ${e.usuarios?.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="verLibretaEstudiante('${e.id}','${(e.usuarios?.nombre_completo ?? '').replace(/'/g, "\\'")}')"
          title="Ver libreta de calificaciones">
          📋 Libreta
        </button>
      </td>
    </tr>`).join('')

  const totalPags = Math.ceil(totalEst / POR_PAGINA)
  const pag = document.getElementById('paginacion-estudiantes')
  if (pag) {
    pag.innerHTML = totalPags > 1 ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span class="text-sm text-muted">${totalEst} estudiantes</span>
      <button class="btn btn-secondary btn-sm" ${paginaEst <= 1 ? 'disabled' : ''}
        onclick="cambiarPaginaEst(${paginaEst - 1})">‹ Anterior</button>
      ${_paginasVisibles(paginaEst, totalPags).map(p => p === '…'
        ? '<span class="text-sm text-muted" style="padding:0 2px;">…</span>'
        : `<button class="btn ${p === paginaEst ? 'btn-primary' : 'btn-secondary'} btn-sm"
            onclick="cambiarPaginaEst(${p})">${p}</button>`).join('')}
      <button class="btn btn-secondary btn-sm" ${paginaEst >= totalPags ? 'disabled' : ''}
        onclick="cambiarPaginaEst(${paginaEst + 1})">Siguiente ›</button>
    </div>` : `<span class="text-sm text-muted">${totalEst} estudiante${totalEst !== 1 ? 's' : ''}</span>`
  }
}

// Páginas a mostrar: la primera, la última y 2 a cada lado de la actual; los saltos se marcan con '…'
function _paginasVisibles(actual, total) {
  const set = new Set([1, total])
  for (let p = actual - 2; p <= actual + 2; p++) if (p >= 1 && p <= total) set.add(p)
  const orden = [...set].sort((a, b) => a - b)
  const res = []
  orden.forEach((p, i) => {
    const prev = orden[i - 1]
    if (i && p - prev === 2) res.push(prev + 1)
    else if (i && p - prev > 2) res.push('…')
    res.push(p)
  })
  return res
}

window.cargarEstudiantes = cargarEstudiantes
window.cambiarPaginaEst = (p) => { paginaEst = p; cargarEstudiantes() }

// Campo RUDE del modal: se crea junto al carnet, con el mismo estilo, sin tocar el HTML
function _campoRude() {
  let input = document.getElementById('est-rude')
  if (input) return input
  const carnet = document.getElementById('est-carnet')
  const grupo  = carnet.closest('.form-group') ?? carnet.parentElement
  const nuevo  = grupo.cloneNode(false)
  const label  = document.createElement('label')
  label.htmlFor = 'est-rude'
  label.textContent = 'Código RUDE (opcional)'
  input = document.createElement('input')
  input.type = 'text'
  input.id = 'est-rude'
  input.className = carnet.className
  input.maxLength = 30
  input.autocomplete = 'off'
  input.placeholder = 'Ej. 8197010720153543'
  nuevo.append(label, input)
  grupo.after(nuevo)
  return input
}

// Mensaje claro cuando el RUDE choca con la migración 097
function _mensajeErrorRude(msg = '') {
  if (msg.includes('estudiantes_rude_colegio_key')) return 'Ese RUDE ya pertenece a otro estudiante del colegio'
  if (msg.includes('estudiantes_rude_formato_check')) return 'RUDE inválido: solo letras y números, de 8 a 30 caracteres'
  return msg
}

window.abrirModalEstudiante = function() {
  document.getElementById('est-id').value = ''
  document.getElementById('est-nombre').value = ''
  document.getElementById('est-carnet').value = ''
  _campoRude().value = ''
  document.getElementById('est-nacimiento').value = ''
  document.getElementById('est-tutor').value = ''
  document.getElementById('est-telefono-tutor').value = ''
  document.getElementById('modal-est-titulo').textContent = 'Nuevo estudiante'
  document.getElementById('modal-estudiante').classList.remove('hidden')

  const nombreInput = document.getElementById('est-nombre')
  const carnetInput = document.getElementById('est-carnet')
  nombreInput.addEventListener('input', _actualizarEmailEstudiante)
  carnetInput.addEventListener('input', _actualizarEmailEstudiante)
}

function _actualizarEmailEstudiante() {
  const nombre  = document.getElementById('est-nombre').value
  const emailEl = document.getElementById('est-email-generado')
  if (emailEl) emailEl.textContent = nombre.trim() ? 'Se genera al guardar' : '—'
}

window.abrirImportacionEstudiantes = async function() {
  const cursoId = document.getElementById('filtro-curso-est')?.value
  if (!cursoId) { toast('Selecciona un curso en el filtro de arriba', 'warning'); return }
  mostrarWidgetImportacionEstudiantes(cursoId, perfil.colegio_id)
}

window.abrirImportacionProfesores = function() {
  mostrarWidgetImportacionProfesores(perfil.colegio_id)
}

window.editarEstudiante = async function(id) {
  const { data: e } = await supabase.from('estudiantes')
    .select('*, usuarios(nombre_completo,email)')
    .eq('id', id).single()
  if (!e) return

  document.getElementById('est-id').value = id
  document.getElementById('est-nombre').value = e.usuarios?.nombre_completo ?? ''
  document.getElementById('est-carnet').value = e.carnet
  _campoRude().value = e.rude ?? ''
    document.getElementById('est-curso').value = e.curso_id ?? ''
  document.getElementById('est-curso').dataset.cursoOriginal = e.curso_id ?? ''
  document.getElementById('est-nacimiento').value = e.fecha_nacimiento ?? ''
  document.getElementById('est-tutor').value = e.nombre_tutor ?? ''
  document.getElementById('est-telefono-tutor').value = e.telefono_tutor ?? ''
  const emailEl = document.getElementById('est-email-generado')
  if (emailEl) emailEl.textContent = e.usuarios?.email ?? '—'
  document.getElementById('modal-est-titulo').textContent = 'Editar estudiante'
  document.getElementById('modal-estudiante').classList.remove('hidden')
}

window.guardarEstudiante = async function() {
  const id      = document.getElementById('est-id').value
  const nombre  = document.getElementById('est-nombre').value.trim().replace(/[’‘`´]/g, "'")
  const carnet  = document.getElementById('est-carnet').value.trim()
  const cursoId = document.getElementById('est-curso').value
  const rude    = _campoRude().value.trim().toUpperCase()

  if (!nombre || !carnet || !cursoId) { toast('Completa los campos obligatorios', 'warning'); return }
  if (rude && !/^[A-Za-z0-9]{8,30}$/.test(rude)) {
    toast('RUDE inválido: solo letras y números, de 8 a 30 caracteres', 'warning'); return
  }
  const resNombreEst = validarNombre(nombre)
  if (!resNombreEst.valido) { toast(resNombreEst.mensaje, 'warning'); return }

  const _tutorNombre = document.getElementById('est-tutor').value.trim()
  if (_tutorNombre) {
    const resTutor = validarNombre(_tutorNombre)
    if (!resTutor.valido) { toast('Tutor: ' + resTutor.mensaje, 'warning'); return }
  }
    const _tutorTel = document.getElementById('est-telefono-tutor').value.trim()
  if (_tutorTel) {
    const resTel = validarTelefono(_tutorTel)
    if (!resTel.valido) { toast('Teléfono del tutor: ' + resTel.mensaje, 'warning'); return }
  }

  // Confirmación solo si se edita un estudiante existente y se cambia el curso
  const selCurso = document.getElementById('est-curso')
  const cursoOriginal = selCurso.dataset.cursoOriginal ?? ''
  if (id && cursoOriginal && cursoOriginal !== cursoId) {
    const nomCurso = v => [...selCurso.options].find(o => o.value === v)?.textContent?.trim() ?? '—'
    const ok = await confirmar(
      'Cambiar de curso',
      `¿Trasladar a ${nombre} de ${nomCurso(cursoOriginal)} a ${nomCurso(cursoId)}? Sus notas anteriores se conservan y el profesor del curso nuevo las verá en su promedio.`
    )
    if (!ok) return
  }

  mostrarLoader('Guardando estudiante...')
  try {
    if (!id) {
      const { data: resp, error: fnErr } = await supabase.functions.invoke('crear-estudiantes-masivo', {
        body: {
          estudiantes: [{
            nombre, carnet, curso_id: cursoId, rude: rude || null,
            nombre_tutor:     document.getElementById('est-tutor').value || null,
            telefono_tutor:   document.getElementById('est-telefono-tutor').value || null,
            fecha_nacimiento: document.getElementById('est-nacimiento').value || null
          }],
          colegio_id: perfil.colegio_id
        }
      })
      if (fnErr) throw fnErr
      if (resp?.errores?.length > 0) throw new Error(_mensajeErrorRude(resp.errores[0].reason))
      toast('Estudiante creado correctamente', 'success')
    } else {
      // Primero estudiantes: si el RUDE está repetido, no se cambia nada
      const { error: estErr } = await supabase.from('estudiantes').update({
        carnet, curso_id: cursoId, rude: rude || null,
        nombre_tutor:     document.getElementById('est-tutor').value || null,
        telefono_tutor:   document.getElementById('est-telefono-tutor').value || null,
        fecha_nacimiento: document.getElementById('est-nacimiento').value || null
      }).eq('id', id)
      if (estErr) throw new Error(_mensajeErrorRude(estErr.message))
      await supabase.from('usuarios').update({ nombre_completo: nombre }).eq('id', id)
      toast('Estudiante actualizado', 'success')
    }
    document.getElementById('modal-estudiante').classList.add('hidden')
    cargarEstudiantes()
  } catch (e) {
    toast(e.message ?? 'Error guardando estudiante', 'error')
  } finally { ocultarLoader() }
}

window.toggleEstudiante = async function(id, activo) {
  if (!await confirmar(activo ? 'Desactivar estudiante' : 'Activar estudiante',
    `¿Confirmas ${activo ? 'desactivar' : 'activar'} este estudiante?`)) return
  await supabase.from('usuarios').update({ activo: !activo }).eq('id', id)
  toast(`Estudiante ${activo ? 'desactivado' : 'activado'}`, 'success')
  cargarEstudiantes()
}

// ─── PROFESORES ──────────────────────────────────────────
async function cargarProfesores() {
  const [{ data, error }, { data: asigs }] = await Promise.all([
    supabase.from('usuarios')
      .select('id, nombre_completo, email, activo')
      .eq('rol', 'profesor')
      .order('nombre_completo'),
    supabase.from('asignaciones_profesor')
      .select('profesor_id, materia:materias(nombre), curso:cursos(nombre_completo)')
      .eq('activo', true)
  ])

  const asigMap = {}
  ;(asigs ?? []).forEach(a => {
    if (!asigMap[a.profesor_id]) asigMap[a.profesor_id] = []
    asigMap[a.profesor_id].push(a)
  })

  const dataFinal = (data ?? []).map(p => ({
    ...p,
    asignaciones_profesor: asigMap[p.id] ?? []
  }))
  const tbody = document.getElementById('tabla-profesores')
  if (!dataFinal?.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">👨‍🏫</div><div class="empty-state-title">No hay profesores registrados</div></div></td></tr>`
    return
  }
  tbody.innerHTML = dataFinal.map(p => {
    const asigs  = p.asignaciones_profesor ?? []
    const porMateria = {}
    asigs.forEach(a => {
      const nombreCurso = a.curso?.nombre_completo ?? ''
      const nivel = (nombreCurso.match(/^\d+°\s*(\S+)/) ?? [])[1] ?? ''
      const m = `${a.materia?.nombre ?? '—'}${nivel ? ' · ' + nivel : ''}`
      const c = nombreCurso.replace(/^(\d+)°\s*\S+\s*/, '$1°')
      ;(porMateria[m] ??= []).push(c)
    })
    const resumen = asigs.length
      ? Object.entries(porMateria).map(([m, cs]) =>
          `<div style="margin-bottom:2px;"><b>${m}:</b> ${cs.sort().join(', ')}</div>`).join('')
      : '—'
    return `<tr>
      <td><strong>${p.nombre_completo}</strong></td>
      <td class="text-muted text-sm">${p.email}</td>
      <td class="text-sm">${resumen}</td>
      <td><span class="badge ${p.activo?'badge-success':'badge-error'}">${p.activo?'Activo':'Inactivo'}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="editarProfesor('${p.id}')">Editar</button>
          <button class="btn btn-warning btn-sm" onclick="resetearContrasenaProfesor('${p.id}','${(p.nombre_completo ?? '').replace(/'/g, "\\'")}','${p.email}')">Reset</button>
                              <button class="btn btn-danger btn-sm" onclick="toggleProfesor('${p.id}',${p.activo})">
            ${p.activo?'Desactivar':'Activar'}
          </button>
        </div>
      </td>
    </tr>`
  }).join('')
}

let _ultimoEmailProfAuto = ''

// El importador de profesores la llama al terminar para refrescar la lista sin recargar la página
window.cargarProfesores = cargarProfesores

window.abrirModalProfesor = function() {
  document.getElementById('prof-id').value = ''
  document.getElementById('prof-nombre').value = ''
  document.getElementById('prof-email').value = ''
  document.getElementById('prof-password').value = ''
  document.getElementById('prof-telefono').value = ''
  document.getElementById('modal-prof-titulo').textContent = 'Nuevo profesor'
  document.getElementById('modal-profesor').classList.remove('hidden')

  _ultimoEmailProfAuto = ''
  const nombreInput = document.getElementById('prof-nombre')
  const emailInput  = document.getElementById('prof-email')
  nombreInput.addEventListener('input', autocompletarEmailProfesor)
  emailInput.addEventListener('input', function handler() {
    if (emailInput.value !== _ultimoEmailProfAuto) {
      nombreInput.removeEventListener('input', autocompletarEmailProfesor)
      emailInput.removeEventListener('input', handler)
    }
  })
}

function generarEmailEstudiante(nombreCompleto) {
  if (!nombreCompleto) return ''
  const partes   = nombreCompleto.trim().split(/\s+/)
  const apellidos = partes.slice(0, 2)
  const nombres   = partes.slice(2)
  const initAp  = apellidos.map(p => (p[0] || '').toLowerCase()).join('')
  const initNom = nombres.map(p => (p[0] || '').toLowerCase()).join('')
  return `${initAp}${initNom}@educativa.com`
}

function generarEmailProfesor(nombreCompleto) {
  if (!nombreCompleto) return ''
  // Quitar acentos y ñ → n, etc.
  const sinAcentos = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const partes    = nombreCompleto.trim().split(/\s+/)
  const apellidos = partes.slice(0, 2)
  const nombres   = partes.slice(2)
  const initAp  = apellidos.map(p => sinAcentos(p[0] || '').toLowerCase()).join('')
  const initNom = nombres.map(p => sinAcentos(p[0] || '').toLowerCase()).join('')
  if (!initAp && !initNom) return ''
  return `${initAp}${initNom}.prof@educativa.com`
}

let _avisoSinDominioMostrado = false

async function resolverEmailProfesorLibre(nombreCompleto) {
  if (!nombreCompleto || !nombreCompleto.trim()) return ''
  const { data, error } = await supabase.rpc('generar_email_profesor', { p_nombre: nombreCompleto })
  if (error) {
    // Avisa una sola vez (esta función corre en cada tecla)
    if (!_avisoSinDominioMostrado) {
      toast(error.message, 'warning')
      _avisoSinDominioMostrado = true
    }
    return ''
  }
  return data ?? ''
}

async function autocompletarEmailProfesor() {
  const nombre = document.getElementById('prof-nombre').value
  const email = await resolverEmailProfesorLibre(nombre)
  _ultimoEmailProfAuto = email
  const emailInput = document.getElementById('prof-email')
  if (emailInput) emailInput.value = email
}

window.editarProfesor = async function(id) {
  const { data: p } = await supabase.from('usuarios').select('*').eq('id',id).single()
  if (!p) return
  document.getElementById('prof-id').value = id
  document.getElementById('prof-nombre').value = p.nombre_completo
  document.getElementById('prof-email').value = p.email
  document.getElementById('prof-password').value = ''
  document.getElementById('prof-telefono').value = p.telefono ?? ''
  document.getElementById('modal-prof-titulo').textContent = 'Editar profesor'
  document.getElementById('modal-profesor').classList.remove('hidden')
}

window.guardarProfesor = async function() {
  const id       = document.getElementById('prof-id').value
  const nombre   = document.getElementById('prof-nombre').value.trim().replace(/[’‘`´]/g, "'")
  const email    = document.getElementById('prof-email').value.trim()
  const password = document.getElementById('prof-password').value
  const tel      = document.getElementById('prof-telefono').value.trim()

  if (!nombre || !email) { toast('Nombre y email son obligatorios', 'warning'); return }
  if (!id && !password)  { toast('La contraseña es obligatoria', 'warning'); return }

  // Validaciones de formato (la base también las exige)
  const resNombre = validarNombre(nombre)
  if (!resNombre.valido) { toast(resNombre.mensaje, 'warning'); return }
  const resTel = validarTelefono(tel)
  if (!resTel.valido) { toast(resTel.mensaje, 'warning'); return }
  const telFinal = resTel.limpio || null

  // Nuevo profesor: avisar si ya hay uno con el mismo nombre en este colegio (sin tildes ni mayúsculas)
  if (!id) {
    // Mismas palabras en cualquier orden = mismo nombre ("JUAN DAVID USCAMAYTA RAMOS" = "USCAMAYTA RAMOS JUAN DAVID")
    const clave = (n) => String(n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ')
    const { data: ya } = await supabase.from('usuarios').select('nombre_completo, email')
      .eq('colegio_id', perfil.colegio_id).eq('rol', 'profesor')
    const igual = (ya ?? []).find(u => clave(u.nombre_completo) === clave(nombre))
    if (igual && !await confirmar('Profesor con el mismo nombre',
      `Ya existe ${igual.nombre_completo} (${igual.email ?? 'sin correo'}) en el colegio. ¿Es otra persona con el mismo nombre?`,
      'Sí, es otra persona', 'Cancelar')) return
  }

  mostrarLoader('Guardando profesor...')
  try {
    if (!id) {
      const clienteTemp = crearClienteTemporal()
      const { data: su, error: suErr } = await clienteTemp.auth.signUp({
        email, password,
        options: { data: { nombre_completo: nombre } }
      })
      if (suErr) throw suErr
      await new Promise(r => setTimeout(r, 1000))

      // Asigna el rol de profesor. Si falla, reintenta hasta 3 veces.
      let rolErr = null
      for (let intento = 1; intento <= 3; intento++) {
        const { error } = await supabase.rpc('asignar_rol_privilegiado', {
          p_usuario_id: su.user.id,
          p_rol: 'profesor'
        })
        rolErr = error
        if (!error) break
        if (/permis/i.test(error.message)) break   // un error de permisos no se arregla reintentando
        if (intento < 3) await new Promise(r => setTimeout(r, intento * 1000))
      }
      // Si tras los intentos sigue fallando: ERROR rojo, nunca "creado correctamente"
      if (rolErr) throw new Error('El usuario se creó, pero no se pudo asignar el rol de profesor: ' + rolErr.message)

      await supabase.from('usuarios').update({ telefono: telFinal }).eq('id', su.user.id)
      toast('Profesor creado correctamente', 'success')
    } else {
      await supabase.from('usuarios').update({ nombre_completo: nombre, telefono: telFinal }).eq('id', id)
      toast('Profesor actualizado', 'success')
    }
    document.getElementById('modal-profesor').classList.add('hidden')
    cargarProfesores()
  } catch(e) {
    const msg = String(e.message ?? '')
    if (msg.includes('Database error saving new user')) {
      toast('No se pudo crear el usuario. Revisa que el nombre solo tenga letras y que el correo no esté en uso.', 'error')
    } else {
      toast(msg || 'Error guardando profesor', 'error')
    }
  }
  finally { ocultarLoader() }
}


window.toggleProfesor = async function(id, activo) {
  if (!await confirmar('Cambiar estado', `¿${activo?'Desactivar':'Activar'} este profesor?`)) return
  await supabase.from('usuarios').update({ activo: !activo }).eq('id', id)
  toast(`Profesor ${activo?'desactivado':'activado'}`, 'success')
  cargarProfesores()
}

// Mostrar / ocultar contraseña del modal Nuevo/Editar profesor
window.togglePasswordProf = function() {
  const input = document.getElementById('prof-password')
  const btn   = document.getElementById('btn-toggle-pass-prof')
  if (!input || !btn) return
  if (input.type === 'password') {
    input.type = 'text'
    btn.textContent = '🙈'
    btn.title = 'Ocultar contraseña'
  } else {
    input.type = 'password'
    btn.textContent = '👁️'
    btn.title = 'Mostrar contraseña'
  }
}

// ─── CURSOS ──────────────────────────────────────────────
async function cargarCursos() {
  const nivel = document.getElementById('filtro-nivel-curso')?.value ?? ''
  let q = supabase.from('cursos').select('id,nombre_completo,nivel,grado,paralelo,activo,tutor_profesor_id,estudiantes(count),tutor:usuarios!cursos_tutor_profesor_id_fkey(nombre_completo)')
  if (nivel) q = q.eq('nivel', nivel)
  const { data } = await q.order('nivel').order('grado').order('paralelo')

  const tbody = document.getElementById('tabla-cursos')
  tbody.innerHTML = (data ?? []).map(c => `<tr>
    <td><strong>${c.nombre_completo}</strong></td>
    <td>${c.nivel}</td>
    <td>${c.grado}°</td>
    <td>${c.paralelo}</td>
    <td>${c.estudiantes?.[0]?.count ?? 0}</td>
    <td><span class="badge ${c.activo?'badge-success':'badge-error'}">${c.activo?'Activo':'Inactivo'}</span></td>
    <td>${c.tutor?.nombre_completo ?? '<span style="color:var(--color-text-3)">Sin tutor</span>'}</td>
    <td style="display:flex;gap:6px;">
      <button class=\"btn btn-secondary btn-sm\" onclick=\"asignarTutorCurso('${c.id}')\">Tutor</button>
      <button class=\"btn btn-danger btn-sm\" onclick=\"toggleCurso('${c.id}',${c.activo})\">
        ${c.activo?'Desactivar':'Activar'}
      </button>
    </td>
  </tr>`).join('')
}

window.abrirModalCurso = function() {
  document.getElementById('modal-curso').classList.remove('hidden')
}

window.guardarCurso = async function() {
  const nivel    = document.getElementById('curso-nivel').value
  const grado    = parseInt(document.getElementById('curso-grado').value)
  const paralelo = document.getElementById('curso-paralelo').value.trim().toUpperCase()
  if (!paralelo) { toast('Ingresa el paralelo', 'warning'); return }

  const { error } = await supabase.from('cursos').insert({ nivel, grado, paralelo, colegio_id: perfil.colegio_id })
  if (error) { toast(error.message?.includes('unique') ? 'Ese curso ya existe' : error.message, 'error'); return }
  toast('Curso creado', 'success')
  document.getElementById('modal-curso').classList.add('hidden')
  cargarCursos()
  cargarCursosEnSelects()
}

window.toggleCurso = async function(id, activo) {
  if (!await confirmar('Cambiar estado', `¿${activo?'Desactivar':'Activar'} este curso?`)) return
  await supabase.from('cursos').update({ activo: !activo }).eq('id', id)
  toast('Estado actualizado', 'success'); cargarCursos()
}

// ─── MATERIAS ─────────────────────────────────────────────
async function cargarMaterias() {
  const nivel = document.getElementById('filtro-nivel-materia')?.value ?? ''
  let q = supabase.from('materias').select('*').order('nivel').order('nombre')
  if (nivel) q = q.eq('nivel', nivel)
  const { data } = await q

  const tbody = document.getElementById('tabla-materias')
  tbody.innerHTML = (data ?? []).map(m => `<tr>
    <td><strong>${m.nombre}</strong></td>
    <td>${m.nivel}</td>
    <td class="text-sm text-muted">${m.campo_saberes ?? '—'}</td>
    <td>${m.es_tecnica ? '<span class="badge badge-info">Técnica</span>' : '—'}</td>
    <td><span class="badge ${m.activo?'badge-success':'badge-error'}">${m.activo?'Activa':'Inactiva'}</span></td>
    <td>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-sm" onclick="editarMateria('${m.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="toggleMateria('${m.id}',${m.activo})">
          ${m.activo?'Desactivar':'Activar'}
        </button>
      </div>
    </td>
  </tr>`).join('')
}

window.abrirModalMateria = function() {
  document.getElementById('mat-id').value = ''
  document.getElementById('mat-nombre').value = ''
  document.getElementById('mat-tecnica').checked = false
  document.getElementById('mat-aplica-grupo').style.display = 'none'
  document.getElementById('modal-mat-titulo').textContent = 'Nueva materia'
  document.getElementById('modal-materia').classList.remove('hidden')
}

window.editarMateria = async function(id) {
  const { data: m } = await supabase.from('materias').select('*').eq('id',id).single()
  if (!m) return
  document.getElementById('mat-id').value = id
  document.getElementById('mat-nombre').value = m.nombre
  document.getElementById('mat-nivel').value = m.nivel
  document.getElementById('mat-campo').value = m.campo_saberes ?? ''
  document.getElementById('mat-tecnica').checked = m.es_tecnica
  document.getElementById('mat-aplica-grupo').style.display = m.es_tecnica ? 'block' : 'none'
  document.getElementById('mat-aplica').value = m.aplica_desde ?? '4to'
  document.getElementById('modal-mat-titulo').textContent = 'Editar materia'
  document.getElementById('modal-materia').classList.remove('hidden')
}

window.guardarMateria = async function() {
  const id      = document.getElementById('mat-id').value
  const nombre  = document.getElementById('mat-nombre').value.trim()
  const nivel   = document.getElementById('mat-nivel').value
  const campo   = document.getElementById('mat-campo').value
  const tecnica = document.getElementById('mat-tecnica').checked
  const aplica  = tecnica ? document.getElementById('mat-aplica').value : null
  if (!nombre || !campo) { toast('Completa los campos obligatorios', 'warning'); return }

  const payload = { nombre, nivel, campo_saberes: campo, es_tecnica: tecnica, aplica_desde: aplica, colegio_id: perfil.colegio_id }
  const { error } = id
    ? await supabase.from('materias').update(payload).eq('id', id)
    : await supabase.from('materias').insert(payload)

  if (error) { toast(error.message, 'error'); return }
  toast(id ? 'Materia actualizada' : 'Materia creada', 'success')
  document.getElementById('modal-materia').classList.add('hidden')
  cargarMaterias()
}

window.toggleMateria = async function(id, activo) {
  if (!await confirmar('Cambiar estado', `¿${activo?'Desactivar':'Activar'} esta materia?`)) return
  await supabase.from('materias').update({ activo: !activo }).eq('id', id)
  toast('Estado actualizado', 'success'); cargarMaterias()
}

// ─── ASIGNACIONES ────────────────────────────────────────
async function cargarAsignaciones() {
  const profId  = document.getElementById('filtro-prof-asig')?.value ?? ''
  const cursoId = document.getElementById('filtro-curso-asig')?.value ?? ''

  const selProf = document.getElementById('filtro-prof-asig')
  if (selProf && selProf.options.length <= 1) {
    const { data: profs } = await supabase.from('usuarios')
      .select('id,nombre_completo').eq('rol','profesor').eq('activo',true).order('nombre_completo')
    selProf.innerHTML = '<option value="">Todos los profesores</option>'
      + (profs??[]).map(p=>`<option value="${p.id}">${p.nombre_completo}</option>`).join('')
    document.getElementById('asig-profesor').innerHTML = '<option value="">Selecciona profesor</option>'
      + (profs??[]).map(p=>`<option value="${p.id}">${p.nombre_completo}</option>`).join('')
  }

  let q = supabase.from('asignaciones_profesor')
    .select('id, activo, profesor:usuarios(nombre_completo), materia:materias(nombre), curso:cursos(nombre_completo)')
    .order('activo', {ascending:false})
  if (profId)  q = q.eq('profesor_id', profId)
  if (cursoId) q = q.eq('curso_id', cursoId)

  const { data } = await q
  document.getElementById('total-asignaciones').textContent = `${data?.length ?? 0} asignaciones`

  const tbody = document.getElementById('tabla-asignaciones')
  tbody.innerHTML = (data??[]).map(a => `<tr>
    <td><strong>${a.profesor?.nombre_completo ?? '—'}</strong></td>
    <td>${a.materia?.nombre ?? '—'}</td>
    <td>${a.curso?.nombre_completo ?? '—'}</td>
    <td><span class="badge ${a.activo?'badge-success':'badge-error'}">${a.activo?'Activa':'Inactiva'}</span></td>
    <td>
      <button class="btn btn-danger btn-sm" onclick="eliminarAsignacion('${a.id}')">Eliminar</button>
    </td>
  </tr>`).join('')
}

// ─── NUEVA ASIGNACIÓN MÚLTIPLE (por nivel) ───────────────
// Flujo: nivel → profesor → cursos (casillas) → materias (casillas) → resumen → confirmar.
// Crea una fila profesor × curso × materia por cada combinación marcada (igual que antes, pero en lote).
const _asig = { nivel: null, cursos: [], materias: [], existentes: new Set() }

window.abrirModalAsignacion = function() {
  _asig.nivel = null
  document.querySelectorAll('#asig-niveles [data-nivel]').forEach(b => b.className = 'btn btn-secondary')
  document.getElementById('asig-pasos').style.display = 'none'
  document.getElementById('asig-btn-guardar').disabled = true
  document.getElementById('modal-asignacion').classList.remove('hidden')
}

window.asigElegirNivel = async function(nivel) {
  _asig.nivel = nivel
  document.querySelectorAll('#asig-niveles [data-nivel]').forEach(b =>
    b.className = 'btn ' + (b.dataset.nivel === nivel ? 'btn-primary' : 'btn-secondary'))
  const [{ data: cursos }, { data: mats }] = await Promise.all([
    supabase.from('cursos').select('id, nombre_completo, grado, paralelo')
      .eq('colegio_id', perfil.colegio_id).eq('activo', true).eq('nivel', nivel)
      .order('grado').order('paralelo'),
    supabase.from('materias').select('id, nombre, es_tecnica')
      .eq('colegio_id', perfil.colegio_id).eq('activo', true).in('nivel', [nivel, 'Ambos'])
      .order('nombre'),
  ])
  _asig.cursos = cursos ?? []
  _asig.materias = (mats ?? []).filter(m => !m.es_tecnica)
  const tecnicas = (mats ?? []).filter(m => m.es_tecnica)
  const casilla = (grupo, id, texto) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin:0;">
      <input type="checkbox" data-grupo="${grupo}" value="${id}" onchange="asigResumen()" style="width:auto;"> ${escapeHTML(texto)}</label>`
  document.getElementById('asig-cursos').innerHTML = _asig.cursos.length
    ? _asig.cursos.map(c => casilla('curso', c.id, c.nombre_completo)).join('')
    : '<span class="text-sm text-muted">No hay cursos activos en este nivel.</span>'
  document.getElementById('asig-materias').innerHTML = _asig.materias.length
    ? _asig.materias.map(m => casilla('materia', m.id, m.nombre)).join('')
    : '<span class="text-sm text-muted">No hay materias activas en este nivel.</span>'
  document.getElementById('asig-materias-tec').innerHTML = tecnicas.length
    ? `<div style="font-size:12px;color:var(--color-text-3);margin-bottom:4px;">Carreras técnicas (se asignan aparte: reúnen a los estudiantes inscritos de varios paralelos)</div>
       <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 10px;">${tecnicas.map(m => casilla('materia', m.id, m.nombre)).join('')}</div>`
    : ''
  document.getElementById('asig-pasos').style.display = ''
  asigResumen()
}

window.asigMarcarTodos = function(contId) {
  const cajas = [...document.querySelectorAll(`#${contId} input[type=checkbox]`)]
  const marcar = cajas.some(c => !c.checked)
  cajas.forEach(c => c.checked = marcar)
  asigResumen()
}

function _asigMarcados(grupo) {
  return [...document.querySelectorAll(`#modal-asignacion input[data-grupo="${grupo}"]:checked`)].map(c => c.value)
}

window.asigResumen = async function() {
  const box = document.getElementById('asig-resumen')
  const btn = document.getElementById('asig-btn-guardar')
  const profId = document.getElementById('asig-profesor').value
  const cursos = _asigMarcados('curso'), materias = _asigMarcados('materia')
  if (!profId || !cursos.length || !materias.length) {
    box.textContent = !profId ? '5. Elija el profesor.' : '5. Marque al menos un curso y una materia.'
    btn.disabled = true
    return
  }
  // Las que este profesor ya tiene se omiten (no se duplican)
  const { data: ya } = await supabase.from('asignaciones_profesor').select('curso_id, materia_id')
    .eq('profesor_id', profId).in('curso_id', cursos)
  _asig.existentes = new Set((ya ?? []).map(a => `${a.curso_id}|${a.materia_id}`))
  const total = cursos.length * materias.length
  const omitidas = cursos.reduce((n, c) => n + materias.filter(m => _asig.existentes.has(`${c}|${m}`)).length, 0)
  const nuevas = total - omitidas
  box.textContent = `5. Se crearán ${nuevas} asignación${nuevas !== 1 ? 'es' : ''} (${cursos.length} curso${cursos.length !== 1 ? 's' : ''} × ${materias.length} materia${materias.length !== 1 ? 's' : ''})`
    + (omitidas ? `. ${omitidas} ya existía${omitidas !== 1 ? 'n' : ''} y se omitirá${omitidas !== 1 ? 'n' : ''}.` : '.')
  btn.disabled = nuevas === 0
}

window.guardarAsignacion = async function() {
  const sel = document.getElementById('asig-profesor')
  const profId = sel.value
  const profNombre = sel.options[sel.selectedIndex]?.textContent?.trim() ?? ''
  const cursos = _asigMarcados('curso'), materias = _asigMarcados('materia')
  if (!_asig.nivel || !profId || !cursos.length || !materias.length) { toast('Complete nivel, profesor, cursos y materias', 'warning'); return }

  const filas = []
  for (const c of cursos) for (const m of materias)
    if (!_asig.existentes.has(`${c}|${m}`)) filas.push({ profesor_id: profId, curso_id: c, materia_id: m })
  if (!filas.length) { toast('Esas asignaciones ya existen', 'info'); return }

  const nomCurso = (id) => _asig.cursos.find(c => c.id === id)?.nombre_completo ?? ''
  const nomMat = (id) => [...document.querySelectorAll(`#modal-asignacion input[data-grupo="materia"][value="${id}"]`)][0]?.parentElement?.textContent?.trim() ?? ''
  const lista = (arr, f) => arr.length <= 3 ? arr.map(f).join(', ') : `${arr.slice(0, 3).map(f).join(', ')} y ${arr.length - 3} más`
  if (!await confirmar('Confirmar asignación',
    `¿Asignar a ${profNombre} en ${lista(cursos, nomCurso)} las materias ${lista(materias, nomMat)}? Se crearán ${filas.length} asignación${filas.length !== 1 ? 'es' : ''}.`,
    'Confirmar', 'Cancelar')) return

  mostrarLoader('Guardando asignaciones...')
  let creadas = 0, fallidas = []
  try {
    const { error } = await supabase.from('asignaciones_profesor').insert(filas)
    if (!error) creadas = filas.length
    else {
      // Si alguna choca (por ejemplo, ya asignada), se guardan una por una para no perder las demás
      for (const f of filas) {
        const { error: e1 } = await supabase.from('asignaciones_profesor').insert(f)
        if (e1) fallidas.push(`${nomCurso(f.curso_id)} · ${nomMat(f.materia_id)}`)
        else creadas++
      }
    }
  } finally { ocultarLoader() }

  const omitidas = cursos.length * materias.length - filas.length
  toast(`${creadas} asignación${creadas !== 1 ? 'es' : ''} creada${creadas !== 1 ? 's' : ''}` + (omitidas ? ` · ${omitidas} ya existía${omitidas !== 1 ? 'n' : ''}` : ''), creadas ? 'success' : 'warning', 5000)
  if (fallidas.length) toast(`No se pudieron crear: ${fallidas.slice(0, 5).join('; ')}${fallidas.length > 5 ? '…' : ''}`, 'error', 8000)
  document.getElementById('modal-asignacion').classList.add('hidden')
  cargarAsignaciones()
}

window.eliminarAsignacion = async function(id) {
  if (!await confirmar('Eliminar asignación', '¿Eliminar esta asignación? El profesor perderá acceso a esa materia/curso.')) return
  await supabase.from('asignaciones_profesor').delete().eq('id', id)
  toast('Asignación eliminada', 'success'); cargarAsignaciones()
}

// ─── CALIFICACIONES ──────────────────────────────────────
window.cargarCalificaciones = async function() {
  const cursoId   = document.getElementById('cal-curso')?.value
  const materiaId = document.getElementById('cal-materia')?.value
  const periodo   = parseInt(document.getElementById('cal-periodo')?.value ?? '1')
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia', 'warning'); return }

  mostrarLoader('Cargando calificaciones...')
  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  let todosLosEst
  if (esTecnica) {
    const { data } = await supabase.from('inscripciones_tecnicas')
      .select('estudiante_id').eq('materia_id', materiaId).eq('activo', true)
      .eq('curso_id', cursoId)
    todosLosEst = (data ?? []).map(i => ({ id: i.estudiante_id }))
  } else {
    const { data } = await supabase.from('estudiantes').select('id').eq('curso_id', cursoId)
    todosLosEst = data
  }

  const estIds = (todosLosEst ?? []).map(e => e.id)
  const card = document.getElementById('card-calificaciones')
  if (!estIds.length) {
    ocultarLoader()
    card.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">Sin estudiantes en este curso</div></div>`
    return
  }

  const { data, error } = await supabase.from('notas_finales')
    .select('*')
    .eq('materia_id', materiaId)
    .eq('trimestre', periodo)
    .in('estudiante_id', estIds)
    .order('estudiante', { ascending: true })

  if (error || !data?.length) {
    card.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">Sin datos para este período</div></div>`
    ocultarLoader(); return
  }

  const dims    = Config.dimensiones
  const headers = dims.map(d => `<th>${d.nombre} (${d.peso_maximo})</th>`).join('') + '<th>Total</th><th>Estado</th>'

  card.innerHTML = `
    <div style="display:flex;justify-content:flex-end;padding:12px 16px;border-bottom:1px solid var(--color-border);gap:10px;">
      <button class="btn btn-amarillo btn-sm" onclick="window.exportarResumenNotasDir()">Exportar resumen Excel</button>
      <button class="btn btn-secondary btn-sm" onclick="window.verPromedioAnualDir()">📊 Promedio Anual</button>
      <button class="btn btn-secondary btn-sm" onclick="window.centralizadorDirPDF()" title="Boletín centralizador con los trimestres, en PDF">📄 Centralizador PDF</button>
    </div>
    <div class="table-wrapper"><table>
    <thead><tr><th>N°</th><th>Estudiante</th>${headers}</tr></thead>
    <tbody>${data.map((n, i) => {
      const total = parseFloat(n.nota_final ?? 0)
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${n.estudiante}</strong></td>
        <td title="${tituloExacto(n.promedio_hacer)}">${fmtNota(n.promedio_hacer ?? 0)}</td>
        <td title="${tituloExacto(n.promedio_saber)}">${fmtNota(n.promedio_saber ?? 0)}</td>
        <td title="${tituloExacto(n.nota_ser)}">${fmtNota(n.nota_ser ?? 0)}</td>
        <td title="${tituloExacto(n.nota_decidir)}">${fmtNota(n.nota_decidir ?? 0)}</td>
        <td title="${tituloExacto(total)}"><strong>${fmtNota(total)}</strong></td>
        <td>${(Config.bloqueada || periodo < Config.trimestreActivo)
          ? (notaOficial(total) >= Config.notaMinima
              ? `<span class="badge badge-success">${Config.etiqAprobado}</span>`
              : `<span class="badge badge-error">${Config.etiqReprobado}</span>`)
          : '<span class="badge badge-warning">En curso</span>'}</td>
      </tr>`
    }).join('')}</tbody>
  </table></div>`
  ocultarLoader()
}

window.verPromedioAnualDir = async function() {
  const cursoId   = document.getElementById('cal-curso')?.value
  const materiaId = document.getElementById('cal-materia')?.value
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia', 'warning'); return }

  const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
  const esTecnica = materiaInfo?.es_tecnica === true

  let estudiantes
  if (esTecnica) {
    const { data } = await supabase.from('inscripciones_tecnicas')
      .select('estudiante_id, estudiantes(id, usuarios(nombre_completo))')
      .eq('materia_id', materiaId).eq('activo', true)
      .eq('curso_id', cursoId)
    estudiantes = (data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios }))
  } else {
    const { data } = await supabase.from('estudiantes')
      .select('id, usuarios(nombre_completo)')
      .eq('curso_id', cursoId)
    estudiantes = data
  }

  if (!estudiantes?.length) { toast('Sin estudiantes para este filtro', 'warning'); return }

  const sorted = (estudiantes ?? []).sort((a, b) =>
    (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

  mostrarLoader('Calculando promedio anual...')

  const idsEstudiantes = sorted.map(e => e.id)
  const lote = await calcularPromedioAnualLote(idsEstudiantes, [materiaId])
  const filas = sorted.map((e, i) => {
    const m = lote[e.id]?.[0]
    if (!m) return ''
    const aprobado = (m.promedio ?? 0) >= (Config.notaMinima ?? 51)
    const colorProm = aprobado ? '#065f46' : '#991b1b'
        const badgeClass = m.estado === 'En curso' ? 'badge-warning' : (aprobado ? 'badge-success' : 'badge-error')
    return `<tr>
      <td style="padding:8px;font-size:13px;">${i+1}</td>
      <td style="padding:8px;font-weight:500;font-size:13px;">${e.usuarios?.nombre_completo ?? '—'}</td>
      <td style="padding:8px;text-align:center;" title="${tituloExacto(m.t1)}">${fmtNota(m.t1)}</td>
      <td style="padding:8px;text-align:center;" title="${tituloExacto(m.t2)}">${fmtNota(m.t2)}</td>
      <td style="padding:8px;text-align:center;" title="${tituloExacto(m.t3)}">${fmtNota(m.t3)}</td>
      <td style="padding:8px;text-align:center;font-weight:700;color:${colorProm};" title="${tituloExacto(m.promedioExacto)}">
        ${fmtNota(m.promedio)}
      </td>
      <td style="padding:8px;text-align:center;">
        <span class="badge ${badgeClass}">${m.estado}</span>
      </td>
    </tr>`
  })

  ocultarLoader()

  const card = document.getElementById('card-calificaciones')
  card.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
      <strong>Promedio Anual</strong>
      <button class="btn btn-secondary btn-sm" onclick="window.cargarCalificaciones()">← Volver</button>
    </div>
    <div class="table-wrapper">
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
        <tbody>${filas.join('')}</tbody>
      </table>
    </div>
    <div style="padding:8px 16px;font-size:11px;color:var(--color-text-3);text-align:right;">
      Promedio = (T1 + T2 + T3) ÷ trimestres con nota · Aprueba con ≥ ${Config.notaMinima} pts
    </div>`
}

window.exportarDetalleNotasDir = async function() {
  const cursoId   = document.getElementById('cal-curso')?.value
  const materiaId = document.getElementById('cal-materia')?.value
  const periodo   = parseInt(document.getElementById('cal-periodo')?.value ?? '1')
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia', 'warning'); return }
  if (typeof ExcelJS === 'undefined') { toast('La librería ExcelJS no está cargada', 'error'); return }
  mostrarLoader('Generando Excel detallado...')
  try {
    const { data: asignacion } = await supabase
      .from('asignaciones_profesor')
      .select('profesor_id, profesor:usuarios(nombre_completo)')
      .eq('curso_id', cursoId)
      .eq('materia_id', materiaId)
      .eq('activo', true)
      .maybeSingle()

    await exportarDetalleNotasExcel({
      cursoId,
      materiaId,
      periodo,
      soloCurso: true,
      profesorId: asignacion?.profesor_id ?? null,
      nombreDocente: asignacion?.profesor?.nombre_completo ?? null
    })
    toast('Excel generado correctamente', 'success')
  } catch(err) {
    toast('Error al generar Excel: ' + (err.message ?? err), 'error')
  } finally { ocultarLoader() }
}

window.exportarResumenNotasDir = async function() {
  const cursoId   = document.getElementById('cal-curso')?.value
  const materiaId = document.getElementById('cal-materia')?.value
  const periodo   = parseInt(document.getElementById('cal-periodo')?.value ?? '1')
  if (!cursoId || !materiaId) { toast('Selecciona curso y materia', 'warning'); return }
  if (typeof ExcelJS === 'undefined') { toast('La librería ExcelJS no está cargada', 'error'); return }
  mostrarLoader('Generando Excel de resumen...')
  try {
    await window.exportarNotasExcel(cursoId, materiaId, periodo)
    toast('Resumen Excel generado', 'success')
  } catch(err) {
    toast('Error al generar Excel: ' + (err.message ?? err), 'error')
  } finally { ocultarLoader() }
}

// ─── ASISTENCIAS ─────────────────────────────────────────
window.cargarAsistenciasDir = async function() {
  const cursoId = document.getElementById('asis-curso')?.value
  const ini     = document.getElementById('asis-fecha-ini')?.value
  const fin     = document.getElementById('asis-fecha-fin')?.value
  if (!cursoId || !ini || !fin) { toast('Completa todos los filtros', 'warning'); return }

  // Aviso si el rango supera 31 días (la vista sigue cargando)
  const dias = Math.round((new Date(fin + 'T12:00:00') - new Date(ini + 'T12:00:00')) / 86400000) + 1
  if (dias > 31) {
    toast('La vista en pantalla está pensada para hasta 31 días. Para rangos largos es mejor usar Exportar Excel.', 'warning')
  }

  mostrarLoader('Cargando asistencias...')

    const { data, error } = await paginar(() => supabase
    .from('asistencias_materia')
    .select('fecha, estado, estudiante_id, hora_llegada, minutos_retraso, estudiante:estudiantes(usuarios(nombre_completo)), materia:materias(nombre)')
    .eq('curso_id', cursoId)
    .gte('fecha', ini)
    .lte('fecha', fin)
    .order('fecha', { ascending: false }))

  const card = document.getElementById('card-asistencias-dir')
  if (error) {
    ocultarLoader()
    toast(error.message, 'error')
    return
  }
  if (!data?.length) {
    card.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">Sin registros en ese período</div></div>`
    ocultarLoader(); return
  }

  const prioridad = { falta: 4, licencia: 3, retraso: 2, presente: 1 }
  const porDia = {}
  for (const r of data) {
    const nombre = r.estudiante?.usuarios?.nombre_completo ?? 'Desconocido'
    const key = `${r.estudiante_id}|${r.fecha}`
    if (!porDia[key]) {
      porDia[key] = { nombre, fecha: r.fecha, estado: r.estado, detalle: [] }
    }
    porDia[key].detalle.push({
      materia: r.materia?.nombre ?? 'Materia',
      estado: r.estado,
      llegada: textoLlegada(r),   // solo marcas tomadas por QR
    })
    const p = prioridad[r.estado] ?? 0
    if (p > (prioridad[porDia[key].estado] ?? 0)) {
      porDia[key].estado = r.estado
    }
  }

  const filas = Object.values(porDia).sort((a, b) => {
    if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha)
    return a.nombre.localeCompare(b.nombre)
  })

  const totales = { presente: 0, falta: 0, retraso: 0, licencia: 0 }
  filas.forEach(f => { totales[f.estado] = (totales[f.estado] ?? 0) + 1 })

  window._asisDirDetalle = filas
  paginaAsisDir = 1
  window._asisDirTotales = totales
  _renderAsistenciasDirPagina()
  ocultarLoader()
}

function _renderAsistenciasDirPagina() {
  const filas   = window._asisDirDetalle ?? []
  const totales = window._asisDirTotales ?? { presente: 0, falta: 0, retraso: 0, licencia: 0 }
  const card    = document.getElementById('card-asistencias-dir')
  if (!card) return

  const totalPags = Math.ceil(filas.length / POR_PAGINA_ASIS) || 1
  if (paginaAsisDir > totalPags) paginaAsisDir = totalPags
  const desde = (paginaAsisDir - 1) * POR_PAGINA_ASIS

  const pagHtml = totalPags > 1
    ? `<div style="display:flex;gap:6px;align-items:center;padding:10px 16px;border-top:1px solid var(--color-border);flex-wrap:wrap;">
        <span class="text-sm text-muted">${filas.length} registros · pág. ${paginaAsisDir}/${totalPags}</span>
        ${Array.from({ length: totalPags }, (_, i) => `
          <button class="btn ${i + 1 === paginaAsisDir ? 'btn-primary' : 'btn-secondary'} btn-sm"
            onclick="cambiarPaginaAsisDir(${i + 1})">${i + 1}</button>`).join('')}
      </div>`
    : `<div style="padding:8px 16px;"><span class="text-sm text-muted">${filas.length} registro${filas.length !== 1 ? 's' : ''}</span></div>`

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 16px;border-bottom:1px solid var(--color-border);">
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px;">
        <span class="badge badge-success">P: ${totales.presente}</span>
        <span class="badge badge-error">F: ${totales.falta}</span>
        <span class="badge badge-warning">R: ${totales.retraso}</span>
        <span class="badge badge-info">L: ${totales.licencia}</span>
        <span class="text-sm text-muted">Clic en el estado para ver el desglose por materia</span>
      </div>
      <button class="btn btn-amarillo btn-sm" onclick="window.exportarAsistenciasDir()">Exportar Excel</button>
    </div>
    <div class="table-wrapper"><table>
      <thead><tr><th style="width:60px;">N°</th><th>Estudiante</th><th>Estado del día</th></tr></thead>
      <tbody>
        ${htmlFilasAsistenciaPorDia(filas, desde, POR_PAGINA_ASIS, { onClickEstado: 'window.verDetalleAsisDir' })}
      </tbody>
    </table></div>
    ${pagHtml}`
}

window.cambiarPaginaAsisDir = function(p) {
  paginaAsisDir = p
  _renderAsistenciasDirPagina()
}

window.verDetalleAsisDir = function(idx) {
  const f = window._asisDirDetalle?.[idx]
  if (!f) return
  const label = {
    presente: 'presente',
    falta:    'falta',
    retraso:  'retraso',
    licencia: 'licencia',
  }
  const lineas = f.detalle
    .map(d => `${d.materia}: ${label[d.estado] ?? d.estado}${d.llegada ? ` · ${d.llegada}` : ''}`)
    .join(' · ')
  const fechaStr = new Date(f.fecha + 'T12:00:00').toLocaleDateString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
  toast(
    `${f.nombre} — ${fechaStr}\nPrioridad del día: ${label[f.estado] ?? f.estado}\n${lineas}`,
    f.estado === 'falta' ? 'error' : f.estado === 'presente' ? 'success' : 'info'
  )
}

window.exportarAsistenciasDir = async function() {
  const cursoId = document.getElementById('asis-curso')?.value
  const ini     = document.getElementById('asis-fecha-ini')?.value
  const fin     = document.getElementById('asis-fecha-fin')?.value
  if (!cursoId || !ini || !fin) { toast('Completa los filtros primero', 'warning'); return }
  if (typeof ExcelJS === 'undefined') { toast('La librería ExcelJS no está cargada', 'error'); return }
  mostrarLoader('Generando Excel de asistencias...')
  try {
    await exportarAsistenciasExcel(cursoId, ini, fin)
    toast('Excel de asistencias generado', 'success')
  } catch(err) {
    toast('Error al generar Excel: ' + (err.message ?? err), 'error')
  } finally { ocultarLoader() }
}

// ─── NOVEDADES DE ASISTENCIA (director) ──────────────────
// Registro institucional del día: 'en_direccion' | 'no_ingreso'.
// Independiente de asistencias_materia. Una novedad por estudiante y día.
window.cambiarTabAsis = function(tab) {
  const esNov = tab === 'novedades'
  document.getElementById('asis-panel-resumen')?.classList.toggle('hidden', esNov)
  document.getElementById('asis-panel-novedades')?.classList.toggle('hidden', !esNov)
  const bR = document.getElementById('asis-tab-resumen')
  const bN = document.getElementById('asis-tab-novedades')
  if (bR) bR.className = `btn btn-sm ${esNov ? 'btn-secondary' : 'btn-primary'}`
  if (bN) bN.className = `btn btn-sm ${esNov ? 'btn-primary' : 'btn-secondary'}`
  if (esNov) {
    const f = document.getElementById('nov-fecha')
    if (f) { f.max = hoyLocalISO(); if (!f.value) f.value = hoyLocalISO() }
  }
}

window.cargarNovedadesDir = async function() {
  const cursoId = document.getElementById('nov-curso')?.value
  const fecha   = document.getElementById('nov-fecha')?.value
  if (!cursoId || !fecha) { toast('Selecciona curso y fecha', 'warning'); return }
  if (fecha > hoyLocalISO()) { toast('La fecha no puede ser futura', 'warning'); return }

  mostrarLoader('Cargando novedades...')
  try {
    const [ests, novs] = await Promise.all([
      listarEstudiantesCurso(cursoId, perfil.colegio_id),
      listarNovedades(cursoId, fecha),
    ])
    window._novDir = {
      fecha,
      filas: ests.map(e => ({ ...e, novedad: novs[e.id] ?? null })),
    }
    _renderNovedadesDir()
  } catch (err) {
    toast(mensajeErrorNovedad(err), 'error')
  } finally { ocultarLoader() }
}

function _renderNovedadesDir() {
  const card = document.getElementById('card-novedades-dir')
  const est  = window._novDir
  if (!card || !est) return
  if (!est.filas.length) {
    card.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">Este curso no tiene estudiantes activos</div></div>`
    return
  }
  const fechaStr = new Date(est.fecha + 'T12:00:00').toLocaleDateString('es-BO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 16px;border-bottom:1px solid var(--color-border);">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px;">
        <strong>${escapeHTML(fechaStr)}</strong>
        <span class="badge badge-warning" id="nov-cnt-dir"></span>
        <span class="badge badge-error" id="nov-cnt-noing"></span>
      </div>
      <span class="text-sm text-muted">Elige el tipo y pulsa Guardar. "Sin novedad" quita el registro.</span>
    </div>
    <div class="table-wrapper"><table>
      <thead><tr><th>Estudiante</th><th>Novedad</th><th>Observación</th><th></th></tr></thead>
      <tbody>
        ${est.filas.map((f, i) => `
          <tr id="nov-fila-${i}">
            <td><strong>${escapeHTML(f.nombre)}</strong></td>
            <td>
              <select id="nov-tipo-${i}" style="min-width:150px;">
                <option value="">Sin novedad</option>
                ${Object.entries(TIPOS_NOVEDAD).map(([k, v]) =>
                  `<option value="${k}" ${f.novedad?.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </td>
            <td><input type="text" id="nov-obs-${i}" maxlength="300" style="min-width:220px;"
                 placeholder="Observación (opcional)" value="${escapeHTML(f.novedad?.observaciones ?? '')}"></td>
            <td style="white-space:nowrap;display:flex;gap:6px;"><button type="button" class="btn btn-primary btn-sm" onclick="guardarNovedadDir(${i})">Guardar</button><button type="button" class="btn btn-secondary btn-sm" onclick="verHistorialNovedadesDir(${i})">Historial</button></td>
          </tr>`).join('')}
      </tbody>
    </table></div>`
  est.filas.forEach((_, i) => _pintarFilaNovedad(i))
  _actualizarResumenNovedades()
}

// Historial general de novedades de un estudiante (solo lectura, sin filtros).
window.verHistorialNovedadesDir = async function(i) {
  const est = window._novDir?.filas?.[i]
  if (!est) return
  mostrarLoader('Cargando historial...')
  let filas
  try {
    filas = await listarHistorialEstudiante(est.id)
  } catch (err) {
    ocultarLoader()
    toast(mensajeErrorNovedad(err), 'error')
    return
  }
  ocultarLoader()

  const nDir   = filas.filter(f => f.tipo === 'en_direccion').length
  const nNoIng = filas.filter(f => f.tipo === 'no_ingreso').length
  const fmt = (f) => new Date(f + 'T12:00:00').toLocaleDateString('es-BO', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const cuerpo = filas.length
    ? `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr style="text-align:left;color:var(--color-text-3,#64748b);">
          <th style="padding:6px 8px;">Fecha</th><th style="padding:6px 8px;">Novedad</th>
          <th style="padding:6px 8px;">Curso</th><th style="padding:6px 8px;">Observación</th>
        </tr></thead>
        <tbody>${filas.map(f => `
          <tr style="border-top:1px solid var(--color-border,#e2e8f0);">
            <td style="padding:8px;white-space:nowrap;">${escapeHTML(fmt(f.fecha))}</td>
            <td style="padding:8px;"><span class="badge ${f.tipo === 'no_ingreso' ? 'badge-error' : 'badge-warning'}">${escapeHTML(TIPOS_NOVEDAD[f.tipo] ?? f.tipo)}</span></td>
            <td style="padding:8px;">${escapeHTML(f.curso?.nombre_completo ?? '—')}</td>
            <td style="padding:8px;">${escapeHTML(f.observaciones ?? '—')}</td>
          </tr>`).join('')}
        </tbody></table></div>`
    : `<p style="margin:0;color:var(--color-text-3,#64748b);">Este estudiante no tiene novedades registradas.</p>`

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)', padding: '16px',
  })
  overlay.innerHTML = `
    <div style="background:var(--color-surface,#fff);color:var(--color-text,#0f172a);border-radius:16px;padding:24px;max-width:680px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 4px;font-size:1.1rem;font-weight:700;">Historial de novedades</h3>
      <p style="margin:0 0 12px;font-size:0.9rem;"><strong>${escapeHTML(est.nombre)}</strong></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <span class="badge badge-warning">En dirección: ${nDir}</span>
        <span class="badge badge-error">No ingresó: ${nNoIng}</span>
      </div>
      ${cuerpo}
      <div style="margin-top:18px;text-align:right;">
        <button type="button" id="btn-cerrar-hist-nov" class="btn btn-secondary">Cerrar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  const cerrar = () => overlay.remove()
  overlay.querySelector('#btn-cerrar-hist-nov').onclick = cerrar
  overlay.addEventListener('click', e => { if (e.target === overlay) cerrar() })
}

function _pintarFilaNovedad(i) {
  const fila = document.getElementById(`nov-fila-${i}`)
  const f = window._novDir?.filas?.[i]
  if (fila && f) fila.style.background = f.novedad ? 'var(--color-surface-2, #fffbeb)' : ''
}

function _actualizarResumenNovedades() {
  const filas = window._novDir?.filas ?? []
  const nDir   = filas.filter(f => f.novedad?.tipo === 'en_direccion').length
  const nNoIng = filas.filter(f => f.novedad?.tipo === 'no_ingreso').length
  const a = document.getElementById('nov-cnt-dir')
  const b = document.getElementById('nov-cnt-noing')
  if (a) a.textContent = `En dirección: ${nDir}`
  if (b) b.textContent = `No ingresó: ${nNoIng}`
}

window.guardarNovedadDir = async function(i) {
  const est = window._novDir?.filas?.[i]
  if (!est) return
  const fecha = window._novDir.fecha
  const tipo  = document.getElementById(`nov-tipo-${i}`)?.value ?? ''
  const obs   = document.getElementById(`nov-obs-${i}`)?.value ?? ''
  try {
    if (!tipo) {
      if (!est.novedad) { toast('Este estudiante no tiene novedad ese día', 'info'); return }
      const ok = await confirmar('Quitar novedad', `¿Quitar la novedad de ${est.nombre}?`, 'Quitar')
      if (!ok) return
      mostrarLoader('Quitando novedad...')
      await eliminarNovedad(est.id, fecha)
      est.novedad = null
      document.getElementById(`nov-obs-${i}`).value = ''
      toast('Novedad eliminada', 'success')
    } else {
      mostrarLoader('Guardando novedad...')
      await guardarNovedad({
        estudianteId:  est.id,
        cursoId:       est.curso_id,          // curso actual, traído de la BD
        colegioId:     perfil.colegio_id,
        registradoPor: perfil.id,             // siempre, también al editar
        fecha, tipo, observaciones: obs,
      })
      est.novedad = { tipo, observaciones: obs.trim() || null }
      toast('Novedad guardada', 'success')
    }
    _pintarFilaNovedad(i)
    _actualizarResumenNovedades()
  } catch (err) {
    toast(mensajeErrorNovedad(err), 'error')
  } finally { ocultarLoader() }
}

// ─── EVALUACIÓN DOCENTE ──────────────────────────────────
async function cargarEvalDocente() {
  const { data: evals } = await supabase.from('evaluaciones_docente')
    .select('*').order('año', {ascending:false})

  const evalActual = evals?.find(e => e.año === Config.año)
  const btnText = evalActual?.activa ? `Desactivar evaluación ${Config.año}` : `Activar evaluación ${Config.año}`
  const btnHandler = evalActual?.activa ? `cerrarEvaluacion('${evalActual.id}')` : `activarEvaluacion()`

  const container = document.getElementById('contenido-eval-docente')
  container.innerHTML = `
    <div class="flex-between" style="margin-bottom:20px;">
      <h2 class="card-title">Evaluaciones docentes</h2>
      <button class="btn btn-primary" onclick="${btnHandler}">${btnText}</button>
    </div>
    <div class="card" style="padding:0;">
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Año</th><th>Estado</th><th>Apertura</th><th>Cierre</th><th>Acciones</th></tr></thead>
          <tbody>${(evals??[]).map(e=>`<tr>
            <td>${e.año}</td>
            <td><span class="badge ${e.activa?'badge-success':'badge-neutral'}">${e.activa?'Activa':'Cerrada'}</span></td>
            <td class="text-sm text-muted">${e.fecha_apertura ? new Date(e.fecha_apertura).toLocaleDateString('es-BO') : '—'}</td>
            <td class="text-sm text-muted">${e.fecha_cierre ? new Date(e.fecha_cierre).toLocaleDateString('es-BO') : '—'}</td>
            <td>
              ${e.activa ? `<button class="btn btn-secondary btn-sm" onclick="cerrarEvaluacion('${e.id}')">Cerrar</button>` : ''}
              <button class="btn btn-primary btn-sm" onclick="verResultadosEval('${e.id}')">Ver resultados</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`
}

window.activarEvaluacion = async function() {
  if (!await confirmar('Activar evaluación', `¿Activar evaluación docente ${Config.año}?`)) return
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('evaluaciones_docente')
    .upsert({ año: Config.año, activa: true, activada_por: user.id, colegio_id: perfil.colegio_id }, { onConflict: 'año,colegio_id' })
  if (error) { toast(error.message, 'error'); return }
  toast('Evaluación activada', 'success'); cargarEvalDocente()
}

window.cerrarEvaluacion = async function(id) {
  if (!await confirmar('Cerrar evaluación', '¿Cerrar la evaluación?')) return
  await supabase.from('evaluaciones_docente')
    .update({ activa: false, fecha_cierre: new Date().toISOString() }).eq('id', id)
  toast('Evaluación cerrada', 'success'); cargarEvalDocente()
}

window.verResultadosEval = async function(evalId) {
  mostrarLoader('Cargando resultados...')

  const [{ data: respuestas, error: errResp }, { data: preguntas, error: errPreg }] = await Promise.all([
    supabase.from('respuestas_evaluacion')
      .select('profesor_id, profesor:usuarios(nombre_completo), respuestas')
      .eq('evaluacion_id', evalId),
    supabase.from('config_preguntas_docente')
      .select('id, texto, orden')
      .eq('año', Config.año)
      .eq('activo', true)
      .order('orden')
  ])

  ocultarLoader()
  if (errResp || errPreg) { toast('Error cargando datos', 'error'); return }
  if (!respuestas?.length) { toast('Sin respuestas registradas aún', 'info'); return }

  const profMap = {}
  for (const r of respuestas) {
    const profId = r.profesor_id
    if (!profMap[profId]) {
      profMap[profId] = { nombre: r.profesor?.nombre_completo, totalRespuestas: 0, promediosPregunta: {} }
      ;(preguntas ?? []).forEach(p => {
        profMap[profId].promediosPregunta[p.id] = { suma: 0, count: 0, promedio: 0 }
      })
    }
    profMap[profId].totalRespuestas++
    if (r.respuestas && typeof r.respuestas === 'object') {
      for (const preguntaId in r.respuestas) {
        const valor = parseInt(r.respuestas[preguntaId])
        if (profMap[profId].promediosPregunta[preguntaId]) {
          profMap[profId].promediosPregunta[preguntaId].suma += valor
          profMap[profId].promediosPregunta[preguntaId].count++
        }
      }
    }
  }

  for (const profId in profMap) {
    for (const pregId in profMap[profId].promediosPregunta) {
      const stats = profMap[profId].promediosPregunta[pregId]
      if (stats.count > 0) stats.promedio = (stats.suma / stats.count).toFixed(2)
    }
  }

  const modalHtml = `
    <div id="modal-resultados-eval" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.5);z-index:9999;overflow:auto;">
      <div style="position:relative;max-width:1000px;margin:40px auto;background:white;
        border-radius:var(--radius-lg);box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:24px;">
        <button onclick="document.getElementById('modal-resultados-eval').style.display='none'"
          style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:24px;
          cursor:pointer;color:var(--color-text-3);width:32px;height:32px;display:flex;
          align-items:center;justify-content:center;">×</button>
        <h2 class="card-title" style="margin-bottom:20px;">Resultados de evaluación docente</h2>
        <div style="background:var(--color-surface-2);padding:12px 16px;border-radius:var(--radius-md);
          margin-bottom:20px;font-size:13px;">
          Total de respuestas: <strong>${respuestas.length}</strong> |
          Profesores evaluados: <strong>${Object.keys(profMap).length}</strong>
        </div>
        ${Object.entries(profMap).map(([profId, info]) => `
          <div class="card" style="margin-bottom:16px;">
            <div style="padding-bottom:12px;border-bottom:2px solid var(--color-primary);margin-bottom:16px;">
              <h3 style="margin:0;font-size:16px;font-weight:600;color:var(--color-text);">${info.nombre}</h3>
              <div style="margin-top:8px;">
                ${(() => {
                  const promedios = Object.values(info.promediosPregunta).map(s => parseFloat(s.promedio)).filter(v => v > 0)
                  const general = promedios.length ? (promedios.reduce((a,b) => a+b, 0) / promedios.length).toFixed(2) : 0
                  const color = general >= 3.5 ? '#16a34a' : general >= 2.5 ? '#f59e0b' : '#dc2626'
                  const label = general >= 3.5 ? 'Excelente' : general >= 2.5 ? 'Bueno' : 'Necesita mejorar'
                  return '<span style="font-size:13px;font-weight:600;color:' + color + ';">Promedio general: ' + general + ' / 4 — ' + label + '</span>'
                })()}
              </div>
              <div style="font-size:12px;color:var(--color-text-3);margin-top:4px;">
                ${info.totalRespuestas} estudiante${info.totalRespuestas !== 1 ? 's' : ''} respondieron
              </div>
            </div>
            <div class="table-wrapper" style="overflow-x:auto;">
              <table style="width:100%;font-size:13px;">
                <thead>
                  <tr style="background:var(--color-surface-2);">
                    <th style="text-align:left;padding:10px;border-bottom:1px solid var(--color-border);">Pregunta</th>
                    <th style="text-align:center;padding:10px;border-bottom:1px solid var(--color-border);width:100px;">Promedio</th>
                    <th style="text-align:center;padding:10px;border-bottom:1px solid var(--color-border);width:140px;">Evaluación</th>
                  </tr>
                </thead>
                <tbody>
                  ${(preguntas ?? []).map(p => {
                    const stats = info.promediosPregunta[p.id]
                    const promedio = stats?.promedio ?? 0
                    const escalaColor = promedio >= 4 ? '#16a34a' : promedio >= 3 ? '#f59e0b' : '#dc2626'
                    const escalaLabel = promedio >= 4 ? '✓ Excelente' : promedio >= 3 ? '⚠ Bueno' : '✗ Necesita mejorar'
                    return '<tr style="border-bottom:1px solid var(--color-border);">' +
                      '<td style="padding:10px;"><span style="font-weight:500;">' + p.texto + '</span></td>' +
                      '<td style="text-align:center;padding:10px;"><span style="font-size:16px;font-weight:700;color:' + escalaColor + ';">' + promedio + '</span><div style="font-size:11px;color:var(--color-text-3);">/4</div></td>' +
                      '<td style="text-align:center;padding:10px;"><span style="display:inline-block;padding:4px 10px;border-radius:var(--radius-md);font-size:11px;font-weight:600;background:' + escalaColor + '20;color:' + escalaColor + ';">' + escalaLabel + '</span></td>' +
                      '</tr>'
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
        <div style="text-align:center;padding-top:16px;border-top:1px solid var(--color-border);">
          <button class="btn btn-secondary" onclick="document.getElementById('modal-resultados-eval').style.display='none'">
            Cerrar
          </button>
        </div>
      </div>
    </div>`

  if (!document.getElementById('modal-resultados-eval')) {
    document.body.insertAdjacentHTML('beforeend', modalHtml)
  } else {
    document.getElementById('modal-resultados-eval').outerHTML = modalHtml
  }

  document.getElementById('modal-resultados-eval').style.display = 'flex'
  document.getElementById('modal-resultados-eval').style.alignItems = 'center'
  document.getElementById('modal-resultados-eval').style.justifyContent = 'center'
}

// ─── CONFIGURACIÓN ───────────────────────────────────────
function iniciarConfiguracion() {
  document.querySelectorAll('.config-tab').forEach(btn => {
    const nuevo = btn.cloneNode(true)
    btn.parentNode.replaceChild(nuevo, btn)
  })
  document.querySelectorAll('.config-tab').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.config-tab').forEach(b => {
        b.classList.remove('btn-primary'); b.classList.add('btn-secondary')
      })
      this.classList.add('btn-primary'); this.classList.remove('btn-secondary')
      renderConfigTab(this.dataset.tab)
    })
  })
  renderConfigTab('colegio')
}

async function renderConfigTab(tab) {
  const c = document.getElementById('config-contenido')
  if (tab === 'porteria') { await window.renderConfigPorteria?.(c); return }

  if (tab === 'colegio') {
    const { data: col } = await supabase.from('colegios').select('*').eq('id', perfil.colegio_id).single()
    c.innerHTML = `<div class="card"><div class="card-title">Datos institucionales</div>
      <div class="grid-2">
        <div class="form-group"><label>Nombre del colegio *</label><input type="text" id="col-nombre" value="${col?.nombre??''}"></div>
        <div class="form-group"><label>Sigla</label><input type="text" id="col-sigla" value="${col?.sigla??''}"></div>
        <div class="form-group"><label>Dirección</label><input type="text" id="col-direccion" value="${col?.direccion??''}"></div>
        <div class="form-group"><label>Teléfono</label><input type="text" id="col-telefono" value="${col?.telefono??''}"></div>
        <div class="form-group"><label>Municipio</label><input type="text" id="col-municipio" value="${col?.municipio??''}"></div>
        <div class="form-group"><label>Departamento</label><input type="text" id="col-departamento" value="${col?.departamento??''}"></div>
        <div class="form-group"><label>Nombre del director (para PDF)</label><input type="text" id="col-director" value="${col?.director_nombre??''}"></div>
        <div class="form-group"><label>Resolución ministerial</label><input type="text" id="col-resolucion" value="${col?.resolucion_ministerial??''}"></div>
      </div>
      <div class="grid-2" style="margin-top:8px;">
        <div class="form-group"><label>Color institucional primario</label>
          <div style="display:flex;align-items:center;gap:10px;">
            <input type="color" id="col-color-primario" value="${col?.color_primario??'#4f46e5'}" style="width:44px;height:36px;padding:2px;border:1px solid var(--color-border);border-radius:8px;cursor:pointer;" oninput="document.getElementById('col-color-primario-hex').value=this.value">
            <input type="text" id="col-color-primario-hex" value="${col?.color_primario??'#4f46e5'}" placeholder="#4f46e5" style="flex:1;font-family:var(--font-mono,monospace);" oninput="document.getElementById('col-color-primario').value=this.value">
          </div>
        </div>
        <div class="form-group"><label>Color secundario</label>
          <div style="display:flex;align-items:center;gap:10px;">
            <input type="color" id="col-color-secundario" value="${col?.color_secundario??'#ffffff'}" style="width:44px;height:36px;padding:2px;border:1px solid var(--color-border);border-radius:8px;cursor:pointer;" oninput="document.getElementById('col-color-secundario-hex').value=this.value">
            <input type="text" id="col-color-secundario-hex" value="${col?.color_secundario??'#ffffff'}" placeholder="#ffffff" style="flex:1;font-family:var(--font-mono,monospace);" oninput="document.getElementById('col-color-secundario').value=this.value">
          </div>
        </div>
      </div>
            <div class="form-group" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border);">
        <label>Logo / Escudo del colegio</label>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div id="logo-preview" style="width:80px;height:80px;border-radius:12px;border:2px solid var(--color-border);overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f1f5f9;flex-shrink:0;">
            ${col?.logo_url ? `<img src="${col.logo_url}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="color:#94a3b8;font-size:11px;">Sin logo</span>`}
          </div>
          <div style="flex:1;">
            <input type="file" id="col-logo-input" accept="image/*" style="display:block;margin-bottom:8px;font-size:13px;">
            <button class="btn btn-primary btn-sm" onclick="subirLogo()">Subir logo</button>
            ${col?.logo_url ? `<button class="btn btn-danger btn-sm" onclick="eliminarLogo()">Eliminar</button>` : ''}
            <span style="font-size:11px;color:var(--color-text-3);display:block;margin-top:4px;">Formatos: JPG, PNG, SVG · Tamaño recomendado: 200x200px</span>
          </div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="guardarColegio('${col?.id??''}')">Guardar datos</button>
    </div>`
  }

  if (tab === 'gestion') {
    const { data: g } = await supabase.from('config_gestion').select('*').eq('colegio_id', perfil.colegio_id).order('año', {ascending:false})
    const gActual = (g ?? []).find(x => x.estado === 'activo')
    const trimestreActivo = gActual?.trimestre_activo ?? Config.trimestreActivo

    c.innerHTML = `<div class="card"><div class="card-title">Gestión académica activa</div>
      <div class="grid-2" style="margin-bottom:20px;">
        <div class="form-group"><label>Cantidad de períodos</label>
          <select id="cfg-periodos">${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${Config.cantidadPeriodos===n?'selected':''}>${n} ${n===1?'período':'períodos'}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Nombre del período</label>
          <input type="text" id="cfg-nombre-periodo" value="${Config.nombrePeriodo}"></div>
        <div class="form-group"><label>Nota mínima aprobación</label>
          <input type="number" id="cfg-nota-min" value="${Config.notaMinima}" min="1" max="100"></div>
        <div class="form-group"><label>Etiqueta aprobado</label>
          <input type="text" id="cfg-etiq-ap" value="${Config.etiqAprobado}"></div>
        <div class="form-group"><label>Etiqueta reprobado</label>
          <input type="text" id="cfg-etiq-rep" value="${Config.etiqReprobado}"></div>
      </div>
      <button class="btn btn-primary" onclick="guardarGestion()">Guardar configuración</button>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">📎 Entrega digital de tareas</div>
      <p class="text-sm text-muted" style="margin-bottom:16px;">
        Activa si los estudiantes deben adjuntar archivos (PDF, JPG, PNG) como entrega de actividades.
        El profesor verá las entregas en cada tarjeta de actividad.
        Desactiva cuando las clases son presenciales.
      </p>
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
        <div style="position:relative;display:inline-block;width:48px;height:26px;">
          <input type="checkbox" id="cfg-entrega-tareas"
            ${Config.permiteEntregaTareas ? 'checked' : ''}
            onchange="toggleEntregaTareas(this.checked)"
            style="opacity:0;width:0;height:0;">
          <span id="toggle-et-slider" style="
            position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;
            background:${Config.permiteEntregaTareas ? 'var(--color-primary)' : '#ccc'};
            border-radius:26px;transition:.3s;">
            <span style="
              position:absolute;height:20px;width:20px;left:${Config.permiteEntregaTareas ? '24px' : '4px'};bottom:3px;
              background:white;border-radius:50%;transition:.3s;">
            </span>
          </span>
        </div>
        <span id="label-entrega-tareas" style="font-weight:500;">
          ${Config.permiteEntregaTareas ? '✅ Entrega digital activa' : 'Entrega digital desactivada'}
        </span>
      </label>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">🏫 Carreras técnicas especializadas</div>
      <p class="text-sm text-muted" style="margin-bottom:16px;">
        Activa si el colegio ofrece especialidades técnicas (Sistemas Informáticos, Gastronomía, etc.)
        para 4to, 5to y 6to de Secundaria. Al desactivar, esos grados vuelven a llevar
        <strong>Técnica Tecnológica General</strong> como materia regular.
      </p>
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
        <div style="position:relative;display:inline-block;width:48px;height:26px;">
          <input type="checkbox" id="cfg-carreras-tecnicas"
            ${Config.usaCarrerasTecnicas ? 'checked' : ''}
            onchange="toggleCarrerasTecnicas(this.checked)"
            style="opacity:0;width:0;height:0;">
          <span id="toggle-ct-slider" style="
            position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;
            background:${Config.usaCarrerasTecnicas ? 'var(--color-primary)' : '#ccc'};
            border-radius:26px;transition:.3s;">
            <span style="
              position:absolute;content:'';height:20px;width:20px;left:${Config.usaCarrerasTecnicas ? '24px' : '4px'};bottom:3px;
              background:white;border-radius:50%;transition:.3s;">
            </span>
          </span>
        </div>
        <span id="label-carreras-tecnicas" style="font-weight:500;">
          ${Config.usaCarrerasTecnicas ? '✅ Carreras técnicas activas' : 'Carreras técnicas desactivadas'}
        </span>
      </label>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">📅 ${Config.nombrePeriodo} activo</div>
      <p class="text-sm text-muted" style="margin-bottom:16px;">
        Los profesores solo podrán crear actividades y registrar notas en el período seleccionado.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        ${Config.periodos.map(p => `
          <button
            id="btn-trimestre-${p.numero}"
            class="btn ${trimestreActivo === p.numero ? 'btn-primary' : 'btn-secondary'}"
            onclick="cambiarTrimestreActivo(${p.numero})">
            ${trimestreActivo === p.numero ? '✅ ' : ''}${p.nombre}
          </button>`).join('')}
      </div>
      <p class="text-sm" style="margin-top:12px;color:var(--color-text-muted);">
        Activo actualmente: <strong id="label-trimestre-activo">${Config.nombrePeriodo} ${trimestreActivo}</strong>
      </p>
    </div>

    <div class="card" style="margin-top:16px;"><div class="card-title">Historial de gestiones</div>
      <div class="table-wrapper"><table>
        <thead><tr><th>Año</th><th>Estado</th><th>Bloqueo</th><th>Períodos</th><th>Nota mínima</th><th>Acciones</th></tr></thead>
        <tbody>${(g??[]).map(gg=>`<tr>
          <td>${gg.año}</td>
          <td><span class="badge ${gg.estado==='activo'?'badge-success':gg.estado==='cerrado'?'badge-neutral':'badge-warning'}">${gg.estado}</span></td>
          <td><span class="badge ${gg.bloqueada?'badge-error':'badge-success'}">${gg.bloqueada?'Bloqueada':'Abierta'}</span></td>
          <td>${gg.cantidad_periodos} ${gg.nombre_periodo}s</td>
          <td>${gg.nota_minima_aprobacion}</td>
          <td>
            ${gg.estado==='activo' ? '<button class="btn btn-danger btn-sm" onclick="cerrarGestion()">Cerrar gestión</button>' : ''}
            ${gg.bloqueada ? '<button class="btn btn-warning btn-sm" onclick="desbloquearGestionDir('+gg.año+')">Desbloquear</button>' : ''}
            ${!gg.bloqueada && gg.estado==='cerrado' ? '<button class="btn btn-secondary btn-sm" onclick="bloquearGestionDir('+gg.año+')">Bloquear</button>' : ''}
          </td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`
  }

  if (tab === 'dimensiones') {
    const dims = Config.dimensiones
    c.innerHTML = `<div class="card">
      <div class="card-title">Dimensiones de evaluación — Gestión ${Config.año}</div>
      <p class="text-sm text-muted" style="margin-bottom:16px;">La suma de pesos debe ser igual a ${Config.escalaMaxima} puntos.</p>
      <div class="table-wrapper"><table>
        <thead><tr><th>Código</th><th>Nombre</th><th>Peso máximo</th><th>Tipo</th></tr></thead>
        <tbody>${dims.map(d=>`<tr>
          <td><span class="font-mono text-sm">${d.codigo}</span></td>
          <td><input type="text" value="${d.nombre}" style="width:160px;padding:6px 10px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:13px;" onchange="actualizarNombreDimension('${d.codigo}', this.value)"></td>
          <td><input type="number" value="${d.peso_maximo}" min="0" max="${Config.escalaMaxima}"
            style="width:80px;" onchange="actualizarPesoDimension('${d.codigo}', this.value)"></td>
          <td><span class="badge badge-info">${d.tipo}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
        <span class="text-sm">Total: <strong id="total-pesos">${dims.reduce((s,d)=>s+d.peso_maximo,0)}</strong> / ${Config.escalaMaxima}</span>
        <button class="btn btn-primary" onclick="guardarDimensiones()">Guardar pesos</button>
      </div>
    </div>`
  }

  if (tab === 'ser') {
    const { data: categorias } = await supabase
      .from('config_categorias_ser').select('id, nombre, orden')
      .eq('año', Config.año).eq('activo', true).order('orden')
    const { data: subcriterios } = await supabase
      .from('config_subcriterios_ser').select('id, categoria_id, texto, descripcion, activo, orden')
      .eq('año', Config.año).order('orden')
    const grupos = (categorias ?? []).map(cat => ({
      ...cat, items: (subcriterios ?? []).filter(s => s.categoria_id === cat.id)
    }))
    c.innerHTML = `<div class="card">
      <div class="card-title">Subcriterios de la Ficha SER — Gestión ${Config.año}</div>
      <p class="text-sm text-muted" style="margin-bottom:20px;">Edita el texto de cada subcriterio y activa o desactiva según corresponda.</p>
      ${grupos.map(g => `
        <div style="margin-bottom:24px;">
          <h3 style="font-size:13px;font-weight:600;color:var(--color-primary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px;">${g.nombre}</h3>
          <div class="table-wrapper"><table>
            <thead><tr><th style="width:50%;">Subcriterio</th><th>Descripción</th><th style="width:100px;text-align:center;">Activo</th></tr></thead>
            <tbody>
              ${g.items.map(s => `<tr>
                <td><input type="text" id="ser-texto-${s.id}" value="${s.texto}" style="width:100%;padding:6px 10px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:13px;"></td>
                <td><input type="text" id="ser-desc-${s.id}" value="${s.descripcion ?? ''}" placeholder="Descripción opcional..." style="width:100%;padding:6px 10px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:13px;"></td>
                <td style="text-align:center;">
                  <label style="display:inline-flex;align-items:center;cursor:pointer;">
                    <input type="checkbox" id="ser-activo-${s.id}" ${s.activo ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
                  </label>
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>`).join('')}
      <div style="margin-top:8px;padding-top:16px;border-top:1px solid var(--color-border);">
        <p class="text-sm text-muted" style="margin-bottom:8px;">Escala de valoración:</p>
        <div style="display:flex;gap:10px;margin-top:8px;margin-bottom:20px;">
          ${Config.escalaSer.map(e => `<span class="badge badge-${e.color==='green'?'success':e.color==='yellow'?'warning':'error'}">${e.etiqueta} (${e.valor})</span>`).join('')}
        </div>
        <button class="btn btn-primary" onclick="guardarSubcriteriosSer(${JSON.stringify((subcriterios??[]).map(s=>s.id))})">Guardar cambios</button>
      </div>
    </div>`
  }

  if (tab === 'preguntas-docente') {
    const { data: preguntas } = await supabase
      .from('config_preguntas_docente')
      .select('*')
      .eq('año', Config.año)
      .order('orden')

    c.innerHTML = `<div class="card">
      <div class="card-title">Preguntas de Evaluación Docente — Gestión ${Config.año}</div>
      <p class="text-sm text-muted" style="margin-bottom:16px;">
        Estas preguntas serán respondidas por los estudiantes al evaluar a sus profesores.
      </p>
      <div class="table-wrapper"><table>
        <thead><tr><th>Orden</th><th style="width:60%;">Pregunta</th><th>Escala mín</th><th>Escala máx</th><th>Activo</th></tr></thead>
        <tbody>
          ${(preguntas ?? []).map(p => `<tr>
            <td>${p.orden}</td>
            <td><input type="text" id="preg-texto-${p.id}" value="${escapeHTML(p.texto)}"
              style="width:100%;padding:6px 10px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:13px;"></td>
            <td><input type="number" id="preg-min-${p.id}" value="${p.escala_min}" min="1" max="10"
              style="width:60px;"></td>
            <td><input type="number" id="preg-max-${p.id}" value="${p.escala_max}" min="1" max="10"
              style="width:60px;"></td>
            <td style="text-align:center;">
              <input type="checkbox" id="preg-activo-${p.id}" ${p.activo ? 'checked' : ''}
                style="width:16px;height:16px;cursor:pointer;">
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border);display:flex;gap:10px;">
        <button class="btn btn-primary" onclick='guardarPreguntasDocente(${JSON.stringify((preguntas??[]).map(p=>p.id))})'>
          Guardar cambios
        </button>
        <button class="btn btn-secondary" onclick="agregarPreguntaDocente()">+ Nueva pregunta</button>
      </div>
    </div>`
  }

  if (tab === 'personal') {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre_completo, email, activo')
      .eq('rol', 'secretaria')
      .eq('colegio_id', perfil.colegio_id)
      .order('nombre_completo')

    c.innerHTML = `
      <div class="card">
        <div class="card-title">Personal administrativo</div>
        <div class="flex-start" style="margin-bottom:16px;">
          <button class="btn btn-primary" onclick="abrirModalSecretaria()">+ Nueva secretaria</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Nombre</th><th>Email</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>${(data ?? []).length ? (data ?? []).map(u => `
              <tr>
                <td><strong>${u.nombre_completo}</strong></td>
                <td class="text-muted text-sm">${u.email}</td>
                <td><span class="badge ${u.activo ? 'badge-success' : 'badge-error'}">${u.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  <div style="display:flex;gap:6px;">
                    <button class="btn btn-warning btn-sm" onclick="resetearContrasenaProfesor('${u.id}','${(u.nombre_completo ?? '').replace(/'/g, "\\'")}','${u.email}')">Reset</button>
                    <button class="btn btn-danger btn-sm" onclick="toggleSecretaria('${u.id}',${u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button>
                  </div>
                </td>
              </tr>`).join('') : '<tr><td colspan="4" class="empty-state">No hay personal registrado</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`
    return
  }

window.abrirModalSecretaria = function() {
  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position:'fixed', inset:'0', zIndex:'99999',
    display:'flex', alignItems:'center', justifyContent:'center',
    backgroundColor:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)'
  })
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 16px;font-size:1.1rem;font-weight:700;color:#0f172a;">Nueva secretaria</h3>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px;">Nombre completo *</label>
        <input id="sec-nombre" type="text" placeholder="Nombre completo"
          style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px;">Email *</label>
        <input id="sec-email" type="email" placeholder="correo@ejemplo.com"
          style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px;">Contraseña *</label>
        <input id="sec-password" type="password" placeholder="Mínimo 6 caracteres"
          style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:8px;">
        <button id="btn-guardar-sec" style="flex:1;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Guardar</button>
        <button id="btn-cancelar-sec" style="flex:1;padding:10px;background:#f1f5f9;color:#374151;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Cancelar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  document.getElementById('btn-cancelar-sec').onclick = () => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  document.getElementById('btn-guardar-sec').onclick = async () => {
    const nombre   = document.getElementById('sec-nombre').value.trim()
    const email    = document.getElementById('sec-email').value.trim()
    const password = document.getElementById('sec-password').value
    if (!nombre || !email || !password) { toast('Completa todos los campos', 'warning'); return }
    const resNombre = validarNombre(nombre)
    if (!resNombre.valido) { toast(resNombre.mensaje, 'warning'); return }
    if (password.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'warning'); return }
    overlay.remove()
    mostrarLoader('Creando secretaria...')
    try {
      const clienteTemp = crearClienteTemporal()
      const { data: su, error: suErr } = await clienteTemp.auth.signUp({
        email, password,
        options: { data: { nombre_completo: nombre } }
      })
      if (suErr) throw suErr
      await new Promise(r => setTimeout(r, 1000))
      await supabase.rpc('asignar_rol_privilegiado', {
        p_usuario_id: su.user.id,
        p_rol: 'secretaria'
      })
      toast('Secretaria creada correctamente', 'success')
      renderConfigTab('personal')
    } catch(e) {
      toast(e.message ?? 'Error creando secretaria', 'error')
    } finally { ocultarLoader() }
  }
}

window.toggleSecretaria = async function(id, activo) {
  if (!await confirmar('Cambiar estado', `¿${activo ? 'Desactivar' : 'Activar'} esta secretaria?`)) return
  await supabase.from('usuarios').update({ activo: !activo }).eq('id', id)
  toast(`Secretaria ${activo ? 'desactivada' : 'activada'}`, 'success')
  renderConfigTab('personal')
}


  if (tab === 'notificaciones') {
    const { data: plantillas } = await supabase.from('config_notificaciones').select('*')
    c.innerHTML = `<div class="card"><div class="card-title">Plantillas de notificaciones Telegram</div>
      ${(plantillas??[]).map(p=>`
        <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid var(--color-border);">
          <div class="flex-between" style="margin-bottom:8px;">
            <strong>${p.nombre_display}</strong>
            <span class="badge ${p.activo?'badge-success':'badge-neutral'}">${p.activo?'Activa':'Inactiva'}</span>
          </div>
          <textarea id="plantilla-${p.id}" rows="4" style="font-family:var(--font-mono);font-size:13px;">${p.plantilla}</textarea>
          ${p.umbral_faltas!=null?`<div style="margin-top:8px;"><label style="font-size:13px;">Umbral de faltas: <input type="number" id="umbral-${p.id}" value="${p.umbral_faltas}" style="width:60px;display:inline-block;"></label></div>`:''}
          <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="guardarPlantilla('${p.id}')">Guardar</button>
        </div>`).join('')}
      <p class="text-sm text-muted">Variables: {nombre}, {actividad_titulo}, {fecha_limite}, {max_puntos}, {nota_valor}, {faltas}, {materia}, {periodo}, {numero_periodo}, {nota_ser}, {max_ser}</p>
    </div>`
  }
}

// ─── LOGO ───────────────────────────────────────────────────────────
window.subirLogo = async function() {
  const input = document.getElementById('col-logo-input')
  const file = input?.files?.[0]
  if (!file) { toast('Selecciona una imagen', 'warning'); return }

  const ext = file.name.split('.').pop()
  const path = `${perfil.colegio_id}/logo.${ext}`

  mostrarLoader('Subiendo logo...')
  try {
    const { error: uploadErr } = await supabase.storage
      .from('logos-colegios')
      .upload(path, file, { upsert: true })

    if (uploadErr) throw uploadErr

    const { data: urlData } = supabase.storage
      .from('logos-colegios')
      .getPublicUrl(path)

    const { error: updateErr } = await supabase
      .from('colegios')
      .update({ logo_url: urlData.publicUrl })
      .eq('id', perfil.colegio_id)

    if (updateErr) throw updateErr

    toast('Logo actualizado', 'success')
    renderConfigTab('colegio')
  } catch (e) {
    toast(e.message || 'Error al subir logo', 'error')
  } finally { ocultarLoader() }
}

window.eliminarLogo = async function() {
  if (!await confirmar('Eliminar logo', '¿Eliminar el logo del colegio?')) return

  try {
    const { data: files } = await supabase.storage
      .from('logos-colegios')
      .list(perfil.colegio_id)

    if (files && files.length > 0) {
      const paths = files.map(f => `${perfil.colegio_id}/${f.name}`)
      await supabase.storage.from('logos-colegios').remove(paths)
    }

    const { error: updateErr } = await supabase
      .from('colegios')
      .update({ logo_url: null })
      .eq('id', perfil.colegio_id)

    if (updateErr) throw updateErr

    toast('Logo eliminado', 'success')
    renderConfigTab('colegio')
  } catch (e) {
    toast(e.message || 'Error al eliminar logo', 'error')
  }
}

window.guardarColegio = async function(id) {
  const _cpVal = document.getElementById('col-color-primario')?.value?.trim()
  const _csVal = document.getElementById('col-color-secundario')?.value?.trim()
  const _hexRe = /^#[0-9a-fA-F]{6}$/
  const _telVal = document.getElementById('col-telefono').value.trim()
  const _dirVal = document.getElementById('col-director').value.trim()
  if (_telVal) {
    const resTel = validarTelefono(_telVal)
    if (!resTel.valido) { toast(resTel.mensaje, 'warning'); return }
  }
  if (_dirVal) {
    const resDir = validarNombre(_dirVal)
    if (!resDir.valido) { toast(resDir.mensaje, 'warning'); return }
  }
  const payload = {
    nombre:                document.getElementById('col-nombre').value.trim(),
    sigla:                 document.getElementById('col-sigla').value.trim() || null,
    direccion:             document.getElementById('col-direccion').value.trim() || null,
    telefono:              document.getElementById('col-telefono').value.trim() || null,
    municipio:             document.getElementById('col-municipio').value.trim() || null,
    departamento:          document.getElementById('col-departamento').value.trim() || null,
    director_nombre:       document.getElementById('col-director').value.trim() || null,
    resolucion_ministerial:document.getElementById('col-resolucion').value.trim() || null,
    ...(_cpVal && _hexRe.test(_cpVal) ? { color_primario: _cpVal } : {}),
    ...(_csVal && _hexRe.test(_csVal) ? { color_secundario: _csVal } : {})
  }
  const { error } = await supabase.from('colegios').update(payload).eq('id', id)
  if (error) { toast(error.message, 'error'); return }
  document.getElementById('nombre-colegio').textContent = payload.nombre
  if (payload.color_primario) {
    document.documentElement.style.setProperty('--color-primary', payload.color_primario)
    localStorage.setItem('color_primario', payload.color_primario)
  }
  if (payload.color_secundario) {
  document.documentElement.style.setProperty('--color-secondary', payload.color_secundario)
  localStorage.setItem('color_secundario', payload.color_secundario)
}
  toast('Datos del colegio guardados', 'success')
}

window.toggleCarrerasTecnicas = async function(activo) {
  if (activo && window.APP_CONFIG?.plan !== 'avanzado') {
    toast('Carreras técnicas requiere el plan avanzado. Solicítalo al administrador.', 'warning')
    return
  }
  const { data: g } = await supabase.from('config_gestion').select('id').eq('año', Config.año).single()
  if (!g) { toast('No se encontró la gestión activa', 'error'); return }
  const { error } = await supabase.from('config_gestion')
    .update({ usa_carreras_tecnicas: activo })
    .eq('id', g.id)
  if (error) { toast(error.message, 'error'); return }
  invalidarConfigCache()
  const label  = document.getElementById('label-carreras-tecnicas')
  const slider = document.getElementById('toggle-ct-slider')
  const thumb  = slider?.querySelector('span')
  if (label)  label.textContent  = activo ? '✅ Carreras técnicas activas' : 'Carreras técnicas desactivadas'
  if (slider) slider.style.background = activo ? 'var(--color-primary)' : '#ccc'
  if (thumb)  thumb.style.left = activo ? '24px' : '4px'
  toast(activo ? 'Carreras técnicas activadas' : 'Carreras técnicas desactivadas', 'success')

  try {
    const { data: cfg } = await supabase.rpc('get_config_año', { p_año: Config.año })
    if (cfg && !cfg.error) window.APP_CONFIG = cfg
  } catch(_) {}

  actualizarNavCarrerasTecnicas(activo)
  if (activo) initCarrerasTecnicas()
}

window.toggleEntregaTareas = async function(activo) {
  if (activo && window.APP_CONFIG?.plan !== 'avanzado') {
    toast('Entrega de tareas en línea requiere el plan avanzado. Solicítalo al administrador.', 'warning')
    return
  }
  const { data: g } = await supabase.from('config_gestion').select('id').eq('año', Config.año).single()
  if (!g) { toast('No se encontró la gestión activa', 'error'); return }
  const { error } = await supabase.from('config_gestion')
    .update({ permite_entrega_tareas: activo })
    .eq('id', g.id)
  if (error) { toast(error.message, 'error'); return }
  invalidarConfigCache()
  try {
    const { data: cfg } = await supabase.rpc('get_config_año', { p_año: Config.año })
    if (cfg && !cfg.error) window.APP_CONFIG = cfg
  } catch(_) {}
  const label  = document.getElementById('label-entrega-tareas')
  const slider = document.getElementById('toggle-et-slider')
  const thumb  = slider?.querySelector('span')
  if (label)  label.textContent  = activo ? '✅ Entrega digital activa' : 'Entrega digital desactivada'
  if (slider) slider.style.background = activo ? 'var(--color-primary)' : '#ccc'
  if (thumb)  thumb.style.left = activo ? '24px' : '4px'
  toast(activo ? 'Entrega digital activada' : 'Entrega digital desactivada', 'success')
}

function actualizarNavCarrerasTecnicas(activo) {
  const navBtn = document.getElementById('nav-carreras-tecnicas')
  if (!navBtn) return
  if (activo) {
    navBtn.classList.remove('hidden')
  } else {
    navBtn.classList.add('hidden')
    if (document.getElementById('section-carreras-tecnicas')?.classList.contains('active') ||
        !document.getElementById('section-carreras-tecnicas')?.classList.contains('hidden')) {
      mostrarSeccion('inicio')
    }
  }
}

window.guardarGestion = async function() {
  const { data: g } = await supabase.from('config_gestion').select('id').eq('año', Config.año).single()
  if (!g) { toast('No se encontró la gestión activa', 'error'); return }
  const { error } = await supabase.from('config_gestion').update({
    cantidad_periodos:      parseInt(document.getElementById('cfg-periodos').value),
    nombre_periodo:         document.getElementById('cfg-nombre-periodo').value.trim(),
    nota_minima_aprobacion: parseFloat(document.getElementById('cfg-nota-min').value),
    etiqueta_aprobado:      document.getElementById('cfg-etiq-ap').value.trim(),
    etiqueta_reprobado:     document.getElementById('cfg-etiq-rep').value.trim()
  }).eq('id', g.id)
  if (error) { toast(error.message, 'error'); return }
  invalidarConfigCache()
  toast('Configuración guardada. Recarga la página para aplicar cambios.', 'success')
}

window.actualizarPesoDimension = function(codigo, valor) {
  const dim = Config.dimensiones.find(d => d.codigo === codigo)
  if (dim) dim.peso_maximo = parseFloat(valor) || 0
  const total = Config.dimensiones.reduce((s,d) => s + (d.peso_maximo||0), 0)
  const el = document.getElementById('total-pesos')
  if (el) {
    el.textContent = total
    el.style.color = Math.abs(total - Config.escalaMaxima) < 0.01 ? 'var(--color-success)' : 'var(--color-error)'
  }
}

window.guardarDimensiones = async function() {
  const { data: g } = await supabase.from('config_gestion').select('id').eq('año', Config.año).single()
  const dims  = Config.dimensiones
  const total = dims.reduce((s,d) => s + (d.peso_maximo||0), 0)
  if (Math.abs(total - Config.escalaMaxima) > 0.01) {
    toast(`La suma debe ser ${Config.escalaMaxima}. Actualmente: ${total}`, 'error'); return
  }
  for (const d of dims) {
    await supabase.from('config_dimensiones').update({ peso_maximo: d.peso_maximo, nombre_display: d.nombre })
      .eq('gestion_id', g.id).eq('codigo', d.codigo)
  }
  invalidarConfigCache()
  toast('Pesos guardados. Recarga la página para aplicar.', 'success')
}

window.guardarPlantilla = async function(id) {
  const plantilla = document.getElementById(`plantilla-${id}`)?.value
  const umbralEl  = document.getElementById(`umbral-${id}`)
  const payload   = { plantilla }
  if (umbralEl) payload.umbral_faltas = parseInt(umbralEl.value)
  await supabase.from('config_notificaciones').update(payload).eq('id', id)
  toast('Plantilla guardada', 'success')
}

window.cerrarModal = function(id) {
  document.getElementById(id)?.classList.add('hidden')
}

// ─── RESETEAR CONTRASEÑA ESTUDIANTE ──────────────────────
window.resetearContrasena = async function(id, carnet, nombre, email) {
  if (!await confirmar('Resetear contraseña', `¿Resetear la contraseña de ${nombre} al carnet (${carnet})?`)) return
  mostrarLoader('Reseteando contraseña...')
  try {
    const { data: resp, error } = await supabase.functions.invoke('reset-password', {
      body: { usuario_id: id, nueva_password: carnet }
    })
    if (error) throw error
    if (resp?.error) throw new Error(resp.error)
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position:'fixed', inset:'0', zIndex:'99999',
      display:'flex', alignItems:'center', justifyContent:'center',
      backgroundColor:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)'
    })
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
        <h3 style="margin:0 0 6px;font-size:1.1rem;font-weight:700;color:#0f172a;">✅ Contraseña reseteada</h3>
        <p style="margin:0 0 20px;font-size:0.85rem;color:#64748b;">Las nuevas credenciales del estudiante son:</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:20px;">
          <div style="margin-bottom:10px;">
            <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Usuario</span>
            <div style="font-family:monospace;font-size:14px;color:#4f46e5;font-weight:600;">${email}</div>
          </div>
          <div>
            <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Contraseña</span>
            <div style="font-family:monospace;font-size:14px;color:#4f46e5;font-weight:600;">${carnet}</div>
          </div>
        </div>
        <button id="btn-cerrar-reset" style="width:100%;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Cerrar</button>
      </div>`
    document.body.appendChild(overlay)
    document.getElementById('btn-cerrar-reset').onclick = () => overlay.remove()
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  } catch(e) {
    toast(e.message ?? 'Error reseteando contraseña', 'error')
  } finally { ocultarLoader() }
}

// ─── RESETEAR CONTRASEÑA PROFESOR ────────────────────────
window.resetearContrasenaProfesor = async function(id, nombre, email) {
  if (!await confirmar('Resetear contraseña', `¿Generar una contraseña nueva para ${nombre}? La anterior dejará de funcionar.`)) return
  const nueva = generarPasswordTemporal()
  mostrarLoader('Reseteando contraseña...')
  try {
    const { data: resp, error } = await supabase.functions.invoke('reset-password', {
      body: { usuario_id: id, nueva_password: nueva }
    })
    if (error) throw error
    if (resp?.error) throw new Error(resp.error)
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position:'fixed', inset:'0', zIndex:'99999',
      display:'flex', alignItems:'center', justifyContent:'center',
      backgroundColor:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)'
    })
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
        <h3 style="margin:0 0 6px;font-size:1.1rem;font-weight:700;color:#0f172a;">✅ Contraseña reseteada</h3>
        <p style="margin:0 0 16px;font-size:0.85rem;color:#64748b;">Credenciales temporales de <strong>${escapeHTML(nombre)}</strong>:</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:12px;">
          <div style="margin-bottom:10px;">
            <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Usuario</span>
            <div style="font-family:monospace;font-size:14px;color:#4f46e5;font-weight:600;">${escapeHTML(email)}</div>
          </div>
          <div>
            <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Contraseña temporal</span>
            <div style="font-family:monospace;font-size:18px;color:#4f46e5;font-weight:700;letter-spacing:1px;">${nueva}</div>
          </div>
        </div>
        <p style="margin:0 0 16px;font-size:12px;color:#92400e;background:#fef3c7;border-radius:8px;padding:8px 10px;">⚠ Solo se muestra ahora. Cópiala o anótala antes de cerrar. El profesor puede cambiarla desde su panel.</p>
        <div style="display:flex;gap:8px;">
          <button id="btn-copiar-reset-prof" style="flex:1;padding:10px;background:#f1f5f9;color:#374151;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Copiar contraseña</button>
          <button id="btn-cerrar-reset-prof" style="flex:1;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Cerrar</button>
        </div>
      </div>`
    document.body.appendChild(overlay)
    document.getElementById('btn-copiar-reset-prof').onclick = async () => {
      try { await navigator.clipboard.writeText(nueva); toast('Contraseña copiada', 'success') }
      catch (_e) { toast('No se pudo copiar. Anótala manualmente.', 'warning') }
    }
    document.getElementById('btn-cerrar-reset-prof').onclick = () => overlay.remove()
    // No se cierra al hacer clic afuera: la contraseña se muestra una sola vez
  } catch(e) {
    toast(e.message ?? 'Error reseteando contraseña', 'error')
  } finally { ocultarLoader() }
}

// ─── CIERRE DE GESTIÓN ───────────────────────────────────
window.cerrarGestion = () => iniciarCierreConPromocion(perfil.colegio_id)
window.desbloquearGestionDir = (año) => desbloquearGestion(año, perfil.colegio_id)
window.bloquearGestionDir    = (año) => bloquearGestion(año, perfil.colegio_id)

window.cambiarTrimestreActivo = async function(numero) {
  const nombrePeriodo = Config.nombrePeriodo
  if (!await confirmar(
    `Activar ${nombrePeriodo} ${numero}`,
    `¿Confirmas activar el ${nombrePeriodo} ${numero}? Los profesores solo podrán crear actividades y registrar notas en este período.`
  )) return

  mostrarLoader(`Activando ${nombrePeriodo} ${numero}...`)
  try {
        const { error } = await supabase
      .from('config_gestion')
      .update({ trimestre_activo: numero })
      .eq('colegio_id', perfil.colegio_id)
      .eq('estado', 'activo')
    if (error) throw error

    invalidarConfigCache()
    toast(`${nombrePeriodo} ${numero} activado correctamente`, 'success')

    Config.periodos.forEach(p => {
      const btn = document.getElementById(`btn-trimestre-${p.numero}`)
      if (btn) {
        btn.className = `btn ${p.numero === numero ? 'btn-primary' : 'btn-secondary'}`
        btn.innerHTML = `${p.numero === numero ? '✅ ' : ''}${p.nombre}`
      }
    })
    const lbl = document.getElementById('label-trimestre-activo')
    if (lbl) lbl.textContent = `${nombrePeriodo} ${numero}`

  } catch(err) {
    toast('Error al cambiar el período activo: ' + (err.message ?? err), 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── LIBRETA INDIVIDUAL ──────────────────────────────────
window.verLibretaEstudiante = async function(estudianteId, nombre) {
  if (typeof pdfMake === 'undefined') {
    toast('La librería de PDF no está cargada', 'error'); return
  }
  mostrarLoader(`Generando libreta de ${nombre}...`)
  try {
    await generarLibretaPDF(estudianteId)
    toast('Libreta generada correctamente', 'success')
  } catch(err) {
    console.error(err)
    toast('Error al generar la libreta: ' + (err.message ?? err), 'error')
  } finally { ocultarLoader() }
}

// ─── LIBRETAS MASIVAS POR CURSO (ZIP) ────────────────────
window.exportarLibretasPorCurso = async function() {
  const cursoId = document.getElementById('filtro-curso-est')?.value
  if (!cursoId) { toast('Selecciona un curso en el filtro primero', 'warning'); return }
  if (typeof pdfMake === 'undefined') { toast('La librería de PDF no está cargada', 'error'); return }
  if (typeof JSZip === 'undefined')   { toast('La librería JSZip no está cargada', 'error'); return }

  const { data: cursoDat } = await supabase.from('cursos').select('nombre_completo').eq('id', cursoId).single()
  const nombreCurso = cursoDat?.nombre_completo ?? 'Curso'

  const { data: estudiantes } = await supabase.from('estudiantes')
    .select('id, carnet, usuarios(nombre_completo), curso:cursos(nombre_completo, nivel, grado, paralelo)')
    .eq('curso_id', cursoId)
    .order('nombre_completo', { referencedTable: 'usuarios', ascending: true })

  if (!estudiantes?.length) { toast('No hay estudiantes en este curso', 'warning'); return }
  mostrarLoader(`Generando ${estudiantes.length} libretas...`)

  try {
    const zip = new JSZip()
    const carpeta = zip.folder(`Libretas_${nombreCurso.replace(/[^a-zA-Z0-9]/g,'_')}_${Config.año}`)
    const todosIds = estudiantes.map(e => e.id)
    // Paginar: PostgREST corta ~1000 filas y a algunos alumnos les faltan notas
    let todasNotas = []
    {
      const pageSize = 1000
      let from = 0
      for (;;) {
        const { data, error } = await supabase
          .from('notas_finales')
          .select('estudiante_id, materia_id, trimestre, nota_final')
          .in('estudiante_id', todosIds)
          .order('estudiante_id', { ascending: true })
          .order('materia_id', { ascending: true })
          .range(from, from + pageSize - 1)
        if (error) throw error
        if (!data?.length) break
        todasNotas = todasNotas.concat(data)
        if (data.length < pageSize) break
        from += pageSize
      }
    }
    const { data: col } = await supabase.from('colegios')
      .select('nombre, municipio, departamento, director_nombre, resolucion_ministerial').single()
    const { data: todasInsc } = await supabase
      .from('inscripciones_tecnicas')
      .select('estudiante_id, materia_id')
      .in('estudiante_id', todosIds)
      .eq('activo', true)
    const { data: todasMaterias } = await supabase.from('materias')
      .select('id, nombre, campo_saberes, es_tecnica, aplica_desde')
      .eq('nivel', (await supabase.from('cursos').select('nivel').eq('id', cursoId).single()).data?.nivel ?? 'Primaria')
      .eq('activo', true).order('campo_saberes').order('nombre')

    for (let i = 0; i < estudiantes.length; i++) {
      const est = estudiantes[i]
      mostrarLoader(`Generando libreta ${i+1} de ${estudiantes.length}: ${est.usuarios?.nombre_completo ?? est.carnet}...`)
      const notasEst = (todasNotas ?? []).filter(n => n.estudiante_id === est.id)
      const inscEst  = (todasInsc ?? []).filter(i => i.estudiante_id === est.id).map(i => i.materia_id)
      const buffer = await _generarLibretaBuffer(est.id, notasEst, col, todasMaterias, inscEst, est)
      if (buffer) {
      const apellidos = (est.usuarios?.nombre_completo ?? 'alumno')
        .trim().split(/\s+/).slice(0, 2).join('_')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_]/g, '')
      carpeta.file(`libreta_${apellidos}_${est.carnet}_${Config.año}.pdf`, buffer)
}
    }

    mostrarLoader('Comprimiendo libretas...')
    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })
    const blob = new Blob([zipBuffer], { type: 'application/zip' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `Libretas_${nombreCurso.replace(/[^a-zA-Z0-9]/g,'_')}_${Config.año}.zip`
    a.click()
    URL.revokeObjectURL(url)
    toast(`${estudiantes.length} libretas exportadas correctamente`, 'success')
  } catch(err) {
    console.error(err)
    toast('Error al generar las libretas: ' + (err.message ?? err), 'error')
  } finally { ocultarLoader() }
}

async function _generarLibretaBuffer(estudianteId, notasPreCargadas = null, colPreCargado = null, materiasPreCargadas = null, inscripcionesPreCargadas = null, estPreCargado = null) {
  const est = estPreCargado ?? (await supabase.from('estudiantes')
    .select('carnet, usuarios(nombre_completo), curso:cursos(nombre_completo, nivel, grado, paralelo)')
    .eq('id', estudianteId).single()).data
  if (!est) return null
  const col = colPreCargado ?? (await supabase.from('colegios')
    .select('nombre, municipio, departamento, director_nombre, resolucion_ministerial').single()).data

  const gradoNum = parseInt(est.curso?.grado) || 0
  const nivel    = est.curso?.nivel ?? 'Secundaria'
  let regulares  = (materiasPreCargadas ?? []).filter(m => !m.es_tecnica)
  const tecnicas = (materiasPreCargadas ?? []).filter(m => m.es_tecnica)
  if (nivel === 'Secundaria' && gradoNum >= 4) {
    regulares = regulares.filter(m => m.nombre !== 'Técnica Tecnológica General')
  }
    const idsInscritos = inscripcionesPreCargadas
    ? new Set(inscripcionesPreCargadas)
    : new Set((await supabase.from('inscripciones_tecnicas').select('materia_id').eq('estudiante_id', estudianteId).eq('activo', true)).data?.map(i => i.materia_id) ?? [])
  const gradoAplica = (s) => {
    const n = parseInt(String(s ?? '4').replace(/\D/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 4
  }
  const tecnicasEst = tecnicas.filter(
    m => idsInscritos.has(m.id) && gradoNum >= gradoAplica(m.aplica_desde)
  )
  regulares.push(...tecnicasEst)
  const materias = materiasPreCargadas ? regulares : (await supabase.from('materias')
    .select('id, nombre, campo_saberes, es_tecnica, aplica_desde')
    .eq('nivel', nivel).eq('activo', true)
    .order('campo_saberes').order('nombre')).data ?? []

  const periodos = Config.periodos
  const notasMap = {}
  const fuente = notasPreCargadas ?? (await supabase.from('notas_finales')
    .select('materia_id, trimestre, nota_final').eq('estudiante_id', estudianteId)).data ?? []
  fuente.forEach(n => {
    if (!notasMap[n.materia_id]) notasMap[n.materia_id] = {}
    notasMap[n.materia_id][n.trimestre] = parseFloat(n.nota_final ?? 0)
  })
  const docDef = buildDoc(est, col, materias, notasMap, periodos)
  return new Promise((resolve) => {
    pdfMake.createPdf(docDef).getBuffer(buffer => resolve(buffer))
  })
}

window.guardarSubcriteriosSer = async function(ids) {
  mostrarLoader('Guardando subcriterios...')
  let errores = 0
  for (const id of ids) {
    const texto  = document.getElementById(`ser-texto-${id}`)?.value?.trim()
    const desc   = document.getElementById(`ser-desc-${id}`)?.value?.trim() || null
    const activo = document.getElementById(`ser-activo-${id}`)?.checked ?? true
    if (!texto) continue
    const { error } = await supabase
      .from('config_subcriterios_ser').update({ texto, descripcion: desc, activo }).eq('id', id)
    if (error) errores++
  }
  ocultarLoader()
  if (errores) {
    toast(`${errores} subcriterios no pudieron guardarse`, 'error')
  } else {
    invalidarConfigCache()
    toast('Subcriterios guardados correctamente', 'success')
  }
}

window.guardarPreguntasDocente = async function(ids) {
  mostrarLoader('Guardando preguntas...')
  let errores = 0
  for (const id of ids) {
    const texto  = document.getElementById(`preg-texto-${id}`)?.value?.trim()
    const min    = parseInt(document.getElementById(`preg-min-${id}`)?.value ?? 1)
    const max    = parseInt(document.getElementById(`preg-max-${id}`)?.value ?? 4)
    const activo = document.getElementById(`preg-activo-${id}`)?.checked ?? true
    if (!texto) continue
    const { error } = await supabase
      .from('config_preguntas_docente')
      .update({ texto, escala_min: min, escala_max: max, activo })
      .eq('id', id)
    if (error) errores++
  }
  ocultarLoader()
  errores ? toast(`${errores} preguntas no pudieron guardarse`, 'error')
           : toast('Preguntas guardadas correctamente', 'success')
}

window.agregarPreguntaDocente = async function() {
  const { data: ultima } = await supabase
    .from('config_preguntas_docente')
    .select('orden')
    .eq('año', Config.año)
    .order('orden', { ascending: false })
    .limit(1)
    .single()

  const nuevoOrden = (ultima?.orden ?? 0) + 1
  const { error } = await supabase
    .from('config_preguntas_docente')
    .insert({ año: Config.año, texto: 'Nueva pregunta', escala_min: 1, escala_max: 4, orden: nuevoOrden, activo: true, colegio_id: perfil.colegio_id })

  if (error) { toast(error.message, 'error'); return }
  toast('Pregunta agregada', 'success')
  renderConfigTab('preguntas-docente')
}

window.abrirCambiarContrasena = function() {
  const nombreActual = document.getElementById('nombre-director')?.textContent?.trim() || perfil?.nombre_completo || ''
  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position:'fixed', inset:'0', zIndex:'99999',
    display:'flex', alignItems:'center', justifyContent:'center',
    backgroundColor:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)'
  })
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 6px;font-size:1.1rem;font-weight:700;color:#0f172a;">Mi cuenta</h3>
      <p style="margin:0 0 16px;font-size:0.85rem;color:#64748b;">Actualizá tu nombre o contraseña</p>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px;">Nombre completo</label>
        <input id="dir-nombre-completo" type="text" value="${nombreActual.replace(/"/g, '&quot;')}"
          style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px;">Nueva contraseña (opcional)</label>
        <input id="dir-nueva-pass" type="password" placeholder="Dejar vacío para no cambiar"
          style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px;">Confirmar contraseña</label>
        <input id="dir-confirmar-pass" type="password" placeholder="Repite si cambias la contraseña"
          style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:8px;">
        <button id="btn-confirmar-pass-dir" style="flex:1;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Guardar</button>
        <button id="btn-cancelar-pass-dir" style="flex:1;padding:10px;background:#f1f5f9;color:#374151;border:none;border-radius:10px;font-weight:600;cursor:pointer;">Cancelar</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  document.getElementById('btn-cancelar-pass-dir').onclick = () => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  document.getElementById('btn-confirmar-pass-dir').onclick = async () => {
    const nuevoNombre = document.getElementById('dir-nombre-completo').value.trim()
    const nueva = document.getElementById('dir-nueva-pass').value
    const confirmar2 = document.getElementById('dir-confirmar-pass').value
    if (!nuevoNombre) { toast('El nombre es obligatorio', 'warning'); return }
        if (!/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü'\-\s]+$/.test(nuevoNombre)) {
      toast('El nombre solo admite letras, espacios, guion y apóstrofe. No uses puntos (ej. Lic en lugar de Lic.)', 'warning')
      return
    }
    if (nueva && nueva.length < 6) { toast('Mínimo 6 caracteres', 'warning'); return }
    if (nueva && nueva !== confirmar2) { toast('Las contraseñas no coinciden', 'warning'); return }
    overlay.remove()
    mostrarLoader('Guardando...')
    try {
      const { error: errNombre } = await supabase.from('usuarios')
        .update({ nombre_completo: nuevoNombre })
        .eq('id', perfil.id)
      if (errNombre) throw errNombre
      perfil.nombre_completo = nuevoNombre
      const elNom = document.getElementById('nombre-director')
      const elAv = document.getElementById('avatar-director')
      if (elNom) elNom.textContent = nuevoNombre
      if (elAv) elAv.textContent = nuevoNombre.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase()
      if (nueva) {
        const { error } = await supabase.auth.updateUser({ password: nueva })
        if (error) throw error
      }
      toast('Datos actualizados', 'success')
    } catch(e) {
      toast(e.message ?? 'Error al guardar', 'error')
    } finally { ocultarLoader() }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEGAR AL FINAL DE: frontend/js/admin/director.js
// ═══════════════════════════════════════════════════════════════════════════════
import { enviarComunicado, getComunicadosEnviados } from '../comunicados/comunicados.js'
import { renderTablaEnviados, montarListaEnviados } from '../comunicados/comunicados-ui.js'
import { crearFormComunicado, gruposDirector } from '../comunicados/form-comunicado.js'

// ─── TUTOR DE CURSO ───────────────────────────────────────────────────────────
window.asignarTutorCurso = async function(cursoId) {
  const { data: profesores } = await supabase
    .from('usuarios').select('id, nombre_completo')
    .eq('rol', 'profesor').eq('colegio_id', perfil.colegio_id)
    .eq('activo', true).order('nombre_completo')

  const opciones = (profesores ?? []).map(p =>
    `<option value="${p.id}">${p.nombre_completo}</option>`
  ).join('')

  const result = await Swal.fire({
    title: 'Asignar tutor de curso',
    html: `<select id="sel-tutor-curso" class="swal2-input">
             <option value="">— Sin tutor —</option>
             ${opciones}
           </select>`,
    confirmButtonText: 'Guardar',
    showCancelButton: true,
    preConfirm: () => document.getElementById('sel-tutor-curso').value
  })

  if (!result.isConfirmed) return
  const { error } = await supabase.from('cursos')
    .update({ tutor_profesor_id: result.value || null }).eq('id', cursoId)
  if (error) { toast('Error al asignar tutor', 'error'); return }
  toast('Tutor asignado correctamente', 'success')
  cargarCursos()
}

// ─── COMUNICADOS — DIRECTOR ───────────────────────────────────────────────────
async function cargarComunicadosDir() {
  const tbody = document.getElementById('tabla-comunicados-dir')
  if (tbody) await montarListaEnviados(tbody, { esDirector: true })
}

// Formulario "Nuevo comunicado": lógica compartida en comunicados/form-comunicado.js
// Destinos: todo el colegio, un curso o una rama técnica (todos o algunos estudiantes)
const _comDir = crearFormComunicado({
  prefijo: 'dir', tipoEmisor: 'director',
  getPerfil: () => perfil,
  cargarGrupos: gruposDirector,
  onEnviado: () => cargarComunicadosDir(),
})
window.abrirModalComunicadoDir = _comDir.abrir
window.cambiarGrupoComDir      = _comDir.cambiarGrupo
window.cambiarModoComDir       = _comDir.cambiarModo
window.actualizarResumenComDir = _comDir.actualizarResumen
window.enviarComunicadoDir     = _comDir.enviar