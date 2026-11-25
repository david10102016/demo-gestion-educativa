// js/admin/superadmin.js
import { supabase, crearClienteTemporal } from '../config/supabase-config.js'
import { verificarSesion, logout } from '../auth/auth.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import './direccion-colegio-admin.js'

let perfil = null

document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await verificarSesion('superadmin')
  if (!sesion) return
  perfil = sesion.perfil

  document.getElementById('nombre-superadmin').textContent = perfil.nombre_completo
  document.getElementById('email-superadmin').textContent = perfil.email ?? ''
  document.getElementById('avatar-superadmin').textContent =
    perfil.nombre_completo.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase()

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (await confirmar('Cerrar sesión', '¿Deseas cerrar tu sesión?', 'Salir', 'Cancelar')) {
      await logout()
    }
  })

  await cargarColegios()
  window.addEventListener('colegios-actualizar', () => cargarColegios())
})

// ── Cargar lista de colegios ──
async function cargarColegios() {
  const { data, error } = await supabase
    .from('colegios')
    .select('id, nombre, sigla, dominio_correo, subdominio, municipio, departamento, activo, plan, finanzas_habilitado, created_at')
    .eq('es_plantilla', false)
    .order('created_at', { ascending: false })

  const tbody = document.getElementById('tabla-colegios')
  if (error || !data?.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--color-text-secondary);">No hay colegios registrados</td></tr>`
    return
  }

  tbody.innerHTML = data.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.nombre)}</strong>${c.sigla ? ` <span style="color:var(--color-text-secondary);font-size:0.8rem;">(${escapeHtml(c.sigla)})</span>` : ''}<br><span style="color:var(--color-text-secondary);font-size:0.75rem;">${c.dominio_correo ? `@${escapeHtml(c.dominio_correo)}.educativa.com` : 'Sin dominio de correo'}</span> <a href="#" onclick="editarDominio('${c.id}', '${c.dominio_correo ?? ''}'); return false;" style="font-size:0.75rem;margin-left:6px;">${c.dominio_correo ? 'Editar dominio' : 'Asignar dominio'}</a><br><span style="color:var(--color-text-secondary);font-size:0.75rem;">${c.subdominio ? `${escapeHtml(c.subdominio)}.vercel.app` : 'Sin dirección propia'}</span> <a href="#" onclick="editarDireccion('${c.id}', '${c.subdominio ?? ''}'); return false;" style="font-size:0.75rem;margin-left:6px;">${c.subdominio ? 'Editar dirección' : 'Asignar dirección'}</a></td>
      <td>${c.municipio ?? '—'}</td>
      <td>${c.departamento ?? '—'}</td>
      <td><span class="badge ${c.activo ? 'badge-success' : 'badge-error'}">${c.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <select onchange="cambiarPlan('${c.id}', this.value)" style="padding:4px 8px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text-primary);font-size:0.8rem;">
          <option value="basico" ${c.plan === 'basico' ? 'selected' : ''}>Básico</option>
          <option value="avanzado" ${c.plan === 'avanzado' ? 'selected' : ''}>Avanzado</option>
        </select>
      </td>
      <td>
        <select onchange="cambiarFinanzas('${c.id}', this.value === 'true')" style="padding:4px 8px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text-primary);font-size:0.8rem;">
          <option value="true" ${c.finanzas_habilitado ? 'selected' : ''}>Activo</option>
          <option value="false" ${!c.finanzas_habilitado ? 'selected' : ''}>Apagado</option>
        </select>
      </td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="toggleColegio('${c.id}', ${c.activo})">
          ${c.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join('')

  document.getElementById('stat-colegios').textContent = data.length
  document.getElementById('stat-activos').textContent = data.filter(c => c.activo).length
}

// ── Cambiar plan de un colegio ──
window.cambiarPlan = async function(id, plan) {
  const { error } = await supabase.from('colegios').update({ plan }).eq('id', id)
  if (error) {
    toast('No se pudo cambiar el plan: ' + error.message, 'error')
    await cargarColegios()
    return
  }
  toast(`Plan actualizado a "${plan === 'avanzado' ? 'Avanzado' : 'Básico'}"`, 'success')
}

// ── Activar/apagar Finanzas de un colegio ──
window.cambiarFinanzas = async function(id, activo) {
  const { error } = await supabase.from('colegios').update({ finanzas_habilitado: activo }).eq('id', id)
  if (error) {
    toast('No se pudo cambiar Finanzas: ' + error.message, 'error')
    await cargarColegios()
    return
  }
  toast(`Finanzas ${activo ? 'activado' : 'apagado'} para este colegio`, 'success')
}

// ── Crear nuevo colegio + director ──
window.crearColegio = async function() {
  const nombre    = document.getElementById('col-nombre').value.trim()
  const sigla     = document.getElementById('col-sigla').value.trim()
  const dominio   = document.getElementById('col-dominio').value.trim().toLowerCase()
  const municipio = document.getElementById('col-municipio').value.trim()
  const depto     = document.getElementById('col-departamento').value.trim()
  const dirNombre = document.getElementById('dir-nombre').value.trim()
  const dirEmail  = document.getElementById('dir-email').value.trim()
  const dirPass   = document.getElementById('dir-password').value
  const plan      = document.getElementById('col-plan').value

  if (!nombre)    { toast('El nombre del colegio es obligatorio', 'warning'); return }
  if (!dominio)   { toast('El dominio de correo es obligatorio (ej: jap)', 'warning'); return }
  // Mismo formato que exige la base: minúsculas, números y guion; sin puntos ni espacios
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(dominio)) {
    toast('Dominio inválido: use solo letras minúsculas, números y guion (sin puntos ni espacios)', 'warning'); return
  }
  if (!dirNombre) { toast('El nombre del director es obligatorio', 'warning'); return }
  if (!dirEmail)  { toast('El email del director es obligatorio', 'warning'); return }
  if (!dirPass || dirPass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'warning'); return }

  mostrarLoader('Creando colegio...')
  try {
    // 1. Crear el colegio
    const { data: colegio, error: errColegio } = await supabase
      .from('colegios')
      .insert({ nombre, sigla: sigla || null, dominio_correo: dominio, municipio: municipio || null, departamento: depto || null, activo: true, plan })
      .select()
      .single()

    if (errColegio) {
      if (errColegio.code === '23505' && /dominio_correo/.test(errColegio.message ?? '')) {
        throw new Error(`El dominio "${dominio}" ya lo usa otro colegio. Elija uno distinto.`)
      }
      throw errColegio
    }

    // 2. Crear el usuario director en Supabase Auth
    const clienteTemp = crearClienteTemporal()
    const { data: authData, error: errAuth } = await clienteTemp.auth.signUp({
      email: dirEmail,
      password: dirPass,
      options: {
        data: { nombre_completo: dirNombre }
      }
    })

    if (errAuth) throw errAuth

    await new Promise(r => setTimeout(r, 1000))

    // 3. Insertar en usuarios con colegio_id — via RPC para bypassear RLS
    await supabase.rpc('rpc_crear_director', {
      p_id:         authData.user.id,
      p_nombre:     dirNombre,
      p_email:      dirEmail,
      p_colegio_id: colegio.id
    })

    // 4. Copiar toda la configuración base al nuevo colegio
    const { data: rpcResult } = await supabase.rpc('copiar_config_colegio_base', {
      nuevo_colegio_id: colegio.id
    })

    if (rpcResult?.ok === false) {
      console.error('Error copiando configuración:', rpcResult.error)
      toast(`Colegio creado pero hubo un error en la configuración: ${rpcResult.error}`, 'warning')
    } else {
      toast(`Colegio "${nombre}" creado correctamente`, 'success')
    }

    // Limpiar formulario
    document.getElementById('col-nombre').value = ''
    document.getElementById('col-sigla').value = ''
    document.getElementById('col-dominio').value = ''
    document.getElementById('col-municipio').value = ''
    document.getElementById('col-departamento').value = ''
    document.getElementById('col-plan').value = 'basico'
    document.getElementById('dir-nombre').value = ''
    document.getElementById('dir-email').value = ''
    document.getElementById('dir-password').value = ''

    await cargarColegios()

  } catch(e) {
    toast(e.message ?? 'Error al crear el colegio', 'error')
  } finally {
    ocultarLoader()
  }
}

// ── Asignar / cambiar el dominio de correo de un colegio existente ──
window.editarDominio = async function(id, actual) {
  const entrada = window.prompt(
    'Dominio de correo del colegio (solo minúsculas, números y guion; ej: jap).\n' +
    'Los correos nuevos serán iniciales@DOMINIO.educativa.com',
    actual || ''
  )
  if (entrada === null) return
  const dominio = entrada.trim().toLowerCase()

  if (!dominio) { toast('El dominio no puede quedar vacío', 'warning'); return }
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(dominio)) {
    toast('Dominio inválido: use solo letras minúsculas, números y guion (sin puntos ni espacios)', 'warning'); return
  }
  if (dominio === actual) return

  if (actual && !await confirmar(
    'Cambiar dominio de correo',
    `Los usuarios ya creados conservan su correo actual (@${actual}.educativa.com). Solo los nuevos usarán @${dominio}.educativa.com. ¿Continuar?`
  )) return

  const { error } = await supabase.from('colegios').update({ dominio_correo: dominio }).eq('id', id)
  if (error) {
    if (error.code === '23505') toast(`El dominio "${dominio}" ya lo usa otro colegio. Elija uno distinto.`, 'error')
    else toast(error.message, 'error')
    return
  }
  toast(`Dominio actualizado: @${dominio}.educativa.com`, 'success')
  await cargarColegios()
}

// ── Activar / Desactivar colegio ──
window.toggleColegio = async function(id, activo) {
  if (!await confirmar(
    activo ? 'Desactivar colegio' : 'Activar colegio',
    `¿Confirmas ${activo ? 'desactivar' : 'activar'} este colegio?`
  )) return

  await supabase.from('colegios').update({ activo: !activo }).eq('id', id)
  toast(`Colegio ${activo ? 'desactivado' : 'activado'}`, 'success')
  await cargarColegios()
}

// ── Tema ──
window.toggleTheme = function() {
  const isDark = document.documentElement.classList.toggle('dark')
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
  document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙'
}
;(function() {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark')
    const ic = document.getElementById('theme-icon')
    if (ic) ic.textContent = '☀️'
  }
})()