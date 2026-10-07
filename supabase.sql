-- Úthírnök — Supabase adatbázis
-- Supabase → SQL Editor → New query → másold be az egészet → Run

create extension if not exists pgcrypto;

-- Közösségi jelzések
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('police','camera','accident','jam','closure','hazard','parking')),
  sub         text,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  heading     real,
  note        text check (char_length(note) <= 120),
  nick        text check (char_length(nick) <= 24),
  user_id     text,
  up          int not null default 1,
  down        int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists reports_geo on public.reports (lat, lng);
create index if not exists reports_exp on public.reports (expires_at);

-- Benzinárak (OSM benzinkút-azonosítóhoz kötve)
create table if not exists public.fuel_prices (
  id          bigserial primary key,
  station_id  text not null,
  fuel        text not null check (fuel in ('95','100','diesel','lpg')),
  price       int  not null check (price between 300 and 1200),
  nick        text check (char_length(nick) <= 24),
  user_id     text,
  created_at  timestamptz not null default now()
);
create index if not exists fuel_station on public.fuel_prices (station_id, created_at desc);

-- Jogosultságok (RLS): bárki olvashat és beküldhet, módosítani csak szavazással lehet
alter table public.reports enable row level security;
alter table public.fuel_prices enable row level security;

drop policy if exists "reports read" on public.reports;
create policy "reports read" on public.reports for select using (true);
drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports for insert
  with check (up = 1 and down = 0 and expires_at <= now() + interval '31 days' and expires_at > now());

drop policy if exists "fuel read" on public.fuel_prices;
create policy "fuel read" on public.fuel_prices for select using (true);
drop policy if exists "fuel insert" on public.fuel_prices;
create policy "fuel insert" on public.fuel_prices for insert with check (true);

-- Szavazás: "még ott van" (+1) meghosszabbítja, "már nincs" (-1) gyengíti
create or replace function public.vote_report(rid uuid, val int)
returns void language sql security definer set search_path = public as $$
  update reports set
    up   = up   + case when val > 0 then 1 else 0 end,
    down = down + case when val < 0 then 1 else 0 end,
    expires_at = case when val > 0
      then greatest(expires_at, now() + (expires_at - created_at) / 2)
      else expires_at end
  where id = rid and expires_at > now();
$$;
grant execute on function public.vote_report(uuid, int) to anon;

-- Lejárt jelzések takarítása (opcionális: Database → Cron-nal naponta futtatható)
-- delete from public.reports where expires_at < now() - interval '1 day';
