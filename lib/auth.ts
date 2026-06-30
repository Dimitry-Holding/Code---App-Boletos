/**
 * Los usuarios inician sesión con un "usuario" corto (ej. "helio.silva"),
 * no con e-mail. Internamente lo convertimos a un e-mail para Supabase Auth.
 */
export const EMAIL_DOMAIN = "dimitry.com.br";

export function usuarioParaEmail(usuario: string): string {
  const u = usuario.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${EMAIL_DOMAIN}`;
}

/** Extrae el "usuario" corto a partir del e-mail (parte antes de la @). */
export function emailParaUsuario(email: string): string {
  return (email || "").split("@")[0];
}
