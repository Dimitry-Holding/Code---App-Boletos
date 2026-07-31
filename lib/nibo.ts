import * as XLSX from "xlsx";
import { type Evento, type Cartao, codigoId, valorBRL } from "./evento";
import CATEGORIAS_NIBO from "../nibo/categorias-nibo.json";

/**
 * Exportação "Excel Nibo": tabula as notas no formato dos lançamentos que
 * serão criados no Nibo, para revisão humana ANTES do envio pela API
 * (script `nibo/lancar-nibo.bat`).
 *
 * - Cada nota é UM lançamento (únicos; a pessoa pode juntar linhas editando
 *   a coluna "Lançamento", respeitando as regras I/II/III do script).
 * - O "fornecedor" do lançamento no Nibo é o CARTÃO em que o gasto foi feito.
 * - "Vencimento" = data de vencimento da fatura do cartão no mês da compra;
 *   compra depois do dia de vencimento cai na fatura do mês seguinte.
 * - "Categoria (Nibo)" só vem preenchida quando o nome do app casa com uma
 *   categoria EXISTENTE no Nibo (lista em `nibo/categorias-nibo.json`);
 *   caso contrário fica vazia para a pessoa escolher na aba CategoriasNibo.
 */

export type EventoNomeado = Evento & { conductor_nome?: string };

export type LinhaNibo = {
  ["Lançamento"]: string;
  ["Enviar"]: "SIM" | "NÃO";
  ["Cartão"]: string;
  ["Data"]: string;
  ["Vencimento"]: string;
  ["Valor (R$)"]: number;
  ["Categoria (app)"]: string;
  ["Categoria (Nibo)"]: string;
  ["Centro de custo (app)"]: string;
  ["Centro de custo (Nibo)"]: string;
  ["Descrição"]: string;
  ["Nota"]: string;
  ["Usuário"]: string;
};

export const COLUNAS_NIBO: (keyof LinhaNibo)[] = [
  "Lançamento", "Enviar", "Cartão", "Data", "Vencimento", "Valor (R$)",
  "Categoria (app)", "Categoria (Nibo)",
  "Centro de custo (app)", "Centro de custo (Nibo)",
  "Descrição", "Nota", "Usuário",
];

/** Normaliza para comparação: sem acentos, minúsculas, espaços simples. */
export function normalizarNome(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nomes do app que diferem dos do Nibo (além de acento/caixa). */
const APELIDOS_CATEGORIA: Record<string, string> = {
  "servico de trasporte": "Servico de Transporte",
  "despesa com alimentacao": "Despesa com Alimentacao",
  "doacao, presente e cortesia": "Doacao, Brinde e Cortesia",
  // decisão da administração: IOF entra no Nibo como Tarifas Bancarias
  iof: "Tarifas Bancarias",
};

const CATALOGO_NIBO = new Map(
  (CATEGORIAS_NIBO as string[]).map((n) => [normalizarNome(n), n]),
);

/** Categoria do Nibo correspondente ao nome do app ("" se não existir). */
export function categoriaNibo(categoriaApp: string): string {
  const chave = normalizarNome(categoriaApp);
  if (!chave) return "";
  const apelido = APELIDOS_CATEGORIA[chave];
  if (apelido) return CATALOGO_NIBO.get(normalizarNome(apelido)) ?? apelido;
  return CATALOGO_NIBO.get(chave) ?? "";
}

/** Último dia do mês (mes 1-12). */
function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

/**
 * Vencimento da fatura para uma compra: o dia de vencimento do cartão no mês
 * da compra; se a compra foi DEPOIS do dia de vencimento, vai para o mês
 * seguinte. Ex.: vencimento dia 15, compra 16/03 → 15/04.
 */
export function vencimentoFatura(dataCompra: string, diaVencimento: number): string {
  const m = dataCompra.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !diaVencimento) return "";
  let ano = Number(m[1]);
  let mes = Number(m[2]);
  const dia = Number(m[3]);
  if (dia > diaVencimento) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  const diaFinal = Math.min(diaVencimento, ultimoDiaDoMes(ano, mes));
  return `${ano}-${String(mes).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
}

/** Nome do cartão para o Nibo (ex.: "Santander 5765"). */
export function nomeCartaoNibo(c: Pick<Cartao, "apelido" | "ultimos4">): string {
  return `${(c.apelido ?? "").trim()} ${c.ultimos4}`.trim() || `Cartao ${c.ultimos4}`;
}

/** Monta as linhas da planilha: uma nota = um lançamento (únicos). */
export function montarLinhasNibo(
  eventos: EventoNomeado[],
  cartoes: Cartao[],
): LinhaNibo[] {
  // cartão por usuário+últimos4 (com reserva por últimos4 apenas)
  const porUsuarioEDigitos = new Map<string, Cartao>();
  const porDigitos = new Map<string, Cartao>();
  for (const c of cartoes) {
    porUsuarioEDigitos.set(`${c.user_id}|${c.ultimos4}`, c);
    if (!porDigitos.has(c.ultimos4)) porDigitos.set(c.ultimos4, c);
  }

  const ordenados = [...eventos].sort((a, b) => {
    const da = a.data_documento ?? "";
    const db = b.data_documento ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  });

  // possíveis duplicatas (mesmo usuário, fornecedor, data, valor e cartão):
  // a primeira fica SIM; as demais saem com Enviar = NÃO e um aviso.
  const vistos = new Map<string, EventoNomeado>();
  const duplicataDe = new Map<number, number>();
  for (const e of ordenados) {
    const chave = [
      e.conductor_id,
      normalizarNome(e.fornecedor ?? ""),
      e.data_documento ?? "",
      Math.round(valorBRL(e) * 100),
      e.ultimos4 ?? "",
    ].join("|");
    const primeiro = vistos.get(chave);
    if (primeiro && normalizarNome(e.fornecedor ?? "") !== "") {
      duplicataDe.set(e.id, primeiro.id);
    } else {
      vistos.set(chave, e);
    }
  }

  // Centro de custo NUNCA sai vazio. Ordem de resolução para nota sem centro:
  // 1) herda da nota que compartilha a MESMA FOTO (linha de IOF ↔ compra original);
  // 2) centro mais usado pelo usuário na mesma categoria;
  // 3) centro mais usado pelo usuário no geral.
  // Nos casos 2 e 3 é uma SUGESTÃO: a linha ganha aviso para o revisor conferir.
  const centroPorFoto = new Map<string, string>();
  const usoPorUserCat = new Map<string, Map<string, number>>();
  const usoPorUser = new Map<string, Map<string, number>>();
  const contar = (m: Map<string, Map<string, number>>, k: string, centro: string) => {
    const sub = m.get(k) ?? new Map<string, number>();
    sub.set(centro, (sub.get(centro) ?? 0) + 1);
    m.set(k, sub);
  };
  for (const e of eventos) {
    if (!e.centro_custo) continue;
    if (e.foto_path && !centroPorFoto.has(e.foto_path))
      centroPorFoto.set(e.foto_path, e.centro_custo);
    contar(usoPorUserCat, `${e.conductor_id}|${normalizarNome(e.categoria ?? "")}`, e.centro_custo);
    contar(usoPorUser, e.conductor_id, e.centro_custo);
  }
  const maisUsado = (m?: Map<string, number>): string => {
    let melhor = "";
    let max = 0;
    for (const [centro, n] of m ?? []) if (n > max) { max = n; melhor = centro; }
    return melhor;
  };
  const resolverCentro = (e: EventoNomeado): { centro: string; sugerido: boolean } => {
    if (e.centro_custo) return { centro: e.centro_custo, sugerido: false };
    const daFoto = e.foto_path ? centroPorFoto.get(e.foto_path) : undefined;
    if (daFoto) return { centro: daFoto, sugerido: false };
    const porCategoria = maisUsado(
      usoPorUserCat.get(`${e.conductor_id}|${normalizarNome(e.categoria ?? "")}`),
    );
    const escolhido = porCategoria || maisUsado(usoPorUser.get(e.conductor_id));
    return { centro: escolhido, sugerido: escolhido !== "" };
  };

  return ordenados.map((e, i) => {
    const original = duplicataDe.get(e.id);
    const cartao =
      porUsuarioEDigitos.get(`${e.conductor_id}|${e.ultimos4 ?? ""}`) ??
      porDigitos.get(e.ultimos4 ?? "");
    const diaVenc = cartao?.dia_vencimento ?? 0;
    const { centro, sugerido } = resolverCentro(e);
    const avisos =
      (original ? `[POSSÍVEL DUPLICATA de ${codigoId(original)} — conferir] ` : "") +
      (sugerido ? `[CENTRO SUGERIDO "${centro}" — conferir] ` : "");
    const descricao =
      avisos + [e.fornecedor, e.descricao].filter(Boolean).join(" — ");
    return {
      ["Lançamento"]: "L" + String(i + 1).padStart(3, "0"),
      ["Enviar"]: original ? "NÃO" : "SIM",
      ["Cartão"]: cartao
        ? nomeCartaoNibo(cartao)
        : e.ultimos4
          ? `Cartao ${e.ultimos4}`
          : "",
      ["Data"]: e.data_documento ?? "",
      ["Vencimento"]: e.data_documento
        ? vencimentoFatura(e.data_documento, diaVenc)
        : "",
      ["Valor (R$)"]: Math.round(valorBRL(e) * 100) / 100,
      ["Categoria (app)"]: e.categoria ?? "",
      ["Categoria (Nibo)"]: categoriaNibo(e.categoria ?? ""),
      ["Centro de custo (app)"]: e.centro_custo ?? "",
      ["Centro de custo (Nibo)"]: centro,
      ["Descrição"]: descricao,
      ["Nota"]: codigoId(e.id),
      ["Usuário"]: e.conductor_nome ?? "",
    };
  });
}

const INSTRUCOES: string[][] = [
  ["COMO REVISAR ESTA PLANILHA (antes de lançar no Nibo)"],
  [""],
  ["1. Cada linha é UM lançamento (únicos). No Nibo, o 'fornecedor' do lançamento"],
  ["   é o CARTÃO em que o gasto foi feito (coluna 'Cartão')."],
  ["2. 'Vencimento' é a data da fatura do cartão em que a compra cai (compra depois"],
  ["   do dia de vencimento vai para o mês seguinte). Se estiver vazia, o cartão está"],
  ["   sem dia de vencimento cadastrado no app (tela 👥 Usuários) — preencha aqui ou lá."],
  ["   No Nibo: data de vencimento/agendamento = 'Vencimento'; competência = 'Data'."],
  ["3. 'Categoria (Nibo)': só aceita categorias que EXISTEM no Nibo — a lista completa"],
  ["   está na aba 'CategoriasNibo'. Quando vier vazia, é porque o nome do app não"],
  ["   casou com nenhuma: escolha a categoria certa na lista e copie aqui."],
  ["4. 'Centro de custo (Nibo)': escreva o nome exato como está no Nibo. Nunca sai"],
  ["   vazio: nota sem centro herda o da compra da mesma foto (caso do IOF) ou recebe"],
  ["   o centro mais usado pelo usuário, com aviso [CENTRO SUGERIDO] para conferir."],
  ["   IOF entra no Nibo com a categoria 'Tarifas Bancarias' (decisão da administração)."],
  ["5. 'Enviar': deixe SIM para lançar; mude para NÃO para pular a linha."],
  ["   Possíveis DUPLICATAS (mesmo fornecedor, data, valor e cartão) já saem com"],
  ["   Enviar = NÃO e aviso na descrição — confira e mude para SIM se não for duplicata."],
  ["6. Confira as datas! Notas com data errada (ex.: ano de 2018 lido errado pela IA)"],
  ["   devem ser corrigidas aqui — o script recusa datas fora do intervalo plausível."],
  [""],
  ["JUNTAR LINHAS NUM LANÇAMENTO SÓ (opcional): repita o mesmo código na coluna"],
  ["'Lançamento'. Regras que o script exige num lançamento com várias partidas:"],
  ["  mesmo cartão, mesma data e mesmo vencimento em todas as linhas;"],
  ["  ou 1 centro de custo com 2+ categorias, ou 2+ centros com 1 categoria;"],
  ["  PROIBIDO: 2+ centros de custo E 2+ categorias no mesmo lançamento."],
  [""],
  ["DEPOIS DE REVISAR: salve e execute nibo\\lancar-nibo.bat (CONFERIR antes de ENVIAR)."],
];

/** Monta o arquivo Excel de conferência. */
export function gerarWorkbookNibo(
  eventos: EventoNomeado[],
  cartoes: Cartao[],
): XLSX.WorkBook {
  const linhas = montarLinhasNibo(eventos, cartoes);
  const ws = XLSX.utils.json_to_sheet(linhas, { header: COLUNAS_NIBO as string[] });
  ws["!cols"] = COLUNAS_NIBO.map((c) => ({
    wch: Math.max(c.length + 2, c === "Descrição" ? 40 : c === "Cartão" ? 18 : 12),
  }));

  const wsInstr = XLSX.utils.aoa_to_sheet(INSTRUCOES);
  wsInstr["!cols"] = [{ wch: 95 }];

  const wsCats = XLSX.utils.aoa_to_sheet([
    ["Categorias existentes no Nibo (copie o nome exato para a coluna 'Categoria (Nibo)')"],
    ...(CATEGORIAS_NIBO as string[]).map((n) => [n]),
  ]);
  wsCats["!cols"] = [{ wch: 55 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lancamentos");
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instrucoes");
  XLSX.utils.book_append_sheet(wb, wsCats, "CategoriasNibo");
  return wb;
}
