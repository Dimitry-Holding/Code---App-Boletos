# 📦 Documento de entrega — App Notas Fiscais (Dimitry)

Guía de traspaso para que la app siga funcionando y quede a nombre de Dimitry
(no de una cuenta personal). **Ninguna contraseña real va en este archivo** —
los valores secretos están en `.env.local` (local, fuera de Git) y en las
variables de entorno de Vercel.

---

## La app en 1 minuto
- **App web** (Next.js) para que el personal fotografíe notas fiscais; la IA extrae
  los datos; el admin baja reportes (Excel) y fotos.
- **4 servicios externos** (todos con su propia cuenta):

| Servicio | Para qué | Identificador | ¿Dónde puede estar atado a algo personal? |
|---|---|---|---|
| **Google Gemini** | IA que lee las notas | API key (nivel gratuito) | ⚠️ Hoy en cuenta **Google PERSONAL** |
| **Supabase** | Base de datos + fotos + logins | proyecto `rvrbogroafidhtuwfljo` | ⚠️ Verificar de quién es la cuenta |
| **Vercel** | Hosting (la URL pública) | org `dimitry-holding` | Login del usuario |
| **GitHub** | Código fuente | `Dimitry-Holding/Code---App-Boletos` | ✅ Organização da empresa |

---

## Variables de entorno que usa la app
(Se configuran en **Vercel → Project → Settings → Environment Variables**, y en
`.env.local` para desarrollo. Los valores están en `.env.local`.)

- `GEMINI_API_KEY` — clave de Google Gemini
- `GEMINI_MODEL` — `gemini-2.5-flash` (opcional)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (secreta — solo servidor)

---

## ✅ Checklist de traspaso (hacer ANTES de irte)

### 1. Google Gemini — sacarlo de tu cuenta personal
1. Entrá a **https://aistudio.google.com/apikey** con una cuenta **de Dimitry que vaya a
   seguir existiendo** (idealmente una cuenta de operaciones/compartida, no la que se
   desactive cuando te vayas).
2. **Create API key** (nivel gratuito, sin tarjeta). Copiá la nueva clave.
3. Reemplazá `GEMINI_API_KEY` en **Vercel** (Settings → Environment Variables) por la nueva →
   **Redeploy**.
4. Actualizá `GEMINI_API_KEY` también en tu `.env.local` local.
5. **Recién ahí**, volvé a https://aistudio.google.com/apikey con tu cuenta **personal** y
   **borrá la clave vieja** (así queda desconectada).

### 2. Supabase — que quede a nombre de Dimitry (CRÍTICO: aquí están todos los datos)
1. Entrá a **https://supabase.com/dashboard** con la cuenta dueña del proyecto.
2. Idealmente **transferí el proyecto a una organización de Dimitry** (o agregá como
   **Owner** a una cuenta de Dimitry): Project/Org Settings → Members / Transfer.
3. Pasá al sucesor: el acceso al proyecto y las 3 claves (URL, anon, service_role) que están
   en `.env.local`. La contraseña de la base (si se necesita) está en Supabase → Settings → Database.

### 3. Vercel — acceso de Dimitry
1. https://vercel.com → org **dimitry-holding** → el proyecto de la app.
2. **Settings → Members**: agregá a un administrador de Dimitry (que no seas vos).
   Si el proyecto está en tu cuenta personal, **transferílo** a la organización de Dimitry.
3. Confirmá que **Deployment Protection** esté como lo necesiten (para que el equipo entre).

### 4. GitHub — ✅ FEITO (2026-07-24)
- O repo foi **transferido** para a organização **`Dimitry-Holding`** no GitHub.
  Novo endereço: `https://github.com/Dimitry-Holding/Code---App-Boletos`.
- ⏳ **Pendente:** reconectar a **Vercel** ao repo no novo endereço (deploy automático).

### 5. Archivos locales para entregar al sucesor
Estos archivos están en tu equipo (carpeta del proyecto, dentro de tu OneDrive):
- **`.env.local`** — todas las claves (entregalo de forma segura, NO por chat/email común).
- **`USUARIOS_Y_CONTRASENAS.txt`** — usuarios y contraseñas de la app.
- **Mové/copiá toda la carpeta del proyecto** fuera de tu OneDrive personal a un lugar de Dimitry.

### 6. Cuentas de la app
- Login de **admin** de la app: `admin` / (ver `USUARIOS_Y_CONTRASENAS.txt`). **Cambiá la
  contraseña** y entregala al sucesor. Crear un admin real de Dimitry desde 👥 Usuários.

---

## Notas
- La app **no** depende de Google Workspace (la factura de Workspace es de otro tema).
- Migraciones de base de datos: `supabase/schema.sql`, `migration_2.sql`, `migration_3.sql`.
- Manuales de uso: `docs/MANUAL_USUARIO.pdf` y `docs/MANUAL_ADMINISTRADOR.pdf`.
