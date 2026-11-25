// js/utils/informe-bajo-rendimiento.js
// Informe de Bajo Rendimiento — Panel del Profesor
// Adaptado al sistema Gestión Educativa 2027
// Lee selectores: selector-curso-global, selector-materia-global, selector-periodo-global
// Usa window._profesorPerfil para identificar al profesor
// ─────────────────────────────────────────────────────────
import { supabase } from '../config/supabase-config.js'
import { fetchConCache } from './data-layer.js'
import { avisoOfflineInline } from './connection-status.js'
import { escapeHtml } from './sanitize.js'
import { notaOficial, fmtNota, tituloExacto } from './estado-notas.js'
import { cursosDelGrado } from './tecnica-grado.js'
(function () {

  const COLORES = {
    aprobado: '#10b981', riesgo: '#ef4444',
    hacer: '#f59e0b', saber: '#3b82f6',
    ser: '#8b5cf6', decidir: '#06b6d4', gris: '#e5e7eb'
  }

  const _charts = {}
  function _destroyChart(id) {
    if (_charts[id]) { try { _charts[id].destroy() } catch (_) {} delete _charts[id] }
  }

  // ─── HELPERS DE SELECTORES ───────────────────────────────
  function _getSelectors() {
    return {
      cursoId:    document.getElementById('selector-curso-global')?.value   || '',
      materiaId:  document.getElementById('selector-materia-global')?.value || '',
      periodo:    parseInt(document.getElementById('selector-periodo-global')?.value || '1'),
      cursoNombre:   document.getElementById('selector-curso-global')
                       ?.options[document.getElementById('selector-curso-global').selectedIndex]?.text || '',
      materiaNombre: document.getElementById('selector-materia-global')
                       ?.options[document.getElementById('selector-materia-global').selectedIndex]?.text || '',
    }
  }

  function _getPerfil() {
    return window._profesorPerfil || null
  }

  function _getConfig() {
    const cfg = window.APP_CONFIG
    const dims = cfg?.dimensiones ?? [
      { codigo: 'hacer',   nombre: 'HACER',   peso_maximo: 40, tipo: 'actividades' },
      { codigo: 'saber',   nombre: 'SABER',   peso_maximo: 45, tipo: 'actividades' },
      { codigo: 'ser',     nombre: 'SER',     peso_maximo: 10, tipo: 'ficha'       },
      { codigo: 'decidir', nombre: 'DECIDIR', peso_maximo:  5, tipo: 'directo'     },
    ]
    return {
      notaMinima:    cfg?.nota_minima    ?? 51,
      etiqAprobado:  cfg?.etiqueta_aprobado  ?? 'APROBADO',
      etiqReprobado: cfg?.etiqueta_reprobado ?? 'REPROBADO',
      nombrePeriodo: cfg?.nombre_periodo ?? 'Trimestre',
      año:           cfg?.año ?? new Date().getFullYear(),
      dims,
      dimsActs:  dims.filter(d => d.tipo === 'actividades'),
      hacerDim:  dims.find(d => d.codigo === 'hacer'),
      saberDim:  dims.find(d => d.codigo === 'saber'),
    }
  }

  // ─── MODAL ───────────────────────────────────────────────
  function _crearModal() {
    if (document.getElementById('modal-ibr')) return
    const m = document.createElement('div')
    m.id = 'modal-ibr'
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9000;padding:16px;'
    m.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:960px;max-height:95vh;overflow-y:auto;font-family:'Segoe UI',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="background:linear-gradient(135deg,#1e3a8a,#4f46e5);border-radius:16px 16px 0 0;padding:20px 28px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="color:#a5b4fc;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;">INFORME</div>
            <h2 style="color:#fff;font-size:18px;font-weight:800;margin:0;">📋 Bajo Rendimiento</h2>
            <p style="color:#c4b5fd;font-size:12px;margin:4px 0 0;" id="ibr-subtitulo">—</p>
          </div>
          <button id="ibr-cerrar" style="background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:8px;width:36px;height:36px;font-size:20px;cursor:pointer;">×</button>
        </div>

        <div style="display:flex;border-bottom:2px solid #e5e7eb;background:#f8fafc;padding:0 24px;">
          <button class="ibr-tab" data-tab="informe"  style="border:none;background:none;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid #4f46e5;color:#4f46e5;">📋 Informe</button>
          <button class="ibr-tab" data-tab="graficas" style="border:none;background:none;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;color:#6b7280;">📊 Gráficas</button>
          <button class="ibr-tab" data-tab="detalle"  style="border:none;background:none;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;color:#6b7280;">👤 Por estudiante</button>
          <div style="margin-left:auto;display:flex;align-items:center;gap:8px;padding:8px 0;">
            <span style="font-size:12px;color:#6b7280;" title="Encendido: también muestra a quienes no entregaron más del 30% de sus actividades (nota 0). Apagado: solo a quienes tienen HACER+SABER menor a 51.">Incluir actividades no entregadas</span>
            <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;">
              <input type="checkbox" id="ibr-switch-estricto" style="opacity:0;position:absolute;width:0;height:0;">
              <div id="ibr-switch-track" style="width:40px;height:22px;background:#d1d5db;border-radius:99px;transition:background .2s;position:relative;">
                <div id="ibr-switch-thumb" style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
              </div>
            </label>
            <span id="ibr-badge-riesgo" style="background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;">0 en riesgo</span>
          </div>
        </div>

        <div style="padding:24px 28px;">
          <div id="ibr-tab-informe">
            <div id="ibr-offline-aviso"></div>
            <div id="ibr-encabezado"></div>
            <div id="ibr-resumen" style="margin:16px 0;"></div>
            <div id="ibr-tabla"   style="margin:16px 0;"></div>
            <div id="ibr-obs"     style="margin:16px 0;"></div>
          </div>
          <div id="ibr-tab-graficas" style="display:none;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px;">Sin riesgo vs En riesgo</div>
                <canvas id="ibr-chart-dona" height="180"></canvas>
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px;">Promedio por dimensión (grupo en riesgo vs curso)</div>
                <canvas id="ibr-chart-dims" height="180"></canvas>
              </div>
            </div>
            <div id="ibr-diagnostico"></div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px;">
              <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px;">Ranking HACER+SABER — menor a mayor</div>
              <canvas id="ibr-chart-ranking" height="180"></canvas>
            </div>
          </div>
          <div id="ibr-tab-detalle" style="display:none;"></div>
        </div>

        <div style="border-top:1px solid #e5e7eb;padding:14px 28px;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc;border-radius:0 0 16px 16px;">
          <button onclick="window.print()" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-size:13px;">🖨️ Imprimir</button>
          <button id="ibr-cancelar" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-size:13px;">Cerrar</button>
          <button id="ibr-pdf" style="background:linear-gradient(135deg,#1e40af,#4f46e5);color:#fff;border:none;border-radius:8px;padding:9px 22px;font-weight:700;cursor:pointer;font-size:13px;">📄 Exportar PDF</button>
        </div>
      </div>
      <style>
        @media print {
          body>*:not(#modal-ibr){display:none!important;}
          #modal-ibr{position:static!important;background:#fff!important;}
          #modal-ibr>div{box-shadow:none!important;max-height:none!important;border-radius:0!important;}
          .ibr-tab,#ibr-cancelar,#ibr-pdf,#ibr-cerrar,.ibr-remove-btn,#ibr-switch-estricto{display:none!important;}
          #ibr-tab-informe,#ibr-tab-graficas{display:block!important;}
          @page{size:letter portrait;margin:.5in;}
        }
        .ibr-remove-btn{background:none;border:none;color:#f87171;font-weight:bold;font-size:1.1rem;cursor:pointer;padding:0 4px;flex-shrink:0;}
        .ibr-remove-btn:hover{color:#dc2626;}
      </style>
    `
    document.body.appendChild(m)
  }

  // ─── NAVEGACIÓN TABS ─────────────────────────────────────
  function _initTabs() {
    document.querySelectorAll('.ibr-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ibr-tab').forEach(b => {
          b.style.borderBottomColor = 'transparent'
          b.style.color = '#6b7280'
        })
        btn.style.borderBottomColor = '#4f46e5'
        btn.style.color = '#4f46e5'
        const tab = btn.dataset.tab
        document.getElementById('ibr-tab-informe').style.display  = tab === 'informe'  ? 'block' : 'none'
        document.getElementById('ibr-tab-graficas').style.display = tab === 'graficas' ? 'block' : 'none'
        document.getElementById('ibr-tab-detalle').style.display  = tab === 'detalle'  ? 'block' : 'none'
      })
    })

    // Switch estricto
    const sw = document.getElementById('ibr-switch-estricto')
    const track = document.getElementById('ibr-switch-track')
    const thumb = document.getElementById('ibr-switch-thumb')
    if (sw) {
      sw.addEventListener('change', () => {
        track.style.background = sw.checked ? '#4f46e5' : '#d1d5db'
        thumb.style.left = sw.checked ? '21px' : '3px'
      })
    }
  }

  // ─── CARGA DE DATOS ──────────────────────────────────────
  async function _cargarDatos(modoEstricto = false) {
    const { cursoId, materiaId, periodo, cursoNombre, materiaNombre } = _getSelectors()
    const perfil = _getPerfil()
    const cfg    = _getConfig()

    if (!cursoId || !materiaId) return null

    const colegioId = perfil?.colegio_id
    const usuarioId = perfil?.id
    let huboOffline = false

    // Actividades del profesor para este curso/materia/periodo
    const { data: materiaInfo } = await supabase.from('materias').select('es_tecnica').eq('id', materiaId).single()
    const esTecnica = materiaInfo?.es_tecnica === true

    // Actividades del profesor para este curso/materia/periodo
    const rActs = await fetchConCache({
      key: `ibr-actividades:${cursoId}:${materiaId}:${periodo}`,
      colegioId, usuarioId,
      run: async () => {
        let q = supabase.from('actividades')
          .select('id, tipo, max_puntos, titulo')
          .eq('materia_id', materiaId)
          .eq('trimestre', periodo)
        q = esTecnica ? q.in('curso_id', await cursosDelGrado(cursoId)) : q.eq('curso_id', cursoId)
        if (perfil?.id) q = q.eq('creado_por', perfil.id)
        return q
      },
    })
    huboOffline = huboOffline || rActs.offline

    const acts       = rActs.data ?? []
    const actsHacer  = acts.filter(a => a.tipo === 'hacer')
    const actsSaber  = acts.filter(a => a.tipo === 'saber')
    const actIds     = acts.map(a => a.id)

    // Notas
    let notasMap = {}
    if (actIds.length) {
      const rNotas = await fetchConCache({
        key: `ibr-notas:${cursoId}:${materiaId}:${periodo}`,
        colegioId, usuarioId,
        run: () => supabase.from('notas')
          .select('actividad_id, estudiante_id, valor')
          .in('actividad_id', actIds),
      })
      huboOffline = huboOffline || rNotas.offline
      ;(rNotas.data ?? []).forEach(n => { notasMap[`${n.actividad_id}_${n.estudiante_id}`] = Number(n.valor) })
    }

    // Estudiantes del curso (o de la técnica, si corresponde)
    const rEsts = await fetchConCache({
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
      },
    })
    huboOffline = huboOffline || rEsts.offline
    const estudiantes = (rEsts.data ?? []).sort((a, b) =>
      (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

    // Calificaciones SER/DECIDIR
    const estIds = estudiantes.map(e => e.id)
    let calMap = {}
    if (estIds.length) {
      const rCals = await fetchConCache({
        key: `ibr-calificaciones:${materiaId}:${periodo}:${cursoId}`,
        colegioId, usuarioId,
        run: () => supabase.from('calificaciones')
          .select('estudiante_id, nota_ser, nota_decidir')
          .eq('materia_id', materiaId)
          .eq('trimestre', periodo)
          .in('estudiante_id', estIds),
      })
      huboOffline = huboOffline || rCals.offline
      ;(rCals.data ?? []).forEach(c => { calMap[c.estudiante_id] = c })
    }

    // Colegio
    let colegio = ''
    try {
      const rCol = await fetchConCache({
        key: `nombre-colegio`,
        colegioId, usuarioId,
        run: () => supabase.from('colegios').select('nombre').limit(1),
      })
      colegio = rCol.data?.[0]?.nombre ?? ''
    } catch (_) {}

    // ── Dimensiones dinámica desde config ────────────────
    const hacerDim  = cfg.hacerDim  ?? { peso_maximo: 40 }
    const saberDim  = cfg.saberDim  ?? { peso_maximo: 45 }
    const HACER_MAX = hacerDim.peso_maximo
    const SABER_MAX = saberDim.peso_maximo
    const NOTA_MIN  = cfg.notaMinima
    // Umbral = nota mínima general (51), aplicado directamente sobre la suma HACER+SABER.
    // (Antes se escalaba proporcionalmente a 85 pts, lo cual bajaba el corte real a 43.35.)
    const UMBRAL    = NOTA_MIN

    // ── Calcular notas por estudiante ────────────────────
    const todos = estudiantes.map(est => {
      const nombre = est.usuarios?.nombre_completo ?? '—'

      const valsH = actsHacer.map(a => {
        const v = notasMap[`${a.id}_${est.id}`]
        return v !== undefined ? (v / Number(a.max_puntos)) * HACER_MAX : null
      }).filter(v => v !== null)

      const valsS = actsSaber.map(a => {
        const v = notasMap[`${a.id}_${est.id}`]
        return v !== undefined ? (v / Number(a.max_puntos)) * SABER_MAX : null
      }).filter(v => v !== null)

      const promH = valsH.length ? valsH.reduce((s, v) => s + v, 0) / valsH.length : null
      const promS = valsS.length ? valsS.reduce((s, v) => s + v, 0) / valsS.length : null

      const cerosH = actsHacer.filter(a => notasMap[`${a.id}_${est.id}`] === 0).length
      const cerosS = actsSaber.filter(a => notasMap[`${a.id}_${est.id}`] === 0).length
      const tieneNotas = promH !== null || promS !== null

      const hs = (promH ?? 0) + (promS ?? 0)
      // Regla común (utils/estado-notas.js): la nota solo se juzga cuando HACER y SABER
      // tienen al menos una nota cada uno. Si falta uno, el estudiante queda "En curso".
      const ambas   = promH !== null && promS !== null
      const bajoNota = ambas && notaOficial(hs) < UMBRAL   // decide con la nota redondeada

      const riesgo = modoEstricto
        ? bajoNota
        : tieneNotas && (
            bajoNota ||
            (actsHacer.length > 0 && cerosH / actsHacer.length > 0.3) ||
            (actsSaber.length > 0 && cerosS / actsSaber.length > 0.3)
          )

      return {
        id: est.id, nombre,
        promH, promS, cerosH, cerosS,
        hs: notaOficial(hs), hsExacto: Math.round(hs * 100) / 100,
        tieneNotas, riesgo,
        motivo: bajoNota ? 'Nota bajo ' + UMBRAL : 'Actividades no entregadas'
      }
    })

    return {
      perfil, colegio, cursoNombre, materiaNombre,
      periodo, cfg,
      actsHacer, actsSaber, acts,
      todos,
      enRiesgo:   todos.filter(e => e.riesgo),
      aprobados:  todos.filter(e => !e.riesgo && e.tieneNotas),
      total:      todos.filter(e => e.tieneNotas).length,
      hacerMax: HACER_MAX, saberMax: SABER_MAX, umbral: UMBRAL, notaMin: NOTA_MIN,
      huboOffline,
      modoEstricto,
    }
  }

  // ─── ABRIR MODAL PRINCIPAL ───────────────────────────────
  async function abrirInforme() {
    _crearModal()
    const modal = document.getElementById('modal-ibr')
    modal.style.display = 'flex'
    _initTabs()

    document.getElementById('ibr-cerrar').onclick   = () => { modal.style.display = 'none' }
    document.getElementById('ibr-cancelar').onclick = () => { modal.style.display = 'none' }

    const { materiaNombre, cursoNombre, periodo } = _getSelectors()
    const cfg = _getConfig()
    document.getElementById('ibr-subtitulo').textContent =
      `${materiaNombre} — ${cfg.nombrePeriodo} ${periodo} — ${cursoNombre}`

    // Loading
    document.getElementById('ibr-offline-aviso').innerHTML = ''
    document.getElementById('ibr-encabezado').innerHTML = ''
    document.getElementById('ibr-resumen').innerHTML =
      '<div style="text-align:center;padding:40px;color:#6b7280;">⏳ Cargando datos...</div>'
    document.getElementById('ibr-tabla').innerHTML   = ''
    document.getElementById('ibr-obs').innerHTML     = ''

    let datos = await _cargarDatos(false)

    if (!datos) {
      document.getElementById('ibr-resumen').innerHTML =
        '<div style="color:#991b1b;padding:20px;background:#fee2e2;border-radius:10px;">Selecciona curso y materia antes de generar el informe.</div>'
      return
    }

    window._ibrDatos = datos
    document.getElementById('ibr-offline-aviso').innerHTML = datos.huboOffline ? avisoOfflineInline() : ''
    _renderEncabezado(datos)
    _renderResumen(datos)
    _renderTabla(datos)
    _renderObs(datos)
    _renderGraficas(datos)
    _renderDetalle(datos)

    // Switch modo estricto
    const sw = document.getElementById('ibr-switch-estricto')
    if (sw) {
      sw.checked = true
      document.getElementById('ibr-switch-track').style.background = '#4f46e5'
      document.getElementById('ibr-switch-thumb').style.left = '21px'
      sw.onchange = async function () {
        datos = await _cargarDatos(!this.checked)
        window._ibrDatos = datos
        document.getElementById('ibr-offline-aviso').innerHTML = datos.huboOffline ? avisoOfflineInline() : ''
        _renderResumen(datos)
        _renderTabla(datos)
        _renderGraficas(datos)
        _renderDetalle(datos)
      }
    }

    document.getElementById('ibr-pdf').onclick = () => _exportarPDF(datos, _leerEncabezado())
  }

  // ─── ENCABEZADO EDITABLE ─────────────────────────────────
  function _renderEncabezado(datos) {
    const { perfil, colegio, cursoNombre, materiaNombre, periodo, cfg } = datos
    const nombre = (perfil?.nombre_completo ?? '').toUpperCase()
    document.getElementById('ibr-encabezado').innerHTML = `
      <div style="display:grid;gap:8px;margin-bottom:16px;font-size:13px;">
        <div style="display:flex;gap:8px;">
          <input id="ibr_titulo" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;flex:1;font-size:13px;"
            value="INFORME DE MAESTRO DE ÁREA — ${cfg.nombrePeriodo} ${periodo}">
          <input id="ibr_fecha" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;width:140px;font-size:13px;"
            value="${new Date().toLocaleDateString('es-BO')}">
        </div>
        ${[
          ['ibr_de',     'De',      nombre],
          ['ibr_para',   'Para',    'Comisión Técnico-Pedagógica'],
          ['ibr_ue',     'U.E.',    colegio],
          ['ibr_ref',    'Ref.',    'INFORME DE ESTUDIANTES CON BAJO RENDIMIENTO'],
          ['ibr_curso',  'Curso',   cursoNombre],
          ['ibr_area',   'Área',    materiaNombre],
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
    return {
      titulo: v('ibr_titulo'), fecha: v('ibr_fecha'), de: v('ibr_de'),
      para:   v('ibr_para'),   ue:    v('ibr_ue'),    ref: v('ibr_ref'),
      curso:  v('ibr_curso'),  area:  v('ibr_area'),
    }
  }

  // ─── RESUMEN ─────────────────────────────────────────────
  function _renderResumen(datos) {
    const { enRiesgo, aprobados, total, umbral, modoEstricto } = datos
    const pct = total > 0 ? ((enRiesgo.length / total) * 100).toFixed(0) : 0
    document.getElementById('ibr-badge-riesgo').textContent = `${enRiesgo.length} en riesgo`
    document.getElementById('ibr-resumen').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;">
        ${[
          ['Total',      total,            '#374151', '#f9fafb', '#e5e7eb'],
          ['Sin riesgo', aprobados.length, '#065f46', '#f0fdf4', '#bbf7d0'],
          ['En riesgo',  enRiesgo.length,  '#991b1b', '#fff1f2', '#fecdd3'],
          ['% Riesgo',   pct+'%',          '#92400e', '#fffbeb', '#fde68a'],
        ].map(([lbl, val, color, bg, border]) => `
          <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:${color};">${val}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:4px;">${lbl}</div>
          </div>`).join('')}
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:12px;color:#1e40af;line-height:1.6;">
        ${_textoCriterio(modoEstricto, umbral)}
        <div style="margin-top:4px;">Si al estudiante aún le falta nota en HACER o en SABER, su nota no se evalúa todavía.
        SER y DECIDIR no se consideran, porque se califican al cierre del trimestre.
        Actividades calificadas: HACER ${datos.actsHacer.length} | SABER ${datos.actsSaber.length}</div>
      </div>`
  }

  // Texto del criterio según el switch (pantalla y PDF)
  function _textoCriterio(modoEstricto, umbral, plano = false) {
    const u = Number(umbral).toFixed(0)
    if (plano) {
      return modoEstricto
        ? `Quién aparece en riesgo: el estudiante cuya nota de HACER+SABER es menor a ${u} puntos.`
        : `Quién aparece en riesgo: el estudiante que cumple al menos una condición: 1) su nota de HACER+SABER es menor a ${u} puntos, o 2) no entregó más del 30% de sus actividades de HACER o de SABER (nota 0), aunque su nota supere ${u}.`
    }
    return modoEstricto
      ? `<strong>¿Quién aparece en riesgo?</strong> El estudiante cuya nota de HACER+SABER es menor a <strong>${u} puntos</strong>.`
      : `<strong>¿Quién aparece en riesgo?</strong> El estudiante que cumple al menos una de estas condiciones:
         <br>1. Su nota de HACER+SABER es menor a <strong>${u} puntos</strong>.
         <br>2. No entregó más del 30% de sus actividades de HACER o de SABER (nota 0), aunque su nota supere ${u}.`
  }

  // ─── TABLA ───────────────────────────────────────────────
  function _renderTabla(datos) {
    const { enRiesgo, umbral, hacerMax, saberMax, modoEstricto } = datos
    if (!enRiesgo.length) {
      document.getElementById('ibr-tabla').innerHTML =
        '<div style="color:#065f46;font-weight:600;padding:16px;text-align:center;background:#f0fdf4;border-radius:10px;">✅ Sin estudiantes en riesgo para este filtro.</div>'
      return
    }
    let html = `
      <h3 style="font-size:14px;font-weight:700;color:#374151;margin-bottom:10px;">
        Estudiantes en Riesgo
        <span style="font-size:12px;font-weight:400;color:#6b7280;">${modoEstricto ? `(HACER+SABER menor a ${umbral.toFixed(0)} pts)` : `(HACER+SABER menor a ${umbral.toFixed(0)} pts o actividades no entregadas)`}</span>
      </h3>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#374151;color:#fff;">
            <th style="padding:10px 12px;">N°</th>
            <th style="padding:10px 12px;text-align:left;">Estudiante</th>
            <th style="padding:10px 12px;">HACER /${hacerMax}</th>
            <th style="padding:10px 12px;">Ceros H</th>
            <th style="padding:10px 12px;">SABER /${saberMax}</th>
            <th style="padding:10px 12px;">Ceros S</th>
            <th style="padding:10px 12px;">H+S Total</th>
            <th style="padding:10px 12px;">Motivo</th>
          </tr>
        </thead>
        <tbody>`
    enRiesgo.forEach((e, i) => {
      const hStr = e.promH !== null ? `${fmtNota(e.promH)} (${((e.promH/hacerMax)*100).toFixed(0)}%)` : '—'
      const sStr = e.promS !== null ? `${fmtNota(e.promS)} (${((e.promS/saberMax)*100).toFixed(0)}%)` : '—'
      const colorHS = e.hs < umbral * 0.6 ? '#991b1b' : '#92400e'
      html += `
        <tr style="background:${i%2===0?'#fff':'#fef2f2'};">
          <td style="padding:8px 12px;text-align:center;">${i+1}</td>
          <td style="padding:8px 12px;font-weight:600;">${escapeHtml(e.nombre)}</td>
          <td style="padding:8px 12px;text-align:center;color:${COLORES.hacer};font-weight:600;">${hStr}</td>
          <td style="padding:8px 12px;text-align:center;${e.cerosH>0?'color:#991b1b;font-weight:700;':'color:#6b7280;'}">${e.cerosH}</td>
          <td style="padding:8px 12px;text-align:center;color:${COLORES.saber};font-weight:600;">${sStr}</td>
          <td style="padding:8px 12px;text-align:center;${e.cerosS>0?'color:#991b1b;font-weight:700;':'color:#6b7280;'}">${e.cerosS}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:800;color:${colorHS};" title="${tituloExacto(e.hsExacto)}">${e.hs}</td>
          <td style="padding:8px 12px;text-align:center;font-size:11px;font-weight:600;color:${e.hs < umbral ? '#991b1b' : '#92400e'};">${e.motivo}</td>
        </tr>`
    })
    html += '</tbody></table></div>'
    document.getElementById('ibr-tabla').innerHTML = html
  }

  // ─── OBSERVACIONES ───────────────────────────────────────
  function _renderObs(datos) {
    const { enRiesgo, perfil } = datos
    let html = `
      <div id="ibr-obs-gen-row" style="display:flex;gap:8px;align-items:flex-start;border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:10px;">
        <button class="ibr-remove-btn" onclick="document.getElementById('ibr-obs-gen-row').remove()">×</button>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:6px;">Observación General</div>
          <textarea id="ibr-obs-general" rows="3" placeholder="Observación general del período..."
            style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:12px;resize:vertical;"></textarea>
        </div>
      </div>`

    if (enRiesgo.length) {
      html += `<div id="ibr-obs-container" style="display:grid;gap:8px;">`
      enRiesgo.forEach((e, i) => {
        html += `
          <div id="ibr-obs-row-${i}" style="display:flex;gap:8px;align-items:flex-start;border:1px solid #fecdd3;border-radius:10px;padding:10px;">
            <button class="ibr-remove-btn" onclick="document.getElementById('ibr-obs-row-${i}').remove()">×</button>
            <label style="font-size:12px;font-weight:600;width:220px;flex-shrink:0;padding-top:4px;color:#991b1b;">${escapeHtml(e.nombre)}</label>
            <textarea data-nombre="${escapeHtml(e.nombre)}" rows="2" placeholder="Observación..."
              style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:12px;resize:vertical;"></textarea>
          </div>`
      })
      html += `</div>`
    }

    html += `
      <div id="ibr-pie-row" style="display:flex;gap:8px;align-items:center;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-top:10px;">
        <button class="ibr-remove-btn" onclick="document.getElementById('ibr-pie-row').remove()">×</button>
        <label style="font-size:12px;font-weight:600;width:130px;flex-shrink:0;">Maestro del Área</label>
        <input id="ibr-maestro-pie" style="border:1px solid #d1d5db;border-radius:8px;padding:7px 12px;flex:1;font-size:12px;"
          value="${(perfil?.nombre_completo ?? '').toUpperCase()}">
      </div>`

    document.getElementById('ibr-obs').innerHTML = html
  }

  // ─── GRÁFICAS ────────────────────────────────────────────
  function _renderGraficas(datos) {
    const { enRiesgo, aprobados, todos, umbral, hacerMax, saberMax } = datos
    if (typeof Chart === 'undefined') return

    // Dona
    _destroyChart('ibr-dona')
    const ctxD = document.getElementById('ibr-chart-dona')
    if (ctxD) {
      _charts['ibr-dona'] = new Chart(ctxD, {
        type: 'doughnut',
        data: { labels: ['Sin riesgo', 'En riesgo'], datasets: [{ data: [aprobados.length, enRiesgo.length], backgroundColor: [COLORES.aprobado, COLORES.riesgo], borderWidth: 2 }] },
        options: { responsive: true, cutout: '65%', plugins: { legend: { position: 'bottom' } } }
      })
    }

    // Barras dimensiones
    _destroyChart('ibr-dims')
    const ctxDim = document.getElementById('ibr-chart-dims')
    if (ctxDim && enRiesgo.length) {
      const conH = enRiesgo.filter(e => e.promH !== null)
      const conS = enRiesgo.filter(e => e.promS !== null)
      const rH = conH.length ? conH.reduce((s,e)=>s+e.promH,0)/conH.length : 0
      const rS = conS.length ? conS.reduce((s,e)=>s+e.promS,0)/conS.length : 0
      const tH = todos.filter(e=>e.promH!==null)
      const tS = todos.filter(e=>e.promS!==null)
      const gH = tH.length ? tH.reduce((s,e)=>s+e.promH,0)/tH.length : 0
      const gS = tS.length ? tS.reduce((s,e)=>s+e.promS,0)/tS.length : 0
      _charts['ibr-dims'] = new Chart(ctxDim, {
        type: 'bar',
        data: { labels: ['HACER', 'SABER'], datasets: [
          { label: 'Grupo riesgo', data: [Math.round(rH*10)/10, Math.round(rS*10)/10], backgroundColor: [COLORES.hacer, COLORES.saber], borderRadius: 6 },
          { label: 'Curso completo', data: [Math.round(gH*10)/10, Math.round(gS*10)/10], backgroundColor: ['rgba(245,158,11,0.25)', 'rgba(59,130,246,0.25)'], borderColor: [COLORES.hacer, COLORES.saber], borderWidth: 2, borderRadius: 6 },
          { label: 'Máximo', data: [hacerMax, saberMax], backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 6 },
        ]},
        options: { responsive: true, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } }
      })
    }

    // Ranking
    _destroyChart('ibr-ranking')
    const ctxR = document.getElementById('ibr-chart-ranking')
    if (ctxR && enRiesgo.length) {
      const sorted = [...enRiesgo].sort((a,b) => a.hs - b.hs)
      _charts['ibr-ranking'] = new Chart(ctxR, {
        type: 'bar',
        data: { labels: sorted.map(e=>e.nombre.split(' ').slice(0,2).join(' ')), datasets: [{ label: 'H+S', data: sorted.map(e=>e.hs), backgroundColor: sorted.map(e=>e.hs<umbral*0.6?COLORES.riesgo:e.hs<umbral?'#f59e0b':COLORES.aprobado), borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, scales: { x: { beginAtZero: true, max: hacerMax+saberMax } }, plugins: { legend: { display: false } } }
      })
    }

    // Diagnóstico
    _renderDiagnostico(datos)
  }

  function _renderDiagnostico(datos) {
    const el = document.getElementById('ibr-diagnostico')
    if (!el) return
    const { enRiesgo, todos, hacerMax, saberMax, umbral } = datos
    if (!enRiesgo.length) { el.innerHTML = ''; return }

    const rH = enRiesgo.filter(e=>e.promH!==null).reduce((s,e)=>s+e.promH,0) / (enRiesgo.filter(e=>e.promH!==null).length||1)
    const rS = enRiesgo.filter(e=>e.promS!==null).reduce((s,e)=>s+e.promS,0) / (enRiesgo.filter(e=>e.promS!==null).length||1)
    const gH = todos.filter(e=>e.promH!==null).reduce((s,e)=>s+e.promH,0)    / (todos.filter(e=>e.promH!==null).length||1)
    const gS = todos.filter(e=>e.promS!==null).reduce((s,e)=>s+e.promS,0)    / (todos.filter(e=>e.promS!==null).length||1)
    const pctH = (rH/hacerMax*100), pctS = (rS/saberMax*100)
    const masDebil = pctH < pctS ? 'HACER' : 'SABER'
    const brecha = Math.abs(pctH - pctS)
    const rec = brecha < 10
      ? 'Se recomienda refuerzo integral en ambas dimensiones.'
      : `Se recomienda priorizar el refuerzo en ${masDebil}.`

    el.innerHTML = `
      <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 10px 10px 0;padding:14px 18px;margin-top:12px;">
        <div style="font-weight:700;color:#1e40af;font-size:13px;margin-bottom:8px;">📊 Interpretación automática</div>
        <p style="font-size:12px;color:#1e3a8a;line-height:1.7;margin:0 0 6px;">
          El grupo en riesgo promedia <strong>${rH.toFixed(1)}/${hacerMax}</strong> en HACER
          (<strong>${pctH.toFixed(0)}%</strong>) vs <strong>${gH.toFixed(1)}/${hacerMax}</strong> del curso completo.
          En SABER: <strong>${rS.toFixed(1)}/${saberMax}</strong> (<strong>${pctS.toFixed(0)}%</strong>)
          vs <strong>${gS.toFixed(1)}/${saberMax}</strong> del curso.
        </p>
        <p style="font-size:12px;color:#1e3a8a;line-height:1.7;margin:0;">
          Dimensión más débil del grupo en riesgo: <strong>${masDebil}</strong>. ${rec}
        </p>
      </div>`
  }

  // ─── DETALLE POR ESTUDIANTE ──────────────────────────────
  function _renderDetalle(datos) {
    const el = document.getElementById('ibr-tab-detalle')
    if (!el) return
    const { enRiesgo, hacerMax, saberMax, umbral } = datos
    if (!enRiesgo.length) { el.innerHTML = '<div style="color:#065f46;text-align:center;padding:40px;font-weight:600;">✅ Sin estudiantes en riesgo</div>'; return }
    el.innerHTML = enRiesgo.map(e => {
      const pH = e.promH !== null ? Math.min((e.promH/hacerMax)*100, 100) : 0
      const pS = e.promS !== null ? Math.min((e.promS/saberMax)*100, 100) : 0
      const cH = pH < 40 ? COLORES.riesgo : pH < 70 ? '#f59e0b' : COLORES.aprobado
      const cS = pS < 40 ? COLORES.riesgo : pS < 70 ? '#f59e0b' : COLORES.aprobado
      const cT = e.hs < umbral ? COLORES.riesgo : COLORES.aprobado
      return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div style="font-weight:700;font-size:13px;">${escapeHtml(e.nombre)}</div>
            <div style="text-align:right;">
              <div style="font-size:10px;color:#6b7280;">HACER+SABER</div>
              <div style="font-size:22px;font-weight:800;color:${cT};">${e.hs}</div>
              <div style="font-size:10px;color:#9ca3af;">/ ${hacerMax+saberMax} pts</div>
            </div>
          </div>
          ${[['HACER', e.promH, hacerMax, pH, cH, COLORES.hacer], ['SABER', e.promS, saberMax, pS, cS, COLORES.saber]].map(([lbl,val,max,pct,color,tc])=>`
          <div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
              <span style="font-weight:600;color:${tc};">${lbl}</span>
              <span>${val!==null?fmtNota(val)+' / '+max:'—'}</span>
            </div>
            <div style="background:#e5e7eb;border-radius:99px;height:10px;overflow:hidden;">
              <div style="height:10px;border-radius:99px;width:${pct}%;background:${color};transition:width .3s;"></div>
            </div>
          </div>`).join('')}
          <div style="font-size:11px;color:#6b7280;margin-top:6px;">
            Ceros HACER: <strong style="${e.cerosH>0?'color:#991b1b;':''}">${e.cerosH}</strong> &nbsp;|&nbsp;
            Ceros SABER: <strong style="${e.cerosS>0?'color:#991b1b;':''}">${e.cerosS}</strong>
            &nbsp;|&nbsp; Motivo: <strong>${e.motivo}</strong>
          </div>
        </div>`
    }).join('')
  }

  // ─── EXPORTAR PDF ────────────────────────────────────────
  function _exportarPDF(datos, enc) {
    if (!window.jspdf?.jsPDF) { alert('jsPDF no disponible'); return }
    const { jsPDF } = window.jspdf
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const mg = 14, aw = doc.internal.pageSize.getWidth() - mg * 2
    let y = 14

    // Encabezado
    doc.setFillColor(30,58,138); doc.rect(0,0,220,24,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(enc.titulo, mg, 11)
    doc.setFontSize(8); doc.setFont('helvetica','normal')
    doc.text(`${enc.fecha} | ${enc.ue}`, mg, 18)
    doc.setTextColor(0,0,0); y = 30

    const campos = [['De', enc.de], ['Para', enc.para], ['Ref.', enc.ref], ['Curso', enc.curso], ['Área', enc.area]]
    campos.filter(([,v])=>v).forEach(([lbl, val]) => {
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(`${lbl}:`, mg, y)
      doc.setFont('helvetica','normal')
      const lines = doc.splitTextToSize(val, aw - 40)
      doc.text(lines, mg + 40, y); y += lines.length * 5.5
    })
    y += 4

    // Resumen
    doc.setFont('helvetica','bold'); doc.setFontSize(9)
    doc.text(`Total: ${datos.total} | Sin riesgo: ${datos.aprobados.length} | En riesgo: ${datos.enRiesgo.length}`, mg, y); y += 5
    doc.setFont('helvetica','normal'); doc.setFontSize(8)
    const critLines = doc.splitTextToSize(_textoCriterio(datos.modoEstricto, datos.umbral, true) + ' SER y DECIDIR no se consideran.', aw)
    doc.text(critLines, mg, y); y += critLines.length * 4 + 3

    // Tabla
    doc.autoTable({
      head: [['N°', 'Estudiante', `HACER /${datos.hacerMax}`, 'Ceros H', `SABER /${datos.saberMax}`, 'Ceros S', 'H+S Total', 'Motivo']],
      body: datos.enRiesgo.map((e,i) => [
        i+1, e.nombre,
        e.promH!==null?`${fmtNota(e.promH)} (${((e.promH/datos.hacerMax)*100).toFixed(0)}%)`:'—',
        e.cerosH,
        e.promS!==null?`${fmtNota(e.promS)} (${((e.promS/datos.saberMax)*100).toFixed(0)}%)`:'—',
        e.cerosS, e.hs, e.motivo
      ]),
      startY: y, margin: { left: mg, right: mg },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [55,65,81], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245,245,245] },
      didParseCell: d => {
        if (d.section==='body') {
          const e = datos.enRiesgo[d.row.index]
          if ((d.column.index===3||d.column.index===5) && Number(d.cell.raw)>0) d.cell.styles.textColor=[200,0,0]
          if (d.column.index===6 && e && e.hs<datos.umbral) d.cell.styles.textColor=[200,0,0]
        }
      }
    })
    y = doc.lastAutoTable.finalY + 8

    // Obs general
    const obsGen = document.getElementById('ibr-obs-general')?.value
    if (obsGen) {
      if (y > 240) { doc.addPage(); y = 14 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('OBSERVACIÓN GENERAL:', mg, y); y += 5
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5)
      const lines = doc.splitTextToSize(obsGen, aw); doc.text(lines, mg, y); y += lines.length * 5 + 3
    }

    // Obs individuales
    const obsRows = document.querySelectorAll('#ibr-obs-container textarea')
    if (obsRows.length) {
      if (y > 240) { doc.addPage(); y = 14 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('OBSERVACIONES:', mg, y); y += 5
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5)
      obsRows.forEach(ta => {
        if (!ta.value.trim()) return
        if (y > 260) { doc.addPage(); y = 14 }
        const lines = doc.splitTextToSize(`- ${ta.dataset.nombre}: ${ta.value}`, aw)
        doc.text(lines, mg, y); y += lines.length * 5
      })
    }

    // Pie
    const pie = document.getElementById('ibr-maestro-pie')?.value
    if (pie) {
      y += 14; if (y > 260) { doc.addPage(); y = 14 }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('MAESTRO DEL ÁREA', mg + 55, y); y += 8
      doc.setFont('helvetica','normal'); doc.text(pie, mg + 55, y)
    }

    

    doc.save(`informe-bajo-rendimiento-${datos.periodo}-${new Date().toISOString().slice(0,10)}.pdf`)
  }

  // ─── EXPOSICIÓN GLOBAL ───────────────────────────────────
  window.abrirInformeBajoRendimiento = abrirInforme

  // Compatibilidad con el botón antiguo que ya llama abrirInforme()
  window._vcAbrirInforme = abrirInforme

})()
