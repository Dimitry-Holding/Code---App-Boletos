import { z } from "zod";
import { CATEGORIAS } from "./categorias";

/**
 * Datos que la IA extrae de la foto (NO incluye centro de custo:
 * ese lo elige el conductor manualmente).
 */
export const ExtraccionSchema = z.object({
  fornecedor: z.string(),
  valor: z.number(),
  moeda: z.string(),
  data_documento: z.string(), // YYYY-MM-DD o ""
  categoria: z.enum(CATEGORIAS),
  tipo_pagamento: z.enum(["debito", "credito", "outro"]),
  ultimos4: z.string(),
  descricao: z.string(),
  confianca: z.enum(["alta", "media", "baixa"]),
});

export type Extraccion = z.infer<typeof ExtraccionSchema>;

/** Una fila de la tabla "eventos" en la base de datos. */
export type Evento = {
  id: number;
  conductor_id: string;
  fornecedor: string | null;
  valor: number | null;
  moeda: string | null;
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

/** Código legible e inmutable del evento (ej: DMT-000123). */
export function codigoId(id: number): string {
  return "DMT-" + String(id).padStart(6, "0");
}

export const TIPO_PAGAMENTO_LABEL: Record<string, string> = {
  debito: "Débito",
  credito: "Crédito",
  outro: "Outro",
};

/** Columnas del Excel que exporta el administrador (en portugués). */
export const COLUNAS_EXCEL: { titulo: string; valor: (e: Evento & { conductor_nome?: string }) => string | number }[] = [
  { titulo: "ID", valor: (e) => codigoId(e.id) },
  { titulo: "Data", valor: (e) => e.data_documento ?? "" },
  { titulo: "Fornecedor", valor: (e) => e.fornecedor ?? "" },
  { titulo: "Valor", valor: (e) => e.valor ?? 0 },
  { titulo: "Moeda", valor: (e) => e.moeda ?? "" },
  { titulo: "Centro de custo", valor: (e) => e.centro_custo ?? "" },
  { titulo: "Categoria", valor: (e) => e.categoria ?? "" },
  { titulo: "Pagamento", valor: (e) => TIPO_PAGAMENTO_LABEL[e.tipo_pagamento ?? ""] ?? "" },
  { titulo: "Últimos 4", valor: (e) => e.ultimos4 ?? "" },
  { titulo: "Descrição", valor: (e) => e.descricao ?? "" },
  { titulo: "Condutor", valor: (e) => e.conductor_nome ?? "" },
  { titulo: "Arquivo foto", valor: (e) => e.foto_path },
];
