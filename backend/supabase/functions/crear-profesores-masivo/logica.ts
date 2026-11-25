// Lógica de crear-profesores-masivo, separada de index.ts para poder probarla
// sin Supabase. No usa APIs de Deno: recibe el cliente (service_role) por parámetro.
//
// Por cada profesor:
//   1. valida nombre y teléfono (mismas reglas que la tabla `usuarios`)
//   2. pide el correo libre a la base (_siguiente_email_libre, marca '.prof')
//   3. crea la cuenta en Auth
//   4. asigna rol 'profesor' + colegio + activo, y LEE de vuelta para confirmarlo
//   5. si el paso 4 falla (tras reintentos): BORRA la cuenta (la fila de usuarios cae en cascada)
//      y, si ni el borrado funciona, lo informa como cuenta huérfana para revisión manual.

export const MAX_POR_CARGA = 50

const RE_NOMBRE = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ'\-\s]+$/         // igual a usuarios_nombre_formato_check (098: letras latinas con cualquier acento)
const RE_TELEFONO = /^\+?[0-9]{7,15}$/                    // igual a usuarios_telefono_formato_check
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'       // 32 símbolos, sin 0/O/1/I para evitar confusiones

export interface Llamante { rol: string; activo: boolean; colegio_id: string | null }

/** ¿Puede este usuario crear profesores en este colegio? */
export function validarLlamante(
  llamante: Llamante | null,
  colegioPedido?: string | null,
): { ok: true; colegioId: string } | { ok: false; status: number; error: string } {
  if (!llamante || !llamante.activo || !['director', 'superadmin'].includes(llamante.rol)) {
    return { ok: false, status: 403, error: 'Sin permisos' }
  }
  // El director trabaja siempre en SU colegio; si no manda colegio_id se usa el suyo.
  const colegioId = colegioPedido || (llamante.rol === 'director' ? llamante.colegio_id : null)
  if (!colegioId) return { ok: false, status: 400, error: 'colegio_id requerido' }
  if (llamante.rol === 'director' && colegioId !== llamante.colegio_id) {
    return { ok: false, status: 403, error: 'Sin permisos sobre ese colegio' }
  }
  return { ok: true, colegioId }
}

/** Contraseña aleatoria con generador criptográfico (10 caracteres ≈ 50 bits). */
export function generarPassword(longitud = 10): string {
  const bytes = new Uint8Array(longitud)
  crypto.getRandomValues(bytes)
  let p = ''
  for (const b of bytes) p += ALFABETO[b & 31]          // 32 símbolos → sin sesgo
  return p
}

export function normalizarNombre(n: unknown): string {
  return String(n ?? '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim()
}

/** Clave para comparar nombres: sin mayúsculas, tildes ni espacios de más, y sin importar el orden
 *  de las palabras ("JUAN DAVID USCAMAYTA RAMOS" = "USCAMAYTA RAMOS JUAN DAVID"). */
export function claveNombre(n: string): string {
  return String(n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/\s+/).filter(Boolean).sort().join(' ')
}

export function validarNombreProfesor(nombre: string): string | null {
  if (!nombre) return 'El nombre es obligatorio'
  if (!RE_NOMBRE.test(nombre)) return 'El nombre no puede contener números ni símbolos'
  if (nombre.split(' ').length < 2) return 'Ingresa nombre y apellido'
  return null
}

/** Devuelve { telefono } limpio (o null si no hay) o { error }. */
export function validarTelefonoProfesor(t: unknown): { telefono: string | null } | { error: string } {
  const limpio = String(t ?? '').replace(/[\s\-().]/g, '')
  if (!limpio) return { telefono: null }
  if (!RE_TELEFONO.test(limpio)) return { error: 'Teléfono inválido (7 a 15 dígitos, puede empezar con +)' }
  return { telefono: limpio }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function crearProfesores(
  supabase: any,
  { profesores, colegioId }: { profesores: any[]; colegioId: string },
  opciones: { sleep?: (ms: number) => Promise<unknown> } = {},
) {
  const sleep = opciones.sleep ?? dormir
  const datosCreados: any[] = []
  const errores: any[] = []
  const advertencias: string[] = []
  const repetidos: any[] = []                       // no creados: el nombre ya existe (colegio o archivo)
  const vistos = new Map<string, number>()

  // Profesores que ya existen en ESTE colegio (multicolegio: solo se compara dentro del colegio)
  const existentes = new Map<string, string>()      // clave del nombre → correo
  {
    const { data: ya } = await supabase.from('usuarios')
      .select('nombre_completo, email').eq('colegio_id', colegioId).eq('rol', 'profesor')
    ;(ya ?? []).forEach((u: any) => existentes.set(claveNombre(u.nombre_completo), u.email ?? ''))
  }

  for (let i = 0; i < profesores.length; i++) {
    const fila = i + 1
    const nombre = normalizarNombre(profesores[i]?.nombre)

    const errNombre = validarNombreProfesor(nombre)
    if (errNombre) { errores.push({ row: fila, nombre, reason: errNombre }); continue }

    const tel = validarTelefonoProfesor(profesores[i]?.telefono)
    if ('error' in tel) { errores.push({ row: fila, nombre, reason: tel.error }); continue }

    // Nombre repetido: solo se crea si el director confirmó que es otra persona (es_otra_persona)
    const clave = claveNombre(nombre)
    const otraPersona = profesores[i]?.es_otra_persona === true
    if (!otraPersona && vistos.has(clave)) {
      repetidos.push({ row: fila, nombre, reason: `Aparece también en la fila ${vistos.get(clave)} del archivo. No se creó.` })
      continue
    }
    if (!otraPersona && existentes.has(clave)) {
      repetidos.push({ row: fila, nombre, email_existente: existentes.get(clave),
        reason: `Ya existe en el colegio (${existentes.get(clave)}). No se creó.` })
      continue
    }
    if (otraPersona && (existentes.has(clave) || vistos.has(clave))) {
      advertencias.push(`Fila ${fila}: "${nombre}" se creó como otra persona con el mismo nombre (correo con número).`)
    }
    if (!vistos.has(clave)) vistos.set(clave, fila)

    let userId: string | null = null
    try {
      // 1) Correo libre calculado por la base (mira usuarios y auth.users)
      const { data: email, error: emailErr } = await supabase.rpc('_siguiente_email_libre', {
        p_colegio_id: colegioId, p_nombre: nombre, p_marca: '.prof',
      })
      if (emailErr || !email) {
        errores.push({ row: fila, nombre, reason: `No se pudo generar el correo: ${emailErr?.message ?? 'el nombre no tiene iniciales válidas'}` })
        continue
      }

      // 2) Cuenta en Auth
      const password = generarPassword()
      const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { nombre_completo: nombre },
      })
      if (authErr || !auth?.user?.id) {
        errores.push({ row: fila, nombre, reason: `Auth error: ${authErr?.message ?? 'sin usuario devuelto'}` })
        continue
      }
      userId = auth.user.id as string

      // 3) Rol + colegio (+ teléfono). Se reintenta ante fallos pasajeros y se verifica leyendo de vuelta.
      const cambios: Record<string, unknown> = { rol: 'profesor', colegio_id: colegioId, activo: true }
      if (tel.telefono) cambios.telefono = tel.telefono

      let falloRol: string | null = null
      for (let intento = 1; intento <= 3; intento++) {
        const { data: fila2, error: upErr } = await supabase
          .from('usuarios').update(cambios).eq('id', userId).select('id, rol, colegio_id').single()
        if (!upErr && fila2?.rol === 'profesor' && fila2?.colegio_id === colegioId) { falloRol = null; break }
        falloRol = upErr?.message ?? 'el rol no quedó asignado'
        if (intento < 3) await sleep(intento * 500)
      }

      if (falloRol) {
        // Deshacer: borrar la cuenta (usuarios cae en cascada)
        let borrada = false
        try {
          const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
          borrada = !delErr
        } catch (_e) { borrada = false }
        errores.push(borrada
          ? { row: fila, nombre, reason: `No se pudo asignar el rol de profesor (${falloRol}). La cuenta se deshizo; vuelve a intentarlo.` }
          : { row: fila, nombre, email, usuario_id: userId, cuenta_huerfana: true,
              reason: `No se pudo asignar el rol (${falloRol}) NI borrar la cuenta. Quedó como tutor: avisa al superadmin.` })
        continue
      }

      datosCreados.push({ nombre, email, password, telefono: tel.telefono, usuario_id: userId, status: 'created' })
      existentes.set(clave, email)
    } catch (e) {
      // Cualquier excepción inesperada tras crear la cuenta: intentar deshacer
      let borrada = userId === null
      if (userId) { try { const { error } = await supabase.auth.admin.deleteUser(userId); borrada = !error } catch (_e) { /* ignorar */ } }
      errores.push({ row: fila, nombre, ...(userId && !borrada ? { usuario_id: userId, cuenta_huerfana: true } : {}), reason: `Exception: ${String(e)}` })
    }
  }

  return {
    datos_creados: datosCreados,
    errores,
    advertencias,
    repetidos,
    resumen: {
      total_procesados: profesores.length,
      creados_exitosamente: datosCreados.length,
      errores_count: errores.length,
      repetidos_count: repetidos.length,
    },
  }
}