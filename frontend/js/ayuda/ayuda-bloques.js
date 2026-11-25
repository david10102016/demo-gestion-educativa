// js/ayuda/ayuda-bloques.js
// Dibuja el contenido de Tutoriales: lista numerada, guía paso a paso (texto, lista, aviso, bloque copiable,
// maqueta de iPhone o imagen) y los botones/reproductor de video. Lo comparten el visor (ayuda.js) y el editor
// del superadmin (vista previa). No consulta datos ni conoce el panel: recibe todo por parámetro.
import { escapeHtml } from '../utils/sanitize.js'

const ic = (d, extra = '') => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`

export const I = {
  check:  ic('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', 'stroke-width="2.5"'),
  libro:  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  volver: ic('<polyline points="15 18 9 12 15 6"/>', 'stroke-width="2.4"'),
  chev:   '<svg class="ay-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"/></svg>',
  guia:   ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>'),
  play:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>',
  externo: ic('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  copiar: ic('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  info:   ic('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  alarma: ic('<circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 14.5"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>'),
  ojo:    ic('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  // íconos dentro de las maquetas (más pequeños, sin tamaño propio: lo da .ph-item svg)
  m_inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  m_campana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  m_notas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  m_doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  m_check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  m_libro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  m_chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  m_cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
}

// ── Maquetas de iPhone ──────────────────────────────────────────────────────────
// Cada pantalla recibe el nombre del colegio (sale del panel, nunca va fijo aquí) y usa --color-primary.
const status = '<div class="ph-status"><span>9:41</span><span>5G</span></div>'
const tel = html => `<div class="ph"><div class="ph-scr">${html}</div></div>`

export const PANTALLAS = {
  'est-menu': c => tel(`<div class="ph-pag">${status}<div class="ph-top">Inicio</div></div>
    <div class="ph-menu"><div class="col">${escapeHtml(c)}</div>
      <div class="ph-item">${I.m_inicio} Inicio</div>
      <div class="ph-item on">${I.m_campana} Mis tareas <span class="bd">2</span><span class="toque der"></span></div>
      <div class="ph-item">${I.m_notas} Mis notas</div>
      <div class="ph-item">${I.m_cal} Mi asistencia</div></div>`),
  'est-tareas-lista': () => tel(`${status}<div class="ph-top">Mis tareas</div><div class="ph-body">
    <div class="m-aviso"><b>Atento en clase:</b> tu profesor indica las tareas y las fechas.</div>
    <div class="m-alarma"><b>Tienes 2 por atender</b>
      <span class="m-chip">Matemática <span class="bd">1</span></span>
      <span class="m-chip">Física <span class="bd">1</span></span></div>
    <div class="m-fil"><span class="on">Pendientes (3)</span><span>Calificadas (5)</span><span>Todas (8)</span></div>
    <div class="m-card"><h5>Tareas (Hacer) · Trimestre 3</h5>
      <div class="m-row nueva"><div><small>Matemática <span class="m-tag">NUEVA</span></small><b>Ejercicios de logaritmos</b><br><i>Presentar hasta el 20-nov</i></div><i>Asignada</i></div>
      <div class="m-row nueva"><div><small>Física <span class="m-tag">NUEVA</span></small><b>Informe de laboratorio</b><br><i>Se presenta en clase</i></div><i>Asignada</i></div>
      <div class="m-row z"><div><small>Lenguaje</small><b>Ensayo argumentativo</b><br><i>Ya entregaste</i></div><i>Entregada</i></div>
    </div></div>`),
  'est-tareas-detalle': () => tel(`${status}<div class="ph-top">Mis tareas</div><div class="ph-body"><div class="m-card"><h5>Tareas (Hacer)</h5><div class="m-row nueva"><div><small>Matemática</small><b>Ejercicios de logaritmos</b></div></div></div></div>
    <div class="m-modal"><div><b style="color:var(--color-primary);font-size:11px">Matemática — Trimestre 3</b>
      <div style="margin-top:6px"><b>Ejercicios de logaritmos</b> <i style="float:right;font-style:normal;color:var(--color-text-3)">Sin calificar</i></div>
      <div style="color:var(--color-text-3);margin-top:3px">Fecha límite: <b style="color:#d97706">20 nov 2026 — 23:59hs</b></div>
      <span class="m-btn">Entregar<span class="toque"></span></span>
      <div style="color:var(--color-text-3);font-size:8px;margin-top:6px">PDF, JPG, PNG o TXT — máx. 10MB · hasta 2 archivos (0/2)</div></div></div>`),
  'est-tareas-entregada': () => tel(`${status}<div class="ph-top">Mis tareas</div><div class="ph-body"></div>
    <div class="m-modal"><div><b style="color:var(--color-primary);font-size:11px">Matemática — Trimestre 3</b>
      <div style="margin-top:6px"><b>Ejercicios de logaritmos</b></div>
      <div class="m-ok">Entregado: logaritmos.pdf<br><span class="m-btn" style="margin-top:4px">Ver / descargar</span> <span style="font-weight:400;color:var(--color-text-3)">Subido el 18 nov, 20:14</span></div>
      <span class="m-btn" style="margin-top:8px">Agregar otro archivo</span>
      <div style="color:var(--color-text-3);font-size:8px;margin-top:6px">hasta 2 archivos (1/2)</div></div></div>`),
  'est-tareas-nota': () => tel(`${status}<div class="ph-top">Mis tareas</div><div class="ph-body">
    <div class="m-alarma"><b>Tienes 1 por atender</b><span class="m-chip">Matemática <span class="bd">1</span></span></div>
    <div class="m-fil"><span class="on">Pendientes (1)</span><span>Calificadas (6)</span><span>Todas (8)</span></div>
    <div class="m-card"><h5>Tareas (Hacer) · Trimestre 3</h5>
      <div class="m-row nueva"><div><small>Matemática <span class="m-tag ok">NOTA NUEVA</span></small><b>Ejercicios de logaritmos</b><br><i>Presentar hasta el 20-nov</i></div><span class="m-nota">36<i>/40</i></span></div>
    </div></div>`),
}

// ── Maquetas de escritorio (profesor): ventana del sistema y hoja de Excel, con datos de ejemplo ──
// Siempre sin nombres reales ni del docente. El tamaño de letra escala con el ancho (todo va en em).
const BARRA_WIN = '<div class="win-bar"><i></i><i></i><i></i></div>'
const MENU_PROF = [['m_inicio', '#6366f1', 'Inicio'], ['m_doc', '#0ea5e9', 'Calificaciones', 1], ['m_check', '#10b981', 'Ficha SER'], ['m_cal', '#f59e0b', 'Asistencia'], ['m_libro', '#8b5cf6', 'Bitácora'], ['m_chat', '#3b82f6', 'Comunicados']]
const ALUMNOS = ['ARCE VARGAS LUCÍA', 'CRUZ MAMANI DIEGO', 'FLORES QUISPE ANA', 'MENDOZA ROJAS LUIS', 'SUAREZ PINTO CARLA']

const ventana = (colegio, interior, toolbar) => `<div class="win-wrap"><div class="win">${BARRA_WIN}
  <div class="win-body"><div class="win-side"><div class="col">${escapeHtml(colegio)}</div>
    ${MENU_PROF.map(([i, c, t, on]) => `<div class="it${on ? ' on' : ''}"><span style="--c:${c}">${I[i]}</span>${t}</div>`).join('')}</div>
  <div class="win-main"><div class="w-top">Calificaciones <span class="w-chip">6° Secundaria A</span><span class="w-chip">Tu materia</span><span class="w-chip">Trimestre 3</span></div>
    <div class="w-bar">${toolbar}</div>${interior}</div></div></div></div>`

const botones = foco => [['nueva', '+ Nueva actividad', 'pri'], ['exportar', 'Exportar Excel', ''], ['importar', 'Importar Excel', ''], ['x', 'Bajo Rendimiento', 'dim']]
  .map(([k, t, c]) => `<span class="w-btn ${c}">${t}${foco === k ? '<span class="toque"></span>' : ''}</span>`).join('')

const actividades = (filas, n) => `<div class="w-sec">Actividades del período</div>
  <div class="w-acord h">HACER <span class="n" style="background:#f59e0b">${n}</span></div>${filas}
  <div class="w-acord s">SABER <span class="n" style="background:#3b82f6">4</span></div>`

const tablaResumen = () => `<div class="w-sec">Resumen de calificaciones</div><table class="w-tab"><thead><tr><th>N°</th><th>Estudiante</th><th>Hacer</th><th>Saber</th><th>Ser</th><th>Total</th></tr></thead><tbody>
  ${ALUMNOS.slice(0, 4).map((a, i) => `<tr><td>${i + 1}</td><td>${a}</td>
    <td class="nota"><span class="v w-anim" style="--d:${i * 0.7}s">${[36, 31, 38, 27][i]}<small>/40</small></span></td>
    <td class="nota2">${[40, 35, 42, 30][i]}<small>/45</small></td><td class="nota2">—</td><td class="tot">${[76, 66, 80, 57][i]}</td></tr>`).join('')}</tbody></table>`

const celdas = [[30, 40, 36], [40, 40, 38], [28, 32, 31], [40, 36, 40], [22, 30, 27]]
const coma = n => n.toFixed(1).replace('.', ',')

export const PANTALLAS_ANCHAS = new Set(['prof-calif-nueva', 'prof-calif-exportar', 'prof-excel-llenar', 'prof-calif-importar'])

Object.assign(PANTALLAS, {
  'prof-calif-nueva': c => ventana(c, actividades(
    ['Actividad 1', 'Actividad 2', 'Tarea nueva'].map((t, i) => `<div class="w-act${i === 2 ? ' nueva w-anim' : ''}" ${i === 2 ? 'style="--d:1.2s"' : ''}><b>${t}</b><span>40 pts</span></div>`).join(''), 9), botones('nueva')),
  'prof-calif-exportar': c => ventana(c, actividades(
    ['Actividad 1', 'Actividad 2', 'Tarea nueva'].map(t => `<div class="w-act"><b>${t}</b><span>40 pts</span></div>`).join(''), 9)
    + '<div class="w-desc w-anim" style="--d:1s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Detalle de notas.xlsx</div>', botones('exportar')),
  'prof-calif-importar': c => ventana(c, tablaResumen(), botones('importar')),
  'prof-excel-llenar': () => `<div class="win-wrap"><div class="xl">
    <div class="xl-bar"><span>Detalle de notas.xlsx — Excel</span><span class="xl-key w-anim" style="--d:4.5s">Ctrl + G</span></div>
    <div class="xl-head">HACER — Tu materia — Trimestre 3</div>
    <div class="xl-aviso">Las columnas de color HACER son EDITABLES. Promedio y % se calculan automáticamente.</div>
    <table class="xl-t"><thead><tr><th>N°</th><th class="n">Estudiante</th><th>Actividad 1</th><th>Actividad 2</th><th class="nuevo">Tarea nueva<br>(máx 40)<span class="toque"></span></th><th class="calc">Nota HACER</th><th class="calc">% Alcanzado</th></tr></thead><tbody>
    ${celdas.map((f, i) => { const m = (f[0] + f[1] + f[2]) / 3; return `<tr><td>${i + 1}</td><td class="n">${ALUMNOS[i]}</td><td>${f[0]}</td><td>${f[1]}</td>
      <td class="nuevo"><span class="w-anim" style="--d:${i * 0.6}s">${f[2]}</span></td>
      <td class="calc"><span class="w-anim" style="--d:${i * 0.6 + 0.3}s">${coma(m)}</span></td><td class="calc"><span class="w-anim" style="--d:${i * 0.6 + 0.3}s">${coma(m / 40 * 100)}%</span></td></tr>` }).join('')}
    </tbody></table>
    <div class="xl-tabs"><span>Resumen General</span><span class="on">HACER</span><span>SABER</span><span>SER</span><span>AUTOEVALUACIÓN</span><span>Criterios de calificación</span><span>Asistencia</span><span class="meta">Meta</span></div></div></div>`,
})

// ── Maquetas de las ventanas de rúbrica (profesor) ──────────────────────────────
const NIVELES_EJ = [[0, 'No realizó la actividad / no desarrolla nada'], [55, 'Sigue el procedimiento de forma desorganizada, con errores en la técnica'], [65, 'Sigue el procedimiento básico, con algunos pasos correctos'],
  [75, 'Sigue el procedimiento con claridad, con manejo adecuado de la técnica'], [85, 'Ejecuta el procedimiento con buen dominio de la técnica y herramientas'], [100, 'Domina por completo el procedimiento y la técnica correspondiente']]
const modalWin = html => `<div class="win-wrap"><div class="win">${BARRA_WIN}<div class="w-fondo">${html}</div></div></div>`
const ICONO_MODAL = '<span class="w-mi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17l2 2 4-4"/></svg></span>'
const toque = on => on ? '<span class="toque"></span>' : ''

const modalRubrica = (focoJson) => modalWin(`<div class="w-modal">
  <div class="w-mh">${ICONO_MODAL}<div><b>Armar rúbrica — Hacer</b><small>Ajusta los criterios (suman 100%) y toca Guardar rúbrica</small></div>
    <span class="w-mh-b"><span class="w-chipb">Copiar JSON${toque(focoJson)}</span><span class="w-chipb">Pegar JSON${toque(focoJson)}</span></span></div>
  <div class="w-mc">
    <div class="w-crit"><div class="w-crit-top"><span class="w-in nom">Ejecución del procedimiento</span><span class="w-in pct">35</span><small>% = 14.0 pts</small></div>
      ${NIVELES_EJ.map(([p, t]) => `<div class="w-niv"><i>${p}%</i><span class="w-in">${t}</span></div>`).join('')}</div>
    <div class="w-crit"><div class="w-crit-top"><span class="w-in nom">Calidad del resultado final</span><span class="w-in pct">35</span><small>% = 14.0 pts</small></div>
      ${NIVELES_EJ.slice(0, 2).map(([p]) => `<div class="w-niv"><i>${p}%</i><span class="w-in">…</span></div>`).join('')}</div>
  </div>
  <div class="w-mf"><b class="w-suma">Suma actual: 100% ✓</b><span class="w-bts"><span class="w-b2">Cancelar</span><span class="w-b2 pri">Guardar rúbrica</span></span></div></div>`)

const editarHtml = (extra, foco) => `<div class="w-modal ang${extra}">
    <div class="w-mh">${ICONO_MODAL}<div><b>Editar actividad</b><small>Define título, dimensión, puntaje y plazo de entrega</small></div></div>
    <div class="w-mc">
      <div class="w-camp"><label>Título *</label><span class="w-in">Tarea de laboratorio</span></div>
      <div class="w-camps"><div class="w-camp"><label>Dimensión *</label><span class="w-in">HACER (40 pts)</span></div><div class="w-camp"><label>Puntos máx.</label><span class="w-in gris">40</span></div></div>
    </div>
    <div class="w-mf"><span class="w-b2 rub">Armar rúbrica${toque(foco)}</span><span class="w-bts"><span class="w-b2">Cancelar</span><span class="w-b2 pri">Guardar actividad</span></span></div></div>`
const CHECK_CONF = '<span class="w-cf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/></svg></span>'
const preguntaHtml = foco => `<div class="w-conf">${CHECK_CONF}<b>Actividad creada</b>
    <p>¿Calificarás esta actividad con rúbrica (por criterios)? Si eliges "No", se califica con una sola nota.</p>
    <div class="w-bts"><span class="w-b2 gr">No, nota directa${toque(foco === 'no')}</span><span class="w-b2 pri">Sí, armar rúbrica${toque(foco === 'si')}</span></div></div>`

Object.assign(PANTALLAS, {
  'prof-rubrica-boton': () => modalWin(editarHtml('', true)),
  'prof-act-pregunta-no': () => modalWin(editarHtml(' fade', false) + preguntaHtml('no')),
  'prof-act-pregunta-si': () => modalWin(editarHtml(' fade', false) + preguntaHtml('si')),
  'prof-rubrica-armar': () => modalRubrica(false),
  'prof-rubrica-json': () => modalRubrica(true),
  'prof-rubrica-pegar': () => modalWin(`<div class="w-modal peq">
    <div class="w-mc"><b class="w-pt">Pegar JSON de criterios</b>
      <small class="w-ps">Pega aquí (Ctrl+V) el JSON que te devolvió la IA externa, con el mismo formato que copiaste.</small>
      <div class="w-ta"><code>[ { "nombre": "Ejecución del procedimiento",<br>&nbsp;&nbsp;"porcentaje": 35,<br>&nbsp;&nbsp;"niveles": [ { "porcentaje": 0,<br>&nbsp;&nbsp;&nbsp;&nbsp;"descripcion": "No realizó…" }, …</code></div></div>
    <div class="w-mf"><span></span><span class="w-bts"><span class="w-b2">Cancelar</span><span class="w-b2 pri">Cargar criterios${toque(true)}</span></span></div></div>`),
})
for (const k of ['prof-act-pregunta-no', 'prof-act-pregunta-si', 'prof-rubrica-boton', 'prof-rubrica-armar', 'prof-rubrica-json', 'prof-rubrica-pegar']) PANTALLAS_ANCHAS.add(k)

// ── Maquetas de escritorio (director): carreras técnicas ─────────────────────────
// Datos ficticios. Los carnets de ejemplo no son reales.
const MENU_DIR = [['m_check', '#10b981', 'Estudiantes'], ['m_libro', '#8b5cf6', 'Profesores'], ['m_cal', '#f59e0b', 'Cursos'], ['m_doc', '#0ea5e9', 'Materias'],
  ['m_chat', '#3b82f6', 'Asignaciones'], ['m_notas', '#ec4899', 'Carreras técnicas'], ['m_inicio', '#6366f1', 'Configuración']]
const ventanaDir = (colegio, activo, titulo, interior, barra = '') => `<div class="win-wrap"><div class="win">${BARRA_WIN}
  <div class="win-body"><div class="win-side"><div class="col">${escapeHtml(colegio)}</div>
    ${MENU_DIR.map(([i, c, t]) => `<div class="it${t === activo ? ' on' : ''}"><span style="--c:${c}">${I[i]}</span>${t}</div>`).join('')}</div>
  <div class="win-main"><div class="w-top">${titulo}</div>${barra ? `<div class="w-bar">${barra}</div>` : ''}${interior}</div></div></div></div>`
const casilla = (on, texto, foco) => `<span class="w-ck${on ? ' on' : ''}"><i></i>${texto}${toque(foco)}</span>`
const CARRERA = 'Sistemas Informáticos'
const FILAS_CT = [['4829301', ALUMNOS[0], '6° Secundaria A'], ['5103842', ALUMNOS[1], '6° Secundaria B'], ['4977215', ALUMNOS[2], '6° Secundaria C'], ['5231168', ALUMNOS[3], '6° Secundaria A'], ['4890024', ALUMNOS[4], '6° Secundaria B']]

Object.assign(PANTALLAS, {
  'dir-ct-config': c => ventanaDir(c, 'Configuración', 'Configuración', `
    <div class="w-tabsb"><span>Datos del colegio</span><span class="on">Gestión académica</span><span>Dimensiones</span><span>Ficha SER</span></div>
    <div class="w-card"><b>Carreras técnicas especializadas</b>
      <p>Activa si el colegio ofrece especialidades técnicas (Sistemas Informáticos, Gastronomía, etc.) para 4to, 5to y 6to de Secundaria.</p>
      <div class="w-sw-fila"><span class="w-sw on"><i></i>${toque(true)}</span><b class="w-ok">Carreras técnicas activas</b></div></div>`),
  'dir-ct-materia': () => modalWin(`<div class="w-modal ang">
    <div class="w-mh">${ICONO_MODAL}<div><b>Nueva materia</b></div></div>
    <div class="w-mc">
      <div class="w-camp"><label>Nombre *</label><span class="w-in">${CARRERA}</span></div>
      <div class="w-camps"><div class="w-camp"><label>Nivel *</label><span class="w-in">Secundaria</span></div><div class="w-camp"><label>Campo de saberes *</label><span class="w-in">Ciencia Tecnología y Producción</span></div></div>
      <div class="w-camps"><div class="w-camp">${casilla(true, 'Es carrera técnica', true)}</div><div class="w-camp"><label>Aplica desde</label><span class="w-in">6to</span></div></div>
    </div>
    <div class="w-mf"><span></span><span class="w-bts"><span class="w-b2">Cancelar</span><span class="w-b2 pri">Guardar</span></span></div></div>`),
  'dir-ct-asignar': () => modalWin(`<div class="w-modal ang">
    <div class="w-mh">${ICONO_MODAL}<div><b>Nueva asignación</b></div></div>
    <div class="w-mc">
      <div class="w-camp"><label>1. Nivel *</label><span class="w-niveles"><span class="w-b2">Primaria</span><span class="w-b2 pri">Secundaria</span></span></div>
      <div class="w-camp"><label>2. Profesor *</label><span class="w-in">Profesor de ejemplo</span></div>
      <div class="w-camp"><label>3. Cursos donde enseña *</label><div class="w-grid">${casilla(true, '6° Secundaria A', true)}${casilla(true, '6° Secundaria B')}${casilla(true, '6° Secundaria C')}${casilla(false, '5° Secundaria A')}</div></div>
      <div class="w-camp"><label>4. Materias que dicta *</label><div class="w-sub">Carreras técnicas (se asignan aparte)</div><div class="w-grid">${casilla(true, CARRERA)}${casilla(false, 'Gastronomía')}</div></div>
      <div class="w-resumen">5. Se crearán 3 asignaciones (3 cursos × 1 materia).</div>
    </div>
    <div class="w-mf"><span></span><span class="w-bts"><span class="w-b2">Cancelar</span><span class="w-b2 pri">Guardar</span></span></div></div>`),
  'dir-ct-excel': () => `<div class="win-wrap"><div class="xl">
    <div class="xl-bar"><span>${CARRERA} 6to.xlsx — Excel</span></div>
    <table class="xl-t xl-ct"><thead><tr><th class="req">carnet</th><th class="req">materia</th><th>nombre_completo</th><th>curso_paralelo</th></tr></thead><tbody>
    ${FILAS_CT.map(([k, n, cur]) => `<tr><td>${k}</td><td>${CARRERA}</td><td class="n">${n}</td><td>${cur}</td></tr>`).join('')}</tbody></table>
    <div class="xl-leyenda"><span class="req"></span>Columnas obligatorias <span class="opc"></span>Opcionales</div>
    <div class="xl-tabs"><span class="on">Hoja1</span></div></div></div>`,
  'dir-ct-previa': c => ventanaDir(c, 'Carreras técnicas', 'Carreras técnicas',
    `<div class="w-hint">Formato del Excel: columnas requeridas <code>carnet</code> <code>materia</code> — opcional: <code>nombre_completo</code> <code>curso_paralelo</code></div>
     <div class="w-sec">Vista previa de importación</div>
     <table class="w-tab w-prev"><thead><tr><th>#</th><th>Carnet</th><th>Nombre</th><th>Paralelo</th><th>Carrera técnica</th><th>Estado</th><th>✓</th></tr></thead><tbody>
     ${[['4829301', ALUMNOS[0], '6° A', CARRERA, 'listo', 'ok'], ['5103842', ALUMNOS[1], '6° B', CARRERA, 'listo', 'ok'], ['4977215', ALUMNOS[2], '6° C', 'Sistemas Informatico', 'materia no encontrada', 'aviso'], ['5999000', ALUMNOS[3], '6° A', CARRERA, 'estudiante no encontrado', 'aviso']]
       .map((f, i) => `<tr class="${f[5]}"><td>${i + 1}</td><td>${f[0]}</td><td class="n">${f[1]}</td><td>${f[2]}</td><td>${f[3]}</td><td><b class="w-est ${f[5]}">${f[4]}</b></td><td>✓</td></tr>`).join('')}</tbody></table>
     <div class="w-bar" style="margin:.7em 0 0;justify-content:flex-end"><span class="w-b2">Crear faltantes</span><span class="w-b2 pri">Guardar inscripciones${toque(true)}</span></div>`,
    `<span class="w-btn dim">Ver inscritos</span><span class="w-btn pri">Importar Excel${toque(false)}</span>`),
})
for (const k of ['dir-ct-config', 'dir-ct-materia', 'dir-ct-asignar', 'dir-ct-excel', 'dir-ct-previa']) PANTALLAS_ANCHAS.add(k)

// ── Maquetas de escritorio (director): estudiantes ───────────────────────────────
const listaEst = (c, foco) => ventanaDir(c, 'Estudiantes', 'Estudiantes', `
    <div class="w-filtros"><span class="w-in">Buscar por nombre o carnet...</span><span class="w-in">Secundaria</span><span class="w-in">6° Secundaria A</span></div>
    <div class="w-bar"><span class="w-btn pri">+ Nuevo estudiante</span><span class="w-btn sec">Importar masivo${toque(foco === 'importar')}</span><span class="w-btn sec">Credenciales PDF${toque(foco === 'cred')}</span><span class="w-btn sec">Libretas por curso (ZIP)</span></div>
    <table class="w-tab w-est-t"><thead><tr><th>Nombre</th><th>Carnet</th><th>Curso</th><th>Estado</th><th>Acciones</th><th>Libreta</th></tr></thead><tbody>
    ${[[ALUMNOS[0], '4829301'], [ALUMNOS[1], '5103842'], [ALUMNOS[2], '4977215']].map((f, i) => `<tr><td class="n">${f[0]}</td><td>${f[1]}</td><td>6° A</td><td><b class="w-est ok">Activo</b></td>
      <td><span class="w-mini">Editar</span><span class="w-mini war">Reset${toque(foco === 'reset' && i === 0)}</span><span class="w-mini dan">Desactivar</span></td><td><span class="w-mini">Libreta</span></td></tr>`).join('')}</tbody></table>`)

Object.assign(PANTALLAS, {
  'dir-est-nuevo': () => modalWin(`<div class="w-modal ang">
    <div class="w-mh">${ICONO_MODAL}<div><b>Nuevo estudiante</b></div></div>
    <div class="w-mc">
      <div class="w-camps"><div class="w-camp"><label>Nombre completo *</label><span class="w-in">ARCE VARGAS LUCÍA</span></div><div class="w-camp"><label>Carnet *</label><span class="w-in">4829301</span></div></div>
      <div class="w-camps"><div class="w-camp"><label>Código RUDE (opcional)</label><span class="w-in gris">—</span></div><div class="w-camp"><label>Curso *</label><span class="w-in">6° Secundaria A</span></div></div>
      <div class="w-camps"><div class="w-camp"><label>Email institucional</label><span class="w-in gris">Se genera al guardar</span></div><div class="w-camp"><label>Contraseña</label><span class="w-in gris">Autogenerada</span></div></div>
    </div>
    <div class="w-mf"><span></span><span class="w-bts"><span class="w-b2">Cancelar</span><span class="w-b2 pri">Guardar</span></span></div></div>`),
  'dir-est-excel': () => `<div class="win-wrap"><div class="xl">
    <div class="xl-bar"><span>6to A - estudiantes.xlsx — Excel</span></div>
    <table class="xl-t xl-ct"><thead><tr><th class="req">Nombre Completo</th><th class="req">Carnet</th><th>RUDE</th></tr></thead><tbody>
    ${[[ALUMNOS[0], '4829301', '8197010720153543'], [ALUMNOS[1], '5103842', ''], [ALUMNOS[2], '4977215', '8197010720153561'], [ALUMNOS[3], '5231168', ''], [ALUMNOS[4], '4890024', '']].map(f => `<tr><td class="n">${f[0]}</td><td>${f[1]}</td><td>${f[2]}</td></tr>`).join('')}</tbody></table>
    <div class="xl-leyenda"><span class="req"></span>Obligatorias <span class="opc"></span>Opcional</div>
    <div class="xl-tabs"><span class="on">Hoja1</span></div></div></div>`,
  'dir-est-importar': c => listaEst(c, 'importar'),
  'dir-est-credenciales': c => listaEst(c, 'cred'),
  'dir-est-acciones': c => listaEst(c, 'reset'),
})
for (const k of ['dir-est-nuevo', 'dir-est-excel', 'dir-est-importar', 'dir-est-credenciales', 'dir-est-acciones']) PANTALLAS_ANCHAS.add(k)

/** Nombre legible de cada maqueta, para el selector del editor del superadmin. */
export const ETIQUETAS_PANTALLAS = {
  'est-menu':             'Estudiante · Menú con "Mis tareas"',
  'est-tareas-lista':     'Estudiante · Lista de tareas',
  'est-tareas-detalle':   'Estudiante · Detalle y botón Entregar',
  'est-tareas-entregada': 'Estudiante · Tarea ya entregada',
  'est-tareas-nota':      'Estudiante · Tarea con nota nueva',
  'prof-calif-nueva':     'Profesor · Calificaciones: botón Nueva actividad',
  'prof-calif-exportar':  'Profesor · Calificaciones: botón Exportar Excel',
  'prof-excel-llenar':    'Profesor · Excel: llenar notas de la actividad nueva',
  'prof-calif-importar':  'Profesor · Calificaciones: botón Importar Excel',
  'prof-act-pregunta-no': 'Profesor · Actividad creada: elegir "No, nota directa"',
  'prof-act-pregunta-si': 'Profesor · Actividad creada: elegir "Sí, armar rúbrica"',
  'prof-rubrica-boton':   'Profesor · Editar actividad: botón Armar rúbrica',
  'prof-rubrica-armar':   'Profesor · Armar rúbrica: criterios y niveles',
  'prof-rubrica-json':    'Profesor · Armar rúbrica: botones Copiar y Pegar JSON',
  'prof-rubrica-pegar':   'Profesor · Pegar JSON de criterios',
  'dir-ct-config':        'Director · Configuración: interruptor de carreras técnicas',
  'dir-ct-materia':       'Director · Nueva materia: Es carrera técnica',
  'dir-ct-asignar':       'Director · Nueva asignación: cursos y carrera técnica',
  'dir-ct-excel':         'Director · Excel de la carrera técnica',
  'dir-ct-previa':        'Director · Carreras técnicas: vista previa de importación',
  'dir-est-nuevo':        'Director · Nuevo estudiante: formulario',
  'dir-est-excel':        'Director · Excel para importar estudiantes de un curso',
  'dir-est-importar':     'Director · Estudiantes: botón Importar masivo',
  'dir-est-credenciales': 'Director · Estudiantes: botón Credenciales PDF',
  'dir-est-acciones':     'Director · Estudiantes: botones Editar, Reset y Desactivar',
}

export const NOMBRE_ROL = {
  director:   ['Dirección',   'Gestión y configuración del colegio'],
  profesor:   ['Docentes',    'Guías prácticas para profesores'],
  estudiante: ['Estudiantes', 'Tus tareas, notas y asistencia'],
  tutor:      ['Familias',    'Seguimiento de sus hijos'],
  secretaria: ['Secretaría',  'Pagos y registros'],
  regente:    ['Regencia',    'Ingreso y asistencia'],
}

// ── Texto del superadmin: se escapa todo y solo se permite **negrita** ──────────
const fmt = t => escapeHtml(String(t ?? '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
const arr = v => (Array.isArray(v) ? v : [])
const soloHttps = u => (/^https:\/\/[^\s"'<>`\\]+$/.test(String(u ?? '')) ? String(u) : null)

// ── Videos: cualquier red; se reproducen dentro del panel solo las que se pueden incrustar ──
const REDES = [
  { red: 'youtube',   nombre: 'YouTube',      test: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/ },
  { red: 'vimeo',     nombre: 'Vimeo',        test: /(^|\.)vimeo\.com$/ },
  { red: 'drive',     nombre: 'Google Drive', test: /^drive\.google\.com$/ },
  { red: 'tiktok',    nombre: 'TikTok',       test: /(^|\.)tiktok\.com$/ },
  { red: 'facebook',  nombre: 'Facebook',     test: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/ },
  { red: 'instagram', nombre: 'Instagram',    test: /(^|\.)instagram\.com$/ },
]

/** Id de un video de YouTube a partir de cualquier forma de enlace (null si no es de YouTube). */
export function idYoutube(url) {
  const m = String(url ?? '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/)
  return m ? m[1] : null
}

/**
 * Normaliza un video { url, titulo }. Devuelve null si el enlace no es https.
 * embed = URL del reproductor (solo YouTube, Vimeo y Drive); si es null, se abre en otra pestaña.
 */
export function detectarVideo(v) {
  const url = soloHttps(v?.url); if (!url) return null
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  const r = REDES.find(x => x.test.test(host))
  let embed = null
  if (r?.red === 'youtube') { const id = idYoutube(url); if (id) embed = `https://www.youtube-nocookie.com/embed/${id}?rel=0` }
  else if (r?.red === 'vimeo') { const m = url.match(/vimeo\.com\/(?:.*\/)?(\d{6,})/); if (m) embed = `https://player.vimeo.com/video/${m[1]}` }
  else if (r?.red === 'drive') { const m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/); if (m) embed = `https://drive.google.com/file/d/${m[1]}/preview` }
  const titulo = typeof v.titulo === 'string' && v.titulo.trim() ? v.titulo.trim() : ''
  return { url, embed, red: r?.red ?? 'otro', nombreRed: r?.nombre ?? '', titulo,
           etiqueta: titulo || (r ? `Ver en ${r.nombre}` : 'Ver video') }
}
export const videosDe = t => arr(t?.videos).map(detectarVideo).filter(Boolean)

/** Botones de video: reproduce dentro (data-video="idTutorial:n") o abre en otra pestaña. */
function botonesVideo(t) {
  return videosDe(t).map((v, n) => v.embed
    ? `<button type="button" class="ay-btn" data-video="${escapeHtml(t.id)}:${n}">${I.play}${escapeHtml(v.etiqueta)}</button>`
    : `<a class="ay-btn" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">${I.externo}${escapeHtml(v.etiqueta)}</a>`).join('')
}

/** Lista numerada de tutoriales de un rol (cada fila se despliega). abierto = id del tutorial desplegado. */
export function htmlLista(tutoriales, rol, abierto = null) {
  const [nombre, sub] = NOMBRE_ROL[rol] ?? ['Tutoriales', 'Aprende paso a paso']
  if (!tutoriales.length) return `<div class="ay"><div class="ay-vacio">Aún no hay tutoriales publicados para tu panel.</div></div>`
  return `<div class="ay">
    <div class="ay-lista-head"><span class="ic">${I.libro}</span><div><h2>${escapeHtml(nombre)}</h2><p>${escapeHtml(sub)}</p></div></div>
    ${tutoriales.map((t, i) => {
      const nv = videosDe(t).length, guia = arr(t.secciones).length > 0, ab = t.id === abierto
      return `<div class="ay-item${ab ? ' abierto' : ''}">
        <button type="button" class="ay-item-btn" data-fila="${escapeHtml(t.id)}" aria-expanded="${ab}">
          <span class="ay-item-n">${i + 1}</span><span class="ay-item-t">${escapeHtml(t.titulo)}</span>
          <span class="ay-badges">${guia ? `<span class="ay-badge">${I.guia}Guía</span>` : ''}${nv ? `<span class="ay-badge">${I.play}${nv > 1 ? nv + ' videos' : 'Video'}</span>` : ''}</span>${I.chev}
        </button>
        <div class="ay-item-body">
          ${arr(t.aprenderas).length ? `<h4>Aprenderás</h4><ul>${t.aprenderas.map(a => `<li>${I.check}<span>${fmt(a)}</span></li>`).join('')}</ul>` : ''}
          <div class="ay-acc">
            ${guia ? `<button type="button" class="ay-btn pri" data-guia="${escapeHtml(t.id)}">${I.guia}Ver guía paso a paso</button>` : ''}
            ${botonesVideo(t)}
          </div>
        </div>
      </div>`
    }).join('')}
  </div>`
}

/** Guía paso a paso. colegio = nombre que se muestra (sale del panel, no de aquí). */
export function htmlGuia(t, colegio) {
  const [nombre] = NOMBRE_ROL[t.rol] ?? ['']
  return `<div class="ay">
    <div class="ay-barra">
      <button type="button" class="ay-btn neutro" data-volver>${I.volver}Volver a tutoriales</button>
      <button type="button" class="ay-btn neutro" data-imprimir>Imprimir / PDF</button>
    </div>
    <div class="ay-head"><small>${escapeHtml(nombre)}</small><h1>${escapeHtml(t.titulo)}</h1>
      ${colegio ? `<span class="ay-chip">${escapeHtml(colegio)}</span>` : ''}</div>
    ${arr(t.secciones).map((s, i) => {
      const clave = s.maqueta ?? s.pantalla
      const img = soloHttps(s.imagen_url ?? s.imagen)
      const media = clave && PANTALLAS[clave] ? PANTALLAS[clave](colegio) : img ? `<img class="ay-img" src="${escapeHtml(img)}" alt="" loading="lazy">` : ''
      const av = s.aviso && typeof s.aviso === 'object' && s.aviso.texto ? s.aviso : null
      const tipo = av && ['info', 'alarma', 'ojo'].includes(av.tipo) ? av.tipo : 'info'
      const co = s.copiable && typeof s.copiable === 'object' && s.copiable.texto ? s.copiable : null
      return `<section class="ay-sec${media ? '' : ' solo-texto'}${clave && PANTALLAS_ANCHAS.has(clave) ? ' ancha' : ''}">
        <div>
          <div class="ay-sec-tit"><span class="ay-num">${i + 1}</span><h2>${escapeHtml(s.titulo ?? '')}</h2></div>
          ${arr(s.parrafos ?? s.texto).map(p => `<p>${fmt(p)}</p>`).join('')}
          ${arr(s.lista).length ? `<ul>${s.lista.map(l => `<li>${fmt(l)}</li>`).join('')}</ul>` : ''}
          ${av ? `<div class="ay-aviso ${tipo}">${I[tipo]}<span>${fmt(av.texto)}</span></div>` : ''}
          ${co ? `<div class="ay-copia"><div class="ay-copia-top"><span>${escapeHtml(co.titulo ?? 'Texto para copiar')}</span><button type="button" class="ay-btn neutro" data-copiar>${I.copiar}<span>Copiar</span></button></div><pre data-copia-texto>${escapeHtml(co.texto)}</pre></div>` : ''}
        </div>
        ${media}
      </section>`
    }).join('')}
  </div>`
}

/** Ventana con el reproductor (solo YouTube, Vimeo y Drive; el resto no pasa por aquí). */
export function htmlVideoModal(v) {
  if (!v?.embed) return ''
  return `<div class="ay-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(v.etiqueta)}"><div class="ay-modal-box">
    <div class="ay-modal-top"><span>${escapeHtml(v.etiqueta)}</span><button type="button" class="ay-btn neutro" data-cerrar-video>Cerrar</button></div>
    <div class="ay-video-wrap"><iframe src="${escapeHtml(v.embed)}" title="${escapeHtml(v.etiqueta)}"
      allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  </div></div>`
}

// ── Comportamiento compartido (visor y vista previa del editor) ─────────────────
let _modal = null, _foco = null
const teclaModal = e => { if (e.key === 'Escape') cerrarModalVideo() }

export function cerrarModalVideo() {
  if (!_modal) return
  _modal.remove(); _modal = null            // al quitar el iframe se detiene la reproducción
  document.body.classList.remove('ay-modal-abierto')
  document.removeEventListener('keydown', teclaModal)
  _foco?.focus?.(); _foco = null
}

/** Abre el reproductor (solo si el video se puede incrustar). Se cierra con Esc, "Cerrar" o tocando fuera. */
export function abrirModalVideo(v) {
  const html = htmlVideoModal(v); if (!html) return
  cerrarModalVideo()
  _foco = document.activeElement
  document.body.insertAdjacentHTML('beforeend', html)
  _modal = document.body.lastElementChild
  document.body.classList.add('ay-modal-abierto')
  _modal.addEventListener('click', e => { if (e.target === _modal || e.target.closest('[data-cerrar-video]')) cerrarModalVideo() })
  document.addEventListener('keydown', teclaModal)
  _modal.querySelector('[data-cerrar-video]')?.focus()
}

/** Copia el texto del bloque copiable que contiene al botón y avisa en el propio botón. */
export async function copiarBloque(btn) {
  const texto = btn.closest('.ay-copia')?.querySelector('[data-copia-texto]')?.textContent ?? ''
  let ok = false
  try { await navigator.clipboard.writeText(texto); ok = true } catch (_) {
    const ta = document.createElement('textarea'); ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta); ta.select()
    try { ok = document.execCommand('copy') } catch (_) {}
    ta.remove()
  }
  const span = btn.querySelector('span'); if (!span) return
  span.textContent = ok ? 'Copiado' : 'Selecciona y copia'
  setTimeout(() => { span.textContent = 'Copiar' }, 2000)
}