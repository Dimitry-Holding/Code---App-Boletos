import * as XLSX from "xlsx";
import { type Evento, codigoId, valorBRL } from "./evento";

/**
 * Exportação "Excel Nibo": tabula as notas no formato dos lançamentos que
 * serão criados no Nibo, para revisão humana ANTES do envio pela API
 * (script `nibo/lancar-nibo.bat`).
 *
 * Regras de composição de um lançamento (definidas pela administração):
 *   I   — 1 partida:   1 centro de custo, 1 categoria
 *   II  — 2+ partidas: 1 centro de custo, 2+ categorias
 *   III — 2+ partidas: 2+ centros de custo, 1 categoria
 * NUNCA pode haver 2+ centros de custo E 2+ categorias no mesmo lançamento.
 */

export type EventoNomeado = Evento & { conductor_nome?: string };

/** Uma linha (partida) da planilha de conferência. */
export type LinhaNibo = {
  ["Lançamento"]: string;
  ["Tipo"]: "I" | "II" | "III";
  ["Enviar"]: "SIM" | "NÃO";
  ["Fornecedor"]: string;
  ["CNPJ/CPF"]: string;
  ["Data"]: string;
  ["Valor (R$)"]: number;
  ["Categoria (app)"]: string;
  ["Categoria (Nibo)"]: string;
  ["Centro de custo (app)"]: string;
  ["Centro de custo (Nibo)"]: string;
  ["Descrição"]: string;
  ["Nota"]: string;
  ["Usuário"]: string;
  ["Cartão"]: string;
};

export const COLUNAS_NIBO: (keyof LinhaNibo)[] = [
  "Lançamento", "Tipo", "Enviar", "Fornecedor", "CNPJ/CPF", "Data",
  "Valor (R$)", "Categoria (app)", "Categoria (Nibo)",
  "Centro de custo (app)", "Centro de custo (Nibo)",
  "Descrição", "Nota", "Usuário", "Cartão",
];

/** Notas do mesmo fornecedor, mesma data e mesmo cartão viram um lançamento. */
function chaveGrupo(e: Evento): string {
  return [
    (e.fornecedor ?? "").trim().toUpperCase(),
    e.data_documento ?? "",
    e.ultimos4 ?? "",
  ].join("|");
}

function tipoLancamento(grupo: Evento[]): "I" | "II" | "III" {
  if (grupo.length === 1) return "I";
  const centros = new Set(grupo.map((e) => e.centro_custo ?? ""));
  return centros.size === 1 ? "II" : "III";
}

/**
 * Propõe o agrupamento das notas em lançamentos válidos.
 * Grupos que violariam a regra de ouro (2+ centros E 2+ categorias) são
 * subdivididos por centro de custo, para que cada lançamento seja válido.
 */
export function proporLancamentos(eventos: EventoNomeado[]): LinhaNibo[] {
  const grupos = new Map<string, EventoNomeado[]>();
  for (const e of eventos) {
    const k = chaveGrupo(e);
    const g = grupos.get(k);
    if (g) g.push(e);
    else grupos.set(k, [e]);
  }

  const lancamentos: EventoNomeado[][] = [];
  for (const grupo of grupos.values()) {
    const centros = new Set(grupo.map((e) => e.centro_custo ?? ""));
    const categorias = new Set(grupo.map((e) => e.categoria ?? ""));
    if (centros.size > 1 && categorias.size > 1) {
      const porCentro = new Map<string, EventoNomeado[]>();
      for (const e of grupo) {
        const c = e.centro_custo ?? "";
        const sub = porCentro.get(c);
        if (sub) sub.push(e);
        else porCentro.set(c, [e]);
      }
      lancamentos.push(...porCentro.values());
    } else {
      lancamentos.push(grupo);
    }
  }

  lancamentos.sort((a, b) => {
    const da = a[0].data_documento ?? "";
    const db = b[0].data_documento ?? "";
    if (da !== db) return da < db ? -1 : 1;
    const fa = (a[0].fornecedor ?? "").toUpperCase();
    const fb = (b[0].fornecedor ?? "").toUpperCase();
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });

  const linhas: LinhaNibo[] = [];
  lancamentos.forEach((grupo, i) => {
    const num = "L" + String(i + 1).padStart(3, "0");
    const tipo = tipoLancamento(grupo);
    for (const e of grupo) {
      linhas.push({
        ["Lançamento"]: num,
        ["Tipo"]: tipo,
        ["Enviar"]: "SIM",
        ["Fornecedor"]: e.fornecedor ?? "",
        ["CNPJ/CPF"]: "",
        ["Data"]: e.data_documento ?? "",
        ["Valor (R$)"]: Math.round(valorBRL(e) * 100) / 100,
        ["Categoria (app)"]: e.categoria ?? "",
        ["Categoria (Nibo)"]: e.categoria ?? "",
        ["Centro de custo (app)"]: e.centro_custo ?? "",
        ["Centro de custo (Nibo)"]: e.centro_custo ?? "",
        ["Descrição"]: e.descricao ?? "",
        ["Nota"]: codigoId(e.id),
        ["Usuário"]: e.conductor_nome ?? "",
        ["Cartão"]: e.ultimos4 ?? "",
      });
    }
  });
  return linhas;
}

const INSTRUCOES: string[][] = [
  ["COMO REVISAR ESTA PLANILHA (antes de lançar no Nibo)"],
  [""],
  ["1. Cada linha da aba 'Lancamentos' é uma PARTIDA. Linhas com o mesmo código na"],
  ["   coluna 'Lançamento' (ex.: L001) serão enviadas juntas como UM lançamento no Nibo."],
  ["2. O agrupamento é uma PROPOSTA (notas do mesmo fornecedor, data e cartão)."],
  ["   Pode ajustar: mude o código da coluna 'Lançamento' para juntar ou separar linhas."],
  ["3. Colunas 'Categoria (Nibo)' e 'Centro de custo (Nibo)': escreva o nome EXATO"],
  ["   como está cadastrado no Nibo (os nomes do app podem ser diferentes)."],
  ["   As colunas '(app)' são só referência — não são enviadas."],
  ["4. 'Enviar': deixe SIM para lançar; mude para NÃO para pular a linha."],
  ["5. 'CNPJ/CPF' (opcional): se preenchido, é usado ao criar o fornecedor no Nibo."],
  ["   Somente números (14 dígitos = CNPJ, 11 = CPF)."],
  ["6. 'Data' no formato AAAA-MM-DD. 'Valor (R$)' sempre em reais."],
  [""],
  ["REGRAS DE UM LANÇAMENTO (o script recusa o que violar):"],
  ["  Tipo I   — 1 partida:   1 centro de custo e 1 categoria"],
  ["  Tipo II  — 2+ partidas: 1 centro de custo e 2+ categorias"],
  ["  Tipo III — 2+ partidas: 2+ centros de custo e 1 categoria"],
  ["  PROIBIDO: 2+ centros de custo E 2+ categorias no mesmo lançamento."],
  ["  Todas as partidas de um lançamento devem ter o mesmo fornecedor e a mesma data."],
  [""],
  ["DEPOIS DE REVISAR:"],
  ["  Salve o arquivo e execute nibo\\lancar-nibo.bat (na pasta do projeto)."],
  ["  O script primeiro CONFERE tudo (sem enviar nada) e mostra o que faria."],
  ["  O envio real só acontece no modo 'ENVIAR', com confirmação digitada."],
];

/** Monta o arquivo Excel de conferência (abas Lancamentos + Instrucoes). */
export function gerarWorkbookNibo(eventos: EventoNomeado[]): XLSX.WorkBook {
  const linhas = proporLancamentos(eventos);
  const ws = XLSX.utils.json_to_sheet(linhas, { header: COLUNAS_NIBO as string[] });
  ws["!cols"] = COLUNAS_NIBO.map((c) => ({
    wch: Math.max(
      c.length + 2,
      c === "Fornecedor" || c === "Descrição" ? 32 : 12,
    ),
  }));
  const wsInstr = XLSX.utils.aoa_to_sheet(INSTRUCOES);
  wsInstr["!cols"] = [{ wch: 95 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lancamentos");
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instrucoes");
  return wb;
}
