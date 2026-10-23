-- Nosso Financeiro • esquema de sincronização e autenticação com Supabase
-- Configuração repetível: recria apenas as políticas RLS se já existirem.
-- Não remove tabelas nem movimentos financeiros.
-- NÃO compartilhar chaves service_role nem executar sem revisar o projeto de destino.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('v','t')),
  joined_at timestamptz not null default now(),
  primary key (household_id,user_id),
  unique (household_id,slot),
  unique (user_id)
);

create table if not exists public.household_invites (
  code uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  issued_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now()+interval '48 hours'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  household_id uuid not null references public.households(id) on delete cascade,
  code text not null check (code in ('v','t','shared')),
  label text not null,
  primary key (household_id,code)
);

create table if not exists public.goals (
  household_id uuid not null references public.households(id) on delete cascade,
  code text not null,
  label text not null,
  target numeric(14,2) not null default 0 check(target >= 0),
  primary key (household_id,code)
);

create table if not exists public.person_settings (
  household_id uuid not null references public.households(id) on delete cascade,
  slot text not null check (slot in ('v','t')),
  salary numeric(14,2) not null default 0 check(salary >= 0),
  primary key (household_id,slot)
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check(kind in ('income','expense','transfer','goal','withdraw')),
  person text not null check(person in ('v','t')),
  author_id uuid not null references auth.users(id),
  amount numeric(14,2) not null check(amount > 0),
  from_code text,
  to_code text,
  goal_code text,
  category text not null default 'Outros',
  description text not null default '',
  occurred_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id,from_code) references public.accounts(household_id,code),
  foreign key (household_id,to_code) references public.accounts(household_id,code),
  foreign key (household_id,goal_code) references public.goals(household_id,code),
  constraint valid_movement check(
    (kind='income'   and from_code is null and to_code is not null and goal_code is null)
    or (kind='expense'  and from_code is not null and to_code is null and goal_code is null)
    or (kind='transfer' and from_code is not null and to_code is not null and from_code<>to_code and goal_code is null)
    or (kind='goal' and from_code is not null and to_code is null and goal_code is not null)
    or (kind='withdraw' and from_code is null and to_code is not null and goal_code is not null)
  )
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  sender_slot text not null check(sender_slot in ('v','t')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists movements_by_household_date on public.movements(household_id,occurred_on desc);
create index if not exists chat_by_household_date on public.chat_messages(household_id,created_at);

-- FUNÇÕES SECURITY DEFINER isolam a leitura dos membros para evitar recursão RLS.
create or replace function public.is_household_member(p_household uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.household_members m
where m.household_id=p_household and m.user_id=(select auth.uid())); $$;

create or replace function public.current_household()
returns uuid language sql stable security definer set search_path=''
as $$ select m.household_id from public.household_members m
where m.user_id=(select auth.uid()) limit 1; $$;

create or replace function public.my_slot(p_household uuid)
returns text language sql stable security definer set search_path=''
as $$ select m.slot from public.household_members m
where m.household_id=p_household and m.user_id=(select auth.uid()) limit 1; $$;

create or replace function public.create_household(p_name text default 'Nosso Financeiro')
returns uuid language plpgsql security definer set search_path=''
as $$
declare hid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Autenticação obrigatória'; end if;
 if exists(select 1 from public.household_members where user_id=uid)
 then raise exception 'Usuário já pertence a uma família'; end if;
 insert into public.households(name,created_by) values(left(p_name,100),uid) returning id into hid;
 insert into public.household_members(household_id,user_id,slot) values(hid,uid,'v');
 insert into public.accounts(household_id,code,label)
 values(hid,'v','Vithor'),(hid,'t','Thaynara'),(hid,'shared','Conjunta');
 insert into public.goals(household_id,code,label,target)
 values
 (hid,'casamento','Casamento',30000),
 (hid,'casa','Nossa Casa',100000),
 (hid,'viagens','Viagens',8000),
 (hid,'seguranca','Reserva de Segurança do Casal',15000),
 (hid,'emergencia','Emergência',10000),
 (hid,'reserva_v','Reserva individual Vithor',0),
 (hid,'reserva_t','Reserva individual Thaynara',0),
 (hid,'invest_v','Investimentos Vithor',10000),
 (hid,'invest_t','Investimentos Thaynara',10000);
 insert into public.person_settings(household_id,slot) values(hid,'v'),(hid,'t');
 return hid;
end; $$;

create or replace function public.create_partner_invite()
returns uuid language plpgsql security definer set search_path=''
as $$
declare hid uuid; result uuid;
begin
 hid:=public.current_household();
 if hid is null then raise exception 'Família não encontrada'; end if;
 if public.my_slot(hid) <> 'v' then raise exception 'Apenas o criador pode convidar'; end if;
 if exists(select 1 from public.household_members where household_id=hid and slot='t')
 then raise exception 'Parceiro já conectado'; end if;
 insert into public.household_invites(household_id,issued_by)
 values(hid,auth.uid()) returning code into result;
 return result;
end; $$;

create or replace function public.join_partner_by_invite(p_code uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare inv public.household_invites%rowtype; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Autenticação obrigatória'; end if;
 if exists(select 1 from public.household_members where user_id=uid)
 then raise exception 'Usuário já pertence a uma família'; end if;
 select * into inv from public.household_invites
 where code=p_code and used_at is null and expires_at>now() for update;
 if not found then raise exception 'Convite inválido ou expirado'; end if;
 insert into public.household_members(household_id,user_id,slot)
 values(inv.household_id,uid,'t');
 update public.household_invites set used_at=now() where code=p_code;
 return inv.household_id;
end; $$;

-- Bloquear acesso direto às tabelas de convites; somente RPC validada.
revoke all on public.household_invites from anon,authenticated;
revoke all on function public.is_household_member(uuid) from public,anon;
revoke all on function public.current_household() from public,anon;
revoke all on function public.my_slot(uuid) from public,anon;
revoke all on function public.create_household(text) from public,anon;
revoke all on function public.create_partner_invite() from public,anon;
revoke all on function public.join_partner_by_invite(uuid) from public,anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.current_household() to authenticated;
grant execute on function public.my_slot(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_partner_invite() to authenticated;
grant execute on function public.join_partner_by_invite(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.accounts enable row level security;
alter table public.goals enable row level security;
alter table public.person_settings enable row level security;
alter table public.movements enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists household_read on public.households;
create policy household_read on public.households for select to authenticated
 using(public.is_household_member(id));
drop policy if exists member_read on public.household_members;
create policy member_read on public.household_members for select to authenticated
 using(public.is_household_member(household_id));
drop policy if exists account_read on public.accounts;
create policy account_read on public.accounts for select to authenticated
 using(public.is_household_member(household_id));
drop policy if exists goal_read on public.goals;
create policy goal_read on public.goals for select to authenticated
 using(public.is_household_member(household_id));
drop policy if exists goal_update on public.goals;
create policy goal_update on public.goals for update to authenticated
 using(public.is_household_member(household_id))
 with check(public.is_household_member(household_id));
drop policy if exists settings_read on public.person_settings;
create policy settings_read on public.person_settings for select to authenticated
 using(public.is_household_member(household_id));
drop policy if exists settings_update on public.person_settings;
create policy settings_update on public.person_settings for update to authenticated
 using(public.is_household_member(household_id))
 with check(public.is_household_member(household_id));
drop policy if exists movements_read on public.movements;
create policy movements_read on public.movements for select to authenticated
 using(public.is_household_member(household_id));
drop policy if exists movements_insert on public.movements;
create policy movements_insert on public.movements for insert to authenticated
 with check(public.is_household_member(household_id)
   and author_id=auth.uid()
   and person=public.my_slot(household_id));
drop policy if exists movements_update on public.movements;
create policy movements_update on public.movements for update to authenticated
 using(public.is_household_member(household_id) and author_id=auth.uid())
 with check(public.is_household_member(household_id)
   and author_id=auth.uid() and person=public.my_slot(household_id));
drop policy if exists movements_delete on public.movements;
create policy movements_delete on public.movements for delete to authenticated
 using(public.is_household_member(household_id) and author_id=auth.uid());
drop policy if exists messages_read on public.chat_messages;
create policy messages_read on public.chat_messages for select to authenticated
 using(public.is_household_member(household_id));
drop policy if exists messages_insert on public.chat_messages;
create policy messages_insert on public.chat_messages for insert to authenticated
 with check(public.is_household_member(household_id)
 and sender_id=auth.uid() and sender_slot=public.my_slot(household_id));

-- Gratuidade e permissões: habilitar publicações de mudanças para clientes autorizados.
do $$ begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='movements')
 then alter publication supabase_realtime add table public.movements; end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='goals')
 then alter publication supabase_realtime add table public.goals; end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='person_settings')
 then alter publication supabase_realtime add table public.person_settings; end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages')
 then alter publication supabase_realtime add table public.chat_messages; end if;
end $$;
