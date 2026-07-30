/**
 * Lança no Nibo os lançamentos revisados do Excel gerado pelo app
 * (botão "🧾 Excel Nibo" na tela do administrador).
 *
 * Executado pelo usuário via `lancar-nibo.bat` (que define o token).
 * Modos:
 *   (padrão)  CONFERIR — só valida o Excel e mostra o que seria enviado. Não toca no Nibo.
 *   --teste   TESTE    — valida o token criando um fornecedor e um lançamento de R$ 0,01
 *                        no Nibo e APAGANDO os dois em seguida. Não usa o Excel.
 *   --enviar  ENVIAR   — cria os lançamentos de verdade (pede confirmação digitada).
 *
 * Regras de um lançamento (recusa o que violar):
 *   I   — 1 partida:   1 centro de custo, 1 categoria
 *   II  — 2+ partidas: 1 centro de custo, 2+ categorias
 *   III — 2+ partidas: 2+ centros de custo, 1 categoria
 *   PROIBIDO: 2+ centros de custo E 2+ categorias no mesmo lançamento.
 */

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
// categorias EXISTENTES no Nibo (mesma lista usada pelo app na aba CategoriasNibo)
let CATEGORIAS_NIBO = [];
try {
  CATEGORIAS_NIBO = require("./categorias-nibo.json");
} catch {
  /* sem a lista, a conferência offline de categorias é pulada */
}

const BASE = "https://api.nibo.com.br/empresas/v1";
const TOKEN = (process.env.NIBO_APITOKEN || "").trim();

// intervalo plausível para a DATA da compra (pega erros de leitura da IA, ex. ano 2018)
const DATA_MINIMA = "2025-01-01";

// ---------- utilidades ----------

function normalizar(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseValor(v) {
  if (typeof v === "number") return Math.round(v * 100) / 100;
  const s = String(v ?? "").replace(/\s|R\$/g, "");
  if (!s) return NaN;
  // aceita "1.234,56" e "1234.56"
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Math.round(n * 100) / 100;
}

function parseData(v) {
  if (v instanceof Date && !isNaN(v)) {
    const off = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return off.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // número de série de data do Excel
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

const log = [];
function out(linha = "") {
  console.log(linha);
  log.push(linha);
}

function perguntar(pergunta) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(pergunta, (resp) => {
      rl.close();
      res(resp.trim());
    }),
  );
}

// ---------- chamadas à API do Nibo ----------

async function nibo(metodo, caminho, corpo) {
  const url = `${BASE}${caminho}`;
  const r = await fetch(url, {
    method: metodo,
    headers: {
      ApiToken: TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* resposta não-JSON */
  }
  if (!r.ok) {
    const msg = json?.error_description || json?.message || json?.error || texto || r.statusText;
    throw new Error(`${metodo} ${caminho} → HTTP ${r.status}: ${String(msg).slice(0, 300)}`);
  }
  return json;
}

/** Lista paginada; aceita os formatos de resposta {items}, {value} ou array. */
async function listarTudo(caminho) {
  const itens = [];
  for (let skip = 0; ; skip += 500) {
    const sep = caminho.includes("?") ? "&" : "?";
    const data = await nibo("GET", `${caminho}${sep}$top=500&$skip=${skip}`);
    const pagina = Array.isArray(data) ? data : (data?.items ?? data?.value ?? []);
    itens.push(...pagina);
    if (pagina.length < 500) break;
  }
  return itens;
}

const idCategoria = (c) => c?.id ?? c?.categoryId ?? c?.Id;
const nomeCategoria = (c) => c?.name ?? c?.nome ?? c?.description ?? "";
const idCentro = (c) => c?.costCenterId ?? c?.id ?? c?.Id;
const nomeCentro = (c) => c?.description ?? c?.name ?? c?.nome ?? "";
const idFornecedor = (f) => f?.id ?? f?.stakeholderId ?? f?.Id;
const nomeFornecedor = (f) => f?.name ?? f?.nome ?? "";

/** O caminho de centros de custo varia na doc; tenta os dois. */
let caminhoCentros = "/costcenters";
async function listarCentros() {
  try {
    return await listarTudo(caminhoCentros);
  } catch {
    caminhoCentros = "/cost-center";
    return await listarTudo(caminhoCentros);
  }
}

// ---------- leitura e validação do Excel ----------

function lerLancamentos(arquivo) {
  const wb = XLSX.readFile(arquivo, { cellDates: true });
  const ws = wb.Sheets["Lancamentos"];
  if (!ws) throw new Error(`A aba "Lancamentos" não existe em ${arquivo}`);
  const linhas = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const catalogo = new Set(CATEGORIAS_NIBO.map((c) => normalizar(c)));

  const erros = [];
  const grupos = new Map();
  linhas.forEach((l, i) => {
    const n = i + 2; // linha no Excel (1 = cabeçalho)
    const enviar = normalizar(l["Enviar"]);
    if (enviar !== "sim") return; // NÃO / vazio = pular
    const partida = {
      linha: n,
      lancamento: String(l["Lançamento"] ?? l["Lancamento"] ?? "").trim(),
      cartao: String(l["Cartão"] ?? l["Cartao"] ?? "").trim(),
      data: parseData(l["Data"]),
      vencimento: parseData(l["Vencimento"]),
      valor: parseValor(l["Valor (R$)"]),
      categoria: String(l["Categoria (Nibo)"] ?? "").trim(),
      centro: String(l["Centro de custo (Nibo)"] ?? "").trim(),
      descricao: String(l["Descrição"] ?? l["Descricao"] ?? "").trim(),
      nota: String(l["Nota"] ?? "").trim(),
    };
    if (!partida.lancamento) erros.push(`Linha ${n}: coluna "Lançamento" vazia.`);
    if (!partida.cartao) erros.push(`Linha ${n}: "Cartão" vazio (é o fornecedor do lançamento no Nibo).`);
    if (!partida.data) erros.push(`Linha ${n}: "Data" vazia ou inválida (use AAAA-MM-DD).`);
    else if (partida.data < DATA_MINIMA || partida.data > hoje)
      erros.push(
        `Linha ${n}: "Data" ${partida.data} fora do intervalo plausível (${DATA_MINIMA} até hoje). ` +
          `Confira a data da nota${partida.nota ? ` ${partida.nota}` : ""} e corrija.`,
      );
    if (!partida.vencimento)
      erros.push(`Linha ${n}: "Vencimento" vazio ou inválido — cadastre o dia de vencimento do cartão no app ou preencha aqui.`);
    else if (partida.data && partida.vencimento < partida.data)
      erros.push(`Linha ${n}: "Vencimento" (${partida.vencimento}) anterior à "Data" da compra (${partida.data}).`);
    if (!(partida.valor > 0)) erros.push(`Linha ${n}: "Valor (R$)" inválido.`);
    if (!partida.categoria) erros.push(`Linha ${n}: "Categoria (Nibo)" vazia — escolha uma da aba CategoriasNibo.`);
    else if (catalogo.size && !catalogo.has(normalizar(partida.categoria)))
      erros.push(`Linha ${n}: categoria "${partida.categoria}" NÃO existe no Nibo — use um nome da aba CategoriasNibo.`);
    if (!partida.centro) erros.push(`Linha ${n}: "Centro de custo (Nibo)" vazio.`);
    const g = grupos.get(partida.lancamento);
    if (g) g.push(partida);
    else grupos.set(partida.lancamento, [partida]);
  });

  // regras por lançamento
  const lancamentos = [];
  for (const [codigo, partidas] of grupos) {
    const cats = new Set(partidas.map((p) => normalizar(p.categoria)));
    const centros = new Set(partidas.map((p) => normalizar(p.centro)));
    const cartoes = new Set(partidas.map((p) => normalizar(p.cartao)));
    const datas = new Set(partidas.map((p) => p.data));
    const vencimentos = new Set(partidas.map((p) => p.vencimento));
    if (cats.size > 1 && centros.size > 1)
      erros.push(
        `Lançamento ${codigo}: PROIBIDO — tem ${centros.size} centros de custo E ${cats.size} categorias. ` +
          `Separe em lançamentos diferentes (ou fixe 1 centro, ou fixe 1 categoria).`,
      );
    if (cartoes.size > 1)
      erros.push(`Lançamento ${codigo}: partidas com cartões diferentes — devem ser o mesmo.`);
    if (datas.size > 1)
      erros.push(`Lançamento ${codigo}: partidas com datas diferentes — devem ser a mesma.`);
    if (vencimentos.size > 1)
      erros.push(`Lançamento ${codigo}: partidas com vencimentos diferentes — devem ser o mesmo.`);
    const tipo = partidas.length === 1 ? "I" : centros.size === 1 ? "II" : "III";
    const total = Math.round(partidas.reduce((s, p) => s + p.valor, 0) * 100) / 100;
    lancamentos.push({ codigo, tipo, partidas, total });
  }
  lancamentos.sort((a, b) => (a.codigo < b.codigo ? -1 : 1));
  return { lancamentos, erros, totalLinhas: linhas.length };
}

function imprimirResumo(lancamentos) {
  for (const l of lancamentos) {
    const p0 = l.partidas[0];
    out(
      `  ${l.codigo} [tipo ${l.tipo}] ${p0.cartao} — compra ${p0.data}, venc. ${p0.vencimento} — ` +
        `R$ ${l.total.toFixed(2).replace(".", ",")} — ${l.partidas.length} partida(s)`,
    );
    for (const p of l.partidas)
      out(
        `      • R$ ${p.valor.toFixed(2).replace(".", ",")} — ${p.categoria} / ${p.centro}` +
          (p.nota ? ` (${p.nota})` : ""),
      );
  }
}

// ---------- montagem do payload ----------

function referenciaDe(l) {
  const nota = l.partidas.find((p) => p.nota)?.nota;
  return nota ? `APPBOLETOS-${nota}` : `APPBOLETOS-${l.codigo}-${l.partidas[0].data}`;
}

function montarPayload(l, stakeholderId, mapaCategorias, mapaCentros) {
  const porCategoria = new Map();
  for (const p of l.partidas) {
    const id = mapaCategorias.get(normalizar(p.categoria));
    porCategoria.set(id, Math.round(((porCategoria.get(id) ?? 0) + p.valor) * 100) / 100);
  }
  const porCentro = new Map();
  for (const p of l.partidas) {
    const id = mapaCentros.get(normalizar(p.centro));
    porCentro.set(id, Math.round(((porCentro.get(id) ?? 0) + p.valor) * 100) / 100);
  }
  const p0 = l.partidas[0];
  const notas = l.partidas.map((p) => p.nota).filter(Boolean).join(", ");
  const descricao =
    (p0.descricao || `Compra no cartão ${p0.cartao}`) +
    (notas ? ` [notas: ${notas}]` : "") +
    " (app boletos)";
  return {
    stakeholderId,
    description: descricao.slice(0, 500),
    reference: referenciaDe(l),
    // vencimento da fatura = quando pagar; competência = data da compra
    scheduleDate: p0.vencimento,
    dueDate: p0.vencimento,
    accrualDate: p0.data,
    categories: [...porCategoria].map(([categoryId, value]) => ({ categoryId, value })),
    costCenterValueType: 0, // rateio por valor
    costCenters: [...porCentro].map(([costCenterId, value]) => ({ costCenterId, value })),
  };
}

// ---------- modos ----------

async function modoTeste() {
  out("MODO TESTE — cria um fornecedor e um lançamento de R$ 0,01 no Nibo e APAGA os dois.");
  out("");
  out("1/6 Conferindo o token (listando categorias)…");
  const categorias = await listarTudo("/categories");
  out(`    OK — ${categorias.length} categoria(s) na conta.`);
  out("2/6 Listando centros de custo…");
  const centros = await listarCentros();
  out(`    OK — ${centros.length} centro(s) de custo.`);
  if (categorias.length === 0 || centros.length === 0)
    throw new Error("A conta do Nibo precisa ter ao menos 1 categoria e 1 centro de custo.");

  const nomeTeste = "TESTE APP BOLETOS (pode apagar)";
  out(`3/6 Criando fornecedor de teste "${nomeTeste}"…`);
  const criado = await nibo("POST", "/suppliers", { name: nomeTeste });
  let fornecedorId = idFornecedor(criado);
  if (!fornecedorId) {
    const todos = await listarTudo("/suppliers");
    fornecedorId = idFornecedor(todos.find((f) => normalizar(nomeFornecedor(f)) === normalizar(nomeTeste)));
  }
  if (!fornecedorId) throw new Error("Fornecedor de teste criado, mas não achei o id dele.");
  out(`    OK — id ${fornecedorId}`);

  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const referencia = `APPBOLETOS-TESTE-${Date.now()}`;
  out("4/6 Criando lançamento de teste (R$ 0,01, hoje)…");
  const resposta = await nibo("POST", "/schedules/debit", {
    stakeholderId: fornecedorId,
    description: "TESTE do app boletos — pode apagar",
    reference: referencia,
    scheduleDate: hoje,
    dueDate: hoje,
    accrualDate: hoje,
    categories: [{ categoryId: idCategoria(categorias[0]), value: 0.01 }],
    costCenterValueType: 0,
    costCenters: [{ costCenterId: idCentro(centros[0]), value: 0.01 }],
  });
  let scheduleId = resposta?.scheduleId ?? resposta?.id;
  out("    OK — lançamento criado.");

  out("5/6 Apagando o lançamento de teste…");
  if (!scheduleId) {
    const achados = await listarTudo(
      `/schedules/debit?$filter=reference eq '${referencia}'`,
    );
    scheduleId = achados[0]?.scheduleId ?? achados[0]?.id;
  }
  if (scheduleId) {
    await nibo("DELETE", `/schedules/debit/${scheduleId}`);
    out("    OK — lançamento apagado.");
  } else {
    out(`    ⚠ Não achei o id do lançamento de teste. APAGUE NO NIBO manualmente (referência ${referencia}).`);
  }

  out("6/6 Apagando o fornecedor de teste…");
  try {
    await nibo("DELETE", `/suppliers/${fornecedorId}`);
    out("    OK — fornecedor apagado.");
  } catch (e) {
    out(`    ⚠ Não consegui apagar o fornecedor de teste (${e.message}). Apague no Nibo manualmente.`);
  }
  out("");
  out("✅ TESTE COMPLETO: o token funciona e a conta aceita criar/apagar lançamentos.");
}

async function modoEnviar(lancamentos) {
  out("Buscando cadastros no Nibo para casar os nomes…");
  const [categorias, centros, fornecedores] = await Promise.all([
    listarTudo("/categories"),
    listarCentros(),
    listarTudo("/suppliers"),
  ]);
  const mapaCategorias = new Map(categorias.map((c) => [normalizar(nomeCategoria(c)), idCategoria(c)]));
  const mapaCentros = new Map(centros.map((c) => [normalizar(nomeCentro(c)), idCentro(c)]));
  const mapaFornecedores = new Map(fornecedores.map((f) => [normalizar(nomeFornecedor(f)), idFornecedor(f)]));

  // nomes que não existem no Nibo?
  const faltamCat = new Set();
  const faltamCentro = new Set();
  for (const l of lancamentos)
    for (const p of l.partidas) {
      if (!mapaCategorias.has(normalizar(p.categoria))) faltamCat.add(p.categoria);
      if (!mapaCentros.has(normalizar(p.centro))) faltamCentro.add(p.centro);
    }
  if (faltamCat.size || faltamCentro.size) {
    out("");
    out("❌ NADA FOI ENVIADO — estes nomes não existem no Nibo (confira a grafia exata):");
    for (const c of faltamCat) out(`   Categoria: "${c}"`);
    for (const c of faltamCentro) out(`   Centro de custo: "${c}"`);
    out("Corrija as colunas (Nibo) no Excel ou cadastre os nomes no Nibo e rode de novo.");
    return { enviados: 0, pulados: 0, falhas: 0 };
  }

  out("");
  out(`Serão criados ${lancamentos.length} lançamento(s) AGENDADO(S) no Nibo (não pagos).`);
  const conf = await perguntar('Digite ENVIAR (maiúsculas) para confirmar, ou qualquer outra coisa para cancelar: ');
  if (conf !== "ENVIAR") {
    out("Cancelado pelo usuário. Nada foi enviado.");
    return { enviados: 0, pulados: 0, falhas: 0 };
  }

  let enviados = 0, pulados = 0, falhas = 0;
  for (const l of lancamentos) {
    const p0 = l.partidas[0];
    const rotulo = `${l.codigo} ${p0.cartao} R$ ${l.total.toFixed(2).replace(".", ",")}`;
    try {
      // já foi enviado antes? (evita duplicar ao rodar de novo)
      const ref = referenciaDe(l);
      try {
        const existentes = await listarTudo(`/schedules/debit?$filter=reference eq '${ref}'`);
        if (existentes.length > 0) {
          out(`⏭  ${rotulo} — JÁ EXISTE no Nibo (referência ${ref}), pulado.`);
          pulados++;
          continue;
        }
      } catch {
        /* filtro indisponível: segue sem a checagem */
      }

      // o "fornecedor" do lançamento é o CARTÃO: acha ou cria no Nibo
      let fid = mapaFornecedores.get(normalizar(p0.cartao));
      if (!fid) {
        const criado = await nibo("POST", "/suppliers", { name: p0.cartao });
        fid = idFornecedor(criado);
        if (!fid) {
          const todos = await listarTudo("/suppliers");
          fid = idFornecedor(todos.find((f) => normalizar(nomeFornecedor(f)) === normalizar(p0.cartao)));
        }
        if (!fid) throw new Error("criei o fornecedor (cartão) mas não achei o id dele");
        mapaFornecedores.set(normalizar(p0.cartao), fid);
        out(`   (fornecedor "${p0.cartao}" criado no Nibo)`);
      }

      await nibo("POST", "/schedules/debit", montarPayload(l, fid, mapaCategorias, mapaCentros));
      out(`✅ ${rotulo} — criado (agendado).`);
      enviados++;
    } catch (e) {
      out(`❌ ${rotulo} — FALHOU: ${e.message}`);
      falhas++;
    }
  }
  return { enviados, pulados, falhas };
}

// ---------- principal ----------

async function main() {
  const args = process.argv.slice(2);
  const teste = args.includes("--teste");
  const enviar = args.includes("--enviar");
  const arquivoArg = args.find((a) => !a.startsWith("--"));

  out("================ LANÇAMENTOS NIBO — APP BOLETOS ================");
  out(`Modo: ${teste ? "TESTE (cria e apaga)" : enviar ? "ENVIAR (real)" : "CONFERIR (não envia nada)"}`);
  out("");

  if ((teste || enviar) && (!TOKEN || TOKEN.includes("COLE_AQUI"))) {
    out("❌ O token da API não foi preenchido. Abra o lancar-nibo.bat no Bloco de Notas");
    out('   e preencha a linha: set "NIBO_APITOKEN=..." (Nibo → Configurações → API).');
    process.exitCode = 1;
    return;
  }

  if (teste) {
    await modoTeste();
    return;
  }

  const arquivo = resolve(
    arquivoArg ?? join(dirname(fileURLToPath(import.meta.url)), "nibo_lancamentos.xlsx"),
  );
  out(`Arquivo: ${arquivo}`);
  const { lancamentos, erros, totalLinhas } = lerLancamentos(arquivo);
  out(`Linhas na planilha: ${totalLinhas} — Lançamentos a enviar: ${lancamentos.length}`);
  out("");

  if (erros.length) {
    out(`❌ ${erros.length} PROBLEMA(S) ENCONTRADO(S) — nada será enviado até corrigir:`);
    erros.forEach((e) => out("   " + e));
    process.exitCode = 1;
    return;
  }

  out("Lançamentos válidos:");
  imprimirResumo(lancamentos);
  out("");

  if (!enviar) {
    out("✅ CONFERÊNCIA OK. Nada foi enviado (modo conferir).");
    out("   Para enviar de verdade, rode o .bat e escolha a opção ENVIAR.");
    return;
  }

  const r = await modoEnviar(lancamentos);
  out("");
  out(`Resultado: ${r.enviados} criado(s), ${r.pulados} já existiam, ${r.falhas} falha(s).`);
  if (r.falhas) process.exitCode = 1;
}

main()
  .catch((e) => {
    out("");
    out("❌ ERRO: " + e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/[:T]/g, "-")
        .slice(0, 19);
      const destino = join(process.cwd(), `nibo_resultado_${stamp}.txt`);
      writeFileSync(destino, log.join("\r\n"), "utf8");
      console.log(`\n(relatório salvo em ${destino})`);
    } catch {
      /* sem relatório */
    }
  });
