-- Migração 5: dia de vencimento da fatura por cartão (usado no Excel Nibo).
-- Rodar no Supabase: SQL Editor → colar → Run.

alter table public.cartoes
  add column if not exists dia_vencimento smallint
  check (dia_vencimento between 1 and 31);

comment on column public.cartoes.dia_vencimento is
  'Dia do mês em que vence a fatura do cartão (1-31). Compras depois desse dia caem na fatura do mês seguinte (Excel Nibo).';
