-- BillsSplit Lite schema
-- No OCR, no scanning.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  description text not null,
  expense_date date not null,
  paid_by uuid not null references public.profiles (id),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  total_cents integer not null check (total_cents > 0),
  notes text,
  split_mode text not null check (split_mode in ('equal', 'exact', 'percent', 'shares', 'itemized')),
  created_by uuid not null references public.profiles (id),
  updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  name text not null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  participant_id uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents > 0),
  item_id uuid references public.expense_items (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_member_id uuid not null references public.profiles (id),
  to_member_id uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents > 0),
  payment_date date not null,
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint payment_members_distinct check (from_member_id <> to_member_id)
);

create index if not exists idx_group_members_user_id on public.group_members (user_id);
create index if not exists idx_invites_group_id on public.invites (group_id);
create index if not exists idx_invites_token on public.invites (token);
create index if not exists idx_expenses_group_id_date on public.expenses (group_id, expense_date desc);
create index if not exists idx_expense_items_expense_id on public.expense_items (expense_id);
create index if not exists idx_expense_splits_expense_id on public.expense_splits (expense_id);
create index if not exists idx_expense_splits_participant on public.expense_splits (participant_id);
create index if not exists idx_payments_group_id_date on public.payments (group_id, payment_date desc);

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_groups_updated_at
before update on public.groups
for each row
execute function public.set_updated_at();

create trigger set_expenses_updated_at
before update on public.expenses
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), 'Member')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

create or replace function public.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = target_group_id
      and gm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;

create or replace function public.get_invite_info(invite_token text)
returns table (
  group_id uuid,
  group_name text,
  currency_code text,
  expires_at timestamptz,
  is_expired boolean,
  already_member boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.group_id,
    g.name as group_name,
    g.currency_code,
    i.expires_at,
    i.expires_at < now() as is_expired,
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = i.group_id
        and gm.user_id = auth.uid()
    ) as already_member
  from public.invites i
  join public.groups g on g.id = i.group_id
  where i.token = invite_token
  limit 1;
$$;

revoke all on function public.get_invite_info(text) from public;
grant execute on function public.get_invite_info(text) to authenticated;

create or replace function public.join_group_with_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_record public.invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into invite_record
  from public.invites
  where token = invite_token
  limit 1;

  if not found then
    raise exception 'Invite not found';
  end if;

  if invite_record.expires_at < now() then
    raise exception 'Invite expired';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (invite_record.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return invite_record.group_id;
end;
$$;

revoke all on function public.join_group_with_invite(text) from public;
grant execute on function public.join_group_with_invite(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_items enable row level security;
alter table public.expense_splits enable row level security;
alter table public.payments enable row level security;

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy
on public.profiles
for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.group_members gm_self
    join public.group_members gm_other on gm_other.group_id = gm_self.group_id
    where gm_self.user_id = auth.uid()
      and gm_other.user_id = profiles.id
  )
);

drop policy if exists profiles_insert_policy on public.profiles;
create policy profiles_insert_policy
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists groups_select_policy on public.groups;
create policy groups_select_policy
on public.groups
for select
using (public.is_group_member(id));

drop policy if exists groups_insert_policy on public.groups;
create policy groups_insert_policy
on public.groups
for insert
with check (created_by = auth.uid());

drop policy if exists groups_update_policy on public.groups;
create policy groups_update_policy
on public.groups
for update
using (public.is_group_member(id))
with check (public.is_group_member(id));

drop policy if exists groups_delete_policy on public.groups;
create policy groups_delete_policy
on public.groups
for delete
using (created_by = auth.uid());

drop policy if exists group_members_select_policy on public.group_members;
create policy group_members_select_policy
on public.group_members
for select
using (public.is_group_member(group_id));

drop policy if exists group_members_insert_policy on public.group_members;
create policy group_members_insert_policy
on public.group_members
for insert
with check (public.is_group_member(group_id));

drop policy if exists group_members_delete_policy on public.group_members;
create policy group_members_delete_policy
on public.group_members
for delete
using (public.is_group_member(group_id) or user_id = auth.uid());

drop policy if exists invites_select_policy on public.invites;
create policy invites_select_policy
on public.invites
for select
using (public.is_group_member(group_id));

drop policy if exists invites_insert_policy on public.invites;
create policy invites_insert_policy
on public.invites
for insert
with check (public.is_group_member(group_id));

drop policy if exists invites_update_policy on public.invites;
create policy invites_update_policy
on public.invites
for update
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));

drop policy if exists invites_delete_policy on public.invites;
create policy invites_delete_policy
on public.invites
for delete
using (public.is_group_member(group_id));

drop policy if exists expenses_select_policy on public.expenses;
create policy expenses_select_policy
on public.expenses
for select
using (public.is_group_member(group_id));

drop policy if exists expenses_insert_policy on public.expenses;
create policy expenses_insert_policy
on public.expenses
for insert
with check (
  public.is_group_member(group_id)
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and exists (
    select 1 from public.group_members gm
    where gm.group_id = expenses.group_id
      and gm.user_id = expenses.paid_by
  )
);

drop policy if exists expenses_update_policy on public.expenses;
create policy expenses_update_policy
on public.expenses
for update
using (public.is_group_member(group_id))
with check (
  public.is_group_member(group_id)
  and updated_by = auth.uid()
);

drop policy if exists expenses_delete_policy on public.expenses;
create policy expenses_delete_policy
on public.expenses
for delete
using (public.is_group_member(group_id));

drop policy if exists expense_items_select_policy on public.expense_items;
create policy expense_items_select_policy
on public.expense_items
for select
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_items.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists expense_items_insert_policy on public.expense_items;
create policy expense_items_insert_policy
on public.expense_items
for insert
with check (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_items.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists expense_items_update_policy on public.expense_items;
create policy expense_items_update_policy
on public.expense_items
for update
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_items.expense_id
      and public.is_group_member(e.group_id)
  )
)
with check (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_items.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists expense_items_delete_policy on public.expense_items;
create policy expense_items_delete_policy
on public.expense_items
for delete
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_items.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists expense_splits_select_policy on public.expense_splits;
create policy expense_splits_select_policy
on public.expense_splits
for select
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_splits.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists expense_splits_insert_policy on public.expense_splits;
create policy expense_splits_insert_policy
on public.expense_splits
for insert
with check (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_splits.expense_id
      and public.is_group_member(e.group_id)
  )
  and exists (
    select 1
    from public.expenses e
    join public.group_members gm on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id
      and gm.user_id = expense_splits.participant_id
  )
);

drop policy if exists expense_splits_update_policy on public.expense_splits;
create policy expense_splits_update_policy
on public.expense_splits
for update
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_splits.expense_id
      and public.is_group_member(e.group_id)
  )
)
with check (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_splits.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists expense_splits_delete_policy on public.expense_splits;
create policy expense_splits_delete_policy
on public.expense_splits
for delete
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_splits.expense_id
      and public.is_group_member(e.group_id)
  )
);

drop policy if exists payments_select_policy on public.payments;
create policy payments_select_policy
on public.payments
for select
using (public.is_group_member(group_id));

drop policy if exists payments_insert_policy on public.payments;
create policy payments_insert_policy
on public.payments
for insert
with check (
  public.is_group_member(group_id)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = payments.group_id
      and gm.user_id = payments.from_member_id
  )
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = payments.group_id
      and gm.user_id = payments.to_member_id
  )
);

drop policy if exists payments_update_policy on public.payments;
create policy payments_update_policy
on public.payments
for update
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));

drop policy if exists payments_delete_policy on public.payments;
create policy payments_delete_policy
on public.payments
for delete
using (public.is_group_member(group_id));
