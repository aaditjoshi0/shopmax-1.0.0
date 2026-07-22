// ShopMax server.
//  - Serves the static template (HTML/CSS/JS/images) at /
//  - Exposes a REST API under /api/*
//  - Works in two DB modes: "supabase" (your cloud DB) or "local" (file JSON),
//    chosen automatically based on whether .env is filled in.

require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { supabase, MODE, isConfigured } = require('./config/supabase');

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
      await supabase.rpc('exec_sql', { sql: 'alter table public.carts add column if not exists guest_id text;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.carts add column if not exists updated_at timestamptz not null default now();' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.cart_items add column if not exists color text default \'\';' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.cart_items add column if not exists variant_id bigint;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop index if exists cart_items_cart_id_product_id_size_key;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists cart_items_unique_idx on public.cart_items (cart_id, coalesce(product_id, -1), coalesce(size, \'\'), coalesce(color, \'\'));' }).catch(() => {});
      // --- Proper RLS: auth-based policies (no permissive USING(true)) ---
      // Helper function: admin check (SECURITY DEFINER bypasses RLS on profiles)
      await supabase.rpc('exec_sql', { sql: "create or replace function public.is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;" }).catch(() => {});
      // carts: owner only
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "carts all" on public.carts;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "carts owner" on public.carts;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "carts owner" on public.carts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).catch(() => {});
      // cart_items: via cart ownership
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "cart_items all" on public.cart_items;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "cart_items owner" on public.cart_items;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "cart_items owner" on public.cart_items for all using (exists (select 1 from public.carts where id = cart_id and user_id = auth.uid())) with check (exists (select 1 from public.carts where id = cart_id and user_id = auth.uid()));' }).catch(() => {});
      // orders: owner CRUD, admin SELECT
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "orders all" on public.orders;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "orders owner" on public.orders;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "orders admin" on public.orders;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "orders owner" on public.orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "orders admin" on public.orders for select using (public.is_admin());' }).catch(() => {});
      // products: public read (guests and users need to browse / validate stock)
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "products public" on public.products;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "products public" on public.products for select using (true);' }).catch(() => {});
      // profiles: owner CRUD, admin SELECT
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "profiles all" on public.profiles;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "profiles owner" on public.profiles;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "profiles admin" on public.profiles;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "profiles owner" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "profiles admin" on public.profiles for select using (public.is_admin());' }).catch(() => {});
      // --- Coupons table + orders discount columns ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.coupons (code text primary key, type text not null default 'percent', value numeric not null default 0, min_cart numeric default 0, max_uses int default 0, used_count int default 0, active boolean default true, created_at timestamptz default now());" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses) values ('SHOPMAX10', 'percent', 10, 0, 1000) on conflict (code) do nothing;" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses) values ('SHOPMAX20', 'percent', 20, 0, 500) on conflict (code) do nothing;" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: "insert into public.coupons (code, type, value, min_cart, max_uses) values ('FIRSTORDER', 'fixed', 100, 200, 1000) on conflict (code) do nothing;" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists discount numeric default 0;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists delivery_charge numeric default 0;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'alter table public.orders add column if not exists coupon_code text;' }).catch(() => {});
      // --- Product variants + images tables ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.product_variants (id bigint generated always as identity primary key, product_id bigint not null references public.products(id) on delete cascade, sku text default '', size text default '', color text default '', price numeric(10,2) not null default 0, compare_at_price numeric(10,2), stock integer not null default 0, status text not null default 'published', created_at timestamptz not null default now(), updated_at timestamptz not null default now());" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists product_variants_product_idx on public.product_variants(product_id);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: "create unique index if not exists product_variants_sku_idx on public.product_variants(sku) where sku != '';" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists product_variants_combo_idx on public.product_variants(product_id, size, color);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.product_images (id bigint generated always as identity primary key, product_id bigint not null references public.products(id) on delete cascade, color text default '', url text not null, alt text default '', sort_order integer not null default 0, created_at timestamptz not null default now());" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists product_images_product_idx on public.product_images(product_id, sort_order);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_variants read" on public.product_variants;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_variants read" on public.product_variants for select using (true);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_variants write" on public.product_variants;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_variants write" on public.product_variants for all using (true) with check (true);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_images read" on public.product_images;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_images read" on public.product_images for select using (true);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "product_images write" on public.product_images;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "product_images write" on public.product_images for all using (true) with check (true);' }).catch(() => {});
      // --- Reviews table ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.reviews (id bigint generated always as identity primary key, product_id bigint not null references public.products(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, user_name text default '', rating integer not null default 5, title text default '', comment text default '', created_at timestamptz not null default now());" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists reviews_product_user_idx on public.reviews (product_id, user_id);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists reviews_product_idx on public.reviews (product_id, created_at desc);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "reviews public read" on public.reviews;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "reviews public read" on public.reviews for select using (true);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "reviews owner write" on public.reviews;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "reviews owner write" on public.reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).catch(() => {});
      // --- Wishlists table ---
      await supabase.rpc('exec_sql', { sql: "create table if not exists public.wishlists (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, product_id bigint not null references public.products(id) on delete cascade, created_at timestamptz not null default now());" }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists wishlists_user_product_idx on public.wishlists (user_id, product_id);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create index if not exists wishlists_user_idx on public.wishlists (user_id, created_at desc);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "wishlists owner" on public.wishlists;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "wishlists owner" on public.wishlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);' }).catch(() => {});
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
const PUBLIC_PAGES = ['/login.html', '/register.html', '/admin-login.html', '/cart.html', '/checkout.html'];
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
  // Not logged in — redirect to appropriate login page
  if (req.path === '/admin.html' || req.path.startsWith('/admin/')) {
    return res.redirect('/admin-login.html');
  }
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
app.use('/api/wishlist', require('./src/api/wishlist'));

// Health / mode check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: MODE });
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
