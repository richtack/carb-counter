-- ============================================================================
-- Log later: private pending notes, scoped credentials, and atomic resolution
--
-- Run once in Supabase SQL Editor after supabase-setup.sql. Safe to re-run.
-- Pending data has NO anon/authenticated Data API access. The log-later Edge
-- Function uses service_role after authenticating a per-person bearer token.
-- ============================================================================

begin;

create extension if not exists "pgcrypto";

create table if not exists public.log_later_credentials (
  id           uuid primary key default gen_random_uuid(),
  owner        text not null check (char_length(owner) between 1 and 50),
  scope        text not null check (scope in ('capture', 'manage')),
  label        text not null default '',
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create table if not exists public.pending_food_items (
  id                    uuid primary key default gen_random_uuid(),
  owner                 text not null check (char_length(owner) between 1 and 50),
  request_id            uuid not null,
  credential_id         uuid not null references public.log_later_credentials(id),
  note                  text not null check (char_length(btrim(note)) between 1 and 500),
  captured_at           timestamptz not null,
  log_date              date not null,
  local_time            time not null,
  timezone              text not null check (char_length(timezone) between 1 and 100),
  status                text not null default 'pending' check (status in ('pending', 'resolved', 'discarded')),
  version               integer not null default 1 check (version > 0),
  resolution_request_id uuid,
  resolved_at           timestamptz,
  discarded_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (owner, request_id)
);

alter table public.pending_food_items add column if not exists local_time time;
update public.pending_food_items set local_time = captured_at::time where local_time is null;
alter table public.pending_food_items alter column local_time set not null;

drop index if exists public.pending_food_items_owner_status_date_idx;
create index if not exists pending_food_items_pending_owner_date_idx
  on public.pending_food_items (owner, log_date, captured_at)
  where status = 'pending';
create index if not exists pending_food_items_credential_created_idx
  on public.pending_food_items (credential_id, created_at desc);

alter table public.entries add column if not exists pending_item_id uuid
  references public.pending_food_items(id) on delete set null;
alter table public.entries add column if not exists pending_item_index integer;
alter table public.entries add column if not exists logged_local_time time;
alter table public.entries add column if not exists logged_timezone text;
create unique index if not exists entries_pending_item_index_unique
  on public.entries (pending_item_id, pending_item_index)
  where pending_item_id is not null;

alter table public.log_later_credentials enable row level security;
alter table public.pending_food_items enable row level security;

-- Explicit grants matter independently of RLS. Neither table is available to
-- the public browser roles, even though older app tables intentionally are.
revoke all on table public.log_later_credentials from anon, authenticated;
revoke all on table public.pending_food_items from anon, authenticated;
revoke all on table public.log_later_credentials from service_role;
revoke all on table public.pending_food_items from service_role;
grant select, update on table public.log_later_credentials to service_role;
grant select, insert, update on table public.pending_food_items to service_role;

create or replace function public.capture_pending_food(
  p_owner text,
  p_credential_id uuid,
  p_request_id uuid,
  p_note text,
  p_captured_at timestamptz,
  p_log_date date,
  p_local_time time,
  p_timezone text
) returns public.pending_food_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.pending_food_items;
  saved public.pending_food_items;
begin
  if p_owner is null or char_length(p_owner) not between 1 and 50
     or p_request_id is null
     or p_note is null or char_length(btrim(p_note)) not between 1 and 500
     or p_captured_at is null or p_log_date is null or p_local_time is null
     or p_timezone is null or char_length(p_timezone) not between 1 and 100 then
    raise exception 'invalid_capture';
  end if;

  select * into existing
    from public.pending_food_items
   where owner = p_owner and request_id = p_request_id;
  if found then
    if existing.note = btrim(p_note)
       and existing.captured_at = p_captured_at
       and existing.log_date = p_log_date
       and existing.local_time = p_local_time
       and existing.timezone = p_timezone then
      return existing;
    end if;
    raise exception 'request_id_conflict';
  end if;

  -- Proportionate protection for a tiny personal endpoint. A credential may
  -- create at most 30 new notes in a rolling 15-minute window. Safe retries do
  -- not count again because the idempotency check above runs first.
  if (select count(*) from public.pending_food_items
       where credential_id = p_credential_id
         and created_at > now() - interval '15 minutes') >= 30 then
    raise exception 'rate_limited';
  end if;

  insert into public.pending_food_items
    (owner, request_id, credential_id, note, captured_at, log_date, local_time, timezone)
  values
    (p_owner, p_request_id, p_credential_id, btrim(p_note), p_captured_at, p_log_date, p_local_time, p_timezone)
  returning * into saved;
  return saved;
exception
  when unique_violation then
    select * into existing
      from public.pending_food_items
     where owner = p_owner and request_id = p_request_id;
    if found
       and existing.note = btrim(p_note)
       and existing.captured_at = p_captured_at
       and existing.log_date = p_log_date
       and existing.local_time = p_local_time
       and existing.timezone = p_timezone then
      return existing;
    end if;
    raise exception 'request_id_conflict';
end;
$$;

create or replace function public.edit_pending_food(
  p_owner text,
  p_item_id uuid,
  p_version integer,
  p_note text
) returns public.pending_food_items
language plpgsql
security invoker
set search_path = ''
as $$
declare saved public.pending_food_items;
begin
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then
    raise exception 'invalid_note';
  end if;
  update public.pending_food_items
     set note = btrim(p_note), version = version + 1, updated_at = now()
   where id = p_item_id and owner = p_owner and status = 'pending' and version = p_version
  returning * into saved;
  if not found then raise exception 'pending_conflict'; end if;
  return saved;
end;
$$;

create or replace function public.discard_pending_food(
  p_owner text,
  p_item_id uuid,
  p_version integer
) returns public.pending_food_items
language plpgsql
security invoker
set search_path = ''
as $$
declare saved public.pending_food_items;
begin
  update public.pending_food_items
     set status = 'discarded', discarded_at = now(), version = version + 1, updated_at = now()
   where id = p_item_id and owner = p_owner and status = 'pending' and version = p_version
  returning * into saved;
  if not found then raise exception 'pending_conflict'; end if;
  return saved;
end;
$$;

create or replace function public.resolve_pending_food(
  p_owner text,
  p_item_id uuid,
  p_version integer,
  p_resolution_request_id uuid,
  p_log_date date,
  p_created_at timestamptz,
  p_local_time time,
  p_timezone text,
  p_items jsonb
) returns table (pending jsonb, entries jsonb, already_resolved boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_item public.pending_food_items;
  food_row public.foods;
  item jsonb;
  item_number integer := 0;
  quantity numeric;
  food_uuid uuid;
  saved_entries jsonb;
begin
  if p_resolution_request_id is null or p_log_date is null or p_created_at is null or p_local_time is null
     or p_timezone is null or char_length(p_timezone) not between 1 and 100
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid_resolution';
  end if;

  select * into current_item
    from public.pending_food_items
   where id = p_item_id and owner = p_owner
   for update;
  if not found then raise exception 'not_found'; end if;

  if current_item.status = 'resolved' then
    if current_item.resolution_request_id <> p_resolution_request_id then
      raise exception 'pending_conflict';
    end if;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.pending_item_index), '[]'::jsonb)
      into saved_entries from public.entries e where e.pending_item_id = current_item.id;
    return query select to_jsonb(current_item), saved_entries, true;
    return;
  end if;

  if current_item.status <> 'pending' or current_item.version <> p_version then
    raise exception 'pending_conflict';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    begin
      food_uuid := (item->>'food_id')::uuid;
      quantity := (item->>'qty')::numeric;
    exception when others then
      raise exception 'invalid_resolution_item';
    end;
    if quantity <= 0 or quantity > 100 then raise exception 'invalid_resolution_item'; end if;
    select * into food_row from public.foods where id = food_uuid;
    if not found then raise exception 'food_not_found'; end if;

    insert into public.entries
      (food_id, name, net_carbs, qty, log_date, person, created_at, calories,
       pending_item_id, pending_item_index, logged_local_time, logged_timezone)
    values
      (food_row.id, food_row.name, food_row.net_carbs, quantity, p_log_date, p_owner,
       p_created_at, food_row.calories, current_item.id, item_number, p_local_time, p_timezone);
    item_number := item_number + 1;
  end loop;

  update public.pending_food_items
     set status = 'resolved', resolution_request_id = p_resolution_request_id,
         resolved_at = now(), version = version + 1, updated_at = now()
   where id = current_item.id
  returning * into current_item;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.pending_item_index), '[]'::jsonb)
    into saved_entries from public.entries e where e.pending_item_id = current_item.id;
  return query select to_jsonb(current_item), saved_entries, false;
end;
$$;

revoke all on function public.capture_pending_food(text, uuid, uuid, text, timestamptz, date, time, text) from public, anon, authenticated;
revoke all on function public.edit_pending_food(text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.discard_pending_food(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.resolve_pending_food(text, uuid, integer, uuid, date, timestamptz, time, text, jsonb) from public, anon, authenticated;
grant execute on function public.capture_pending_food(text, uuid, uuid, text, timestamptz, date, time, text) to service_role;
grant execute on function public.edit_pending_food(text, uuid, integer, text) to service_role;
grant execute on function public.discard_pending_food(text, uuid, integer) to service_role;
grant execute on function public.resolve_pending_food(text, uuid, integer, uuid, date, timestamptz, time, text, jsonb) to service_role;

commit;
