-- ============================================================
-- MIGRACIÓN 4: conversión de moneda a BRL + categoría IOF
-- Ejecutar en Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1) Nuevas columnas en eventos:
--    valor_brl = valor convertido a reales (= valor si la moneda es BRL)
--    cambio    = tipo de cambio usado (null para BRL)
alter table public.eventos
  add column if not exists valor_brl numeric,
  add column if not exists cambio numeric;

-- 2) Rellenar las notas existentes (todas en BRL hasta ahora)
update public.eventos
  set valor_brl = valor
  where valor_brl is null;

-- 3) Categoría "IOF" para todos los usuarios (rol conductor) que no la tengan.
--    La línea automática de IOF se guarda con esta categoría.
insert into public.categorias (user_id, nome)
select p.id, 'IOF'
from public.profiles p
where p.role = 'conductor'
  and not exists (
    select 1 from public.categorias c
    where c.user_id = p.id and c.nome = 'IOF'
  );
