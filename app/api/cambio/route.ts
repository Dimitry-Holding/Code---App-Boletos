export const runtime = "nodejs";

/**
 * Cotización PTAX del Banco Central do Brasil (gratis, sin clave).
 * GET /api/cambio?moeda=USD&data=2026-07-21
 * → { cambio: 5.43, data_cotacao: "2026-07-21" }
 *
 * Si el día pedido no tiene cotización (fin de semana/feriado) se usa la
 * última disponible, retrocediendo hasta 10 días.
 */

const BASE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

function fmtBcb(d: Date): string {
  // El API del BCB espera MM-DD-YYYY
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getUTCFullYear()}`;
}

function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function cotacaoDia(moeda: string, d: Date): Promise<number | null> {
  const data = fmtBcb(d);
  const url =
    moeda === "USD"
      ? `${BASE}/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${data}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`
      : `${BASE}/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${moeda}'&@dataCotacao='${data}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const j = await r.json();
  const cot = j?.value?.[0]?.cotacaoVenda;
  return typeof cot === "number" && cot > 0 ? cot : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const moeda = (searchParams.get("moeda") || "").toUpperCase();
  const dataStr = searchParams.get("data") || "";

  if (!/^[A-Z]{3}$/.test(moeda) || moeda === "BRL") {
    return Response.json({ error: "Moeda inválida." }, { status: 400 });
  }
  let d = /^\d{4}-\d{2}-\d{2}$/.test(dataStr)
    ? new Date(dataStr + "T12:00:00Z")
    : new Date();
  if (isNaN(d.getTime())) d = new Date();
  // Nunca en el futuro (el PTAX no existe todavía)
  const hoje = new Date();
  if (d.getTime() > hoje.getTime()) d = hoje;

  try {
    for (let i = 0; i < 10; i++) {
      const fecha = new Date(d.getTime() - i * 24 * 60 * 60 * 1000);
      const cot = await cotacaoDia(moeda, fecha);
      if (cot) {
        return Response.json({ cambio: cot, data_cotacao: fmtIso(fecha) });
      }
    }
    return Response.json(
      { error: `Sem cotação PTAX para ${moeda}. Informe o câmbio manualmente.` },
      { status: 404 },
    );
  } catch {
    return Response.json(
      { error: "Não foi possível consultar o Banco Central. Informe o câmbio manualmente." },
      { status: 502 },
    );
  }
}
