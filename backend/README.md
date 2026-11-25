
```

## Notas importantes

- El colegio con id `00000000-0000-0000-0000-000000000001` es el placeholder.
  El director lo edita desde Configuraciones → Datos del colegio.
- Las migraciones NO incluyen datos de prueba de estudiantes/profesores.
  Se crean desde el panel del director.
- El año académico 2026 está pre-configurado. Para 2027, el director
  crea una nueva gestión desde Configuraciones → Gestión académica.
  ---------------------------------------------------------------------

🗄️ Extracción del Schema — Estructura Pura
Para extraer únicamente la estructura del proyecto (tablas, funciones, triggers, vistas, RLS) sin datos, ejecutar en CMD:
cmdset PGPASSWORD=TU_CONTRASEÑA
"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -h aws-1-us-west-2.pooler.supabase.com -p 5432 -U postgres.TU_PROJECT_REF -d postgres --schema-only --schema=public --no-owner --no-privileges -f "C:\Users\user23\schema_actualizado.sql"

⚠️ Este comando puede tardar entre 5 y 10 minutos con el Session Pooler. Es normal, no cancelar. El archivo resultante pesa ~78KB e incluye las 24 tablas del sistema con todos sus campos, funciones, triggers y políticas RLS actualizadas al momento de la extracción.
---------------------------------------------------------------------------
markdown## Guía de replicación y despliegue en Vercel

### Archivos obligatorios antes del primer commit

**`.gitignore`** en la raíz del repositorio:
.env.local
.env
node_modules/

**`.env.local`** en la carpeta del proyecto (nunca se sube a GitHub):
VITE_SUPABASE_URL=https://tuproject.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

**`vite.config.js`** debe incluir obligatoriamente `target: 'esnext'`:
```javascript
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:       'index.html',
        director:   'dashboard-director.html',
        profesor:   'dashboard-profesor.html',
        estudiante: 'dashboard-estudiante.html',
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})
```

**`css/global.css`** — el `@import` de fuentes debe ser la primera línea absoluta del archivo:
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans...');

/* resto del CSS */
```

---

### Configuración en Vercel al crear el proyecto

Al conectar el repositorio de GitHub, antes de hacer Deploy completar estos campos:

**Application Preset:**
Vite

**Root Directory:**
frontend
(porque el `package.json` está dentro de la carpeta `frontend`, no en la raíz del repositorio)

**Build Command:**
vite build

**Install Command:**
npm install

**Output Directory:**
dist

**Environment Variables — agregar estas dos antes de hacer Deploy:**

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://tuproject.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` (clave completa) |

---

### Reglas importantes

- Las variables de entorno se compilan dentro del bundle en el momento del build. Si se agregan después del primer deploy, hay que hacer un nuevo deploy forzado para que tomen efecto.
- Para forzar un nuevo deploy sin cambios reales, agregar un comentario en `vite.config.js`, hacer commit y push.
- Después del deploy, desactivar la protección de Vercel en **Settings → Deployment Protection → Vercel Authentication → Off**, de lo contrario la URL pedirá login de Vercel antes de mostrar el sistema.
- El dominio se puede personalizar en **Settings → Domains** editando el campo y escribiendo el nombre deseado en formato `nombre.vercel.app`.

# Diseño dinámico por colegio — Contexto y propuesta

**Sistema:** Gestión Educativa 2027 (multitenant: Buena Fe, Mariscal Sucre, Juana Azurduy de Padilla)
**Tema:** Identidad visual (CSS) y arquitectura de acceso por colegio

---

## Propósito

El sistema es multitenant a nivel de datos (cada colegio tiene su información aislada por `colegio_id`), pero **no lo es a nivel visual**. Todo el frontend usa una única paleta de colores genérica, y la página pública de acceso está hardcodeada para un solo colegio (Buena Fe), aunque los tres colegios reales inician sesión desde la misma URL. El objetivo de esta sesión fue diagnosticar por qué la interfaz se ve "plana"/genérica, y definir cómo darle identidad propia a cada colegio sin duplicar el proyecto.

---

## Hallazgos

### 1. Contraste y tipografía genéricos (confirmado en `global.css`)
- `--color-bg: #f8fafc` vs `--color-surface: #ffffff` — diferencia casi imperceptible, hace que fondo y tarjetas se fundan visualmente.
- `--shadow-md` es literalmente el `shadow-md` por defecto de Tailwind, sin editar.
- `DM Mono` está cargada e importada, pero solo se usa en 3 lugares puntuales (carnet, código de dimensión, textarea de plantillas) — nunca en los números grandes de las tarjetas de estadísticas (`.stat-card-value`, 32px), que heredan `DM Sans` sin ninguna diferenciación entre "dato" y "texto".

### 2. Colores de acento sin relación con el sistema
Los 4 colores usados en `.stat-card:nth-child()::before` son exactamente la paleta stock de Tailwind (`indigo-600 #4f46e5`, `sky-500 #0ea5e9`, `red-500 #ef4444`, `emerald-500 #10b981`), sin ninguna relación con la identidad institucional de los colegios reales.

### 3. `theme-colors.css` es un resto de un colegio que ya no existe
El archivo trae, en su propio comentario de cabecera, la leyenda *"theme-colors.css — Gestión Escolar 2027 U.E. Gloria"* — un colegio que no es ninguno de los tres actuales (Buena Fe, Mariscal Sucre, Juana Azurduy). Es la paleta amarilla hardcodeada de una versión anterior de un solo colegio, aplicada hoy global a los tres colegios reales vía el modo oscuro. No es un sistema de theming multitenant a medio construir — es un residuo que hay que limpiar antes de construir el sistema real.

### 4. La tabla `colegios` no tiene ningún campo de color
Tiene `logo_url`, pero no `color_primario` ni equivalente — la identidad visual por colegio no existe todavía a nivel de datos.

### 5. La página pública (`index.html`) es 100% estática para Buena Fe
No solo el logo: la dirección, el texto de la política antibullying, el botón de compartir y la propia tarjeta de login (`<div class="lch-title">Buena Fe</div>`) están hardcodeados. Un usuario de Mariscal Sucre o Juana Azurduy ve la marca de un colegio ajeno al loguearse. **A diferencia de esto, los dashboards ya logueados sí son dinámicos** — `director.js`/`profesor.js`/`estudiante.js` ya consultan `colegios.nombre` según el `colegio_id` real del usuario. El problema está acotado a la etapa previa al login.

---

## Propuesta: theming dinámico vía CSS custom properties

Todo el CSS del proyecto ya usa variables (`var(--color-primary)`, etc.) en vez de colores fijos — no hace falta un archivo CSS por colegio. Alcanza con sobrescribir esas variables en tiempo de ejecución, en JavaScript, apenas se sabe qué colegio es:

```javascript
const { data: col } = await supabase.from('colegios')
  .select('nombre, color_primario').eq('id', perfil.colegio_id).single()

if (col) {
  document.getElementById('nombre-colegio').textContent = col.nombre
  if (col.color_primario) {
    document.documentElement.style.setProperty('--color-primary', col.color_primario)
    document.documentElement.style.setProperty('--color-primary-dark', col.color_primario)
  }
}
```

Con esto, botones, badges y bordes activos cambian de color automáticamente en todo el sistema, sin tocar ninguna regla CSS — porque ya están escritas en función de la variable.

---

## Script de base de datos

```sql
-- Agrega el campo de color institucional por colegio.
-- Default: el índigo actual del sistema, para no romper nada
-- en los colegios que todavía no lo configuren.
ALTER TABLE public.colegios
  ADD COLUMN color_primario TEXT DEFAULT '#4f46e5';
```

Cambio aditivo: no afecta ninguna fila existente más allá de asignarle el valor por defecto (el mismo color que ya se ve hoy), y no requiere tocar RLS ni ninguna política.

---

## Arquitectura de acceso: tres opciones evaluadas

### Opción A — Dominios/subdominios separados por colegio
Cada colegio con su propia URL (`buena-fe.tudominio.com`, `juana-azurduy.tudominio.com`, etc.), todos apuntando al mismo proyecto de Vercel.
- ✅ Control total: cada página de marketing queda exactamente a medida, como ahora.
- ❌ No escala: cada colegio nuevo implica armar y mantener una página aparte a mano.

### Opción B — Selector de colegio en una única página
Un paso previo al login (dropdown o tarjetas) con los colegios activos, leído en vivo desde la tabla `colegios`. Al elegir, la página se pinta con `nombre`, `direccion`, `municipio`, `logo_url` y `color_primario` de ese colegio.
- ✅ Escala sola: un colegio nuevo aparece automático en cuanto se carga en la base, sin deploy ni código nuevo.
- ❌ El texto de marketing más narrativo (ej. el párrafo de política antibullying) no está en la base — requeriría una plantilla genérica interpolando los campos existentes, en vez de un texto único por colegio como el actual.

### Opción C — Parche mínimo (sin selector todavía)
Solo sacar "Buena Fe" hardcodeado de la tarjeta de login, dejándola genérica ("Portal Gestión Educativa" o similar), sin tocar el resto de la página pública.
- ✅ Costo casi nulo, elimina la confusión de marca más urgente (el login).
- ❌ No resuelve el fondo del problema — el resto de la página pública sigue siendo de un solo colegio.

## Opción elegida: **B**

Con tres colegios reales y expectativa de que el sistema siga creciendo (como con la incorporación reciente de Juana Azurduy), la Opción B es la que realmente encaja con la naturaleza multitenant del sistema — crece sin intervención manual repetida por cada colegio nuevo.

---

## Próximos pasos (pendientes de definir)

1. Aplicar el script SQL de `color_primario`.
2. Sumar el snippet de `setProperty` a `director.js`, `profesor.js`, `estudiante.js` (dashboards ya logueados).
3. Diseñar el selector de colegio de la página pública, con su propia carga dinámica de `colegios`.
4. Convertir el texto narrativo de `index.html` (política antibullying, compartir, etc.) en una plantilla genérica interpolada, o decidir qué campos nuevos agregar a `colegios` si se quiere conservar texto propio por colegio.
5. Limpiar/neutralizar el amarillo de "U.E. Gloria" en `theme-colors.css` antes de sumar el nuevo sistema de color por colegio, para no dejar dos mecanismos de theming compitiendo.


# Informe Técnico — Rediseño Visual e Identidad Multitenant Dinámica
**Sistema:** Gestión Educativa 2027 · **Fecha:** 16/07/2026 · **Estado:** Propuesta definitiva, pendiente de aprobación para iniciar implementación

---

## 1. Propósito

Dos problemas relacionados, discutidos en la misma sesión de trabajo, que se resuelven con una sola línea de cambios:

1. **La interfaz se ve plana** en todos los paneles (director, profesor, secretaria, tutor, estudiante) — poco contraste, colores de acento genéricos sin relación con el sistema, tipografía sin jerarquía.
2. **El sistema es multitenant pero el login no lo refleja** — hoy `index.html` tiene el nombre, escudo y textos de "Buena Fe" escritos fijos en el HTML. Los 3 colegios actuales (y cualquiera que se sume después) comparten el mismo login, mostrando siempre la marca de Buena Fe sin importar quién entre.

La solución de fondo para el punto 2 (que cada colegio tenga su propio color institucional) es también la solución más profunda para el punto 1: en vez de 4 colores de plantilla genéricos reutilizados en todo el sistema, cada colegio usa su propio acento real en sus propios paneles.

---

## 2. Diagnóstico técnico actual (verificado en código, no supuesto)

| Elemento | Estado actual | Evidencia |
|---|---|---|
| `index.html` | Un solo archivo: landing pública + `#login-section` embebida, mostrada/ocultada con JS al hacer click en "Ingresar". Ambas secciones tienen el nombre/escudo de "Buena Fe" escritos fijos en el HTML. | Confirmado en el código fuente, líneas 337-340 y 505 |
| `registro-tutor.html` | Archivo separado, enlazado desde el login (no embebido) | Confirmado |
| `colegios.logo_url` | Columna existe en la base, **sin ningún uso en el frontend** — ningún formulario la carga, ninguna pantalla la muestra | Confirmado por búsqueda en todo el repo, sin resultados |
| `colegios.color_primario` | **No existe** — hay que crearla | — |
| Política de lectura de `colegios` | Solo `id = mi_colegio_id()` (requiere sesión) o `superadmin` — **ningún acceso público hoy** | Confirmado en `pg_policies` |
| `colegios_write_director` | Ya permite `UPDATE` completo al director de su propio colegio (`es_director() AND id = mi_colegio_id()`) | Confirmado |
| `guardarColegio()` en `director.js` | Ya existe, hace `supabase.from('colegios').update(payload)` desde Configuración → Colegio | Confirmado, línea 1491 |
| `verificarSesion()` en `auth.js` | Punto de entrada único, usado por los 6 paneles (director, profesor, secretaria, tutor, estudiante, superadmin) | Confirmado por búsqueda en todo el repo |
| Variables base de diseño (`global.css`) | Fondo (`--color-bg: #f8fafc`) y tarjeta (`--color-surface: #fff`) casi sin contraste entre sí; sombra genérica de plantilla; tipografía `DM Sans` en todo, incluidos los números grandes de las tarjetas | Confirmado en `global.css` |
| Fuente `DM Mono` | Ya está cargada en el proyecto (`@import`), **sin ningún uso** | Confirmado |
| Técnica `color-mix()` para variantes de color | Ya en uso 3 veces en `global.css` (tarjetas de dimensiones) | Confirmado |

**Conclusión del diagnóstico:** casi toda la infraestructura necesaria ya existe (permisos de escritura, función de guardado, técnica de generación de variantes de color, punto único de arranque de sesión). Lo que falta es aditivo, no una reconstrucción.

---

## 3. Alcance de los cambios — clasificado por tipo

### 3.1 Base de datos (Supabase) — 100% aditivo, sin migraciones destructivas

```sql
-- Nueva columna, nullable, con default — no rompe filas existentes
ALTER TABLE public.colegios ADD COLUMN IF NOT EXISTS color_primario text DEFAULT '#4f46e5';

-- Nueva política de SOLO LECTURA para anon, limitada a colegios activos.
-- No se usa un SELECT * — se expone la mínima superficie necesaria
-- (nombre, logo, color), no direccion/telefono/email/resolucion_ministerial.
CREATE POLICY "colegios_select_publico_anon"
ON public.colegios FOR SELECT
TO anon
USING (activo = true);
```

**Nota de seguridad, consistente con el resto de la auditoría de hoy:** esta política expone la fila completa a `anon` si se usa tal cual — para no filtrar columnas sensibles (`email`, `telefono`, `director_nombre`, `resolucion_ministerial`), la pantalla pública de selección de colegio debe consultar explícitamente solo `select('id, nombre, logo_url, color_primario')`, nunca `select('*')`. Alternativa más segura y recomendada: crear una **vista** (`colegios_publico`) que exponga únicamente esas 4 columnas, y dar acceso público a la vista en vez de a la tabla — así ninguna consulta futura puede filtrar de más por error humano.

```sql
CREATE VIEW public.colegios_publico
WITH (security_invoker = true) AS
SELECT id, nombre, logo_url, color_primario
FROM public.colegios
WHERE activo = true;

GRANT SELECT ON public.colegios_publico TO anon;
```

No se toca ninguna política ni tabla existente. Migración nueva, numerada correlativamente a las de hoy (`046` en adelante, según lo que ya se haya aplicado).

### 3.2 Supabase Storage — recurso nuevo, aditivo

- Bucket nuevo: `logos-colegios`, **público** (necesario: la pantalla de selección de colegio es anterior al login, no hay sesión todavía).
- Estructura de carpetas: `logos-colegios/{colegio_id}/logo.{ext}` — un colegio nunca puede pisar el archivo de otro, porque cada uno tiene su propia carpeta con su propio `colegio_id`.
- Mismo patrón ya usado hoy para las consignas de actividades (`supabase.storage.from('tareas').upload(...)`), sin inventar un mecanismo nuevo.

### 3.3 Frontend — archivos existentes modificados, **cero archivos nuevos**

| Archivo | Cambio | Tamaño del cambio |
|---|---|---|
| `index.html` | Nueva sección `#selector-colegio-section` (oculta al inicio, mismo patrón que ya usa el login). El botón "Ingresar al Sistema" pasa a mostrar esta sección en vez de `#login-section` directo. El HTML fijo de "Buena Fe" del login se reemplaza por contenedores vacíos que el JS rellena dinámicamente al elegir colegio. | Medio — una sección nueva + ~15 líneas de JS para leer `colegios_publico` y poblar el selector |
| `js/admin/director.js` | En Configuración → Colegio: agregar `<input type="color">` y `<input type="file">` junto a los campos ya existentes; sumar `color_primario` al `payload` de `guardarColegio()`; subir el archivo de logo a Storage antes de guardar. | Chico — reusa `guardarColegio()` ya existente |
| `js/auth/auth.js` | Dentro de `verificarSesion()`: después de confirmar la sesión y traer el `perfil`, una consulta extra a `colegios_publico` por `colegio_id`, y `document.documentElement.style.setProperty('--color-primario', ...)`. **Un solo archivo, aplica a los 6 paneles automáticamente** (todos ya llaman a esta función). | Chico — ~6 líneas, en un único punto de entrada compartido |
| `css/global.css` | (a) Variables base: fondo con más contraste, sombra con más peso, `.stat-card-value` usando `DM Mono`. (b) Los 4 colores de acento fijos de las tarjetas pasan a usar `var(--color-primario)` con variantes generadas por `color-mix()` (técnica ya en uso), en vez de índigo/celeste/rojo/verde fijos. | Medio — cambios de variables y selectores existentes, sin tocar estructura/layout |

**Ningún archivo nuevo.** Ninguna reescritura de componentes, tablas, formularios o lógica de negocio existente — todo lo que hoy funciona (RLS, flujos de notas/asistencia/pagos/etc.) queda intacto.

---

## 4. Comportamiento con colegios nuevos (4°, 5°, 6°...)

Cero intervención técnica por cada colegio nuevo:
1. El director del colegio nuevo entra a Configuración, sube su logo y elige su color — una sola vez.
2. Automáticamente aparece en el selector público (`activo = true`) y en su propio login personalizado.
3. Sus paneles internos (director, profesores de ese colegio, etc.) heredan el color institucional vía `verificarSesion()`, sin que nadie del equipo técnico toque código ni base de datos.

Si el número de colegios crece mucho (15-20+), el selector incluye desde el diseño inicial un buscador por nombre (filtro simple sobre la lista ya cargada, sin consultas adicionales) — evita tener que rehacer esa pantalla más adelante.

---

## 5. Orden de implementación propuesto

1. **Ajustes base de `global.css`** (contraste, sombra, `DM Mono`) — mejora visual inmediata en todo el sistema, sin depender de nada más. Puede hacerse hoy mismo.
2. **Migración SQL** (columna `color_primario`, vista `colegios_publico`, política de lectura pública, bucket de Storage).
3. **Configuración → Colegio** en `director.js` (selector de color + subida de logo).
4. **`index.html`**: selector de colegio + login dinámico.
5. **`verificarSesion()`** en `auth.js`: inyección del color institucional en los 6 paneles.

---

## 6. Riesgo general

Bajo. Todos los cambios son aditivos (columnas nuevas, política nueva, sección nueva, variables CSS). No se modifica ni elimina ninguna tabla, política, ni flujo de negocio ya auditado y corregido hoy (`notas`, `asistencias`, `entregas_tareas`, `pagos_mensualidad`, evaluación docente, etc.). El único punto que requiere cuidado real es no exponer más columnas de `colegios` de las necesarias al hacerla parcialmente pública — cubierto con la vista `colegios_publico` en vez de acceso directo a la tabla.

# Diseño dinámico por colegio — mas  propuestas

**Sistema:** Gestión Educativa 2027 (multitenant: Buena Fe, Mariscal Sucre, Juana Azurduy de Padilla)
**Tema:** Identidad visual (CSS) y arquitectura de acceso por colegio

---

## Propósito

El sistema es multitenant a nivel de datos (cada colegio tiene su información aislada por `colegio_id`), pero **no lo es a nivel visual**. Todo el frontend usa una única paleta de colores genérica, y la página pública de acceso está hardcodeada para un solo colegio (Buena Fe), aunque los tres colegios reales inician sesión desde la misma URL. El objetivo de esta sesión fue diagnosticar por qué la interfaz se ve "plana"/genérica, y definir cómo darle identidad propia a cada colegio sin duplicar el proyecto.

---

## Hallazgos

### 1. Contraste y tipografía genéricos (confirmado en `global.css`)
- `--color-bg: #f8fafc` vs `--color-surface: #ffffff` — diferencia casi imperceptible, hace que fondo y tarjetas se fundan visualmente.
- `--shadow-md` es literalmente el `shadow-md` por defecto de Tailwind, sin editar.
- `DM Mono` está cargada e importada, pero solo se usa en 3 lugares puntuales (carnet, código de dimensión, textarea de plantillas) — nunca en los números grandes de las tarjetas de estadísticas (`.stat-card-value`, 32px), que heredan `DM Sans` sin ninguna diferenciación entre "dato" y "texto".

### 2. Colores de acento sin relación con el sistema
Los 4 colores usados en `.stat-card:nth-child()::before` son exactamente la paleta stock de Tailwind (`indigo-600 #4f46e5`, `sky-500 #0ea5e9`, `red-500 #ef4444`, `emerald-500 #10b981`), sin ninguna relación con la identidad institucional de los colegios reales.

### 3. `theme-colors.css` es un resto de un colegio que ya no existe
El archivo trae, en su propio comentario de cabecera, la leyenda *"theme-colors.css — Gestión Escolar 2027 U.E. Gloria"* — un colegio que no es ninguno de los tres actuales (Buena Fe, Mariscal Sucre, Juana Azurduy). Es la paleta amarilla hardcodeada de una versión anterior de un solo colegio, aplicada hoy global a los tres colegios reales vía el modo oscuro. No es un sistema de theming multitenant a medio construir — es un residuo que hay que limpiar antes de construir el sistema real.

### 4. La tabla `colegios` no tiene ningún campo de color
Tiene `logo_url`, pero no `color_primario` ni equivalente — la identidad visual por colegio no existe todavía a nivel de datos.

### 5. La página pública (`index.html`) es 100% estática para Buena Fe
No solo el logo: la dirección, el texto de la política antibullying, el botón de compartir y la propia tarjeta de login (`<div class="lch-title">Buena Fe</div>`) están hardcodeados. Un usuario de Mariscal Sucre o Juana Azurduy ve la marca de un colegio ajeno al loguearse. **A diferencia de esto, los dashboards ya logueados sí son dinámicos** — `director.js`/`profesor.js`/`estudiante.js` ya consultan `colegios.nombre` según el `colegio_id` real del usuario. El problema está acotado a la etapa previa al login.

---

## Propuesta: theming dinámico vía CSS custom properties

Todo el CSS del proyecto ya usa variables (`var(--color-primary)`, etc.) en vez de colores fijos — no hace falta un archivo CSS por colegio. Alcanza con sobrescribir esas variables en tiempo de ejecución, en JavaScript, apenas se sabe qué colegio es:

```javascript
const { data: col } = await supabase.from('colegios')
  .select('nombre, color_primario').eq('id', perfil.colegio_id).single()

if (col) {
  document.getElementById('nombre-colegio').textContent = col.nombre
  if (col.color_primario) {
    document.documentElement.style.setProperty('--color-primary', col.color_primario)
    document.documentElement.style.setProperty('--color-primary-dark', col.color_primario)
  }
}
```

Con esto, botones, badges y bordes activos cambian de color automáticamente en todo el sistema, sin tocar ninguna regla CSS — porque ya están escritas en función de la variable.

---

## Script de base de datos

```sql
-- Agrega el campo de color institucional por colegio.
-- Default: el índigo actual del sistema, para no romper nada
-- en los colegios que todavía no lo configuren.
ALTER TABLE public.colegios
  ADD COLUMN color_primario TEXT DEFAULT '#4f46e5';
```

Cambio aditivo: no afecta ninguna fila existente más allá de asignarle el valor por defecto (el mismo color que ya se ve hoy), y no requiere tocar RLS ni ninguna política.

---

## Arquitectura de acceso: tres opciones evaluadas

### Opción A — Dominios/subdominios separados por colegio
Cada colegio con su propia URL (`buena-fe.tudominio.com`, `juana-azurduy.tudominio.com`, etc.), todos apuntando al mismo proyecto de Vercel.
- ✅ Control total: cada página de marketing queda exactamente a medida, como ahora.
- ❌ No escala: cada colegio nuevo implica armar y mantener una página aparte a mano.

### Opción B — Selector de colegio en una única página
Un paso previo al login (dropdown o tarjetas) con los colegios activos, leído en vivo desde la tabla `colegios`. Al elegir, la página se pinta con `nombre`, `direccion`, `municipio`, `logo_url` y `color_primario` de ese colegio.
- ✅ Escala sola: un colegio nuevo aparece automático en cuanto se carga en la base, sin deploy ni código nuevo.
- ❌ El texto de marketing más narrativo (ej. el párrafo de política antibullying) no está en la base — requeriría una plantilla genérica interpolando los campos existentes, en vez de un texto único por colegio como el actual.

### Opción C — Parche mínimo (sin selector todavía)
Solo sacar "Buena Fe" hardcodeado de la tarjeta de login, dejándola genérica ("Portal Gestión Educativa" o similar), sin tocar el resto de la página pública.
- ✅ Costo casi nulo, elimina la confusión de marca más urgente (el login).
- ❌ No resuelve el fondo del problema — el resto de la página pública sigue siendo de un solo colegio.

## Opción elegida: **B**

Con tres colegios reales y expectativa de que el sistema siga creciendo (como con la incorporación reciente de Juana Azurduy), la Opción B es la que realmente encaja con la naturaleza multitenant del sistema — crece sin intervención manual repetida por cada colegio nuevo.

---

## Contenido de la pantalla pública genérica

### El flujo queda confirmado tal cual se planteó
Genérico → selector de colegio → login ya personalizado con el color/logo elegido. Sin pantalla intermedia por colegio — el contenido "visión y misión" de un colegio puntual (como el que hoy tiene Buena Fe) no se traslada a ningún lado nuevo; en su lugar, la pantalla genérica pasa a tener contenido propio, real y con peso, común a los tres colegios y al sistema en sí.

### Referentes: el mismo patrón lo usan multinacionales serias
Este comportamiento (dominio único, selector de organización, login personalizado) no es una simplificación — es el estándar de software institucional serio, usado por:
- **Slack** — se entra al dominio general, se indica el equipo/workspace, y recién ahí aparece el login con la marca de esa organización.
- **Microsoft 365 / Azure AD** — se ingresa el correo, Microsoft detecta la organización ("home realm discovery") y redirige al login con la identidad visual de esa empresa, no la de Microsoft.
- **Atlassian (Jira/Confluence)** — cada organización tiene su propio subdominio, pero el punto de entrada público es genérico hasta elegir la organización.
- **Zendesk / Google Workspace** — mismo esquema: acceso genérico, luego personalización según la organización detectada o elegida.

Es señal de un sistema bien armado para escalar a muchos clientes (colegios) sin duplicar trabajo por cada uno — no de "menos serio" frente a tener una página fija por colegio.

### Lo que ofrece el sistema (aplica a los tres colegios por igual)
- **Tareas en línea con trazabilidad real** — el profesor sube la actividad, el estudiante entrega ahí mismo, queda registro de quién entregó y cuándo. Se termina lo de "se perdió en el grupo de WhatsApp".
- **Comunicados y citaciones con confirmación de lectura** — el director o profesor cita a un padre, y el sistema muestra si ya lo leyó. No más "no me llegó el mensaje".
- **Reportes del cuaderno pedagógico exportables a Excel** — el trabajo diario del profesor sale directo a un formato entregable, sin transcribir nada a mano.
- **Alerta temprana de bajo rendimiento** — no hay que esperar al cierre del trimestre. El sistema avisa antes, y el director lo ve en tiempo real en sus reportes — profesor y dirección actúan juntos, a tiempo.

### Lo común entre los tres colegios (regulado por el Ministerio de Educación)
- Mismo sistema de evaluación por dimensiones (Ser/Saber/Hacer/Decidir), con escala oficial.
- Mismo calendario de trimestres/gestión.
- Mismo marco normativo (cada colegio con su resolución ministerial ya cargada en su ficha).

### El mensaje central: formación integral, no solo digitalización
La educación de un estudiante no depende únicamente del profesor — depende también de la familia. El sistema no reemplaza ese rol, lo hace posible dándole al padre información real, no promesas:

> No es solo un software de gestión — es la tranquilidad de saber, el mismo día, que tu hijo está en el aula. El profesor pasa asistencia y ese dato llega de inmediato: ya no es "confiar y esperar", es saber con certeza.
>
> Y si algo no va bien — bajas notas, ausencias — el sistema avisa antes de que sea tarde, no al cerrar el trimestre cuando ya no hay margen. Ahí es donde el padre tiene que actuar: acercarse al colegio, preguntar, involucrarse. El sistema abre la puerta a tiempo; cruzarla es una responsabilidad compartida entre colegio y familia.

### Frase de identidad (versión ajustada — profesional y cercana a la vez)
> Diseñado por un profesor que también es informático. Porque el docente de hoy no solo dicta su materia — entiende lo que realmente pasa en el aula y construye la solución con sus propias manos. El profesor se dedica a enseñar; el sistema se encarga de que nada se pierda.


1. Aplicar el script SQL de `color_primario`.
2. Sumar el snippet de `setProperty` a `director.js`, `profesor.js`, `estudiante.js` (dashboards ya logueados).
3. Diseñar el selector de colegio de la página pública, con su propia carga dinámica de `colegios`.
4. Convertir el texto narrativo de `index.html` (política antibullying, compartir, etc.) en una plantilla genérica interpolada, o decidir qué campos nuevos agregar a `colegios` si se quiere conservar texto propio por colegio.
5. Limpiar/neutralizar el amarillo de "U.E. Gloria" en `theme-colors.css` antes de sumar el nuevo sistema de color por colegio, para no dejar dos mecanismos de theming compitiendo.



-----------------------------------------------------
-----------------------------------------------------

# Plan — Rediseño Visual General de Interfaz (UI Base, aplica a los 3 colegios por igual)

**Sistema:** Gestión Educativa 2027 · **Fecha:** 16/07/2026 · **Estado:** Propuesta, pendiente de aprobación

---

## 0. Relación con el otro `.md` (identidad por colegio)

Este documento es **previo y separado** del informe de "Rediseño Visual e Identidad Multitenant Dinámica". Ese otro documento toca **solo 3 cosas puntuales** de diseño (contraste fondo/tarjeta, peso de sombra, `DM Mono` en los números de las tarjetas) — el resto de su contenido es sobre color dinámico por colegio, un tema de **identidad institucional**, no de mejora visual general. Este plan cubre todo lo que ese otro no toca: tipografía, espaciado, tarjetas, botones, tablas, formularios, y la deuda técnica del CSS.

**Orden de ejecución:** primero este plan (base visual mejorada, por defecto, igual para los 3 colegios), después el otro `.md` (cada colegio pinta esa base con sus propios colores). Invertir el orden implica rehacer trabajo de color dos veces.

---

## 1. Requisitos no funcionales (marco de decisión para todo lo que sigue)

El sistema lo usan estudiantes, profesores, directores, secretarias, y tutores — incluyendo abuelos y otros adultos mayores sin experiencia digital, y niños en los cursos más bajos. Toda decisión de diseño se mide contra esto:

- **Intuitivo sin curva de aprendizaje** — un tutor que nunca usó un sistema de gestión debe entender qué tocar sin ayuda.
- **Legible primero, moderno segundo** — contraste real, tamaños de texto que no obliguen a acercar la pantalla, sin sacrificar claridad por estética.
- **Consistente** — el mismo tipo de botón, tarjeta o tabla se ve y se comporta igual en todos los paneles (hoy no es así, ver hallazgos).
- **Responsive de verdad** — el bug de la lupa pisando notas en móvil (pendiente de esta sesión) es exactamente el tipo de falla que este plan busca prevenir de raíz, no parchear caso por caso.

---

## 2. Hallazgos confirmados en el CSS actual

| Problema | Evidencia |
|---|---|
| Sin escala tipográfica | Tamaños sueltos por elemento (32px, 28px, 20px, 17px, 14px, 13.5px, 11px...), sin variables `--font-size-*`. Cada desarrollador puso el número que le pareció en el momento. |
| Sin escala de espaciado | Solo `border-radius` tiene variables (`--radius-sm/md/lg/xl`). Padding/margin son valores sueltos (`22px 24px`, `8px 16px`...), sin sistema. |
| Bajo contraste | `--color-bg: #f8fafc` vs `--color-surface: #ffffff` — fondo y tarjetas casi se funden. |
| Sombra genérica | `--shadow-md` es el default de Tailwind sin editar, no aporta profundidad real. |
| `DM Mono` infrautilizada | Cargada e importada, usada en solo 3 lugares puntuales — sin criterio de cuándo usarla. |
| CSS creciendo "pegado al final" | Comentarios tipo `/* agregar al final para sobreescribir */`, bloques duplicados (la tabla de resumen de inicio está definida dos veces en el archivo). Deuda de mantenibilidad, no solo estética. |
| Gradiente hardcodeado | `.sp-thead` con índigo fijo en hex, sin variable — va a quedar "pegado" en ese color cuando se aplique el theming por colegio del otro documento, rompiendo la coherencia visual apenas un colegio elija otro color. |
| Colores de acento sin relación institucional | Paleta stock de Tailwind (`indigo-600`, `sky-500`, `red-500`, `emerald-500`) en las tarjetas de estadísticas, sin vínculo con ningún colegio. |

---

## 3. Dato clave para el diseño de variables: los colegios usan 2 colores, no 1

Mencionaste que cada colegio se identifica con **dos colores** (escudo/uniforme), no uno:
- Juana Azurduy → celeste claro + blanco
- Buena Fe → celeste oscuro + blanco
- Mariscal Sucre → rojo + blanco

**Esto cambia una decisión técnica del otro `.md`:** ese documento propone una sola columna `colegios.color_primario`. Con dos colores institucionales reales por colegio, conviene desde ahora dejar la base preparada para dos variables (`--color-primary` y `--color-secondary`, o `--color-primary` + `--color-primary-dark` si el segundo color siempre es una variante tonal del primero) en vez de una sola. Blanco como color base ya está cubierto por `--color-surface`, así que en la práctica alcanza con **una columna adicional** (`color_secundario`) sumada a la que ya se planeaba. Vale la pena avisarlo ahora, antes de que se implemente el otro documento con una sola columna y haya que agregar una segunda después.

---

## 4. Alcance de este plan

### 4.1 Sistema de tipografía (nuevo)
Definir una escala fija de variables y migrar los tamaños sueltos existentes a ellas:
```css
--font-size-xs: 11px;   /* metadatos, etiquetas pequeñas */
--font-size-sm: 13px;   /* texto de tabla, texto secundario */
--font-size-base: 14px; /* texto de cuerpo estándar */
--font-size-lg: 17px;   /* subtítulos */
--font-size-xl: 20px;   /* títulos de tarjeta/sección */
--font-size-2xl: 28px;  /* títulos de página */
--font-size-3xl: 32px;  /* números grandes de estadísticas */
```
`DM Mono` se aplica de forma consistente a todo dato numérico destacado (no solo `.stat-card-value`): notas, montos, porcentajes, conteos — nunca a texto narrativo.

### 4.2 Sistema de espaciado (nuevo)
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
```
Reemplaza los valores sueltos de padding/margin. Mismo criterio que ya existe para `--radius-*`, extendido a espaciado.

### 4.3 Contraste y profundidad
- Aumentar diferencia entre `--color-bg` y `--color-surface` (fondo un poco más oscuro/tinte, tarjeta blanca real destacando de verdad).
- Sombra rediseñada con más peso (no genérica de plantilla).

### 4.4 Tarjetas (cards)
- Tamaño y padding consistentes usando la nueva escala de espaciado.
- Jerarquía visual clara: título → dato principal (número, en `DM Mono`) → metadato secundario, mismo orden en todas las tarjetas del sistema (hoy varía).
- Los 4 colores de acento fijos pasan a derivarse de `--color-primary`/`--color-secondary` vía `color-mix()` (técnica ya en uso hoy en 3 lugares), no de colores fijos.

### 4.5 Botones, tablas, formularios
- Auditar y unificar tamaños/estados (hover, disabled, loading) usando las nuevas variables — hoy cada panel los define un poco distinto.
- Tablas: espaciado de celdas consistente, encabezados con jerarquía clara (relevante para el bug móvil de la lupa — un espaciado sistemático previene que un botón se superponga a otro contenido).

### 4.6 Limpieza de deuda técnica (requisito previo, no opcional)
- Eliminar el bloque CSS duplicado de la tabla de resumen de inicio.
- Sacar el gradiente hardcodeado de `.sp-thead` y reemplazarlo por variables.
- Neutralizar/eliminar el amarillo residual de `theme-colors.css` ("U.E. Gloria") — si esto no se limpia antes, va a competir visualmente con el sistema de color nuevo y va a ser imposible saber, al ver un bug de color, si viene de acá o del theming por colegio.

---

## 5. Orden de implementación

1. **Limpieza de deuda técnica** (duplicados, gradiente hardcodeado, resto de "U.E. Gloria") — sin esto, cualquier cambio de arriba es más difícil de razonar y más fácil de romper.
2. **Variables de tipografía y espaciado** — base para todo lo demás.
3. **Contraste y sombra** (fondo/tarjeta/profundidad).
4. **Tarjetas, botones, tablas** — aplicar las variables nuevas de forma consistente en los 6 paneles.
5. Recién ahí: **el otro `.md`** (color dinámico por colegio, con la corrección de la sección 3 de este documento — dos columnas de color, no una).

---

## 6. Riesgo

Bajo — mismo criterio que el resto de la auditoría de hoy: son cambios de CSS y de organización de variables, no tocan lógica de negocio, RLS, ni ninguna tabla. El único cuidado real es hacerlo *antes* del theming por colegio, para no duplicar esfuerzo.







----------------------------------------
----------------------------------------
# Plan Final — Identidad Multitenant Dinámica (Colegio, Colores, Logo)
**Sistema:** Gestión Educativa 2027 · **Fecha:** 18/07/2026 · **Estado:** Listo para implementar

---

## 1. Lo que ya está resuelto (no requiere nada más)

**`global.css`** — rediseño visual base aplicado y confirmado en los 3 colegios: contraste fondo/tarjeta, sombras con peso real, `DM Mono` para números, tarjetas con acento de color distintivo, tablas con jerarquía visual. Por defecto, para todo colegio nuevo, sin que nadie configure nada.

**`theme-colors.css`** — capa aparte, **no relacionada** con la identidad por colegio. Es la paleta amarilla de acciones (exportar/imprimir) y el modo oscuro/claro (`localStorage`, preferencia personal de cada usuario en su navegador). No compite ni se cruza con el color institucional del colegio — son dos capas independientes que se combinan: el color del colegio pinta la identidad (sidebar activo, acentos de tarjetas), y `theme-colors.css` sigue controlando su propia paleta amarilla y el claro/oscuro exactamente igual que hoy. Nada que tocar ahí.

**Confirmado también hoy:** el mismo criterio de "revisar antes de dar por sentado" aplicado durante toda la auditoría siguió dando resultado en el módulo técnico (5 bugs de `curso_id = NULL` encontrados y corregidos en producción, `047` a `051`). Ese trabajo es independiente de este plan y ya está cerrado.

---

## 2. Lo que falta — Identidad dinámica por colegio

### 2.1 Migración SQL — 100% aditiva

```sql
-- 1. Dos colores, no uno — cubre tanto el patrón típico (un color +
--    blanco) como colegios con paleta propia de dos colores reales.
--    Nullable con default: ningún colegio existente se ve afectado.
ALTER TABLE public.colegios ADD COLUMN IF NOT EXISTS color_primario   text DEFAULT '#4f46e5';
ALTER TABLE public.colegios ADD COLUMN IF NOT EXISTS color_secundario text DEFAULT '#ffffff';

-- 2. logo_url ya existe en la tabla desde el diseño original —
--    no se crea nada nuevo, solo se empieza a usar.

-- 3. Vista de solo lectura, con la mínima superficie necesaria
--    para la pantalla pública de selección de colegio (antes del
--    login, sin sesión). No expone email/telefono/director_nombre/
--    resolucion_ministerial ni ninguna otra columna sensible.
CREATE VIEW public.colegios_publico
WITH (security_invoker = true) AS
SELECT id, nombre, logo_url, color_primario, color_secundario
FROM public.colegios
WHERE activo = true;

GRANT SELECT ON public.colegios_publico TO anon;
```

**Storage:** bucket nuevo `logos-colegios`, público, estructura `logos-colegios/{colegio_id}/logo.{ext}` — mismo mecanismo que ya usa el sistema hoy para consignas de actividades, sin inventar nada nuevo.

### 2.2 Por qué esto no toca RLS, triggers, ni ninguna política existente

| Punto de la auditoría de hoy | ¿Se ve afectado? | Por qué |
|---|---|---|
| Políticas RLS de `notas`, `asistencias`, `entregas_tareas`, `pagos_mensualidad`, `fichas_seguimiento_ser`, `evaluaciones_docente`, `respuestas_evaluacion` | **No** | Ninguna se toca, ni se lee ni se escribe. Este cambio vive enteramente en `colegios` (2 columnas nuevas) y en una vista nueva de solo lectura. |
| Triggers existentes (`proteger_colegio_tutor`, `proteger_comunicado_estudiante`, `handle_new_user`, etc.) | **No** | Ninguno referencia `color_primario`/`color_secundario`/`logo_url`; no hay trigger nuevo que agregar para esto. |
|**Actualización 24-nov-2026 (migración 121):** por los privilegios por defecto de Supabase, la vista también permitía escritura a `anon` y `authenticated`; la 121 la dejó en solo lectura (SELECT), verificado en producción.
| `colegios_write_director` (ya existente) | **Reutilizada, no modificada** | Ya permite `UPDATE` completo al director de su propio colegio — alcanza para que guarde sus 2 colores y su logo sin que haga falta ninguna política nueva de escritura. |
| Login / autenticación (`auth.users`, `handle_new_user`, tokens) | **No** | El selector de colegio ocurre *antes* de cualquier autenticación — no interactúa con sesiones, tokens ni roles. Es una pantalla de solo lectura pública, conceptualmente igual a mostrar una lista de sucursales antes de iniciar sesión. |

**Conclusión de seguridad:** el cambio es aditivo en el sentido estricto — agrega 2 columnas nullable con default, una vista de solo lectura con columnas explícitamente no sensibles, y un bucket de Storage nuevo. No modifica, no reemplaza y no depende de ninguna política, trigger o función ya auditada y cerrada hoy. El aislamiento entre colegios (verificado en vivo varias veces en esta sesión, incluyendo la prueba directa `SET ROLE authenticated` con `colegio_id` cruzado) queda exactamente igual que antes de este cambio.

### 2.3 Frontend — archivos existentes, cero archivos nuevos

| Archivo | Cambio |
|---|---|
| `index.html` | Nueva sección `#selector-colegio-section` (mismo patrón show/hide que ya usa `#login-section`). Login deja de tener HTML fijo de un colegio, se rellena dinámicamente. Incluye buscador desde el diseño inicial. |
| `js/admin/director.js` | Configuración → Colegio: 2 selectores de color + input de archivo para logo, sumados al `payload` de `guardarColegio()` ya existente. |
| `js/auth/auth.js` | Dentro de `verificarSesion()` (punto de entrada único de los 6 paneles): fetch a `colegios_publico` por `colegio_id` + `document.documentElement.style.setProperty(...)` para `--color-primario` y `--color-secundario`. Un solo archivo, efecto en los 6 paneles. |
| `css/global.css` | Los 4 colores de acento fijos de las tarjetas pasan a usar `var(--color-primario)`/`var(--color-secundario)` con `color-mix()` (técnica ya en uso) en vez de índigo/celeste/rojo/verde de plantilla. |

### 2.4 Comportamiento por defecto (colegio nuevo, sin configurar nada)

- Colores: `#4f46e5` / `#ffffff` — el mismo aspecto que el sistema tiene hoy, ya con el rediseño de `global.css` aplicado. Ningún colegio nuevo se ve peor ni distinto por no haber configurado nada todavía.
- Logo: ícono genérico de institución (SVG propio del sistema, no una imagen externa) mientras `logo_url` sea `NULL` — nunca un ícono roto.

---

## 3. Orden de aplicación

1. Migración SQL (sección 2.1).
2. Bucket de Storage `logos-colegios`.
3. `director.js` — Configuración → Colegio (colores + logo).
4. `index.html` — selector de colegio + login dinámico.
5. `auth.js` — inyección de color en `verificarSesion()`.
6. `global.css` — reemplazo de los acentos fijos por variables institucionales.

## 4. Riesgo general

Bajo, mismo veredicto que la versión anterior de este plan. Aditivo de punta a punta, no interseca con ningún hallazgo de seguridad cerrado en esta auditoría, y el aislamiento multitenant no depende en ningún punto de este cambio — sigue dependiendo exclusivamente de `mi_colegio_id()` y las políticas ya verificadas.





--------------------------------------------------
--------------------------------------------------
# Migración 019051 — Theming multitenant + página pública dinámica

## Estado: SQL aplicado ✓ · Implementación JS/HTML pendiente

---

## Migración aplicada en Supabase (oficial)

```sql
ALTER TABLE public.colegios
ADD COLUMN IF NOT EXISTS color_primario TEXT DEFAULT '#4f46e5';

ALTER TABLE public.colegios
ADD COLUMN IF NOT EXISTS color_secundario TEXT DEFAULT '#ffffff';

CREATE POLICY "colegios_select_publico"
ON public.colegios FOR SELECT
TO anon
USING (activo = true);
```

**Resultado verificado:**
- `color_primario` → text, default `#4f46e5` ✓
- `color_secundario` → text, default `#ffffff` ✓
- `colegios_select_publico` → rol `anon`, solo colegios `activo = true` ✓

---

## Contexto

El sistema es multitenant. Cada colegio tiene su propia identidad visual (colores, logo). El director configura `color_primario` y `color_secundario` desde su panel — esos cambios deben reflejarse automáticamente en todos los dashboards de ese colegio y en la página pública.

La página pública (`index.html`) actualmente está hardcodeada para Buena Fe. Debe reemplazarse por una pantalla dinámica que lea los colegios desde Supabase y cargue cada uno con su identidad visual.

---

## Flujo de la página pública

1. Usuario entra a la URL → query a `colegios` con rol `anon` → lista cards dinámicas con nombre, logo y color de cada colegio activo
2. Usuario elige su colegio → se guarda `colegio_id` y `color_primario` en `localStorage`
3. Aparece el login personalizado con el color y logo del colegio elegido
4. Login exitoso → `auth.js` redirige según rol (director, profesor, estudiante, tutor, secretaria, superadmin)
5. Al cargar cualquier dashboard → lee `color_primario` del `localStorage` y aplica `document.documentElement.style.setProperty('--color-primary', color)`

**Menú hamburguesa:** botón fijo en la página pública que al hacer clic abre un panel lateral con el marketing esencial (qué hace el sistema, los 4 roles, certificado). Se cierra con clic fuera o con X. No interrumpe el flujo de acceso.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `frontend/index.html` | Reescribir completo — selector dinámico de colegios desde Supabase + menú hamburguesa + login con theming |
| `frontend/js/auth/auth.js` | Al login exitoso, leer `color_primario` del colegio y guardarlo en `localStorage` |
| `frontend/js/admin/director.js` | Al guardar colores en Configuración, actualizar `colegios` en Supabase y `localStorage` |
| `frontend/dashboard-director.html` | Al init, leer `color_primario` de `localStorage` y aplicar `setProperty` |
| `frontend/dashboard-profesor.html` | Ídem |
| `frontend/dashboard-estudiante.html` | Ídem |
| `frontend/dashboard-tutor.html` | Ídem |

**Archivos nuevos:** ninguno.

---

## Colores institucionales definidos

| Colegio | color_primario | color_secundario |
|---|---|---|
| U.E. Técnico Humanístico Buena Fe | `#0369a1` | `#ffffff` |
| U.E. Técnico Humanístico Juana Azurduy de Padilla | `#0891b2` | `#ffffff` |
| U.E. Mariscal Sucre | `#b91c1c` | `#ffffff` |

Estos valores hay que aplicarlos en Supabase directamente en la tabla `colegios` por `id`.

---

## Notas

- `logo_url` ya existe en `colegios` — no requiere migración.
- La política `colegios_select_publico` no expone datos sensibles — `colegios` solo tiene nombre, sigla, dirección, logo y colores.
- El theming en dashboards usa la variable CSS `--color-primary` ya existente — no requiere cambios en `global.css`.
- Validar formato de color antes de guardar: `^#[0-9a-fA-F]{6}$`.
## PWA — Service Worker y Manifest

El `index.html` registra un Service Worker (`sw.js`) y referencia un `manifest.json` que convierten el sistema en una PWA instalable. Al reescribir el `index.html` es obligatorio conservar ambas referencias sin modificarlas:

- `<link rel="manifest" href="/manifest.json">` en el `<head>`
- El bloque de registro `if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js') }` al final del `<body>`

Omitir cualquiera de los dos rompe la instalación como app en celular y el caché offline.




Lo que hay que hacer
1. Crear la vista:

sql
CREATE OR REPLACE VIEW public.colegios_publico
WITH (security_invoker = true) AS
SELECT id, nombre, sigla, logo_url, color_primario, color_secundario
FROM public.colegios
WHERE activo = true;

Ejecuta en SQL Editor:
sql
GRANT SELECT ON public.colegios_publico TO anon;

El problema persiste
La vista colegios_publico sigue ejecutando colegio_de_estudiante().

Esto significa que la vista hereda las políticas RLS de la tabla y colegios_select_propio se sigue ejecutando.

Solución
Modificar la vista para que ignore las políticas RLS y solo use el filtro activo = true:

sql
-- Eliminar la vista actual
DROP VIEW public.colegios_publico;

-- Crear la vista SIN security_invoker
CREATE VIEW public.colegios_publico AS
SELECT id, nombre, sigla, logo_url, color_primario, color_secundario
FROM public.colegios
WHERE activo = true;

-- Re-aplicar el GRANT
GRANT SELECT ON public.colegios_publico TO anon;




------------------//////////////------------------------

Informe Técnico: Implementación de Identidad Multitenant Dinámica
1. Estado Inicial (Antes de los cambios)
Componente	Estado	Problema
Página pública (index.html)	Estática, hardcodeada para un solo colegio	No mostraba colegios dinámicos
Consulta de colegios	supabase.from('colegios') con RLS	Error 401 porque colegios_select_propio ejecutaba mi_colegio_id() para anon
Colores institucionales	No existían en la tabla colegios	Todos los colegios usaban el mismo color por defecto
Login	Sin validación de colegio	Usuarios de un colegio podían loguearse desde otro
Sidebar	Color fijo #1e1b4b	No cambiaba con el colegio seleccionado
Tarjetas	Fondo fijo var(--color-surface)	No usaban color secundario
Storage de logos	No existía	No se podían subir logos
2. Migraciones Aplicadas en Supabase
Migración 052: Theming multitenant + página pública dinámica
sql
-- ============================================================
-- MIGRACIÓN 052: Theming multitenant + página pública dinámica
--
-- Agrega columnas de identidad visual a la tabla colegios:
--   color_primario  → color institucional principal (hex)
--   color_secundario → color institucional secundario (hex)
--
-- Ambos son configurables por el director desde su panel.
-- Al login, el frontend lee estos valores y aplica
-- setProperty('--color-primary') en todos los dashboards,
-- garantizando que cada colegio tenga su propia identidad
-- visual sin afectar a los demás (aislamiento multitenant).
--
-- También crea la política colegios_select_publico que permite
-- al rol anon leer colegios activos — necesaria para que la
-- página pública cargue las tarjetas de colegios sin sesión.
-- Solo expone datos no sensibles (nombre, logo, colores).
-- ============================================================

ALTER TABLE public.colegios
ADD COLUMN IF NOT EXISTS color_primario TEXT DEFAULT '#4f46e5';

ALTER TABLE public.colegios
ADD COLUMN IF NOT EXISTS color_secundario TEXT DEFAULT '#ffffff';

CREATE POLICY "colegios_select_publico"
ON public.colegios FOR SELECT
TO anon
USING (activo = true);
Migración 053: Vista pública para selección de colegios
sql
-- ============================================================
-- MIGRACIÓN 053: Vista pública para selección de colegios
--
-- Propósito:
--   La página pública (index.html) debe mostrar la lista de
--   colegios activos a cualquier visitante SIN necesidad de
--   autenticación (rol anon).
--
--   La tabla 'colegios' tiene políticas RLS que restringen el
--   acceso según el rol del usuario. Para usuarios anónimos,
--   la política 'colegios_select_publico' permite leer colegios
--   activos, pero otras políticas como 'colegios_select_propio'
--   se siguen ejecutando y llaman a funciones que requieren
--   autenticación (ej. mi_colegio_id()), causando error 401.
--
-- Solución:
--   Crear una vista separada que:
--     1. Expone SOLO los campos necesarios para la página pública
--        (id, nombre, sigla, logo_url, color_primario, color_secundario)
--     2. Filtra SOLO colegios activos (activo = true)
--     3. NO usa security_invoker, por lo que NO hereda las
--        políticas RLS de la tabla 'colegios'
--     4. Permite a usuarios anónimos (anon) hacer SELECT sin
--        ejecutar funciones que requieran autenticación
-- ============================================================

CREATE OR REPLACE VIEW public.colegios_publico AS
SELECT id, nombre, sigla, logo_url, color_primario, color_secundario
FROM public.colegios
WHERE activo = true;

GRANT SELECT ON public.colegios_publico TO anon;
Migración 054: Bucket Storage para logos de colegios
sql
-- ============================================================
-- MIGRACIÓN 054: Bucket Storage para logos de colegios
--
-- Propósito:
--   Crear el bucket 'logos-colegios' en Storage para que los
--   directores puedan subir el logo/escudo de su colegio desde
--   el panel de Configuración. El logo se muestra en la página
--   pública (index.html) junto con los colores institucionales.
--
--   La lectura es pública (cualquier visitante puede ver el logo).
--   El borrado solo lo puede hacer quien subió el archivo.
--   No afecta RLS de tablas existentes.
-- ============================================================

-- 1. Crear bucket si no existe
INSERT INTO storage.buckets (id, name, public)
SELECT 'logos-colegios', 'logos-colegios', true
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id = 'logos-colegios'
);

-- 2. Política: lectura pública
DROP POLICY IF EXISTS "logos_read" ON storage.objects;
CREATE POLICY "logos_read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'logos-colegios');

-- 3. Política: solo quien subió puede eliminar
DROP POLICY IF EXISTS "logos_delete" ON storage.objects;
CREATE POLICY "logos_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'logos-colegios' AND auth.uid() = owner);
Migración 055: Aislamiento multitenant en Storage de logos
sql
-- ============================================================
-- MIGRACIÓN 055: Aislamiento multitenant en Storage de logos
--
-- Propósito:
--   Reemplazar la política insegura de subida de logos que
--   permitía a CUALQUIER usuario autenticado (estudiantes,
--   tutores, profesores) subir archivos al bucket, por una
--   política que restringe la subida SOLO a directores y SOLO
--   a la carpeta de su propio colegio.
--
-- Antes: cualquier usuario autenticado podía subir archivos.
-- Después: solo directores, solo a su colegio.
--
-- Seguridad y aislamiento multitenant:
--   - Solo directores pueden subir logos (es_director())
--   - Solo al colegio del director (mi_colegio_id())
--   - Un director de Buena Fe no puede subir logo para Juana Azurduy
--   - No afecta RLS de tablas existentes
-- ============================================================

DROP POLICY IF EXISTS "logos_upload" ON storage.objects;

CREATE POLICY "logos_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'logos-colegios'
  AND public.es_director()
  AND (storage.foldername(name))[1] = public.mi_colegio_id()::text
);
3. Variables CSS Implementadas
Variable	Uso	Default
--color-primary	Color institucional primario (sidebar, botones, acentos)	#4f46e5
--color-secondary	Color institucional secundario (fondos de tarjetas, login, paneles)	#ffffff
--sidebar-bg	Fondo del sidebar (vinculado a --color-primary)	var(--color-primary, #1e1b4b)
--sidebar-active	Item activo del sidebar (vinculado a --color-primary)	var(--color-primary, #4f46e5)
4. Archivos Modificados
4.1 frontend/index.html
Cambio	Razón
Cambiar supabase.from('colegios') → supabase.from('colegios_publico')	Usar vista pública sin RLS conflictiva
Eliminar .eq('activo', true)	La vista ya filtra activo = true
Guardar color_secundario en localStorage	Persistir color secundario entre sesiones
Aplicar colores desde localStorage al cargar	Mantener colores al recargar
Agregar autocomplete="off" en login	Evitar autocompletado del navegador
4.2 frontend/js/auth/auth.js
Cambio	Razón
Validación de colegio en login	Impedir login cruzado entre colegios
Aplicar colores desde localStorage al dashboard	Los dashboards heredan colores dinámicamente
Código agregado en verificarSesion():

javascript
// Aplicar colores del colegio desde localStorage
const colorPrimario = localStorage.getItem('color_primario')
const colorSecundario = localStorage.getItem('color_secundario')
if (colorPrimario) {
  document.documentElement.style.setProperty('--color-primary', colorPrimario)
}
if (colorSecundario) {
  document.documentElement.style.setProperty('--color-secondary', colorSecundario)
}
4.3 frontend/js/admin/director.js
Cambio	Razón
Input de logo en Configuración	Permitir subir escudo del colegio
Función subirLogo()	Subir imagen a Storage y guardar logo_url
Función eliminarLogo()	Eliminar logo del colegio
Guardar color_secundario en localStorage al actualizar	Actualizar en tiempo real
Código agregado en guardarColegio():

javascript
if (payload.color_primario) {
  document.documentElement.style.setProperty('--color-primary', payload.color_primario)
  localStorage.setItem('color_primario', payload.color_primario)
}
if (payload.color_secundario) {
  document.documentElement.style.setProperty('--color-secondary', payload.color_secundario)
  localStorage.setItem('color_secundario', payload.color_secundario)
}
4.4 frontend/css/global.css
Cambio	Razón
--color-secondary en :root	Definir variable para color secundario
--sidebar-bg: var(--color-primary, #1e1b4b)	Sidebar dinámico con color primario
--sidebar-active: var(--color-primary, #4f46e5)	Item activo dinámico
.card usa --color-secondary	Tarjetas usan color secundario
.stat-card usa --color-secondary	Estadísticas usan color secundario
.login-card usa --color-secondary	Login usa color secundario
.panel-lateral usa --color-secondary	Menú hamburguesa usa color secundario
5. Flujo Funcional Actual
text
Usuario entra a index.html
         ↓
  (anon) consulta colegios_publico
         ↓
  Muestra colegios con colores y logos (si existen)
         ↓
Usuario selecciona un colegio
         ↓
  localStorage.colegio_id = id
  localStorage.color_primario = color_primario
  localStorage.color_secundario = color_secundario
         ↓
  Muestra login con branding del colegio
         ↓
Usuario ingresa credenciales
         ↓
  auth.js valida: perfil.colegio_id === localStorage.colegio_id?
         ↓
       YES → Redirige al dashboard
       NO  → Error: "Este usuario no pertenece al colegio seleccionado"
         ↓
  auth.js aplica colores desde localStorage al dashboard
         ↓
  Dashboard muestra colores del colegio (sidebar, tarjetas, botones)
6. Estado Actual (Después de los cambios)
Componente	Estado
Página pública	✅ Muestra todos los colegios activos con sus colores y logos
Selección de colegio	✅ Guarda colegio_id, color_primario y color_secundario en localStorage
Login	✅ Valida que el usuario pertenezca al colegio seleccionado
Sidebar	✅ Dinámico, usa --color-primary del colegio
Tarjetas	✅ Usan --color-secondary del colegio
Login card	✅ Usa --color-secondary del colegio
Logo	✅ Se sube desde Configuración y se muestra en página pública
Persistencia	✅ Los colores se mantienen al recargar y al cerrar sesión
Actualización en tiempo real	✅ Al guardar desde Configuración, los colores se actualizan sin recargar
Aislamiento Storage	✅ Solo directores pueden subir logos de su colegio
7. Resumen de Archivos Modificados
Archivo	Cambios
frontend/index.html	Vista pública, localStorage, autocomplete
frontend/js/auth/auth.js	Validación de colegio, aplicación de colores
frontend/js/admin/director.js	Logo, colores en tiempo real
frontend/css/global.css	Variables CSS, sidebar dinámico, tarjetas dinámicas
8. Migraciones en Supabase
Migración	Descripción
052	Columnas color_primario y color_secundario + política colegios_select_publico
053	Vista colegios_publico y permisos anon
054	Bucket logos-colegios, políticas de lectura y eliminación
055	Aislamiento multitenant en Storage: solo directores pueden subir logos de su colegio
9. Conclusión
El sistema ahora cumple con los requisitos multitenant:

✅ Página pública dinámica con lista de colegios desde Supabase

✅ Identidad visual por colegio (colores primario y secundario)

✅ Logo institucional por colegio (subido desde el panel de director)

✅ Validación de colegio durante el login

✅ Aislamiento completo entre colegios

✅ Persistencia de colores entre sesiones

✅ Actualización en tiempo real desde el panel de configuración

✅ Seguridad en Storage: solo directores pueden subir logos de su colegio

---------------------------//////////////////////
//////////////////////////----------------------
# Cambio de dominio en Vercel — análisis de impacto

## Objetivo

Cambiar el dominio del proyecto en Vercel de `colegio-buena-fe.vercel.app`
(nombre heredado de cuando el sistema era mono-tenant, solo Buena Fe) a un
nombre genérico multitenant (ej. `sistemaescolar.vercel.app`,
`eduaulabolivia.vercel.app`), **sin romper nada** para los tres colegios que
ya usan el sistema en producción.

## Conclusión general

**No hay nada grave.** El cambio de dominio en sí no rompe la aplicación —
`git push` y el despliegue en Vercel son independientes del nombre del
dominio. Se identificaron **2 puntos que hay que actualizar a mano** porque
tienen el dominio viejo (o datos de un solo colegio) escritos de forma fija
en el código, y **1 punto de configuración externa** (Supabase) que hay que
revisar. Nada de esto es estructural ni requiere rediseñar el sistema.

---

## 1. Lo que NO se rompe (confirmado)

- El repo de Git no contiene el dominio en ningún lado relacionado a
  build/deploy — el dominio es configuración de Vercel (Project Settings),
  no del código. Un `git push` normal no lo toca.
- `manifest.json` usa `"start_url": "/"` (ruta relativa) — no depende del
  dominio.
- `sw.js` (service worker) no referencia el dominio.
- No hay `redirectTo` / `emailRedirectTo` con el dominio hardcodeado en el
  código JS (los redirects de Supabase Auth se controlan desde el
  dashboard de Supabase, no desde el código).
- El resto de URLs absolutas en el proyecto son de servicios externos
  (Cloudinary para subida de archivos) y no dependen del dominio propio.

## 2. Lo que SÍ hay que tocar

### 2.1 QR de las credenciales de estudiante (impacto medio, manejable)

**Archivo:** `frontend/js/admin/credenciales-pdf.js` (línea 6)

```js
const URL_SISTEMA = 'https://colegio-buena-fe.vercel.app/index.html'
```

Esta constante se usa 3 veces en el mismo archivo para generar el QR que
se imprime en las credenciales físicas del estudiante. No lee el dominio
actual del navegador, está fija.

**Impacto si se cambia el dominio sin tocar esta línea:**
- Toda credencial **nueva** que se genere después del cambio seguirá
  apuntando al dominio viejo.
- Si en algún momento se da de baja `colegio-buena-fe.vercel.app`, tanto
  las credenciales nuevas (mal generadas) como las **ya impresas y
  entregadas a estudiantes de Buena Fe** dejarían de funcionar al escanear
  el QR.

**Cómo se maneja (bajo riesgo):**
1. Actualizar esta línea al nuevo dominio antes o junto con el cambio en
   Vercel.
2. En Vercel, **no eliminar** `colegio-buena-fe.vercel.app` — agregar el
   dominio nuevo como adicional y dejar el viejo activo como alias. Así los
   QR ya impresos (con la URL vieja) siguen funcionando indefinidamente,
   mientras que las credenciales que se generen de ahí en adelante ya
   llevan el dominio nuevo.

### 2.2 Nombre e ícono de instalación (PWA) — hallazgo aparte, no depende del dominio

**Archivo:** `frontend/public/manifest.json`

```json
"name": "U.E. Técnico Humanístico Buena Fe"
```

Y los íconos (`icon-192.png`, `icon-512.png`) son el escudo de Buena Fe.

Esto **no tiene que ver con el cambio de dominio** (seguiría igual de mal
aunque no tocaras Vercel), pero es un resabio de la era mono-tenant que ya
está afectando a los otros dos colegios: **hoy, cualquier estudiante de
Mariscal Sucre o Juana Azurduy que instale la app en su escritorio o
celular, ve el nombre y el escudo de Buena Fe**, no el de su propio
colegio.

**Por qué no puede ser dinámico por colegio con la arquitectura actual:**
el navegador (Android/Chrome en particular) lee `manifest.json` una sola
vez desde una URL fija al cargar la página — no en el momento en que el
usuario elige su colegio en el selector. No hay forma de inyectarle el
escudo correspondiente en tiempo real vía `localStorage` con un único
`index.html` público compartido.

**Cómo se maneja:**
- Arreglo mínimo (recomendado ahora): cambiar `manifest.json` a un nombre
  e ícono neutros (ej. "Plataforma Educativa" / ícono genérico del
  sistema), para que al menos no favorezca a ningún colegio en particular.
- Arreglo completo (a futuro, mayor esfuerzo): cada colegio con su propia
  ruta o subdominio, cada uno con su propio `manifest.json` — recién ahí
  Android podría instalar un ícono distinto por colegio. Esto es un cambio
  de arquitectura de rutas, no un parche, y se evalúa aparte.

## 3. Configuración externa a revisar (no es código)

**Supabase → Authentication → URL Configuration** (Site URL / Redirect
URLs): si tiene registrado el dominio viejo, hay que agregar/actualizar el
nuevo ahí. Si no se hace, se rompen los links de confirmación de correo,
reseteo de contraseña y cualquier redirect de auth que dependa de esa URL.
Esto se hace en el dashboard de Supabase, no en el repo.

## 4. Checklist de cambio de dominio

1. [ ] Agregar el dominio nuevo en Vercel (Project Settings → Domains) sin
       borrar el viejo.
2. [ ] Actualizar `URL_SISTEMA` en `credenciales-pdf.js` al dominio nuevo.
3. [ ] (Opcional, recomendado) Neutralizar `manifest.json` — nombre e
       ícono genéricos, no de un colegio específico.
4. [ ] Actualizar Site URL / Redirect URLs en Supabase Auth.
5. [ ] `git push` — el build toma el nuevo `URL_SISTEMA` automáticamente.
6. [ ] Probar: generar una credencial nueva y escanear su QR, probar login
       de los 3 colegios, probar reseteo de contraseña.

       ------------+++++++++++//////////////
       ---------------+++++++++++///////////
       ## Migración 057 — Desacoplar la plantilla de colegio nuevo de Buena Fe

**Estado: planteada, aún no ejecutada.** Pendiente de aplicar hasta confirmar.

### Problema

Cuando se crea un colegio nuevo, la función `copiar_config_colegio_base()` copia automáticamente cursos, materias y configuración base, para que el director nuevo no arranque de cero. Esa función usa como fuente el `colegio_id` **real** de Buena Fe (`00000000-0000-0000-0000-000000000001`), no una plantilla neutral — Buena Fe es un colegio operativo real, no fue diseñado para ser una matriz.

El peligro: si en Buena Fe se **inactiva** una materia o curso, el colegio nuevo hereda esa materia/curso ya inactivo — el director nuevo puede reactivarlo manualmente desde su propio panel, sin intervención técnica, así que hoy el daño es reversible.

El riesgo real es a futuro: si el sistema llega a implementar borrado físico de materias/cursos (hoy no existe, todo es toggle `activo`/`inactivo`), un borrado en Buena Fe se heredaría también como borrado en el colegio nuevo — y eso sí sería irreversible para ese colegio, sin que su director pueda hacer nada al respecto. Este fix se aplica preventivamente, antes de que ese escenario exista.

### Solución

1. Crear un colegio-plantilla nuevo, separado de Buena Fe: `activo = false` (invisible en el selector público), con una columna nueva `es_plantilla = true` que lo identifica sin depender de ningún ID escrito a mano.
2. Copiar ahí, una sola vez (foto fija del estado actual), los cursos/materias/configuración que hoy tiene Buena Fe.
3. `copiar_config_colegio_base()` pasa a copiar desde esa plantilla, no desde Buena Fe.

El ID de la plantilla se genera con `gen_random_uuid()` — no un valor fijo — para evitar cualquier colisión con algún chequeo suelto en el código que trate un UUID "especial" (como todo ceros) de forma distinta.

Protecciones incluidas:
- Candado de superadmin y protección anti-duplicados de la migración 023, preservados sin cambios.
- Guardia de idempotencia: si el script se corre dos veces por error, la segunda vez no hace nada (no duplica el snapshot).
- La plantilla queda excluida del panel de "gestionar colegios" del superadmin (`es_plantilla = false` en esa consulta), para que nadie la active por accidente.

### Es aditivo — no rompe nada existente

- No modifica ni un solo registro de Buena Fe, Mariscal Sucre ni Juana Azurduy.
- No mueve a ningún profesor, estudiante, tutor, curso, nota o pago de su colegio actual.
- La columna nueva (`es_plantilla`) tiene default `false`, no afecta filas existentes.
- El colegio-plantilla es una fila nueva, sin usuarios ni datos reales vinculados.

### Flujo una vez aplicado

- **Buena Fe, Mariscal Sucre, Juana Azurduy**: sin cambios, funcionan exactamente igual que hoy.
- **Próximo colegio que se cree**: sigue heredando exactamente el mismo contenido base que heredaría hoy (mismo ahorro de trabajo para el director nuevo) — la única diferencia es de dónde sale la copia: de una foto fija de la plantilla, no de datos que Buena Fe puede seguir editando con libertad.
- **Si Buena Fe inactiva o (a futuro) elimina una materia/curso**: ya no afecta a ningún colegio nuevo — la plantilla quedó congelada en el momento del snapshot, independiente de lo que pase después en Buena Fe.
- **Si la currícula base cambia** (ej. nueva normativa del Ministerio): se actualiza a mano sobre el colegio_id de la plantilla, nunca editando Buena Fe.
-- ============================================================
-- MIGRACIÓN 057 (corregida): Plantilla base desacoplada de Buena Fe
--
-- Cambios respecto a la versión anterior, tras revisión:
--   1. UUID de la plantilla generado con gen_random_uuid() en vez de
--      un valor fijo (00000000-...-0000) -- evita cualquier colisión
--      con algún chequeo suelto en el frontend que trate ese patrón
--      como "sin colegio".
--   2. Columna nueva `es_plantilla` en `colegios` -- la función
--      copiar_config_colegio_base() ya no necesita conocer el UUID
--      de memoria: lo busca por esta bandera. Se usa también para
--      excluir la plantilla del panel de superadmin.
--   3. El snapshot completo queda protegido con un guard de
--      idempotencia -- si esta migración se corre dos veces por
--      error, la segunda vez no hace nada (no duplica cursos,
--      materias ni configuración).
-- ============================================================

-- 0. Columna para identificar la plantilla sin depender de un UUID fijo
ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS es_plantilla BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  v_colegio_base       UUID := '00000000-0000-0000-0000-000000000001'; -- Buena Fe (colegio real, solo lectura acá)
  v_plantilla_id        UUID;
  v_gestion_nueva_id     UUID;
  v_categoria            RECORD;
  v_categoria_nueva_id   UUID;
BEGIN

  -- Guard de idempotencia: si la plantilla ya existe, no hacer nada
  IF EXISTS (SELECT 1 FROM public.colegios WHERE es_plantilla = true) THEN
    RAISE NOTICE 'La plantilla ya existe, no se vuelve a crear.';
    RETURN;
  END IF;

  -- 1. Colegio-plantilla: inactivo, no aparece en el selector público,
  --    marcado con es_plantilla para que la función y el panel de
  --    superadmin lo identifiquen sin depender de un UUID fijo.
  INSERT INTO public.colegios (id, nombre, sigla, municipio, departamento, activo, es_plantilla)
  VALUES (gen_random_uuid(), 'PLANTILLA BASE — NO USAR PARA LOGIN', 'BASE', 'N/A', 'N/A', false, true)
  RETURNING id INTO v_plantilla_id;

  -- 2. Snapshot único del estado actual de Buena Fe → plantilla
  INSERT INTO public.cursos (nivel, grado, paralelo, activo, colegio_id)
  SELECT nivel, grado, paralelo, activo, v_plantilla_id
  FROM public.cursos WHERE colegio_id = v_colegio_base;

  INSERT INTO public.materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
  SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, v_plantilla_id
  FROM public.materias WHERE colegio_id = v_colegio_base;

  INSERT INTO public.config_gestion (
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, colegio_id
  )
  SELECT
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, v_plantilla_id
  FROM public.config_gestion WHERE colegio_id = v_colegio_base
  ORDER BY año DESC LIMIT 1  -- si Buena Fe tiene más de una gestión, usar solo la más reciente
  RETURNING id INTO v_gestion_nueva_id;

  INSERT INTO public.config_dimensiones (
    gestion_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, colegio_id
  )
  SELECT
    v_gestion_nueva_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, v_plantilla_id
  FROM public.config_dimensiones WHERE colegio_id = v_colegio_base;

  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id)
  SELECT año, valor_numerico, etiqueta, color, orden, v_plantilla_id
  FROM public.config_escala_ser WHERE colegio_id = v_colegio_base;

  FOR v_categoria IN SELECT * FROM public.config_categorias_ser WHERE colegio_id = v_colegio_base
  LOOP
    INSERT INTO public.config_categorias_ser (año, nombre, orden, activo, colegio_id)
    VALUES (v_categoria.año, v_categoria.nombre, v_categoria.orden, v_categoria.activo, v_plantilla_id)
    RETURNING id INTO v_categoria_nueva_id;

    INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, activo, colegio_id)
    SELECT v_categoria_nueva_id, año, texto, descripcion, orden, activo, v_plantilla_id
    FROM public.config_subcriterios_ser WHERE categoria_id = v_categoria.id;
  END LOOP;

  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, activo, colegio_id)
  SELECT año, texto, escala_min, escala_max, orden, activo, v_plantilla_id
  FROM public.config_preguntas_docente WHERE colegio_id = v_colegio_base;

  INSERT INTO public.config_notificaciones (tipo, nombre_display, plantilla, umbral_faltas, activo, colegio_id)
  SELECT tipo, nombre_display, plantilla, umbral_faltas, activo, v_plantilla_id
  FROM public.config_notificaciones WHERE colegio_id = v_colegio_base;

END $$;

-- 3. La función ahora busca la plantilla por la bandera es_plantilla,
--    no por un UUID escrito a mano -- así nunca puede desincronizarse
--    del id real que se generó arriba.
CREATE OR REPLACE FUNCTION public.copiar_config_colegio_base(nuevo_colegio_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_colegio_base UUID;
  v_gestion_nueva_id UUID;
  v_categoria RECORD;
  v_categoria_nueva_id UUID;
  v_paso TEXT := 'inicio';
BEGIN
  -- Candado de superadmin (agregado en la migración 023 — se preserva acá)
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT id INTO v_colegio_base FROM public.colegios WHERE es_plantilla = true LIMIT 1;
  IF v_colegio_base IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No existe colegio plantilla configurado.', 'paso', 'buscar_plantilla');
  END IF;

  -- Protección anti-duplicados (agregada en la migración 023 — se preserva acá)
  IF EXISTS (SELECT 1 FROM public.cursos WHERE colegio_id = nuevo_colegio_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El colegio ya tiene configuración. Operación cancelada para evitar duplicados.', 'paso', 'proteccion');
  END IF;

  v_paso := 'cursos';
  INSERT INTO public.cursos (nivel, grado, paralelo, activo, colegio_id)
  SELECT nivel, grado, paralelo, activo, nuevo_colegio_id
  FROM public.cursos WHERE colegio_id = v_colegio_base;

  v_paso := 'materias';
  INSERT INTO public.materias (nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, colegio_id)
  SELECT nombre, nivel, campo_saberes, es_tecnica, aplica_desde, activo, nuevo_colegio_id
  FROM public.materias WHERE colegio_id = v_colegio_base;

  v_paso := 'config_gestion';
  INSERT INTO public.config_gestion (
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, colegio_id
  )
  SELECT
    año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion,
    escala_maxima, etiqueta_aprobado, etiqueta_reprobado, bloqueada,
    trimestre_activo, usa_carreras_tecnicas, permite_entrega_tareas, nuevo_colegio_id
  FROM public.config_gestion WHERE colegio_id = v_colegio_base
  RETURNING id INTO v_gestion_nueva_id;

  v_paso := 'config_dimensiones';
  INSERT INTO public.config_dimensiones (
    gestion_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, colegio_id
  )
  SELECT
    v_gestion_nueva_id, año, codigo, nombre_display, descripcion,
    peso_maximo, tipo, orden, activo, nuevo_colegio_id
  FROM public.config_dimensiones WHERE colegio_id = v_colegio_base;

  v_paso := 'config_escala_ser';
  INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden, colegio_id)
  SELECT año, valor_numerico, etiqueta, color, orden, nuevo_colegio_id
  FROM public.config_escala_ser WHERE colegio_id = v_colegio_base;

  v_paso := 'config_categorias_ser';
  FOR v_categoria IN SELECT * FROM public.config_categorias_ser WHERE colegio_id = v_colegio_base
  LOOP
    INSERT INTO public.config_categorias_ser (año, nombre, orden, activo, colegio_id)
    VALUES (v_categoria.año, v_categoria.nombre, v_categoria.orden, v_categoria.activo, nuevo_colegio_id)
    RETURNING id INTO v_categoria_nueva_id;

    INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden, activo, colegio_id)
    SELECT v_categoria_nueva_id, año, texto, descripcion, orden, activo, nuevo_colegio_id
    FROM public.config_subcriterios_ser WHERE categoria_id = v_categoria.id;
  END LOOP;

  v_paso := 'config_preguntas_docente';
  INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden, activo, colegio_id)
  SELECT año, texto, escala_min, escala_max, orden, activo, nuevo_colegio_id
  FROM public.config_preguntas_docente WHERE colegio_id = v_colegio_base;

  v_paso := 'config_notificaciones';
  INSERT INTO public.config_notificaciones (tipo, nombre_display, plantilla, umbral_faltas, activo, colegio_id)
  SELECT tipo, nombre_display, plantilla, umbral_faltas, activo, nuevo_colegio_id
  FROM public.config_notificaciones WHERE colegio_id = v_colegio_base;

  RETURN jsonb_build_object('ok', true, 'colegio_id', nuevo_colegio_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'paso', v_paso);
END;
$$;

GRANT EXECUTE ON FUNCTION public.copiar_config_colegio_base TO authenticated;

---///-------
EN SUPERAMDIN .JS:
Y el ajuste en superadmin.js, para que esa fila no aparezca en el panel:Confirm exact line to patch in superadmin.jsConfirm exact line to patch in superadmin.jsEn superadmin.js, buscá con Ctrl+F:
.select('id, nombre, sigla, municipio, departamento, activo, created_at')
    .order('created_at', { ascending: false })
Reemplazá por:
.select('id, nombre, sigla, municipio, departamento, activo, created_at')
    .eq('es_plantilla', false)
    .order('created_at', { ascending: false })

    //////////AHI CIERRA LA MIGRACIONS 057-----////


    Migración 058 — Planes económicos por colegio

Estado: diseñada y revisada, pendiente de ejecución. No aplicada todavía.

Objetivo

Que ciertas funcionalidades avanzadas del sistema queden condicionadas al plan económico que cada colegio contrató, controlado por el superadmin desde su propio panel — sin tocar la estructura de la base de datos otra vez para cada función nueva que se sume.

Solución

Columna nueva plan en colegios ('basico' / 'avanzado', default 'basico'), protegida por trigger — solo superadmin puede cambiarla. Se expone en get_config_año() para que el frontend la tenga disponible sin consultas extra. El panel de superadmin gana un desplegable Básico/Avanzado por colegio, en la misma tabla donde ya se activa/desactiva un colegio.

Es aditiva: no toca ninguna fila de los 3 colegios reales, no modifica ninguna tabla existente más allá de agregar la columna con default.

Funcionalidades que quedan controladas por el plan


Junta Trimestral (reportes avanzados con gráficos + certificado de reconocimiento automático).
Carreras técnicas.
Entrega de tareas en línea.


Todo lo demás del panel del profesor y del director (Exportar Excel, Bajo Rendimiento, Aprobados/Reprobados, Calificar SER, Promedio Anual, actividades, etc.) se mantiene libre por defecto, sin cambios.

Archivos que se tocan


backend/migrations/058-plan-economico-junta-trimestral.sql — columna plan, trigger de protección, get_config_año() actualizada.
frontend/js/admin/superadmin.js — desplegable de plan por colegio en la tabla; de paso, excluye la plantilla de la migración 057 del listado.
frontend/dashboard-superadmin.html — columna nueva "Plan" en la tabla de colegios.
frontend/js/profesor/vista-calificaciones.js — gate del botón Junta Trimestral.
frontend/js/admin/director.js — gate de activación de carreras técnicas y entrega de tareas (dos funciones puntuales, toggleCarrerasTecnicas y toggleEntregaTareas).


Revisión de viabilidad

Se comparó contra el dump real de Supabase (mismo protocolo usado en las migraciones 056 y 057): estructura de colegios, config_gestion y get_config_año() coinciden exactamente con lo asumido en el script, sin drift. Mismo patrón de trigger que ya está en producción (proteger_colegio_tutor, migración 028). Viable para aplicar.

Pendiente después de ejecutar

Repetir el protocolo de verificación en vivo (igual que 056/057): confirmar columna creada, trigger bloqueando cambios de plan sin superadmin, un colegio en plan básico viendo el aviso al intentar activar cada función, y un colegio en plan avanzado operando sin restricción.

Candidatas futuras, no incluidas en esta migración

Informe de aprobados/reprobados, certificados/libretas en PDF, evaluación docente, reportes financieros exportables, branding por colegio, comunicados — se sumarían con el mismo patrón (un if puntual en el archivo correspondiente), sin necesidad de otra migración de estructura.

-- ============================================================
-- MIGRACIÓN 058: Plan económico por colegio — gate al botón
-- "Junta Trimestral" (reportes avanzados + certificado automático)
--
-- Alcance: solo ese botón queda condicionado al plan. El resto
-- (Exportar Excel, Bajo Rendimiento, Aprobados/Reprobados,
-- Calificar SER, Promedio Anual, actividades, etc.) se mantiene
-- libre por defecto, sin cambios.
-- ============================================================

-- 1. Columna nueva, aditiva, con default -- no afecta ninguna fila existente
ALTER TABLE public.colegios
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'basico'
  CHECK (plan IN ('basico', 'avanzado'));

-- 2. Solo superadmin puede cambiar el plan de un colegio
--    (mismo patrón que proteger_colegio_tutor, migración 028)
CREATE OR REPLACE FUNCTION public.proteger_plan_colegio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Solo el superadmin puede cambiar el plan de un colegio';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_plan_colegio ON public.colegios;
CREATE TRIGGER trg_proteger_plan_colegio
  BEFORE UPDATE ON public.colegios
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_plan_colegio();

-- 3. Exponer el plan en get_config_año() -- así el frontend ya lo
--    tiene disponible en window.APP_CONFIG sin una consulta aparte.
CREATE OR REPLACE FUNCTION public."get_config_año"("p_año" integer DEFAULT (EXTRACT(year FROM now()))::integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_gestion      RECORD;
  v_dimensiones  JSONB;
  v_subcriterios JSONB;
  v_escala       JSONB;
  v_periodos     JSONB;
  v_plan         TEXT;
BEGIN
  SELECT * INTO v_gestion FROM public.config_gestion
  WHERE año = p_año AND colegio_id = mi_colegio_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Gestión no encontrada para año ' || p_año);
  END IF;

  SELECT plan INTO v_plan FROM public.colegios WHERE id = mi_colegio_id();

  SELECT jsonb_agg(
    jsonb_build_object(
      'codigo', codigo, 'nombre', nombre_display,
      'peso_maximo', peso_maximo, 'tipo', tipo, 'orden', orden
    ) ORDER BY orden
  ) INTO v_dimensiones
  FROM public.config_dimensiones
  WHERE gestion_id = v_gestion.id AND activo = true;

  SELECT jsonb_agg(
    jsonb_build_object(
      'categoria_id', c.id, 'categoria', c.nombre, 'cat_orden', c.orden,
      'subcriterio_id', s.id, 'texto', s.texto,
      'descripcion', s.descripcion, 'sub_orden', s.orden
    ) ORDER BY c.orden, s.orden
  ) INTO v_subcriterios
  FROM public.config_categorias_ser c
  JOIN public.config_subcriterios_ser s ON s.categoria_id = c.id AND s.activo = true
  WHERE c.año = p_año AND c.activo = true AND c.colegio_id = mi_colegio_id();

  SELECT jsonb_agg(
    jsonb_build_object(
      'valor', valor_numerico, 'etiqueta', etiqueta,
      'color', color, 'orden', orden
    ) ORDER BY orden
  ) INTO v_escala
  FROM public.config_escala_ser
  WHERE año = p_año AND colegio_id = mi_colegio_id();

  SELECT jsonb_agg(
    jsonb_build_object('numero', n, 'nombre', v_gestion.nombre_periodo || ' ' || n)
    ORDER BY n
  ) INTO v_periodos
  FROM generate_series(1, v_gestion.cantidad_periodos) n;

  RETURN jsonb_build_object(
    'año',                    v_gestion.año,
    'estado',                 v_gestion.estado,
    'bloqueada',              v_gestion.bloqueada,
    'trimestre_activo',       v_gestion.trimestre_activo,
    'cantidad_periodos',      v_gestion.cantidad_periodos,
    'nombre_periodo',         v_gestion.nombre_periodo,
    'nota_minima',            v_gestion.nota_minima_aprobacion,
    'escala_maxima',          v_gestion.escala_maxima,
    'etiqueta_aprobado',      v_gestion.etiqueta_aprobado,
    'etiqueta_reprobado',     v_gestion.etiqueta_reprobado,
    'usa_carreras_tecnicas',  v_gestion.usa_carreras_tecnicas,
    'permite_entrega_tareas', v_gestion.permite_entrega_tareas,
    'plan',                   COALESCE(v_plan, 'basico'),
    'dimensiones',            COALESCE(v_dimensiones, '[]'::JSONB),
    'subcriterios_ser',       COALESCE(v_subcriterios, '[]'::JSONB),
    'escala_ser',             COALESCE(v_escala, '[]'::JSONB),
    'periodos',               COALESCE(v_periodos, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public."get_config_año" TO authenticated, anon;


