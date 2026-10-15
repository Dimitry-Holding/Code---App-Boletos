import { type Extraccion } from "@/lib/evento";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarErro } from "@/lib/log-erro";
import { dataBrasileiraParaIso, corrigirTrocaDiaMes, avisoDeData } from "@/lib/datas";

/** Registra uma falha da extração no monitoramento (com o usuário, se houver). */
async function logExtract(mensagem: string, detalhe?: string) {
  let uid: string | null = null;
  try {
    const supa = await createClient();
    uid = (await supa.auth.getUser()).data.user?.id ?? null;
  } catch {
    /* sem usuário */
  }
  await registrarErro("extract", mensagem, detalhe, uid);
}

export const runtime = "nodejs";
export const maxDuration = 60;

// Modelo principal y respaldos: si uno agota su cuota (429), está sobrecargado
// (5xx "high demand") o se cuelga (timeout), se pasa al siguiente de la lista.
// Ago/2026: gemini-flash-latest empezó a colgarse; los "lite" responden en 1-3s.
// Set/2026: apagón amplio de "high demand" en el nivel gratuito — lista larga
// para cazar el modelo que esté vivo (3.6/3.8 son generaciones más nuevas).
const MODELOS = [
  process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
].filter((m, i, arr) => arr.indexOf(m) === i);

// Tiempo máximo por intento: un modelo colgado no puede comerse los 60s de la
// función (el usuario veía "demora + error" sin que el respaldo llegara a actuar).
const TIMEOUT_MODELO_MS = 25000;

function endpointDe(modelo: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
}

const TIPOS_PAGO = ["debito", "credito"];
const CONFIANZAS = ["alta", "media", "baixa"];

function construirPrompt(categorias: string[]): string {
  const listaCat =
    categorias.length > 0
      ? categorias.map((c) => `  - ${c}`).join("\n")
      : "  (sem lista definida — deixe a categoria vazia)";
  return `Você é um assistente especialista em ler documentos fiscais brasileiros:
notas fiscais, cupons fiscais (NFC-e), boletos e recibos de compras com cartão.

Responda EXCLUSIVAMENTE com um objeto JSON válido (sem markdown, sem texto adicional)
com EXATAMENTE estas chaves:
{
  "fornecedor": string,
  "valor": number,
  "moeda": string,
  "data_texto": string,
  "data_documento": string,
  "categoria": string,
  "tipo_pagamento": um de [debito, credito],
  "ultimos4": string,
  "descricao": string,
  "confianca": um de [alta, media, baixa]
}

Regras:
- "fornecedor": razão social ou nome do estabelecimento.
- "valor": valor total pago, número decimal (ex: 1234.56). Se não houver, 0.
- "moeda": normalmente "BRL".
- "data_texto": a data da COMPRA/emissão copiada EXATAMENTE como está
  impressa ou escrita no documento, sem reformatar nem interpretar
  (ex: "08/10/26", "18.06.26", "22/07/2026", "03 de julho de 2026").
  Ignore outras datas (validade, vencimento, promoção). Se não houver, "".
- "data_documento": a mesma data em YYYY-MM-DD. Se não aparecer, "".
  ATENÇÃO ao formato brasileiro: as datas vêm como DIA/MÊS/ANO — "08/10/26"
  é 8 de OUTUBRO (2026-10-08), nunca 10 de agosto. Ano com 2 dígitos
  significa 20XX (26 = 2026, NUNCA 2020 nem 2018). "18.06.26-21:46" é
  2026-06-18. São compras recentes: o ano correto é quase sempre o atual;
  nunca devolva data no futuro.
- "tipo_pagamento": "debito" ou "credito" conforme o cupom. Se não der para saber, "debito".
- "ultimos4": os últimos 4 dígitos do cartão, se aparecerem. "" se não aparecer.
- "descricao": resumo curto (uma frase) da compra.
- "categoria": escolha a MAIS adequada APENAS desta lista exata (não invente outras;
  se nenhuma encaixar, deixe ""):
${listaCat}
- "confianca": sua confiança geral.

Não invente dados: se um campo não estiver visível, deixe vazio ("") ou 0.`;
}

type CuerpoSolicitud = {
  imageBase64?: string;
  storagePath?: string;
  mediaType?: string;
  categorias?: string[];
};

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PEGA_TU_CLAVE_AQUI") {
    return Response.json(
      { error: "Falta GEMINI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  let cuerpo: CuerpoSolicitud;
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const { imageBase64, storagePath, mediaType } = cuerpo;
  const categorias = Array.isArray(cuerpo.categorias) ? cuerpo.categorias : [];
  if (!mediaType || (!imageBase64 && !storagePath)) {
    return Response.json(
      { error: "Falta el archivo o el tipo." },
      { status: 400 },
    );
  }

  // Los datos a enviar a Gemini: si viene por Storage (PDFs grandes), el servidor
  // descarga el archivo desde ahí (esquiva el límite de tamaño de Vercel).
  let datosBase64: string;
  try {
    if (storagePath) {
      const supa = await createClient();
      const {
        data: { user },
      } = await supa.auth.getUser();
      if (!user) {
        return Response.json({ error: "Não autenticado." }, { status: 401 });
      }
      // Solo se puede leer un archivo de la propia carpeta del usuario.
      if (!storagePath.startsWith(`${user.id}/`)) {
        return Response.json({ error: "Sem permissão." }, { status: 403 });
      }
      const admin = createAdminClient();
      const { data: arquivo, error } = await admin.storage
        .from("notas")
        .download(storagePath);
      if (error || !arquivo) {
        return Response.json(
          { error: "Não foi possível ler o arquivo do Storage." },
          { status: 502 },
        );
      }
      const buf = Buffer.from(await arquivo.arrayBuffer());
      datosBase64 = buf.toString("base64");
    } else {
      datosBase64 = imageBase64 as string;
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : "erro";
    return Response.json({ error: `Erro ao ler o arquivo: ${m}` }, { status: 502 });
  }

  try {
    const cuerpoGemini = JSON.stringify({
      system_instruction: { parts: [{ text: construirPrompt(categorias) }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: datosBase64 } },
            { text: "Extraia os dados deste documento fiscal e devolva apenas o JSON." },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);
    let respuesta: Response | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;

    // Se intenta con cada modelo en orden; si uno agota su cuota (429),
    // se pasa al siguiente. Dentro de cada modelo hay hasta 3 intentos.
    porModelo: for (let m = 0; m < MODELOS.length; m++) {
      const ultimoModelo = m === MODELOS.length - 1;
      for (let intento = 0; intento < 3; intento++) {
        try {
          respuesta = await fetch(endpointDe(MODELOS[m]), {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: cuerpoGemini,
            signal: AbortSignal.timeout(TIMEOUT_MODELO_MS),
          });
        } catch {
          // Modelo colgado o error de red: pasamos al siguiente modelo.
          respuesta = null;
          data = { error: { message: `O modelo ${MODELOS[m]} não respondeu a tempo.` } };
          if (!ultimoModelo) continue porModelo;
          continue;
        }
        data = await respuesta.json();
        if (respuesta.ok) break porModelo;
        if (!REINTENTABLES.has(respuesta.status)) break porModelo;
        // Cuota agotada (429) o sobrecarga/errores del Google (5xx): pasamos
        // DIRECTO al siguiente modelo — insistir en el mismo desperdicia tiempo
        // (antes, un 503 agotaba los intentos y ni se probaban los respaldos).
        if (respuesta.status === 429 || respuesta.status >= 500) {
          if (!ultimoModelo) continue porModelo;
          if (intento === 2) break porModelo;
          // Último modelo de la lista: aquí sí esperamos y reintentamos.
          const seg = /retry in ([0-9.]+)s/i.exec(data?.error?.message ?? "");
          const espera =
            respuesta.status === 429
              ? seg
                ? Math.min(Number(seg[1]) * 1000 + 500, 20000)
                : 11000
              : 2000 * (intento + 1);
          await new Promise((r) => setTimeout(r, espera));
        } else {
          // 408 u otro transitorio raro: reintento corto en el mismo modelo.
          if (intento === 2) break porModelo;
          await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
        }
      }
    }

    if (!respuesta || !respuesta.ok) {
      const cru = data?.error?.message || `HTTP ${respuesta?.status ?? "?"}`;
      // Mensagem amigável quando o Google inteiro está sobrecarregado.
      const sobrecarga =
        respuesta?.status === 503 || /high demand|overloaded/i.test(cru);
      const msg = sobrecarga
        ? "A IA do Google está sobrecarregada agora (instabilidade temporária " +
          "do próprio Google, comum em horários de pico). A nota NÃO foi perdida: " +
          "aguarde alguns minutos e envie de novo."
        : `Gemini (após tentativas): ${cru}`;
      await logExtract(msg, `HTTP ${respuesta?.status ?? "timeout"} | ${cru} | modelos: ${MODELOS.join(", ")}`);
      return Response.json({ error: msg }, { status: 502 });
    }

    const texto: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text)
        .filter(Boolean)
        .join("") ?? "";

    if (!texto) {
      const motivo =
        data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
      await logExtract(`A IA não devolveu conteúdo${motivo ? ` (${motivo})` : ""}.`);
      return Response.json(
        { error: `Gemini no devolvió contenido${motivo ? ` (${motivo})` : ""}.` },
        { status: 422 },
      );
    }

    const objeto = extraerJSON(texto);
    if (!objeto) {
      await logExtract("A IA não devolveu um JSON válido.", texto.slice(0, 300));
      return Response.json(
        { error: "La IA no devolvió un JSON válido." },
        { status: 422 },
      );
    }

    return Response.json(normalizar(objeto, categorias));
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error desconocido";
    await logExtract(`Erro ao processar com o Gemini: ${mensaje}`);
    return Response.json(
      { error: `Error al procesar con Gemini: ${mensaje}` },
      { status: 502 },
    );
  }
}

function extraerJSON(texto: string): Record<string, unknown> | null {
  const t = texto.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* sigue */
  }
  const inicio = t.indexOf("{");
  const fin = t.lastIndexOf("}");
  if (inicio >= 0 && fin > inicio) {
    try {
      return JSON.parse(t.slice(inicio, fin + 1));
    } catch {
      /* sigue */
    }
  }
  return null;
}

function comoTexto(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function parseValor(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v !== "string") return 0;
  let s = v.replace(/[^0-9.,-]/g, "");
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/**
 * Valida a data extraída: formato YYYY-MM-DD e dentro de uma janela plausível
 * (compras de até ~13 meses atrás; nunca no futuro). Datas fora disso são um
 * sintoma clássico de leitura errada do ano (ex: "02/07/26" virar 2020-07-02),
 * então devolvemos "" para o usuário preencher a data certa na revisão.
 */
function validarData(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(`${s}T12:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return "";
  const hoje = new Date();
  const minima = new Date(hoje.getTime() - 400 * 24 * 60 * 60 * 1000);
  const maxima = new Date(hoje.getTime() + 24 * 60 * 60 * 1000);
  if (d < minima || d > maxima) return "";
  return s;
}

function normalizar(
  o: Record<string, unknown>,
  categorias: string[],
): Extraccion {
  const cat = comoTexto(o.categoria);
  const tipo = comoTexto(o.tipo_pagamento).toLowerCase();
  // 1) data lida do texto impresso (regra brasileira); 2) conversão da IA,
  //    com a defesa contra dia/mês trocados; 3) validação de plausibilidade.
  const doTexto = dataBrasileiraParaIso(comoTexto(o.data_texto));
  const daIA = corrigirTrocaDiaMes(comoTexto(o.data_documento));
  const dataBruta = doTexto || daIA;
  let data = validarData(dataBruta);
  if (!data && doTexto && daIA !== doTexto) data = validarData(daIA);
  const dataRejeitada = dataBruta !== "" && data === "";
  // Data apagada ou muito antiga (ex.: manuscrito "03/07" lido como "03/01"):
  // mantém o que foi lido, mas destaca o campo e baixa a confiança.
  const avisoData = avisoDeData(data, dataRejeitada);
  return {
    fornecedor: comoTexto(o.fornecedor),
    valor: parseValor(o.valor),
    moeda: comoTexto(o.moeda) || "BRL",
    data_documento: data,
    // Solo aceptamos categorías que estén en la lista del usuario.
    categoria: categorias.includes(cat) ? cat : "",
    tipo_pagamento: (TIPOS_PAGO.includes(tipo)
      ? tipo
      : "debito") as Extraccion["tipo_pagamento"],
    ultimos4: comoTexto(o.ultimos4).replace(/\D/g, "").slice(-4),
    descricao: comoTexto(o.descricao),
    confianca: (avisoData
      ? "baixa"
      : CONFIANZAS.includes(comoTexto(o.confianca))
        ? comoTexto(o.confianca)
        : "media") as Extraccion["confianca"],
    aviso_data: avisoData,
  };
}
