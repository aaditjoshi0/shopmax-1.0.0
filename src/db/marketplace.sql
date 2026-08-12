-- ShopMax — Community Marketplace schema.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- It is idempotent: safe to re-run.
--
-- What it does:
--   1. Adds the social/economic columns the marketplace needs to `listings`.
--   2. Creates `listing_likes` (public appreciation) and `listing_saves`
--      (private wishlist) with one-row-per-user-per-listing uniqueness.
--   3. Keeps listings.likes_count / saves_count accurate via triggers, so the
--      grid can sort by popularity without an N+1 count query per card.

-- ---------------------------------------------------------------- listings

alter table public.listings add column if not exists design_snapshot  jsonb;
alter table public.listings add column if not exists base_product_id  bigint references public.products(id) on delete set null;
alter table public.listings add column if not exists color            text default '';
alter table public.listings add column if not exists tags             text[] not null default '{}';
alter table public.listings add column if not exists likes_count      integer not null default 0;
alter table public.listings add column if not exists saves_count      integer not null default 0;
alter table public.listings add column if not exists views            integer not null default 0;
alter table public.listings add column if not exists updated_at       timestamptz not null default now();

create index if not exists listings_status_created_idx on public.listings (status, created_at desc);
create index if not exists listings_likes_idx          on public.listings (likes_count desc);
create index if not exists listings_user_idx           on public.listings (user_id);

-- ---------------------------------------------------------------- likes

create table if not exists public.listing_likes (
  id         bigint generated always as identity primary key,
  listing_id bigint not null references public.listings(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, user_id)
);
create index if not exists listing_likes_user_idx on public.listing_likes (user_id);

-- ---------------------------------------------------------------- saves (wishlist)

create table if not exists public.listing_saves (
  id         bigint generated always as identity primary key,
  listing_id bigint not null references public.listings(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, user_id)
);
create index if not exists listing_saves_user_idx on public.listing_saves (user_id);

-- ---------------------------------------------------------------- counter triggers

create or replace function public.sync_listing_counts() returns trigger
language plpgsql security definer as $$
declare
  target bigint := coalesce(new.listing_id, old.listing_id);
begin
  update public.listings set
    likes_count = (select count(*) from public.listing_likes where listing_id = target),
    saves_count = (select count(*) from public.listing_saves where listing_id = target)
  where id = target;
  return null;
end;
$$;

drop trigger if exists listing_likes_count on public.listing_likes;
create trigger listing_likes_count
  after insert or delete on public.listing_likes
  for each row execute function public.sync_listing_counts();

drop trigger if exists listing_saves_count on public.listing_saves;
create trigger listing_saves_count
  after insert or delete on public.listing_saves
  for each row execute function public.sync_listing_counts();

-- ---------------------------------------------------------------- RLS

alter table public.listing_likes enable row level security;
alter table public.listing_saves enable row level security;

-- Likes are public (the count is shown to everyone); a user may only add or
-- remove their OWN like.
drop policy if exists "listing_likes read"  on public.listing_likes;
create policy "listing_likes read"  on public.listing_likes for select using (true);
drop policy if exists "listing_likes write" on public.listing_likes;
create policy "listing_likes write" on public.listing_likes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Saves are private: you can only ever see or change your own.
drop policy if exists "listing_saves read"  on public.listing_saves;
create policy "listing_saves read"  on public.listing_saves for select using (auth.uid() = user_id);
drop policy if exists "listing_saves write" on public.listing_saves;
create policy "listing_saves write" on public.listing_saves for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Designs: private to their owner, but a design that has been published as an
-- active listing must be readable by everyone so it can be remixed.
alter table public.designs enable row level security;
drop policy if exists "designs read"  on public.designs;
create policy "designs read"  on public.designs for select using (
  auth.uid() = user_id
  or exists (select 1 from public.listings l where l.design_id = designs.id and l.status = 'active')
);
drop policy if exists "designs write" on public.designs;
create policy "designs write" on public.designs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
