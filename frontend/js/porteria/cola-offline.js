// js/porteria/cola-offline.js
// Respaldo SIN INTERNET del escáner de portería:
//   · guarda en el celular la lista de estudiantes (código QR, nombre, curso, foto)
//   · guarda los registros hechos sin conexión y los envía al volver internet
//
// Usa su PROPIA base IndexedDB ('porteria-escaner') a propósito: la caché de
// offline-db.js se limpia al cerrar sesión, y aquí NO se pueden perder registros
// pendientes de enviar. La cola solo se vacía cuando el servidor confirma cada envío.

const DB_NOMBRE = 'porteria-escaner'
const DB_VERSION = 1

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('lista')) db.createObjectStore('lista')
      if (!db.objectStoreNames.contains('cola'))  db.createObjectStore('cola', { keyPath: 'clientUuid' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function tx(store, modo, fn) {
  const db = await abrir()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modo)
    const s = t.objectStore(store)
    let resultado
    Promise.resolve(fn(s)).then(r => { resultado = r })
    t.oncomplete = () => { db.close(); resolve(resultado) }
    t.onerror    = () => { db.close(); reject(t.error) }
  })
}

const req2promise = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

// ─── Lista de estudiantes del colegio ───────────────────────
export async function guardarLista(colegioId, items) {
  await tx('lista', 'readwrite', s => s.put({ colegioId, guardada: Date.now(), items }, 'actual'))
}

export async function leerLista(colegioId) {
  const v = await tx('lista', 'readonly', s => req2promise(s.get('actual')))
  if (!v || v.colegioId !== colegioId) return null
  return v
}

// ─── Cola de registros pendientes ───────────────────────────
/** item = { clientUuid, tipo, codigo, estudianteId, hora (ISO), dispositivo, motivo, nombre } */
export async function encolar(item) {
  await tx('cola', 'readwrite', s => s.put(item))
}

export async function pendientes() {
  return (await tx('cola', 'readonly', s => req2promise(s.getAll()))) ?? []
}

export async function contarPendientes() {
  return (await tx('cola', 'readonly', s => req2promise(s.count()))) ?? 0
}

export async function quitar(clientUuid) {
  await tx('cola', 'readwrite', s => s.delete(clientUuid))
}

export async function actualizarMotivo(clientUuid, motivo) {
  const item = await tx('cola', 'readonly', s => req2promise(s.get(clientUuid)))
  if (item) await encolar({ ...item, motivo })
}

/**
 * Envía la cola en orden de hora. Cada envío lleva su clientUuid: si el servidor
 * ya lo tenía (reenvío), responde "repetido" y no duplica.
 * enviarFn(item) debe devolver una promesa. Errores de red detienen el envío
 * (se reintenta luego); errores de datos (QR anulado, etc.) se reportan y se descartan.
 */
let _enviando = false
export async function enviarPendientes(enviarFn, onProgreso = () => {}) {
  if (_enviando || !navigator.onLine) return { enviados: 0, rechazados: [] }
  _enviando = true
  const rechazados = []
  let enviados = 0
  try {
    const items = (await pendientes()).sort((a, b) => String(a.hora).localeCompare(String(b.hora)))
    for (const item of items) {
      try {
        await enviarFn(item)
        await quitar(item.clientUuid)
        enviados++
        onProgreso(enviados, items.length)
      } catch (e) {
        const msg = String(e?.message ?? e)
        const esRed = /fetch|network|Failed|timeout|conex/i.test(msg) || !navigator.onLine
        if (esRed) break
        rechazados.push({ item, motivo: msg })
        await quitar(item.clientUuid)
      }
    }
  } finally {
    _enviando = false
  }
  return { enviados, rechazados }
}
