-- Migração 7: erros do app passam a ser "marcados como vistos" em vez de apagados.
-- O histórico fica guardado (serve para analisar erros recorrentes); o botão
-- 🩺 só conta os que ninguém viu ainda.
-- Rodar no Supabase: SQL Editor → colar → Run.

alter table public.erros_app
  add column if not exists visto_em timestamptz;   -- null = ainda não visto

-- O admin marca como visto (update); a escrita continua só pelo servidor.
drop policy if exists "erros update" on public.erros_app;
create policy "erros update" on public.erros_app
  for update using (public.is_admin()) with check (public.is_admin());

create index if not exists erros_app_nao_vistos
  on public.erros_app (id) where visto_em is null;
