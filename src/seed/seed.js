// Seed script.
//  - LOCAL mode: writes freshly generated products into the file store
//    (only if there are no products yet), so the site is populated on first run.
//  - SUPABASE mode: inserts the same products into the products table, but only
//    when that table is empty — the catalogue is random per run, so re-upserting
//    on every boot would just pile up new rows.
//
// Products are generated procedurally by ./generateProducts.js — there is no
// products.json fixture. Tune with env vars:
//   SEED_PRODUCT_COUNT=80   how many products to build (default 60)
//   SEED_RANDOM_SEED=12345  fixed PRNG seed for a reproducible catalogue
//
// Run with:  npm run seed

const fs = require('fs');
const path = require('path');
const { generateProducts } = require('./generateProducts');
const { supabase, MODE, isConfigured, getServiceClient } = require('../../config/supabase');

const PRODUCT_COUNT = parseInt(process.env.SEED_PRODUCT_COUNT, 10) || 60;
const RANDOM_SEED = process.env.SEED_RANDOM_SEED ? parseInt(process.env.SEED_RANDOM_SEED, 10) : undefined;

// Boot-time seeding is "only if empty" so a running site is never disturbed.
// FORCE appends a fresh generated batch to a store that already has products:
//   npm run seed -- --force     or     SEED_FORCE=1 npm run seed
const FORCE = process.env.SEED_FORCE === '1' || process.argv.indexOf('--force') !== -1;

// Built lazily so a boot that skips seeding pays nothing for it.
let _products = null;
function catalogue() {
  if (!_products) _products = generateProducts(PRODUCT_COUNT, RANDOM_SEED);
  return _products;
}

function seedIfEmpty(verbose) {
  if (MODE === 'local') {
    const store = require('../db/localStore');
    const data = store.reload();

    // Seed products if empty (or append a fresh batch when forced).
    if (data.products.length === 0 || FORCE) {
      var existingSlugs = {};
      data.products.forEach(function (p) { existingSlugs[p.slug] = true; });
      var nextProductId = data.products.reduce(function (m, p) { return Math.max(m, p.id || 0); }, 0);
      var added = catalogue()
        .filter(function (p) { return !existingSlugs[p.slug]; })
        .map(function (p) {
          return Object.assign({ id: ++nextProductId }, p, { created_at: new Date().toISOString() });
        });
      data.products = data.products.concat(added);
      store.persist();
      if (verbose) console.log('[seed] local store: ' + added.length + ' generated products added (' + data.products.length + ' total).');
    } else {
      if (verbose) {
        console.log('[seed] local store already has ' + data.products.length + ' products — skipping.');
        console.log('[seed] run "npm run seed -- --force" to append a new generated batch.');
      }
    }

    // Generate variants for any product that does not have them yet.
    if (data.products.length > 0) {
      var haveVariants = {};
      (data.variants || []).forEach(function (v) { haveVariants[v.product_id] = true; });
      var variantsBefore = data.variants.length;
      var variantId = store.nextId('variant') || 0;
      data.products.forEach(function (p) {
        if (haveVariants[p.id]) return;
        var sizes = p.sizes || [];
        var colors = p.colors || [];
        if (sizes.length > 0 || colors.length > 0) {
          var combos = [];
          if (sizes.length > 0 && colors.length > 0) {
            sizes.forEach(function (s) {
              colors.forEach(function (c) {
                var colorName = typeof c === 'object' ? (c.name || '') : String(c);
                combos.push({ size: s, color: colorName });
              });
            });
          } else {
            sizes.forEach(function (s) { combos.push({ size: s, color: '' }); });
            colors.forEach(function (c) {
              var colorName = typeof c === 'object' ? (c.name || '') : String(c);
              combos.push({ size: '', color: colorName });
            });
          }
          if (combos.length === 0) combos.push({ size: '', color: '' });
          var stockPerVariant = Math.floor((p.stock || 100) / combos.length) || 1;
          combos.forEach(function (combo) {
            variantId++;
            data.variants.push({
              id: variantId,
              product_id: p.id,
              sku: p.sku ? p.sku + '-' + combo.size + '-' + combo.color : '',
              size: combo.size,
              color: combo.color,
              price: p.price,
              compare_at_price: p.compare_at_price || null,
              stock: stockPerVariant,
              status: 'published',
              created_at: p.created_at,
              updated_at: p.created_at
            });
          });
        }
      });
      data.counters.variant = variantId;
      store.persist();
      if (verbose && data.variants.length > variantsBefore) {
        console.log('[seed] ' + (data.variants.length - variantsBefore) + ' variants generated (' + data.variants.length + ' total).');
      }
    }

    // Seed admin user if no admin exists
    const hasAdmin = data.profiles.some(p => p.role === 'admin');
    if (!hasAdmin) {
      const adminId = 'local-' + store.uid();
      const adminPassword = store.hash('Admin@123456');
      data.users.push({
        id: adminId,
        email: 'admin@shopmax.com',
        full_name: 'ShopMax Admin',
        mobile: '',
        birthdate: '',
        password: adminPassword,
        role: 'admin',
        created_at: new Date().toISOString()
      });
      data.profiles.push({
        id: adminId,
        email: 'admin@shopmax.com',
        full_name: 'ShopMax Admin',
        mobile: '',
        birthdate: '',
        avatar_url: null,
        role: 'admin',
        created_at: new Date().toISOString()
      });
      store.persist();
      if (verbose) console.log('[seed] admin user created (admin@shopmax.com / Admin@123456)');
    }

    // Seed sample ratings for any product that has none yet.
    if (data.products.length > 0 && data.users.length > 0) {
      var sampleUserIds = data.users.filter(function (u) { return u.role !== 'admin'; }).map(function (u) { return u.id; });
      if (sampleUserIds.length === 0) sampleUserIds = [data.users[0].id];
      data.ratings = data.ratings || [];
      var ratingsBefore = data.ratings.length;
      var rated = {};
      var nextRatingId = data.ratings.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0);
      data.ratings.forEach(function (r) { if (r.target_type === 'product') rated[r.target_id] = true; });
      data.products.forEach(function (p) {
        if (rated[p.id]) return;
        var numRatings = Math.floor(Math.random() * 3) + 1;
        var usedUsers = {};
        for (var ri = 0; ri < numRatings; ri++) {
          var ruid = sampleUserIds[Math.floor(Math.random() * sampleUserIds.length)];
          if (usedUsers[ruid]) continue;
          usedUsers[ruid] = true;
          data.ratings.push({
            id: ++nextRatingId,
            target_type: 'product',
            target_id: p.id,
            user_id: ruid,
            rating: Math.floor(Math.random() * 2) + 4,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
        var productRatings = data.ratings.filter(function (r) { return r.target_type === 'product' && r.target_id === p.id; });
        var rc = productRatings.length;
        p.rating_count = rc;
        if (rc) {
          p.rating = Math.round(productRatings.reduce(function (s, r) { return s + r.rating; }, 0) / rc * 10) / 10;
        }
      });
      store.persist();
      if (verbose && data.ratings.length > ratingsBefore) {
        console.log('[seed] ' + (data.ratings.length - ratingsBefore) + ' sample ratings generated.');
      }
    }

    return;
  }

  // SUPABASE mode — insert the generated catalogue when the table is empty.
  if (MODE === 'supabase') {
    (async () => {

      // Seed admin user first so it's available immediately
      const sb = getServiceClient();
      if (sb) {
        const { data: existingAdmin } = await sb.from('profiles').select('id').eq('role', 'admin').maybeSingle();
        if (!existingAdmin) {
          const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
            email: 'admin@shopmax.com',
            password: 'Admin@123456',
            email_confirm: true,
            user_metadata: { full_name: 'ShopMax Admin' }
          });
          if (createErr) {
            console.warn('[seed] admin user creation failed:', createErr.message);
          } else if (newUser && newUser.user) {
            const uid = newUser.user.id;
            const { error: profileErr } = await sb.from('profiles').upsert({
              id: uid,
              email: 'admin@shopmax.com',
              full_name: 'ShopMax Admin',
              mobile: '',
              birthdate: '',
              avatar_url: null,
              role: 'admin',
              created_at: new Date().toISOString()
            }, { onConflict: 'id' });
            if (profileErr) {
              console.warn('[seed] admin profile upsert failed:', profileErr.message);
            } else {
              console.log('[seed] admin user created (admin@shopmax.com / Admin@123456)');
            }
          }
        } else {
          if (verbose) console.log('[seed] admin user already exists — skipping.');
        }
      } else {
        console.warn('[seed] SUPABASE_SERVICE_KEY not set — cannot seed admin user.');
        console.warn('[seed] Add SUPABASE_SERVICE_KEY to .env or create admin@shopmax.com manually in Supabase Dashboard > Authentication > Users.');
      }

      // Writes go through the service client when available so RLS can never
      // silently swallow the seed; falls back to the anon client otherwise.
      const db = sb || supabase;

      // The catalogue is regenerated each run, so on a boot-time seed we only
      // populate an empty table. FORCE (npm run seed -- --force, or SEED_FORCE=1)
      // appends a fresh batch to a table that already has rows.
      const { count: existingCount, error: countErr } = await db
        .from('products').select('id', { count: 'exact', head: true });
      if (countErr) {
        console.warn('[seed] could not count products:', countErr.message);
        return;
      }
      if (existingCount > 0 && !FORCE) {
        if (verbose) {
          console.log('[seed] products table already has ' + existingCount + ' rows — skipping.');
          console.log('[seed] run "npm run seed -- --force" to append a new generated batch.');
        }
        return;
      }

      const products = catalogue();
      let inserted = 0;
      for (const p of products) {
        const { data: upserted, error } = await db.from('products').upsert({
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: p.price,
          compare_at_price: p.compare_at_price,
          category: p.category,
          image_url: p.image_url,
          stock: p.stock,
          sizes: p.sizes,
          rating: p.rating,
          featured: p.featured,
          colors: p.colors || null,
          sku: p.sku || '',
          status: p.status || 'published'
        }, { onConflict: 'slug' }).select('id, slug, sizes, colors, stock, price, compare_at_price, sku').single();
        if (error) {
          console.warn('[seed] error on ' + p.slug + ':', error.message);
          continue;
        }
        inserted++;
        // Generate variants for products with sizes/colors
        if (upserted && ((p.sizes && p.sizes.length > 0) || (p.colors && p.colors.length > 0))) {
          const sizes = p.sizes || [];
          const colors = p.colors || [];
          const combos = [];
          if (sizes.length > 0 && colors.length > 0) {
            sizes.forEach(s => { colors.forEach(c => { combos.push({ size: s, color: typeof c === 'object' ? (c.name || '') : String(c) }); }); });
          } else {
            sizes.forEach(s => combos.push({ size: s, color: '' }));
            colors.forEach(c => combos.push({ size: '', color: typeof c === 'object' ? (c.name || '') : String(c) }));
          }
          if (combos.length === 0) combos.push({ size: '', color: '' });
          const stockPer = Math.floor((p.stock || 100) / combos.length) || 1;
          for (const combo of combos) {
            const sku = p.sku ? p.sku + '-' + combo.size + '-' + combo.color : '';
            const { error: vErr } = await db.from('product_variants').upsert({
              product_id: upserted.id,
              sku,
              size: combo.size,
              color: combo.color,
              price: p.price,
              compare_at_price: p.compare_at_price || null,
              stock: stockPer,
              status: 'published'
            }, { onConflict: 'product_id,size,color' });
            if (vErr && vErr.code !== '23505') console.warn('[seed] variant error for ' + p.slug + ':', vErr.message);
          }
        }
      }
      console.log('[seed] supabase: ' + inserted + '/' + products.length + ' products written (+ variants).');
    })();
    return;
  }
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  seedIfEmpty(true);
  if (isConfigured()) {
    // async supabase path logs from within
  } else {
    // already logged inside seedIfEmpty
  }
}
