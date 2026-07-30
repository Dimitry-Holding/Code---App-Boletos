/** Datos que la IA extrae de la foto/PDF. */
export type Extraccion = {
  fornecedor: string;
  valor: number;
  moeda: string;
  data_documento: string; // YYYY-MM-DD o ""
  categoria: string; // validada contra la lista del usuario ("" si no coincide)
  tipo_pagamento: "debito" | "credito";
  ultimos4: string;
  descricao: string;
  confianca: "alta" | "media" | "baixa";
};

/** Una fila de la tabla "eventos". */
export type Evento = {
  id: number;
  conductor_id: string;
  fornecedor: string | null;
  valor: number | null;
  moeda: string | null;
  valor_brl: number | null; // valor convertido a reales (= valor si moeda es BRL)
  cambio: number | null; // tipo de cambio usado (null si moeda es BRL)
  centro_custo: string | null;
  data_documento: string | null;
  categoria: string | null;
  tipo_pagamento: string | null;
  ultimos4: string | null;
  descricao: string | null;
  confianca: string | null;
  foto_path: string;
  criado_em: string;
};

/** Valor del evento en reales (notas viejas sin valor_brl usan valor directo). */
export function valorBRL(e: Evento): number {
  return Number(e.valor_brl ?? e.valor ?? 0);
}

/** IOF sobre compras internacionales con tarjeta (3,5% desde mayo/2025). */
export const IOF_TAXA = 0.035;
/** Categoría con la que se guarda la línea automática de IOF. */
export const IOF_CATEGORIA = "IOF";

/**
 * Monedas con cotización PTAX en el Banco Central (además de BRL).
 * Para otras monedas el usuario puede escribir el cambio a mano.
 */
export const MOEDAS = [
  "BRL", "USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD", "DKK", "NOK", "SEK",
];

/** Tarjeta (TDC) asignada a un usuario. */
export type Cartao = {
  id: number;
  user_id: string;
  ultimos4: string;
  apelido: string | null;
  /** Dia do mês em que vence a fatura (1–31); usado no Excel Nibo. */
  dia_vencimento: number | null;
};

/** Categoría asignada a un usuario. */
export type Categoria = {
  id: number;
  user_id: string;
  nome: string;
};

/** Centro de custo asignado a un usuario. */
export type CentroCusto = {
  id: number;
  user_id: string;
  nome: string;
};

/** Código legible e inmutable del evento (ej: DMT-000123). */
export function codigoId(id: number): string {
  return "DMT-" + String(id).padStart(6, "0");
}

/** Quita caracteres no permitidos en nombres de archivo, conservando legibilidad. */
export function limparNome(texto: string): string {
  return (texto || "")
    .replace(/[\\/:*?"<>|]+/g, " ") // caracteres ilegales en nombres de archivo
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Máximo de caracteres del fornecedor dentro del nombre de archivo.
 * Windows limita la RUTA COMPLETA a 260 caracteres; con carpetas profundas
 * (OneDrive corporativo) los nombres largos daban error 0x80010135 al extraer.
 */
const MAX_FORNECEDOR_ARQUIVO = 30;

/** Recorta un texto a `max` caracteres, cortando en un espacio si se puede. */
function encurtar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).trim();
}

/**
 * Nombre de archivo de la foto: Fornecedor-Data-R$Valor-Cartao.ext
 * Ej: "LAVANDERIA ASA SUL LTDA-2026-06-18-R$200,45-1261.jpg"
 * El fornecedor se recorta para no superar el límite de ruta de Windows.
 */
export function nomeArquivoFoto(e: Evento): string {
  const ext = e.foto_path.toLowerCase().endsWith(".pdf") ? "pdf" : "jpg";
  const forn =
    encurtar(limparNome(e.fornecedor || ""), MAX_FORNECEDOR_ARQUIVO) ||
    "Fornecedor";
  const data = e.data_documento || "sem-data";
  const valor = "R$" + Number(e.valor ?? 0).toFixed(2).replace(".", ",");
  const cartao = e.ultimos4 || "0000";
  return `${forn}-${data}-${valor}-${cartao}.${ext}`;
}

/**
 * Nome do arquivo para download SEMPRE em PDF (fotos JPG são convertidas em PDF
 * na hora de baixar; PDFs originais mantêm o conteúdo). Ex: "...-1261.pdf"
 */
export function nomeArquivoPdf(e: Evento): string {
  return nomeArquivoFoto(e).replace(/\.(jpe?g|pdf)$/i, "") + ".pdf";
}

export const TIPO_PAGAMENTO_LABEL: Record<string, string> = {
  debito: "Débito",
  credito: "Crédito",
};

/** Etiqueta legible de una tarjeta. */
export function labelCartao(c: Cartao): string {
  const ap = c.apelido ? `${c.apelido} ` : "";
  return `${ap}••${c.ultimos4}`;
}

/** ¿La rendición sigue siendo editable/borrable? (hasta 30 días de creada) */
export const DIAS_EDICION = 30;
export function dentroDePlazo(criadoEm: string): boolean {
  const creado = new Date(criadoEm).getTime();
  const limite = creado + DIAS_EDICION * 24 * 60 * 60 * 1000;
  return Date.now() <= limite;
}

/** Columnas del Excel del administrador. */
export const COLUNAS_EXCEL: {
  titulo: string;
  valor: (e: Evento & { conductor_nome?: string }) => string | number;
}[] = [
  { titulo: "ID", valor: (e) => codigoId(e.id) },
  { titulo: "Data", valor: (e) => e.data_documento ?? "" },
  { titulo: "Fornecedor", valor: (e) => e.fornecedor ?? "" },
  { titulo: "Valor (R$)", valor: (e) => valorBRL(e) },
  { titulo: "Moeda", valor: (e) => e.moeda ?? "" },
  { titulo: "Valor original", valor: (e) => e.valor ?? 0 },
  { titulo: "Câmbio", valor: (e) => e.cambio ?? "" },
  { titulo: "Centro de custo", valor: (e) => e.centro_custo ?? "" },
  { titulo: "Categoria", valor: (e) => e.categoria ?? "" },
  { titulo: "Pagamento", valor: (e) => TIPO_PAGAMENTO_LABEL[e.tipo_pagamento ?? ""] ?? "" },
  { titulo: "Cartão", valor: (e) => (e.ultimos4 ? `••${e.ultimos4}` : "") },
  { titulo: "Descrição", valor: (e) => e.descricao ?? "" },
  { titulo: "Condutor", valor: (e) => e.conductor_nome ?? "" },
  { titulo: "Arquivo foto", valor: (e) => e.foto_path },
];
