import { createClient } from "@/lib/supabase/server";
import { registrarErro } from "@/lib/log-erro";

export const runtime = "nodejs";

/**
 * Recebe erros do lado do cliente (celular dos usuários) e os grava no
 * monitoramento. Exige login; a escrita em si usa o service role no servidor.
 */
export async function POST(req: Request) {
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  let corpo: { origem?: string; mensagem?: string; detalhe?: string };
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ error: "Corpo inválido." }, { status: 400 });
  }
  if (!corpo.mensagem || typeof corpo.mensagem !== "string") {
    return Response.json({ ok: true });
  }

  await registrarErro(
    typeof corpo.origem === "string" && corpo.origem ? corpo.origem : "app",
    corpo.mensagem,
    typeof corpo.detalhe === "string" ? corpo.detalhe : null,
    user.id,
  );
  return Response.json({ ok: true });
}
