import { serve } from "https://deno.land/std@0.201.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

    if (!serviceRoleKey) {
      return jsonResponse(401, { error: 'missing_service_role_key' })
    }

    // ── Validar quién llama ──
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '')

    if (!token) {
      return jsonResponse(401, { error: 'No autorizado' })
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey)
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token)
    if (userError || !userData?.user) {
      return jsonResponse(401, { error: 'Token inválido' })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: llamante, error: errLlamante } = await supabase
      .from('usuarios')
      .select('rol, activo, colegio_id')
      .eq('id', userData.user.id)
      .single()

    if (errLlamante || !llamante || !llamante.activo ||
        !['director', 'superadmin'].includes(llamante.rol)) {
      return jsonResponse(403, { error: 'Sin permisos' })
    }

    let payload: any
    try {
      payload = await req.json()
    } catch (err) {
      return jsonResponse(400, { error: 'invalid_json', details: String(err) })
    }

    const { estudiantes, colegio_id } = payload

    if (!Array.isArray(estudiantes) || estudiantes.length === 0) {
      return jsonResponse(400, { error: 'invalid_payload', details: 'estudiantes array required' })
    }

    if (!colegio_id) {
      return jsonResponse(400, { error: 'invalid_payload', details: 'colegio_id required' })
    }

    // Si es director (no superadmin), solo puede crear estudiantes en su propio colegio
    if (llamante.rol === 'director' && colegio_id !== llamante.colegio_id) {
      return jsonResponse(403, { error: 'Sin permisos sobre ese colegio' })
    }

    // Cargar materias para resolver JSONB si aplica
    const { data: materiasData, error: materiasErr } = await supabase
      .from('materias')
      .select('id, nombre')
      .eq('colegio_id', colegio_id)

    if (materiasErr) {
      return jsonResponse(500, { error: 'error_loading_materias', details: materiasErr.message })
    }

    const materiasByName = new Map()
    ;(materiasData || []).forEach(m => {
      if (m.nombre) materiasByName.set(m.nombre.toLowerCase().trim(), m.id)
    })

    const results: any[] = []
    const errorsLog: any[] = []

    for (let i = 0; i < estudiantes.length; i++) {
      const est = estudiantes[i]
      const { nombre, carnet, curso_id, materia } = est
      // RUDE opcional: se guarda solo si viene con formato válido
      const rudeRaw = typeof est.rude === 'string' ? est.rude.trim() : ''
      const rude = rudeRaw && /^[A-Za-z0-9]{8,30}$/.test(rudeRaw) ? rudeRaw : null

      if (rudeRaw && !rude) {
        errorsLog.push({ row: i + 1, carnet, reason: `RUDE inválido: ${rudeRaw}` })
        continue
      }

      if (!nombre || !carnet || !curso_id) {
        errorsLog.push({ row: i + 1, carnet, reason: 'Falta nombre, carnet o curso_id' })
        continue
      }

      try {
        // El correo lo calcula la base: iniciales del nombre + dominio del colegio,
        // con el primer número libre (mira usuarios y auth.users).
        const { data: emailGenerado, error: emailErr } = await supabase.rpc(
          'generar_email_estudiante',
          { p_colegio_id: colegio_id, p_nombre: nombre }
        )

        if (emailErr || !emailGenerado) {
          errorsLog.push({
            row: i + 1, carnet, nombre,
            reason: `No se pudo generar el correo: ${emailErr?.message ?? 'el nombre no tiene iniciales válidas'}`
          })
          continue
        }

        const email    = emailGenerado as string
        const password = carnet

        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
          email,
          password,
          user_metadata: { rol: 'estudiante', nombre_completo: nombre },
          email_confirm: true
        })

        if (authErr) {
          errorsLog.push({ row: i + 1, carnet, nombre, reason: `Auth error: ${authErr.message}` })
          continue
        }

        const userId = authData.user.id

        const { error: estErr } = await supabase
          .from('estudiantes')
          .insert(rude ? { id: userId, carnet, curso_id, colegio_id, rude } : { id: userId, carnet, curso_id, colegio_id })

        if (estErr) {
          errorsLog.push({ row: i + 1, carnet, nombre, reason: `Estudiante insert error: ${estErr.message}` })
          try { await supabase.auth.admin.deleteUser(userId) } catch (e) {}
          continue
        }

        await supabase.from('usuarios').update({ colegio_id, rol: 'estudiante' }).eq('id', userId)

        if (materia) {
          const materiaId = materiasByName.get(materia.toLowerCase().trim())
          if (!materiaId) {
            errorsLog.push({ row: i + 1, carnet, nombre, reason: `Materia no encontrada: ${materia}` })
          } else {
            const { error: inscErr } = await supabase
              .from('inscripciones_tecnicas')
              .insert({ estudiante_id: userId, materia_id: materiaId, curso_id })
            if (inscErr) {
              errorsLog.push({ row: i + 1, carnet, nombre, reason: `Inscripción tecnica error: ${inscErr.message}` })
            }
          }
        }

        results.push({ carnet, rude, nombre, email, password, usuario_id: userId, status: 'created' })

      } catch (e) {
        errorsLog.push({ row: i + 1, carnet, nombre, reason: `Exception: ${String(e)}` })
      }
    }

    return jsonResponse(200, {
      ok: true,
      datos_creados: results,
      errores: errorsLog,
      resumen: {
        total_procesados: estudiantes.length,
        creados_exitosamente: results.length,
        errores_count: errorsLog.length
      }
    })

  } catch (error) {
    return jsonResponse(500, { error: 'server_error', details: String(error) })
  }
})