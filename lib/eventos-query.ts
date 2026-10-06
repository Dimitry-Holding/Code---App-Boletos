import type { SupabaseClient } from "@supabase/supabase-js";

/** O Supabase devolve no máximo 1000 linhas por consulta; lemos em páginas. */
const PAGINA = 1000;
const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;

function diaSeguinte(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Filtro de período no formato do PostgREST, com a mesma regra da tela: vale a
 * data do documento e, se a nota não tiver, a data em que foi lançada.
 * Devolve null quando não há período (traz tudo).
 */
export function filtroPeriodo(inicio: string, fim: string): string | null {
  const de = ISO_DIA.test(inicio) ? inicio : "";
  const ate = ISO_DIA.test(fim) ? fim : "";
  if (!de && !ate) return null;
  const comData: string[] = [];
  const semData = ["data_documento.is.null"];
  if (de) {
    comData.push(`data_documento.gte.${de}`);
    semData.push(`criado_em.gte.${de}`);
  }
  if (ate) {
    comData.push(`data_documento.lte.${ate}`);
    semData.push(`criado_em.lt.${diaSeguinte(ate)}`);
  }
  return `and(${comData.join(",")}),and(${semData.join(",")})`;
}

/**
 * Notas do período, mais novas primeiro, sem o teto de 1000 linhas.
 * Lança erro se a consulta falhar (quem chama decide o que mostrar).
 */
export async function buscarEventos<T>(
  supabase: SupabaseClient,
  opcoes: { inicio: string; fim: string; colunas?: string },
): Promise<T[]> {
  const filtro = filtroPeriodo(opcoes.inicio, opcoes.fim);
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    let consulta = supabase
      .from("eventos")
      .select(opcoes.colunas ?? "*")
      .order("id", { ascending: false })
      .range(de, de + PAGINA - 1);
    if (filtro) consulta = consulta.or(filtro);
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as T[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return linhas;
}
