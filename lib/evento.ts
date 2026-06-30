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
  data_documento: string | null;
  categoria: string | null;
  tipo_pagamento: string | null;
  ultimos4: string | null;
  descricao: string | null;
  confianca: string | null;
  foto_path: string;
  criado_em: string;
};

/** Tarjeta (TDC) asignada a un usuario. */
export type Cartao = {
  id: number;
  user_id: string;
  ultimos4: string;
  apelido: string | null;
};

/** Categoría asignada a un usuario. */
export type Categoria = {
  id: number;
  user_id: string;
  nome: string;
};

/** Código legible e inmutable del evento (ej: DMT-000123). */
export function codigoId(id: number): string {
  return "DMT-" + String(id).padStart(6, "0");
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
  { titulo: "Valor", valor: (e) => e.valor ?? 0 },
  { titulo: "Moeda", valor: (e) => e.moeda ?? "" },
  { titulo: "Categoria", valor: (e) => e.categoria ?? "" },
  { titulo: "Pagamento", valor: (e) => TIPO_PAGAMENTO_LABEL[e.tipo_pagamento ?? ""] ?? "" },
  { titulo: "Cartão", valor: (e) => (e.ultimos4 ? `••${e.ultimos4}` : "") },
  { titulo: "Descrição", valor: (e) => e.descricao ?? "" },
  { titulo: "Condutor", valor: (e) => e.conductor_nome ?? "" },
  { titulo: "Arquivo foto", valor: (e) => e.foto_path },
];
