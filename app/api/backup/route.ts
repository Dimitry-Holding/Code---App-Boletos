import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Backup automático dos dados: gera um JSON com TODAS as tabelas e guarda no
 * bucket privado "backups" do Storage. Disparado semanalmente pelo cron da
 * Vercel (vercel.json) e também manualmente por um admin logado.
 * O cron da Vercel é "melhor esforço": uma execução pode falhar sem aviso,
 * então vale conferir de vez em quando se o arquivo da semana existe.
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
  // Quem pode disparar:
  //  - o agendador da Vercel: com CRON_SECRET definido, ele manda
  //    "Authorization: Bearer <segredo>" e só isso é aceito; sem o segredo,
  //    vale o cabeçalho x-vercel-cron-schedule que toda chamada de cron traz;
  //  - um admin logado (disparo manual pelo navegador).
  const segredo = process.env.CRON_SECRET;
  const viaCron = segredo
    ? req.headers.get("authorization") === `Bearer ${segredo}`
    : req.headers.get("x-vercel-cron-schedule") !== null;
  const viaAdmin = !viaCron && (await ehAdminLogado());
  if (!viaCron && !viaAdmin) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const nome = `backup_${new Date().toISOString().slice(0, 10)}.json`;

    // O cabeçalho do cron pode ser forjado por quem conhece a URL. Por isso a
    // chamada automática faz no máximo UM backup por dia e nunca devolve
    // contagens; o resumo completo é só para o admin logado.
    if (!viaAdmin) {
      const hoje = await admin.storage
        .from("backups")
        .list("", { limit: 1, search: nome });
      if ((hoje.data ?? []).some((f: { name: string }) => f.name === nome)) {
        return Response.json({ ok: true });
      }
    }

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

    if (!viaAdmin) return Response.json({ ok: true });
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
