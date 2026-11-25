// js/utils/offline-db.js
// ─────────────────────────────────────────────────────────
// Motor de almacenamiento local (IndexedDB) para modo offline.
// Guarda la última respuesta exitosa de cada consulta de lectura,
// para poder mostrarla cuando no hay conexión a internet.
//
// IMPORTANTE (multitenant): las claves siempre deben incluir
// colegio_id + usuario_id (ver data-layer.js), para que nunca se
// mezclen datos entre colegios ni entre sesiones distintas en el
// mismo dispositivo.
// ─────────────────────────────────────────────────────────

const DB_NAME    = 'buenafe_offline_v1'
const DB_VERSION = 1
const STORE      = 'cache'

let _dbPromise = null

function _openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible en este navegador'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  return _dbPromise
}

// ─── GUARDAR ──────────────────────────────────────────────
export async function setCache(key, value) {
  try {
    const db = await _openDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ key, value, syncedAt: Date.now() })
      tx.oncomplete = () => resolve(true)
      tx.onerror    = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[offline-db] no se pudo guardar en cache:', key, err)
    return false
  }
}

// ─── LEER ─────────────────────────────────────────────────
export async function getCache(key) {
  try {
    const db = await _openDB()
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror   = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[offline-db] no se pudo leer de cache:', key, err)
    return null
  }
}

// ─── LIMPIAR CACHE DE UN USUARIO (usar en logout) ────────
export async function clearUserCache(usuarioId) {
  if (!usuarioId) return false
  try {
    const db = await _openDB()
    return await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req   = store.openCursor()
      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor) {
          if (String(cursor.value.key).includes(`::u_${usuarioId}`)) {
            cursor.delete()
          }
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve(true)
      tx.onerror    = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[offline-db] no se pudo limpiar cache del usuario:', err)
    return false
  }
}

// ─── LIMPIAR TODO (uso administrativo / debug) ───────────
export async function clearAllCache() {
  try {
    const db = await _openDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve(true)
      tx.onerror    = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[offline-db] no se pudo limpiar todo el cache:', err)
    return false
  }
}
