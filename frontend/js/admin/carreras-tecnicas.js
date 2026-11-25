// js/admin/carreras-tecnicas.js
// Gestión de inscripciones a carreras técnicas especializadas.
// Los estudiantes de 4to/5to/6to de diferentes paralelos (A, B, C)
// pueden inscribirse en una sola carrera (Sistemas, Gastronomía, etc.)
// Esta lógica es ADICIONAL a su materia regular — conservan su curso_id original.

import { supabase }                        from '../config/supabase-config.js'
import { Config }                          from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'

// ─── Estado del módulo ─────────────────────────────────────────
let parsedRows = []
// cada fila: { _row, carnet, nombre, cursoText, materiaText,
//              estudianteId, cursoId, materiaId, checked, status }
let _ctInitDone = false
let _inscripcionesCache = []

// ─── INIT ──────────────────────────────────────────────────────
export function initCarrerasTecnicas() {
  if (!Config.usaCarrerasTecnicas) return  // módulo desactivado para este colegio
  if (_ctInitDone) return

  const btnImport    = document.getElementById('ct-btn-importar')
  const inputFile    = document.getElementById('ct-input-file')
  const previewBody  = document.getElementById('ct-preview-body')
  const btnGuardar   = document.getElementById('ct-btn-guardar')
  const btnVer       = document.getElementById('ct-btn-ver')
  const btnEliminar  = document.getElementById('ct-btn-eliminar')
  const btnFaltantes = document.getElementById('ct-btn-crear-faltantes')

  if (!btnImport || !inputFile || !previewBody || !btnGuardar) return

  btnImport.addEventListener('click', () => inputFile.click())
  inputFile.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0]
    if (!f) return
    await handleFile(f)
    ev.target.value = ''
  })

  btnVer?.addEventListener('click', verInscripciones)
  btnEliminar?.addEventListener('click', eliminarSeleccionados)
  btnFaltantes?.addEventListener('click', crearFaltantes)
  btnGuardar.addEventListener('click', guardarInscripciones)
  _ctInitDone = true
}

// ─── VER INSCRIPCIONES ACTUALES ────────────────────────────────
async function verInscripciones() {
  mostrarLoader('Cargando inscripciones...')
  const { data, error } = await supabase
    .from('inscripciones_tecnicas')
    .select(`
      id,
      estudiante_id,
      materia_id,
      curso_id,
      estudiantes(carnet, usuarios(nombre_completo)),
      materias(nombre),
      cursos(nombre_completo)
    `)
    .eq('activo', true)
    .limit(500)
  ocultarLoader()

  if (error) { toast('No se pudieron cargar inscripciones', 'error'); return }
  if (!data?.length) { toast('No hay inscripciones técnicas registradas', 'info'); return }

  _inscripcionesCache = data.map(i => {
    const cursoNom = i.cursos?.nombre_completo ?? ''
    const { grado, paralelo } = _parseCursoNombre(cursoNom)
    return {
      id: i.id,
      carnet: i.estudiantes?.carnet ?? '',
      nombre: i.estudiantes?.usuarios?.nombre_completo ?? 'Sin datos',
      carrera: i.materias?.nombre ?? '—',
      curso: cursoNom || '—',
      grado,
      paralelo,
    }
  })

  const panel = document.getElementById('ct-panel-ver')
  if (!panel) return

  const carreras = [...new Set(_inscripcionesCache.map(r => r.carrera).filter(Boolean))].sort()
  const grados   = [...new Set(_inscripcionesCache.map(r => r.grado).filter(Boolean))].sort()
  const paralelos = [...new Set(_inscripcionesCache.map(r => r.paralelo).filter(Boolean))].sort()

  panel.innerHTML = `
    <div class="card" style="padding:16px;margin-top:8px;">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px;">
        <div>
          <label class="text-sm" style="display:block;margin-bottom:4px;">Carrera</label>
          <select id="ct-filtro-carrera" class="form-control" style="min-width:160px;">
            <option value="">Todas</option>
            ${carreras.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-sm" style="display:block;margin-bottom:4px;">Grado</label>
          <select id="ct-filtro-grado" class="form-control" style="min-width:120px;">
            <option value="">Todos</option>
            ${grados.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-sm" style="display:block;margin-bottom:4px;">Paralelo</label>
          <select id="ct-filtro-paralelo" class="form-control" style="min-width:100px;">
            <option value="">Todos</option>
            ${paralelos.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;min-width:160px;">
          <label class="text-sm" style="display:block;margin-bottom:4px;">Buscar</label>
          <input id="ct-filtro-buscar" class="form-control" type="search" placeholder="Nombre o carnet">
        </div>
      </div>
      <div id="ct-contadores" class="text-sm text-muted" style="margin-bottom:10px;"></div>
      <div style="overflow-x:auto; max-height:420px;">
        <table class="sp-table" id="ct-tabla-inscritos">
          <thead>
            <tr>
              <th>Carnet</th>
              <th>Estudiante</th>
              <th>Carrera / Materia</th>
              <th>Grado</th>
              <th>Paralelo origen</th>
            </tr>
          </thead>
          <tbody id="ct-tbody-inscritos"></tbody>
        </table>
      </div>
    </div>`

  panel.classList.remove('hidden')

  const onFiltro = () => renderInscripcionesFiltradas()
  document.getElementById('ct-filtro-carrera')?.addEventListener('change', onFiltro)
  document.getElementById('ct-filtro-grado')?.addEventListener('change', onFiltro)
  document.getElementById('ct-filtro-paralelo')?.addEventListener('change', onFiltro)
  document.getElementById('ct-filtro-buscar')?.addEventListener('input', onFiltro)

  renderInscripcionesFiltradas()
}

function _parseCursoNombre(nombre) {
  const t = (nombre || '').trim()
  if (!t) return { grado: '', paralelo: '' }
  // Ej: "3° Secundaria A", "6to Secundaria B", "4° A"
  const m = t.match(/^(\d+\s*[°ºo]?\s*(?:Secundaria|Primaria)?)\s*([A-Za-zÁÉÍÓÚáéíóú])?\s*$/i)
    || t.match(/^(.*?)\s+([A-Za-z])$/i)
  if (m) {
    return {
      grado: (m[1] || '').trim(),
      paralelo: (m[2] || '').trim().toUpperCase(),
    }
  }
  // fallback: última letra suelta = paralelo
  const m2 = t.match(/^(.*?)[\s\-]*([A-Za-z])$/i)
  if (m2 && m2[2].length === 1) {
    return { grado: m2[1].trim(), paralelo: m2[2].toUpperCase() }
  }
  return { grado: t, paralelo: '' }
}

function renderInscripcionesFiltradas() {
  const carrera  = document.getElementById('ct-filtro-carrera')?.value || ''
  const grado    = document.getElementById('ct-filtro-grado')?.value || ''
  const paralelo = document.getElementById('ct-filtro-paralelo')?.value || ''
  const q        = (document.getElementById('ct-filtro-buscar')?.value || '').trim().toLowerCase()

  const filtrados = _inscripcionesCache.filter(r => {
    if (carrera && r.carrera !== carrera) return false
    if (grado && r.grado !== grado) return false
    if (paralelo && r.paralelo !== paralelo) return false
    if (q) {
      const blob = `${r.nombre} ${r.carnet}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  const tbody = document.getElementById('ct-tbody-inscritos')
  const cont  = document.getElementById('ct-contadores')
  if (!tbody) return

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--color-text-3);">Sin resultados</td></tr>`
  } else {
    tbody.innerHTML = filtrados.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:12px">${escapeHtml(r.carnet || '—')}</td>
        <td>${escapeHtml(r.nombre)}</td>
        <td><strong>${escapeHtml(r.carrera)}</strong></td>
        <td>${escapeHtml(r.grado || '—')}</td>
        <td>${escapeHtml(r.paralelo || r.curso || '—')}</td>
      </tr>`).join('')
  }

  if (cont) {
    const porGrado = {}
    for (const r of filtrados) {
      const g = r.grado || 'Sin grado'
      porGrado[g] = (porGrado[g] || 0) + 1
    }
    const desglose = Object.entries(porGrado)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, n]) => `${escapeHtml(g)}: <strong>${n}</strong>`)
      .join(' · ')
    cont.innerHTML = `Total filtrado: <strong>${filtrados.length}</strong> / ${_inscripcionesCache.length} · ${desglose}`
  }
}
// ─── PROCESAR ARCHIVO EXCEL ────────────────────────────────────
async function handleFile(file) {
  mostrarLoader('Procesando archivo...')
  try {
    const data = await readFileAsync(file)
    const wb   = typeof data === 'string'
      ? XLSX.read(data, { type: 'string' })
      : XLSX.read(data, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (!rows?.length) {
      toast('Archivo vacío o formato no válido', 'warning')
      return
    }

    // Normalizar columnas — acepta variantes de nombres
    parsedRows = rows.map((r, i) => ({
      _row:        i + 1,
      carnet:      (r.carnet || r.Carnet || r.codigo || r.CARNET || '').toString().trim(),
      nombre:      (r.nombre_completo || r.Nombre || r.NOMBRE || '').toString().trim(),
      cursoText:   (r.curso_paralelo || r.curso || r.paralelo || '').toString().trim(),
      materiaText: (r.materia || r.materia_nombre || r.Materia || '').toString().trim(),
      estudianteId: null,
      cursoId:      null,
      materiaId:    null,
      checked:      true,
      status:       'pendiente'
    }))

    // Pre-cargar mapas desde BD
    const carnets = [...new Set(parsedRows.map(r => r.carnet).filter(Boolean))]

    const [
      { data: ests },
      { data: materias },
      { data: cursos }
    ] = await Promise.all([
      supabase.from('estudiantes')
        .select('id, carnet, curso_id')
        .in('carnet', carnets),
      supabase.from('materias')
        .select('id, nombre')
        .eq('es_tecnica', true)
        .eq('activo', true),
      supabase.from('cursos')
        .select('id, nombre_completo, paralelo, nivel, grado')
    ])

    const estMap  = new Map((ests    ?? []).map(e => [e.carnet, e]))
    const matMap  = new Map((materias ?? []).map(m => [m.nombre.trim().toLowerCase(), m.id]))
    const cursoMap = new Map()
    ;(cursos ?? []).forEach(c => {
      const nc = (c.nombre_completo || '').trim().toLowerCase()
      const pa = (c.paralelo        || '').trim().toLowerCase()
      if (nc && pa) {
        cursoMap.set(`${nc} ${pa}`, c.id)
        cursoMap.set(`${nc}-${pa}`, c.id)
        cursoMap.set(`${nc}${pa}`,  c.id)
      }
      if (pa) cursoMap.set(pa, c.id)
    })

    // Resolver cada fila
    parsedRows.forEach(r => {
      const est = estMap.get(r.carnet)
      if (est) {
        r.estudianteId = est.id
        r.cursoId      = est.curso_id   // conserva el paralelo original del estudiante
      } else {
        // Estudiante nuevo: intentar resolver curso desde el Excel
        const txt = r.cursoText.toLowerCase().trim()
        r.cursoId = cursoMap.get(txt) ?? null
      }

      // Resolver materia técnica
      const mid = matMap.get(r.materiaText.toLowerCase().trim())
      if (mid) r.materiaId = mid

      // Estado de la fila
      if (!r.carnet)          r.status = 'sin carnet'
      else if (!r.estudianteId) r.status = 'estudiante no encontrado'
      else if (!r.materiaId)  r.status = 'materia no encontrada'
      else                    r.status = 'listo'
    })

    renderPreview()
    toast(`${parsedRows.length} filas procesadas`, 'success')
  } catch (err) {
    console.error(err)
    toast('No se pudo procesar el archivo', 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── CREAR ESTUDIANTES FALTANTES ───────────────────────────────
async function crearFaltantes() {
  const faltantes = parsedRows.filter(r => r.checked && !r.estudianteId && r.carnet)
  if (!faltantes.length) { toast('No hay estudiantes faltantes seleccionados', 'info'); return }

  const ok = await confirmar(
    'Crear estudiantes faltantes',
    `Se crearán ${faltantes.length} estudiantes. ¿Continuar?`
  )
  if (!ok) return

  mostrarLoader('Creando estudiantes...')
  try {
    const { data: sesion } = await supabase.auth.getUser()
    const { data: perfil  } = await supabase
      .from('usuarios').select('colegio_id').eq('id', sesion.user.id).single()

    const toInsert = faltantes.map(r => ({
      colegio_id:     perfil?.colegio_id ?? null,
      carnet:         r.carnet,
      nombre_completo: r.nombre || r.carnet,
      curso_id:       r.cursoId ?? null,
      codigo_acceso:  generarCodigo(r.nombre || r.carnet),
      usuario_id:     null
    }))

    // Intento en bloque
    const { data: insertados, error } = await supabase
      .from('estudiantes').insert(toInsert).select('id, carnet')

    const resueltos = insertados ?? []

    if (error) {
      // Si falla el batch, intentar uno a uno
      for (const row of toInsert) {
        const { data: one, error: e1 } = await supabase
          .from('estudiantes').insert(row).select('id, carnet')
        if (e1) {
          const { data: ex } = await supabase
            .from('estudiantes').select('id, carnet').eq('carnet', row.carnet).limit(1)
          if (ex?.[0]) resueltos.push(ex[0])
        } else if (one?.[0]) resueltos.push(one[0])
      }
    }

    for (const rec of resueltos) {
      const match = parsedRows.find(p => p.carnet === rec.carnet)
      if (match) { match.estudianteId = rec.id; match.status = 'creado' }
    }

    renderPreview()
    toast(`${resueltos.length} estudiantes creados. Iniciando guardado...`, 'success')
    setTimeout(() => document.getElementById('ct-btn-guardar')?.click(), 400)
  } catch (err) {
    console.error(err)
    toast('No se pudieron crear los estudiantes', 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── ELIMINAR SELECCIONADOS ────────────────────────────────────
async function eliminarSeleccionados() {
  const selected = parsedRows.filter(r => r.checked && r.estudianteId)
  if (!selected.length) { toast('No hay estudiantes seleccionados para eliminar', 'info'); return }

  const ids = [...new Set(selected.map(s => s.estudianteId))]
  const ok  = await confirmar(
    'Eliminar inscripciones',
    `Se eliminarán las inscripciones técnicas de ${ids.length} estudiantes. ¿Continuar?`
  )
  if (!ok) return

  mostrarLoader('Eliminando...')
  try {
    const { error } = await supabase
      .from('inscripciones_tecnicas')
      .delete()
      .in('estudiante_id', ids)
    if (error) throw error

    parsedRows.forEach(r => {
      if (ids.includes(r.estudianteId)) r.status = 'inscripción eliminada'
    })
    renderPreview()
    toast('Inscripciones eliminadas', 'success')
  } catch (err) {
    console.error(err)
    toast('No se pudo completar la operación', 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── GUARDAR INSCRIPCIONES ─────────────────────────────────────
async function guardarInscripciones() {
  const { data: sesion } = await supabase.auth.getUser()
  const inscritosPor = sesion?.user?.id ?? null

  const candidatos = parsedRows
    .filter(r => r.checked && r.estudianteId && r.materiaId)
    .map(r => ({
      estudiante_id: r.estudianteId,
      materia_id:    r.materiaId,
      curso_id:      r.cursoId ?? null,
      inscrito_por:  inscritosPor
    }))

  if (!candidatos.length) {
    toast('No hay inscripciones válidas para guardar', 'info')
    return
  }

  // Deduplicar en memoria
  const seen    = new Set()
  const unicos  = candidatos.filter(c => {
    const k = `${c.estudiante_id}::${c.materia_id}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  mostrarLoader('Guardando inscripciones...')
  try {
    // Verificar cuáles ya existen en BD para no generar conflictos
    const estIds = [...new Set(unicos.map(u => u.estudiante_id))]
    const matIds = [...new Set(unicos.map(u => u.materia_id))]

    const { data: existentes } = await supabase
      .from('inscripciones_tecnicas')
      .select('estudiante_id, materia_id')
      .in('estudiante_id', estIds)
      .in('materia_id',    matIds)

    const existSet = new Set((existentes ?? []).map(x => `${x.estudiante_id}::${x.materia_id}`))
    const nuevos   = unicos.filter(u => !existSet.has(`${u.estudiante_id}::${u.materia_id}`))

    if (!nuevos.length) {
      toast('Todas las inscripciones ya existían', 'info')
      await refreshStatus()
      return
    }

    const { error } = await supabase
      .from('inscripciones_tecnicas')
      .insert(nuevos)

    if (error) {
      if (error.code === '23505') {
        toast('Algunas inscripciones ya existían y fueron ignoradas', 'info')
        await refreshStatus()
        return
      }
      throw error
    }

    toast(`✅ ${nuevos.length} inscripciones guardadas`, 'success')
    await refreshStatus()
  } catch (err) {
    console.error(err)
    toast('Error al guardar inscripciones. Ver consola.', 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── REFRESH STATUS DESPUÉS DE GUARDAR ─────────────────────────
async function refreshStatus() {
  const estIds = [...new Set(parsedRows.filter(r => r.estudianteId).map(r => r.estudianteId))]
  if (!estIds.length) return
  const { data: ins } = await supabase
    .from('inscripciones_tecnicas')
    .select('estudiante_id, materia_id')
    .in('estudiante_id', estIds)

  const set = new Set((ins ?? []).map(x => `${x.estudiante_id}::${x.materia_id}`))
  parsedRows.forEach(r => {
    if (r.estudianteId && r.materiaId && set.has(`${r.estudianteId}::${r.materia_id}`)) {
      r.status = 'inscrito ✅'
    }
  })
  renderPreview()
}

// ─── RENDER TABLA PREVIEW ──────────────────────────────────────
function renderPreview() {
  const body = document.getElementById('ct-preview-body')
  if (!body) return

  if (!parsedRows.length) {
    body.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">
      Sin filas. Importa un archivo Excel.</td></tr>`
    return
  }

  body.innerHTML = parsedRows.map(r => {
    const color = {
      'listo':                  '',
      'inscrito ✅':            'background:#f0fdf4',
      'estudiante no encontrado': 'background:#fef9c3',
      'materia no encontrada':  'background:#fef9c3',
      'sin carnet':             'background:#fee2e2',
      'creado':                 'background:#eff6ff',
    }[r.status] ?? ''

    return `<tr style="${color}">
      <td style="padding:8px 12px;font-size:12px;">${r._row}</td>
      <td style="padding:8px 12px;font-family:monospace;font-size:12px;">${escapeHtml(r.carnet || '—')}</td>
      <td style="padding:8px 12px;font-size:13px;">${escapeHtml(r.nombre || '—')}</td>
      <td style="padding:8px 12px;font-size:12px;">${escapeHtml(r.cursoText || '—')}</td>
      <td style="padding:8px 12px;font-size:12px;">${escapeHtml(r.materiaText || '—')}</td>
      <td style="padding:8px 12px;">
        <span class="badge ${
          r.status === 'listo' || r.status === 'inscrito ✅' ? 'badge-success' :
          r.status === 'creado' ? 'badge-info' : 'badge-warning'
        }">${r.status}</span>
      </td>
      <td style="padding:8px 12px;text-align:center;">
        <input type="checkbox" data-idx="${r._row - 1}" ${r.checked ? 'checked' : ''}>
      </td>
    </tr>`
  }).join('')

  body.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      parsedRows[Number(cb.dataset.idx)].checked = cb.checked
    })
  })
}

// ─── HELPERS ───────────────────────────────────────────────────
function readFileAsync(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = reject
    const name = (file?.name ?? '').toLowerCase()
    if (name.endsWith('.csv') || file.type === 'text/csv')
      reader.readAsText(file, 'utf-8')
    else
      reader.readAsArrayBuffer(file)
  })
}

function generarCodigo(nombre) {
  const iniciales = (nombre ?? '').toUpperCase().split(' ')
    .map(p => p[0] ?? '').join('').substring(0, 3)
  const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return iniciales + num || Math.random().toString(36).substring(2, 8).toUpperCase()
}