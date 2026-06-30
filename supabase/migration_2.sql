-- ============================================================
--  MIGRACIÓN 2
--  - Tarjetas (cartões) por usuario
--  - Edición/borrado de rendiciones hasta 30 días
--  - Eliminar "centro de custo"
--  Ejecutar UNA VEZ en Supabase: SQL Editor → New query → pegar → Run
-- ============================================================

-- 1) TARJETAS POR USUARIO -------------------------------------
create table if not exists public.cartoes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  ultimos4   text not null,
  apelido    text,
  criado_em  timestamptz not null default now()
);
create index if not exists cartoes_user_idx on public.cartoes(user_id);

alter table public.cartoes enable row level security;

-- el usuario ve sus tarjetas; el admin ve todas
drop policy if exists "cartoes select" on public.cartoes;
create policy "cartoes select" on public.cartoes
  for select using (user_id = auth.uid() or public.is_admin());

-- solo el admin crea / edita / borra tarjetas
drop policy if exists "cartoes insert" on public.cartoes;
create policy "cartoes insert" on public.cartoes
  for insert with check (public.is_admin());

drop policy if exists "cartoes update" on public.cartoes;
create policy "cartoes update" on public.cartoes
  for update using (public.is_admin());

drop policy if exists "cartoes delete" on public.cartoes;
create policy "cartoes delete" on public.cartoes
  for delete using (public.is_admin());

-- 1b) CATEGORÍAS POR USUARIO ---------------------------------
create table if not exists public.categorias (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  nome       text not null,
  criado_em  timestamptz not null default now()
);
create index if not exists categorias_user_idx on public.categorias(user_id);

alter table public.categorias enable row level security;

-- el usuario ve sus categorías; el admin ve todas
drop policy if exists "categorias select" on public.categorias;
create policy "categorias select" on public.categorias
  for select using (user_id = auth.uid() or public.is_admin());

-- solo el admin crea / edita / borra categorías
drop policy if exists "categorias insert" on public.categorias;
create policy "categorias insert" on public.categorias
  for insert with check (public.is_admin());

drop policy if exists "categorias update" on public.categorias;
create policy "categorias update" on public.categorias
  for update using (public.is_admin());

drop policy if exists "categorias delete" on public.categorias;
create policy "categorias delete" on public.categorias
  for delete using (public.is_admin());

-- 2) EDICIÓN / BORRADO HASTA 30 DÍAS --------------------------
-- El usuario puede editar y borrar SUS notas hasta 30 días después
-- de creadas. El admin puede siempre.
drop policy if exists "eventos update" on public.eventos;
create policy "eventos update" on public.eventos
  for update using (
    public.is_admin()
    or (conductor_id = auth.uid() and criado_em > now() - interval '30 days')
  ) with check (
    public.is_admin() or conductor_id = auth.uid()
  );

drop policy if exists "eventos delete" on public.eventos;
create policy "eventos delete" on public.eventos
  for delete using (
    public.is_admin()
    or (conductor_id = auth.uid() and criado_em > now() - interval '30 days')
  );

-- 3) ELIMINAR CENTRO DE CUSTO ---------------------------------
alter table public.eventos drop column if exists centro_custo;
