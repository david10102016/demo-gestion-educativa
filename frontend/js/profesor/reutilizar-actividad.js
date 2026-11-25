// ─── REUTILIZAR ACTIVIDAD ─────────────────────────────────────────────
// Copia una actividad (con su rúbrica y su archivo adjunto) a otros
// cursos o materias que el profesor tiene asignados. Cada copia es
// independiente: no copia notas ni entregas.
import { supabase } from '../config/supabase-config.js'
import { Config }   from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'

const OVERLAY_ID = 'modal-reutilizar-actividad'

function _inyectarEstilos() {
  if (document.getElementById('reu-estilos')) return
  const st = document.createElement('style')
  st.id = 'reu-estilos'
  st.textContent = `
    #${OVERLAY_ID} .modal-box { max-width:520px; width:calc(100% - 24px); }
    .reu-desc { font-size:13px; line-height:1.5; padding:10px 12px; border-radius:8px;
      background:color-mix(in srgb, var(--color-primary) 8%, transparent); margin-bottom:12px; }
    .reu-origen { font-size:13px; margin-bottom:12px; color:var(--color-text-2); }
    .reu-grupo-label { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
      color:var(--color-text-3); margin:12px 0 6px; }
    .reu-lista { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .reu-item { display:flex; align-items:center; gap:10px; padding:10px 12px; min-height:44px;
      border:1px solid var(--color-border); border-radius:10px; cursor:pointer; font-size:14px;
      background:var(--color-surface); }
    .reu-item input { width:20px; height:20px; flex:none; accent-color:var(--color-primary); margin:0; }
    .reu-item:has(input:checked) { border-color:var(--color-primary);
      background:color-mix(in srgb, var(--color-primary) 10%, transparent); }
    .reu-item small { display:block; color:var(--color-text-3); font-size:12px; }
    .reu-item.reu-otra:has(input:checked) { border-color:var(--color-warning);
      background:color-mix(in srgb, var(--color-warning) 12%, transparent); }
    .reu-scroll { max-height:min(50vh, 360px); overflow-y:auto; padding-right:2px; }
    .reu-vacio { font-size:14px; color:var(--color-text-3); padding:12px 0; }
    @media (max-width: 560px) { .reu-lista { grid-template-columns:1fr; } }
  `
  document.head.appendChild(st)
}

function _cerrar() { document.getElementById(OVERLAY_ID)?.remove() }

export async function abrirReutilizarActividad(actividadId, perfil) {
  if (!perfil?.id) { toast('Sesión no válida', 'error'); return }
  _inyectarEstilos()
  mostrarLoader('Cargando tus cursos...')

  const [{ data: act, error: e1 }, { data: asig, error: e2 }] = await Promise.all([
    supabase.from('actividades')
      .select('*, curso:cursos(nombre_completo), materia:materias(nombre, es_tecnica)')
      .eq('id', actividadId).single(),
    supabase.from('asignaciones_profesor')
      .select('curso_id, materia_id, curso:cursos(nombre_completo), materia:materias(nombre, es_tecnica)')
      .eq('profesor_id', perfil.id).eq('activo', true),
  ])
  ocultarLoader()
  if (e1 || !act) { toast('No se pudo cargar la actividad', 'error'); return }
  if (e2) { toast('No se pudieron cargar tus cursos', 'error'); return }

  if (act.trimestre !== Config.trimestreActivo) {
    toast(`Solo se pueden reutilizar actividades del ${Config.nombrePeriodo} ${Config.trimestreActivo} (activo)`, 'warning')
    return
  }

  // Destinos. Las ramas técnicas agrupan varios paralelos en una sola lista:
  // una actividad técnica ya llega a todos sus inscritos, así que cada rama
  // técnica cuenta como UN destino y la rama de origen se excluye.
  const origenTec = act.materia?.es_tecnica === true
  const mapa = new Map()
  for (const a of (asig ?? [])) {
    const tec = a.materia?.es_tecnica === true
    if (tec) {
      if (a.materia_id === act.materia_id) continue          // misma rama: ya la reciben todos
      const k = `tec:${a.materia_id}`
      if (!mapa.has(k)) mapa.set(k, { ...a, tec: true, misma: false,
        etiqueta: 'Rama técnica', sub: a.materia?.nombre ?? '' })
    } else {
      if (a.curso_id === act.curso_id && a.materia_id === act.materia_id && !origenTec) continue
      const k = `${a.curso_id}:${a.materia_id}`
      if (!mapa.has(k)) mapa.set(k, { ...a, tec: false, misma: a.materia_id === act.materia_id,
        etiqueta: a.curso?.nombre_completo ?? 'Curso', sub: a.materia?.nombre ?? '' })
    }
  }
  const destinos = [...mapa.values()]
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))
  const mismas = destinos.filter(d => d.misma)
  const otras  = destinos.filter(d => !d.misma)

  const item = (d, i) => `
    <label class="reu-item ${d.misma ? '' : 'reu-otra'}">
      <input type="checkbox" data-i="${i}">
      <span>${escapeHtml(d.etiqueta)}
        <small>${escapeHtml(d.sub)}</small></span>
    </label>`
  const idx = d => destinos.indexOf(d)

  _cerrar()
  const ov = document.createElement('div')
  ov.id = OVERLAY_ID
  ov.className = 'modal-overlay'
  ov.innerHTML = `
    <div class="modal-box">
      <div class="modal-header modal-header-gradient">
        <div class="modal-header-icon-lg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </div>
        <div class="modal-header-titles">
          <h2>Reutilizar actividad</h2>
          <p class="modal-subtitle">Copia esta actividad, con su rúbrica y su archivo, a otros cursos o materias que tienes asignados</p>
        </div>
        <button class="btn-close-modal" data-reu-cerrar>×</button>
      </div>
      <div class="modal-body">
        <div class="reu-origen">Actividad: <strong>${escapeHtml(act.titulo)}</strong><br>
          Origen: ${escapeHtml(act.materia?.nombre ?? '')} · ${origenTec ? 'rama técnica (todos los paralelos inscritos)' : escapeHtml(act.curso?.nombre_completo ?? '')}</div>
        <div class="reu-desc"><strong>¿Cómo funciona?</strong> Marca los cursos donde quieres la misma actividad.
          Se copia todo (fecha, puntos, rúbrica y archivo); después puedes editar cada copia por separado.
          Las notas no se copian.</div>
        <div class="reu-scroll">
          ${destinos.length ? '' : `<div class="reu-vacio">${origenTec ? 'Esta actividad ya llega a todos los paralelos inscritos en la rama técnica. No tienes otros cursos o materias donde reutilizarla.' : 'No tienes otros cursos asignados.'}</div>`}
          ${mismas.length ? `<div class="reu-grupo-label">Misma materia (${escapeHtml(act.materia?.nombre ?? '')})</div>
            <div class="reu-lista">${mismas.map(d => item(d, idx(d))).join('')}</div>` : ''}
          ${otras.length ? `<div class="reu-grupo-label">Otras materias</div>
            <div class="reu-lista">${otras.map(d => item(d, idx(d))).join('')}</div>` : ''}
        </div>
      </div>
      <div class="modal-footer modal-footer-gradient">
        <button class="btn btn-secondary" data-reu-cerrar>Cancelar</button>
        <button class="btn btn-primary" id="reu-btn-copiar" ${destinos.length ? '' : 'disabled'}>Reutilizar</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  ov.querySelectorAll('[data-reu-cerrar]').forEach(b => b.addEventListener('click', _cerrar))
  ov.addEventListener('click', e => { if (e.target === ov) _cerrar() })

  document.getElementById('reu-btn-copiar').addEventListener('click', async () => {
    const elegidos = [...ov.querySelectorAll('input[type=checkbox]:checked')].map(c => destinos[+c.dataset.i])
    if (!elegidos.length) { toast('Marca al menos un curso', 'warning'); return }

    const otrasMat = elegidos.filter(d => !d.misma)
    if (otrasMat.length) {
      const lista = otrasMat.map(d => d.tec ? `${d.sub} (rama técnica)` : `${d.sub} (${d.etiqueta})`).join(', ')
      const ok = await confirmar('Copiar a otra materia',
        `Vas a copiar una actividad de ${(act.materia?.nombre ?? '').toUpperCase()} a: ${lista}. ¿Es correcto?`, 'Sí, copiar', 'Cancelar')
      if (!ok) return
    }
    await _copiar(act, elegidos, perfil)
  })
}

async function _copiar(act, elegidos, perfil) {
  mostrarLoader('Reutilizando actividad...')

  // Rúbrica de origen (si tiene)
  const { data: crit } = await supabase.from('rubrica_criterios')
    .select('nombre, porcentaje, puntos_max, niveles, orden')
    .eq('actividad_id', act.id).order('orden')

  // Duplicados: misma actividad (título + trimestre) ya existente en destino
  const { data: existentes } = await supabase.from('actividades')
    .select('curso_id, materia_id, titulo')
    .eq('creado_por', perfil.id).eq('trimestre', act.trimestre)
    .in('materia_id', [...new Set(elegidos.map(d => d.materia_id))])
  const norm = s => (s ?? '').trim().toLowerCase()
  const yaExiste = d => (existentes ?? []).some(x =>
    x.materia_id === d.materia_id && (d.tec || x.curso_id === d.curso_id) && norm(x.titulo) === norm(act.titulo))

  const hechos = [], omitidos = [], fallidos = []
  for (const d of elegidos) {
    const etiqueta = d.tec ? `${d.sub} (rama técnica)` : `${d.etiqueta}${d.misma ? '' : ' · ' + d.sub}`
    if (yaExiste(d)) { omitidos.push(etiqueta); continue }

    const payload = {
      titulo: act.titulo, tipo: act.tipo, max_puntos: act.max_puntos, trimestre: act.trimestre,
      fecha_limite: act.fecha_limite, hora_limite: act.hora_limite, descripcion: act.descripcion,
      archivo_consigna_url: act.archivo_consigna_url,
      curso_id: d.curso_id, materia_id: d.materia_id, creado_por: perfil.id,
      ...(act.permite_entrega_tardia === true ? { permite_entrega_tardia: true } : {}),
    }
    const { data: nueva, error } = await supabase.from('actividades').insert(payload).select('id').single()
    if (error || !nueva) { fallidos.push(etiqueta); continue }

    if (crit?.length) {
      const { data: r, error: eR } = await supabase.rpc('guardar_rubrica_criterios', {
        p_actividad_id: nueva.id,
        p_criterios: crit.map((c, i) => ({ nombre: c.nombre, porcentaje: c.porcentaje,
          puntos_max: c.puntos_max, niveles: c.niveles, orden: c.orden ?? i })),
      })
      if (eR || r?.ok === false) { fallidos.push(etiqueta + ' (sin rúbrica)') }
    }
    hechos.push(etiqueta)
  }
  ocultarLoader()
  _cerrar()

  const partes = []
  if (hechos.length)   partes.push(`Actividad reutilizada en ${hechos.join(', ')}`)
  if (omitidos.length) partes.push(`Omitida en ${omitidos.join(', ')}: ya existía`)
  if (fallidos.length) partes.push(`No se pudo en ${fallidos.join(', ')}`)
  toast(partes.join('. ') || 'Sin cambios', fallidos.length ? 'warning' : (hechos.length ? 'success' : 'warning'), 7000)
}