-- ============================================================
--  MIGRACIÓN 3
--  - Centros de custo por usuario (+ columna centro_custo)
--  - Rol "supervisor" (semi-admin) con alcance por usuario
--  Ejecutar UNA VEZ en Supabase: SQL Editor → pegar → Run
-- ============================================================

-- 1) Permitir el rol "supervisor" ------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('conductor', 'admin', 'supervisor'));

-- 2) Centros de custo por usuario -----------------------------
create table if not exists public.centros_custo (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  nome       text not null,
  criado_em  timestamptz not null default now()
);
create index if not exists centros_user_idx on public.centros_custo(user_id);

alter table public.centros_custo enable row level security;
drop policy if exists "centros select" on public.centros_custo;
create policy "centros select" on public.centros_custo
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "centros insert" on public.centros_custo;
create policy "centros insert" on public.centros_custo
  for insert with check (public.is_admin());
drop policy if exists "centros update" on public.centros_custo;
create policy "centros update" on public.centros_custo
  for update using (public.is_admin());
drop policy if exists "centros delete" on public.centros_custo;
create policy "centros delete" on public.centros_custo
  for delete using (public.is_admin());

-- 3) Volver a agregar la columna centro_custo en las notas -----
alter table public.eventos add column if not exists centro_custo text;

-- 4) Alcance de cada supervisor (qué usuarios puede ver) -------
create table if not exists public.supervisor_escopo (
  supervisor_id uuid not null references auth.users(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  primary key (supervisor_id, user_id)
);
alter table public.supervisor_escopo enable row level security;
drop policy if exists "escopo select" on public.supervisor_escopo;
create policy "escopo select" on public.supervisor_escopo
  for select using (supervisor_id = auth.uid() or public.is_admin());
drop policy if exists "escopo insert" on public.supervisor_escopo;
create policy "escopo insert" on public.supervisor_escopo
  for insert with check (public.is_admin());
drop policy if exists "escopo delete" on public.supervisor_escopo;
create policy "escopo delete" on public.supervisor_escopo
  for delete using (public.is_admin());

-- 5) Helper: ¿el supervisor actual puede ver a este usuario? ---
create or replace function public.pode_ver_usuario(target uuid)
returns boolean
language sql security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.supervisor_escopo se
    where se.supervisor_id = auth.uid() and se.user_id = target
  );
$$;

-- 6) Incluir el alcance del supervisor en la LECTURA -----------
--    (el supervisor NO borra ni edita: solo estas policies de select cambian)
drop policy if exists "eventos select" on public.eventos;
create policy "eventos select" on public.eventos
  for select using (
    conductor_id = auth.uid()
    or public.is_admin()
    or public.pode_ver_usuario(conductor_id)
  );

drop policy if exists "perfil visible" on public.profiles;
create policy "perfil visible" on public.profiles
  for select using (
    id = auth.uid()
    or public.is_admin()
    or public.pode_ver_usuario(id)
  );

drop policy if exists "notas select" on storage.objects;
create policy "notas select" on storage.objects
  for select using (
    bucket_id = 'notas' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.pode_ver_usuario(((storage.foldername(name))[1])::uuid)
    )
  );
