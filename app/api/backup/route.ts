import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Backup automático dos dados: gera um JSON com TODAS as tabelas e guarda no
 * bucket privado "backups" do Storage. Disparado semanalmente pelo cron da
 * Vercel (vercel.json) e também manualmente por um admin logado.
 * Mantém as últimas 12 cópias (~3 meses). As fotos não entram (ficam no
 * próprio Storage); o backup cobre os DADOS.
 */

const TABELAS = [
  "profiles",
  "cartoes",
  "categorias",
  "centros_custo",
  "supervisor_escopo",
  "eventos",
  "erros_app",
];
const MANTER_ULTIMOS = 12;

/** Lê a tabela inteira em páginas de 1000 (o supabase-js limita cada consulta). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lerTudo(admin: any, tabela: string): Promise<unknown[]> {
  const linhas: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin
      .from(tabela)
      .select("*")
      .range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

async function ehAdminLogado(): Promise<boolean> {
  try {
    const supa = await createClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) return false;
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    return data?.role === "admin";
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  // Autorizado: cron da Vercel (ou CRON_SECRET, se configurado) ou admin logado.
  // A resposta traz só um RESUMO (contagens) — nunca os dados em si.
  const auth = req.headers.get("authorization");
  const viaCron =
    req.headers.get("x-vercel-cron") !== null ||
    (!!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
  if (!viaCron && !(await ehAdminLogado())) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();

    const conteudo: Record<string, unknown> = {
      gerado_em: new Date().toISOString(),
      projeto: "app-boletos",
    };
    const resumo: Record<string, number> = {};
    for (const t of TABELAS) {
      const linhas = await lerTudo(admin, t);
      conteudo[t] = linhas;
      resumo[t] = linhas.length;
    }

    // bucket privado (criar é idempotente: erro de "já existe" é ignorado)
    await admin.storage
      .createBucket("backups", { public: false })
      .catch(() => undefined);

    const nome = `backup_${new Date().toISOString().slice(0, 10)}.json`;
    const corpo = JSON.stringify(conteudo);
    const up = await admin.storage
      .from("backups")
      .upload(nome, new Blob([corpo], { type: "application/json" }), {
        contentType: "application/json",
        upsert: true,
      });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    // retenção: mantém só os N mais recentes (nomes com data ordenam sozinhos)
    const lista = await admin.storage.from("backups").list("", { limit: 200 });
    const antigos = (lista.data ?? [])
      .map((f: { name: string }) => f.name)
      .filter((n: string) => n.startsWith("backup_"))
      .sort()
      .reverse()
      .slice(MANTER_ULTIMOS);
    if (antigos.length > 0) {
      await admin.storage.from("backups").remove(antigos);
    }

    return Response.json({
      ok: true,
      arquivo: nome,
      tamanho_kb: Math.round(corpo.length / 1024),
      registros: resumo,
      copias_apagadas: antigos.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    return Response.json({ error: `Backup falhou: ${msg}` }, { status: 500 });
  }
}
