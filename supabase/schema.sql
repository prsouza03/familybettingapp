-- Family Picks: database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run again.

-- ---------- Tables ----------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null, -- null = a player without an account (admin enters their picks)
  name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.fixtures (
  id text primary key,                 -- e.g. espn-401234567
  week_id date not null,               -- the Saturday
  league text not null,                -- e.g. eng.4
  kickoff timestamptz not null,
  home text not null,
  away text not null,
  home_full text,
  away_full text,
  home_score int,
  away_score int,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ft', 'postponed', 'abandoned', 'cancelled')),
  clock text,
  manual_status boolean not null default false, -- admin set the status by hand: the updater will not change it
  updated_at timestamptz not null default now()
);
create index if not exists fixtures_week on public.fixtures (week_id);

create table if not exists public.picks (
  id bigint generated always as identity primary key,
  week_id date not null,
  player_id uuid not null references public.players(id) on delete cascade,
  fixture_id text not null references public.fixtures(id) on delete cascade,
  slot int not null check (slot between 1 and 10),
  replacement_fixture_id text references public.fixtures(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (week_id, player_id, fixture_id),
  unique (week_id, player_id, slot)
);
create index if not exists picks_week on public.picks (week_id);

create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  week_id date,
  source text,
  fixtures int,
  errors text
);

-- ---------- Helpers ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where user_id = auth.uid() and is_admin);
$$;

create or replace function public.my_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where user_id = auth.uid();
$$;

-- Picks lock at 3pm UK time on the Saturday (handles GMT and BST).
create or replace function public.pick_deadline(week date) returns timestamptz
language sql immutable as $$
  select (week::timestamp + interval '15 hours') at time zone 'Europe/London';
$$;

-- New sign-ups get a player row. The very first person to sign up is the admin.
-- If the admin already added this person by name (no account yet), the account is linked to them,
-- so their earlier weeks stay theirs.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nm text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  existing uuid;
begin
  select id into existing from players where user_id is null and lower(name) = lower(nm) order by created_at limit 1;
  if existing is not null then
    update players set user_id = new.id where id = existing;
  else
    insert into players (user_id, name, is_admin)
    values (new.id, nm, not exists (select 1 from players where is_admin));
  end if;
  return new;
end $$;

-- The admin can set a new password for a player who forgot theirs (there is no email to reset with).
create or replace function public.admin_reset_password(player uuid, new_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can reset passwords'; end if;
  if length(new_password) < 6 then raise exception 'Passwords need at least 6 characters'; end if;
  update auth.users set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now()
  where id = (select user_id from players where id = player);
  if not found then raise exception 'That player has no account'; end if;
end $$;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Results updater (scheduled job, or the admin's refresh button).
-- rows: fixtures as JSON. leagues: the leagues that were fetched successfully.
-- A 3pm match in one of those leagues that is no longer listed at 3pm counts as postponed.
create or replace function public.sync_fixtures(week date, rows jsonb, leagues text[], source text default 'job')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the admin can update results';
  end if;

  insert into fixtures as f (id, week_id, league, kickoff, home, away, home_full, away_full,
                             home_score, away_score, status, clock, updated_at)
  select r.id, week, r.league, r.kickoff, r.home, r.away, r.home_full, r.away_full,
         r.home_score, r.away_score, r.status, r.clock, now()
  from jsonb_to_recordset(rows) as r(id text, league text, kickoff timestamptz, home text, away text,
       home_full text, away_full text, home_score int, away_score int, status text, clock text)
  on conflict (id) do update set
    kickoff = excluded.kickoff,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    status = case when f.manual_status then f.status else excluded.status end,
    clock = excluded.clock,
    updated_at = now();
  get diagnostics n = row_count;

  update fixtures set status = 'postponed', updated_at = now()
  where week_id = week and league = any(leagues) and not manual_status
    and status = 'scheduled'
    and id not in (select r->>'id' from jsonb_array_elements(rows) r);

  insert into sync_log (week_id, source, fixtures) values (week, source, n);
  return n;
end $$;

revoke all on function public.sync_fixtures(date, jsonb, text[], text) from public, anon;
grant execute on function public.sync_fixtures(date, jsonb, text[], text) to authenticated, service_role;

-- ---------- Security (row level security) ----------

alter table public.players enable row level security;
alter table public.fixtures enable row level security;
alter table public.picks enable row level security;
alter table public.sync_log enable row level security;

drop policy if exists players_read on public.players;
create policy players_read on public.players for select to authenticated using (true);
drop policy if exists players_admin on public.players;
create policy players_admin on public.players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists players_rename_self on public.players;
create policy players_rename_self on public.players for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Players can change only their name; only an admin can make someone an admin.
revoke update on public.players from authenticated;
grant update (name) on public.players to authenticated;
grant insert, delete on public.players to authenticated;

drop policy if exists fixtures_read on public.fixtures;
create policy fixtures_read on public.fixtures for select to authenticated using (true);
drop policy if exists fixtures_admin on public.fixtures;
create policy fixtures_admin on public.fixtures for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists sync_log_read on public.sync_log;
create policy sync_log_read on public.sync_log for select to authenticated using (true);

-- Everyone sees their own picks; other people's picks appear at 3pm.
drop policy if exists picks_read on public.picks;
create policy picks_read on public.picks for select to authenticated using (
  player_id = public.my_player_id() or now() >= public.pick_deadline(week_id) or public.is_admin()
);
drop policy if exists picks_insert on public.picks;
create policy picks_insert on public.picks for insert to authenticated with check (
  public.is_admin()
  or (player_id = public.my_player_id() and now() < public.pick_deadline(week_id)
      and exists (select 1 from fixtures f where f.id = fixture_id and f.week_id = picks.week_id))
);
drop policy if exists picks_delete on public.picks;
create policy picks_delete on public.picks for delete to authenticated using (
  public.is_admin() or (player_id = public.my_player_id() and now() < public.pick_deadline(week_id))
);
-- After 3pm a player may choose a replacement only for a match that is off.
drop policy if exists picks_replace on public.picks;
create policy picks_replace on public.picks for update to authenticated
  using (public.is_admin() or player_id = public.my_player_id())
  with check (
    public.is_admin() or (
      player_id = public.my_player_id()
      and exists (select 1 from fixtures f where f.id = fixture_id and f.status in ('postponed', 'abandoned', 'cancelled'))
    )
  );
revoke update on public.picks from authenticated;
grant update (replacement_fixture_id) on public.picks to authenticated;
grant select, insert, delete on public.picks to authenticated;
grant select on public.fixtures, public.players, public.sync_log to authenticated;
grant insert, update, delete on public.fixtures to authenticated;

-- Who has entered this week (and how many picks), without showing their picks before 3pm.
create or replace function public.week_entries(week date)
returns table (player_id uuid, picks int)
language sql stable security definer set search_path = public as $$
  select player_id, count(*)::int from picks where week_id = week group by player_id;
$$;
revoke all on function public.week_entries(date) from public, anon;
grant execute on function public.week_entries(date) to authenticated;
