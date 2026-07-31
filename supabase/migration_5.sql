-- Migração 5: dia de vencimento da fatura por cartão (usado no Excel Nibo).
-- Rodar no Supabase: SQL Editor → colar → Run.

alter table public.cartoes
  add column if not exists dia_vencimento smallint
  check (dia_vencimento between 1 and 31);

comment on column public.cartoes.dia_vencimento is
  'Dia do mês em que vence a fatura do cartão (1-31). Compras depois desse dia caem na fatura do mês seguinte (Excel Nibo).';

-- Correção de dados: notas antigas do Hélio sem centro de custo (ele só tem
-- "Aeronave"). Notas DMT-8, 15-19 (junho/2026) e DMT-172 (IOF retroativo).
update public.eventos
  set centro_custo = 'Aeronave'
  where conductor_id = '1e62b0c6-70a9-43da-99c9-5bc670cfdbdb'
    and (centro_custo is null or centro_custo = '');
