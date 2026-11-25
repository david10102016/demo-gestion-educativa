// js/admin/credenciales-pdf.js
import { supabase }                        from '../config/supabase-config.js'
import { Config }                          from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import { urlDelColegio } from '../utils/direccion-colegio.js'


// ─── UTILIDADES ──────────────────────────────────────────

function limpiarNombreArchivo(nombre) {
  return nombre.replace(/[°\s]+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').replace(/-+/g, '-')
}

/**
 * Genera una imagen QR en base64 usando la librería qrcode (global window.qrcode o QRCode).
 * Devuelve un dataURL PNG.
 */
async function generarQRDataURL(texto, tamaño = 80) {
  return new Promise((resolve, reject) => {
    try {
      const div = document.createElement('div')
      div.style.display = 'none'
      document.body.appendChild(div)

      new QRCode(div, {
        text: texto,
        width: tamaño,
        height: tamaño,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      })

      // qrcodejs genera la imagen de forma síncrona
      const img = div.querySelector('img')
      const canvas = div.querySelector('canvas')

      if (canvas) {
        resolve(canvas.toDataURL('image/png'))
      } else if (img) {
        img.onload = () => resolve(img.src)
        if (img.complete) resolve(img.src)
      } else {
        reject(new Error('QRCode no generó imagen'))
      }

      document.body.removeChild(div)
    } catch (e) {
      reject(e)
    }
  })
}

// ─── RENDERIZADO DE TARJETAS ─────────────────────────────

// Color del colegio (de su configuración) y utilidades de color. Sin azul fijo en el código.
const colorValido = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : '#1573a2')
const hexARgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255] }
// Tono claro del color del colegio (para franjas; el texto va siempre en negro y negrita)
const tinteRgb = (hex, k = 0.16) => hexARgb(hex).map(v => Math.round(255 - (255 - v) * k))

// Ajusta el tamaño de letra para que el texto entre en el ancho (jsPDF mide con la fuente activa)
function ajustarFuente(doc, texto, max, ancho, min = 4.5) {
  doc.setFontSize(max)
  const w = doc.getTextWidth(texto)
  return w <= ancho ? max : Math.max(min, max * ancho / w)
}

// Parte un texto en 2 filas de largo parejo, cortando entre palabras
function dosFilas(texto) {
  const p = String(texto ?? '').split(/\s+/).filter(Boolean)
  if (p.length < 2) return [p.join(' '), '']
  let mejor = 1, dif = Infinity
  for (let i = 1; i < p.length; i++) {
    const d = Math.abs(p.slice(0, i).join(' ').length - p.slice(i).join(' ').length)
    if (d < dif) { dif = d; mejor = i }
  }
  return [p.slice(0, mejor).join(' '), p.slice(mejor).join(' ')]
}

// ─── RENDERIZADO DE TARJETAS ─────────────────────────────
// Misma grilla de siempre (4 × 4 por hoja carta). Colores del colegio, texto negro en negrita.

async function renderizarCredenciales(doc, estudiantes, qrDataURL, nombreColegio = '', colorColegio = null) {
  const PW = 792, PH = 612
  const COLS = 4, ROWS = 4, POR_PAG = COLS * ROWS
  const MX = 20, MY = 16
  const TW = (PW - 2 * MX) / COLS
  const TH = (PH - 2 * MY) / ROWS
  const C   = colorValido(colorColegio)
  const T   = tinteRgb(C)
  const Crgb = hexARgb(C)
  const NEGRO = [11, 18, 32]
  const QR  = 45          // lado del QR (pt): 36 + 25 %
  const CINTA = 5         // cinta sólida del color del colegio arriba

  // Agrupar por curso
  const porCurso = {}
  for (const e of estudiantes) {
    const nc = e.cursos?.nombre_completo ?? 'Sin curso'
    if (!porCurso[nc]) porCurso[nc] = []
    porCurso[nc].push(e)
  }

  let globalIdx = 0

  for (const [nombreCurso, lista] of Object.entries(porCurso).sort()) {
    const sorted = lista.sort((a, b) =>
      (a.usuarios?.nombre_completo ?? '').localeCompare(b.usuarios?.nombre_completo ?? ''))

    for (let i = 0; i < sorted.length; i++) {
      if (globalIdx > 0 && globalIdx % POR_PAG === 0) doc.addPage()

      const pos  = globalIdx % POR_PAG
      const fila = Math.floor(pos / COLS)
      const col  = pos % COLS
      const x0   = MX + col * TW
      const y0   = MY + fila * TH
      const e    = sorted[i]

      const nombre = (e.usuarios?.nombre_completo ?? '').toUpperCase()
      const email  = e.usuarios?.email ?? e.carnet + '@educativa.com'
      const clave  = String(e.carnet ?? '')

      // Línea de corte punteada (gris), por fuera de la tarjeta
      doc.setLineDash([3, 3], 0)
      doc.setDrawColor(160, 160, 160)
      doc.setLineWidth(0.5)
      doc.rect(x0 + 1, y0 + 1, TW - 2, TH - 2)
      doc.setLineDash([])

      // Tarjeta
      const x = x0 + 4, y = y0 + 4, w = TW - 8, h = TH - 8
      const HEAD = 41                    // alto del encabezado
      const FOOT = 13                    // alto del pie
      doc.setFillColor(255, 255, 255)
      doc.setDrawColor(...Crgb)
      doc.setLineWidth(1.4)
      doc.roundedRect(x, y, w, h, 4, 4, 'FD')

      // Encabezado en tono claro + cinta sólida del color del colegio
      doc.setFillColor(...T)
      doc.roundedRect(x + 0.7, y + 0.7, w - 1.4, HEAD, 3.4, 3.4, 'F')
      doc.rect(x + 0.7, y + HEAD - 6, w - 1.4, 6.7, 'F')       // squadra la esquina inferior
      doc.setFillColor(...Crgb)
      doc.roundedRect(x + 0.7, y + 0.7, w - 1.4, CINTA + 3, 3.4, 3.4, 'F')
      doc.rect(x + 0.7, y + CINTA, w - 1.4, 4, 'F')            // recta bajo la cinta
      doc.setDrawColor(...Crgb)
      doc.setLineWidth(1.6)
      doc.line(x + 0.7, y + HEAD, x + w - 0.7, y + HEAD)

      // Textos del encabezado: colegio (2 filas, tamaño automático), título y curso
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...NEGRO)
      const anchoTxt = w - 14
      const [l1, l2] = dosFilas(nombreColegio)
      let fsCol = 6.6
      let yTxt = y + CINTA + 10.5
      if (nombreColegio) {
        fsCol = Math.min(ajustarFuente(doc, l1, 7, anchoTxt), ajustarFuente(doc, l2 || l1, 7, anchoTxt))
        doc.setFontSize(fsCol)
        doc.text(l1, x + w / 2, yTxt, { align: 'center' })
        if (l2) { yTxt += fsCol * 1.05; doc.text(l2, x + w / 2, yTxt, { align: 'center' }) }
      }
      const tituloLinea = `CREDENCIAL DE ACCESO  ·  ${nombreCurso}`
      doc.setFontSize(ajustarFuente(doc, tituloLinea, 8, anchoTxt))
      doc.text(tituloLinea, x + w / 2, Math.min(yTxt + 10, y + HEAD - 4), { align: 'center' })

      // Nombre del estudiante: hasta 2 filas, tamaño automático
      const partes = nombre.split(' ').filter(Boolean)
      let n1 = '', n2 = ''
      partes.forEach(p => {
        if ((n1 + ' ' + p).trim().length <= 26 && !n2) n1 = (n1 + ' ' + p).trim()
        else n2 = (n2 + ' ' + p).trim()
      })
      const fsNom = Math.min(ajustarFuente(doc, n1, 8.6, w - 14), n2 ? ajustarFuente(doc, n2, 8.6, w - 14) : 8.6)
      doc.setFontSize(fsNom)
      const yNom = y + HEAD + 10.5
      doc.text(n1, x + w / 2, yNom, { align: 'center' })
      if (n2) doc.text(n2, x + w / 2, yNom + fsNom + 1.2, { align: 'center' })

      // Zona de datos: izquierda usuario y contraseña, derecha el QR centrado en su zona
      const yZona0 = y + HEAD + (n2 ? 25 : 15)
      const yZona1 = y + h - FOOT - 1
      const colIzqW = w - QR - 26
      const xIzq = x + 8

      const altoDatos = 6 + 9.4 + 10 + 10.4            // bloque usuario + contraseña
      const yD = yZona0 + ((yZona1 - yZona0) - altoDatos) / 2 + 5
      doc.setFontSize(6.4)
      doc.text('USUARIO', xIzq, yD)
      const fsMail = ajustarFuente(doc, email, 7.8, colIzqW, 5)
      doc.setFontSize(fsMail)
      doc.text(email, xIzq, yD + 9.4)
      doc.setFontSize(6.4)
      doc.text('CONTRASEÑA', xIzq, yD + 9.4 + 12)
      doc.setFontSize(ajustarFuente(doc, clave, 9.4, colIzqW, 6))
      doc.text(clave, xIzq, yD + 9.4 + 12 + 10.4)

      // QR centrado (en el recuadro de la derecha, a media altura de la zona de datos)
      if (qrDataURL) {
        const cx = x + w - 8 - QR / 2 - 3
        const qy = yZona0 + ((yZona1 - yZona0) - QR) / 2
        doc.addImage(qrDataURL, 'PNG', cx - QR / 2, qy, QR, QR)
      }

      // Pie en tono claro
      doc.setFillColor(...T)
      doc.rect(x + 0.7, y + h - FOOT, w - 1.4, FOOT - 0.7, 'F')
      doc.setDrawColor(...Crgb)
      doc.setLineWidth(1.2)
      doc.line(x + 0.7, y + h - FOOT, x + w - 0.7, y + h - FOOT)
      const pie = 'Escanea el QR para ingresar. Cambia tu contraseña en tu panel.'
      doc.setFontSize(ajustarFuente(doc, pie, 5.6, w - 12, 4.6))
      doc.setTextColor(...NEGRO)
      doc.text(pie, x + w / 2, y + h - 4.6, { align: 'center' })

      globalIdx++
    }
  }
}

// ─── MODAL DE SELECCIÓN ──────────────────────────────────

async function abrirModalCredenciales() {
  // Cargar cursos agrupados
  const { data: cursos } = await supabase
    .from('cursos')
    .select('id, nombre_completo, nivel')
    .eq('activo', true)
    .order('nivel').order('grado').order('paralelo')

  const primaria   = (cursos ?? []).filter(c => c.nivel === 'Primaria')
  const secundaria = (cursos ?? []).filter(c => c.nivel === 'Secundaria')

  const opcionesPrimaria   = primaria.map(c =>
    `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('')
  const opcionesSecundaria = secundaria.map(c =>
    `<option value="${c.id}">${escapeHtml(c.nombre_completo)}</option>`).join('')

  // Eliminar modal anterior si existe
  document.getElementById('modal-credenciales-export')?.remove()

  const overlay = document.createElement('div')
  overlay.id = 'modal-credenciales-export'
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)'
  })

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;max-width:460px;width:100%;
      box-shadow:0 25px 50px rgba(0,0,0,0.25);max-height:90vh;overflow-y:auto;">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#0f172a;">🖨️ Exportar Credenciales PDF</h3>
        <button id="cred-modal-cerrar" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;">×</button>
      </div>

      <p style="margin:0 0 16px;font-size:0.85rem;color:#64748b;">¿Cómo deseas exportar las credenciales?</p>

      <!-- Opción 1: Todo el colegio -->
      <label style="display:flex;align-items:flex-start;gap:12px;padding:14px;border:2px solid #e2e8f0;
        border-radius:10px;cursor:pointer;margin-bottom:10px;transition:border-color .2s;"
        id="lbl-opcion-todo">
        <input type="radio" name="cred-opcion" value="todo" style="margin-top:3px;width:16px;height:16px;cursor:pointer;">
        <div>
          <div style="font-weight:600;font-size:14px;color:#0f172a;">📦 Todo el colegio</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Descarga un ZIP con Primaria.pdf y Secundaria.pdf</div>
        </div>
      </label>

      <!-- Opción 2: Por nivel -->
      <label style="display:flex;align-items:flex-start;gap:12px;padding:14px;border:2px solid #e2e8f0;
        border-radius:10px;cursor:pointer;margin-bottom:10px;transition:border-color .2s;"
        id="lbl-opcion-nivel">
        <input type="radio" name="cred-opcion" value="nivel" style="margin-top:3px;width:16px;height:16px;cursor:pointer;">
        <div style="width:100%;">
          <div style="font-weight:600;font-size:14px;color:#0f172a;">🏫 Por nivel</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Descarga un PDF con todos los cursos del nivel</div>
          <div id="cred-nivel-opciones" style="display:none;margin-top:10px;display:none;">
            <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer;">
              <input type="radio" name="cred-nivel" value="Primaria"> Primaria
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
              <input type="radio" name="cred-nivel" value="Secundaria"> Secundaria
            </label>
          </div>
        </div>
      </label>

      <!-- Opción 3: Por curso -->
      <label style="display:flex;align-items:flex-start;gap:12px;padding:14px;border:2px solid #e2e8f0;
        border-radius:10px;cursor:pointer;margin-bottom:20px;transition:border-color .2s;"
        id="lbl-opcion-curso">
        <input type="radio" name="cred-opcion" value="curso" style="margin-top:3px;width:16px;height:16px;cursor:pointer;">
        <div style="width:100%;">
          <div style="font-weight:600;font-size:14px;color:#0f172a;">📋 Por curso específico</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Descarga un PDF solo con ese curso</div>
          <div id="cred-curso-opciones" style="display:none;margin-top:10px;">
            ${primaria.length ? `
            <div style="margin-bottom:8px;">
              <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Primaria</div>
              <select id="cred-select-primaria" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
                <option value="">— Selecciona curso —</option>
                ${opcionesPrimaria}
              </select>
            </div>` : ''}
            ${secundaria.length ? `
            <div>
              <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Secundaria</div>
              <select id="cred-select-secundaria" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
                <option value="">— Selecciona curso —</option>
                ${opcionesSecundaria}
              </select>
            </div>` : ''}
          </div>
        </div>
      </label>

      <!-- Botones -->
      <div style="display:flex;gap:10px;">
        <button id="cred-btn-exportar" style="flex:1;padding:11px;background:#4f46e5;color:#fff;border:none;
          border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;">
          Exportar
        </button>
        <button id="cred-btn-cancelar" style="flex:1;padding:11px;background:#f1f5f9;color:#374151;border:none;
          border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;">
          Cancelar
        </button>
      </div>
    </div>`

  document.body.appendChild(overlay)

  // Resaltar opción seleccionada
  const labels = ['lbl-opcion-todo', 'lbl-opcion-nivel', 'lbl-opcion-curso']
  overlay.querySelectorAll('input[name="cred-opcion"]').forEach(radio => {
    radio.addEventListener('change', () => {
      labels.forEach(id => {
        document.getElementById(id).style.borderColor = '#e2e8f0'
      })
      const lbl = radio.closest('label')
      if (lbl) lbl.style.borderColor = '#4f46e5'

      // Mostrar/ocultar sub-opciones
      const nivelOpts = document.getElementById('cred-nivel-opciones')
      const cursoOpts = document.getElementById('cred-curso-opciones')
      nivelOpts.style.display = radio.value === 'nivel' ? 'block' : 'none'
      cursoOpts.style.display = radio.value === 'curso' ? 'block' : 'none'

      // Limpiar selects del otro panel
      if (radio.value !== 'curso') {
        const sp = document.getElementById('cred-select-primaria')
        const ss = document.getElementById('cred-select-secundaria')
        if (sp) sp.value = ''
        if (ss) ss.value = ''
      }
    })
  })

  // Limpiar selects mutuamente excluyentes
  const selP = document.getElementById('cred-select-primaria')
  const selS = document.getElementById('cred-select-secundaria')
  selP?.addEventListener('change', () => { if (selP.value && selS) selS.value = '' })
  selS?.addEventListener('change', () => { if (selS.value && selP) selP.value = '' })

  // Cerrar
  const cerrar = () => overlay.remove()
  document.getElementById('cred-modal-cerrar').onclick = cerrar
  document.getElementById('cred-btn-cancelar').onclick = cerrar
  overlay.addEventListener('click', e => { if (e.target === overlay) cerrar() })

  // Exportar
  document.getElementById('cred-btn-exportar').onclick = async () => {
    const opcion = overlay.querySelector('input[name="cred-opcion"]:checked')?.value
    if (!opcion) { toast('Selecciona una opción de exportación', 'warning'); return }

    if (opcion === 'nivel') {
      const nivel = overlay.querySelector('input[name="cred-nivel"]:checked')?.value
      if (!nivel) { toast('Selecciona un nivel (Primaria o Secundaria)', 'warning'); return }
      cerrar()
      await exportarPorNivel(nivel)
      return
    }

    if (opcion === 'curso') {
      const cursoId = selP?.value || selS?.value
      if (!cursoId) { toast('Selecciona un curso', 'warning'); return }
      const nombreCurso = (cursos ?? []).find(c => c.id === cursoId)?.nombre_completo ?? 'curso'
      cerrar()
      await exportarPorCurso(cursoId, nombreCurso)
      return
    }

    // todo el colegio
    cerrar()
    await exportarTodoColegio()
  }
}

// ─── EXPORTAR: UN CURSO ──────────────────────────────────

async function exportarPorCurso(cursoId, nombreCurso) {
  mostrarLoader('Generando credenciales...')
  try {
    const jsPDF = window.jspdf?.jsPDF
    if (!jsPDF) { toast('jsPDF no está disponible', 'error'); return }

    const { data, error } = await supabase.from('estudiantes')
      .select('carnet, curso_id, usuarios(nombre_completo, email, activo), cursos(nombre_completo)')
      .eq('curso_id', cursoId)
    if (error || !data?.length) { toast('No hay estudiantes en este curso', 'warning'); return }

    const activos = data.filter(e => e.usuarios?.activo !== false)
    if (!activos.length) { toast('No hay estudiantes activos en este curso', 'warning'); return }

    const { data: colData } = await supabase.from('colegios').select('id, nombre, color_primario, subdominio').single()
    const nombreColegio = colData?.nombre ?? ''
    const qrDataURL = await generarQRDataURL(urlDelColegio(colData), 360).catch(() => null)
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
    await renderizarCredenciales(doc, activos, qrDataURL, nombreColegio, colData?.color_primario)

    const nombreArchivo = `credenciales-${limpiarNombreArchivo(nombreCurso)}.pdf`
    doc.save(nombreArchivo)
    toast('PDF generado correctamente', 'success')
  } catch (err) {
    toast('Error generando PDF: ' + err.message, 'error')
  } finally { ocultarLoader() }
}

// ─── EXPORTAR: POR NIVEL ─────────────────────────────────

async function exportarPorNivel(nivel) {
  mostrarLoader(`Generando credenciales de ${nivel}...`)
  try {
    const jsPDF = window.jspdf?.jsPDF
    if (!jsPDF) { toast('jsPDF no está disponible', 'error'); return }

    const { data: cursosNivel } = await supabase.from('cursos')
      .select('id').eq('nivel', nivel).eq('activo', true)
    const ids = (cursosNivel ?? []).map(c => c.id)
    if (!ids.length) { toast(`No hay cursos activos en ${nivel}`, 'warning'); return }

    const { data, error } = await supabase.from('estudiantes')
      .select('carnet, curso_id, usuarios(nombre_completo, email, activo), cursos(nombre_completo)')
      .in('curso_id', ids)
    if (error || !data?.length) { toast(`No hay estudiantes en ${nivel}`, 'warning'); return }

    const activos = data.filter(e => e.usuarios?.activo !== false)
    if (!activos.length) { toast(`No hay estudiantes activos en ${nivel}`, 'warning'); return }

    const { data: colData } = await supabase.from('colegios').select('id, nombre, color_primario, subdominio').single()
    const nombreColegio = colData?.nombre ?? ''
    const qrDataURL = await generarQRDataURL(urlDelColegio(colData), 360).catch(() => null)
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
    await renderizarCredenciales(doc, activos, qrDataURL, nombreColegio, colData?.color_primario)

    doc.save(`credenciales-${nivel}.pdf`)
    toast('PDF generado correctamente', 'success')
  } catch (err) {
    toast('Error generando PDF: ' + err.message, 'error')
  } finally { ocultarLoader() }
}

// ─── EXPORTAR: TODO EL COLEGIO (ZIP) ─────────────────────

async function exportarTodoColegio() {
  mostrarLoader('Generando credenciales de todo el colegio...')
  try {
    const jsPDF = window.jspdf?.jsPDF
    if (!jsPDF) { toast('jsPDF no está disponible', 'error'); return }
    if (typeof JSZip === 'undefined') { toast('JSZip no está disponible', 'error'); return }

    const { data: colData } = await supabase.from('colegios').select('id, nombre, color_primario, subdominio').single()
    const nombreColegio = colData?.nombre ?? ''
    const qrDataURL = await generarQRDataURL(urlDelColegio(colData), 360).catch(() => null)

    const pdfs = {}
    for (const nivel of ['Primaria', 'Secundaria']) {
      const { data: cursosNivel } = await supabase.from('cursos')
        .select('id').eq('nivel', nivel).eq('activo', true)
      const ids = (cursosNivel ?? []).map(c => c.id)
      if (!ids.length) continue

      const { data } = await supabase.from('estudiantes')
        .select('carnet, curso_id, usuarios(nombre_completo, email, activo), cursos(nombre_completo)')
        .in('curso_id', ids)

      const activos = (data ?? []).filter(e => e.usuarios?.activo !== false)
      if (!activos.length) continue

      mostrarLoader(`Generando PDF de ${nivel}...`)
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
      await renderizarCredenciales(doc, activos, qrDataURL, nombreColegio, colData?.color_primario)
      pdfs[nivel] = doc.output('arraybuffer')
    }

    if (!Object.keys(pdfs).length) { toast('No hay estudiantes activos', 'warning'); return }

    mostrarLoader('Comprimiendo archivos...')
    const zip = new JSZip()
    const carpeta = zip.folder(`Credenciales-${Config.año}`)
    for (const [nivel, buffer] of Object.entries(pdfs)) {
      carpeta.file(`credenciales-${nivel}.pdf`, buffer)
    }

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })
    const blob = new Blob([zipBuffer], { type: 'application/zip' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `Credenciales-Colegio-${Config.año}.zip`
    a.click()
    URL.revokeObjectURL(url)
    toast('ZIP generado correctamente', 'success')
  } catch (err) {
    toast('Error generando ZIP: ' + err.message, 'error')
  } finally { ocultarLoader() }
}

// ─── EXPORTS ─────────────────────────────────────────────

export function exportarCredencialesPDF() {
  abrirModalCredenciales()
}