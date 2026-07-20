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
      await supabase.rpc('exec_sql', { sql: 'drop index if exists cart_items_cart_id_product_id_size_key;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create unique index if not exists cart_items_unique_idx on public.cart_items (cart_id, coalesce(product_id, -1), coalesce(size, \'\'), coalesce(color, \'\'));' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "carts owner" on public.carts;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'drop policy if exists "cart_items owner" on public.cart_items;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "carts all" on public.carts for all using (true) with check (true);' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'create policy "cart_items all" on public.cart_items for all using (true) with check (true);' }).catch(() => {});
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
const PUBLIC_PAGES = ['/login.html', '/register.html', '/admin-login.html'];
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
  }
  console.log('  ----------------------------------------\n');
});
