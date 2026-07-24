# 💻 Trabajar en el proyecto desde otra PC

Todo el proyecto vive en la nube. Para dar soporte o hacer cambios desde cualquier
computadora, seguí esta guía.

---

## Qué necesitás (una sola vez)
- **Node.js 18 o superior** → https://nodejs.org (instalar la versión LTS).
- **Git** → https://git-scm.com (o **GitHub Desktop** si preferís interfaz).
- Acceso a la cuenta de **GitHub** de Dimitry (dueña del repo).
- Los valores de **`.env.local`** (secretos, NO están en GitHub — ver abajo).

---

## Opción A — Entorno completo (para desarrollo/soporte real)

1. **Clonar el código:**
   ```bash
   git clone https://github.com/Dimitry-Holding/Code---App-Boletos.git
   cd "Code---App-Boletos"
   ```
2. **Instalar dependencias:**
   ```bash
   npm install
   ```
3. **Crear `.env.local`** (copiá `.env.local.example` y completá los 5 valores):
   ```
   GEMINI_API_KEY=...              (aistudio.google.com/apikey, cuenta Dimitry)
   GEMINI_MODEL=gemini-flash-latest
   NEXT_PUBLIC_SUPABASE_URL=...    (Supabase → Settings → API)
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   Los de Supabase se copian del dashboard de Supabase; la de Gemini de AI Studio.
4. **Correr localmente:**
   ```bash
   npm run dev
   ```
   Abrí http://localhost:3000
5. **Publicar cambios:** editás el código, y luego:
   ```bash
   git add -A
   git commit -m "descripción del cambio"
   git push origin main
   ```
   **Vercel redespliega solo** al hacer push. La primera vez que hagas `git push`,
   se abre el navegador para iniciar sesión en GitHub (o usá GitHub Desktop).

---

## Opción B — Cambios rápidos sin instalar nada (desde el navegador)
- **Editar un archivo directo en GitHub:** abrís el archivo en github.com → ✏️ (editar) →
  Commit. Vercel redespliega solo. Sirve para ajustes chicos (textos, etc.), no para
  desarrollo serio.

## Soporte que NO necesita el código
- **Usuarios, tarjetas, categorías, centros:** desde la app, como admin → **👥 Usuários**.
- **Ver/corregir datos, fotos:** dashboard de **Supabase** (Table Editor / Storage).
- **Variables de entorno, redeploys:** dashboard de **Vercel**.

---

## Asistencia con IA (Claude Code)
Para seguir trabajando con ayuda de IA como hasta ahora: instalá **Claude Code** en la
otra PC, abrí la carpeta del proyecto y ejecutá `claude`. El contexto clave del proyecto
está en `docs/ENTREGA.md`.

---

## Importante: lo que NO está en GitHub (llevalo aparte, de forma segura)
- **`.env.local`** — las claves (Gemini + Supabase). Está en `.gitignore` a propósito.
- **`USUARIOS_Y_CONTRASENAS.txt`** — usuarios/contraseñas de la app.

Sin `.env.local`, la app corre pero no se conecta a la base de datos ni a la IA.
