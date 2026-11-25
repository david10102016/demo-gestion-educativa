// js/utils/cargar-librerias.js
// Carga bajo demanda de librerías pesadas del CDN (pdfmake y SheetJS).
// Paneles que ya las cargan en el <head> (director, profesor) no descargan nada de nuevo:
// si la librería ya existe en window, se usa directamente.

const URL_PDFMAKE = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js'
const URL_VFS     = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js'
const URL_XLSX    = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'

const _pendientes = {}

function cargarScript(url) {
  if (_pendientes[url]) return _pendientes[url]
  _pendientes[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.onload  = () => resolve()
    s.onerror = () => {
      delete _pendientes[url]          // permite reintentar si falló la red
      s.remove()
      reject(new Error('No se pudo descargar la librería. Revisa tu conexión.'))
    }
    document.head.appendChild(s)
  })
  return _pendientes[url]
}

export async function asegurarPdfMake() {
  if (typeof window.pdfMake !== 'undefined' && window.pdfMake.vfs) return
  if (typeof window.pdfMake === 'undefined') await cargarScript(URL_PDFMAKE)
  await cargarScript(URL_VFS)          // las fuentes necesitan pdfmake ya cargado
}

export async function asegurarXLSX() {
  if (typeof window.XLSX !== 'undefined') return
  await cargarScript(URL_XLSX)
}
