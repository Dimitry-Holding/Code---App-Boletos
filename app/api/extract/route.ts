import { BoletoSchema, type Boleto } from "@/lib/boleto";
import { CATEGORIAS, CATEGORIA_DEFECTO } from "@/lib/categorias";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

const TIPOS = ["boleto", "nota_fiscal", "cupom_fiscal", "recibo", "outro"];
const CONFIANZAS = ["alta", "media", "baixa"];

const SYSTEM_PROMPT = `Eres un asistente experto en leer documentos fiscales brasileños:
boletos bancários, notas fiscais, cupons fiscais e recibos.

Respondé EXCLUSIVAMENTE con un objeto JSON válido (sin markdown, sin comentarios, sin texto
adicional) con EXACTAMENTE estas claves:
{
  "tipo": uno de [boleto, nota_fiscal, cupom_fiscal, recibo, outro],
  "fornecedor": string,
  "cnpj_cpf": string,
  "valor": number,
  "moeda": string,
  "data_emissao": string,
  "data_vencimento": string,
  "numero_documento": string,
  "linha_digitavel": string,
  "descricao": string,
  "categoria_sugerida": string,
  "confianca": uno de [alta, media, baixa]
}

Reglas:
- Fechas SIEMPRE en formato YYYY-MM-DD. Si no aparece, usá "".
- "valor": el valor total a pagar, como número decimal (ej: 1234.56). Si no hay, 0.
- "moeda": normalmente "BRL".
- "cnpj_cpf": el documento del beneficiário/fornecedor, con su formato original. "" si no aparece.
- "fornecedor": a razão social o nombre del beneficiário/emisor del documento.
- "numero_documento": número da nota fiscal o del documento/boleto.
- "linha_digitavel": la línea digitable del boleto (los números largos del código de barras),
  sin espacios si es posible. "" si el documento no es un boleto.
- "descricao": resumen corto (una frase) de qué es el gasto.
- "categoria_sugerida": elegí la categoría MÁS adecuada SOLO de esta lista exacta
  (no inventes otras; si ninguna encaja claramente, usá "Outros"):
${CATEGORIAS.map((c) => `  - ${c}`).join("\n")}
- "confianca": tu confianza global en la extracción.

No inventes datos: si un campo no está visible, dejalo vacío ("") o en 0.`;

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
          "Falta la variable GEMINI_API_KEY. Conseguí una gratis en https://aistudio.google.com/apikey y ponela en .env.local.",
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
            {
              text: "Extraé los datos de este documento fiscal brasileño y devolvé solo el JSON.",
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    });

    // El nivel gratuito de Gemini a veces devuelve errores transitorios (429/503).
    // Reintentamos con espera creciente para que sea estable.
    const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);
    let respuesta: Response | null = null;
    // La respuesta de Gemini es JSON dinámico; lo recorremos con optional chaining.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;

    for (let intento = 0; intento < 3; intento++) {
      respuesta = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
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
        data?.candidates?.[0]?.finishReason ||
        data?.promptFeedback?.blockReason;
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

/** Intenta parsear JSON aunque venga envuelto en texto o en bloques ```json. */
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
    s = s.replace(/\./g, "").replace(",", "."); // formato brasileño: . miles, , decimal
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** Garantiza que la respuesta cumpla el esquema (categoría siempre dentro de la lista). */
function normalizar(o: Record<string, unknown>): Boleto {
  const candidato = {
    tipo: TIPOS.includes(o.tipo as string) ? (o.tipo as string) : "outro",
    fornecedor: comoTexto(o.fornecedor),
    cnpj_cpf: comoTexto(o.cnpj_cpf),
    valor: parseValor(o.valor),
    moeda: comoTexto(o.moeda) || "BRL",
    data_emissao: comoTexto(o.data_emissao),
    data_vencimento: comoTexto(o.data_vencimento),
    numero_documento: comoTexto(o.numero_documento),
    linha_digitavel: comoTexto(o.linha_digitavel),
    descricao: comoTexto(o.descricao),
    categoria_sugerida: (CATEGORIAS as readonly string[]).includes(
      o.categoria_sugerida as string,
    )
      ? (o.categoria_sugerida as string)
      : CATEGORIA_DEFECTO,
    confianca: CONFIANZAS.includes(o.confianca as string)
      ? (o.confianca as string)
      : "media",
  };
  return BoletoSchema.parse(candidato);
}
