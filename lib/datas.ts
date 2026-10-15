/**
 * Interpretação de datas no padrão brasileiro (DIA/MÊS/ANO).
 * Puro (sem React/Supabase) para poder ser testado isoladamente.
 */

const MESES_PT: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/**
 * Converte a data COMO IMPRESSA no documento para ISO (aaaa-mm-dd), sempre
 * lendo DIA/MÊS/ANO: "08/10/26", "18.06.26", "22-07-2026", "081026",
 * "3 de julho de 2026", "19 de ago. de 2026" (Uber), "08/10/26 13:06". Devolve "" se não reconhecer.
 * Não depende da IA converter — foi a conversão dela que trocou dia e mês
 * ("08/10/26" virou 10 de agosto).
 */
export function dataBrasileiraParaIso(texto: string): string {
  const t = (texto ?? "").trim().toLowerCase();
  if (!t) return "";
  // "2026-10-08" não é texto impresso de cupom: a IA já converteu (e pode ter
  // trocado dia/mês). Devolve "" para cair no caminho com a defesa de troca.
  if (/\d{4}-\d{2}-\d{2}/.test(t)) return "";
  let d = 0;
  let m = 0;
  let a = 0;
  let r = t.match(/(?<!\d)(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})(?!\d)/);
  if (r) {
    [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  } else if ((r = t.match(/(\d{1,2})\s+(?:de\s+)?([a-zç]{3,})\.?,?\s+(?:de\s+)?(\d{2,4})/))) {
    d = Number(r[1]);
    m = MESES_PT[r[2].slice(0, 3)] ?? 0;
    a = Number(r[3]);
  } else if ((r = t.match(/(?<!\d)(\d{1,2})\s*[/.\-]\s*([a-zç]{3})[a-zç]*\s*[/.\-]\s*(\d{2,4})(?!\d)/))) {
    // "12/set/26", "15/SET/2026", "06/SET/2026 13:41"
    d = Number(r[1]);
    m = MESES_PT[r[2]] ?? 0;
    a = Number(r[3]);
  } else if ((r = t.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/))) {
    [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  } else {
    return "";
  }
  if (a < 100) a += 2000;
  if (!m || m > 12 || !d || d > 31) return "";
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Última defesa contra dia/mês trocados quando só temos a conversão da IA:
 * se a data ficou mais de 20 dias no passado mas, trocando dia e mês, cai
 * nos últimos 10 dias, a troca é quase certamente a leitura certa.
 * `agora` é injetável para testes.
 */
export function corrigirTrocaDiaMes(iso: string, agora: number = Date.now()): string {
  const r = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!r) return iso;
  const [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  if (d > 12 || d === m) return iso;
  const dias = (x: string) => (agora - new Date(`${x}T12:00:00Z`).getTime()) / 86400000;
  const trocada = `${a}-${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}`;
  const dt = dias(trocada);
  return dias(iso) > 20 && dt >= -1 && dt <= 10 ? trocada : iso;
}

/** Dias inteiros entre a data ISO e `agora` (positivo = passado). */
export function diasAtras(iso: string, agora: number = Date.now()): number {
  const t = new Date(`${iso}T12:00:00Z`).getTime();
  return Math.floor((agora - t) / 86400000);
}

/**
 * Aviso para a pessoa conferir a data na revisão. Uma nota costuma ser
 * lançada poucos dias depois da compra; uma data muito antiga quase sempre é
 * um dígito lido errado (manuscrito "03/07" lido como "03/01", ano trocado…).
 */
export const DIAS_DATA_SUSPEITA = 45;
export function avisoDeData(iso: string, rejeitada: boolean, agora: number = Date.now()): string {
  if (rejeitada) return "A data lida não era plausível e foi apagada — informe a data do documento.";
  if (!iso) return "";
  const dias = diasAtras(iso, agora);
  if (dias <= DIAS_DATA_SUSPEITA) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  return `Data lida: ${br} (há ${dias} dias). Confira no documento — a leitura pode ter trocado um dígito.`;
}
