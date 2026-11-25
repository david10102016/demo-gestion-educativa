// js/utils/informe-aprobados-reprobados.js
// Informe de Aprobados y Reprobados — Panel del Profesor
// Adaptado al sistema Gestión Educativa 2027
// Lee selectores: selector-curso-global, selector-materia-global, selector-periodo-global
// Usa window._profesorPerfil para identificar al profesor
// ─────────────────────────────────────────────────────────
import { supabase } from '../config/supabase-config.js'
import { escapeHtml } from '../utils/sanitize.js'
import { notaOficial, fmtNota, tituloExacto, trimestreCerrado } from './estado-notas.js'
import { Config } from '../config/config-app.js'
import { cursosDelGrado } from './tecnica-grado.js'
(function () {

  const _obsCache = { general: '', individuales: {} }
  const _colsOcultas = new Set()

  // ─── HELPERS ─────────────────────────────────────────────
  function _getSelectors() {
    const cs = document.getElementById('selector-curso-global')
    const ms = document.getElementById('selector-materia-global')
    const ps = document.getElementById('selector-periodo-global')
    return {
      cursoId:       cs?.value || '',
      materiaId:     ms?.value || '',
      periodo:       parseInt(ps?.value || '1'),
      cursoNombre:   cs?.options[cs.selectedIndex]?.text || '',
      materiaNombre: ms?.options[ms.selectedIndex]?.text || '',
    }
  }

  function _getPerfil() { return window._profesorPerfil || null }

  function _getConfig() {
    const cfg = window.APP_CONFIG
    const dims = cfg?.dimensiones ?? [
      { codigo: 'hacer',   nombre: 'HACER',   peso_maximo: 40, tipo: 'actividades' },
      { codigo: 'saber',   nombre: 'SABER',   peso_maximo: 45, tipo: 'actividades' },
      { codigo: 'ser',     nombre: 'SER',     peso_maximo: 10, tipo: 'ficha'       },
      { codigo: 'decidir', nombre: 'DECIDIR', peso_maximo:  5, tipo: 'directo'     },
    ]
    return {
      notaMinima:    cfg?.nota_minima        ?? 51,
      etiqAprobado:  cfg?.etiqueta_aprobado  ?? 'APROBADO',
      etiqReprobado: cfg?.etiqueta_reprobado ?? 'REPROBADO',
      nombrePeriodo: cfg?.nombre_periodo     ?? 'Trimestre',
      año:           cfg?.año ?? new Date().getFullYear(),
      dims,
    }
  }

  // ─── CARGA DE DATOS SUPABASE ─────────────────────────────
  async function _cargarDatos() {
    const { cursoId, materiaId, periodo, cursoNombre, materiaNombre } = _getSelectors()
    const perfil = _getPerfil()
    const cfg    = _getConfig()

    if (!cursoId || !materiaId) return null

    const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    const esTecnica = materiaInfo?.es_tecnica === true

    // Actividades del profesor para este curso/materia/periodo
    let qActs = supabase.from('actividades')
      .select('id, tipo, max_puntos')
      .eq('materia_id', materiaId)
      .eq('trimestre', periodo)
    qActs = esTecnica ? qActs.in('curso_id', await cursosDelGrado(cursoId)) : qActs.eq('curso_id', cursoId)
    if (perfil?.id) qActs = qActs.eq('creado_por', perfil.id)
    const { data: actividades } = await qActs
    const acts = actividades ?? []

    // Notas
    const actIds = acts.map(a => a.id)
    let notasMap = {}
    if (actIds.length) {
      const { data: notas } = await supabase.from('notas')
        .select('actividad_id, estudiante_id, valor')
        .in('actividad_id', actIds)
      ;(notas ?? []).forEach(n => { notasMap[`${n.actividad_id}_${n.estudiante_id}`] = Number(n.valor) })
    }

    // Estudiantes
    // Estudiantes
    let estudiantesRaw
    if (esTecnica) {
      const { data } = await supabase.from('inscripciones_tecnicas')
        .select('estudiante_id, estudiantes!inner(id, curso_id, usuarios(nombre_completo))')
        .eq('materia_id', materiaId)
        .eq('activo', true)
        .in('estudiantes.curso_id', await cursosDelGrado(cursoId))
      estudiantesRaw = (data ?? []).map(i => ({ id: i.estudiante_id, usuarios: i.estudiantes?.usuarios }))
    } else {
      const { data } = await supabase.from('estudiantes')
        .select('id, usuarios(nombre_completo)')
        .eq('curso_id', cursoId)
      estudiantesRaw = data
    }
    const estudiantes = (estudiantesRaw ?? []).sort((a, b) =>
      (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

    // Calificaciones SER/DECIDIR
    const estIds = estudiantes.map(e => e.id)
    let calMap = {}
    if (estIds.length) {
      const { data: cals } = await supabase.from('calificaciones')
        .select('estudiante_id, nota_ser, nota_decidir')
        .eq('materia_id', materiaId)
        .eq('trimestre', periodo)
        .in('estudiante_id', estIds)
      ;(cals ?? []).forEach(c => { calMap[c.estudiante_id] = c })
    }

    // Notas finales (si ya están calculadas)
    let nfMap = {}
    if (estIds.length) {
      const { data: nf } = await supabase.from('notas_finales')
        .select('estudiante_id, nota_final, estado, promedio_hacer, promedio_saber, nota_ser, nota_decidir')
        .eq('materia_id', materiaId)
        .eq('trimestre', periodo)
        .in('estudiante_id', estIds)
      ;(nf ?? []).forEach(n => { nfMap[n.estudiante_id] = n })
    }

    // Colegio
    let colegio = ''
    try {
      const { data: col } = await supabase.from('colegios').select('nombre').limit(1)
      colegio = col?.[0]?.nombre ?? ''
    } catch (_) {}

    // ── Calcular nota por estudiante ──────────────────────
    const calcEstudiante = (est) => {
      const nf  = nfMap[est.id]
      const cal = calMap[est.id]
      const row = {}

      cfg.dims.forEach(dim => {
        let nota = null
        if (nf) {
          nota = parseFloat(nf[`promedio_${dim.codigo}`] ?? nf[`nota_${dim.codigo}`] ?? 0)
        } else {
          const dimActs = acts.filter(a => a.tipo === dim.codigo)
          if (dim.tipo === 'actividades' && dimActs.length) {
            const vals = dimActs.map(a => {
              const v = notasMap[`${a.id}_${est.id}`]
              return v !== undefined ? (v / Number(a.max_puntos)) * dim.peso_maximo : null
            }).filter(v => v !== null)
            if (vals.length) nota = vals.reduce((s,v)=>s+v,0) / vals.length
          } else if (dim.tipo === 'ficha') {
            nota = cal?.nota_ser    != null ? parseFloat(cal.nota_ser)    : null
          } else if (dim.tipo === 'directo') {
            nota = cal?.nota_decidir != null ? parseFloat(cal.nota_decidir) : null
          }
        }
        row[dim.codigo] = nota != null ? Math.round(nota * 100) / 100 : null
        row[`${dim.codigo}Max`] = dim.peso_maximo
      })

      const total = cfg.dims.reduce((s, dim) => s + (row[dim.codigo] ?? 0), 0)
      row.total    = Math.round(total * 100) / 100          // exacto (tooltip)
      row.aprobado = notaOficial(total) >= cfg.notaMinima   // decide con la nota redondeada
      row.nombre   = est.usuarios?.nombre_completo ?? '—'
      row.tieneNotas = cfg.dims.some(d => row[d.codigo] !== null)
      return row
    }

    const todos      = estudiantes.map(calcEstudiante).filter(e => e.tieneNotas)
    const aprobados  = todos.filter(e => e.aprobado)
    const reprobados = todos.filter(e => !e.aprobado)

    // Trimestre abierto: no se afirma Aprobado/Reprobado (solo al cerrar el director)
    const abierto = !trimestreCerrado(periodo, { trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada })
    if (abierto) { cfg.etiqAprobado = 'EN CURSO'; cfg.etiqReprobado = 'EN RIESGO' }
    cfg.lblApr = abierto ? 'En curso' : 'Aprobados'
    cfg.lblRep = abierto ? 'En riesgo' : 'Reprobados'

    return {
      perfil, colegio, cursoNombre, materiaNombre, periodo, cfg, abierto,
      todos, aprobados, reprobados, total: todos.length
    }
  }

  // ─── MODAL ───────────────────────────────────────────────
  function _crearModal() {
    if (document.getElementById('modal-apr')) return
    const m = document.createElement('div')
    m.id = 'modal-apr'
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9000;padding:16px;'
    m.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:960px;max-height:95vh;overflow-y:auto;font-family:'Segoe UI',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="background:linear-gradient(135deg,#065f46,#059669);border-radius:16px 16px 0 0;padding:20px 28px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="color:#a7f3d0;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;">INFORME</div>
            <h2 style="color:#fff;font-size:18px;font-weight:800;margin:0;">📊 Aprobados y Reprobados</h2>
            <p style="color:#d1fae5;font-size:12px;margin:4px 0 0;" id="apr-subtitulo">—</p>
          </div>
          <button id="apr-cerrar" style="background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:8px;width:36px;height:36px;font-size:20px;cursor:pointer;">×</button>
        </div>

        <div style="display:flex;align-items:center;gap:8px;padding:10px 24px;border-bottom:2px solid #e5e7eb;background:#f8fafc;flex-wrap:wrap;">
          <span style="font-size:12px;font-weight:600;color:#374151;">Mostrar:</span>
          <button id="apr-btn-todos"      style="padding:6px 14px;border-radius:99px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:#374151;color:#fff;">Todos</button>
          <button id="apr-btn-aprobados"  style="padding:6px 14px;border-radius:99px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:#f0fdf4;color:#065f46;">✅ Solo aprobados</button>
          <button id="apr-btn-reprobados" style="padding:6px 14px;border-radius:99px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:#fff1f2;color:#991b1b;">❌ Solo reprobados</button>
          <span id="apr-badge" style="margin-left:auto;font-size:11px;font-weight:700;padding:4px 12px;border-radius:99px;background:#f3f4f6;color:#374151;">—</span>
        </div>

        <div style="padding:24px 28px;">
          <div id="apr-encabezado"></div>
          <div id="apr-resumen" style="margin:16px 0;"></div>
          <div id="apr-tabla"   style="margin:16px 0;"></div>
          <div id="apr-obs"     style="margin:16px 0;"></div>
        </div>

        <div style="border-top:1px solid #e5e7eb;padding:14px 28px;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc;border-radius:0 0 16px 16px;">
          <button onclick="window.print()" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-size:13px;">🖨️ Imprimir</button>
          <button id="apr-cancelar" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-size:13px;">Cerrar</button>
          <button id="apr-pdf" style="background:linear-gradient(135deg,#065f46,#059669);color:#fff;border:none;border-radius:8px;padding:9px 22px;font-weight:700;cursor:pointer;font-size:13px;">📄 Exportar PDF</button>
        </div>
      </div>
      <style>
        @media print {
          body>*:not(#modal-apr){display:none!important;}
          #modal-apr{position:static!important;background:#fff!important;}
          #modal-apr>div{box-shadow:none!important;max-height:none!important;border-radius:0!important;}
          #apr-cerrar,#apr-cancelar,#apr-pdf,[onclick*="print"],#apr-btn-todos,#apr-btn-aprobados,#apr-btn-reprobados,.apr-remove-btn{display:none!important;}
          @page{size:letter portrait;margin:.5in;}
        }
        .apr-remove-btn{background:none;border:none;color:#f87171;font-weight:bold;font-size:1.1rem;cursor:pointer;padding:0 4px;flex-shrink:0;}
        .apr-remove-btn:hover{color:#dc2626;}
      </style>
    `
    document.body.appendChild(m)
  }

  // ─── ABRIR MODAL ─────────────────────────────────────────
  async function abrirInformeAprobados() {
    _crearModal()
    const modal = document.getElementById('modal-apr')
    modal.style.display = 'flex'
    _colsOcultas.clear()
    _obsCache.general = ''
    _obsCache.individuales = {}

    const { materiaNombre, cursoNombre, periodo } = _getSelectors()
    const cfg = _getConfig()
    document.getElementById('apr-subtitulo').textContent =
      `${materiaNombre} — ${cfg.nombrePeriodo} ${periodo} — ${cursoNombre}`

    document.getElementById('apr-cerrar').onclick   = () => { modal.style.display = 'none' }
    document.getElementById('apr-cancelar').onclick = () => { modal.style.display = 'none' }

    document.getElementById('apr-resumen').innerHTML =
      '<div style="text-align:center;padding:40px;color:#6b7280;">⏳ Cargando datos...</div>'
    document.getElementById('apr-tabla').innerHTML   = ''
    document.getElementById('apr-obs').innerHTML     = ''
    document.getElementById('apr-encabezado').innerHTML = ''

    const datos = await _cargarDatos()
    if (!datos) {
      document.getElementById('apr-resumen').innerHTML =
        '<div style="color:#991b1b;padding:20px;background:#fee2e2;border-radius:10px;">Selecciona curso y materia antes de generar el informe.</div>'
      return
    }

    let filtroActual = 'todos'
    document.getElementById('apr-btn-aprobados').textContent  = `Solo ${datos.cfg.lblApr.toLowerCase()}`
    document.getElementById('apr-btn-reprobados').textContent = `Solo ${datos.cfg.lblRep.toLowerCase()}`

    _renderEncabezado(datos)
    _renderResumen(datos)
    _renderTabla(datos, filtroActual)
    _renderObs(datos, filtroActual)
    _actualizarBadge(datos, filtroActual)

    const _cambiarFiltro = (f) => {
      filtroActual = f
      _guardarObs()
      _renderTabla(datos, f)
      _renderObs(datos, f)
      _actualizarBadge(datos, f)
      const estilos = {
        todos:      { bg: '#374151', color: '#fff' },
        aprobados:  { bg: '#059669', color: '#fff' },
        reprobados: { bg: '#dc2626', color: '#fff' },
      }
      ;['todos','aprobados','reprobados'].forEach(b => {
        const el = document.getElementById(`apr-btn-${b}`)
        if (!el) return
        if (b === f) { el.style.background = estilos[b].bg; el.style.color = estilos[b].color }
        else { el.style.background = b==='aprobados'?'#f0fdf4':b==='reprobados'?'#fff1f2':'#f3f4f6'; el.style.color = b==='aprobados'?'#065f46':b==='reprobados'?'#991b1b':'#374151' }
      })
    }

    document.getElementById('apr-btn-todos').onclick      = () => _cambiarFiltro('todos')
    document.getElementById('apr-btn-aprobados').onclick  = () => _cambiarFiltro('aprobados')
    document.getElementById('apr-btn-reprobados').onclick = () => _cambiarFiltro('reprobados')

    document.getElementById('apr-pdf').onclick = () => {
      _guardarObs()
      _exportarPDF(datos, filtroActual, _leerEncabezado())
    }
  }

  function _guardarObs() {
    const gen = document.getElementById('apr-obs-general')
    if (gen) _obsCache.general = gen.value
    document.querySelectorAll('.apr-obs-ind').forEach(ta => {
      if (ta.dataset.nombre) _obsCache.individuales[ta.dataset.nombre] = ta.value
    })
  }

  // ─── ENCABEZADO ──────────────────────────────────────────
  function _renderEncabezado(datos) {
    const { perfil, colegio, cursoNombre, materiaNombre, periodo, cfg } = datos
    const nombre = (perfil?.nombre_completo ?? '').toUpperCase()
    document.getElementById('apr-encabezado').innerHTML = `
      <div style="display:grid;gap:8px;margin-bottom:16px;font-size:13px;">
        <div style="display:flex;gap:8px;">
          <input id="apr_titulo" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;flex:1;font-size:13px;"
            value="INFORME DE APROBADOS Y REPROBADOS — ${cfg.nombrePeriodo} ${periodo}">
          <input id="apr_fecha" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;width:140px;font-size:13px;"
            value="${new Date().toLocaleDateString('es-BO')}">
        </div>
        ${[
          ['apr_de',    'De',    nombre],
          ['apr_para',  'Para',  'Comisión Técnico-Pedagógica'],
          ['apr_ue',    'U.E.',  colegio],
          ['apr_ref',   'Ref.',  'INFORME DE RESULTADOS ACADÉMICOS DEL TRIMESTRE'],
          ['apr_curso', 'Curso', cursoNombre],
          ['apr_area',  'Área',  materiaNombre],
        ].map(([id, lbl, val]) => `
          <div id="row-${id}" style="display:flex;gap:8px;align-items:center;">
            <button onclick="document.getElementById('row-${id}').remove()" style="background:none;border:none;color:#f87171;font-weight:bold;font-size:1.1rem;cursor:pointer;padding:0 4px;flex-shrink:0;">×</button>
            <label style="width:80px;font-weight:600;color:#374151;flex-shrink:0;">${lbl}</label>
            <input id="${id}" style="border:1px solid #d1d5db;border-radius:8px;padding:7px 12px;flex:1;font-size:13px;" value="${val}">
          </div>`).join('')}
      </div>`
  }

  function _leerEncabezado() {
    const v = id => document.getElementById(id)?.value || ''
    return { titulo: v('apr_titulo'), fecha: v('apr_fecha'), de: v('apr_de'), para: v('apr_para'), ue: v('apr_ue'), ref: v('apr_ref'), curso: v('apr_curso'), area: v('apr_area') }
  }

  // ─── RESUMEN ─────────────────────────────────────────────
  function _renderResumen(datos) {
    const { total, aprobados, reprobados, cfg } = datos
    const pct = total > 0 ? ((aprobados.length / total) * 100).toFixed(0) : 0
    document.getElementById('apr-resumen').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
        ${[
          ['Total',        total,             '#374151', '#f9fafb', '#e5e7eb'],
          [cfg.lblApr,     aprobados.length,  '#065f46', '#f0fdf4', '#bbf7d0'],
          [cfg.lblRep,     reprobados.length, '#991b1b', '#fff1f2', '#fecdd3'],
          [datos.abierto ? '% Sobre la mínima' : '% Aprobación', pct+'%', '#1d4ed8', '#eff6ff', '#bfdbfe'],
        ].map(([lbl,val,color,bg,border]) => `
          <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:${color};">${val}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:4px;">${lbl}</div>
          </div>`).join('')}
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:12px;color:#1e40af;margin-top:10px;">
        <strong>Nota mínima de aprobación:</strong> ${cfg.notaMinima} pts sobre 100.
        Los datos mostrados corresponden a las notas registradas hasta el momento.
      </div>
      ${datos.abierto ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;margin-top:8px;">
        <strong>Trimestre en curso:</strong> los resultados son provisionales. Aprobado / Reprobado se define cuando el director cierra el trimestre.
      </div>` : ''}`
  }

  function _actualizarBadge(datos, filtro) {
    const badge = document.getElementById('apr-badge')
    if (!badge) return
    const map = {
      todos:      { text: `${datos.total} estudiantes`,         bg: '#f3f4f6', color: '#374151' },
      aprobados:  { text: `${datos.aprobados.length} ${datos.cfg.lblApr.toLowerCase()}`,  bg: '#d1fae5', color: '#065f46' },
      reprobados: { text: `${datos.reprobados.length} ${datos.cfg.lblRep.toLowerCase()}`, bg: '#fee2e2', color: '#991b1b' },
    }
    const s = map[filtro]
    badge.textContent = s.text
    badge.style.background = s.bg
    badge.style.color = s.color
  }

  // ─── TABLA ───────────────────────────────────────────────
  function _renderTabla(datos, filtro) {
    const { cfg } = datos
    const lista = filtro === 'aprobados' ? datos.aprobados : filtro === 'reprobados' ? datos.reprobados : datos.todos

    if (!lista.length) {
      document.getElementById('apr-tabla').innerHTML =
        `<div style="text-align:center;padding:20px;font-weight:600;color:${filtro==='aprobados'?'#065f46':'#991b1b'};">
          ${filtro === 'aprobados' ? `— Sin ${cfg.lblApr.toLowerCase()} —` : `Sin ${cfg.lblRep.toLowerCase()}`}
        </div>`
      return
    }

    const colsVisibles = cfg.dims.filter(d => !_colsOcultas.has(d.codigo) && lista.some(e => e[d.codigo] !== null))

    const colorCab = filtro === 'reprobados' ? '#991b1b' : filtro === 'aprobados' ? '#065f46' : '#374151'

    window._aprOcultarCol = (codigo) => { _colsOcultas.add(codigo); _renderTabla(datos, filtro) }

    const cabCols = colsVisibles.map(d => `
      <th style="padding:10px 12px;text-align:center;">
        ${d.nombre} /${d.peso_maximo}
        <button onclick="window._aprOcultarCol('${d.codigo}')"
          style="background:#ef4444;border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;margin-left:6px;line-height:18px;">×</button>
      </th>`).join('')

    let html = `
      <h3 style="font-size:14px;font-weight:700;color:#374151;margin-bottom:10px;">
        ${filtro === 'aprobados' ? cfg.lblApr : filtro === 'reprobados' ? cfg.lblRep : 'Todos los estudiantes'}
        <span style="font-size:12px;font-weight:400;color:#6b7280;">(nota mínima: ${cfg.notaMinima} pts)</span>
      </h3>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:${colorCab};color:#fff;">
            <th style="padding:10px 12px;">N°</th>
            <th style="padding:10px 12px;text-align:left;">Estudiante</th>
            ${cabCols}
            <th style="padding:10px 12px;">TOTAL /100</th>
            <th style="padding:10px 12px;">ESTADO</th>
          </tr>
        </thead>
        <tbody>`

    lista.forEach((e, i) => {
      const bg = !e.aprobado ? '#fef2f2' : i % 2 === 0 ? '#fff' : '#f9fafb'
      const celdas = colsVisibles.map(d => {
        const v = e[d.codigo]
        return `<td style="padding:8px 12px;text-align:center;" title="${tituloExacto(v)}">${fmtNota(v)}</td>`
      }).join('')
      html += `
        <tr style="background:${bg};">
          <td style="padding:8px 12px;text-align:center;">${i+1}</td>
          <td style="padding:8px 12px;font-weight:600;color:${!e.aprobado?'#991b1b':'#374151'};">${escapeHtml(e.nombre)}</td>
          ${celdas}
          <td style="padding:8px 12px;text-align:center;font-weight:800;color:${e.aprobado?'#065f46':'#991b1b'};" title="${tituloExacto(e.total)}">${fmtNota(e.total)}</td>
          <td style="padding:8px 12px;text-align:center;">
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${e.aprobado?'#d1fae5':'#fee2e2'};color:${e.aprobado?'#065f46':'#991b1b'};">
              ${e.aprobado ? cfg.etiqAprobado : cfg.etiqReprobado}
            </span>
          </td>
        </tr>`
    })

    html += '</tbody></table></div>'
    if (_colsOcultas.size > 0) {
      const ocultas = cfg.dims.filter(d=>_colsOcultas.has(d.codigo)).map(d=>d.nombre).join(', ')
      html += `<p style="font-size:11px;color:#9ca3af;margin-top:4px;font-style:italic;">Columnas ocultas en PDF: ${ocultas}</p>`
    }
    document.getElementById('apr-tabla').innerHTML = html
  }

  // ─── OBSERVACIONES ───────────────────────────────────────
  function _renderObs(datos, filtro) {
    const el = document.getElementById('apr-obs')
    if (!el) return
    const { reprobados, perfil } = datos
    if ((filtro !== 'todos' && filtro !== 'reprobados') || !reprobados.length) { el.innerHTML = ''; return }

    let html = `
      <div id="apr-obs-gen-row" style="display:flex;gap:8px;align-items:flex-start;border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:10px;">
        <button class="apr-remove-btn" onclick="document.getElementById('apr-obs-gen-row').remove()">×</button>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:6px;">Observación General</div>
          <textarea id="apr-obs-general" rows="3" placeholder="Observación general..."
            style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:12px;resize:vertical;"
          >${escapeHtml(_obsCache.general)}</textarea>
        </div>
      </div>
      <div id="apr-obs-container" style="display:grid;gap:8px;">`

    reprobados.forEach((e, i) => {
      const saved = _obsCache.individuales[e.nombre] || ''
      html += `
        <div id="apr-obs-row-${i}" style="display:flex;gap:8px;align-items:flex-start;border:1px solid #fecdd3;border-radius:10px;padding:10px;">
          <button class="apr-remove-btn" onclick="document.getElementById('apr-obs-row-${i}').remove()">×</button>
          <label style="font-size:12px;font-weight:600;width:220px;flex-shrink:0;padding-top:4px;color:#991b1b;">${escapeHtml(e.nombre)}</label>
          <textarea data-nombre="${escapeHtml(e.nombre)}" rows="2" placeholder="Observación..."
            class="apr-obs-ind"
            style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:12px;resize:vertical;"
          >${escapeHtml(saved)}</textarea>
        </div>`
    })

    html += `</div>
      <div id="apr-pie-row" style="display:flex;gap:8px;align-items:center;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-top:10px;">
        <button class="apr-remove-btn" onclick="document.getElementById('apr-pie-row').remove()">×</button>
        <label style="font-size:12px;font-weight:600;width:130px;flex-shrink:0;">Maestro del Área</label>
        <input id="apr-maestro-pie" style="border:1px solid #d1d5db;border-radius:8px;padding:7px 12px;flex:1;font-size:12px;"
          value="${(perfil?.nombre_completo ?? '').toUpperCase()}">
      </div>`

    el.innerHTML = html
  }

  // ─── EXPORTAR PDF ────────────────────────────────────────
  function _exportarPDF(datos, filtro, enc) {
    if (!window.jspdf?.jsPDF) { alert('jsPDF no disponible'); return }
    const { jsPDF } = window.jspdf
    const { cfg } = datos
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const mg = 14, aw = doc.internal.pageSize.getWidth() - mg * 2
    let y = 14

    // Header
    const hColor = filtro === 'aprobados' ? [6,95,70] : filtro === 'reprobados' ? [153,27,27] : [55,65,81]
    doc.setFillColor(...hColor); doc.rect(0,0,220,24,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(enc.titulo, mg, 11)
    doc.setFontSize(8); doc.setFont('helvetica','normal')
    doc.text(`${enc.fecha} | ${enc.ue}`, mg, 18)
    doc.setTextColor(0,0,0); y = 30

    const campos = [['De', enc.de], ['Para', enc.para], ['Ref.', enc.ref], ['Curso', enc.curso], ['Área', enc.area]]
    campos.filter(([,v])=>v).forEach(([lbl, val]) => {
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(`${lbl}:`, mg, y)
      doc.setFont('helvetica','normal')
      const lines = doc.splitTextToSize(val, aw - 40); doc.text(lines, mg + 40, y); y += lines.length * 5.5
    })
    y += 4

    doc.setFont('helvetica','bold'); doc.setFontSize(9)
    doc.text(`Total: ${datos.total} | ${cfg.lblApr}: ${datos.aprobados.length} | ${cfg.lblRep}: ${datos.reprobados.length} | Nota mínima: ${cfg.notaMinima} pts`, mg, y); y += 7
    if (datos.abierto) {
      doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(146,64,14)
      doc.text('Trimestre en curso: resultados provisionales. Aprobado/Reprobado se define al cierre del trimestre.', mg, y)
      doc.setTextColor(0,0,0); y += 6
    }

    const lista = filtro === 'aprobados' ? datos.aprobados : filtro === 'reprobados' ? datos.reprobados : datos.todos
    const colsV = cfg.dims.filter(d => !_colsOcultas.has(d.codigo) && lista.some(e => e[d.codigo] !== null))

    doc.autoTable({
      head: [['N°', 'Estudiante', ...colsV.map(d=>`${d.nombre} /${d.peso_maximo}`), 'TOTAL', 'ESTADO']],
      body: lista.map((e,i) => [
        i+1, e.nombre,
        ...colsV.map(d => fmtNota(e[d.codigo])),
        fmtNota(e.total),
        e.aprobado ? cfg.etiqAprobado : cfg.etiqReprobado
      ]),
      startY: y, margin: { left: mg, right: mg },
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: hColor, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248,248,248] },
      didParseCell: d => {
        if (d.section === 'body') {
          const e = lista[d.row.index]
          const lastIdx = colsV.length + 3
          if (d.column.index === lastIdx) { d.cell.styles.textColor = e?.aprobado ? [6,95,70] : [153,27,27]; d.cell.styles.fontStyle = 'bold' }
          if (!e?.aprobado) d.cell.styles.fillColor = [254,242,242]
        }
      }
    })
    y = doc.lastAutoTable.finalY + 8

    const obsGen = _obsCache.general || document.getElementById('apr-obs-general')?.value || ''
    if (obsGen) {
      if (y > 240) { doc.addPage(); y = 14 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('OBSERVACIÓN GENERAL:', mg, y); y += 5
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5)
      const lines = doc.splitTextToSize(obsGen, aw); doc.text(lines, mg, y); y += lines.length * 5 + 3
    }

    const obsInds = Object.entries(_obsCache.individuales).filter(([,v])=>v.trim())
    if (obsInds.length) {
      if (y > 240) { doc.addPage(); y = 14 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('OBSERVACIONES:', mg, y); y += 5
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5)
      obsInds.forEach(([nombre, texto]) => {
        if (y > 260) { doc.addPage(); y = 14 }
        const lines = doc.splitTextToSize(`- ${nombre}: ${texto}`, aw)
        doc.text(lines, mg, y); y += lines.length * 5
      })
    }

    const pie = document.getElementById('apr-maestro-pie')?.value
    if (pie) {
      y += 14; if (y > 260) { doc.addPage(); y = 14 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('MAESTRO DEL ÁREA', mg + 55, y); y += 8
      doc.setFont('helvetica','normal'); doc.text(pie, mg + 55, y)
    }

    const cs = document.getElementById('selector-curso-global')
    const cn = cs?.options[cs.selectedIndex]?.text?.replace(/[^a-zA-Z0-9]/g,'_') ?? 'curso'
    doc.save(`aprobados-reprobados-${cn}-t${datos.periodo}-${new Date().toISOString().slice(0,10)}.pdf`)
  }

  // ─── EXPOSICIÓN GLOBAL ───────────────────────────────────
  window.abrirInformeAprobados      = abrirInformeAprobados
  window.mostrarInformeAprobados    = abrirInformeAprobados

})()