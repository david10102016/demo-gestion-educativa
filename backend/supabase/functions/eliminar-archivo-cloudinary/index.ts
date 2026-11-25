// supabase/functions/eliminar-archivo-cloudinary/index.ts
// ─────────────────────────────────────────────────────────────
// Borra en Cloudinary el archivo de una entrega de tarea.
//
// Por qué existe:
//   El borrado en Cloudinary exige una firma con el API secret, que
//   no puede estar en el navegador. Antes, entrega-tareas.js intentaba
//   borrar con la ruta del bucket de Supabase y el archivo real
//   (en Cloudinary) quedaba huérfano.
//
// Seguridad:
//   · Solo borra si quien llama es el ESTUDIANTE dueño de una entrega
//     cuyo archivo_url coincide exactamente con la URL recibida.
//   · Solo borra archivos de la cuenta configurada (CLOUDINARY_CLOUD_NAME).
//
// Secretos requeridos (Supabase > Edge Functions > Secrets):
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//
// Entrada:  POST { archivo_url: string }
// Salida:   { ok: true, result: "ok" | "not found" }
// ─────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.201.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

async function sha1Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * https://res.cloudinary.com/<cloud>/<resource_type>/upload/[v123/]<public_id>
 * En "raw" el public_id incluye la extensión; en "image"/"video" no.
 */
function parsearUrlCloudinary(url: string) {
  const u = new URL(url)
  if (u.hostname !== 'res.cloudinary.com') return null
  const partes = u.pathname.split('/').filter(Boolean)   // [cloud, tipo, 'upload', ...]
  if (partes.length < 4 || partes[2] !== 'upload') return null
  const [cloud, resourceType] = partes
  let resto = partes.slice(3)
  if (/^v\d+$/.test(resto[0])) resto = resto.slice(1)      // quitar versión
  let publicId = decodeURIComponent(resto.join('/'))
  if (resourceType !== 'raw') publicId = publicId.replace(/\.[^/.]+$/, '')
  return { cloud, resourceType, publicId }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) return json({ error: 'No autorizado' }, 401)

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token)
    if (userError || !userData?.user) return json({ error: 'Token inválido' }, 401)

    const { archivo_url } = await req.json()
    if (!archivo_url || typeof archivo_url !== 'string') {
      return json({ error: 'archivo_url es requerido' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // El archivo debe pertenecer a una entrega del propio estudiante
    const { data: entrega, error: errEntrega } = await supabase
      .from('entregas_tareas')
      .select('id')
      .eq('estudiante_id', userData.user.id)
      .eq('archivo_url', archivo_url)
      .limit(1)
      .maybeSingle()

    if (errEntrega) return json({ error: 'Error verificando la entrega' }, 500)
    if (!entrega)   return json({ error: 'Sin permisos sobre ese archivo' }, 403)

    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? ''
    const apiKey    = Deno.env.get('CLOUDINARY_API_KEY') ?? ''
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET') ?? ''
    if (!cloudName || !apiKey || !apiSecret) return json({ error: 'Cloudinary no configurado' }, 500)

    const datos = parsearUrlCloudinary(archivo_url)
    if (!datos || datos.cloud !== cloudName) return json({ error: 'URL no válida para esta cuenta' }, 400)

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = await sha1Hex(`public_id=${datos.publicId}&timestamp=${timestamp}${apiSecret}`)

    const form = new FormData()
    form.append('public_id', datos.publicId)
    form.append('timestamp', timestamp)
    form.append('api_key', apiKey)
    form.append('signature', signature)

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${datos.resourceType}/destroy`,
      { method: 'POST', body: form }
    )
    const resultado = await res.json()
    if (!res.ok) return json({ error: 'Cloudinary rechazó el borrado', detalle: resultado }, 502)

    // "ok" = borrado; "not found" = ya no existía (no es error)
    return json({ ok: true, result: resultado.result })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})