// js/utils/validaciones.js
//
// Validaciones de formato compartidas para campos de identidad/contacto
// (nombre, teléfono, email). Un solo lugar para esta lógica, en vez de
// un chequeo suelto y distinto en cada formulario.
//
// Cada función devuelve { valido: boolean, mensaje?: string } — no
// lanza excepción, para que el que llama decida qué hacer (toast,
// resaltar el campo, etc.) sin necesidad de try/catch.

// Letras de cualquier idioma (tildes, ñ, ç, ã, õ, ê...), espacios,
// apóstrofes y guiones (nombres compuestos como "María José",
// "D'Angelo" o "Conceição"). Rechaza dígitos y símbolos. Exige al menos
// dos palabras para evitar un solo nombre suelto tipeado por error.
export function validarNombre(valor) {
  const v = (valor ?? '').trim()
  if (!v) return { valido: false, mensaje: 'El nombre es obligatorio' }
  if (!/^[\p{L}\p{M}'’\-\s]+$/u.test(v)) {
    return { valido: false, mensaje: 'El nombre no puede contener números ni símbolos' }
  }
  if (v.trim().split(/\s+/).length < 2) {
    return { valido: false, mensaje: 'Ingresa nombre y apellido' }
  }
  return { valido: true }
}

// Solo dígitos, longitud razonable para números bolivianos (7-8 dígitos
// sin código de país, o hasta 15 si viene con +591 u otro prefijo).
// Se limpian espacios/guiones antes de validar, ya que es común
// pegarlos así desde un contacto ("7654-3210" o "765 432 10").
export function validarTelefono(valor, { requerido = false } = {}) {
  const v = (valor ?? '').trim()
  if (!v) return requerido
    ? { valido: false, mensaje: 'El teléfono es obligatorio' }
    : { valido: true }
  const limpio = v.replace(/[\s\-]/g, '')
  if (!/^\+?\d{7,15}$/.test(limpio)) {
    return { valido: false, mensaje: 'El teléfono debe contener solo números (7 a 15 dígitos)' }
  }
  return { valido: true, limpio }
}

// Regex real de email (más estricta que el chequeo actual de "incluye
// @ y ."), sin ser tan agresiva como para rechazar direcciones válidas
// poco comunes.
export function validarEmail(valor) {
  const v = (valor ?? '').trim()
  if (!v) return { valido: false, mensaje: 'El email es obligatorio' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    return { valido: false, mensaje: 'Ingresa un correo electrónico válido' }
  }
  return { valido: true }
}