-- =====================================================================
-- TPP Stock Dashboard — Phase 0 schema (DRAFT for review, not yet applied)
-- Project: tpp-dashboard (pwvcufaxiwgnnratbytb)
-- Pattern: RLS enabled + single "Service role full access" policy,
--          mirroring existing products/orders/etc.
-- Applied as 3 small migrations. list_tables before/after each.
-- =====================================================================


-- ---------------------------------------------------------------------
-- MIGRATION 1 of 3:  extend products
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists flavour            text,        -- 'Buttermilk','GF Cinnamon Churro'
  add column if not exists flavour_code       text,        -- 'BM','CH','SC','CC','CI','MA','GFB','GFCI'
  add column if not exists size_code          text,        -- 'S' | 'M' | 'L' | 'SAMPLE'
  add column if not exists unit_size_g        integer,     -- 320 | 520 | 1000 | 80
  add column if not exists serves             integer,     -- 8 | 13 | 25 | 2
  add column if not exists category           text,        -- 'mix'|'syrup'|'accessory'|'component'|'bundle'
  add column if not exists format             text,        -- 'retail' | 'wholesale'
  add column if not exists tier               text not null default 'secondary',  -- 'primary' | 'secondary'
  add column if not exists base_units         numeric,     -- 520g-equivalents: 320=0.615, 520=1.0, 1kg=1.92
  add column if not exists units_per_carton   integer,     -- 4 (SRP) | 12 (PANXLARGE) | 8 (PANXXLARGE) | 50
  add column if not exists carton_type        text,        -- 'SRP'|'PANXLARGE'|'PANXXLARGE'|...
  add column if not exists blend_kg_per_unit  numeric,     -- net blend kg per finished unit (for ABC kg POs)
  add column if not exists shopify_variant_id text,
  add column if not exists active             boolean not null default true,
  add column if not exists updated_at         timestamptz default now();

alter table public.products
  add constraint products_tier_check
  check (tier in ('primary','secondary')) not valid;

alter table public.products
  add constraint products_size_code_check
  check (size_code in ('S','M','L','SAMPLE') or size_code is null) not valid;


-- ---------------------------------------------------------------------
-- MIGRATION 2 of 3:  locations + product_locations (+ seed the 2 sites)
-- ---------------------------------------------------------------------
create table if not exists public.locations (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,                 -- 'ALTONA','MANCHESTER'
  name               text not null,
  type               text not null,                        -- 'finished_3pl'|'blender'|'packaging_supplier'
  country            text,
  currency           text,
  shipbob_channel_id text,
  shipbob_fc_id      integer,                              -- Altona=28, Manchester=32
  is_default_origin  boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz default now()
);

create table if not exists public.product_locations (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products(id)  on delete cascade,
  location_id          uuid not null references public.locations(id) on delete cascade,
  shipbob_inventory_id text,                               -- per-channel inventory id (AU != UK)
  active               boolean not null default true,
  created_at           timestamptz default now(),
  unique (product_id, location_id)
);
create index if not exists idx_product_locations_loc on public.product_locations(location_id);

-- seed the two finished-goods 3PLs (Phase 0 scope)
insert into public.locations (code, name, type, country, currency, shipbob_fc_id, is_default_origin)
values
  ('ALTONA',     'Altona ShipBob (VIC)',     'finished_3pl', 'AU', 'AUD', 28, true),
  ('MANCHESTER', 'Manchester ShipBob (UK)',  'finished_3pl', 'GB', 'GBP', 32, false)
on conflict (code) do nothing;

alter table public.locations         enable row level security;
alter table public.product_locations enable row level security;
create policy "Service role full access" on public.locations
  for all to public using (auth.role() = 'service_role');
create policy "Service role full access" on public.product_locations
  for all to public using (auth.role() = 'service_role');


-- ---------------------------------------------------------------------
-- MIGRATION 3 of 3:  inventory_snapshots + velocity
-- ---------------------------------------------------------------------
create table if not exists public.inventory_snapshots (
  id            uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  location_id   uuid not null references public.locations(id) on delete cascade,
  product_id    uuid not null references public.products(id)  on delete cascade,
  on_hand       integer not null default 0,
  available     integer not null default 0,
  committed     integer not null default 0,
  inbound       integer not null default 0,
  source        text    not null default 'shipbob',
  created_at    timestamptz default now(),
  unique (snapshot_date, location_id, product_id)            -- one row per SKU/site/day
);
create index if not exists idx_snapshots_pls
  on public.inventory_snapshots(product_id, location_id, snapshot_date desc);

create table if not exists public.velocity (
  id                  uuid primary key default gen_random_uuid(),
  as_of_date          date not null,
  location_id         uuid not null references public.locations(id) on delete cascade,
  product_id          uuid not null references public.products(id)  on delete cascade,
  avg_daily_units_7d  numeric,
  avg_daily_units_30d numeric,
  avg_daily_units_90d numeric,
  days_of_cover       numeric,
  trend               text,                                  -- 'up'|'down'|'flat'
  created_at          timestamptz default now(),
  unique (as_of_date, location_id, product_id)
);
create index if not exists idx_velocity_pls
  on public.velocity(product_id, location_id, as_of_date desc);

alter table public.inventory_snapshots enable row level security;
alter table public.velocity            enable row level security;
create policy "Service role full access" on public.inventory_snapshots
  for all to public using (auth.role() = 'service_role');
create policy "Service role full access" on public.velocity
  for all to public using (auth.role() = 'service_role');
