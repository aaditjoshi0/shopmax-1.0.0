-- ============================================================================
-- ShopMax database schema (Supabase / Postgres)
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL -> New query).
-- It is idempotent: safe to run more than once.
-- ============================================================================

-- ---------- PROFILES ----------------------------------------------------------
-- One row per registered user (extends the built-in auth.users).
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  mobile      text,
  birthdate   text,
  avatar_url  text,
  role        text not null default 'customer',
  created_at  timestamptz not null default now()
);

-- ---------- PRODUCTS ----------------------------------------------------------
create table if not exists public.products (
  id              bigint generated always as identity primary key,
  name            text not null,
  slug            text unique,
  description     text,
  price           numeric(10,2) not null,
  compare_at_price numeric(10,2),
  category        text not null default 'uncategorized',
  image_url       text not null default '',
  stock           integer not null default 0,
  sizes           text[] not null default '{}',
  rating          numeric(2,1) not null default 0,
  featured        boolean not null default false,
  colors          jsonb,                       -- [{ name, hex, image_url }]
  brand           text default '',
  sku             text default '',
  tags            text[] default '{}',
  status          text not null default 'draft',
  gender          text default 'unisex',
  bestseller      boolean not null default false,
  new_arrival     boolean not null default false,
  discount_price  numeric(10,2),
  created_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists products_category_idx on public.products(category);
create index if not exists products_slug_idx   on public.products(slug);
create index if not exists products_status_idx on public.products(status);
create index if not exists products_sku_idx    on public.products(sku);

-- ---------- CATEGORIES --------------------------------------------------------
create table if not exists public.categories (
  id          bigint generated always as identity primary key,
  name        text not null,
  slug        text unique not null,
  description text default '',
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Seed default categories
insert into public.categories (name, slug) values
  ('Men', 'men'),
  ('Women', 'women'),
  ('Home', 'home'),
  ('Accessories', 'accessories')
on conflict (slug) do nothing;

-- ---------- PRODUCT VARIANTS (per-size, per-color stock/pricing) -------------
create table if not exists public.product_variants (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references public.products(id) on delete cascade,
  sku             text default '',
  size            text default '',
  color           text default '',
  price           numeric(10,2) not null default 0,
  compare_at_price numeric(10,2),
  stock           integer not null default 0,
  status          text not null default 'published',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists product_variants_product_idx on public.product_variants(product_id);
create unique index if not exists product_variants_sku_idx on public.product_variants(sku) where sku != '';
create unique index if not exists product_variants_combo_idx on public.product_variants(product_id, size, color);

-- ---------- PRODUCT IMAGES (multi-image gallery, color-specific) -------------
create table if not exists public.product_images (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references public.products(id) on delete cascade,
  color           text default '',
  url             text not null,
  alt             text default '',
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists product_images_product_idx on public.product_images(product_id, sort_order);

-- ---------- CARTS (one per user or guest) -------------------------------------
create table if not exists public.carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  guest_id    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint carts_owner_check check (
    (user_id is not null and guest_id is null) or
    (user_id is null and guest_id is not null)
  )
);
create unique index if not exists carts_user_idx on public.carts(user_id) where user_id is not null;
create unique index if not exists carts_guest_idx on public.carts(guest_id) where guest_id is not null;

create table if not exists public.cart_items (
  id           uuid primary key default gen_random_uuid(),
  cart_id      uuid not null references public.carts(id) on delete cascade,
  product_id   bigint references public.products(id) on delete set null,
  name         text not null,
  price        numeric(10,2) not null,
  image_url    text,
  size         text,
  color        text default '',
  quantity     integer not null default 1 check (quantity > 0),
  meta         jsonb,                       -- e.g. { design_id, thumbnail } for custom designs
  unique (cart_id, product_id, size, color)
);

-- ---------- ORDERS ------------------------------------------------------------
create table if not exists public.orders (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  items       jsonb not null,               -- snapshot of line items
  shipping    jsonb not null,               -- snapshot of shipping address
  subtotal    numeric(10,2) not null default 0,
  total       numeric(10,2) not null default 0,
  status      text not null default 'placed',
  created_at  timestamptz not null default now()
);

-- ---------- DESIGNS (saved customizer output) --------------------------------
create table if not exists public.designs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  canvas_data  jsonb not null,              -- full layer config so the design can be re-edited
  thumbnail_url text,
  product_type text not null default 'tshirt',
  created_at   timestamptz not null default now()
);

-- ---------- LISTINGS (community marketplace) ---------------------------------
create table if not exists public.listings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  price       numeric(10,2) not null,
  image_url   text not null,
  size        text,
  category    text not null default 'design',  -- 'design' (from customizer) or 'physical'
  design_id   bigint references public.designs(id) on delete set null,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);
create index if not exists listings_status_idx on public.listings(status);

-- ---------- RATINGS (one per user per product or listing) --------------------
create table if not exists public.ratings (
  id          bigint generated always as identity primary key,
  target_type text not null default 'product',
  target_id   bigint not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rating      integer not null check (rating >= 1 and rating <= 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists ratings_target_user_idx on public.ratings (target_type, target_id, user_id);
create index if not exists ratings_target_idx on public.ratings (target_type, target_id);

alter table public.ratings enable row level security;
drop policy if exists "ratings public read" on public.ratings;
create policy "ratings public read" on public.ratings for select using (true);
drop policy if exists "ratings owner write" on public.ratings;
create policy "ratings owner write" on public.ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Add rating_count to products
alter table public.products add column if not exists rating_count integer not null default 0;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Public can read products and active listings.
-- Everything else is owner-only.
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.products         enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images   enable row level security;
alter table public.categories       enable row level security;
alter table public.carts            enable row level security;
alter table public.cart_items       enable row level security;
alter table public.orders           enable row level security;
alter table public.designs          enable row level security;
alter table public.listings         enable row level security;

-- PRODUCTS: world-readable (admin filters by status in query); world-writeable (admin panel).
drop policy if exists "products read"   on public.products;
drop policy if exists "products write"  on public.products;
create policy "products read"  on public.products for select using (true);
create policy "products write" on public.products for all using (true) with check (true);

-- PRODUCT VARIANTS: world-readable; admin can manage.
drop policy if exists "product_variants read"  on public.product_variants;
drop policy if exists "product_variants write" on public.product_variants;
create policy "product_variants read"  on public.product_variants for select using (true);
create policy "product_variants write" on public.product_variants for all using (true) with check (true);

-- PRODUCT IMAGES: world-readable; admin can manage.
drop policy if exists "product_images read"  on public.product_images;
drop policy if exists "product_images write" on public.product_images;
create policy "product_images read"  on public.product_images for select using (true);
create policy "product_images write" on public.product_images for all using (true) with check (true);

-- CATEGORIES: world-readable; admin can manage.
drop policy if exists "categories read"  on public.categories;
drop policy if exists "categories write" on public.categories;
create policy "categories read"  on public.categories for select using (true);
create policy "categories write" on public.categories for all using (true) with check (true);

-- LISTINGS: world-readable when active; owner can do everything.
drop policy if exists "listings read"   on public.listings;
create policy "listings read"   on public.listings for select using (status = 'active' or auth.uid() = user_id);
drop policy if exists "listings write"  on public.listings;
create policy "listings write"  on public.listings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- PROFILES: owner only.
drop policy if exists "profiles read"  on public.profiles;
create policy "profiles read"  on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles write" on public.profiles;
create policy "profiles write" on public.profiles for update using (auth.uid() = id);

-- CARTS / CART_ITEMS: world-all (server is trusted gatekeeper)
drop policy if exists "carts owner"      on public.carts;
drop policy if exists "carts all"        on public.carts;
create policy "carts all" on public.carts for all using (true) with check (true);
drop policy if exists "cart_items owner" on public.cart_items;
drop policy if exists "cart_items all"   on public.cart_items;
create policy "cart_items all" on public.cart_items for all using (true) with check (true);

-- ORDERS: owner can read; owner can insert.
drop policy if exists "orders read"  on public.orders;
create policy "orders read"  on public.orders for select using (auth.uid() = user_id);
drop policy if exists "orders insert" on public.orders;
create policy "orders insert" on public.orders for insert with check (auth.uid() = user_id);

-- DESIGNS: owner only.
drop policy if exists "designs owner" on public.designs;
create policy "designs owner" on public.designs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- Auto-create a profile row when a new auth user signs up.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, mobile, birthdate, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.raw_user_meta_data->>'birthdate', ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- MIGRATION (safe to re-run): add columns for guest carts and color support.
-- ============================================================================
alter table public.carts     add column if not exists guest_id  text;
alter table public.carts     add column if not exists updated_at timestamptz not null default now();
alter table public.cart_items add column if not exists color    text default '';
drop index if exists cart_items_cart_id_product_id_size_key;
create unique index if not exists cart_items_unique_idx on public.cart_items (cart_id, coalesce(product_id, -1), coalesce(size, ''), coalesce(color, ''));
