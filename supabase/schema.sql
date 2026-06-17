-- =====================================================================
--  ESQUEMA DE BASE DE DATOS — App de Notas Fiscais (Dimitry)
--  Ejecutar UNA VEZ en Supabase:  SQL Editor → New query → pegar → Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PERFILES: cada usuario tiene un rol (conductor o admin)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  role        text not null default 'conductor' check (role in ('conductor', 'admin')),
  criado_em   timestamptz not null default now()
);

-- Crea automáticamente el perfil al registrarse un usuario (rol conductor por defecto).
-- Al admin lo promovés manualmente (ver más abajo).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), 'conductor');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: ¿el usuario actual es admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- 2) EVENTOS: cada nota fiscal cargada
--    El "id" es un número único, secuencial e INMUTABLE (generado por la BD).
--    En pantalla se muestra como código legible: DMT-000123
-- ---------------------------------------------------------------------
create table if not exists public.eventos (
  id              bigint generated always as identity primary key,
  conductor_id    uuid not null references auth.users(id) on delete cascade,
  fornecedor      text,
  valor           numeric(12,2),
  moeda           text default 'BRL',
  centro_custo    text,                 -- elegido por el conductor (lista fija)
  data_documento  date,                 -- fecha de la nota (para filtrar por mes/año)
  categoria       text,                 -- elegida de la lista fija (sugerida por IA)
  tipo_pagamento  text check (tipo_pagamento in ('debito', 'credito', 'outro')),
  ultimos4        text,                 -- últimos 4 dígitos de la tarjeta
  descricao       text,
  confianca       text,                 -- alta / media / baixa (confianza de la IA)
  foto_path       text not null,        -- ruta del archivo en Storage (bucket "notas")
  criado_em       timestamptz not null default now()
);

create index if not exists eventos_conductor_idx on public.eventos (conductor_id);
create index if not exists eventos_data_idx on public.eventos (data_documento);

-- ---------------------------------------------------------------------
-- 3) SEGURIDAD POR ROL (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.eventos  enable row level security;

-- Perfiles: cada uno ve el suyo; el admin ve todos.
drop policy if exists "perfil visible" on public.profiles;
create policy "perfil visible" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Eventos:
--  - conductor ve SOLO los suyos; admin ve todos
drop policy if exists "eventos select" on public.eventos;
create policy "eventos select" on public.eventos
  for select using (conductor_id = auth.uid() or public.is_admin());

--  - el conductor solo puede insertar eventos a su propio nombre (el admin no carga)
drop policy if exists "eventos insert" on public.eventos;
create policy "eventos insert" on public.eventos
  for insert with check (conductor_id = auth.uid());

--  - el conductor puede borrar SUS cargas indebidas; el admin puede borrar cualquiera
drop policy if exists "eventos delete" on public.eventos;
create policy "eventos delete" on public.eventos
  for delete using (conductor_id = auth.uid() or public.is_admin());

--  - solo el admin puede editar (el conductor NUNCA toca el ID ni los datos guardados)
drop policy if exists "eventos update" on public.eventos;
create policy "eventos update" on public.eventos
  for update using (public.is_admin());

-- ---------------------------------------------------------------------
-- 4) STORAGE: bucket privado "notas" para las fotos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('notas', 'notas', false)
on conflict (id) do nothing;

-- Las fotos se guardan en la carpeta del conductor: notas/<conductor_id>/<archivo>
-- Conductor: sube / ve / borra SOLO en su carpeta. Admin: ve todo.
drop policy if exists "notas insert" on storage.objects;
create policy "notas insert" on storage.objects
  for insert with check (
    bucket_id = 'notas' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "notas select" on storage.objects;
create policy "notas select" on storage.objects
  for select using (
    bucket_id = 'notas' and (
      (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    )
  );

drop policy if exists "notas delete" on storage.objects;
create policy "notas delete" on storage.objects
  for delete using (
    bucket_id = 'notas' and (
      (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    )
  );

-- =====================================================================
--  DESPUÉS de crear tu usuario admin (registrándote en la app o en
--  Authentication → Users), convertilo en admin ejecutando:
--
--    update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'TU_EMAIL_ADMIN');
-- =====================================================================
