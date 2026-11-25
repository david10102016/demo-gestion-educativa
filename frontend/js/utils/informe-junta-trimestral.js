// js/utils/informe-junta-trimestral.js
// Informe Ejecutivo de Junta Trimestral — Panel del Profesor
// Adaptado al sistema Gestión Educativa 2027
// Lee selectores: selector-curso-global, selector-materia-global, selector-periodo-global
// Usa window._profesorPerfil para identificar al profesor
import { supabase } from '../config/supabase-config.js'
import { fetchConCache } from './data-layer.js'
import { avisoOfflineInline } from './connection-status.js'
import { escapeHtml } from './sanitize.js'
import { notaOficial, trimestreCerrado } from './estado-notas.js'
import { Config } from '../config/config-app.js'

// Trimestre abierto: se habla de "En riesgo"; "Reprobados" solo cuando el director lo cerró
let _abierto = false
const _lblRep = () => _abierto ? 'En riesgo' : 'Reprobados'
;(function () {

  const COL = {
    hacer: '#f59e0b', saber: '#3b82f6',
    aprobado: '#10b981', riesgo: '#ef4444',
    oro: '#C9A84C', oro2: '#F0D080', azul: '#1a2a4a',
  }

  const EXCELENCIA_HONOR = 97
  const EXCELENCIA_BASE  = 95
  const TIPO_ACTA        = 'acta_junta'
  const NOMBRE_COLEGIO   = ''   // sin valor por defecto: el nombre siempre sale del colegio del usuario

  const _C = {}
  function _destroyChart(id) { if (_C[id]) { try { _C[id].destroy() } catch(_){} delete _C[id] } }

  // ─── HELPERS ─────────────────────────────────────────────
  function _getSelectors() {
    const cs = document.getElementById('selector-curso-global')
    const ms = document.getElementById('selector-materia-global')
    const ps = document.getElementById('selector-periodo-global')
    return {
      cursoId:       cs?.value || '',
      materiaId:     ms?.value || '',
      periodo:       parseInt(ps?.value || '1'),
      cursoNombre:   cs?.options[cs?.selectedIndex]?.text || '',
      materiaNombre: ms?.options[ms?.selectedIndex]?.text || '',
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
    const hacerDim  = dims.find(d => d.codigo === 'hacer')  ?? { peso_maximo: 40 }
    const saberDim  = dims.find(d => d.codigo === 'saber')  ?? { peso_maximo: 45 }
    const HACER_MAX = hacerDim.peso_maximo
    const SABER_MAX = saberDim.peso_maximo
    const NOTA_MIN  = cfg?.nota_minima ?? 51
    return {
      notaMinima:    NOTA_MIN,
      etiqAprobado:  cfg?.etiqueta_aprobado  ?? 'APROBADO',
      etiqReprobado: cfg?.etiqueta_reprobado ?? 'REPROBADO',
      nombrePeriodo: cfg?.nombre_periodo     ?? 'Trimestre',
      año:           cfg?.año ?? new Date().getFullYear(),
      dims, hacerDim, saberDim, HACER_MAX, SABER_MAX,
      UMBRAL_HS: NOTA_MIN,  // Mismo criterio que Bajo Rendimiento: HACER+SABER < nota mínima (51)
      TOTAL_MAX: dims.reduce((s, d) => s + d.peso_maximo, 0),
    }
  }

  // ─── NAVEGACIÓN ──────────────────────────────────────────
  function _navStyle(active) {
    return active
      ? 'border:none;background:none;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid #1e3a8a;color:#1e3a8a;'
      : 'border:none;background:none;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;color:#6b7280;'
  }

  // ─── MODAL ───────────────────────────────────────────────
  function _crearModal() {
    if (document.getElementById('modal-junta')) return
    const m = document.createElement('div')
    m.id = 'modal-junta'
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9000;padding:16px;'
    m.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:1050px;max-height:95vh;overflow-y:auto;font-family:'Segoe UI',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
        <div style="background:linear-gradient(135deg,#1e3a8a 0%,#4c1d95 60%,#7c3aed 100%);border-radius:16px 16px 0 0;padding:20px 28px;display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="color:#a5b4fc;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;">INFORME EJECUTIVO</div>
            <h2 style="color:#fff;font-size:18px;font-weight:800;margin:0;">🎯 Junta Trimestral</h2>
            <p style="color:#c4b5fd;font-size:12px;margin:4px 0 0;" id="junta-subtitulo">Cargando...</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="junta-btn-recargar" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;font-weight:600;">↺ Recargar</button>
            <button id="junta-cerrar" style="background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:8px;width:36px;height:36px;font-size:20px;cursor:pointer;">×</button>
          </div>
        </div>

        <div id="junta-nav" style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;background:#f8fafc;padding:0 20px;">
          <button class="junta-nav-btn active" data-sec="resumen"    style="${_navStyle(true)}">📊 Resumen</button>
          <button class="junta-nav-btn"        data-sec="materias"   style="${_navStyle(false)}">📚 Por Materia</button>
          <button class="junta-nav-btn"        data-sec="riesgo"     style="${_navStyle(false)}">⚠️ En Riesgo</button>
          <button class="junta-nav-btn"        data-sec="excelencia" style="${_navStyle(false)}">🏆 Excelencia</button>
          <button class="junta-nav-btn"        data-sec="evidencias" style="${_navStyle(false)}">📋 Evidencias</button>
        </div>

        <div style="padding:24px 28px;">
          <div id="junta-loading" style="text-align:center;padding:60px 0;color:#6b7280;">
            <div style="font-size:36px;margin-bottom:12px;">⏳</div>
            <div style="font-size:14px;font-weight:500;">Cargando datos...</div>
          </div>
          <div id="junta-offline-aviso"></div>
          <div id="junta-sec-resumen"    class="junta-sec" style="display:none;"></div>
          <div id="junta-sec-materias"   class="junta-sec" style="display:none;">
            <h3 style="font-size:15px;font-weight:700;color:#1e3a8a;margin-bottom:12px;">HACER vs SABER — Promedio por Materia/Curso</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px;">Promedio HACER vs SABER (%)</div>
                <canvas id="junta-chart-bar" height="200"></canvas>
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px;">% Aprobación</div>
                <canvas id="junta-chart-apr" height="200"></canvas>
              </div>
            </div>
            <div id="junta-tabla-materias"></div>
          </div>
          <div id="junta-sec-riesgo"     class="junta-sec" style="display:none;"><div id="junta-riesgo-cont"></div></div>
          <div id="junta-sec-excelencia" class="junta-sec" style="display:none;"><div id="junta-exc-cont"></div></div>
          <div id="junta-sec-evidencias" class="junta-sec" style="display:none;"><div id="junta-ev-cont"></div></div>
        </div>

        <div style="border-top:1px solid #e5e7eb;padding:14px 28px;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc;border-radius:0 0 16px 16px;">
          <button onclick="window.print()" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-size:13px;">🖨️ Imprimir</button>
          <button id="junta-cancelar" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 18px;font-weight:600;cursor:pointer;font-size:13px;">Cerrar</button>
          <button id="junta-btn-pdf" style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:#fff;border:none;border-radius:8px;padding:9px 22px;font-weight:700;cursor:pointer;font-size:13px;">📄 Exportar PDF</button>
        </div>
      </div>
      <style>
        @media print {
          body>*:not(#modal-junta){display:none!important;}
          #modal-junta{position:static!important;background:#fff!important;}
          #modal-junta>div{box-shadow:none!important;max-height:none!important;border-radius:0!important;}
          .junta-nav-btn,#junta-cerrar,#junta-cancelar,#junta-btn-pdf,#junta-btn-recargar,[onclick*="print"]{display:none!important;}
          .junta-sec{display:block!important;}
          @page{size:letter portrait;margin:.5in;}
        }
      </style>
    `
    document.body.appendChild(m)
  }

  function _initNav() {
    document.querySelectorAll('.junta-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.junta-nav-btn').forEach(b => {
          b.style.borderBottomColor = 'transparent'; b.style.color = '#6b7280'
        })
        btn.style.borderBottomColor = '#1e3a8a'; btn.style.color = '#1e3a8a'
        const sec = btn.dataset.sec
        document.querySelectorAll('.junta-sec').forEach(s => s.style.display = 'none')
        const el = document.getElementById(`junta-sec-${sec}`)
        if (el) el.style.display = 'block'
        if (!window._juntaDatos) return
        if (sec === 'materias')    _renderMaterias(window._juntaDatos)
        if (sec === 'riesgo')      _renderRiesgo(window._juntaDatos)
        if (sec === 'excelencia')  _renderExcelencia(window._juntaDatos)
        if (sec === 'evidencias')  _cargarEvidencias()
      })
    })
  }

  // ─── ABRIR ───────────────────────────────────────────────
  async function abrirInformeJunta() {
    _crearModal()
    const modal = document.getElementById('modal-junta')
    modal.style.display = 'flex'
    _initNav()

    document.getElementById('junta-cerrar').onclick   = () => { modal.style.display = 'none' }
    document.getElementById('junta-cancelar').onclick = () => { modal.style.display = 'none' }
    document.getElementById('junta-btn-recargar').onclick = () => _cargarDatos()
    document.getElementById('junta-btn-pdf').onclick      = () => _exportarPDF()

    await _cargarDatos()
  }

  // ─── CARGA PRINCIPAL ─────────────────────────────────────
  async function _cargarDatos() {
    _mostrarLoading(true)

    const perfil = _getPerfil()
    const cfg    = _getConfig()
    const { cursoId, materiaId, periodo, cursoNombre, materiaNombre } = _getSelectors()
    _abierto = !trimestreCerrado(periodo, { trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada })

    if (!perfil?.id) { _mostrarError('No se pudo identificar al profesor.'); return }

    const colegioId = perfil?.colegio_id
    const usuarioId = perfil?.id
    let huboOffline = false

    let colegio   = NOMBRE_COLEGIO
    let ubicacion = ''
    try {
      const rCol = await fetchConCache({
        key: `nombre-colegio`, colegioId, usuarioId,
        run: () => supabase.from('colegios').select('nombre, municipio, departamento').eq('id', colegioId).limit(1),
      })
      huboOffline = huboOffline || rCol.offline
      const c = rCol.data?.[0]
      if (c?.nombre) colegio = c.nombre
      if (c?.municipio && c?.departamento) ubicacion = `${c.municipio}, ${c.departamento} – Bolivia`
    } catch (_) {}
    if (!colegio) {
      _mostrarError('No se pudo obtener el nombre del colegio. Revisa tu conexión e intenta de nuevo.')
      return
    }

    const rAsigs = await fetchConCache({
      key: `junta-asignaciones-profesor`,
      colegioId, usuarioId,
      run: () => supabase.from('asignaciones_profesor')
        .select('materia_id, curso_id')
        .eq('profesor_id', perfil.id)
        .eq('activo', true),
    })
    huboOffline = huboOffline || rAsigs.offline
    const asignaciones = rAsigs.data

    if (!asignaciones?.length) { _mostrarError('Sin asignaciones para este profesor.'); return }

    const materiaIds = [...new Set(asignaciones.map(a => a.materia_id).filter(Boolean))]
    const cursoIds   = [...new Set(asignaciones.map(a => a.curso_id).filter(Boolean))]

    const [rMaterias, rCursos, rEstsRaw] = await Promise.all([
      fetchConCache({
        key: `junta-materias:${materiaIds.join(',')}`, colegioId, usuarioId,
        run: () => supabase.from('materias').select('id, nombre, es_tecnica').in('id', materiaIds),
      }),
      fetchConCache({
        key: `junta-cursos:${cursoIds.join(',')}`, colegioId, usuarioId,
        run: () => supabase.from('cursos').select('id, nombre_completo, paralelo, nivel, grado').in('id', cursoIds),
      }),
      fetchConCache({
        key: `junta-estudiantes:${cursoIds.join(',')}`, colegioId, usuarioId,
        run: () => supabase.from('estudiantes').select('id, usuarios(nombre_completo), curso_id').in('curso_id', cursoIds),
      }),
    ])
    huboOffline = huboOffline || rMaterias.offline || rCursos.offline || rEstsRaw.offline
    const materias       = rMaterias.data
    const cursos         = rCursos.data
    const estudiantesRaw = rEstsRaw.data

    // Materias técnicas: solo cuentan los estudiantes inscritos en la rama
    const tecIds = (materias || []).filter(m => m.es_tecnica).map(m => m.id)
    const inscritos = new Set()
    if (tecIds.length) {
      const rInsc = await fetchConCache({
        key: `junta-inscritos:${tecIds.join(',')}`, colegioId, usuarioId,
        run: () => supabase.from('inscripciones_tecnicas').select('estudiante_id, materia_id')
          .in('materia_id', tecIds).eq('activo', true),
      })
      huboOffline = huboOffline || rInsc.offline
      ;(rInsc.data ?? []).forEach(i => inscritos.add(`${i.materia_id}|${i.estudiante_id}`))
    }

    const rActs = await fetchConCache({
      key: `junta-actividades:${materiaIds.join(',')}:${periodo}`,
      colegioId, usuarioId,
      run: () => {
        let q = supabase.from('actividades')
          .select('id, tipo, max_puntos, materia_id, curso_id')
          .in('materia_id', materiaIds)
          .eq('trimestre', periodo)
          .in('tipo', ['hacer', 'saber'])
        if (perfil.id) q = q.eq('creado_por', perfil.id)
        return q
      },
    })
    huboOffline = huboOffline || rActs.offline
    const actividades = rActs.data

    if (!actividades?.length) { _mostrarError(`Sin actividades HACER/SABER para el período ${periodo}.`); return }

    const rActsSA = await fetchConCache({
      key: `junta-actividades-sa:${materiaIds.join(',')}:${periodo}`,
      colegioId, usuarioId,
      run: () => {
        let q = supabase.from('actividades')
          .select('id, tipo, max_puntos, materia_id')
          .in('materia_id', materiaIds)
          .eq('trimestre', periodo)
          .in('tipo', ['ser', 'decidir'])
        if (perfil.id) q = q.eq('creado_por', perfil.id)
        return q
      },
    })
    huboOffline = huboOffline || rActsSA.offline
    const actsSA = rActsSA.data

    const todasActIds   = [...(actividades||[]).map(a=>a.id), ...(actsSA||[]).map(a=>a.id)]
    const estudianteIds = (estudiantesRaw||[]).map(e => e.id)

    const rNotas = await fetchConCache({
      key: `junta-notas:${materiaIds.join(',')}:${periodo}:${cursoIds.join(',')}`,
      colegioId, usuarioId,
      run: async () => {
        let notas = [], from = 0, page = null
        do {
          const { data, error } = await supabase.from('notas')
            .select('actividad_id, estudiante_id, valor')
            .in('actividad_id', todasActIds)
            .in('estudiante_id', estudianteIds)
            .order('actividad_id').order('estudiante_id')
            .range(from, from + 999)
          if (error) return { data: null, error }
          page = data || []; notas = [...notas, ...page]; from += 1000
        } while (page.length === 1000)
        return { data: notas, error: null }
      },
    })
    huboOffline = huboOffline || rNotas.offline
    const notas = rNotas.data ?? []

    const notasMap = {}
    notas.forEach(n => { notasMap[`${n.actividad_id}_${n.estudiante_id}`] = Number(n.valor) })

    const rCalifs = await fetchConCache({
      key: `junta-calificaciones:${materiaIds.join(',')}:${periodo}`,
      colegioId, usuarioId,
      run: () => supabase.from('calificaciones')
        .select('estudiante_id, materia_id, trimestre, nota_ser, nota_decidir')
        .in('materia_id', materiaIds)
        .eq('trimestre', periodo),
    })
    huboOffline = huboOffline || rCalifs.offline
    const calificaciones = rCalifs.data

    const combos = _agruparCombos(
      asignaciones, materias, cursos, actividades, estudiantesRaw,
      notasMap, calificaciones || [], periodo, actsSA || [], cfg, inscritos
    )

    const idsEnCombos = new Set(combos.flatMap(c => c.idsEstudiantes))

    const datos = {
      perfil, colegio, ubicacion, periodo, cfg,
      materias: materias || [], cursos: cursos || [],
      combos, totalEstudiantesUnicos: idsEnCombos.size,
      huboOffline,
    }

    window._juntaDatos = datos
    document.getElementById('junta-subtitulo').textContent =
      `${perfil.nombre_completo} — ${cfg.nombrePeriodo} ${periodo} — ${colegio}`

    _mostrarLoading(false)
    document.getElementById('junta-offline-aviso').innerHTML = huboOffline
      ? avisoOfflineInline('Sin conexión — este informe muestra la última información guardada. Si un colega cargó notas después, no aparecerán hasta reconectar.')
      : ''
    _renderResumen(datos)
    document.getElementById('junta-sec-resumen').style.display = 'block'
  }

  // ─── AGRUPAR COMBOS ──────────────────────────────────────
  function _agruparCombos(asigs, materias, cursos, actividades, estudiantes, notasMap, califs, periodo, actsSA, cfg, inscritos = new Set()) {
    const { HACER_MAX, SABER_MAX, UMBRAL_HS, notaMinima } = cfg
    const combos = []

    asigs.forEach(asig => {
      const materia = (materias||[]).find(m => m.id === asig.materia_id)
      const curso   = (cursos||[]).find(c => c.id === asig.curso_id)
      if (!materia) return

      // Técnica: solo inscritos del paralelo, y actividades de todo el grado (se crean desde cualquier paralelo)
      const esTec   = materia.es_tecnica === true
      const gradoDe = id => { const c = (cursos||[]).find(x => x.id === id); return c ? `${c.nivel}|${c.grado}` : null }
      const gAsig   = gradoDe(asig.curso_id)

      const estudiantesCurso = (estudiantes||[]).filter(e => e.curso_id === asig.curso_id &&
        (!esTec || inscritos.has(`${asig.materia_id}|${e.id}`)))
      if (!estudiantesCurso.length) return

      const actsM     = (actividades||[]).filter(a => a.materia_id === asig.materia_id && (a.curso_id === null ||
        (esTec ? gradoDe(a.curso_id) === gAsig : a.curso_id === asig.curso_id)))
      const actsHacer = actsM.filter(a => a.tipo === 'hacer')
      const actsSaber = actsM.filter(a => a.tipo === 'saber')
      if (!actsHacer.length && !actsSaber.length) return

      const actsSerM     = (actsSA||[]).filter(a => a.tipo === 'ser'     && a.materia_id === asig.materia_id)
      const actsDecidirM = (actsSA||[]).filter(a => a.tipo === 'decidir' && a.materia_id === asig.materia_id)

      let sumaH=0, sumaS=0, cntH=0, cntS=0, aprobados=0, reprobados=0
      const riesgoHS=[], riesgoReal=[], excelencia=[], idsEstudiantes=[]

      estudiantesCurso.forEach(est => {
        idsEstudiantes.push(est.id)
        const nombre = est.usuarios?.nombre_completo ?? '—'

        const vH = actsHacer.map(a=>{const v=notasMap[`${a.id}_${est.id}`];return v!==undefined?(v/Number(a.max_puntos))*HACER_MAX:null}).filter(v=>v!==null)
        const vS = actsSaber.map(a=>{const v=notasMap[`${a.id}_${est.id}`];return v!==undefined?(v/Number(a.max_puntos))*SABER_MAX:null}).filter(v=>v!==null)

        const promH = vH.length ? vH.reduce((s,v)=>s+v,0)/vH.length : null
        const promS = vS.length ? vS.reduce((s,v)=>s+v,0)/vS.length : null

        const calif = (califs||[]).find(c=>c.estudiante_id===est.id&&c.materia_id===asig.materia_id&&c.trimestre===periodo)

        const normSer   = actsSerM.map(a=>{const v=notasMap[`${a.id}_${est.id}`];return v!==undefined?(v/Number(a.max_puntos))*cfg.dims.find(d=>d.codigo==='ser')?.peso_maximo:null}).filter(v=>v!==null)
        const normDecid = actsDecidirM.map(a=>{const v=notasMap[`${a.id}_${est.id}`];return v!==undefined?(v/Number(a.max_puntos))*cfg.dims.find(d=>d.codigo==='decidir')?.peso_maximo:null}).filter(v=>v!==null)

        const notaSer   = normSer.length   ? normSer.reduce((s,v)=>s+v,0)/normSer.length     : parseFloat(calif?.nota_ser    ?? 0)
        const notaDecid = normDecid.length ? normDecid.reduce((s,v)=>s+v,0)/normDecid.length : parseFloat(calif?.nota_decidir ?? 0)

        // Valores mostrados y decisiones con la nota oficial redondeada (.5 sube)
        const hs         = notaOficial((promH||0) + (promS||0))
        const totalFinal = notaOficial((promH||0) + (promS||0) + notaSer + notaDecid)
        const tieneNotas = promH !== null || promS !== null

        if (promH!==null){sumaH+=promH;cntH++}
        if (promS!==null){sumaS+=promS;cntS++}

        if (tieneNotas) {
          // Regla común: solo se juzga cuando HACER y SABER tienen nota (si falta uno, queda "En curso")
          if (promH !== null && promS !== null && hs < UMBRAL_HS) riesgoHS.push({ id:est.id, nombre, promH:notaOficial(promH), promS:notaOficial(promS), hs, notaSer:notaOficial(notaSer), notaDecid:notaOficial(notaDecid), totalFinal:notaOficial(totalFinal), salvado:totalFinal>=notaMinima })
          if (totalFinal >= notaMinima) {
            aprobados++
            if (totalFinal >= EXCELENCIA_BASE) excelencia.push({ id:est.id, nombre, promH:notaOficial(promH), promS:notaOficial(promS), notaSer:notaOficial(notaSer), notaDecid:notaOficial(notaDecid), totalFinal:notaOficial(totalFinal), nivel:totalFinal>=EXCELENCIA_HONOR?'honor':'excelencia' })
          } else {
            reprobados++
            riesgoReal.push({ id:est.id, nombre, promH:notaOficial(promH), promS:notaOficial(promS), hs, notaSer:notaOficial(notaSer), notaDecid:notaOficial(notaDecid), totalFinal:notaOficial(totalFinal) })
          }
        }
      })

      combos.push({
        materia_id: asig.materia_id, curso_id: asig.curso_id,
        nombreMateria: materia.nombre,
        nombreCurso: curso ? curso.nombre_completo.trim() : '—',
        promHacer: cntH>0?parseFloat((sumaH/cntH).toFixed(2)):null,
        promSaber: cntS>0?parseFloat((sumaS/cntS).toFixed(2)):null,
        pctHacer:  cntH>0?parseFloat(((sumaH/cntH/HACER_MAX)*100).toFixed(1)):null,
        pctSaber:  cntS>0?parseFloat(((sumaS/cntS/SABER_MAX)*100).toFixed(1)):null,
        totalEstudiantes: estudiantesCurso.length,
        aprobados, reprobados,
        pctAprobacion: estudiantesCurso.length>0?parseFloat(((aprobados/estudiantesCurso.length)*100).toFixed(1)):0,
        riesgoHS, riesgoReal, excelencia, idsEstudiantes,
        umbral: UMBRAL_HS,
      })
    })

    return combos
  }

  // ─── RENDER RESUMEN ──────────────────────────────────────
  function _renderResumen(datos) {
    const { combos, totalEstudiantesUnicos, cfg } = datos
    if (!combos.length) return

    const idsRep  = new Set(combos.flatMap(c=>c.riesgoReal.map(e=>e.id)))
    const idsHS   = new Set(combos.flatMap(c=>c.riesgoHS.map(e=>e.id)))
    const porId   = {}
    combos.flatMap(c=>c.excelencia).forEach(e=>{ if(!porId[e.id]||e.nivel==='honor') porId[e.id]=e.nivel })
    const honor   = Object.entries(porId).filter(([,v])=>v==='honor').length
    const excBase = Object.entries(porId).filter(([,v])=>v==='excelencia').length

    const semaforos = combos.map(c=>{
      const cls = c.pctAprobacion>=75?'verde':c.pctAprobacion>=51?'amarillo':'rojo'
      const bg  = cls==='verde'?'#d1fae5':cls==='amarillo'?'#fef9c3':'#fee2e2'
      const bc  = cls==='verde'?'#6ee7b7':cls==='amarillo'?'#fde047':'#fca5a5'
      const fc  = cls==='verde'?'#065f46':cls==='amarillo'?'#854d0e':'#991b1b'
      const icn = cls==='verde'?'🟢':cls==='amarillo'?'🟡':'🔴'
      return `<div style="background:${bg};border:1px solid ${bc};border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-size:12px;font-weight:700;color:${fc};">${escapeHtml(c.nombreMateria)}</div><div style="font-size:11px;color:#6b7280;">${escapeHtml(c.nombreCurso)}</div></div>
        <div style="text-align:right;"><div style="font-size:18px;font-weight:800;color:${fc};">${icn} ${c.pctAprobacion}%</div><div style="font-size:10px;color:#6b7280;">${c.aprobados}/${c.totalEstudiantes}</div></div>
      </div>`
    }).join('')

    document.getElementById('junta-sec-resumen').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;">
        ${_card('Total Estudiantes',  totalEstudiantesUnicos,              '#1e3a8a', '👥')}
        ${_card(_abierto ? 'Sobre la mínima' : 'Aprobados', totalEstudiantesUnicos-idsRep.size,  '#065f46', '✅')}
        ${_card(_lblRep(),            idsRep.size,                         '#991b1b', '❌')}
        ${_card('% Aprobación',       (totalEstudiantesUnicos>0?Math.round(((totalEstudiantesUnicos-idsRep.size)/totalEstudiantesUnicos)*100):0)+'%', idsRep.size===0?'#065f46':'#92400e', '📈')}
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:24px;margin-bottom:4px;">🏆</div>
          <div style="font-size:22px;font-weight:800;color:#92400e;">${honor+excBase}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px;">Excelencia</div>
          <div style="font-size:10px;color:#92400e;margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;">
            <div>🏆 Honor: <strong>${honor}</strong></div>
            <div>⭐ Base: <strong>${excBase}</strong></div>
          </div>
        </div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:#1e40af;">
        <strong>Criterio de aprobación:</strong> ${cfg.dims.map(d=>`${escapeHtml(d.nombre)} (${d.peso_maximo})`).join(' + ')} ≥ ${cfg.notaMinima} pts.
        Riesgo H+S: &lt; ${cfg.UMBRAL_HS} pts.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;">
          <div style="font-weight:700;color:#991b1b;font-size:13px;">⚠️ Riesgo HACER+SABER</div>
          <div style="color:#b91c1c;font-size:12px;margin-top:4px;">${idsHS.size} estudiante${idsHS.size!==1?'s':''} bajo el umbral</div>
        </div>
        <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:12px 16px;">
          <div style="font-weight:700;color:#9a3412;font-size:13px;">📋 ${_abierto ? 'En riesgo (trimestre en curso)' : 'Reprobados reales'}</div>
          <div style="color:#c2410c;font-size:12px;margin-top:4px;">${idsRep.size} estudiante${idsRep.size!==1?'s':''} con nota final &lt; ${cfg.notaMinima} pts</div>
        </div>
      </div>
      <div style="margin-bottom:8px;font-size:13px;font-weight:700;color:#374151;">SEMÁFORO POR MATERIA / CURSO</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;">${semaforos}</div>
    `
  }

  function _card(label, valor, color, icono) {
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
      <div style="font-size:24px;margin-bottom:4px;">${icono}</div>
      <div style="font-size:22px;font-weight:800;color:${color};">${valor}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">${label}</div>
    </div>`
  }

  // ─── RENDER MATERIAS ─────────────────────────────────────
  function _renderMaterias(datos) {
    const { combos, cfg } = datos
    const porMat = {}
    combos.forEach(c=>{ if(!porMat[c.materia_id]) porMat[c.materia_id]={nombre:c.nombreMateria,combos:[]}; porMat[c.materia_id].combos.push(c) })
    const ml     = Object.values(porMat)
    const labels = ml.map(m=>m.nombre)
    const promH  = ml.map(m=>{ const v=m.combos.map(c=>c.pctHacer).filter(x=>x!==null); return v.length?parseFloat((v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)):0 })
    const promS  = ml.map(m=>{ const v=m.combos.map(c=>c.pctSaber).filter(x=>x!==null); return v.length?parseFloat((v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)):0 })
    const pctApr = ml.map(m=>{ const e=m.combos.reduce((s,c)=>s+c.totalEstudiantes,0); const a=m.combos.reduce((s,c)=>s+c.aprobados,0); return e>0?parseFloat(((a/e)*100).toFixed(1)):0 })

    if (typeof Chart !== 'undefined') {
      _destroyChart('jbar'); _destroyChart('japr')
      const cb = document.getElementById('junta-chart-bar')
      if (cb) _C['jbar'] = new Chart(cb,{type:'bar',data:{labels,datasets:[{label:'HACER %',data:promH,backgroundColor:COL.hacer,borderRadius:6},{label:'SABER %',data:promS,backgroundColor:COL.saber,borderRadius:6}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}},plugins:{legend:{position:'bottom'}}}})
      const ca = document.getElementById('junta-chart-apr')
      if (ca) _C['japr'] = new Chart(ca,{type:'bar',data:{labels,datasets:[{label:'% Aprobación',data:pctApr,backgroundColor:pctApr.map(v=>v>=75?COL.aprobado:v>=51?'#f59e0b':COL.riesgo),borderRadius:6}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}},plugins:{legend:{display:false}}}})
    }

    document.getElementById('junta-tabla-materias').innerHTML = `
      <div style="overflow-x:auto;margin-top:16px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <thead><tr style="background:#1e3a8a;color:#fff;">
          <th style="padding:10px 14px;text-align:left;">Materia</th>
          <th style="padding:10px 14px;text-align:left;">Curso</th>
          <th style="padding:10px 14px;text-align:center;">Est.</th>
          <th style="padding:10px 14px;text-align:center;">HACER %</th>
          <th style="padding:10px 14px;text-align:center;">SABER %</th>
          <th style="padding:10px 14px;text-align:center;">% Aprobación</th>
          <th style="padding:10px 14px;text-align:center;">${_lblRep()}</th>
          <th style="padding:10px 14px;text-align:center;">🏆 Exc.</th>
        </tr></thead>
        <tbody>
          ${combos.map((c,i)=>`
            <tr style="background:${i%2===0?'#fff':'#f9fafb'};">
              <td style="padding:9px 14px;font-weight:600;">${escapeHtml(c.nombreMateria)}</td>
              <td style="padding:9px 14px;">${escapeHtml(c.nombreCurso)}</td>
              <td style="padding:9px 14px;text-align:center;">${c.totalEstudiantes}</td>
              <td style="padding:9px 14px;text-align:center;color:${COL.hacer};font-weight:700;">${c.pctHacer??'—'}%</td>
              <td style="padding:9px 14px;text-align:center;color:${COL.saber};font-weight:700;">${c.pctSaber??'—'}%</td>
              <td style="padding:9px 14px;text-align:center;font-weight:700;color:${c.pctAprobacion>=75?'#065f46':c.pctAprobacion>=51?'#854d0e':'#991b1b'};">${c.pctAprobacion}%</td>
              <td style="padding:9px 14px;text-align:center;color:#991b1b;font-weight:700;">${c.riesgoReal.length}</td>
              <td style="padding:9px 14px;text-align:center;color:#92400e;font-weight:700;">${c.excelencia.length}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`
  }

  // ─── RENDER RIESGO ───────────────────────────────────────
  function _renderRiesgo(datos) {
    const { combos, cfg } = datos
    const listA = []; combos.forEach(c=>c.riesgoHS.forEach(e=>listA.push({...e,materia:c.nombreMateria,curso:c.nombreCurso})))
    const listB = []; combos.forEach(c=>c.riesgoReal.forEach(e=>listB.push({...e,materia:c.nombreMateria,curso:c.nombreCurso})))
    listA.sort((a,b)=>a.hs-b.hs); listB.sort((a,b)=>a.totalFinal-b.totalFinal)

    const thS = 'padding:8px 10px;'
    const filasA = listA.map((e,i)=>`
      <tr style="background:${i%2===0?'#fff':'#fef2f2'};">
        <td style="${thS}text-align:center;">${i+1}</td>
        <td style="${thS}font-weight:600;">${escapeHtml(e.nombre)}</td>
        <td style="${thS}">${e.materia}</td>
        <td style="${thS}">${e.curso}</td>
        <td style="${thS}text-align:center;color:${COL.hacer};font-weight:600;">${e.promH!==null?e.promH+'/'+cfg.HACER_MAX:'—'}</td>
        <td style="${thS}text-align:center;color:${COL.saber};font-weight:600;">${e.promS!==null?e.promS+'/'+cfg.SABER_MAX:'—'}</td>
        <td style="${thS}text-align:center;font-weight:800;color:${e.hs<cfg.UMBRAL_HS*0.6?'#991b1b':'#854d0e'};">${e.hs}</td>
        <td style="${thS}text-align:center;font-size:11px;">${e.salvado?'<span style="color:#065f46;font-weight:700;">✅ Aprueba por SER/DEC</span>':'<span style="color:#991b1b;font-weight:700;">❌ Reprueba</span>'}</td>
      </tr>`).join('')

    const filasB = listB.map((e,i)=>`
      <tr style="background:${i%2===0?'#fff':'#fff7ed'};">
        <td style="${thS}text-align:center;">${i+1}</td>
        <td style="${thS}font-weight:600;">${escapeHtml(e.nombre)}</td>
        <td style="${thS}">${e.materia}</td>
        <td style="${thS}">${e.curso}</td>
        <td style="${thS}text-align:center;color:${COL.hacer};font-weight:600;">${e.promH!==null?e.promH+'/'+cfg.HACER_MAX:'—'}</td>
        <td style="${thS}text-align:center;color:${COL.saber};font-weight:600;">${e.promS!==null?e.promS+'/'+cfg.SABER_MAX:'—'}</td>
        <td style="${thS}text-align:center;font-weight:800;color:${e.totalFinal<cfg.notaMinima*0.6?'#991b1b':'#854d0e'};">${e.totalFinal}/${cfg.TOTAL_MAX}</td>
      </tr>`).join('')

    document.getElementById('junta-riesgo-cont').innerHTML = `
      <div style="margin-bottom:20px;">
        <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:0 10px 10px 0;padding:10px 16px;margin-bottom:10px;">
          <div style="font-weight:700;color:#991b1b;font-size:13px;">⚠️ Riesgo HACER+SABER (${listA.length})</div>
          <div style="font-size:11px;color:#b91c1c;margin-top:2px;">HACER+SABER &lt; ${cfg.UMBRAL_HS} pts</div>
        </div>
        ${listA.length?`<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #fca5a5;border-radius:10px;overflow:hidden;">
          <thead><tr style="background:#991b1b;color:#fff;">
            <th style="${thS}">#</th><th style="${thS}text-align:left;">Estudiante</th><th style="${thS}text-align:left;">Materia</th><th style="${thS}text-align:left;">Curso</th>
            <th style="${thS}">HACER</th><th style="${thS}">SABER</th><th style="${thS}">H+S</th><th style="${thS}">Estado</th>
          </tr></thead><tbody>${filasA}</tbody></table></div>`:'<div style="color:#065f46;font-weight:600;padding:12px;">✅ Ninguno</div>'}
      </div>
      <div>
        <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:0 10px 10px 0;padding:10px 16px;margin-bottom:10px;">
          <div style="font-weight:700;color:#9a3412;font-size:13px;">📋 ${_abierto ? 'En riesgo' : 'Reprobados reales'} (${listB.length})</div>
          <div style="font-size:11px;color:#c2410c;margin-top:2px;">Nota final &lt; ${cfg.notaMinima} pts</div>
        </div>
        ${listB.length?`<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #fdba74;border-radius:10px;overflow:hidden;">
          <thead><tr style="background:#9a3412;color:#fff;">
            <th style="${thS}">#</th><th style="${thS}text-align:left;">Estudiante</th><th style="${thS}text-align:left;">Materia</th><th style="${thS}text-align:left;">Curso</th>
            <th style="${thS}">HACER</th><th style="${thS}">SABER</th><th style="${thS}">TOTAL</th>
          </tr></thead><tbody>${filasB}</tbody></table></div>`:'<div style="color:#065f46;font-weight:600;padding:12px;">✅ Ninguno</div>'}
      </div>`
  }

  // ─── RENDER EXCELENCIA ───────────────────────────────────
  function _renderExcelencia(datos) {
    const { combos, perfil, periodo, colegio, ubicacion, cfg } = datos
    const el = document.getElementById('junta-exc-cont')

    const porEst = {}
    combos.forEach(c=>c.excelencia.forEach(e=>{
      if(!porEst[e.id]) porEst[e.id]={id:e.id,nombre:e.nombre,nivel:e.nivel,materias:[]}
      if(e.nivel==='honor') porEst[e.id].nivel='honor'
      porEst[e.id].materias.push({nombreMateria:c.nombreMateria,nombreCurso:c.nombreCurso,totalFinal:e.totalFinal,nivel:e.nivel})
    }))

    const todos   = Object.values(porEst).sort((a,b)=>Math.max(...b.materias.map(m=>m.totalFinal))-Math.max(...a.materias.map(m=>m.totalFinal)))
    const honor   = todos.filter(e=>e.nivel==='honor')
    const excBase = todos.filter(e=>e.nivel==='excelencia')

    if (!todos.length) {
      el.innerHTML = '<div style="text-align:center;padding:50px;color:#6b7280;"><div style="font-size:40px;margin-bottom:12px;">🏫</div><div style="font-size:14px;font-weight:600;">Sin estudiantes de excelencia este período</div></div>'
      return
    }

    const _filaEst = (est, i) => {
      const maxNota = Math.max(...est.materias.map(m=>m.totalFinal))
      const mats = est.materias.map(m=>`<div style="font-size:11px;padding:2px 0;"><span style="color:#92400e;font-weight:700;">${escapeHtml(m.nombreMateria)}</span> <span style="color:#6b7280;">(${escapeHtml(m.nombreCurso)})</span> <span style="float:right;background:linear-gradient(135deg,#1a2a4a,#2d1b4e);color:#F0D080;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:800;">${m.totalFinal}</span></div>`).join('')
      return `<tr style="border-bottom:1px solid #f3f0e8;">
        <td style="padding:10px 14px;color:#92400e;font-weight:700;">${i+1}</td>
        <td style="padding:10px 14px;"><div style="font-weight:700;font-size:13px;">${escapeHtml(est.nombre)}</div><div style="font-size:10px;color:#6b7280;">${est.materias.length} materia${est.materias.length!==1?'s':''}</div></td>
        <td style="padding:10px 14px;min-width:200px;">${mats}</td>
        <td style="padding:10px 14px;text-align:center;"><span style="background:linear-gradient(135deg,#1a2a4a,#2d1b4e);color:#F0D080;border-radius:8px;padding:4px 12px;font-size:14px;font-weight:800;">${maxNota}</span></td>
        <td style="padding:10px 14px;text-align:center;">
          <button onclick="window._juntaVerCertificado(${JSON.stringify(est).replace(/"/g,'&quot;')}, '${(perfil?.nombre_completo??'').replace(/'/g,"\\'")}', ${periodo}, '${(colegio||NOMBRE_COLEGIO).replace(/'/g,"\\'")}', '${cfg.año}', '${ubicacion.replace(/'/g,"\\'")}')"
            style="background:linear-gradient(135deg,#C9A84C,#F0D080);color:#1a2a4a;border:none;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;">📜 Certificado</button>
        </td>
      </tr>`
    }

    const _tabla = (lista, titulo, badge) => `
      <div style="margin-bottom:24px;">
        <div style="background:linear-gradient(135deg,#1a2a4a,#2d1b4e);border-radius:10px;padding:10px 18px;display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="font-size:20px;">${badge}</span>
          <div><div style="color:#F0D080;font-size:13px;font-weight:700;">${titulo}</div><div style="color:#c4b5fd;font-size:11px;">${lista.length} estudiante${lista.length!==1?'s':''}</div></div>
        </div>
        <div style="overflow-x:auto;border-radius:10px;border:1px solid #e9e3d4;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fffdf5;">
          <thead><tr style="background:linear-gradient(135deg,#1a2a4a,#2d1b4e);">
            <th style="padding:10px 14px;color:#F0D080;font-size:11px;font-weight:700;text-align:left;">#</th>
            <th style="padding:10px 14px;color:#F0D080;font-size:11px;font-weight:700;text-align:left;">ESTUDIANTE</th>
            <th style="padding:10px 14px;color:#F0D080;font-size:11px;font-weight:700;text-align:left;">MATERIAS</th>
            <th style="padding:10px 14px;color:#F0D080;font-size:11px;font-weight:700;text-align:center;">NOTA MÁX</th>
            <th style="padding:10px 14px;color:#F0D080;font-size:11px;font-weight:700;text-align:center;">CERTIFICADO</th>
          </tr></thead>
          <tbody>${lista.map((e,i)=>_filaEst(e,i)).join('')}</tbody>
        </table></div>
      </div>`

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:16px;font-weight:800;color:#1a2a4a;margin:0 0 4px;">🏆 Estudiantes de Excelencia</h3>
          <p style="font-size:12px;color:#6b7280;margin:0;">${cfg.nombrePeriodo} ${periodo} · ${todos.length} estudiante${todos.length!==1?'s':''} con nota ≥ ${EXCELENCIA_BASE}</p>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:10px 16px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:#92400e;">${honor.length}</div>
            <div style="font-size:10px;color:#92400e;font-weight:600;">🏆 HONOR<br>97-100 pts</div>
          </div>
          <div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:10px;padding:10px 16px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:#374151;">${excBase.length}</div>
            <div style="font-size:10px;color:#374151;font-weight:600;">⭐ EXCELENCIA<br>95-96 pts</div>
          </div>
        </div>
      </div>
      ${honor.length    ? _tabla(honor,   'EXCELENCIA DE HONOR — 97 a 100 pts', '🏆') : ''}
      ${excBase.length  ? _tabla(excBase, 'EXCELENCIA — 95 a 96 pts',           '⭐') : ''}`
  }

  // ─── CERTIFICADO ─────────────────────────────────────────
  window._juntaVerCertificado = function(est, nombreProfesor, periodo, colegio, año, ubicacion) {
    const prev = document.getElementById('modal-cert-junta'); if (prev) prev.remove()
    const ps   = document.getElementById('cert-junta-style'); if (ps) ps.remove()

    const pStyle = document.createElement('style'); pStyle.id = 'cert-junta-style'
    pStyle.textContent = `@media print{body>*:not(#modal-cert-junta){display:none!important;}body{min-height:0!important;}#modal-cert-junta{display:flex!important;position:fixed!important;inset:0!important;background:#fff!important;align-items:center!important;justify-content:center!important;}#cert-doc-j{display:block!important;box-shadow:none!important;max-width:100%!important;width:6.4in!important;}.cert-no-print-j{display:none!important;}@page{size:letter portrait;margin:.4in .5in;}}`
    document.head.appendChild(pStyle)

    const esHonor    = est.nivel === 'honor'
    const badgeLabel = esHonor ? '🏆 EXCELENCIA DE HONOR · 97 – 100 PTS' : '⭐ DISTINCIÓN ACADÉMICA · 95 – 96 PTS'
    const medalText  = esHonor ? 'HONOR' : 'DIST.'
    const fechaHoy   = new Date().toLocaleDateString('es-BO',{day:'numeric',month:'long',year:'numeric'})
    const materias   = est.materias || []
    const cursos     = [...new Set(materias.map(m=>m.nombreCurso))]
    const cursoLabel = cursos.length===1?cursos[0]:'Varios cursos'
    const nombreColegio = colegio || NOMBRE_COLEGIO

    const filasM = materias.map(m=>`<tr>
      <td style="padding:5px 10px;font-size:11px;text-align:left;font-family:Arial,sans-serif;">
        ${escapeHtml(m.nombreMateria)}
      </td>
      <td style="padding:5px 10px;text-align:center;">
        <span style="background:linear-gradient(135deg,#1a2a4a,#2d1b4e);color:#F0D080;border-radius:6px;padding:2px 10px;font-size:13px;font-weight:800;font-family:Arial,sans-serif;">${m.totalFinal}/100</span>
      </td>
    </tr>`).join('')

    const medal = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="82" viewBox="0 0 64 86">
      <rect x="27" y="0" width="10" height="6" rx="2" fill="#9a7a1a"/>
      <rect x="28" y="6" width="8" height="24" fill="#C9A84C"/>
      <rect x="30" y="6" width="3" height="24" fill="#F0D080" opacity="0.7"/>
      <circle cx="32" cy="58" r="26" fill="#9a7a1a" opacity=".4"/>
      <circle cx="32" cy="58" r="24" fill="#C9A84C"/>
      <circle cx="32" cy="58" r="21" fill="#dba830"/>
      <circle cx="32" cy="58" r="18" fill="#F5E08A"/>
      <text x="32" y="54" text-anchor="middle" dominant-baseline="middle" font-family="Georgia,serif" font-size="14" font-weight="bold" fill="#1a2a4a">★</text>
      <text x="32" y="68" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.5" font-weight="800" fill="#1a2a4a" letter-spacing="1.2">${medalText}</text>
      <ellipse cx="25" cy="50" rx="5" ry="3" fill="#fff" opacity="0.25" transform="rotate(-20,25,50)"/>
    </svg>`

    const orn = (flip) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" style="transform:${flip};display:block;">
      <path d="M0,0 L22,0 L22,3 L3,3 L3,22 L0,22 Z" fill="#C9A84C"/>
      <path d="M0,0 L14,0 L14,1.5 L1.5,1.5 L1.5,14 L0,14 Z" fill="#F0D080"/>
    </svg>`

    const divLine = `<div style="display:flex;align-items:center;gap:8px;margin:10px 0;">
      <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,#C9A84C88);"></div>
      <span style="color:#C9A84C;font-size:12px;">✦</span>
      <div style="flex:1;height:1px;background:linear-gradient(90deg,#C9A84C88,transparent);"></div>
    </div>`

    const div = document.createElement('div')
    div.id = 'modal-cert-junta'
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;'
    div.innerHTML = `
      <div id="cert-doc-j" style="background:#f0ede6;border-radius:6px;box-shadow:0 10px 48px rgba(0,0,0,0.4);width:100%;max-width:560px;font-family:Georgia,serif;overflow:hidden;">

        <div style="height:5px;background:linear-gradient(90deg,#7a5c0a,#C9A84C,#F0D080,#C9A84C,#7a5c0a);"></div>

        <div style="background:#1a2a4a;padding:20px 28px 18px;text-align:center;position:relative;">
          <div style="position:absolute;top:8px;left:8px;">${orn('none')}</div>
          <div style="position:absolute;top:8px;right:8px;">${orn('scaleX(-1)')}</div>
          <div style="position:absolute;bottom:8px;left:8px;">${orn('scaleY(-1)')}</div>
          <div style="position:absolute;bottom:8px;right:8px;">${orn('scale(-1,-1)')}</div>
          <div style="display:flex;justify-content:center;margin-bottom:8px;">${medal}</div>
          <div style="color:#C9A84C;font-size:8px;font-family:Arial,sans-serif;letter-spacing:2.5px;font-weight:700;margin-bottom:4px;">UNIDAD EDUCATIVA</div>
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:4px;font-family:Georgia,serif;margin-bottom:6px;">"${escapeHtml(nombreColegio)}"</div>
          <div style="color:#C9A84C;font-size:7.5px;font-family:Arial,sans-serif;letter-spacing:1.5px;">WARNES – SANTA CRUZ – BOLIVIA · GESTIÓN ${año}</div>
        </div>

        <div style="height:4px;background:linear-gradient(90deg,#7a5c0a,#C9A84C,#F0D080,#C9A84C,#7a5c0a);"></div>

        <div style="background:#fff;padding:22px 44px 20px;text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#1a2a4a;letter-spacing:2px;line-height:1;font-family:Georgia,serif;margin-bottom:4px;">CERTIFICADO</div>
          <div style="font-size:9.5px;color:#C9A84C;letter-spacing:4px;font-family:Arial,sans-serif;font-weight:700;">DE EXCELENCIA ACADEMICA</div>
          ${divLine}
          <p style="font-size:11.5px;color:#555;font-family:Arial,sans-serif;margin:0 0 6px;line-height:1.6;">La Unidad Educativa "${escapeHtml(nombreColegio)}" otorga el presente certificado a:</p>
          <div style="font-size:22px;font-weight:800;color:#1a2a4a;font-style:italic;font-family:Georgia,serif;margin:4px 0 10px;line-height:1.25;">${escapeHtml(est.nombre)}</div>
          <p style="font-size:11px;color:#555;font-family:Arial,sans-serif;margin:0 0 10px;line-height:1.6;">por haber obtenido calificaciones de excelencia en el Trimestre ${periodo}, curso ${escapeHtml(cursoLabel)}, durante la gestión ${año}:</p>
          <div style="border:1px solid #e9e3d4;border-radius:8px;overflow:hidden;margin:0 0 14px;">
            <table style="width:100%;border-collapse:collapse;background:#fffdf5;">
              <thead><tr style="background:linear-gradient(135deg,#1a2a4a,#2d1b4e);">
                <th style="padding:7px 10px;color:#F0D080;font-size:10px;font-weight:700;text-align:left;font-family:Arial,sans-serif;">ASIGNATURA</th>
                <th style="padding:7px 10px;color:#F0D080;font-size:10px;font-weight:700;text-align:center;font-family:Arial,sans-serif;">CALIFICACIÓN</th>
              </tr></thead>
              <tbody>${filasM}</tbody>
            </table>
          </div>
          <div style="display:inline-block;background:linear-gradient(135deg,#B8860B,#C9A84C,#F0D080,#C9A84C,#B8860B);color:#1a2a4a;border-radius:30px;padding:7px 22px;font-size:10.5px;font-weight:700;letter-spacing:1.2px;font-family:Arial,sans-serif;margin-bottom:14px;">${badgeLabel}</div>
          <p style="font-size:10.5px;color:#888;font-style:italic;font-family:Georgia,serif;margin:0 0 10px;line-height:1.65;">"La excelencia academica es el resultado del esfuerzo constante y la disciplina."</p>
          <p style="font-size:10.5px;color:#555;font-family:Arial,sans-serif;margin:0 0 20px;">${ubicacion || 'Warnes, Santa Cruz – Bolivia'}, ${fechaHoy}</p>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:0 4px;">
            <div style="text-align:center;width:46%;">
              <div style="height:48px;"></div>
              <div style="border-top:1.5px solid #1a2a4a;padding-top:8px;">
                <div style="font-size:12px;font-weight:700;color:#1a2a4a;font-family:Arial,sans-serif;margin-bottom:3px;">Director(a)</div>
                <div style="font-size:9px;color:#6b7280;font-family:Arial,sans-serif;">U.E. "${escapeHtml(nombreColegio)}"</div>
              </div>
            </div>
            <div style="text-align:center;width:46%;">
              <div style="height:48px;"></div>
              <div style="border-top:1.5px solid #1a2a4a;padding-top:8px;">
                <div style="font-size:12px;font-weight:700;color:#1a2a4a;font-family:Arial,sans-serif;margin-bottom:3px;">${nombreProfesor.toUpperCase()}</div>
                <div style="font-size:9px;color:#6b7280;font-family:Arial,sans-serif;">DOCENTE DE LA ASIGNATURA</div>
              </div>
            </div>
          </div>
        </div>

        <div style="height:6px;background:linear-gradient(90deg,#7a5c0a,#C9A84C,#F0D080,#C9A84C,#7a5c0a);"></div>

        <div class="cert-no-print-j" style="background:#f8fafc;padding:12px 20px;display:flex;justify-content:center;gap:10px;border-top:1px solid #e5e7eb;">
          <button onclick="window._juntaImprimirCert('${escapeHtml(est.nombre)}')"
            style="background:linear-gradient(135deg,#1a2a4a,#2d3f6e);color:#F0D080;border:none;border-radius:8px;padding:9px 26px;font-weight:700;font-size:12px;cursor:pointer;">
            🖨️ Imprimir / Guardar PDF
          </button>
          <button onclick="document.getElementById('modal-cert-junta').remove();document.getElementById('cert-junta-style').remove();"
            style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:9px 20px;font-weight:600;font-size:12px;cursor:pointer;">
            Cerrar
          </button>
        </div>
      </div>`
    document.body.appendChild(div)
  }

  window._juntaImprimirCert = function(nombre) {
    const certDoc = document.getElementById('cert-doc-j')
    if (!certDoc) return
    const clone = certDoc.cloneNode(true)
    clone.querySelector('.cert-no-print-j')?.remove()
    clone.style.borderRadius = '0'
    clone.style.boxShadow    = 'none'
    clone.style.width        = '560px'
    clone.style.maxWidth     = '560px'
    const win = window.open('', '_blank', 'width=820,height=1060')
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>${nombre}</title>
      <style>
        * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; box-sizing:border-box; margin:0; padding:0; }
        html, body { width:100%; background:white; padding:0; margin:0; display:flex; justify-content:center; }
                        #cert-wrap { width:560px; transform:scale(1.32); transform-origin:top center; margin-top:10px; }
        @media print {
          html, body { margin:0; padding:0; width:100%; background:white; }
          #cert-wrap {
            width:560px;
            transform:scale(1.32);
            transform-origin:top center;
            margin:0 auto;
          }
          #cert-doc-j { box-shadow:none !important; border-radius:0 !important; }
          @page { size:letter portrait; margin:0.25in; }
        }
      </style>
    </head><body>
      <div id="cert-wrap">${clone.outerHTML}</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},600);};<\/script>
    </body></html>`)
    win.document.close()
    win.focus()
  }

  // ─── EVIDENCIAS ──────────────────────────────────────────
  async function _cargarEvidencias() {
    const el = document.getElementById('junta-ev-cont')
    if (!el) return
    const perfil  = _getPerfil()
    const periodo = parseInt(document.getElementById('selector-periodo-global')?.value || '1')
    if (!perfil?.id) { el.innerHTML = '<div style="color:#991b1b;padding:16px;">Perfil no disponible.</div>'; return }

    el.innerHTML = '<div style="color:#6b7280;padding:20px;">Cargando...</div>'

    let actaExistente = null
    try {
      const { data } = await supabase.from('notificaciones_log')
        .select('id, mensaje, created_at, enviado')
        .eq('tipo', TIPO_ACTA)
        .order('created_at', { ascending: false })
        .limit(100)
      ;(data || []).forEach(row => {
        if (actaExistente) return
        try {
          const p = JSON.parse(row.mensaje)
          if (p.profesor_id === perfil.id && p.trimestre === periodo)
            actaExistente = { id: row.id, created_at: row.created_at, ...p }
        } catch (_) {}
      })
    } catch (err) { console.error('Error cargando evidencias:', err) }

    const a = actaExistente || {}
    el.innerHTML = `
      <h3 style="font-size:15px;font-weight:700;color:#1e3a8a;margin-bottom:6px;">📋 Evidencias y Comunicaciones</h3>
      <p style="font-size:12px;color:#6b7280;margin-bottom:16px;">Se guarda en la base de datos. Puedes editar en cualquier momento.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <div style="font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:12px;">📅 Fechas de Comunicación</div>
          ${[
            ['ev-fecha-director', 'Entrega al Director',    a.fecha_director||''],
            ['ev-fecha-tutor',    'Comunicación al Tutor',  a.fecha_tutor||''],
            ['ev-fecha-padres',   'Notificación a Padres',  a.fecha_padres||''],
            ['ev-fecha-junta',    'Presentación en Junta',  a.fecha_junta||''],
          ].map(([id,lbl,val])=>`
            <div style="margin-bottom:12px;">
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">${lbl}</label>
              <input type="date" id="${id}" value="${val}" style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:13px;">
            </div>`).join('')}
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <div style="font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:12px;">📝 Observaciones</div>
          ${[
            ['ev-acciones',    'Acciones de refuerzo',           a.acciones||''],
            ['ev-compromisos', 'Compromisos asumidos en junta',  a.compromisos||''],
            ['ev-obs-general', 'Observación general',            a.obs_general||''],
          ].map(([id,lbl,val])=>`
            <div style="margin-bottom:12px;">
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">${lbl}</label>
              <textarea id="${id}" rows="2" style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:12px;resize:vertical;">${val}</textarea>
            </div>`).join('')}
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div id="ev-estado" style="font-size:12px;color:#6b7280;">${actaExistente?'Última actualización: '+new Date(actaExistente.created_at||'').toLocaleString('es-BO'):'Sin registros previos.'}</div>
        <div style="display:flex;gap:8px;">
          <button id="ev-exportar-pdf" style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;border-radius:8px;padding:9px 16px;font-weight:600;cursor:pointer;font-size:13px;">📄 Exportar hoja</button>
          <button id="ev-guardar" style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:#fff;border:none;border-radius:8px;padding:9px 20px;font-weight:700;cursor:pointer;font-size:13px;">💾 Guardar</button>
        </div>
      </div>
      <div id="ev-feedback" style="margin-top:6px;font-size:12px;"></div>`

    document.getElementById('ev-exportar-pdf').onclick = () => _exportarEvidenciasPDF(perfil, periodo)

    document.getElementById('ev-guardar').onclick = async () => {
      const btn = document.getElementById('ev-guardar'); btn.disabled=true; btn.textContent='⏳...'
      const v = id => document.getElementById(id)?.value || ''
      const payload = {
        profesor_id: perfil.id, trimestre: periodo, año: new Date().getFullYear(),
        fecha_director: v('ev-fecha-director') || null, fecha_tutor: v('ev-fecha-tutor') || null,
        fecha_padres:   v('ev-fecha-padres')   || null, fecha_junta: v('ev-fecha-junta') || null,
        acciones:       v('ev-acciones'),  compromisos: v('ev-compromisos'),
        obs_general:    v('ev-obs-general'), guardado_en: new Date().toISOString(),
      }
      try {
        let error
        if (actaExistente?.id) {
          const r = await supabase.from('notificaciones_log').update({mensaje:JSON.stringify(payload),created_at:new Date().toISOString()}).eq('id',actaExistente.id)
          error = r.error
          if (!error) actaExistente = { id: actaExistente.id, ...payload }
        } else {
          const r = await supabase.from('notificaciones_log').insert({tipo:TIPO_ACTA,mensaje:JSON.stringify(payload),enviado:false,estudiante_id:null,chat_id:null}).select('id').single()
          error = r.error
          if (!error) actaExistente = { id: r.data?.id, ...payload }
        }
        if (error) throw error
        document.getElementById('ev-feedback').innerHTML = `<span style="color:#065f46;font-weight:600;">✅ Guardado — ${new Date().toLocaleString('es-BO')}</span>`
        const elEstado = document.getElementById('ev-estado')
        if (elEstado) elEstado.textContent = 'Última actualización: ' + new Date().toLocaleString('es-BO')
      } catch(err) {
        document.getElementById('ev-feedback').innerHTML = `<span style="color:#991b1b;">❌ Error: ${err.message||err}</span>`
      }
      btn.disabled=false; btn.textContent='💾 Guardar'
    }
  }

  // ─── EXPORTAR PDF ────────────────────────────────────────
  function _exportarPDF() {
    const datos = window._juntaDatos
    if (!datos) { alert('Primero carga los datos.'); return }
    if (!window.jspdf?.jsPDF) { alert('jsPDF no disponible.'); return }
    const { jsPDF } = window.jspdf
    const { combos, totalEstudiantesUnicos, cfg, periodo } = datos
    const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'letter'})
    const mg=14; let y=16

    doc.setFillColor(30,58,138); doc.rect(0,0,220,26,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(`INFORME JUNTA TRIMESTRAL — ${cfg.nombrePeriodo} ${periodo}`, mg, 12)
    doc.setFontSize(8); doc.setFont('helvetica','normal')
    doc.text(`${datos.perfil?.nombre_completo||''} — ${new Date().toLocaleDateString('es-BO')} — ${datos.colegio||''}`, mg, 20)
    doc.setTextColor(0,0,0); y=32

    const idsRep = new Set(combos.flatMap(c=>c.riesgoReal.map(e=>e.id)))
    const idsExc = new Set(combos.flatMap(c=>c.excelencia.map(e=>e.id)))
    doc.setFont('helvetica','bold'); doc.setFontSize(9)
    doc.text(`Estudiantes: ${totalEstudiantesUnicos} | ${_lblRep()}: ${idsRep.size} | Excelencia: ${idsExc.size} | Umbral H+S: ${cfg.UMBRAL_HS} pts`, mg, y); y+=7

    doc.autoTable({
      head:[['Materia','Curso','Est.','HACER %','SABER %','% Aprobación',_lblRep(),'Excelencia']],
      body:combos.map(c=>[c.nombreMateria,c.nombreCurso,c.totalEstudiantes,c.pctHacer!==null?c.pctHacer+'%':'—',c.pctSaber!==null?c.pctSaber+'%':'—',c.pctAprobacion+'%',c.riesgoReal.length,c.excelencia.length]),
      startY:y, margin:{left:mg,right:mg},
      styles:{fontSize:8,cellPadding:2},
      headStyles:{fillColor:[30,58,138],textColor:255,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[245,247,255]}
    }); y=doc.lastAutoTable.finalY+10

    const todosB = []; combos.forEach(c=>c.riesgoReal.forEach(e=>todosB.push([e.nombre,c.nombreMateria,c.nombreCurso,e.promH!==null?e.promH+'/'+cfg.HACER_MAX:'—',e.promS!==null?e.promS+'/'+cfg.SABER_MAX:'—',e.totalFinal+'/'+cfg.TOTAL_MAX])))
    if (todosB.length) {
      if(y>200){doc.addPage();y=16}
      doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(153,27,27)
      doc.text(`${_lblRep().toUpperCase()} (${todosB.length})`,mg,y);doc.setTextColor(0,0,0);y+=6
      doc.autoTable({head:[['Estudiante','Materia','Curso','HACER','SABER','TOTAL']],body:todosB,startY:y,margin:{left:mg,right:mg},styles:{fontSize:7.5,cellPadding:2},headStyles:{fillColor:[153,27,27],textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[255,242,242]}})
      y=doc.lastAutoTable.finalY+10
    }

    doc.save(`junta-${cfg.nombrePeriodo.toLowerCase()}-${periodo}-${new Date().toISOString().slice(0,10)}.pdf`)
  }

  // ─── EXPORTAR SOLO HOJA DE EVIDENCIAS ────────────────────
  function _exportarEvidenciasPDF(perfil, periodo) {
    if (!window.jspdf?.jsPDF) { alert('jsPDF no disponible.'); return }
    const { jsPDF } = window.jspdf
    const v = id => document.getElementById(id)?.value || '—'
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const mg = 14; let y = 16

    doc.setFillColor(30,58,138); doc.rect(0,0,220,26,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(`HOJA DE EVIDENCIAS — JUNTA TRIMESTRAL ${periodo}`, mg, 12)
    doc.setFontSize(8); doc.setFont('helvetica','normal')
    doc.text(`${perfil?.nombre_completo||''} — ${new Date().toLocaleDateString('es-BO')} — ${window._juntaDatos?.colegio||''}`, mg, 20)
    doc.setTextColor(0,0,0); y = 34

    doc.setFont('helvetica','bold'); doc.setFontSize(11)
    doc.text('Fechas de Comunicación', mg, y); y += 8
    doc.setFont('helvetica','normal'); doc.setFontSize(10)
    ;[
      ['Entrega al Director',   v('ev-fecha-director')],
      ['Comunicación al Tutor', v('ev-fecha-tutor')],
      ['Notificación a Padres', v('ev-fecha-padres')],
      ['Presentación en Junta', v('ev-fecha-junta')],
    ].forEach(([lbl,val]) => { doc.text(`${lbl}: ${val}`, mg, y); y += 7 })

    y += 5
    doc.setFont('helvetica','bold'); doc.setFontSize(11)
    doc.text('Observaciones', mg, y); y += 8
    ;[
      ['Acciones de refuerzo',          v('ev-acciones')],
      ['Compromisos asumidos en junta', v('ev-compromisos')],
      ['Observación general',           v('ev-obs-general')],
    ].forEach(([lbl,val]) => {
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text(`${lbl}:`, mg, y); y += 6
      doc.setFont('helvetica','normal')
      const lineas = doc.splitTextToSize(val, 182)
      doc.text(lineas, mg, y); y += lineas.length*5 + 7
    })

    y = Math.max(y, 250)
    doc.setFont('helvetica','normal'); doc.setFontSize(9)
    doc.text('_______________________________', mg, y)
    doc.text('Firma del Profesor', mg, y+5)

    doc.save(`evidencias-junta-t${periodo}-${new Date().toISOString().slice(0,10)}.pdf`)
  }

  // ─── UTILIDADES ──────────────────────────────────────────
  function _mostrarLoading(show) {
    const ld = document.getElementById('junta-loading'); if(!ld) return
    ld.style.display = show ? 'block' : 'none'
    if (show) document.querySelectorAll('.junta-sec').forEach(s=>s.style.display='none')
  }

  function _mostrarError(msg) {
    _mostrarLoading(false)
    const el = document.getElementById('junta-sec-resumen')
    if (el) { el.style.display='block'; el.innerHTML=`<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:20px;color:#991b1b;font-weight:600;">${msg}</div>` }
  }

  // ─── EXPOSICIÓN GLOBAL ───────────────────────────────────
  window.abrirInformeJunta = abrirInformeJunta

})()