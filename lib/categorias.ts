/**
 * LISTA FIJA DE CATEGORÍAS PARA NIBO.
 *
 * 👉 Editá esta lista con TUS categorías exactas de Nibo.
 *    La IA está obligada a elegir SOLO una de estas opciones.
 *    Dejá "Outros" al final como red de seguridad cuando ninguna encaje.
 */
export const CATEGORIAS = [
  "Alimentação",
  "Telefonia e Internet",
  "Energia Elétrica",
  "Água e Esgoto",
  "Aluguel",
  "Material de Escritório",
  "Combustível",
  "Transporte e Deslocamento",
  "Manutenção e Reparos",
  "Serviços de Terceiros",
  "Impostos e Taxas",
  "Marketing e Publicidade",
  "Hospedagem e Viagens",
  "Fornecedores / Mercadorias",
  "Despesas Bancárias",
  "Outros",
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

/** Valor por defecto cuando todavía no hay categoría. */
export const CATEGORIA_DEFECTO: Categoria = "Outros";
