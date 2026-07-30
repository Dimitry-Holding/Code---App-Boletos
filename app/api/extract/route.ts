import { type Extraccion } from "@/lib/evento";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Modelo principal y respaldo: si el principal agota su cuota gratuita (429),
// se intenta automáticamente con el siguiente de la lista.
const MODELOS = [
  process.env.GEMINI_MODEL || "gemini-flash-latest",
  "gemini-3.1-flash-lite",
].filter((m, i, arr) => arr.indexOf(m) === i);

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
- "data_documento": data do documento em YYYY-MM-DD. Se não aparecer, "".
  ATENÇÃO ao formato brasileiro: as datas vêm como DIA/MÊS/ANO (ex: 14/07/26,
  18.06.26, 22/07/2026). Ano com 2 dígitos significa 20XX (26 = 2026, NUNCA
  2020 nem 2018). "18.06.26-21:46" é 18 de junho de 2026 às 21:46, ou seja,
  2026-06-18. São compras recentes: o ano correto é quase sempre o atual;
  nunca devolva data no futuro. Ignore outras datas do cupom (validade,
  vencimento de promoção) — use a data da COMPRA/emissão.
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
        respuesta = await fetch(endpointDe(MODELOS[m]), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: cuerpoGemini,
        });
        data = await respuesta.json();
        if (respuesta.ok) break porModelo;
        if (!REINTENTABLES.has(respuesta.status)) break porModelo;
        if (intento === 2) {
          // Intentos agotados: con 429 probamos el siguiente modelo; con
          // errores transitorios (500/502/...) ya no insistimos.
          if (respuesta.status === 429 && !ultimoModelo) continue porModelo;
          break porModelo;
        }
        if (respuesta.status === 429) {
          // Cuota agotada: si hay modelo de respaldo, pasamos directo a él.
          if (!ultimoModelo) continue porModelo;
          // Último modelo: esperamos lo que pide Google ("retry in Xs").
          const seg = /retry in ([0-9.]+)s/i.exec(data?.error?.message ?? "");
          const espera = seg ? Math.min(Number(seg[1]) * 1000 + 500, 20000) : 11000;
          await new Promise((r) => setTimeout(r, espera));
        } else {
          await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
        }
      }
    }

    if (!respuesta || !respuesta.ok) {
      const msg = data?.error?.message || `HTTP ${respuesta?.status ?? "?"}`;
      return Response.json(
        { error: `Gemini (tras reintentos): ${msg}` },
        { status: 502 },
      );
    }

    const texto: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text)
        .filter(Boolean)
        .join("") ?? "";

    if (!texto) {
      const motivo =
        data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
      return Response.json(
        { error: `Gemini no devolvió contenido${motivo ? ` (${motivo})` : ""}.` },
        { status: 422 },
      );
    }

    const objeto = extraerJSON(texto);
    if (!objeto) {
      return Response.json(
        { error: "La IA no devolvió un JSON válido." },
        { status: 422 },
      );
    }

    return Response.json(normalizar(objeto, categorias));
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error desconocido";
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
  const dataBruta = comoTexto(o.data_documento);
  const data = validarData(dataBruta);
  const dataRejeitada = dataBruta !== "" && data === "";
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
    // Data rejeitada = leitura suspeita: baixamos a confiança para o usuário conferir.
    confianca: (dataRejeitada
      ? "baixa"
      : CONFIANZAS.includes(comoTexto(o.confianca))
        ? comoTexto(o.confianca)
        : "media") as Extraccion["confianca"],
  };
}
