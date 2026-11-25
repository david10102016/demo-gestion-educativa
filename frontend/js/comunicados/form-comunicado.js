// js/comunicados/form-comunicado.js
// Formulario de "Nuevo comunicado" compartido por el panel del profesor y el
// del director. Cada panel indica su prefijo de IDs del HTML ('prof' | 'dir'),
// el tipo de emisor y cómo obtener sus destinos (grupos).
//
// Tipos de grupo:
//   { tipo: 'colegio', key: 'colegio', nombre }                    → todos los estudiantes activos
//   { tipo: 'curso',   key, nombre, cursoId }                       → estudiantes del curso
//   { tipo: 'tec',     key, nombre, materiaId, cursos?: [cursoId] } → inscritos en la rama técnica
//                       (si trae `cursos`, solo los de esos paralelos)
import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import { paginar } from '../utils/paginar.js'

const LOTE = 1000

async function cargarEstudiantesGrupo(g, perfil) {
  let res
  if (g.tipo === 'tec') {
    res = await paginar(() => {
      let q = supabase.from('inscripciones_tecnicas')
        .select('estudiante_id, estudiantes!inner(curso_id, cursos(nombre_completo), usuarios(nombre_completo, activo))')
        .eq('materia_id', g.materiaId).eq('activo', true)
      if (g.cursos?.length) q = q.in('estudiantes.curso_id', g.cursos)
      return q
    })
    if (res.error) return res
    const vistos = new Set()
    return { data: (res.data ?? [])
      .filter(i => i.estudiantes?.usuarios?.activo !== false)
      .filter(i => !vistos.has(i.estudiante_id) && vistos.add(i.estudiante_id))
      .map(i => ({ id: i.estudiante_id, nombre: i.estudiantes?.usuarios?.nombre_completo,
        cursoId: i.estudiantes?.curso_id, curso: i.estudiantes?.cursos?.nombre_completo ?? 'Curso' })) }
  }
  res = await paginar(() => {
    const q = supabase.from('estudiantes').select('id, usuarios!inner(nombre_completo, activo)')
      .eq('usuarios.activo', true)
    return g.tipo === 'colegio' ? q.eq('colegio_id', perfil.colegio_id) : q.eq('curso_id', g.cursoId)
  })
  if (res.error) return res
  return { data: (res.data ?? []).map(e => ({ id: e.id, nombre: e.usuarios?.nombre_completo })) }
}

export function crearFormComunicado({ prefijo, tipoEmisor, getPerfil, cargarGrupos, onEnviado }) {
  const $ = id => document.getElementById(`com-${prefijo}-${id}`)
  const modal = () => document.getElementById(`modal-comunicado-${prefijo}`)
  const radios = () => document.querySelectorAll(`input[name="com-${prefijo}-modo"]`)
  let grupos = {}
  let estudiantes = []   // [{ id, nombre }] del grupo elegido (ya filtrado por cursos)
  let todosGrupo  = []   // rama técnica: todos sus inscritos, antes de filtrar por curso
  let cursosSel   = new Set()

  // Rama técnica con elección de cursos (director): se inserta antes del paso "¿A quién?"
  function cursosWrap() {
    let w = $('cursos-wrap')
    if (!w) {
      w = document.createElement('div')
      w.id = `com-${prefijo}-cursos-wrap`
      w.style.display = 'none'
      $('modo-wrap').before(w)
      w.addEventListener('change', e => {
        const cb = e.target
        if (cb.dataset.todos) w.querySelectorAll('input[data-curso]').forEach(x => x.checked = cb.checked)
        else {
          const all = [...w.querySelectorAll('input[data-curso]')]
          w.querySelector('input[data-todos]').checked = all.every(x => x.checked)
        }
        cursosSel = new Set([...w.querySelectorAll('input[data-curso]:checked')].map(x => x.dataset.curso))
        aplicarCursos()
      })
    }
    return w
  }
  function etiquetaModo(n) {
    const lbl = $('modo-wrap').querySelector('label.form-label')
    if (lbl) lbl.textContent = `${n}. ¿A quién se envía?`
  }
  function pintarLista() {
    $('est-lista').innerHTML = estudiantes.map(e =>
      `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;">
        <input type="checkbox" value="${escapeHtml(e.id)}"> ${escapeHtml(e.nombre)}${e.curso ? ` <small style="color:var(--color-text-3);">· ${escapeHtml(e.curso)}</small>` : ''}
      </label>`).join('')
  }
  function aplicarCursos() {
    estudiantes = todosGrupo.filter(e => cursosSel.has(e.cursoId))
    $('modo-wrap').style.display = cursosSel.size ? 'block' : 'none'
    pintarLista()
    actualizarResumen()
  }
  function nombreDestino(g) {
    if (!g.elegirCursos) return g.nombre
    const nombres = [...new Set(todosGrupo.filter(e => cursosSel.has(e.cursoId)).map(e => e.curso))]
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    return `${g.nombre} – ${nombres.join(', ')}`
  }

  function destino() {
    const g = grupos[$('grupo')?.value]
    if (!g) return null
    if (g.tipo === 'colegio') return { g, modo: 'todos', ids: estudiantes.map(e => e.id), nombres: [] }
    if (g.elegirCursos && !cursosSel.size) return null
    const modo = document.querySelector(`input[name="com-${prefijo}-modo"]:checked`)?.value
    if (!modo) return null
    if (modo === 'todos') return { g, modo, ids: estudiantes.map(e => e.id), nombres: [] }
    const ids = [...$('est-lista').querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value)
    const nombres = ids.map(id => estudiantes.find(e => e.id === id)?.nombre ?? '—')
    return { g, modo, ids, nombres }
  }

  function texto(d) {
    if (d.g.tipo === 'colegio') return `TODO EL COLEGIO (${d.ids.length} estudiantes)`
    if (d.modo === 'todos') return `TODOS los estudiantes de ${nombreDestino(d.g)} (${d.ids.length})`
    if (d.ids.length === 1) return d.nombres[0]
    const muestra = d.nombres.length <= 3
      ? d.nombres.join(', ')
      : `${d.nombres.slice(0, 3).join(', ')} y ${d.nombres.length - 3} más`
    return `${d.ids.length} estudiantes de ${nombreDestino(d.g)}: ${muestra}`
  }

  function actualizarResumen() {
    const el = $('resumen')
    if (!el) return
    const d = destino()
    const gSel = grupos[$('grupo')?.value]
    el.textContent = !d ? (gSel?.elegirCursos && !cursosSel.size ? 'Marca al menos un curso de la rama técnica.' : 'Aún no elegiste a quién enviar.')
      : !d.ids.length ? (d.modo === 'algunos' ? 'Marca al menos un estudiante de la lista.' : 'No hay estudiantes en este destino.')
      : `Se enviará a: ${texto(d)}`
  }

  async function abrir() {
    const perfil = getPerfil()
    let lista
    try { lista = await cargarGrupos(perfil) }
    catch (e) { toast('No se pudieron cargar los destinos', 'error'); return }
    grupos = {}
    lista.forEach(g => { grupos[g.key] = g })
    const opt = g => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.nombre)}</option>`
    const colegio = lista.filter(g => g.tipo === 'colegio')
    const cursos  = lista.filter(g => g.tipo === 'curso')
    const tecs    = lista.filter(g => g.tipo === 'tec')
    $('grupo').innerHTML = `<option value="">— Selecciona —</option>`
      + colegio.map(opt).join('')
      + (cursos.length ? `<optgroup label="Cursos">${cursos.map(opt).join('')}</optgroup>` : '')
      + (tecs.length ? `<optgroup label="Ramas técnicas">${tecs.map(opt).join('')}</optgroup>` : '')

    // Formulario limpio cada vez que se abre
    estudiantes = []; todosGrupo = []; cursosSel = new Set()
    cursosWrap().style.display = 'none'; etiquetaModo(2)
    $('modo-wrap').style.display = 'none'
    radios().forEach(r => r.checked = false)
    const l = $('est-lista')
    l.innerHTML = ''
    l.style.display = 'none'
    if (!l.dataset.escucha) {   // un solo listener para todas las casillas
      l.addEventListener('change', actualizarResumen)
      l.dataset.escucha = '1'
    }
    $('asunto').value = ''
    $('contenido').value = ''
    actualizarResumen()
    modal().classList.remove('hidden')
  }

  async function cambiarGrupo() {
    const key = $('grupo').value
    const g = grupos[key]
    estudiantes = []; todosGrupo = []; cursosSel = new Set()
    const cw = cursosWrap(); cw.style.display = 'none'; cw.innerHTML = ''; etiquetaModo(2)
    radios().forEach(r => r.checked = false)
    const l = $('est-lista')
    l.innerHTML = ''
    l.style.display = 'none'
    $('modo-wrap').style.display = g && g.tipo !== 'colegio' ? 'block' : 'none'
    if (!g) { actualizarResumen(); return }

    const { data, error } = await cargarEstudiantesGrupo(g, getPerfil())
    if (error) { toast('No se pudo cargar la lista de estudiantes', 'error'); return }
    if ($('grupo').value !== key) return   // cambió de grupo mientras cargaba

    const lista = (data ?? [])
      .map(e => ({ id: e.id, nombre: e.nombre ?? '—', cursoId: e.cursoId, curso: e.curso }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    if (g.elegirCursos) {
      todosGrupo = lista
      const cursos = {}
      lista.forEach(e => { cursos[e.cursoId] ??= { nombre: e.curso, n: 0 }; cursos[e.cursoId].n++ })
      const orden = Object.entries(cursos).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es', { numeric: true }))
      cw.innerHTML = `<label class="form-label">2. ¿A qué cursos de la rama?</label>
        <div style="display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--color-border);border-radius:8px;max-height:200px;overflow-y:auto;">
          <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-weight:600;">
            <input type="checkbox" data-todos="1"> Todos los cursos de la rama (${lista.length})</label>
          ${orden.map(([id, c]) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;">
            <input type="checkbox" data-curso="${escapeHtml(id)}"> ${escapeHtml(c.nombre)} (${c.n} ${c.n === 1 ? 'inscrito' : 'inscritos'})</label>`).join('')}
        </div>`
      cw.style.display = orden.length ? 'block' : 'none'
      $('modo-wrap').style.display = 'none'
      etiquetaModo(3)
      if (!orden.length) toast('Esta rama técnica no tiene inscritos activos', 'warning')
    } else {
      estudiantes = lista
      if (g.tipo !== 'colegio') pintarLista()
    }
    actualizarResumen()
  }

  function cambiarModo() {
    const modo = document.querySelector(`input[name="com-${prefijo}-modo"]:checked`)?.value
    $('est-lista').style.display = modo === 'algunos' ? 'flex' : 'none'
    actualizarResumen()
  }

  async function enviar() {
    if (window.APP_CONFIG?.plan !== 'avanzado') {
      toast('Enviar comunicados requiere el plan avanzado. Solicítalo al administrador.', 'warning')
      return
    }
    const perfil    = getPerfil()
    const asunto    = $('asunto').value.trim()
    const contenido = $('contenido').value.trim()
    const categoria = $('categoria').value
    const d = destino()

    if (!d) { toast('Elige el destino y a quién se envía', 'warning'); return }
    if (!d.ids.length) {
      toast(d.modo === 'algunos' ? 'Marca al menos un estudiante' : 'No hay estudiantes en este destino', 'warning')
      return
    }
    if (!asunto || !contenido) { toast('Completa asunto y contenido', 'warning'); return }

    const ok = await confirmar('Confirmar envío',
      `¿Seguro que deseas enviar "${asunto}" a ${texto(d)}?`, 'Sí, enviar', 'Revisar')
    if (!ok) return

    const g = d.g
    const individual = d.modo === 'algunos' && d.ids.length === 1
    const fila = {
      colegio_id: perfil.colegio_id, emisor_id: perfil.id, tipo_emisor: tipoEmisor,
      tipo_destinatario:   g.tipo === 'colegio' ? 'colegio' : individual ? 'estudiante' : 'curso',
      destinatario_id:     g.tipo === 'colegio' ? null : individual ? d.ids[0] : (g.tipo === 'curso' ? g.cursoId : null),
      materia_id:          g.tipo === 'tec' ? g.materiaId : null,
      destinatario_nombre: g.tipo === 'colegio' ? 'Todo el colegio'
        : individual ? d.nombres[0]
        : d.modo === 'todos' ? `${nombreDestino(g)} (todos)` : `${nombreDestino(g)} (${d.ids.length} estudiantes)`,
      asunto, contenido, categoria,
    }

      mostrarLoader('Enviando comunicado...')
    try {
      // Todo o nada (migración 117): el comunicado y todos sus destinatarios se guardan juntos.
      // Si algo falla no se guarda nada y el formulario queda abierto para reintentar.
      const { error } = await supabase.rpc('enviar_comunicado', { p_comunicado: fila, p_estudiantes: d.ids })
      if (error) throw error
      toast(`Comunicado enviado a ${d.ids.length} estudiante(s)`, 'success')
      modal().classList.add('hidden')
      onEnviado?.()
    } catch (e) {
      console.error('[comunicados] envío', e)
      toast('No se pudo enviar. No se guardó nada: revisa tu conexión e intenta de nuevo.', 'error')
    } finally { ocultarLoader() }
  }

  return { abrir, cambiarGrupo, cambiarModo, actualizarResumen, enviar }
}

// ─── Destinos de cada panel ──────────────────────────────────────────────────

// Profesor: sus cursos de materias regulares y sus ramas técnicas
// (solo los paralelos que tiene asignados en cada rama).
export async function gruposProfesor(perfil) {
  const { data, error } = await supabase.from('asignaciones_profesor')
    .select('curso_id, materia_id, cursos(nombre_completo), materias(nombre, es_tecnica)')
    .eq('profesor_id', perfil.id).eq('activo', true)
  if (error) throw error
  const m = {}
  ;(data ?? []).forEach(a => {
    if (a.materias?.es_tecnica) {
      const k = `tec:${a.materia_id}`
      m[k] ??= { tipo: 'tec', key: k, materiaId: a.materia_id, nombre: `${a.materias.nombre} (rama técnica)`, cursos: [], elegirCursos: true }
      m[k].cursos.push(a.curso_id)
    } else {
      const k = `curso:${a.curso_id}`
      m[k] ??= { tipo: 'curso', key: k, cursoId: a.curso_id, nombre: a.cursos?.nombre_completo ?? 'Curso' }
    }
  })
  return Object.values(m).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
}

// Director: todo el colegio, cada curso activo y cada rama técnica completa.
export async function gruposDirector(perfil) {
  const [rc, rt] = await Promise.all([
    supabase.from('cursos').select('id, nombre_completo').eq('activo', true)
      .eq('colegio_id', perfil.colegio_id).order('nombre_completo'),
    supabase.from('materias').select('id, nombre').eq('es_tecnica', true).eq('activo', true)
      .eq('colegio_id', perfil.colegio_id).order('nombre'),
  ])
  if (rc.error) throw rc.error
  return [
    { tipo: 'colegio', key: 'colegio', nombre: '📢 Todo el colegio' },
    ...(rc.data ?? []).map(c => ({ tipo: 'curso', key: `curso:${c.id}`, cursoId: c.id, nombre: c.nombre_completo })),
    ...(rt.error ? [] : (rt.data ?? []).map(t => ({ tipo: 'tec', key: `tec:${t.id}`, materiaId: t.id, nombre: `${t.nombre} (rama técnica)`, elegirCursos: true }))),
  ]
}