import { createAdminClient } from "./supabase/admin";

/**
 * Registra um erro na tabela `erros_app` (painel "🩺 Erros" do admin).
 * Nunca lança: o monitoramento jamais pode quebrar o fluxo que está monitorando.
 * Se a tabela ainda não existir (migração 6 não aplicada), falha em silêncio.
 */
export async function registrarErro(
  origem: string,
  mensagem: string,
  detalhe?: string | null,
  userId?: string | null,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("erros_app").insert({
      origem: origem.slice(0, 30),
      mensagem: (mensagem || "erro desconhecido").slice(0, 500),
      detalhe: detalhe ? detalhe.slice(0, 2000) : null,
      user_id: userId ?? null,
    });
  } catch {
    /* sem registro — segue a vida */
  }
}
