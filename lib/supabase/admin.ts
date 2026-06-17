import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con privilegios de administrador (service_role).
 * SOLO usar en el servidor. Nunca exponer esta clave al navegador.
 * Se usa para tareas del admin como generar enlaces de descarga de fotos.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
