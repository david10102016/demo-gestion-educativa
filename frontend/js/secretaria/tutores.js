// js/secretaria/tutores.js
// Lista de estudiantes agrupada por Nivel > Curso, mostrando el padre/tutor
// vinculado (si existe), buscador, y registro de pago en efectivo.
import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader } from '../utils/ui.js'
import { ConfigPagos, cargarConfigPagos, formatBs, resumenPagosEstudiante, MESES_LABELS } from '../config/config-pagos.js'
import { registrarPagoEfectivo } from '../pagos/pagos.js'
import { escapeHtml } from '../utils/sanitize.js'

let _perfil = null
let _listaCompleta = []   // [{ estudiante, curso, padres: [] }]
let _ordenActual = 'apellido' // 'apellido' | 'fecha'
let _filtroNivel = ''
let _filtroCurso = ''
let _textoBusqueda = ''

// ── Consultas grandes ──
const TAM_PAGINA = 1000   // tope de filas por consulta del servidor
const TAM_BLOQUE_IDS = 150 // ids por .in(), para no pasar el largo de la URL

// Trae todas las filas pidiendo de a 1000. La consulta debe tener .order() estable.
async function traerPorPaginas(crearConsulta) {
  const filas = []
  for (let desde = 0; ; desde += TAM_PAGINA) {
    const { data, error } = await crearConsulta().range(desde, desde + TAM_PAGINA - 1)
    if (error) throw error
    filas.push(...(data ?? []))
    if (!data || data.length < TAM_PAGINA) break
  }
  return filas
}

// Ejecuta la consulta en bloques de ids y junta los resultados.
async function traerPorBloquesDeIds(ids, crearConsulta) {
  const filas = []
  for (let i = 0; i < ids.length; i += TAM_BLOQUE_IDS) {
    const bloque = ids.slice(i, i + TAM_BLOQUE_IDS)
    filas.push(...await traerPorPaginas(() => crearConsulta(bloque).order('id')))
  }
  return filas
}

// ── Punto de entrada ──
export async function cargarListaTutores(perfil) {
  _perfil = perfil
  const cont = document.getElementById('tutores-container')
  if (cont) cont.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>'

  try {
    const año = new Date().getFullYear()
    await cargarConfigPagos(año)

    // 1. Estudiantes del colegio, con su curso y sus pagos del año.
    //    Por páginas de 1000: el servidor no devuelve más de 1000 filas por consulta.
    const estudiantes = await traerPorPaginas(() => supabase
      .from('estudiantes')
      .select(`
        id, carnet, created_at,
        usuarios!inner ( nombre_completo ),
        cursos ( id, nombre_completo, nivel, grado, paralelo ),
        pagos_mensualidad ( mes, estado, año )
      `)
      .eq('colegio_id', perfil.colegio_id)
      .order('id'))

    // 2. Vínculos activos tutor-estudiante de este colegio (ids en bloques)
    const idsEstudiantes = estudiantes.map(e => e.id)
    const vinculos = await traerPorBloquesDeIds(idsEstudiantes, (ids) => supabase
      .from('tutor_estudiante')
      .select('estudiante_id, tutor_id')
      .in('estudiante_id', ids)
      .eq('activo', true))

    // 3. Datos del padre para cada tutor_id encontrado (ids en bloques)
    const idsTutores = [...new Set(vinculos.map(v => v.tutor_id))]
    const padres = await traerPorBloquesDeIds(idsTutores, (ids) => supabase
      .from('usuarios')
      .select('id, nombre_completo, email')
      .in('id', ids))

    // 4. Combinar todo en memoria
    // Un estudiante puede tener varios padres/tutores vinculados: se guardan todos
    const padresPorEstudiante = new Map()
    vinculos.forEach(v => {
      const padre = padres.find(p => p.id === v.tutor_id)
      if (!padre) return
      if (!padresPorEstudiante.has(v.estudiante_id)) padresPorEstudiante.set(v.estudiante_id, [])
      const lista = padresPorEstudiante.get(v.estudiante_id)
      if (!lista.some(p => p.id === padre.id)) lista.push(padre)
    })

    _listaCompleta = (estudiantes ?? []).map(e => ({
      estudiante: {
        id: e.id,
        carnet: e.carnet,
        nombre: e.usuarios?.nombre_completo ?? '(sin nombre)',
        created_at: e.created_at
      },
      curso: e.cursos ?? null,
      padres: padresPorEstudiante.get(e.id) ?? [],
      pagosAño: (e.pagos_mensualidad ?? []).filter(p => p.año === año)
    }))

    poblarSelectoresTutores()
    aplicarFiltrosTutores()
  } catch (err) {
    console.error(err)
    if (cont) cont.innerHTML = '<div class="empty-state"><p>Error al cargar la lista.</p></div>'
    toast('No se pudo cargar la lista de tutores', 'error')
  }
}

// ── Selectores (Nivel / Curso) ──
export function poblarSelectoresTutores() {
  const selNivel = document.getElementById('tutores-filtro-nivel')
  const selCurso = document.getElementById('tutores-filtro-curso')
  if (!selNivel || !selCurso) return

  const niveles = [...new Set(_listaCompleta.map(i => i.curso?.nivel).filter(Boolean))].sort(compararNiveles)
  selNivel.innerHTML = '<option value="">Todos los niveles</option>' +
    niveles.map(n => `<option value="${n}">${n}</option>`).join('')

  actualizarSelectorCurso()
}

function actualizarSelectorCurso() {
  const selCurso = document.getElementById('tutores-filtro-curso')
  if (!selCurso) return

  const unicos = new Map()
  _listaCompleta
    .filter(i => !_filtroNivel || i.curso?.nivel === _filtroNivel)
    .forEach(i => { if (i.curso?.nombre_completo) unicos.set(i.curso.nombre_completo, i.curso) })
  const cursos = [...unicos.values()]
    .sort((a, b) => compararNiveles(a.nivel ?? '', b.nivel ?? '') || compararCursos(a, b))
    .map(c => c.nombre_completo)

  selCurso.innerHTML = '<option value="">Todos los cursos</option>' +
    cursos.map(c => `<option value="${c}">${c}</option>`).join('')
}

export function filtrarPorNivelTutores(nivel) {
  _filtroNivel = nivel
  _filtroCurso = ''
  actualizarSelectorCurso()
  aplicarFiltrosTutores()
}

export function filtrarPorCursoTutores(curso) {
  _filtroCurso = curso
  aplicarFiltrosTutores()
}

// ── Búsqueda libre (ignora los selectores, busca en todo el colegio) ──
export function filtrarTutores(query) {
  _textoBusqueda = (query ?? '').trim().toLowerCase()
  aplicarFiltrosTutores()
}

function aplicarFiltrosTutores() {
  let filtrada = _listaCompleta

  if (_textoBusqueda) {
    filtrada = filtrada.filter(item =>
      item.estudiante.nombre.toLowerCase().includes(_textoBusqueda) ||
      item.estudiante.carnet?.toLowerCase().includes(_textoBusqueda) ||
      item.padres.some(p => p.nombre_completo?.toLowerCase().includes(_textoBusqueda))
    )
  } else {
    if (_filtroNivel) filtrada = filtrada.filter(i => i.curso?.nivel === _filtroNivel)
    if (_filtroCurso) filtrada = filtrada.filter(i => i.curso?.nombre_completo === _filtroCurso)
  }

  renderLista(filtrada)
}

// ── Cambiar orden ──
export function cambiarOrdenTutores(orden) {
  _ordenActual = orden
  renderLista(_listaCompleta)
}

// ── Puntitos de meses pagados (automático, no clickeable) ──
function renderPuntosMeses(item) {
  const nivel = item.curso?.nivel
  if (!nivel) return ''
  const meses = ConfigPagos.mesesActivos(nivel)
  if (!meses.length) return ''

  const puntos = meses.map(m => {
    // Un mes puede tener un pago rechazado y otro nuevo (119): manda el vigente
    const delMes = item.pagosAño.filter(p => p.mes === m)
    const pago = delMes.find(p => p.estado === 'aprobado')
              ?? delMes.find(p => p.estado === 'pendiente' || p.estado === 'en_revision')
              ?? delMes[0]
    const estado = pago?.estado
    const color = estado === 'aprobado' ? '#10b981'
                : (estado === 'pendiente' || estado === 'en_revision') ? '#f59e0b'
                : estado === 'rechazado' ? '#ef4444'
                : '#d1d5db'
    const texto = estado === 'aprobado' ? 'Pagado'
                : (estado === 'pendiente' || estado === 'en_revision') ? 'Pendiente de revisión'
                : estado === 'rechazado' ? 'Rechazado'
                : 'Sin pagar'
    const titulo = MESES_LABELS[m] + ': ' + texto
    return `<span title="${titulo}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:3px;"></span>`
  }).join('')

  return `<div class="tutor-card-meses">${puntos}</div>`
}

// ── Render agrupado por Nivel > Curso ──
function renderLista(lista) {

  const cont = document.getElementById('tutores-container')
  if (!cont) return

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state"><p>No se encontraron estudiantes.</p></div>'
    return
  }

  const ordenada = [...lista].sort((a, b) => {
    if (_ordenActual === 'fecha') {
      return new Date(b.estudiante.created_at) - new Date(a.estudiante.created_at)
    }
    return a.estudiante.nombre.localeCompare(b.estudiante.nombre)
  })

  // Agrupar por nivel -> curso (guardando el curso para ordenarlo por grado y paralelo)
  const porNivel = new Map()
  ordenada.forEach(item => {
    const nivel = item.curso?.nivel ?? 'Sin nivel'
    const curso = item.curso?.nombre_completo ?? 'Sin curso'
    if (!porNivel.has(nivel)) porNivel.set(nivel, new Map())
    const porCurso = porNivel.get(nivel)
    if (!porCurso.has(curso)) porCurso.set(curso, { curso: item.curso, items: [] })
    porCurso.get(curso).items.push(item)
  })

  const hayFiltroActivo = !!(_textoBusqueda || _filtroCurso)
  // Con búsqueda o curso elegido se abre todo; con nivel elegido, solo ese nivel
  const nivelAbierto = hayFiltroActivo || !!_filtroNivel

  asegurarEstilosNivel()

  let html = ''
  for (const nivel of [...porNivel.keys()].sort(compararNiveles)) {
    const porCurso = porNivel.get(nivel)
    const cursos = [...porCurso.values()].sort((a, b) => compararCursos(a.curso, b.curso))
    const totalNivel = cursos.reduce((s, c) => s + c.items.length, 0)
    html += `<div class="tutores-nivel ${nivelAbierto ? '' : 'nivel-colapsado'}">
      <h3 class="tutores-nivel-titulo" onclick="this.parentElement.classList.toggle('nivel-colapsado')">
        <span>${escapeHtml(nivel)} <small class="tutores-nivel-cant">${totalNivel} estudiantes · ${cursos.length} cursos</small></span>
        <svg class="tutores-nivel-flecha" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </h3>
      <div class="tutores-nivel-cursos">`
    for (const { curso: cursoObj, items } of cursos) {
      const curso = cursoObj?.nombre_completo ?? 'Sin curso'
      const claseInicial = hayFiltroActivo ? '' : 'colapsado'
      html += `<div class="tutores-curso ${claseInicial}"><h4 onclick="this.parentElement.classList.toggle('colapsado')">${escapeHtml(curso)} (${items.length})</h4><div class="tutores-grid">`
      items.forEach(item => {
        const tienePadre = item.padres.length > 0
        html += `
          <div class="tutor-card">
            <div class="tutor-card-estudiante">
              <strong>${escapeHtml(item.estudiante.nombre)}</strong>
              <span class="tutor-card-carnet">Carnet: ${escapeHtml(item.estudiante.carnet ?? '—')}</span>
            </div>
            <div class="tutor-card-padre ${tienePadre ? '' : 'sin-vincular'}">
              ${tienePadre
                ? `${item.padres.length > 1 ? 'Padres/Tutores' : 'Padre/Tutor'}:` + item.padres.map(p =>
                    `<div style="margin-top:2px;"><strong>${escapeHtml(p.nombre_completo)}</strong><br><span class="tutor-card-email">${escapeHtml(p.email)}</span></div>`
                  ).join('')
                : 'Sin padre vinculado'}
            </div>
            ${renderPuntosMeses(item)}
            <button class="btn btn-secondary btn-sm"
              data-estudiante-id="${escapeHtml(item.estudiante.id)}"
              data-estudiante-nombre="${escapeHtml(item.estudiante.nombre)}"
              data-nivel="${escapeHtml(item.curso?.nivel ?? '')}"
              onclick="window.abrirModalPagoEfectivo(this.dataset.estudianteId, this.dataset.estudianteNombre, this.dataset.nivel)">
              Registrar pago
            </button>
          </div>`
      })
      html += `</div></div>`
    }
    html += `</div></div>`
  }

  cont.innerHTML = html
}

// ── Orden de niveles y cursos ──
const ORDEN_NIVELES = ['Inicial', 'Primaria', 'Secundaria']

function compararNiveles(a, b) {
  const ia = ORDEN_NIVELES.indexOf(a), ib = ORDEN_NIVELES.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b)
}

// Por grado (1°, 2°, ...) y luego paralelo (A, B, C)
function compararCursos(a, b) {
  const ga = Number(a?.grado), gb = Number(b?.grado)
  if (!Number.isNaN(ga) && !Number.isNaN(gb) && ga !== gb) return ga - gb
  const pa = String(a?.paralelo ?? ''), pb = String(b?.paralelo ?? '')
  if (pa !== pb) return pa.localeCompare(pb)
  return String(a?.nombre_completo ?? '').localeCompare(String(b?.nombre_completo ?? ''), 'es', { numeric: true })
}

// Estilos del nivel desplegable (una sola vez; no toca global.css)
function asegurarEstilosNivel() {
  if (document.getElementById('tutores-nivel-estilos')) return
  const st = document.createElement('style')
  st.id = 'tutores-nivel-estilos'
  st.textContent = `
    .tutores-nivel-titulo { display:flex; align-items:center; justify-content:space-between; cursor:pointer; user-select:none; }
    .tutores-nivel-cant { font-size:var(--font-size-xs); font-weight:500; color:var(--color-text-3); margin-left:8px; }
    .tutores-nivel-flecha { transition:transform 0.15s; color:var(--color-text-3); }
    .tutores-nivel.nivel-colapsado .tutores-nivel-flecha { transform:rotate(-90deg); }
    .tutores-nivel.nivel-colapsado .tutores-nivel-cursos { display:none; }
  `
  document.head.appendChild(st)
}

// ── Modal de pago en efectivo ──
let _pagoEfectivoActual = null

export async function abrirModalPagoEfectivo(estudianteId, estudianteNombre, nivel) {
  const año = new Date().getFullYear()
  await cargarConfigPagos(año)

  const [resumen] = await Promise.all([resumenPagosEstudiante(estudianteId, año)])
  const mesesOcupados = new Set([
    ...(resumen?.mesesPagados ?? []),
    ...(resumen?.mesesPendientes ?? [])
  ])

  const meses = ConfigPagos.mesesActivos(nivel).filter(m => !mesesOcupados.has(m))

  if (!meses.length) {
    toast('Este estudiante ya tiene todos los meses activos pagados o pendientes de revisión', 'warning')
    return
  }

  _pagoEfectivoActual = { estudianteId, estudianteNombre, nivel }

  const selectMes = document.getElementById('pago-efectivo-mes')
  selectMes.innerHTML = meses.map(m =>
    `<option value="${m}">${ConfigPagos.labelMes(m)} — ${formatBs(ConfigPagos.monto(nivel, m))}</option>`
  ).join('')

  document.getElementById('pago-efectivo-estudiante').textContent = estudianteNombre
  document.getElementById('pago-efectivo-nombre-pagador').value = ''
  document.getElementById('pago-efectivo-observacion').value = ''
  document.getElementById('modal-pago-efectivo').classList.remove('hidden')
}

export function cerrarModalPagoEfectivo() {
  document.getElementById('modal-pago-efectivo').classList.add('hidden')
  _pagoEfectivoActual = null
}

export async function confirmarPagoEfectivo() {
  if (!_pagoEfectivoActual) return

  if (window.APP_CONFIG?.plan !== 'avanzado') {
    toast('Registrar pagos en efectivo requiere el plan avanzado. Solicítalo al administrador.', 'warning')
    return
  }

  const mes = Number(document.getElementById('pago-efectivo-mes').value)
  const nombrePagador = document.getElementById('pago-efectivo-nombre-pagador').value.trim()
  const observacion = document.getElementById('pago-efectivo-observacion').value.trim()
  const { estudianteId, nivel } = _pagoEfectivoActual

  if (!nombrePagador) {
    toast('Ingresa el nombre de quien realizó el pago', 'error')
    return
  }

  const monto = ConfigPagos.monto(nivel, mes)
  const año = new Date().getFullYear()

  mostrarLoader()
  try {
    await registrarPagoEfectivo(estudianteId, año, mes, monto, nombrePagador, observacion)
    toast('Pago registrado correctamente', 'success')
    cerrarModalPagoEfectivo()
    await cargarListaTutores(_perfil)
  } catch (err) {
    console.error(err)
    if (err.code === '23505') {
      toast('Ese mes ya tiene un pago registrado para este estudiante', 'error')
    } else {
      toast('No se pudo registrar el pago', 'error')
    }
  } finally {
    ocultarLoader()
  }
}

// Exponer al scope global para los onclick del HTML
window.abrirModalPagoEfectivo = abrirModalPagoEfectivo
window.cerrarModalPagoEfectivo = cerrarModalPagoEfectivo
window.confirmarPagoEfectivo = confirmarPagoEfectivo
window.filtrarTutores = filtrarTutores
window.cambiarOrdenTutores = cambiarOrdenTutores
window.filtrarPorNivelTutores = filtrarPorNivelTutores
window.filtrarPorCursoTutores = filtrarPorCursoTutores