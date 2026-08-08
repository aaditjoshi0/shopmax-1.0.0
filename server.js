// ShopMax server.
//  - Serves the static template (HTML/CSS/JS/images) at /
//  - Exposes a REST API under /api/*
//  - Works in two DB modes: "supabase" (your cloud DB) or "local" (file JSON),
//    chosen automatically based on whether .env is filled in.

require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { supabase, MODE, isConfigured, getServiceClient } = require('./config/supabase');
const { getUser, requireUser } = require('./src/middleware/auth');

// --- Local/Supabase store seeding on first boot (so the site has products immediately) ---
try {
  require('./src/seed/seed.js').seedIfEmpty(true);
} catch (e) {
  console.warn('[boot] seed failed:', e.message);
}

// --- Cart schema migration: add guest_id + color columns (best-effort) ---
if (MODE === 'supabase' && supabase) {
  (async () => {
    try {
      await supabase.rpc('exec_sql', { sql: 'alter table public.carts add column if not exists guest_id text;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.carts add column if not exists updated_at timestamptz not null default now();' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.cart_items add column if not exists color text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.cart_items add column if not exists variant_id bigint;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop index if exists cart_items_cart_id_product_id_size_key;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists cart_items_unique_idx on public.cart_items (cart_id, coalesce(product_id, -1), coalesce(size, \'\'), coalesce(color, \'\'));' }).then(() => {}, () => {});
      // --- Proper RLS: auth-based policies (no permissive USING(true)) ---
      // Helper function: admin check (SECURITY DEFINER bypasses RLS on profiles)
      await supabase.rpc('exec_sql', { sql: "create or replace function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;" }).then(() => {}, () => {});
      // carts: owner only
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "carts all" on public.carts;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "carts owner" on public.carts;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "carts owner" on public.carts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).then(() => {}, () => {});
      // cart_items: via cart ownership
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "cart_items all" on public.cart_items;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "cart_items owner" on public.cart_items;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "cart_items owner" on public.cart_items for all using (exists (select 1 from public.carts where id = cart_id and user_id = auth.uid())) with check (exists (select 1 from public.carts where id = cart_id and user_id = auth.uid()));' }).then(() => {}, () => {});
      // orders: owner CRUD, admin SELECT
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "orders all" on public.orders;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "orders owner" on public.orders;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "orders admin" on public.orders;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "orders owner" on public.orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "orders admin" on public.orders for select using (public.is_admin());' }).then(() => {}, () => {});
      // products: public read (guests and users need to browse / validate stock)
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "products public" on public.products;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "products public" on public.products for select using (true);' }).then(() => {}, () => {});
      // profiles: owner CRUD, admin SELECT
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "profiles all" on public.profiles;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "profiles owner" on public.profiles;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "profiles admin" on public.profiles;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "profiles owner" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "profiles admin" on public.profiles for select using (public.is_admin());' }).then(() => {}, () => {});
      // --- Coupons table + orders discount columns ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.coupons (code text primary key, type text not null default 'percent', value numeric not null default 0, min_cart numeric default 0, max_uses int default 0, used_count int default 0, active boolean default true, created_at timestamptz default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists max_discount numeric default 0;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists start_date timestamptz;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists end_date timestamptz;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists per_user_limit int default 0;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists applicable_categories text[];" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists applicable_products bigint[];" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists free_delivery boolean default false;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists first_order_only boolean default false;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists description text default '';" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "alter table public.coupons add column if not exists updated_at timestamptz default now();" }).then(() => {}, () => {});
      // Coupon usage tracking table
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.coupon_usage (id bigint generated always as identity primary key, coupon_code text not null references public.coupons(code) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, order_id bigint, discount_amount numeric not null default 0, created_at timestamptz not null default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists coupon_usage_code_idx on public.coupon_usage(coupon_code);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists coupon_usage_user_idx on public.coupon_usage(user_id);' }).then(() => {}, () => {});
      // Enhanced seed coupons
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses, description) values ('SHOPMAX10', 'percent', 10, 0, 1000, '10% off on all orders') on conflict (code) do nothing;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses, description) values ('SHOPMAX20', 'percent', 20, 0, 500, '20% off on all orders') on conflict (code) do nothing;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses, description, first_order_only) values ('FIRSTORDER', 'fixed', 100, 200, 1000, 'Rs.100 off on your first order', true) on conflict (code) do nothing;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_discount, max_uses, description) values ('FESTIVE50', 'percent', 50, 500, 200, 200, '50% off up to Rs.200 on orders above Rs.500') on conflict (code) do nothing;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, free_delivery, max_uses, description) values ('FREEDEL', 'fixed', 0, 0, true, 500, 'Free delivery on your order') on conflict (code) do nothing;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses, description) values ('FLAT200', 'fixed', 200, 999, 300, 'Rs.200 off on orders above Rs.999') on conflict (code) do nothing;" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists discount numeric default 0;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists delivery_charge numeric default 0;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists coupon_code text;' }).then(() => {}, () => {});
      // Order tracking & timeline columns
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists tracking_no text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists courier text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists estimated_delivery timestamptz;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists actual_delivery timestamptz;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists return_eligible boolean default false;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists return_reason text;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists payment_method text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists payment_id text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists payment_status text default \'pending\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists payment_gateway text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists payment_time timestamptz;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists upi_id text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists card_last4 text default \'\';' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists is_cod boolean default false;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists wallet_name text default \'\';' }).then(() => {}, () => {});
      // --- Verify payment columns actually exist; auto-add, or print SQL if exec_sql is unavailable ---
      var PAYMENT_COLUMNS = [
        'payment_method text default \'\'',
        'payment_id text default \'\'',
        'payment_status text default \'pending\'',
        'payment_gateway text default \'\'',
        'payment_time timestamptz',
        'upi_id text default \'\'',
        'card_last4 text default \'\'',
        'is_cod boolean default false',
        'wallet_name text default \'\''
      ];
      try {
        var missingPayCols = [];
        for (var pc = 0; pc < PAYMENT_COLUMNS.length; pc++) {
          var colName = PAYMENT_COLUMNS[pc].split(' ')[0];
          var probe = await supabase.from('orders').select(colName).limit(1);
          if (probe.error && (probe.error.code === 'PGRST204' || probe.error.code === '42703' || String(probe.error.message || '').toLowerCase().indexOf('column') >= 0)) {
            missingPayCols.push(PAYMENT_COLUMNS[pc]);
          }
        }
        if (missingPayCols.length > 0) {
          try {
            for (var mc = 0; mc < missingPayCols.length; mc++) {
              var addRes = await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists ' + missingPayCols[mc] + ';' });
              if (addRes.error) throw addRes.error;
            }
            // Refresh PostgREST schema cache so the new columns are visible immediately
            await supabase.rpc('exec_sql', { sql: 'notify pgrst, \'reload schema\';' }).then(() => {}, () => {});
            console.log('[boot] Added missing orders payment columns: ' + missingPayCols.map(function (c) { return c.split(' ')[0]; }).join(', '));
          } catch (e2) {
            console.warn('[boot] Could not auto-add orders payment columns (exec_sql RPC unavailable). Run these in your Supabase Dashboard SQL Editor:\n' +
              missingPayCols.map(function (c) { return '  ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ' + c + ';'; }).join('\n') +
              "\n  NOTIFY pgrst, 'reload schema'; -- refresh PostgREST schema cache");
          }
        }
      } catch (_) {}
      // --- Product variants + images tables ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.product_variants (id bigint generated always as identity primary key, product_id bigint not null references public.products(id) on delete cascade, sku text default '', size text default '', color text default '', price numeric(10,2) not null default 0, compare_at_price numeric(10,2), stock integer not null default 0, status text not null default 'published', created_at timestamptz not null default now(), updated_at timestamptz not null default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists product_variants_product_idx on public.product_variants(product_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "create unique index if not exists product_variants_sku_idx on public.product_variants(sku) where sku != '';" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists product_variants_combo_idx on public.product_variants(product_id, size, color);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.product_images (id bigint generated always as identity primary key, product_id bigint not null references public.products(id) on delete cascade, color text default '', url text not null, alt text default '', sort_order integer not null default 0, created_at timestamptz not null default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists product_images_product_idx on public.product_images(product_id, sort_order);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_variants read" on public.product_variants;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_variants read" on public.product_variants for select using (true);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_variants write" on public.product_variants;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_variants write" on public.product_variants for all using (true) with check (true);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_images read" on public.product_images;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_images read" on public.product_images for select using (true);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_images write" on public.product_images;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_images write" on public.product_images for all using (true) with check (true);' }).then(() => {}, () => {});
      // --- Reviews table ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.reviews (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, order_id bigint references public.orders(id) on delete set null, product_id bigint not null references public.products(id) on delete cascade, rating integer not null check (rating >= 1 and rating <= 5), title text default '', review text default '', user_name text default '', images jsonb default '[]'::jsonb, verified_purchase boolean default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists reviews_product_user_idx on public.reviews (product_id, user_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists reviews_product_idx on public.reviews (product_id, created_at desc);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists reviews_order_idx on public.reviews (order_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "reviews public read" on public.reviews;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "reviews public read" on public.reviews for select using (true);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "reviews owner write" on public.reviews;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "reviews owner write" on public.reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "reviews admin delete" on public.reviews;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "reviews admin delete" on public.reviews for delete using (public.is_admin());' }).then(() => {}, () => {});
      // --- Verify reviews table exists; auto-add, or print SQL if exec_sql is unavailable ---
      try {
        var reviewsProbe = await supabase.from('reviews').select('id').limit(1);
        if (reviewsProbe.error && (reviewsProbe.error.code === 'PGRST205' || reviewsProbe.error.code === 'PGRST204' || reviewsProbe.error.code === '42P01' || String(reviewsProbe.error.message || '').toLowerCase().indexOf('table') >= 0)) {
          try {
            var revRes = await supabase.rpc('exec_sql', { sql: "create table if not exists public.reviews (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, order_id bigint references public.orders(id) on delete set null, product_id bigint not null references public.products(id) on delete cascade, rating integer not null check (rating >= 1 and rating <= 5), title text default '', review text default '', user_name text default '', images jsonb default '[]'::jsonb, verified_purchase boolean default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()); create unique index if not exists reviews_product_user_idx on public.reviews (product_id, user_id); create index if not exists reviews_product_idx on public.reviews (product_id, created_at desc); create index if not exists reviews_order_idx on public.reviews (order_id);" });
            if (revRes.error) throw revRes.error;
            await supabase.rpc('exec_sql', { sql: 'drop policy if exists "reviews public read" on public.reviews; create policy "reviews public read" on public.reviews for select using (true); drop policy if exists "reviews owner write" on public.reviews; create policy "reviews owner write" on public.reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id); drop policy if exists "reviews admin delete" on public.reviews; create policy "reviews admin delete" on public.reviews for delete using (public.is_admin()); notify pgrst, \'reload schema\';' }).catch(function () {});
            console.log('[boot] reviews table created successfully.');
          } catch (e3) {
            console.warn('[boot] Could not auto-create the reviews table (exec_sql RPC unavailable). Run this SQL in your Supabase Dashboard SQL Editor:\n' +
              "  CREATE TABLE IF NOT EXISTS public.reviews (\n" +
              "    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n" +
              "    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,\n" +
              "    order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,\n" +
              "    product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,\n" +
              "    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),\n" +
              "    title TEXT DEFAULT '',\n" +
              "    review TEXT DEFAULT '',\n" +
              "    user_name TEXT DEFAULT '',\n" +
              "    images JSONB DEFAULT '[]'::jsonb,\n" +
              "    verified_purchase BOOLEAN DEFAULT FALSE,\n" +
              "    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n" +
              "    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()\n" +
              "  );\n" +
              "  CREATE UNIQUE INDEX IF NOT EXISTS reviews_product_user_idx ON public.reviews (product_id, user_id);\n" +
              "  CREATE INDEX IF NOT EXISTS reviews_product_idx ON public.reviews (product_id, created_at DESC);\n" +
              "  CREATE INDEX IF NOT EXISTS reviews_order_idx ON public.reviews (order_id);\n" +
              "  DROP POLICY IF EXISTS \"reviews public read\" ON public.reviews;\n" +
              "  CREATE POLICY \"reviews public read\" ON public.reviews FOR SELECT USING (true);\n" +
              "  DROP POLICY IF EXISTS \"reviews owner write\" ON public.reviews;\n" +
              "  CREATE POLICY \"reviews owner write\" ON public.reviews FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);\n" +
              "  DROP POLICY IF EXISTS \"reviews admin delete\" ON public.reviews;\n" +
              "  CREATE POLICY \"reviews admin delete\" ON public.reviews FOR DELETE USING (public.is_admin());\n" +
              "  NOTIFY pgrst, 'reload schema';");
          }
        } else {
          // Table exists — verify every column the API uses is present
          try {
            var missingCols = [];
            var colProbe = await supabase.from('reviews').select('user_name, images').limit(1);
            if (colProbe.error && (colProbe.error.code === 'PGRST204' || colProbe.error.code === '42703')) {
              var probed = await supabase.from('reviews').select('user_name').limit(1);
              if (probed.error && (probed.error.code === 'PGRST204' || probed.error.code === '42703')) missingCols.push('user_name');
              var probed2 = await supabase.from('reviews').select('images').limit(1);
              if (probed2.error && (probed2.error.code === 'PGRST204' || probed2.error.code === '42703')) missingCols.push('images');
            }
            if (missingCols.length) {
              try {
                var colRes = await supabase.rpc('exec_sql', { sql: "alter table public.reviews add column if not exists user_name text default ''; alter table public.reviews add column if not exists images jsonb default '[]'::jsonb; notify pgrst, 'reload schema';" });
                if (colRes.error) throw colRes.error;
                console.log('[boot] reviews missing columns added: ' + missingCols.join(', '));
              } catch (e4) {
                console.warn('[boot] reviews table is missing columns (' + missingCols.join(', ') + ') and exec_sql is unavailable. Run this SQL in your Supabase Dashboard SQL Editor:\n' +
                  "  ALTER TABLE public.reviews\n" +
                  "    ADD COLUMN IF NOT EXISTS user_name TEXT DEFAULT '',\n" +
                  "    ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;\n" +
                  "  NOTIFY pgrst, 'reload schema';");
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
      // --- Wishlists table ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.wishlists (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, product_id bigint not null references public.products(id) on delete cascade, created_at timestamptz not null default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists wishlists_user_product_idx on public.wishlists (user_id, product_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists wishlists_user_idx on public.wishlists (user_id, created_at desc);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "wishlists owner" on public.wishlists;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "wishlists owner" on public.wishlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).then(() => {}, () => {});
      // --- Add rating_count to products ---
      await supabase.rpc('exec_sql', { sql: 'alter table public.products add column if not exists rating_count integer not null default 0;' }).then(() => {}, () => {});
      // --- Product metadata columns ---
      // Try adding columns; if exec_sql isn't available, warn the user
      try {
        const colCheck = await supabase.from('products').select('material').limit(1);
        if (colCheck.error && (colCheck.error.code === 'PGRST204' || colCheck.error.code === '42703')) {
          // Column doesn't exist — try to add via exec_sql (works if function was created via Dashboard)
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists material text default '';" });
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists fabric text default '';" });
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists delivery_info text default '';" });
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists return_policy text default '';" });
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists size_guide text default '';" });
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists benefits jsonb default '[]'::jsonb;" });
          console.log('[boot] Product metadata columns added successfully.');
        }
      // Also check for benefits column separately (main check above may be skipped if material already exists)
      try {
        const bc = await supabase.from('products').select('benefits').limit(1);
        if (bc.error && (bc.error.code === 'PGRST204' || bc.error.code === '42703')) {
          await supabase.rpc('exec_sql', { sql: "alter table public.products add column if not exists benefits jsonb default '[]'::jsonb;" });
          console.log('[boot] benefits column added successfully.');
        }
      } catch (_) {
        console.warn('[boot] Could not auto-add benefits column. If you want product benefits, run this SQL in your Supabase Dashboard SQL Editor:\n  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS benefits jsonb DEFAULT \'[]\'::jsonb;');
      }
    } catch (_) {
      console.warn('[boot] Could not auto-add product metadata columns. If you want to store material/fabric/delivery/return/size_guide/benefits data, run these SQL commands in your Supabase Dashboard SQL Editor:\n' +
        '  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS material text DEFAULT \'\';\n' +
        '  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS fabric text DEFAULT \'\';\n' +
        '  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS delivery_info text DEFAULT \'\';\n' +
        '  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS return_policy text DEFAULT \'\';\n' +
        '  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS size_guide text DEFAULT \'\';\n' +
        '  ALTER TABLE public.products ADD COLUMN IF NOT EXISTS benefits jsonb DEFAULT \'[]\'::jsonb;');
    }
      // --- Ratings table ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.ratings (id bigint generated always as identity primary key, target_type text not null default 'product', target_id bigint not null, user_id uuid not null references auth.users(id) on delete cascade, rating integer not null check (rating >= 1 and rating <= 5), created_at timestamptz not null default now(), updated_at timestamptz not null default now());" }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists ratings_target_user_idx on public.ratings (target_type, target_id, user_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists ratings_target_idx on public.ratings (target_type, target_id);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "ratings public read" on public.ratings;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "ratings public read" on public.ratings for select using (true);' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "ratings owner write" on public.ratings;' }).then(() => {}, () => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "ratings owner write" on public.ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).then(() => {}, () => {});
    } catch (_) {}
  })();
}

const app = express();
const PORT = process.env.PORT || 3000;

// A stable session secret. In local mode it's a fixed string so sessions
// survive restarts; in production you'd set SESSION_SECRET in .env.
const SESSION_SECRET = process.env.SESSION_SECRET || 'shopmax-local-dev-secret';

app.use(express.json({ limit: '50mb' }));          // large limit for canvas thumbnails and avatars
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

// --- Login guard: require auth for protected HTML pages ---
const PUBLIC_PAGES = ['/login.html', '/register.html', '/admin-login.html', '/cart.html', '/checkout.html', '/orders.html', '/order-details.html'];
const PUBLIC_ROUTES = ['/product/'];   // product detail pages are public
app.use((req, res, next) => {
  // Allow API routes, static assets (css/js/images/fonts), and public pages
  if (req.path.startsWith('/api/') || PUBLIC_PAGES.includes(req.path)) return next();
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i)) return next();
  // Allow public routes (product detail pages, shop, category pages)
  if (PUBLIC_ROUTES.some(r => req.path.startsWith(r))) return next();
  if (req.path === '/shop.html' || req.path === '/men.html' || req.path === '/women.html') return next();
  // Check session cookie
  const token = req.signedCookies && req.signedCookies.sm_session;
  if (token && typeof token === 'object' && token.id) return next();
  // Allow admin pages through — the admin guard below handles the admin check
  if (req.path === '/admin.html' || req.path.startsWith('/admin/')) return next();
  return res.redirect('/login.html');
});

// --- Admin guard: require admin role for admin pages (except login) ---
app.use((req, res, next) => {
  if (req.path.startsWith('/admin/') || req.path === '/admin.html') {
    // Allow static assets within admin paths
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i)) return next();
    const adminToken = req.signedCookies && req.signedCookies.sm_admin_session;
    if (adminToken && typeof adminToken === 'object' && adminToken.role === 'admin') return next();
    return res.redirect('/admin-login.html');
  }
  next();
});

// No cache during development — force browser to always fetch fresh files
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve all static template assets from the project root
app.use(express.static(path.join(__dirname), { etag: false, lastModified: false }));

// --- API routes ---
app.use('/api/auth', require('./src/api/auth'));
app.use('/api/products', require('./src/api/products'));
app.use('/api/cart', require('./src/api/cart'));
app.use('/api/orders', require('./src/api/orders'));
app.use('/api/designs', require('./src/api/designs'));
app.use('/api/marketplace', require('./src/api/marketplace'));
app.use('/api/categories', require('./src/api/categories'));
app.use('/api/admin', require('./src/api/admin'));
app.use('/api', require('./src/api/variants')); // includes product variant + image routes
app.use('/api/reviews', require('./src/api/reviews'));
app.use('/api/ratings', require('./src/api/ratings'));
app.use('/api/wishlist', require('./src/api/wishlist'));
app.use('/api', require('./src/api/coupons')); // coupon CRUD + validation
app.use('/api/payment', require('./src/api/payment')); // payment processing

// Health / mode check + invoice printer
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: MODE });
});

app.get('/api/orders/:id/invoice-print', getUser, requireUser, (req, res) => {
  const { supabase, MODE } = require('./config/supabase');
  const store = require('./src/db/localStore');
  const sb = req.supabase || supabase;
  (async () => {
    try {
      let order, profile;
      if (MODE === 'local') {
        order = store.raw.orders.find(o => o.id === Number(req.params.id));
        if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
          return res.status(404).send('Order not found');
        }
        profile = store.raw.profiles.find(p => p.id === order.user_id);
      } else {
        const q = sb.from('orders').select('*').eq('id', req.params.id);
        if (req.user.role !== 'admin') q.eq('user_id', req.user.id);
        const { data: o2 } = await q.maybeSingle();
        order = o2;
        if (!order) return res.status(404).send('Order not found');
        const { data: p } = await sb.from('profiles').select('*').eq('id', order.user_id).single();
        profile = p || {};
      }
      if (!order) return res.status(500).send('Error loading order');
      function money(n) { return '\u20B9' + Number(n || 0).toFixed(2); }
      function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      var s = order.status.replace(/_/g,' ');
      var fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
      var itemsHtml = '';
      (order.items || []).forEach(function(it, i) {
        itemsHtml += '<tr><td>'+(i+1)+'</td><td>'+(it.name?esc(it.name):'Product')+'</td><td>'+(it.color?esc(it.color):'-')+' | '+(it.size?esc(it.size):'-')+'</td><td>'+(it.quantity||1)+'</td><td>' + money(it.price) + '</td>';
        if (it.discount) itemsHtml += '<td>'+money(it.discount)+'</td>';
        itemsHtml += '</tr>';
      });
      var couponHtml = order.coupon_code ? '<tr><td>Coupon Code</td><td>'+esc(order.coupon_code)+'</td><td></td><td></td><td>-'+ money(order.discount||0) +'</td></tr>' : '';
      res.send(`<!DOCTYPE html><html><head><title>Invoice - Order #${order.id}</title><style>
        body{font-family:'Courier New',monospace;padding:40px;color:#222;font-size:13px;}
        table{width:100%;border-collapse:collapse;margin:16px 0;}
        th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd;}
        th{background:#f5f5f5;font-weight:bold;}
        .header{display:flex;justify-content:space-between;margin-bottom:30px;border-bottom:3px solid #333;padding-bottom:20px;}
        .logo{font-size:28px;font-weight:bold;color:#333;}
        .totals{margin-left:auto;width:300px;}
        .totals td{padding:6px 0;}
        .totals .grand-total{font-size:16px;font-weight:bold;border-top:2px solid #333;}
        .footer{text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #ccc;font-size:11px;color:#888;}
        @media print{body{padding:20px;}.no-print{display:none;}}
      </style></head><body>
        <div class="no-print" style="text-align:right;margin-bottom:20px;"><button onclick="window.print()" style="padding:10px 24px;background:#333;color:#fff;border:none;cursor:pointer;font-size:14px;">Print Invoice</button></div>
        <div class="header"><div><div class="logo">SHOPMAX</div><div style="color:#666;margin-top:4px;">Custom Clothing &amp; Community Marketplace</div></div>
        <div style="text-align:right;"><h3 style="margin:0;">TAX INVOICE</h3><p style="margin:4px 0;">Order #${order.id}</p><p style="margin:0;">Date: ${fmtDate(order.created_at)}</p><p style="margin:0;">Status: <b>${esc(s)}</b></p></div></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
        <div><b>Bill To:</b><br>${esc(order.shipping&&order.shipping.fname?''+order.shipping.fname:'Customer')}<br>${esc(order.shipping&&order.shipping.address?''+order.shipping.address:'')}<br>${esc(order.shipping&&order.shipping.state_country?''+order.shipping.state_country:'')} ${esc(order.shipping&&order.shipping.postal_zip?''+order.shipping.postal_zip:'')}<br>Phone: ${esc(order.shipping&&order.shipping.phone?''+order.shipping.phone:'')}<br>Email: ${esc(order.shipping&&order.shipping.email_address?''+order.shipping.email_address:'')}</div>
        <div style="text-align:right;"><b>Ship To:</b><br>${esc(order.shipping&&order.shipping.fname?''+order.shipping.fname:'Customer')}<br>${esc(order.shipping&&order.shipping.address?''+order.shipping.address:'')}<br>${esc(order.shipping&&order.shipping.state_country?''+order.shipping.state_country:'')} ${esc(order.shipping&&order.shipping.postal_zip?''+order.shipping.postal_zip:'')}<br>Phone: ${esc(order.shipping&&order.shipping.phone?''+order.shipping.phone:'')}</div></div>
        <table><thead><tr><th>#</th><th>Item</th><th>Variant</th><th>Qty</th><th>Price</th><th>Discount</th></tr></thead>
        <tbody>${itemsHtml}</tbody></table>
        <table class="totals">
        <tr><td>Subtotal</td><td></td><td></td><td></td><td>${money(order.subtotal)}</td></tr>
        ${couponHtml}
        <tr><td>Delivery Charge</td><td></td><td></td><td></td><td>${order.delivery_charge ? money(order.delivery_charge) : (order.subtotal >= 500 ? 'FREE' : money(order.delivery_charge||0))}</td></tr>
        <tr class="grand-total"><td colspan="4">Total Amount</td><td>${money(order.total)}</td></tr>
        ${order.payment_method?'<tr><td colspan="5">Payment Method: '+esc(order.payment_method.toUpperCase())+'</td></tr>':''}
        ${order.tracking_no?'<tr><td colspan="5">Tracking No: '+esc(order.tracking_no)+' ('+esc(order.courier||'')+')</td></tr>':''}
        </table>
        <div class="footer"><p>Thank you for shopping with ShopMax!</p><p>This is a computer-generated invoice.</p></div>
      </body></html>`);
    } catch (e) {
      console.error('[invoice]', e.message);
      res.status(500).send('Error generating invoice');
    }
  })();
});

// Manual seed trigger (useful if RLS policy was updated after server started)
app.post('/api/admin/seed', (req, res) => {
  try {
    require('./src/seed/seed.js').seedIfEmpty(false);
    res.json({ ok: true, message: 'Seed triggered.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Image upload (admin) ---
const multer = require('multer');
const crypto = require('crypto');
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'images'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

app.post('/api/admin/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
    const productId = Number(req.body.product_id);
    if (!productId) return res.status(400).json({ error: 'Product ID is required.' });
    const url = '/images/' + req.file.filename;
    const imgData = {
      product_id: productId,
      color: req.body.color || '',
      url,
      alt: req.body.alt || '',
      sort_order: parseInt(req.body.sort_order, 10) || 0
    };

    if (MODE === 'local') {
      const store = require('./src/db/localStore');
      imgData.id = store.nextId('image');
      imgData.created_at = new Date().toISOString();
      store.raw.images.push(imgData);
      store.persist();
      return res.json({ image: imgData });
    }

    // Supabase — use service client (bypasses RLS for admin writes)
    const client = getServiceClient() || supabase;
    const { data, error } = await client.from('product_images').insert(imgData).select();
    if (error) throw error;
    if (!data || data.length === 0) return res.status(500).json({ error: 'Failed to save image record' });
    res.json({ image: data[0] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

// --- Error-handling middleware (must be after all routes) ---
app.use((err, req, res, next) => {
  console.error('[error]', err.message || err);
  if (req.path.startsWith('/api/')) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
  res.status(status || 500).send('Internal Server Error');
});

// --- Fallback: SPA-ish route handling for clean URLs ---
// /product/123 -> serve product.html (it reads the id from the URL on the client)
// /men, /women, /home -> serve the matching category page
app.get('/product/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'product.html'));
});

// Start
app.listen(PORT, () => {
  const label = isConfigured() ? 'Supabase (cloud)' : 'LOCAL (file JSON)';
  console.log('\n  ShopMax running:');
  console.log('  ----------------------------------------');
  console.log('  URL   : http://localhost:' + PORT);
  console.log('  Mode  : ' + label);
  if (!isConfigured()) {
    console.log('  Hint  : add SUPABASE_URL + SUPABASE_ANON_KEY to .env to use cloud DB');
  } else if (!process.env.SUPABASE_SERVICE_KEY) {
    console.log('  WARN  : SUPABASE_SERVICE_KEY not set — admin APIs will only see own data.');
    console.log('          Add it to .env from Supabase Dashboard -> Settings -> API -> service_role');
  }
  console.log('  ----------------------------------------\n');
});
