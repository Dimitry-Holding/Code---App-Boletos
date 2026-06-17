import { CATEGORIAS, CATEGORIA_DEFECTO } from "@/lib/categorias";
import { type Extraccion } from "@/lib/evento";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

const TIPOS_PAGO = ["debito", "credito", "outro"];
const CONFIANZAS = ["alta", "media", "baixa"];

const SYSTEM_PROMPT = `Você é um assistente especialista em ler documentos fiscais brasileiros:
notas fiscais, cupons fiscais (NFC-e), boletos e recibos de compras feitas com cartão.

Responda EXCLUSIVAMENTE com um objeto JSON válido (sem markdown, sem comentários, sem texto
adicional) com EXATAMENTE estas chaves:
{
  "fornecedor": string,
  "valor": number,
  "moeda": string,
  "data_documento": string,
  "categoria": string,
  "tipo_pagamento": um de [debito, credito, outro],
  "ultimos4": string,
  "descricao": string,
  "confianca": um de [alta, media, baixa]
}

Regras:
- "fornecedor": razão social ou nome do estabelecimento/emissor.
- "valor": valor total pago, como número decimal (ex: 1234.56). Se não houver, 0.
- "moeda": normalmente "BRL".
- "data_documento": data do documento no formato YYYY-MM-DD. Se não aparecer, "".
- "tipo_pagamento": "debito" ou "credito" conforme o cupom (CARTÃO DÉBITO / CRÉDITO).
  Se não for possível saber, "outro".
- "ultimos4": os últimos 4 dígitos do cartão, se aparecerem (ex: "1234"). "" se não aparecer.
- "descricao": resumo curto (uma frase) do que foi a compra.
- "categoria": escolha a categoria MAIS adequada APENAS desta lista exata
  (não invente outras; se nenhuma encaixar claramente, use "Outros"):
${CATEGORIAS.map((c) => `  - ${c}`).join("\n")}
- "confianca": sua confiança geral na extração.

Não invente dados: se um campo não estiver visível, deixe vazio ("") ou 0.`;

type CuerpoSolicitud = {
  imageBase64?: string;
  mediaType?: string;
};

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PEGA_TU_CLAVE_AQUI") {
    return Response.json(
      {
        error:
          "Falta GEMINI_API_KEY. Conseguí una gratis en https://aistudio.google.com/apikey y ponela en .env.local.",
      },
      { status: 500 },
    );
  }

  let cuerpo: CuerpoSolicitud;
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const { imageBase64, mediaType } = cuerpo;
  if (!imageBase64 || !mediaType) {
    return Response.json(
      { error: "Falta la imagen o el tipo de archivo." },
      { status: 400 },
    );
  }

  try {
    const cuerpoGemini = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: imageBase64 } },
            { text: "Extraia os dados deste documento fiscal e devolva apenas o JSON." },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    // El nivel gratuito de Gemini a veces devuelve errores transitorios (429/503).
    const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);
    let respuesta: Response | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;

    for (let intento = 0; intento < 3; intento++) {
      respuesta = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: cuerpoGemini,
      });
      data = await respuesta.json();
      if (respuesta.ok) break;
      if (!REINTENTABLES.has(respuesta.status) || intento === 2) break;
      await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
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
        {
          error: `Gemini no devolvió contenido${motivo ? ` (${motivo})` : ""}. Probá con otra foto más nítida.`,
        },
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

    return Response.json(normalizar(objeto));
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error desconocido";
    return Response.json(
      { error: `Error al procesar con Gemini: ${mensaje}` },
      { status: 502 },
    );
  }
}

/** Intenta parsear JSON aunque venga envuelto en texto o en bloques de código. */
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

/** Convierte valores tipo "1.234,56" o "R$ 1234.56" a número. */
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

/** Garantiza que la respuesta cumpla el esquema (categoría siempre dentro de la lista). */
function normalizar(o: Record<string, unknown>): Extraccion {
  const cat = comoTexto(o.categoria);
  const tipo = comoTexto(o.tipo_pagamento).toLowerCase();
  return {
    fornecedor: comoTexto(o.fornecedor),
    valor: parseValor(o.valor),
    moeda: comoTexto(o.moeda) || "BRL",
    data_documento: comoTexto(o.data_documento),
    categoria: (CATEGORIAS as readonly string[]).includes(cat)
      ? (cat as Extraccion["categoria"])
      : CATEGORIA_DEFECTO,
    tipo_pagamento: (TIPOS_PAGO.includes(tipo)
      ? tipo
      : "outro") as Extraccion["tipo_pagamento"],
    ultimos4: comoTexto(o.ultimos4).replace(/\D/g, "").slice(-4),
    descricao: comoTexto(o.descricao),
    confianca: (CONFIANZAS.includes(comoTexto(o.confianca))
      ? comoTexto(o.confianca)
      : "media") as Extraccion["confianca"],
  };
}
